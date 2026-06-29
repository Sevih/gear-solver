/**
 * Solver engine — pure compute pipeline for one worker's chunk.
 *
 *   prepareContext(req)      → builds per-slot filtered pools, hero baseline
 *                              + scaling, scored gem pool. Done once per solve.
 *   solveChunk(ctx, idx, N,  → enumerates the partitioned cartesian, prunes
 *              onPerm, opts)   on set + effect constraints, calls evalCombo
 *                              for survivors, returns top-K heap + counters.
 *   finalizeBuilds(ctx, builds, mode) → in SOLVE mode, lazily computes CP for
 *                                       the top-N (SOLVE CP already has it).
 *
 * Worker-free — exported functions are pure (no `self.postMessage`, no
 * React). The worker thin-wraps these and translates progress callbacks
 * into postMessage events.
 */
import type { GameData, GearPiece, ReforgeCeiling, RolledStat } from "@gear-solver/core";
import { composeCharStats, expToLevel, projectMainToCeiling } from "@gear-solver/core";
import {
  aggregatePrefixBuckets,
  computeFinalStats,
  computeFinalStatsFromPrefix,
  computeSetBonuses,
  type FinalStats,
  type FinalStatsBaseline,
  type GearBuckets,
  type GemOverride,
  type ScalingMap,
} from "../composeBuild.js";
import { calcBattlePower, makeCpEvaluator } from "./cp.js";
import { debug, debugEnabled } from "../log.js";
import { isLowerPriority } from "../storage/heroPriority.js";
import { aggregateGemDelta, allocateGems, allocateGemsCapped, allocateGemsReachingCap, buildGemPool, CRC_OVERSHOOT_CEIL, gemDeltaEquals, gemSlotsOf, scoreGemPool, type ScoredGem } from "./gems.js";
import { computeCheapRatings, computeScore, ROLL_NORMS, STAT_TO_PRIORITY, type CheapRatings } from "./ratings.js";
import type { PoolSizes, SetPlan, SolveBuild, SolveMode, SolveRequest } from "./types.js";
import { allSetsComplete, armorSetWhitelist, planSetIds, setsFeasible } from "./setPlans.js";
import { gearPieceQualityTier, QUALITY_TIERS, type QualityTier } from "../quality.js";

/** Map engine GearSlot → design SlotId used by the BuilderScreen's
 *  mainPicks / effect chip maps. Only `ooparts` differs (UI calls it
 *  Talisman); the rest are 1:1. */
function engineToDesign(slot: string): string {
  return slot === "ooparts" ? "talisman" : slot;
}

/** Reforge-mode preview: how aggressively to project each pool piece toward
 *  an endgame ceiling before scoring. `disable` keeps pieces as captured; the
 *  others project main stats + substat reforge ticks to a 6★ endgame:
 *   - `classic`    → +10, NOT ascended, 6 reforge ticks            (label "+10R6")
 *   - `ascended10` → +10, ascended for the reforges only, 9 ticks  (label "+10R9")
 *   - `ascended`   → +15 full Singularity, 9 ticks + passive       (label "+15R9")
 *  Ascending (50 chips) grants +3 reforges (R6→R9) and unlocks +10→+15 — nothing
 *  else. The Singularity passive (DMG± on weapon/acc vs armor) AND the +11→+15
 *  main-stat steps unlock ONLY at +15. So `ascended10` is `classic`'s exact
 *  ceiling (+10 main stat) with 3 extra reforges and NO passive — the
 *  cost-conscious endgame that skips the steep +10→+15 enhancement (chips at
 *  90/80/70/60/40%). Only `ascended` (+15) adds the steps + passive on top. */
export type ReforgeMode = "disable" | "classic" | "ascended10" | "ascended";

/** Per-mode projection plan — the enhance ceiling fed to `projectMainToCeiling`
 *  (main-stat re-scale) and the fixed reforge budget fed to `simulateReforges`
 *  (substat ticks). Budgets are fixed (not derived from the piece's real star)
 *  so every piece is previewed as a maxed 6★. `ceiling.ascended` is a MAIN-STAT
 *  formula flag (use the Singularity main-stat path) AND gates the passive — so
 *  `ascended10` keeps `ascended: false` (its +10 main stat is unchanged by
 *  ascending; only the reforge budget grows). */
const REFORGE_PLANS: Record<Exclude<ReforgeMode, "disable">, { ceiling: ReforgeCeiling; budget: number }> = {
  classic:    { ceiling: { enhanceLevel: 10, ascended: false, singularityLevel: 0 }, budget: 6 },
  ascended10: { ceiling: { enhanceLevel: 10, ascended: false, singularityLevel: 0 }, budget: 9 },
  ascended:   { ceiling: { enhanceLevel: 15, ascended: true,  singularityLevel: 5 }, budget: 9 },
};

/** Project a single pool piece to its reforge-mode ceiling: main-stat re-scale
 *  (`projectMainToCeiling`) + substat reforge ticks (`simulateReforges`) at the
 *  mode's fixed endgame budget. `disable` and Talisman/EE return the piece
 *  untouched. Shared by `precomputeContext` (pool scoring) and the Builder's
 *  bottom gear band (display), so the previewed card matches the scored stats. */
export function projectPieceForReforge(
  piece: GearPiece,
  game: GameData,
  mode: ReforgeMode,
  priority: Record<string, number>,
): GearPiece {
  if (mode === "disable" || piece.slot === "ooparts" || piece.slot === "exclusive") return piece;
  const plan = REFORGE_PLANS[mode];
  const projected = simulateReforges(projectMainToCeiling(piece, game, plan.ceiling), priority, plan.budget);
  // The unconditional Singularity passive (DMG+ on weapon/accessory, DMG- on the
  // four armor pieces) unlocks ONLY at +15 — not at ascension. So only the +15
  // plan carries `ceiling.ascended`; +10R9 (ascended for reforges) and +10R6
  // both go without it.
  return plan.ceiling.ascended ? addProjectedSingularity(projected) : projected;
}

/** Best-grade unconditional Singularity passive granted at full ascension —
 *  the optimistic ceiling the ascended preview projects (mirrors the rest of
 *  the projection's "maxed 6★" framing). Weapon/accessory roll an unconditional
 *  DMG+ (`ST_DMG_BOOST`), the four armor pieces an unconditional DMG-
 *  (`ST_DMG_REDUCE_RATE`); these are the top values in `singularity-options.json`
 *  (DMG+ v=500 → 50%, DMG- v=250 → 25%, both stored ×10 → percent). A
 *  data-consistency test guards the numbers against table changes. */
const SINGULARITY_CEILING = { dmgUp: 50, dmgReduce: 25 } as const;
/** Slots whose unconditional Singularity passive is DMG+ (the rest get DMG-). */
const SINGULARITY_DMGUP_SLOTS = new Set(["weapon", "accessory"]);

/** Append the projected unconditional Singularity passive to an ascended-
 *  projected gear piece. No-op when the piece already carries a `singularity`
 *  main entry (an already-ascended piece keeps its REAL rolled value — we never
 *  overwrite a known roll with the ceiling). Talisman/EE never reach here
 *  (`projectPieceForReforge` returns them untouched). */
function addProjectedSingularity(piece: GearPiece): GearPiece {
  if (!piece.slot || piece.main.some((m) => m.source === "singularity")) return piece;
  const isDmgUp = SINGULARITY_DMGUP_SLOTS.has(piece.slot);
  const entry: RolledStat = {
    stat: isDmgUp ? "dmgUp" : "dmgReduce",
    value: isDmgUp ? SINGULARITY_CEILING.dmgUp : SINGULARITY_CEILING.dmgReduce,
    percent: true,
    fromBuff: true,
    source: "singularity",
    name: isDmgUp ? "DMG Increase to target" : "Reduced DMG Taken from targets",
    // Rich-text desc with the colored grade letter, verbatim from the top-grade
    // option in singularity-options.json (DMG+ id 300126 / DMG- id 310066, both
    // grade "S+") so the projected passive renders with the same colored grade
    // letter as a real rolled one (GearDetail / ResultGearDetail render `desc`).
    desc: isDmgUp
      ? '<color=#ff00ff>S+</color> DMG dealt to targets increases by <color=#0D99DA>50%</color>'
      : '<color=#ff00ff>S+</color> DMG taken from targets decreases by <color=#0D99DA>25%</color>',
    combatOnly: false,
  };
  return { ...piece, main: [...piece.main, entry] };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Phase 1+2 — prepareContext
 * Builds the precompute that's reused across every combo: hero baseline +
 * scaling, per-slot filtered pools (drop ineligible pieces), scored gem pool.
 * ───────────────────────────────────────────────────────────────────────── */

/** Everything `solveChunk` / `finalizeBuilds` need that doesn't depend on
 *  which chunk a worker is running. Computed once per solve (by the
 *  orchestrator on the main thread) and broadcast to every worker via
 *  `SolveRequest.precomputed`, so the same per-slot filter / reforge sim
 *  / gem-pool work isn't re-done N times across the worker pool.
 *
 *  Structured-clone safe: only plain objects, arrays, `Map`s and `Set`s. */
export interface PrecomputedSolveContext {
  baseline: FinalStatsBaseline;
  scaling: ScalingMap;
  /** Hero's own EE — solver doesn't enumerate EE pieces, just gem-fills this. */
  ee: GearPiece | null;
  /** Per-slot pre-filtered pools (after options + class + main + effect drops). */
  pools: {
    weapon: GearPiece[];
    helmet: GearPiece[];
    armor: GearPiece[];
    gloves: GearPiece[];
    boots: GearPiece[];
    accessory: GearPiece[];
    ooparts: GearPiece[];
  };
  poolSizes: PoolSizes;
  /** Top-K gems by priority×value — solver greedily slices from this list. */
  scoredGems: ScoredGem[];
  /** Pre-aggregated gem buckets per talismanSlots variant (4 or 5).
   *  `null` entry = no positive-scoring gems → solver falls back to the
   *  piece's own socketed subs (no override). Empty map = priority is
   *  uniformly zero, same fallback path. */
  gemDeltaByTalismanSlots: Map<number, GemOverride | null>;
  /** Cached UID-list display for each surviving build's gem allocation,
   *  keyed by talismanSlots. Identical across combos (greedy picks the
   *  same top-K from a static pool), so allocate once. */
  gemAllocByTalismanSlots: Map<number, { talisman: number[]; ee: number[] }>;
  /** Skill levels for the CP calc (always reachable per-character). */
  skills: { first: number; second: number; ultimate: number; chainPassive: number };
  /** Star metadata for the CP calc — captured once. */
  starMeta: { showUIStar: number; starPlus: number; fused: boolean };
  /** Hero's damage-scaling stat (atk default; def/hp for off-ATK heroes) —
   *  the offensive ratings score against it. Constant per solve. */
  dmgStat: "atk" | "def" | "hp";
  /** Additive secondary damage scalings (stat × ratio) — undefined for the
   *  pure-single-stat majority. Constant per solve. */
  dmgSec?: ReadonlyArray<{ stat: "atk" | "def" | "hp" | "spd" | "eff" | "crc"; ratio: number }>;
  /** Hero can never crit (Rhona / K.Tamamo / G.Nella) — the offensive ratings
   *  score with `pCrit = 0` so CHC/CHD gear isn't rewarded for them. */
  noCrit: boolean;
  /** Set requirements as an OR-list of AND-plans. Used for branch-and-prune
   *  in the armor cartesian (feasible = at least one plan still reachable). */
  setPlans: SetPlan[];
  excludedSets: Set<string>;
  /** When false, every armor piece must belong to a completed set (no
   *  singleton / null-set filler) — enforced at the boots leaf. The armor
   *  pools are also pre-pruned to set-admissible pieces (see `armorSetWhitelist`). */
  allowBrokenSets: boolean;
  /** Required-effect icons per slot — when set, the slot's pool was already
   *  filtered to those icons in `buildPool`, but we still need the
   *  excluded set for tertiary checks. */
  excludedWeaponEffects: Set<string>;
  excludedAccessoryEffects: Set<string>;
  /** CP of the hero's CURRENTLY-equipped build (socketed gems, no override) —
   *  computed only when `gs.debug.solver` is on, else null. Surfaced so the
   *  footer's "Copy Debug Info" can show top-CP-vs-current at a glance (a top
   *  below current = a search/recall bug; a current below the in-game number =
   *  a compose/CP gap). CP mode only (null in Score mode). */
  debugCurCp?: number | null;
  /** The combo-budget keep-counts per slot (order: weapon, helmet, armor,
   *  gloves, boots, accessory, ooparts), or null when topPct=100 / debug off.
   *  A version+behaviour probe: its presence proves the combo-budget prune ran
   *  (new code), and the values vs `poolSizes` show whether `keepTopN` actually
   *  trimmed (a keep of 11 against a pool of 38 = trimmed). */
  debugKeeps?: number[] | null;
  /** The required-set ids (`planSetIds(setPlans)`) the prune must preserve, or
   *  null (debug off / topPct=100). When non-empty, `keepTopN` re-adds ALL armor
   *  members of these sets on top of the budget slice — so a big list explains an
   *  armor pool that stays full despite a small keep-count. */
  debugRequiredSets?: string[] | null;
}

/** Per-worker context — the precomputed bundle plus a back-pointer to the
 *  worker's own `SolveRequest` (needed by `solveChunk`/`finalizeBuilds`
 *  for chunk-specific fields like inventory + filters + mode). */
export interface SolveContext extends PrecomputedSolveContext {
  req: SolveRequest;
}

/** Build a SolveContext for one solve run. Throws if the hero isn't found
 *  or compose ingredients are missing. */
export function prepareContext(req: SolveRequest): SolveContext {
  return { req, ...precomputeContext(req) };
}

/** Chunk-independent half of `prepareContext`. The orchestrator calls this
 *  once on the main thread and broadcasts the result via
 *  `SolveRequest.precomputed`, so the 8-worker fan-out doesn't repeat the
 *  same per-slot filter / reforge sim / gem-pool work N times. Workers fall
 *  back to running it themselves if `precomputed` is missing (e.g. a future
 *  caller that doesn't go through the orchestrator). */
export function precomputeContext(req: SolveRequest): PrecomputedSolveContext {
  const { inventory: inv, game, filters, heroUid } = req;
  const hero = inv.characters.find((c) => c.uid === heroUid);
  if (!hero) throw new Error(`hero ${heroUid} not found in inventory`);
  const meta = game.characters[String(hero.charId)];
  if (!meta?.ingredients || !game.codexCurve) throw new Error("hero missing ingredients/codexCurve");

  const level = expToLevel(game.expCharacter, hero.exp);
  const lbKey = meta.star != null && hero.levelMaxStep > 0 ? `${meta.star}|${hero.levelMaxStep}` : null;
  const levelMaxModifier = lbKey ? (game.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
  const composed = composeCharStats(meta.ingredients, game.codexCurve, {
    transStar: hero.stars,
    level,
    levelMaxModifier,
    levelMaxStep: hero.levelMaxStep,
    userGeasLevels: req.userGeasLevels,
    userSkillLevels: req.userSkills,
    ...(req.userCodexLevel != null ? { codexLevel: req.userCodexLevel } : {}),
  });

  const ee = inv.gear.find((g) => g.slot === "exclusive" && g.equippedBy === heroUid) ?? null;
  const heroClass = meta.cls ?? null;
  const excludedSet = new Set(filters.excludedHeroes);

  // Set requirements arrive already expanded into explicit plans (the UI /
  // preset translator compiled the authoring shortcuts). The engine just
  // evaluates them; `excludedSets` is an orthogonal hard pool filter.
  const setPlans = filters.setPlans;
  const excludedSets = new Set<string>(filters.excludedSets);

  // Effect picks → split into required (filter pool) vs excluded (filter
  // pool too — they shouldn't appear at all). `required` is OR-list at the
  // slot level: a weapon must match ONE of the required icons.
  const requiredWeaponEffects = new Set(
    Object.entries(filters.weaponEffectPicks).filter(([, v]) => v === "required").map(([k]) => k),
  );
  const excludedWeaponEffects = new Set(
    Object.entries(filters.weaponEffectPicks).filter(([, v]) => v === "excluded").map(([k]) => k),
  );
  const requiredAccessoryEffects = new Set(
    Object.entries(filters.accessoryEffectPicks).filter(([, v]) => v === "required").map(([k]) => k),
  );
  const excludedAccessoryEffects = new Set(
    Object.entries(filters.accessoryEffectPicks).filter(([, v]) => v === "excluded").map(([k]) => k),
  );

  // Quality gate — drop pieces whose rolled-substat quality is below the
  // chosen tier. `minQualityRank < 0` (unset / unknown) disables the check.
  // Talisman / EE return a null tier and are never gated.
  const minQualityRank = filters.minQuality
    ? QUALITY_TIERS.indexOf(filters.minQuality as QualityTier)
    : -1;

  const equippedScope = filters.options.equippedScope ?? "all";
  const heroPriority = req.heroPriority ?? {};
  // Account-global "never use" pieces (Inventory right-click → exclude). Built
  // once; checked first in `allow` so an excluded piece never enters any pool.
  const excludedPieces = new Set(req.excludedPieceUids ?? []);
  // Per-slot filter helper. Returns true if the piece is allowed in this slot.
  const allow = (g: GearPiece, slot: string): boolean => {
    if (g.slot !== slot) return false;
    if (excludedPieces.has(g.uid)) return false;
    // Equipped on ANOTHER hero — own + free gear is always in. The scope gates
    // the rest: "none" excludes all; "lower" keeps only gear on a strictly
    // lower-priority hero (so equal/higher heroes are never stripped); "all"
    // keeps everything (legacy). Excluded heroes are out regardless. The
    // selected hero is exempt from both checks — the picker lists every
    // character so the user CAN tick himself, but doing so must not drop his
    // own equipped gear (invariant: own gear is always in). The gem pool
    // mirrors this via its own `heroUid` opt.
    if (g.equippedBy && g.equippedBy !== heroUid) {
      if (equippedScope === "none") return false;
      if (equippedScope === "lower" && !isLowerPriority(heroPriority, g.equippedBy, heroUid)) return false;
      if (excludedSet.has(g.equippedBy)) return false;
    }
    if (filters.options.onlyMaxed && g.enhanceLevel < 15) return false;
    // Quality gate — only on slots that have a quality tier (null → keep).
    if (minQualityRank >= 0) {
      const tier = gearPieceQualityTier(g);
      if (tier && QUALITY_TIERS.indexOf(tier) < minQualityRank) return false;
    }
    if (heroClass && g.classLimit && g.classLimit !== heroClass) return false;
    // Main stat picks (per design slot — only weapon/accessory/talisman in UI).
    const dslot = engineToDesign(slot);
    const mainPicks = filters.mainPicks[dslot];
    if (mainPicks && Object.keys(mainPicks).length > 0) {
      const stats = g.main
        .filter((m) => !m.combatOnly && (m.source ?? "option") === "option")
        .map((m) => m.stat);
      if (!stats.some((s) => mainPicks[s])) return false;
    }
    // Effect picks — weapon / accessory only. Keyed on `setId` (the unique
    // UniqueOptionID effect identity), NOT `effectIcon` — distinct effects can
    // share an icon (the Recklessness family), which would make an icon filter
    // match the wrong variants.
    if (slot === "weapon" || slot === "accessory") {
      const def = game.equipment[String(g.itemId)];
      const effKey = def?.setId ?? null;
      const excludedEffects = slot === "weapon" ? excludedWeaponEffects : excludedAccessoryEffects;
      const requiredEffects = slot === "weapon" ? requiredWeaponEffects : requiredAccessoryEffects;
      if (effKey && excludedEffects.has(effKey)) return false;
      if (requiredEffects.size > 0 && (!effKey || !requiredEffects.has(effKey))) return false;
    }
    // Excluded sets — drop the piece outright.
    if (g.armorSetId && excludedSets.has(g.armorSetId)) return false;
    return true;
  };

  const grab = (slot: string): GearPiece[] => inv.gear.filter((g) => allow(g, slot));

  // Keep-current short-circuit: if the toggle is on AND the hero already
  // has a piece equipped in this slot, lock the pool to that single piece
  // (solver effectively just optimizes empty slots + Talisman + gems).
  // Locked slots are recorded so the set-prune below can't drop a forced
  // piece (the user explicitly pinned it; that pin wins over the set whitelist).
  const lockedSlots = new Set<string>();
  const grabRespectingKeep = (slot: string): GearPiece[] => {
    if (!filters.options.keepCurrent) return grab(slot);
    const cur = inv.gear.find((g) => g.slot === slot && g.equippedBy === heroUid);
    if (cur) { lockedSlots.add(slot); return [cur]; }
    return grab(slot);
  };

  const pools = {
    weapon: grabRespectingKeep("weapon"),
    helmet: grabRespectingKeep("helmet"),
    armor: grabRespectingKeep("armor"),
    gloves: grabRespectingKeep("gloves"),
    boots: grabRespectingKeep("boots"),
    accessory: grabRespectingKeep("accessory"),
    ooparts: grabRespectingKeep("ooparts"),
  };

  // Set-based pool prune. When the set requirements fully constrain the armor
  // (e.g. `2pc A + 2pc B` or `4pc A` → no free armor slot), every out-of-set
  // armor piece is dead weight — drop it before the cartesian blows up. When a
  // requirement leaves free slots (`2pc A` alone), pieces of any set may fill
  // them, so nothing is prunable UNLESS the user disallows broken sets, in
  // which case only set-completing pieces (required + formable) survive.
  // `armorSetWhitelist` returns null when no prune applies; locked slots are
  // exempt so a keep-current pin is never elided.
  const allowBrokenSets = filters.options.allowBrokenSets ?? true;
  const ARMOR = ["helmet", "armor", "gloves", "boots"] as const;
  const formableSets = computeFormableSets(ARMOR.map((s) => pools[s]));
  const whitelist = armorSetWhitelist(setPlans, allowBrokenSets, formableSets);
  if (whitelist) {
    for (const slot of ARMOR) {
      if (lockedSlots.has(slot)) continue;
      pools[slot] = pools[slot].filter((g) => g.armorSetId != null && whitelist.has(g.armorSetId));
    }
  }

  // Reforge simulation — if the user toggled "Use reforged stats", clone
  // each piece with its remaining reforge attempts greedily allocated to
  // the highest-priority substats. Happens BEFORE the combo-budget prune so it
  // ranks pieces by their best-case reforged value, not their current state.
  //
  // ooparts (Talisman) and exclusive (EE) are deliberately excluded —
  // their `subs` array is actually the gem-slot list (the parser stuffs
  // `SubOptionList[i]` resolved gems into `subs`), and gems aren't
  // reforgeable in-game (you swap them via the gem allocator instead).
  // Running `simulateReforges` on them would inflate gem values, which
  // surfaces as wrong CP/stats whenever the gem-override path is bypassed
  // (i.e. SOLVE mode without explicit priority — the fallback that reads
  // talisman subs directly). `simulateReforges` itself also rejects these
  // slots defensively in case a future caller forgets to filter here.
  const reforgeMode = filters.options.reforgeMode ?? "disable";
  if (reforgeMode !== "disable") {
    for (const slot of ["weapon", "helmet", "armor", "gloves", "boots", "accessory"] as const) {
      pools[slot] = pools[slot].map((p) => projectPieceForReforge(p, game, reforgeMode, filters.priority));
    }
  }

  // Star metadata + skills for CP — hoisted above the prune so the
  // CP-weighted auto-prune below can build a CP evaluator (also returned).
  const transRow = meta.ingredients.transcendByStar?.[String(hero.stars)] ?? null;
  const starMeta = {
    showUIStar: transRow?.showUIStar ?? 0,
    starPlus: transRow?.starPlus ?? 0,
    fused: hero.fusionCharId !== 0,
  };
  const skills = {
    first: req.userSkills.first,
    second: req.userSkills.second,
    ultimate: req.userSkills.ultimate,
    chainPassive: req.userSkills.chainPassive,
  };

  // Combo-budget per-slot prune (bounds ∏ poolSizes — see below). Needs a
  // ranking signal per slot:
  //   - explicit substat priority      → rank by it (SOLVE or SOLVE CP);
  //   - else SOLVE CP                   → rank by a CP-weighted proxy;
  //   - else SOLVE (Score) w/o priority → rank by raw roll magnitude (no
  //     objective, but the product still has to be bounded).
  //
  // Required-set protection: pieces belonging to a `req-2pc` / `req-4pc`
  // set are never elided by the prune, regardless of score. Without this
  // guard, a low-scoring set member could be dropped and `checkSetsFeasible`
  // would silently return 0 results (the user sees "no builds" without a clue
  // why). Protected pieces survive on top of the budget slice.
  const hasPriority = Object.values(filters.priority).some((v) => v !== 0);
  let debugKeeps: number[] | null = null;
  let debugRequiredSets: string[] | null = null;
  if (filters.topPct < 100) {
    const requiredSetIds = planSetIds(setPlans);
    if (debugEnabled("solver")) debugRequiredSets = Array.from(requiredSetIds);
    // Absolute combo budget — a per-slot PERCENTAGE never bounds the PRODUCT. 30%
    // of seven ~40-50-piece pools is still ~7e8 combos (measured on a real
    // account: 703M / 142s in Score mode with a priority set). `allocateComboBudget`
    // water-fills per-slot keep-counts so ∏ keep ≤ budget (small slots kept whole,
    // the surplus flowing to the big armor slots); the Top% slider scales the
    // budget (30 = default target; 100 already short-circuited to exhaustive
    // above). Applies to BOTH objectives — only the per-slot RANKING differs. Set
    // members are preserved by `keepTopN` regardless of rank, else a low-ranked
    // required-set piece could drop and `checkSetsFeasible` would silently return
    // 0 builds.
    const capSlots = (["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const)
      .filter((s) => !lockedSlots.has(s));
    const budget = COMBO_BUDGET * (filters.topPct / 30);
    const keeps = allocateComboBudget(capSlots.map((s) => pools[s].length), budget);
    if (debugEnabled("solver")) debugKeeps = keeps;
    if (hasPriority) {
      // Explicit substat priority (SOLVE or SOLVE CP) — rank each slot by the
      // per-roll priority score. The build score is largely additive over
      // per-piece scores, so the highest-scoring pieces per slot make the best
      // builds; the budget just drops the long tail of weak combos.
      const scoreOf = priorityScoreOf(filters.priority);
      capSlots.forEach((slot, i) => {
        pools[slot] = keepTopN(pools[slot], scoreOf, keeps[i]!, requiredSetIds);
      });
    } else if (req.mode === "cp") {
      // CP-weighted auto-prune — makes "max CP" tractable without a hand-tuned
      // priority (the default-Top% case the user actually hits). Rank each
      // candidate by the CP it yields when dropped into the hero's CURRENT
      // build (other slots = their equipped pieces), so the crit/pen/spd chain
      // that scales ATK is realistic instead of near-zero — a bare single-piece
      // baseline would under-rank ATK pieces. This is the soft, scalar form of
      // the dominance prune (rank by one CP number instead of requiring ≥ on
      // every axis), and it collapses the cartesian on an unfiltered CP solve.
      // Heuristic — set-coupled builds can be under-ranked (a piece is scored
      // standalone, not for a set it'd help form); raise Top% or require the set.
      //
      // ooparts (Talisman) IS included: in CP mode every same-slot-count talisman
      // gets the SAME global gem delta, so they differ almost only by their main
      // (flat ATK) — the CP score ranks them by that and the dominated ones drop.
      // Without this the talisman pool (often 60-70) multiplied the whole
      // cartesian. EE is still exempt (single equippable piece, folded post-talisman).
      const cpEval = makeCpEvaluator({
        showUIStar: starMeta.showUIStar, starPlus: starMeta.starPlus, skills, ee, fused: starMeta.fused,
      });
      const equipped = inv.gear.filter((g) => g.equippedBy === heroUid);
      const ooEquipped = equipped.find((g) => g.slot === "ooparts") ?? null;
      capSlots.forEach((slot, i) => {
        const others = equipped.filter((g) => g.slot !== slot);
        const scoreOf = (p: GearPiece): number =>
          // For the ooparts slot the candidate IS the talisman, so it's also the
          // CP evaluator's ooparts arg (its ooBp bonus); elsewhere the equipped
          // talisman stays fixed.
          cpEval(computeFinalStats(composed.noGearStats, composed.scaling, others.concat(p), game), slot === "ooparts" ? p : ooEquipped);
        // Pin the currently-equipped piece so the current build is always
        // reachable → the solver can never return a lower CP than the hero
        // already has, even when the piece doesn't rank in the budget's top-K.
        const cur = equipped.find((g) => g.slot === slot);
        const pin = cur ? new Set([cur.uid]) : undefined;
        pools[slot] = keepTopN(pools[slot], scoreOf, keeps[i]!, requiredSetIds, pin);
      });
    } else {
      // SOLVE (Score) with NO priority — the score is uniformly 0, so there's no
      // objective to rank by. We still must bound the product (leaving the pools
      // full is the 7e8-combo cartesian that hangs), so keep the budget's share
      // of the fullest-rolled pieces per slot (`magnitudeScoreOf`). Results are
      // inherently arbitrary here (no priority = no objective); this only keeps
      // the solve from hanging.
      capSlots.forEach((slot, i) => {
        pools[slot] = keepTopN(pools[slot], magnitudeScoreOf, keeps[i]!, requiredSetIds);
      });
    }
  }

  // CP-mode dominance prune (structural combo-count reduction — see Phase 3).
  // CP is monotone in every gear stat, so a piece strictly dominated within its
  // slot's set / effect group can never produce a higher-CP build than its
  // dominator → drop it before the cartesian. Runs LAST (after the onlyMaxed /
  // set / reforge / top-% steps) so it compares the exact pool array the solver
  // iterates — the monotonicity proof is over the composed bucket numbers, so it
  // holds whatever produced them: captured stats (reforgeMode "disable"), the
  // ceiling projection ("classic"/"ascended"), with or without onlyMaxed. The
  // mode only changes WHICH pieces survive, never the prune's correctness.
  //
  // Disabled when a constraint could make a strictly-lower-stat build uniquely
  // feasible (else dropping the dominated piece would under-return):
  //   - a stat MAX bound — a weaker piece may be the only one under the cap;
  //   - ANY rating / cp / upg bound — the cheap ratings aren't guaranteed
  //     monotone in the stats, and `upg` keys off the equipped-piece identity,
  //     not the stat vector; neither is ordered by stat dominance.
  // Stat MIN bounds stay optimized (the dominator meets them whenever the
  // dominated does). Talisman / EE are never pruned: their gems come from the
  // global allocation and the per-combo crit-cap reroute breaks per-piece
  // monotonicity.
  const noStatMax = !Object.values(filters.statFilters).some((b) => b?.max != null);
  const noRatingBound = !Object.values(filters.ratingFilters).some((b) => b && (b.min != null || b.max != null));
  if (req.mode === "cp" && noStatMax && noRatingBound) {
    const effKeyOf = (g: GearPiece): string => game.equipment[String(g.itemId)]?.setId ?? "—";
    const setKeyOf = (g: GearPiece): string => g.armorSetId ?? "—";
    for (const slot of ["weapon", "accessory"] as const) {
      if (!lockedSlots.has(slot)) pools[slot] = pruneDominatedForCp(pools[slot], effKeyOf);
    }
    for (const slot of ["helmet", "armor", "gloves", "boots"] as const) {
      if (!lockedSlots.has(slot)) pools[slot] = pruneDominatedForCp(pools[slot], setKeyOf);
    }
  }

  // Debug (gs.debug.solver) — diagnose "solver CP < my current build". Logs the
  // CP OUR engine computes for the hero's currently-equipped build (socketed
  // gems, no override) and whether each current piece survived the prune. If
  // curCp ≈ the in-game number but the solve returns less → recall (a pinned
  // piece should now prevent that); if curCp itself is below the in-game number
  // → a compose/CP-calc gap to chase (gems / talisman / EE), not the search.
  let debugCurCp: number | null = null;
  if (debugEnabled("solver") && req.mode === "cp") {
    const eq = inv.gear.filter((g) => g.equippedBy === heroUid);
    const oo = eq.find((g) => g.slot === "ooparts") ?? null;
    const cpEvalDbg = makeCpEvaluator({
      showUIStar: starMeta.showUIStar, starPlus: starMeta.starPlus, skills, ee, fused: starMeta.fused,
    });
    debugCurCp = eq.length
      ? cpEvalDbg(computeFinalStats(composed.noGearStats, composed.scaling, eq, game), oo)
      : null;
    const survival = (["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const).map((s) => {
      const cur = eq.find((g) => g.slot === s) ?? null;
      return { slot: s, uid: cur?.uid ?? null, inPool: cur ? pools[s].some((p) => p.uid === cur.uid) : null, kept: pools[s].length };
    });
    debug("solver", "cp-current-build", { heroUid, curCp: debugCurCp, survival });
  }

  // Total counts for the footer (pre-filter) — count any piece in the slot,
  // ignoring filters, so the user sees "26/152" semantics.
  const countAll = (slot: string): number => inv.gear.reduce((n, g) => n + (g.slot === slot ? 1 : 0), 0);
  const poolSizes: PoolSizes = {
    weapon:    { hit: pools.weapon.length,    of: countAll("weapon") },
    helmet:    { hit: pools.helmet.length,    of: countAll("helmet") },
    armor:     { hit: pools.armor.length,     of: countAll("armor") },
    gloves:    { hit: pools.gloves.length,    of: countAll("gloves") },
    boots:     { hit: pools.boots.length,     of: countAll("boots") },
    accessory: { hit: pools.accessory.length, of: countAll("accessory") },
    talisman:  { hit: pools.ooparts.length,   of: countAll("ooparts") },
    exclusive: { hit: ee ? 1 : 0,             of: countAll("exclusive") },
  };

  // Gem pool — full inventory union, scored once. Scoring depends on
  // `priority`; when uniformly zero, scores collapse to 0 and the
  // allocator yields `null` → solver falls back to the Talisman/EE's
  // own socketed subs (good for SOLVE mode without explicit intent).
  //
  // SOLVE CP mode without a user priority scores gems by their CP WEIGHT
  // (`cpStatWeights`), not raw magnitude. Ranking by `value / norm` made the
  // allocator grab high-magnitude dmg-reduce / flat gems that barely move CP,
  // so a CP solve could return LESS CP than the equipped build (its good gems
  // swapped for big-number low-CP ones). The CP weights are evaluated at the
  // hero's current build, so the picked gems actually maximize CP. An explicit
  // user priority still wins; SOLVE Score without a priority keeps the old
  // fallback (scores collapse to 0 → socketed gems preserved).
  //
  // Gem pool eligibility mirrors `allow()` for pieces: gear on other heroes
  // honors the same equipped scope (own + free always in; "lower" only takes
  // gems off strictly-lower-priority heroes; "none" excludes all others) and
  // excluded heroes. Otherwise the solver could recommend gems that require
  // unequipping a Talisman/EE on a hero the user just opted out of / outranks.
  const gemPool = buildGemPool(inv, {
    heroUid,
    equippedScope,
    heroPriority,
    excludedHeroes: excludedSet,
  });
  const gemPriority = hasPriority
    ? filters.priority
    : req.mode === "cp"
      ? cpStatWeights(
          computeFinalStats(composed.noGearStats, composed.scaling, inv.gear.filter((g) => g.equippedBy === heroUid), game),
          makeCpEvaluator({ showUIStar: starMeta.showUIStar, starPlus: starMeta.starPlus, skills, ee, fused: starMeta.fused }),
          inv.gear.find((g) => g.equippedBy === heroUid && g.slot === "ooparts") ?? null,
        )
      : filters.priority;
  const scoredGems = scoreGemPool(gemPool, gemPriority, game, { allowZeroPriority: false });
  const eeSlotCount = gemSlotsOf(ee);
  // Pre-aggregate gem contribution per talismanSlots variant — at most
  // two variants (4 and 5) cover every talisman in the inventory.
  // `null` entry signals "no positive-scoring gems for this variant" so
  // the solver passes `undefined` to computeFinalStats (current subs path).
  const gemDeltaByTalismanSlots = new Map<number, GemOverride | null>();
  const gemAllocByTalismanSlots = new Map<number, { talisman: number[]; ee: number[] }>();
  for (const ts of [4, 5] as const) {
    gemDeltaByTalismanSlots.set(ts, aggregateGemDelta(scoredGems, ts, eeSlotCount));
    gemAllocByTalismanSlots.set(ts, allocateGems(scoredGems, ts, eeSlotCount));
  }

  return {
    baseline: composed.noGearStats,
    scaling: composed.scaling,
    ee,
    pools,
    poolSizes,
    scoredGems,
    gemDeltaByTalismanSlots,
    gemAllocByTalismanSlots,
    skills,
    starMeta,
    dmgStat: meta.dmgStat ?? "atk",
    dmgSec: meta.dmgSec,
    noCrit: meta.noCrit ?? false,
    setPlans,
    excludedSets,
    allowBrokenSets,
    excludedWeaponEffects,
    excludedAccessoryEffects,
    debugCurCp,
    debugKeeps,
    debugRequiredSets,
  };
}

/** Sets reachable as a 2pc from the armor pools — present in ≥2 distinct armor
 *  slots (you take at most one piece per slot, so a set living in a single slot
 *  can never form a bonus). Drives the "no broken sets" free-slot whitelist. */
function computeFormableSets(armorPools: GearPiece[][]): Set<string> {
  const slotCount = new Map<string, number>();
  for (const pool of armorPools) {
    const seen = new Set<string>();
    for (const g of pool) {
      if (g.armorSetId && !seen.has(g.armorSetId)) {
        seen.add(g.armorSetId);
        slotCount.set(g.armorSetId, (slotCount.get(g.armorSetId) ?? 0) + 1);
      }
    }
  }
  const formable = new Set<string>();
  for (const [id, n] of slotCount) if (n >= 2) formable.add(id);
  return formable;
}

/** Per-substat tick cap for the reforge simulator. Observed max in real
 *  captures is LV6 (`ticks: 6`), beyond which the in-game reforge UI no
 *  longer accepts ticks. Conservative cap — keeps the predicted stat sheet
 *  within reachable in-game bounds. */
const REFORGE_PER_SUB_CAP = 6;

/** In-game reforge budget for a piece: N reforges for a 1★→6★ piece (= its
 *  star), with a 6★ ascended (Singularity) piece getting an extra +3 → 9 total.
 *  The +3 is exclusive to 6★ Singularity items; lower-star ascension doesn't
 *  exist (ascension is a 6★-only mechanic). Exported so non-solver surfaces
 *  (e.g. the Builds advice) read the same budget instead of re-deriving it. */
export function maxReforgesOf(piece: GearPiece): number {
  const star = piece.star ?? 0;
  return star === 6 && piece.ascended ? star + 3 : star;
}

/** Predict the maximum-rolled state of a piece by distributing its
 *  remaining reforge attempts (`star − reforgeCount`) across substats:
 *  greedy by `priority × per-tick value`, respecting the per-sub LV6 cap
 *  and the total budget. Returns a CLONE — caller's original piece is
 *  untouched.
 *
 *  When priority is uniformly zero, the greedy tie-break falls to raw
 *  per-tick value (maximizes total stat output regardless of axis).
 *
 *  REJECTS Talisman / EE pieces — their `subs` array is the gem-slot list
 *  (the parser stores resolved gems there, not rolled substats), and gems
 *  aren't reforgeable in-game (you swap them via the gem allocator). The
 *  caller in `prepareContext` already filters these slots out; this check
 *  is defense-in-depth so a future caller can't silently inflate gem values.
 *
 *  This is intentionally a HEURISTIC — the real game lets you re-roll
 *  individual ticks (orange) but we assume monotonic additions only. Good
 *  enough for "what's the best this piece can become?" previews. */
export function simulateReforges(piece: GearPiece, priority: Record<string, number>, maxReforgesOverride?: number): GearPiece {
  if (piece.slot === "ooparts" || piece.slot === "exclusive") return piece;
  // `maxReforgesOverride` lets the reforge-mode preview impose a fixed endgame
  // budget regardless of the piece's actual star (classic = 6, ascended = 9) —
  // "project every piece as if it were max-star 6★".
  const maxReforges = maxReforgesOverride ?? maxReforgesOf(piece);
  const remaining = Math.max(0, maxReforges - piece.reforgeCount);
  if (remaining === 0 || piece.subs.length === 0) return piece;
  const subs: RolledStat[] = piece.subs.map((s) => ({ ...s }));
  // Pre-compute per-sub scoring data; mutated in the loop as ticks accumulate.
  const meta = subs.map((s) => {
    const pk = STAT_TO_PRIORITY[s.stat] ?? s.stat;
    const w = priority[pk] ?? 0;
    const perTick = (s.ticks && s.ticks > 0) ? s.value / s.ticks : s.value;
    return { weighted: w * perTick, perTick };
  });
  for (let i = 0; i < remaining; i++) {
    let bestIdx = -1;
    let bestW = -Infinity;
    let bestP = -Infinity;
    for (let j = 0; j < subs.length; j++) {
      const s = subs[j]!;
      if ((s.ticks ?? 0) >= REFORGE_PER_SUB_CAP) continue;
      const m = meta[j]!;
      // Primary: weighted score. Secondary: raw per-tick (drives fallback
      // when no priority is set — distributes to maximize total stat output).
      if (m.weighted > bestW || (m.weighted === bestW && m.perTick > bestP)) {
        bestIdx = j; bestW = m.weighted; bestP = m.perTick;
      }
    }
    if (bestIdx === -1) break; // every sub capped
    const target = subs[bestIdx]!;
    const m = meta[bestIdx]!;
    target.value += m.perTick;
    target.ticks = (target.ticks ?? 0) + 1;
    target.reforgeTicks = (target.reforgeTicks ?? 0) + 1;
  }
  // Bump reforgeCount to the projected investment ceiling so the displayed
  // quality denominator matches (max = 14 base ticks + reforgeCount). Otherwise
  // the projection adds reforge ticks the captured count doesn't know about and
  // quality reads as an impossible >100% (e.g. 19/14). Some subs may cap at LV6
  // before the budget is spent, so `current` can still be < max (e.g. 19/23).
  return { ...piece, subs, reforgeCount: maxReforges };
}

/** Per-roll priority score for ONE piece: Σ over its rolls of
 *  `priority[userKey] × value / ROLL_NORMS[engineKey]`. Combat-only main options
 *  (conditional +15 singularity stats) are skipped — they're not on the sheet the
 *  score targets. ROLL_NORMS (per-roll magnitude, e.g. flat atk≈300, atkPct≈40,
 *  crc≈20) NOT STAT_NORMS (endgame final magnitude): the two scales differ ~100×,
 *  so STAT_NORMS here would rank percent rolls 100× too low. Rolls carry engine
 *  keys (`atkPct`, `critRate`, …) while `priority` is user-keyed (`atk`, `crc`, …)
 *  — `STAT_TO_PRIORITY` bridges. Returns a closure so the combo-budget prune can
 *  rank each slot's pool by one cheap pass. */
export function priorityScoreOf(priority: Record<string, number>): (p: GearPiece) => number {
  return (p) => {
    let s = 0;
    for (const r of p.subs) {
      const w = priority[STAT_TO_PRIORITY[r.stat] ?? r.stat] ?? 0;
      if (w) s += w * r.value / (ROLL_NORMS[r.stat] ?? 100);
    }
    for (const r of p.main) {
      if (r.combatOnly) continue;
      const w = priority[STAT_TO_PRIORITY[r.stat] ?? r.stat] ?? 0;
      if (w) s += w * r.value / (ROLL_NORMS[r.stat] ?? 100);
    }
    return s;
  };
}

/** Priority-agnostic ranking proxy: total normalized roll magnitude of a piece
 *  (Σ value / ROLL_NORMS over its non-combat rolls). Used ONLY to bound the
 *  Score-mode-without-priority cartesian — there's no objective to optimize, so
 *  we keep the fullest-rolled pieces per slot rather than leaving the pool
 *  unbounded (which is the multi-hundred-million-combo hang). */
export function magnitudeScoreOf(p: GearPiece): number {
  let s = 0;
  for (const r of p.subs) s += r.value / (ROLL_NORMS[r.stat] ?? 100);
  for (const r of p.main) if (!r.combatOnly) s += r.value / (ROLL_NORMS[r.stat] ?? 100);
  return s;
}

/** Default combo budget for the per-slot auto-prune: the cartesian the solver is
 *  allowed to walk at the default Top% (30). At ~5-13M combos/s across a modern
 *  worker pool (Score is heavier per combo than CP) this finishes in ~1-2s; the
 *  Top% slider scales it linearly. Applies to every objective (priority / CP /
 *  magnitude) — a per-slot percentage can't bound the product. */
const COMBO_BUDGET = 8_000_000;

/** Generic top-N selector: score every piece with `scoreOf`, keep the top `n`
 *  (clamped to [1, length]), then re-add the few protected pieces the budget
 *  must not drop:
 *   - For each required set, only its SINGLE top-scoring member not already in
 *     the slice. A slot holds one piece, and a set needs `count` pieces across
 *     DISTINCT armor slots — so keeping ONE member per set per slot already makes
 *     any count (up to 4) formable. Keeping ALL members (the old behaviour) blew
 *     the combo budget: with a required set the armor pools stayed at their full
 *     pre-prune size (a "Speed 4pc" reco on a speed-rich account re-added every
 *     Speed piece → ∏ back to ~2e9 / minutes). The best members are in the top-N
 *     anyway (the priority that defines the build scores them high), so the
 *     dropped tail is low-value gear.
 *   - Every `pinUid` (the hero's currently-equipped piece) so the solver can
 *     always at least reproduce the current build → never a WORSE result.
 *  Shared by every per-slot auto-prune objective (priority / CP / magnitude), so
 *  all three honor set feasibility + pinning identically while staying bounded
 *  to `keep + #requiredSets + #pins`. */
export function keepTopN(
  pieces: GearPiece[],
  scoreOf: (p: GearPiece) => number,
  n: number,
  requiredSetIds: Set<string>,
  pinUids?: Set<string>,
): GearPiece[] {
  if (pieces.length === 0) return pieces;
  const scored = pieces.map((p) => ({ p, s: scoreOf(p) }));
  scored.sort((a, b) => b.s - a.s);
  const keep = Math.max(1, Math.min(pieces.length, n));
  const kept = scored.slice(0, keep).map((e) => e.p);
  if (requiredSetIds.size === 0 && !pinUids?.size) return kept;
  const keptUids = new Set(kept.map((p) => p.uid));
  // Required sets already represented in the top-N slice need no extra member.
  const coveredSets = new Set<string>();
  for (const p of kept) if (p.armorSetId && requiredSetIds.has(p.armorSetId)) coveredSets.add(p.armorSetId);
  // Walk in score order so each set's promoted member is its best, and a pin is
  // added once. At most one member per still-uncovered required set + every pin.
  for (const { p } of scored) {
    if (keptUids.has(p.uid)) continue;
    const uncoveredSet = p.armorSetId != null && requiredSetIds.has(p.armorSetId) && !coveredSets.has(p.armorSetId);
    if (uncoveredSet || pinUids?.has(p.uid)) {
      kept.push(p);
      keptUids.add(p.uid);
      if (uncoveredSet) coveredSets.add(p.armorSetId!);
    }
  }
  return kept;
}

/** Top-% wrapper over `keepTopN` — keeps `ceil(N × pct/100)`. */
export function keepTopPct(
  pieces: GearPiece[],
  scoreOf: (p: GearPiece) => number,
  pct: number,
  requiredSetIds: Set<string>,
): GearPiece[] {
  return keepTopN(pieces, scoreOf, Math.ceil(pieces.length * pct / 100), requiredSetIds);
}

/** CP weight per user priority key = ΔCP from adding one ROLL_NORM-sized bump of
 *  that stat to a reference build (clamped ≥0). Lets SOLVE CP score gems by their
 *  CP impact instead of raw magnitude: without it the allocator grabs big-number
 *  dmg-reduce / flat gems that barely move CP over the atk / crit / pen gems that
 *  actually drive it (observed: a CP solve returning LESS CP than the equipped
 *  build because its gems were swapped for high-magnitude low-CP ones). Evaluated
 *  at `cur` so a stat already at its CP cap (e.g. CRC ~100%) gets ~0 weight on its
 *  own. Keyed by user priority keys so it drops straight into `scoreGemPool`. */
export function cpStatWeights(
  cur: FinalStats,
  cpEval: (s: FinalStats, oo: GearPiece | null) => number,
  ooparts: GearPiece | null,
): Record<string, number> {
  const cp0 = cpEval(cur, ooparts);
  const d = (patch: Partial<FinalStats>): number => Math.max(0, cpEval({ ...cur, ...patch }, ooparts) - cp0);
  return {
    atk: d({ atk: cur.atk + ROLL_NORMS.atk! }),
    def: d({ def: cur.def + ROLL_NORMS.def! }),
    hp:  d({ hp:  cur.hp  + ROLL_NORMS.hp! }),
    spd: d({ spd: cur.spd + ROLL_NORMS.spd! }),
    critRate: d({ critRate: cur.critRate + ROLL_NORMS.critRate! }),
    critDmg: d({ critDmg: cur.critDmg + ROLL_NORMS.critDmg! }),
    pen: d({ pen: cur.pen + ROLL_NORMS.pen! }),
    dmgUp: d({ dmgUp: cur.dmgUp + ROLL_NORMS.dmgUp! }),
    dmgReduce: d({ dmgReduce: cur.dmgReduce + ROLL_NORMS.dmgReduce! }),
    critDmgReduce: d({ critDmgReduce: cur.critDmgReduce + ROLL_NORMS.critDmgReduce! }),
    eff: d({ eff: cur.eff + ROLL_NORMS.eff! }),
    effRes: d({ effRes: cur.effRes + ROLL_NORMS.effRes! }),
  };
}

/** Water-fill per-slot keep-counts so the product stays within `budget`. Process
 *  slots smallest-first: each gets a fair share `floor(remaining^(1/slotsLeft))`,
 *  and a slot smaller than its share is kept whole — its unused budget flows to
 *  the remaining (larger) slots. Guarantees `∏ keep ≤ budget` (each step divides
 *  the running budget by the count it just committed) while never trimming a
 *  slot that already fits. Returns counts aligned to the input order. */
export function allocateComboBudget(counts: number[], budget: number): number[] {
  const order = counts.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
  const keep = new Array<number>(counts.length).fill(0);
  let remaining = Math.max(1, budget);
  let slotsLeft = counts.length;
  for (const { c, i } of order) {
    const fair = Math.max(1, Math.floor(remaining ** (1 / slotsLeft)));
    const k = Math.max(1, Math.min(c, fair));
    keep[i] = k;
    remaining = Math.max(1, Math.floor(remaining / k));
    slotsLeft--;
  }
  return keep;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Phase 3 — CP-mode dominance prune
 * CP is monotone non-decreasing in every FinalStat, and every FinalStat is
 * monotone non-decreasing in each gear bucket entry (`composeMultStat` and the
 * additive stats only ever ADD the gear contribution). So if piece X's stat
 * contribution is ≥ piece Y's on every CP-relevant bucket axis (and > on one),
 * then for ANY fixed choice of the other slots `CP(build with X) ≥ CP(build
 * with Y)` — Y can never produce a higher-CP build than X. Drop the dominated
 * pieces before the cartesian (multiplicative combo-count cut, exact at the
 * top of the CP ranking; only weakly-worse near-duplicates leave the tail).
 * ───────────────────────────────────────────────────────────────────────── */

/** The bucket axes `finalStatsFromBuckets` actually reads — i.e. the only
 *  contributions that move a FinalStat (and thus CP). Dominance compares these
 *  ONLY: a difference on any other key can't change CP, so ignoring it both
 *  prevents dropping a CP-equal piece over an irrelevant stat and tightens the
 *  prune. `pct` and `buffPct` read the same rate keys. */
const CP_FLAT_KEYS = ["atk", "def", "hp", "spd", "eff", "effRes", "dmgUp", "dmgReduce", "pen", "critDmgReduce"] as const;
const CP_RATE_KEYS = ["atkPct", "defPct", "hpPct", "spd", "critRate", "critDmg", "eff", "effRes", "dmgUp", "dmgReduce", "pen", "critDmgReduce"] as const;

/** Does X's contribution dominate Y's — ≥ on every CP-relevant axis and > on at
 *  least one? Missing keys count as 0. A strict edge on a CP-relevant axis means
 *  `CP_X ≥ CP_Y` (≥, not >, because CP floors — a tie on rounding still leaves Y
 *  weakly worse, never better, so it's safely droppable). Pieces equal on every
 *  relevant axis are NOT dominated (strict stays false) → both kept. */
function bucketDominatesStrict(x: GearBuckets, y: GearBuckets): boolean {
  let strict = false;
  for (const k of CP_FLAT_KEYS) {
    const xv = x.flat[k] ?? 0, yv = y.flat[k] ?? 0;
    if (xv < yv) return false;
    if (xv > yv) strict = true;
  }
  for (const k of CP_RATE_KEYS) {
    const xv = x.pct[k] ?? 0, yv = y.pct[k] ?? 0;
    if (xv < yv) return false;
    if (xv > yv) strict = true;
  }
  for (const k of CP_RATE_KEYS) {
    const xv = x.buffPct[k] ?? 0, yv = y.buffPct[k] ?? 0;
    if (xv < yv) return false;
    if (xv > yv) strict = true;
  }
  return strict;
}

/** Drop pieces strictly dominated (per `bucketDominatesStrict`) by another in
 *  the SAME group of the slot. `groupKeyOf` partitions so incomparable pieces
 *  are never pitted: armor by `armorSetId` (set bonus + feasibility differ
 *  across sets), weapon/accessory by effect id (CP ignores effects, but a
 *  distinct effect is a distinct build the user may want, so we never elide the
 *  last piece of an effect). Pieces carry whatever stats the active reforge mode
 *  left them with (captured in "disable", ceiling-projected otherwise) — the
 *  caller prunes the post-projection pool, so the compared vector is exactly the
 *  one the solver composes. O(n²) per group — groups are small. Pure; exported
 *  for tests. */
export function pruneDominatedForCp(pieces: GearPiece[], groupKeyOf: (p: GearPiece) => string): GearPiece[] {
  if (pieces.length < 2) return pieces;
  const buckets = pieces.map((p) => aggregatePrefixBuckets([p]));
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pieces.length; i++) {
    const k = groupKeyOf(pieces[i]!);
    const arr = groups.get(k);
    if (arr) arr.push(i); else groups.set(k, [i]);
  }
  const dropped = new Set<number>();
  for (const idxs of groups.values()) {
    for (const yi of idxs) {
      if (dropped.has(yi)) continue;
      for (const xi of idxs) {
        if (xi === yi || dropped.has(xi)) continue;
        // A dropped xi is itself dominated by a surviving piece that
        // (transitively) also dominates yi, so skipping it loses no kill.
        if (bucketDominatesStrict(buckets[xi]!, buckets[yi]!)) { dropped.add(yi); break; }
      }
    }
  }
  if (dropped.size === 0) return pieces;
  return pieces.filter((_, i) => !dropped.has(i));
}

/* ─────────────────────────────────────────────────────────────────────────
 * Phase 4-6 — solveChunk
 * Cartesian enumeration over the chunk-partitioned first slot, with
 * incremental set tracking for branch-and-prune. Each surviving combo runs
 * the gem sub-solver, composes finalStats, computes ratings, applies
 * stat/rating filters, and pushes into a fixed-size top-K min-heap.
 * ───────────────────────────────────────────────────────────────────────── */

/** Sentinel used by the heap key: SOLVE → score, SOLVE CP → cp. Computed
 *  for the top-K only in SOLVE CP mode (sort key); SOLVE mode defers CP
 *  to finalizeBuilds. */
function heapKey(b: SolveBuild, mode: SolveMode): number {
  return mode === "cp" ? (b.cp ?? -Infinity) : b.score;
}

/** Fixed-capacity min-heap keyed by `heapKey`. push() drops the smallest
 *  element when full. Exported so the regression tests can hit it directly
 *  without spinning the whole engine; the solver still uses it internally. */
export class TopKHeap {
  private a: SolveBuild[] = [];
  constructor(private k: number, private mode: SolveMode) {}
  push(b: SolveBuild): void {
    if (this.a.length < this.k) {
      this.a.push(b);
      this.up(this.a.length - 1);
    } else {
      // Only displace the min if the new entry beats it.
      const min = this.a[0]!;
      if (heapKey(b, this.mode) > heapKey(min, this.mode)) {
        this.a[0] = b;
        this.down(0);
      }
    }
  }
  toSorted(): SolveBuild[] {
    return this.a.slice().sort((x, y) => heapKey(y, this.mode) - heapKey(x, this.mode));
  }
  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey(this.a[i]!, this.mode) < heapKey(this.a[p]!, this.mode)) {
        [this.a[i], this.a[p]] = [this.a[p]!, this.a[i]!];
        i = p;
      } else break;
    }
  }
  private down(i: number): void {
    const n = this.a.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < n && heapKey(this.a[l]!, this.mode) < heapKey(this.a[m]!, this.mode)) m = l;
      if (r < n && heapKey(this.a[r]!, this.mode) < heapKey(this.a[m]!, this.mode)) m = r;
      if (m === i) break;
      [this.a[i], this.a[m]] = [this.a[m]!, this.a[i]!];
      i = m;
    }
  }
}

export interface SolveChunkResult {
  builds: SolveBuild[];
  permutations: number;
  searched: number;
}

/** Shared zero-ratings placeholder for the SOLVE-CP deferred-ratings path.
 *  Never inspected (the defer flag guarantees no rating-keyed filter reads it)
 *  and overwritten by `finalizeBuilds` for the top-N, so a single shared frozen
 *  instance is safe across every combo. */
const PLACEHOLDER_RATINGS: CheapRatings = Object.freeze({
  hps: 0, ehp: 0, ehps: 0, dmg: 0, dmgs: 0, mcd: 0, mcds: 0, dmgh: 0,
});

export interface SolveChunkOptions {
  /** Called whenever a combo is visited (before any pruning). Returns
   *  `false` to abort the loop (e.g. cancelled by the orchestrator). */
  shouldContinue?: () => boolean;
  /** Called whenever counters meaningfully change for progress reporting.
   *  The worker debounces this into ~100ms postMessage cadence. */
  onTick?: (permutations: number, searched: number) => void;
  /** Optional yield-to-event-loop hook. Without it, `solveChunk` runs
   *  fully synchronously and the worker's `cancel` message stays queued
   *  until the loop completes (mid-solve cancel doesn't interrupt).
   *  Workers pass a MessageChannel-based yield (~0.1ms per yield) so the
   *  message queue drains at every tick boundary. After awaiting, the
   *  tick re-checks `shouldContinue` to honor a cancel that arrived
   *  during the drain. */
  yieldToEvents?: () => Promise<void>;
  /** Per-N permutations to invoke onTick / shouldContinue / yield. */
  tickEvery?: number;
}

/** Enumerate the chunk-partitioned cartesian, scoring + filtering each
 *  surviving combo into the top-K heap. Async to allow periodic yielding
 *  to the worker's event loop — without that, the synchronous loop would
 *  block message processing and Cancel wouldn't fire until the chunk
 *  completes. */
export async function solveChunk(
  ctx: SolveContext,
  chunkIndex: number,
  chunkCount: number,
  topK: number,
  options: SolveChunkOptions = {},
): Promise<SolveChunkResult> {
  const { req, pools, baseline, scaling, ee, gemDeltaByTalismanSlots, gemAllocByTalismanSlots,
          scoredGems, setPlans, allowBrokenSets, skills, starMeta, dmgStat, dmgSec, noCrit } = ctx;
  // EE gem-slot count is constant per solve (same EE piece across every combo).
  const eeSlots = gemSlotsOf(ee);
  const { mode, filters, game } = req;
  const heap = new TopKHeap(topK, mode);
  const tickEvery = options.tickEvery ?? 4096;

  // Crit-cap gem strategy: when the user prioritized critRate AND the pool holds
  // crit gems, the per-combo allocation REACHES the 100% CHC cap first (crit
  // gems), then fills by priority. Gated here once per solve so non-crit
  // builds never enter the slow path. `critRate` is the canonical priority key
  // (post stat-key unification — priority/FinalStats share the engine names).
  const hasCritGems = scoredGems.some((g) => g.stat === "critRate" && g.score > 0);
  const wantCritCap = (filters.priority.critRate ?? 0) > 0 && hasCritGems;

  // Partition the slot with the largest pool — best load balance.
  const partitionSlot = pickPartitionSlot(pools);
  const partitioned = partition(pools[partitionSlot], chunkIndex, chunkCount);

  // Precompute "other slots" we'll iterate inside the partition — same
  // pools regardless of chunk. Typed as the same shape as `pools` so the
  // index-access keeps narrow types.
  const slotPools: SolveContext["pools"] = {
    weapon: pools.weapon,
    helmet: pools.helmet,
    armor: pools.armor,
    gloves: pools.gloves,
    boots: pools.boots,
    accessory: pools.accessory,
    ooparts: pools.ooparts,
  };
  slotPools[partitionSlot] = partitioned;

  // Set counts incrementally tracked as we descend the armor slots.
  const setCount = new Map<string, number>();

  // Hoist the `pieces` array — same slot order every combo, mutated in
  // place to avoid 10M+ allocations through the inner loop. Length is
  // fixed (7 without EE, 8 with) and EE sits at index 7 forever.
  const piecesLen = ee ? 8 : 7;
  const pieces: GearPiece[] = new Array(piecesLen);
  if (ee) pieces[7] = ee;

  // Pre-extracted rating-filter specs (avoid `for...in` on `filters.ratingFilters`
  // per combo — typically 0-3 specs).
  const statFilterSpecs = compileFilterSpecs(filters.statFilters);
  const ratingFilterSpecs = compileFilterSpecs(filters.ratingFilters);
  // CP filter is separate so we can skip it cheaply in SOLVE mode when no CP
  // filter is set (CP is null there until finalize). When a CP filter IS set
  // we apply it in the loop even in score mode (see the hot-loop note): a
  // filter deferred to finalize evicts valid builds that ranked just outside
  // the top-K-by-score heap, silently under-returning the result set.
  const cpFilter = filters.ratingFilters.cp;
  // In SOLVE CP the heap orders by CP, not by the cheap ratings, so the ratings
  // are only needed for the top-N display + any rating-BAND filter. When no
  // rating-band filter is set (score-only specs don't count — Score derives
  // from FinalStats, not the ratings), defer the 8 ratings products to
  // `finalizeBuilds` (top-N only), mirroring how SOLVE defers CP. Removes the
  // per-combo ratings pass across millions of CP combos.
  const deferRatings = mode === "cp" && !ratingFilterSpecs.some((sp) => sp.key !== "score");
  // CP hot-loop evaluator — captures the constant star/skill/EE/fusion bonuses
  // ONCE so each combo's CP is just the stat-dependent math (no per-combo
  // `CpArgs` allocation, no constant re-derivation). Bit-identical to
  // `calcBattlePower` (see cp.ts `makeCpEvaluator`).
  const cpEval = makeCpEvaluator({
    showUIStar: starMeta.showUIStar,
    starPlus: starMeta.starPlus,
    skills,
    ee,
    fused: starMeta.fused,
  });
  // Upg filter has the same recall hazard: it can't be a hot-loop FilterSpec
  // (it needs the hero's current loadout), but deferring it to finalize drops
  // heap survivors a posteriori, evicting valid builds that ranked just
  // outside top-K. So when an upg filter is set we resolve the equipped set
  // up front and apply the filter IN the loop, before the build competes for
  // a heap slot.
  const upgFilter = filters.ratingFilters.upg;
  const equippedUids = new Set<string>();
  if (upgFilter) {
    for (const g of req.inventory.gear) {
      if (g.equippedBy === req.heroUid) equippedUids.add(g.uid);
    }
  }

  // Required-set feasibility at each armor depth — used for mid-tree prune.
  // At depth D (D armor slots iterated), remaining = 4 - D. The subtree is
  // pruned only when NO plan is still reachable (OR semantics). At remaining 0
  // (boots leaf) this is exactly the build-valid test (a plan needing 0 more
  // pieces is fully satisfied). See setPlans.ts `setsFeasible`.
  const checkSetsFeasible = (remainingSlots: number): boolean => {
    if (!setsFeasible(setPlans, setCount, remainingSlots)) return false;
    // "No broken sets" is a leaf-only constraint: a singleton at mid-depth may
    // still pair up in a later armor slot, so we only reject the complete
    // 4-armor loadout (remainingSlots === 0) where the tally is final.
    if (!allowBrokenSets && remainingSlots === 0 && !allSetsComplete(setCount)) return false;
    return true;
  };

  let permutations = 0;
  let searched = 0;
  let aborted = false;

  const tick = async (): Promise<boolean> => {
    options.onTick?.(permutations, searched);
    if (options.shouldContinue && !options.shouldContinue()) {
      aborted = true;
      return false;
    }
    if (options.yieldToEvents) {
      await options.yieldToEvents();
      // Re-check after the drain — cancel may have fired during the yield.
      if (options.shouldContinue && !options.shouldContinue()) {
        aborted = true;
        return false;
      }
    }
    return true;
  };

  for (const weapon of slotPools.weapon) {
    if (aborted) break;
    pieces[0] = weapon;
    for (const helmet of slotPools.helmet) {
      if (aborted) break;
      if (helmet.armorSetId) incSet(setCount, helmet.armorSetId);
      // After helmet (depth 1): 3 armor slots remaining.
      if (!checkSetsFeasible(3)) {
        if (helmet.armorSetId) decSet(setCount, helmet.armorSetId);
        continue;
      }
      pieces[1] = helmet;
      for (const armor of slotPools.armor) {
        if (aborted) break;
        if (armor.armorSetId) incSet(setCount, armor.armorSetId);
        if (!checkSetsFeasible(2)) {
          if (armor.armorSetId) decSet(setCount, armor.armorSetId);
          continue;
        }
        pieces[2] = armor;
        for (const gloves of slotPools.gloves) {
          if (aborted) break;
          if (gloves.armorSetId) incSet(setCount, gloves.armorSetId);
          if (!checkSetsFeasible(1)) {
            if (gloves.armorSetId) decSet(setCount, gloves.armorSetId);
            continue;
          }
          pieces[3] = gloves;
          for (const boots of slotPools.boots) {
            if (aborted) break;
            if (boots.armorSetId) incSet(setCount, boots.armorSetId);
            if (!checkSetsFeasible(0)) {
              if (boots.armorSetId) decSet(setCount, boots.armorSetId);
              continue;
            }
            pieces[4] = boots;
            for (const accessory of slotPools.accessory) {
              if (aborted) break;
              pieces[5] = accessory;
              // Set bonuses depend only on the armor pieces' `armorSetId`
              // (weapon/accessory/talisman/EE never carry one), so they're
              // invariant across the talisman loop. Compute them ONCE here
              // (all relevant pieces are now set) instead of rebuilding the
              // map inside every per-talisman compose. Bit-identical to the
              // in-loop recompute — same pieces, same output order.
              const setBonuses = computeSetBonuses(pieces, game?.sets ?? null);
              // Prefix buckets — the 6 invariant pieces (weapon..accessory) are
              // fixed across the talisman loop, so aggregate them ONCE here
              // instead of re-summing all 6 (+EE) per talisman. The talisman
              // loop clones this and tops up with talisman + EE + gems + sets,
              // in the exact slot order, so the compose stays bit-identical
              // (see `computeFinalStatsFromPrefix`).
              const prefixBuckets = aggregatePrefixBuckets(pieces.slice(0, 6));
              for (const talisman of slotPools.ooparts) {
                permutations++;
                if (permutations % tickEvery === 0 && !(await tick())) break;
                pieces[6] = talisman;

                // Pre-aggregated gem delta lookup — O(1), no per-combo
                // gem resolve. `null` delta = no priority set → no override,
                // talisman+EE pieces contribute their currently-socketed
                // gems via their `subs` (correct in-game-equivalent stats).
                const talismanSlots = talisman.enhanceLevel >= 5 ? 5 : 4;
                const gemDelta = gemDeltaByTalismanSlots.get(talismanSlots) ?? null;
                let gemAlloc = gemAllocByTalismanSlots.get(talismanSlots) ?? { talisman: [], ee: [] };
                let fs = computeFinalStatsFromPrefix(baseline, scaling, prefixBuckets, talisman, ee, gemDelta ?? undefined, setBonuses);

                // Gem cap handling (slow path). The precomputed default delta is
                // CHC-blind, so it neither guarantees the crit cap nor avoids
                // overshooting it. The pre-gem CHC for THIS combo is recoverable
                // from the composed CHC minus the default gem crc contribution
                // (crit rate is purely additive — no scaling compounding).
                const defaultCrcGem = gemDelta?.pct?.critRate ?? 0;
                if (wantCritCap) {
                  // User prioritized crc → REACH the 100% cap with crit gems
                  // first, then fill the rest by priority. Recompose only when
                  // the cap-aware allocation actually differs from the default
                  // greedy (it often won't, when crit gems already rank high).
                  const preGemCrc = fs.critRate - defaultCrcGem;
                  const reached = allocateGemsReachingCap(scoredGems, talismanSlots, eeSlots, preGemCrc);
                  if (!gemDeltaEquals(reached.delta, gemDelta)) {
                    fs = computeFinalStatsFromPrefix(baseline, scaling, prefixBuckets, talisman, ee, reached.delta ?? undefined, setBonuses);
                    gemAlloc = reached.alloc;
                  }
                } else if (fs.critRate > CRC_OVERSHOOT_CEIL && defaultCrcGem > 0) {
                  // No crc priority (e.g. SOLVE CP raw-gem fallback): just avoid
                  // overshoot. `fs.critRate > 102` ⟺ ≥1 crit gem landed past the cap;
                  // reallocate this combo's pre-gem CHC so wasted crit gems
                  // become useful non-crit ones. Untriggered combos pay nothing.
                  const capped = allocateGemsCapped(scoredGems, talismanSlots, eeSlots, fs.critRate - defaultCrcGem);
                  fs = computeFinalStatsFromPrefix(baseline, scaling, prefixBuckets, talisman, ee, capped.delta ?? undefined, setBonuses);
                  gemAlloc = capped.alloc;
                }

                if (!passesSpecs(fs, statFilterSpecs)) continue;

                // Ratings deferred in SOLVE CP with no rating-band filter — the
                // placeholder rides the heap and `finalizeBuilds` computes the
                // real ratings for the top-N only. `passesRatingSpecs` only ever
                // reads `score` here when deferred (the defer flag guarantees no
                // rating-keyed spec), so the zero placeholder is never inspected.
                const ratings = deferRatings ? PLACEHOLDER_RATINGS : computeCheapRatings(fs, dmgStat, dmgSec, noCrit);
                const score = computeScore(fs, filters.priority);

                if (!passesRatingSpecs(ratings, score, ratingFilterSpecs)) continue;

                // CP: hot-path in SOLVE CP (it's the sort key). In SOLVE mode
                // it's normally deferred to finalize (only needed for the
                // top-N display), BUT when a CP filter is active we must
                // compute + apply it here — deferring the filter to finalize
                // would let the heap fill with top-K-by-score builds and then
                // drop the ones failing CP, evicting CP-passing builds that
                // ranked just outside top-K (recall loss / under-return).
                let cp: number | null = null;
                if (mode === "cp" || cpFilter) {
                  cp = cpEval(fs, talisman);
                  if (cpFilter && !inMinMax(cp, cpFilter)) continue;
                }

                // Upg filter applied in-loop (see equippedUids note above) so
                // the heap only holds builds that satisfy it — finalize still
                // recomputes upg for display, but the constraint is enforced
                // here so valid builds aren't evicted by soon-to-be-dropped
                // higher-ranked ones.
                if (upgFilter) {
                  let upg = 0;
                  for (let i = 0; i < piecesLen; i++) {
                    if (!equippedUids.has(pieces[i]!.uid)) upg++;
                  }
                  if (!inMinMax(upg, upgFilter)) continue;
                }

                searched++;
                // Snapshot pieces UIDs into a fresh array — heap holds the
                // survivor and we can't keep mutating `pieces` shared ref.
                const pieceUids = ee
                  ? [pieces[0]!.uid, pieces[1]!.uid, pieces[2]!.uid, pieces[3]!.uid,
                     pieces[4]!.uid, pieces[5]!.uid, ee.uid, pieces[6]!.uid]
                  : [pieces[0]!.uid, pieces[1]!.uid, pieces[2]!.uid, pieces[3]!.uid,
                     pieces[4]!.uid, pieces[5]!.uid, pieces[6]!.uid];
                heap.push({
                  pieceUids,
                  gemAllocation: gemAlloc,
                  finalStats: fs,
                  ratings,
                  score,
                  cp,
                  upg: 0, // filled by finalizeBuilds (after top-N selection)
                });
              }
            }
            if (boots.armorSetId) decSet(setCount, boots.armorSetId);
          }
          if (gloves.armorSetId) decSet(setCount, gloves.armorSetId);
        }
        if (armor.armorSetId) decSet(setCount, armor.armorSetId);
      }
      if (helmet.armorSetId) decSet(setCount, helmet.armorSetId);
    }
  }

  // Final tick so the orchestrator sees the last increments.
  options.onTick?.(permutations, searched);
  return { builds: heap.toSorted(), permutations, searched };
}

/** Post-process the top-K from `solveChunk`:
 *  - SOLVE mode, no CP filter : compute CP for each surviving build for the
 *    UI's CP column (skipped in the hot loop for cost). When a CP filter IS
 *    active the build already carries its CP (computed + filtered in-loop),
 *    so the re-check below is an idempotent no-op.
 *  - All modes : compute `upg` (slot swap count vs current loadout) for
 *    display — the upg filter, when set, is already enforced in-loop, so the
 *    re-check is likewise a no-op (the recall hazard of an a-posteriori CP/upg
 *    filter is handled by enforcing both in `solveChunk`, not here). */
export function finalizeBuilds(ctx: SolveContext, builds: SolveBuild[], mode: SolveMode): SolveBuild[] {
  const { req, ee, skills, starMeta, dmgStat, dmgSec, noCrit } = ctx;
  const byUid = new Map<string, GearPiece>();
  for (const g of req.inventory.gear) byUid.set(g.uid, g);
  // SOLVE CP deferred the cheap ratings (heap orders by CP, ratings only feed
  // the display), so compute the real ratings here for the surviving top-N.
  // Mirror the exact defer condition from `solveChunk` (no rating-band filter).
  const ratingsDeferred =
    mode === "cp" && !compileFilterSpecs(req.filters.ratingFilters).some((sp) => sp.key !== "score");
  // Hero's currently-equipped piece UIDs — denominator for the upgrade-count
  // metric. Fresh-roster heroes will see all 8 slots count as "new".
  const equippedUids = new Set<string>();
  for (const g of req.inventory.gear) {
    if (g.equippedBy === req.heroUid) equippedUids.add(g.uid);
  }
  // CP and upg both compiled out of the hot-loop FilterSpecs — they can't
  // be applied during enumeration (cp is null in SOLVE mode, upg needs the
  // hero's current loadout). We apply them here once we have both values.
  const cpFilter = req.filters.ratingFilters.cp;
  const upgFilter = req.filters.ratingFilters.upg;
  const out: SolveBuild[] = [];
  for (const b of builds) {
    let cp = b.cp;
    if (cp == null && mode !== "cp") {
      // Talisman is always last in `pieceUids` (engine writes it there).
      const talisman = byUid.get(b.pieceUids[b.pieceUids.length - 1] ?? "") ?? null;
      cp = calcBattlePower({
        stats: b.finalStats,
        showUIStar: starMeta.showUIStar,
        starPlus: starMeta.starPlus,
        skills,
        ee,
        ooparts: talisman,
        fused: starMeta.fused,
      });
    }
    if (cp != null && cpFilter && !inMinMax(cp, cpFilter)) continue;
    let upg = 0;
    for (let i = 0; i < b.pieceUids.length; i++) {
      if (!equippedUids.has(b.pieceUids[i]!)) upg++;
    }
    if (upgFilter && !inMinMax(upg, upgFilter)) continue;
    const ratings = ratingsDeferred ? computeCheapRatings(b.finalStats, dmgStat, dmgSec, noCrit) : b.ratings;
    out.push({ ...b, cp, upg, ratings });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers — set tracking, partitioning, filter predicates
 * ───────────────────────────────────────────────────────────────────────── */

function incSet(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}
function decSet(map: Map<string, number>, id: string): void {
  const n = (map.get(id) ?? 1) - 1;
  if (n <= 0) map.delete(id);
  else map.set(id, n);
}

/** Choose the slot to partition across workers — the largest pool gives
 *  the best load balance (each worker gets ⌈N/W⌉ items, all subsequent
 *  loops the same). Defaults to weapon when the pools are uniform. */
function pickPartitionSlot(pools: SolveContext["pools"]): keyof SolveContext["pools"] {
  let best: keyof SolveContext["pools"] = "weapon";
  let max = pools.weapon.length;
  for (const k of ["helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const) {
    if (pools[k].length > max) { best = k; max = pools[k].length; }
  }
  return best;
}

/** Even slice: chunk i out of N takes indices [floor(i*L/N), floor((i+1)*L/N)). */
function partition<T>(items: T[], idx: number, count: number): T[] {
  const n = items.length;
  const start = Math.floor(idx * n / count);
  const end = Math.floor((idx + 1) * n / count);
  return items.slice(start, end);
}

/** Compiled filter spec — flat array form so the hot path iterates without
 *  `for...in` or object property lookups. Only entries with at least one
 *  bound survive — empty ranges (no min, no max) are dropped at compile. */
interface FilterSpec {
  key: string;
  min: number;
  max: number;
}

function compileFilterSpecs(filters: Record<string, { min?: number; max?: number }>): FilterSpec[] {
  const out: FilterSpec[] = [];
  for (const key in filters) {
    const f = filters[key];
    if (!f) continue;
    const hasMin = f.min != null;
    const hasMax = f.max != null;
    if (!hasMin && !hasMax) continue;
    // CP and upg are handled separately by the caller — `cp` because it's
    // only available in SOLVE CP mode or at finalize, `upg` because it's
    // informational only (not a real solver-time filter).
    if (key === "cp" || key === "upg") continue;
    out.push({ key, min: hasMin ? f.min! : -Infinity, max: hasMax ? f.max! : Infinity });
  }
  return out;
}

/** A compiled filter key that resolves to no field on FinalStats / ratings is
 *  a silent no-op — the UI and engine key sets have drifted (e.g. UI emits
 *  `critRate` while FinalStats exposes `crc`). Warn ONCE per key so a real
 *  mismatch surfaces in the console instead of "the filter just does nothing".
 *  Guarded by the Set so the hot loop never pays for a known key. */
const warnedFilterKeys = new Set<string>();
function warnUnknownFilterKey(key: string, kind: "stat" | "rating"): void {
  if (warnedFilterKeys.has(key)) return;
  warnedFilterKeys.add(key);
  console.warn(`[solver] unknown ${kind} filter key "${key}" — filter ignored (UI/engine key mismatch?)`);
}

function passesSpecs(fs: FinalStats, specs: FilterSpec[]): boolean {
  if (specs.length === 0) return true;
  const fsRec = fs as unknown as Record<string, number>;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const v = fsRec[s.key];
    if (typeof v !== "number") { warnUnknownFilterKey(s.key, "stat"); continue; }
    if (v < s.min || v > s.max) return false;
  }
  return true;
}

function passesRatingSpecs(ratings: CheapRatings, score: number, specs: FilterSpec[]): boolean {
  if (specs.length === 0) return true;
  const rRec = ratings as unknown as Record<string, number>;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const v = s.key === "score" ? score : rRec[s.key];
    if (v == null) { warnUnknownFilterKey(s.key, "rating"); continue; }
    if (v < s.min || v > s.max) return false;
  }
  return true;
}

/** Shared `min ≤ v ≤ max` predicate for the CP and upg filters which are
 *  applied at finalize-time (not via the in-loop FilterSpec path). */
function inMinMax(v: number, f: { min?: number; max?: number } | undefined): boolean {
  if (!f) return true;
  if (f.min != null && v < f.min) return false;
  if (f.max != null && v > f.max) return false;
  return true;
}
