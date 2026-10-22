/**
 * Preset evaluation — how a preset's outfit plays on one hero. The preset's
 * pieces + the hero's OWN current EE (gems as socketed, or the EE gems
 * `bestEeGemsFor` proposes — `eeGems`) are composed through
 * the same pipeline as the Builds tab (`computeFinalStats`), then rated
 * (`computeCheapRatings`, the hero's skill factors) and scored
 * (`computeScore`, the hero's Builder priority).
 *
 * The comparison point is the hero's best KNOWN outfit: their most recent
 * saved build, else their current gear — scored with the SAME current
 * priority, so the loss compares like with like.
 *
 * Pure: the screen builds the context (`heroBases` composes each hero once).
 */
import type { Character, CharacterDef, GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, effectiveCharacter, expToLevel, gameRulesOf, resolveStat } from "@gear-solver/core";
import { computeFinalStats, type FinalStats, type FinalStatsBaseline, type GemOverride, type ScalingMap } from "../composeBuild.js";
import { computeCheapRatings, computeScore, type CheapRatings } from "../solver/ratings.js";
import { dmgSkillInfo } from "../dmgSkill.js";
import type { SavedBuild, SavedBuildsMap } from "../storage/savedBuilds.js";

/** What the evaluation needs of one hero, composed once per screen render. */
export interface HeroBase {
  uid: string;
  baseline: FinalStatsBaseline;
  scaling: ScalingMap;
  dmgStat: "atk" | "def" | "hp";
  dmgSec?: CharacterDef["dmgSec"];
  noCrit: boolean;
  /** Best-skill factor (per-hit ratings) and rotation factor (per-turn ones). */
  skillFactor: number;
  turnFactor: number;
  /** The hero's Builder priority; null when none is set (no score then). */
  priority: Record<string, number> | null;
  /** Where `priority` comes from — the Builder's session filters, or the most
   *  recent saved build when the hero wasn't opened this session. */
  prioritySource?: PrioritySource;
}

export type PrioritySource = "session" | "saved";

/** A priority and where it was found (`heroBases`' `priorityOf`). */
export interface PriorityPick {
  priority: Record<string, number>;
  source: PrioritySource;
}

export interface PresetEvalContext {
  inventory: Inventory;
  game: GameData | null;
  heroes: ReadonlyMap<string, HeroBase>;
  savedBuilds: SavedBuildsMap;
}

export interface PresetEval {
  finalStats: FinalStats;
  ratings: CheapRatings;
  /** Null when the hero has no priority set. */
  score: number | null;
}

export interface BestKnown extends PresetEval {
  /** "saved" = the most recent saved build, "current" = the equipped gear. */
  source: "saved" | "current";
}

/** A priority counts when at least one stat carries a non-zero weight. */
export function effectivePriority(p: Record<string, number> | null | undefined): Record<string, number> | null {
  return p && Object.values(p).some((w) => w !== 0) ? p : null;
}

function rate(hero: HeroBase, finalStats: FinalStats): PresetEval {
  return {
    finalStats,
    ratings: computeCheapRatings(finalStats, hero.dmgStat, hero.dmgSec, hero.noCrit, hero.skillFactor, hero.turnFactor),
    score: hero.priority ? computeScore(finalStats, hero.priority) : null,
  };
}

/** Compose `pieces` for the hero in inventory order — the order the Builds
 *  tab composes equipped gear in, so a preset identical to the hero's gear
 *  gives the very same stats (the in-game truncations are order-sensitive).
 *  `eeGems` swaps the EE's socketed gems (`eeGemOverride`). */
function composeFor(hero: HeroBase, uids: ReadonlySet<string>, ctx: PresetEvalContext, eeGems?: readonly number[]): FinalStats {
  const pieces = ctx.inventory.gear.filter((g) => uids.has(g.uid));
  const override = eeGems && ctx.game ? eeGemOverride(pieces, eeGems, ctx.game) : undefined;
  return computeFinalStats(hero.baseline, hero.scaling, pieces, ctx.game, override);
}

/** The hero's own EE — the one they wear today. */
export function eeOf(heroUid: string, ctx: PresetEvalContext): GearPiece | null {
  return ctx.inventory.gear.find((g) => g.slot === "exclusive" && g.equippedBy === heroUid) ?? null;
}

/** The gem override that puts `eeGems` (OptionIDs, 0 = empty) on the EE. The
 *  composer's override skips the subs of BOTH gem-bearing slots (the solver
 *  re-allocates the two), so the Talisman's own subs — its socketed gems, part
 *  of the preset — are folded back in. Same buckets as `allocateGems`' delta. */
export function eeGemOverride(pieces: readonly GearPiece[], eeGems: readonly number[], game: GameData): GemOverride {
  const out: GemOverride = { flat: {}, pct: {} };
  const add = (stat: string, value: number, percent: boolean) => {
    const bucket = percent ? out.pct : out.flat;
    bucket[stat] = (bucket[stat] ?? 0) + value;
  };
  for (const p of pieces) if (p.slot === "ooparts") for (const s of p.subs) add(s.stat, s.value, s.percent);
  for (const id of eeGems) {
    const r = id ? resolveStat(id, 1, game.options) : null;
    if (r) add(r.stat, r.value, r.percent);
  }
  return out;
}

/** The hero wearing the preset's pieces + their own current EE — with its gems
 *  as socketed, or `eeGems` in their place. Null when the hero isn't
 *  composable (missing game data). */
export function evaluatePresetFor(
  heroUid: string,
  presetPieces: readonly GearPiece[],
  ctx: PresetEvalContext,
  eeGems?: readonly number[] | null,
): PresetEval | null {
  const hero = ctx.heroes.get(heroUid);
  if (!hero) return null;
  const uids = new Set(presetPieces.filter((p) => p.slot !== "exclusive").map((p) => p.uid));
  const ee = eeOf(heroUid, ctx);
  if (ee) uids.add(ee.uid);
  return rate(hero, composeFor(hero, uids, ctx, ee && eeGems ? eeGems : undefined));
}

/** The hero's best known outfit: their most recent saved build (its stored
 *  final stats, re-rated and re-scored with the CURRENT priority), else their
 *  current gear. */
export function bestKnownFor(heroUid: string, ctx: PresetEvalContext): BestKnown | null {
  const hero = ctx.heroes.get(heroUid);
  if (!hero) return null;
  const latest = latestSavedBuild(ctx.savedBuilds, heroUid);
  if (latest?.build?.finalStats) return { ...rate(hero, latest.build.finalStats), source: "saved" };
  const uids = new Set(ctx.inventory.gear.filter((g) => g.equippedBy === heroUid).map((g) => g.uid));
  return { ...rate(hero, composeFor(hero, uids, ctx)), source: "current" };
}

/** `1 − score(preset) / score(best)` — null when either score is unknown or
 *  the best one isn't positive. Negative when the preset beats the best. */
export function presetLoss(presetScore: number | null, bestScore: number | null): number | null {
  if (presetScore == null || bestScore == null || !(bestScore > 0)) return null;
  return 1 - presetScore / bestScore;
}

/** Compose every roster hero once (no gear) — same inputs as the Builds tab
 *  and the Builder. `priorityOf` returns the hero's priority and its source
 *  (`presetPriorityOf`). Heroes missing game data are left out. */
export function heroBases(
  inventory: Inventory,
  game: GameData | null,
  userGeasLevels: UserGeasLevels | null,
  userCodexLevel: number | null,
  priorityOf: (uid: string) => PriorityPick | null,
): Map<string, HeroBase> {
  const out = new Map<string, HeroBase>();
  if (!game?.codexCurve) return out;
  for (const c of inventory.characters) {
    const base = heroBase(c, game, userGeasLevels, userCodexLevel);
    if (!base) continue;
    const pick = priorityOf(c.uid);
    const priority = effectivePriority(pick?.priority);
    out.set(c.uid, { ...base, priority, ...(priority && pick ? { prioritySource: pick.source } : {}) });
  }
  return out;
}

/** The priority the Presets tab scores a hero with: the Builder's filters of
 *  this session (`gs.solver.heroFilters`, sessionStorage — the Builder starts
 *  clean at each launch), else the priority the hero's most recent saved build
 *  was solved with (`reforge.priority`), else null. A priority without any
 *  weight doesn't count, the next source is read. */
export function presetPriorityOf(
  sessionPriority: (uid: string) => Record<string, number> | null | undefined,
  savedBuilds: SavedBuildsMap,
): (uid: string) => PriorityPick | null {
  return (uid) => {
    const session = effectivePriority(sessionPriority(uid));
    if (session) return { priority: session, source: "session" };
    const latest = latestSavedBuild(savedBuilds, uid);
    const saved = effectivePriority(latest?.reforge?.priority);
    return saved ? { priority: saved, source: "saved" } : null;
  };
}

function latestSavedBuild(savedBuilds: SavedBuildsMap, uid: string): SavedBuild | null {
  return (savedBuilds[uid] ?? []).reduce<SavedBuild | null>((best, b) => (!best || b.createdAt > best.createdAt ? b : best), null);
}

function heroBase(c: Character, game: GameData, userGeasLevels: UserGeasLevels | null, userCodexLevel: number | null): Omit<HeroBase, "priority"> | null {
  const meta = effectiveCharacter(c, game.characters).def;
  if (!meta?.ingredients) return null;
  const level = expToLevel(game.expCharacter, c.exp);
  const lbKey = meta.star != null && c.levelMaxStep > 0 ? `${meta.star}|${c.levelMaxStep}` : null;
  const levelMaxModifier = lbKey ? (game.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
  const composed = composeCharStats(meta.ingredients, game.codexCurve, {
    transStar: c.stars,
    fusionLevel: c.fusionLevel,
    level,
    levelMaxModifier,
    levelMaxStep: c.levelMaxStep,
    evoUnlockLevel: gameRulesOf(game).evoUnlockLevel,
    userGeasLevels,
    userSkillLevels: { first: c.skills.first, second: c.skills.second, ultimate: c.skills.ultimate },
    ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
  });
  const skill = dmgSkillInfo(meta.bestSkill, meta.rotation);
  return {
    uid: c.uid,
    baseline: composed.noGearStats,
    scaling: composed.scaling,
    dmgStat: meta.dmgStat ?? "atk",
    dmgSec: meta.dmgSec,
    noCrit: meta.noCrit ?? false,
    skillFactor: skill.factor,
    turnFactor: skill.turn.factor,
  };
}
