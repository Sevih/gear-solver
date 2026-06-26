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
  computeFinalStats,
  computeSetBonuses,
  type FinalStats,
  type FinalStatsBaseline,
  type GemOverride,
  type ScalingMap,
} from "../composeBuild.js";
import { calcBattlePower } from "./cp.js";
import { aggregateGemDelta, allocateGems, allocateGemsCapped, allocateGemsReachingCap, buildGemPool, CRC_OVERSHOOT_CEIL, gemDeltaEquals, gemSlotsOf, scoreGemPool, type ScoredGem } from "./gems.js";
import { computeCheapRatings, computeScore, ROLL_NORMS, STAT_TO_PRIORITY, type CheapRatings } from "./ratings.js";
import type { PoolSizes, SetPlan, SolveBuild, SolveMode, SolveRequest } from "./types.js";
import { planSetIds, setsFeasible } from "./setPlans.js";
import { gearPieceQualityTier, QUALITY_TIERS, type QualityTier } from "../quality.js";

/** Map engine GearSlot → design SlotId used by the BuilderScreen's
 *  mainPicks / effect chip maps. Only `ooparts` differs (UI calls it
 *  Talisman); the rest are 1:1. */
function engineToDesign(slot: string): string {
  return slot === "ooparts" ? "talisman" : slot;
}

/** Reforge-mode preview: how aggressively to project each pool piece toward
 *  an endgame ceiling before scoring. `disable` keeps pieces as captured;
 *  `classic` / `ascended` project main stats + substat reforge ticks to the
 *  6★ non-ascended (+10, 6 ticks) / 6★ ascended (+15, 9 ticks) endgame. */
export type ReforgeMode = "disable" | "classic" | "ascended";

/** Per-mode projection plan — the enhance ceiling fed to `projectMainToCeiling`
 *  (main-stat re-scale) and the fixed reforge budget fed to `simulateReforges`
 *  (substat ticks). Budgets are fixed (not derived from the piece's real star)
 *  so every piece is previewed as a maxed 6★. */
const REFORGE_PLANS: Record<Exclude<ReforgeMode, "disable">, { ceiling: ReforgeCeiling; budget: number }> = {
  classic:  { ceiling: { enhanceLevel: 10, ascended: false, singularityLevel: 0 }, budget: 6 },
  ascended: { ceiling: { enhanceLevel: 15, ascended: true,  singularityLevel: 5 }, budget: 9 },
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
  return simulateReforges(projectMainToCeiling(piece, game, plan.ceiling), priority, plan.budget);
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
  dmgSec?: ReadonlyArray<{ stat: "atk" | "def" | "hp"; ratio: number }>;
  /** Set requirements as an OR-list of AND-plans. Used for branch-and-prune
   *  in the armor cartesian (feasible = at least one plan still reachable). */
  setPlans: SetPlan[];
  excludedSets: Set<string>;
  /** Required-effect icons per slot — when set, the slot's pool was already
   *  filtered to those icons in `buildPool`, but we still need the
   *  excluded set for tertiary checks. */
  excludedWeaponEffects: Set<string>;
  excludedAccessoryEffects: Set<string>;
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

  // Per-slot filter helper. Returns true if the piece is allowed in this slot.
  const allow = (g: GearPiece, slot: string): boolean => {
    if (g.slot !== slot) return false;
    if (!filters.options.includeEquippedOnOthers && g.equippedBy && g.equippedBy !== heroUid) return false;
    // Exempt the selected hero from the excluded-heroes check — the picker
    // lists every character so the user CAN tick himself, but doing so would
    // drop his own currently-equipped gear from the pool (contradicts the
    // documented invariant "selected hero's own gear is always in"). The
    // gem pool gets the same exemption via its own `heroUid` opt.
    if (g.equippedBy && g.equippedBy !== heroUid && excludedSet.has(g.equippedBy)) return false;
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
  const grabRespectingKeep = (slot: string): GearPiece[] => {
    if (!filters.options.keepCurrent) return grab(slot);
    const cur = inv.gear.find((g) => g.slot === slot && g.equippedBy === heroUid);
    return cur ? [cur] : grab(slot);
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

  // Reforge simulation — if the user toggled "Use reforged stats", clone
  // each piece with its remaining reforge attempts greedily allocated to
  // the highest-priority substats. Happens BEFORE topPctPrune so the prune
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

  // Top-% per-slot prune. Only meaningful when the user set a non-zero
  // priority on at least one stat — otherwise every piece scores 0 and the
  // prune is arbitrary (we skip in that case).
  //
  // Required-set protection: pieces belonging to a `req-2pc` / `req-4pc`
  // set are never elided by the prune, regardless of priority score. Without
  // this guard, a low-priority-scoring piece could be dropped from the pool
  // and `checkSetsFeasible` would silently return 0 results (the user sees
  // "no builds" without a clue why). The protected pieces survive on top of
  // the regular top-% selection, so the effective pool size may exceed
  // ceil(N × pct/100) by the count of protected pieces — intentional.
  const hasPriority = Object.values(filters.priority).some((v) => v !== 0);
  if (hasPriority && filters.topPct < 100) {
    const requiredSetIds = planSetIds(setPlans);
    for (const slot of ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const) {
      pools[slot] = topPctPrunePreserving(pools[slot], filters.priority, filters.topPct, requiredSetIds);
    }
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
  // SOLVE CP mode opts out of that fallback (`allowZeroPriority`) and
  // ranks gems by raw `value / norm` instead — "maximize CP" implies
  // "use the best gems available"; preserving currently-socketed gems
  // would silently disable gem optimization for the typical CP usage
  // (user clicks SOLVE CP without touching the priority panel, expects
  // the solver to recommend the strongest gems for the new build).
  // Gem pool eligibility mirrors `allow()` for pieces: gear on other heroes
  // only counts when `includeEquippedOnOthers` is on, and excluded heroes
  // are skipped outright. Otherwise the solver could recommend gems that
  // require unequipping a Talisman/EE on a hero the user just opted out of.
  const gemPool = buildGemPool(inv, {
    heroUid,
    includeEquippedOnOthers: filters.options.includeEquippedOnOthers,
    excludedHeroes: excludedSet,
  });
  const scoredGems = scoreGemPool(gemPool, filters.priority, game, {
    allowZeroPriority: req.mode === "cp",
  });
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

  // Star metadata + skills for CP.
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
    setPlans,
    excludedSets,
    excludedWeaponEffects,
    excludedAccessoryEffects,
  };
}

/** Per-substat tick cap for the reforge simulator. Observed max in real
 *  captures is LV6 (`ticks: 6`), beyond which the in-game reforge UI no
 *  longer accepts ticks. Conservative cap — keeps the predicted stat sheet
 *  within reachable in-game bounds. */
const REFORGE_PER_SUB_CAP = 6;

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
  // In-game reforge budget: N reforges for 1★→6★ pieces. A 6★ ascended
  // (Singularity) piece gets an additional +3 reforges → 9 total (the +3
  // is exclusive to 6★ Singularity items; lower-star ascended doesn't exist
  // since ascension is a 6★-only mechanic in this build).
  //
  // `maxReforgesOverride` lets the reforge-mode preview impose a fixed
  // endgame budget regardless of the piece's actual star (classic = 6,
  // ascended = 9) — "project every piece as if it were max-star 6★".
  const star = piece.star ?? 0;
  const maxReforges = maxReforgesOverride ?? ((star === 6 && piece.ascended) ? star + 3 : star);
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
  return { ...piece, subs };
}

/** Score each piece in isolation, sort desc, keep the top `ceil(N × pct/100)`.
 *  Score = Σ over piece's rolls of `priority × (value / ROLL_NORMS)`.
 *  Normalization uses `ROLL_NORMS` (per-roll magnitude, e.g. flat atk≈300,
 *  atkPct≈40, crc≈20) NOT `STAT_NORMS` (endgame final magnitude). The two
 *  scoring contexts (per-roll vs final stat) have completely different
 *  scales — using STAT_NORMS here would rank percent rolls 100× too low.
 *
 *  Rolls carry engine keys (`atkPct`, `critRate`, …) while `priority` is
 *  keyed by user keys (`atk`, `crc`, …) — `STAT_TO_PRIORITY` bridges. */
function topPctPrune(pieces: GearPiece[], priority: Record<string, number>, pct: number): GearPiece[] {
  if (pieces.length === 0) return pieces;
  const scored = pieces.map((p) => {
    let s = 0;
    for (const r of p.subs) {
      const pk = STAT_TO_PRIORITY[r.stat] ?? r.stat;
      const w = priority[pk] ?? 0;
      if (w) s += w * r.value / (ROLL_NORMS[r.stat] ?? 100);
    }
    for (const r of p.main) {
      if (r.combatOnly) continue;
      const pk = STAT_TO_PRIORITY[r.stat] ?? r.stat;
      const w = priority[pk] ?? 0;
      if (w) s += w * r.value / (ROLL_NORMS[r.stat] ?? 100);
    }
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const keep = Math.max(1, Math.ceil(pieces.length * pct / 100));
  return scored.slice(0, keep).map((e) => e.p);
}

/** Variant of `topPctPrune` that always keeps pieces belonging to a required
 *  set, even when their priority score doesn't make the top-%. Without this,
 *  a `req-4pc` set with low-priority-scoring members would be pruned out and
 *  `checkSetsFeasible` would silently kill every combo. The protected pieces
 *  are added on top of the regular top-% slice (deduped), so the kept pool
 *  may be slightly larger than `ceil(N × pct/100)`. */
function topPctPrunePreserving(
  pieces: GearPiece[],
  priority: Record<string, number>,
  pct: number,
  requiredSetIds: Set<string>,
): GearPiece[] {
  if (pieces.length === 0 || requiredSetIds.size === 0) {
    return topPctPrune(pieces, priority, pct);
  }
  const kept = topPctPrune(pieces, priority, pct);
  const keptUids = new Set(kept.map((p) => p.uid));
  for (const p of pieces) {
    if (p.armorSetId && requiredSetIds.has(p.armorSetId) && !keptUids.has(p.uid)) {
      kept.push(p);
      keptUids.add(p.uid);
    }
  }
  return kept;
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
          scoredGems, setPlans, skills, starMeta, dmgStat, dmgSec } = ctx;
  // EE gem-slot count is constant per solve (same EE piece across every combo).
  const eeSlots = gemSlotsOf(ee);
  const { mode, filters, game } = req;
  const heap = new TopKHeap(topK, mode);
  const tickEvery = options.tickEvery ?? 4096;

  // Crit-cap gem strategy: when the user prioritized crc AND the pool holds
  // crit gems, the per-combo allocation REACHES the 100% CHC cap first (crit
  // gems), then fills by priority. Gated here once per solve so non-crit
  // builds never enter the slow path. `crc` is the user-facing priority key
  // (engine `critRate` maps to it via STAT_TO_PRIORITY).
  const hasCritGems = scoredGems.some((g) => g.stat === "critRate" && g.score > 0);
  const wantCritCap = (filters.priority.crc ?? 0) > 0 && hasCritGems;

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
  const checkSetsFeasible = (remainingSlots: number): boolean =>
    setsFeasible(setPlans, setCount, remainingSlots);

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
                let fs = computeFinalStats(baseline, scaling, pieces, game, gemDelta ?? undefined, setBonuses);

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
                  const preGemCrc = fs.crc - defaultCrcGem;
                  const reached = allocateGemsReachingCap(scoredGems, talismanSlots, eeSlots, preGemCrc);
                  if (!gemDeltaEquals(reached.delta, gemDelta)) {
                    fs = computeFinalStats(baseline, scaling, pieces, game, reached.delta ?? undefined, setBonuses);
                    gemAlloc = reached.alloc;
                  }
                } else if (fs.crc > CRC_OVERSHOOT_CEIL && defaultCrcGem > 0) {
                  // No crc priority (e.g. SOLVE CP raw-gem fallback): just avoid
                  // overshoot. `fs.crc > 102` ⟺ ≥1 crit gem landed past the cap;
                  // reallocate this combo's pre-gem CHC so wasted crit gems
                  // become useful non-crit ones. Untriggered combos pay nothing.
                  const capped = allocateGemsCapped(scoredGems, talismanSlots, eeSlots, fs.crc - defaultCrcGem);
                  fs = computeFinalStats(baseline, scaling, pieces, game, capped.delta ?? undefined, setBonuses);
                  gemAlloc = capped.alloc;
                }

                if (!passesSpecs(fs, statFilterSpecs)) continue;

                const ratings = computeCheapRatings(fs, dmgStat, dmgSec);
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
                  cp = calcBattlePower({
                    stats: fs,
                    showUIStar: starMeta.showUIStar,
                    starPlus: starMeta.starPlus,
                    skills,
                    ee,
                    ooparts: talisman,
                    fused: starMeta.fused,
                  });
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
  const { req, ee, skills, starMeta } = ctx;
  const byUid = new Map<string, GearPiece>();
  for (const g of req.inventory.gear) byUid.set(g.uid, g);
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
    out.push({ ...b, cp, upg });
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
