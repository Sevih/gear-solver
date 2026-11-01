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
 * priority, so the loss compares like with like. Real rolls on both sides: a
 * saved build is recomposed from its pieces as captured (actual rolls and
 * enhance, never its stored stats, projected to the reforge target or
 * Transistone by the solve), with the gems it allocated; a saved build one of
 * whose pieces left the inventory no longer counts (`bestKnownFor`).
 *
 * Pure: the screen builds the context (`heroBases` composes each hero once).
 */
import type { Character, CharacterDef, GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, effectiveCharacter, expToLevel, gameRulesOf, resolveStat } from "@gear-solver/core";
import { computeFinalStats, type FinalStats, type FinalStatsBaseline, type GemOverride, type ScalingMap } from "../composeBuild.js";
import { computeCheapRatings, computeScore, type CheapRatings } from "../solver/ratings.js";
import { dmgSkillInfo } from "../dmgSkill.js";
import { overcapOf, type Overcap } from "../overcap.js";
import type { SavedBuildsMap } from "../storage/savedBuilds.js";
import { effectivePriority, latestSavedBuild, type PriorityPick, type PrioritySource } from "../heroPriority/weights.js";

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
  /** Where `priority` comes from — the Builder's kept filters for the hero,
   *  or their most recent saved build (`priorityOf`). */
  prioritySource?: PrioritySource;
}

export interface PresetEvalContext {
  inventory: Inventory;
  game: GameData | null;
  heroes: ReadonlyMap<string, HeroBase>;
  savedBuilds: SavedBuildsMap;
  /** pieceUid → claiming heroUid (`worklistClaims`, the Builder's and Builds'
   *  value): a Talisman / EE reserved by an unapplied worklist entry counts as
   *  worn by that hero in the EE gem pool (`bestEeGemsFor`). */
  worklistClaims?: Readonly<Record<string, string>>;
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
 *  `gems` swaps the socketed gems of the slots it lists (`gemAllocationOverride`). */
function composeFor(hero: HeroBase, uids: ReadonlySet<string>, ctx: PresetEvalContext, gems?: GemAllocationPick): FinalStats {
  const pieces = ctx.inventory.gear.filter((g) => uids.has(g.uid));
  const override = gems && ctx.game ? gemAllocationOverride(pieces, gems, ctx.game) : undefined;
  return computeFinalStats(hero.baseline, hero.scaling, pieces, ctx.game, override);
}

/** The hero's own EE — the one they wear today. */
export function eeOf(heroUid: string, ctx: PresetEvalContext): GearPiece | null {
  return ctx.inventory.gear.find((g) => g.slot === "exclusive" && g.equippedBy === heroUid) ?? null;
}

/** Gems per gem-bearing slot (OptionIDs, 0 = empty) — a `SolveBuild.gemAllocation`,
 *  or one slot of it. A slot left out keeps the gems socketed on its piece. */
export interface GemAllocationPick {
  talisman?: readonly number[];
  ee?: readonly number[];
}

/** The gem override that puts `alloc`'s gems on the Talisman and the EE. The
 *  composer's override skips the subs of BOTH gem-bearing slots (the solver
 *  re-allocates the two), so a slot `alloc` leaves out has its piece's own subs
 *  — its socketed gems — folded back in. Same buckets as `allocateGems`' delta. */
export function gemAllocationOverride(pieces: readonly GearPiece[], alloc: GemAllocationPick, game: GameData): GemOverride {
  const out: GemOverride = { flat: {}, pct: {} };
  const add = (stat: string, value: number, percent: boolean) => {
    const bucket = percent ? out.pct : out.flat;
    bucket[stat] = (bucket[stat] ?? 0) + value;
  };
  for (const p of pieces) {
    const kept = p.slot === "ooparts" ? !alloc.talisman : p.slot === "exclusive" ? !alloc.ee : false;
    if (kept) for (const s of p.subs) add(s.stat, s.value, s.percent);
  }
  for (const id of [...(alloc.talisman ?? []), ...(alloc.ee ?? [])]) {
    const r = id ? resolveStat(id, 1, game.options) : null;
    if (r) add(r.stat, r.value, r.percent);
  }
  return out;
}

/** The gem override that puts `eeGems` (OptionIDs, 0 = empty) on the EE, the
 *  Talisman's socketed gems — part of the preset — kept. */
export function eeGemOverride(pieces: readonly GearPiece[], eeGems: readonly number[], game: GameData): GemOverride {
  return gemAllocationOverride(pieces, { ee: eeGems }, game);
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
  return rate(hero, composeFor(hero, uids, ctx, ee && eeGems ? { ee: eeGems } : undefined));
}

/** The hero's best known outfit, in real rolls like the preset it is weighed
 *  against: their most recent saved build RECOMPOSED from its pieces as
 *  captured today (its stored `finalStats` are projected — reforge target,
 *  Transistone — so never read), with the gems it allocated on the Talisman
 *  and the EE, re-rated and re-scored with the CURRENT priority. A saved build
 *  whose pieces aren't all in the inventory any more (sold, dissolved) no
 *  longer counts: the current gear is, as without a saved build. */
export function bestKnownFor(heroUid: string, ctx: PresetEvalContext): BestKnown | null {
  const hero = ctx.heroes.get(heroUid);
  if (!hero) return null;
  const build = latestSavedBuild(ctx.savedBuilds, heroUid)?.build;
  const savedUids = new Set(build?.pieceUids ?? []);
  const owned = ctx.inventory.gear.filter((g) => savedUids.has(g.uid)).length;
  if (build && savedUids.size > 0 && owned === savedUids.size) {
    // An allocation without a gem is a solve that kept the socketed gems
    // (no gem scored, or a build saved before allocations were stored).
    const alloc = build.gemAllocation;
    const allocated = [...(alloc?.talisman ?? []), ...(alloc?.ee ?? [])].some((id) => id);
    return { ...rate(hero, composeFor(hero, savedUids, ctx, allocated ? alloc : undefined)), source: "saved" };
  }
  const uids = new Set(ctx.inventory.gear.filter((g) => g.equippedBy === heroUid).map((g) => g.uid));
  return { ...rate(hero, composeFor(hero, uids, ctx)), source: "current" };
}

/** `1 − score(preset) / score(best)` — null when either score is unknown or
 *  the best one isn't positive. Negative when the preset beats the best. */
export function presetLoss(presetScore: number | null, bestScore: number | null): number | null {
  if (presetScore == null || bestScore == null || !(bestScore > 0)) return null;
  return 1 - presetScore / bestScore;
}

/** Waste (points over the cap) from which an overcapped hero's line turns to
 *  the warning tone; below it, the badge alone. A model constant, not a
 *  setting. */
export const OVERCAP_WARN_PTS = 10;

export interface PresetOvercap extends Overcap {
  /** Waste of `OVERCAP_WARN_PTS` or more: the line takes the warning tone. */
  warn: boolean;
  /** The proposed EE gems add to the overflow — over by less, or not at all,
   *  with the gems as socketed. */
  fromGems: boolean;
}

/** The capped stats a hero overshoots on a preset (`overcapOf`, the Builds
 *  tab's rule) — `shown` is the evaluation the line displays (with the
 *  proposed EE gems), `socketed` the one with the gems as socketed today
 *  (null when no gem is proposed). */
export function presetOvercap(shown: PresetEval | null, socketed: PresetEval | null): PresetOvercap[] {
  if (!shown) return [];
  const before = socketed ? overcapOf(socketed.finalStats) : null;
  return overcapOf(shown.finalStats).map((o) => ({
    ...o,
    warn: o.waste >= OVERCAP_WARN_PTS,
    fromGems: before != null && o.waste > (before.find((b) => b.key === o.key)?.waste ?? 0),
  }));
}

/** Compose every roster hero once (no gear) — same inputs as the Builds tab
 *  and the Builder. `priorityOf` returns the hero's priority and its source
 *  (`heroPriority/weights.ts`' `priorityOf`). Heroes missing game data are
 *  left out. */
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
