/**
 * Builder solver filters — the `SolverFilters` state every Builder panel edits,
 * its reducer and actions, the defaults, and the conversion to the engine's
 * `SolveFilters`. Pure (no React): the Builder screen drives it with
 * `useReducer`, and the filter persistence (`storage/filterPresets.ts`,
 * `storage/heroFilters.ts`) stores its state shape.
 */
import type { SlotId } from "../../design/tokens.js";
import type { QualityTier } from "../quality.js";
import type { RecoFilterPatch } from "../reco/translateReco.js";
import type { ReforgeMode } from "./engine.js";
import { ARMOR_SLOTS } from "./setPlans.js";
import type { EquippedScope, SetPlan, SolveFilters } from "./types.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Solver filters — one reducer drives every panel. Lifting state up here
 * means we can hand the whole shape to the worker on SOLVE, and that the
 * "Reset filters" / "Clear" buttons are 1-line dispatches instead of having
 * to chase callbacks across each panel.
 * ───────────────────────────────────────────────────────────────────────── */
export interface SolverOptions {
  onlyMaxed: boolean;
  /** Reforge-mode preview — replaces the old `useReforged` boolean.
   *  "disable" scores gear as captured; "classic"/"ascended" project each
   *  piece to the +10 / +15 endgame (main re-scale + substat reforge ticks). */
  reforgeMode: ReforgeMode;
  /** Which equipped gear (on OTHER heroes) may enter the candidate pool — the
   *  selected hero's own + free gear is always in. "none" = own+free only;
   *  "lower" = also heroes of strictly lower priority (never strips an
   *  equal/higher hero); "all" = any equipped gear (legacy). */
  equippedScope: EquippedScope;
  /** Lock the selected hero's currently-equipped pieces — only fill empty
   *  slots and leave the rest alone. */
  keepCurrent: boolean;
  /** Allow builds with incomplete sets (singleton / set-less filler pieces).
   *  True (default) keeps legacy behavior: a partial set requirement leaves the
   *  free armor slots open to any piece. False forces every armor piece to be
   *  part of a 2pc/4pc — and lets the solver pre-prune the armor pools. */
  allowBrokenSets: boolean;
}

export type MinMax = { min?: number; max?: number };

/** Subset of `ArmorSetEntry` the reducer needs to compute the chip's next
 *  state (avoids coupling the reducer module to the panel's render type). */
export interface SetChipReach {
  has2pc: boolean;
  has4pc: boolean;
  canForm2pc: boolean;
  canForm4pc: boolean;
}

export interface SolverFilters {
  options: SolverOptions;
  /** Hero UIDs whose currently-equipped gear is locked out of the pool. */
  excludedHeroes: ReadonlySet<string>;
  /** Per-stat min/max bands on final composed stats. Missing entry = no bound. */
  statFilters: Record<string, MinMax>;
  /** Per-rating min/max bands on derived ratings (HpS, Ehp, CP, …). */
  ratingFilters: Record<string, MinMax>;
  /** Per-stat priority in -1..3 (heuristic weight for the Top-% per-slot prune). */
  priority: Record<string, number>;
  /** Percentile of per-slot pool to keep after priority scoring. 5..100. */
  topPct: number;
  /** Per-slot OR-list of acceptable main stats. Empty inner = any main allowed. */
  mainPicks: Record<string, Record<string, boolean>>;
  /** Per-slot main stats ruled out — a piece carrying one never enters the
   *  pool (e.g. ATK talismans when a teammate already brings one; talisman
   *  mains are shared by the team and don't stack). A stat is never both
   *  acceptable and excluded: each toggle clears the other. */
  mainExcludes: Record<string, Record<string, boolean>>;
  /** Set requirements as an OR-list of AND-plans (a build matches if ANY plan
   *  holds). The editor keeps at least one (possibly empty) plan so there's
   *  always a tab to edit; empty plans are dropped before the engine sees them. */
  setPlans: SetPlan[];
  /** Set ids hard-excluded from every build — orthogonal to `setPlans`. */
  excludedSets: string[];
  weaponEffectPicks: Record<string, ChipState>;
  accessoryEffectPicks: Record<string, ChipState>;
  /** Talisman effect picks — same cycle, plus `preferred`, set only by a
   *  recommendation (narrows the pool when the hero can use one, else open). */
  talismanEffectPicks: Record<string, ChipState>;
  /** Minimum gear quality tier admitted into the solve pool. Null = no gate.
   *  Talisman / EE have no quality and are always kept. */
  minQuality: QualityTier | null;
}

export type ChipState = "off" | "required" | "excluded" | "preferred";

export function nextChipState(s: ChipState | undefined): ChipState {
  if (s === "preferred") return "required";
  if (s === "required") return "excluded";
  if (s === "excluded") return "off";
  return "required";
}

/** Cycle a set's piece-count within a plan: 0 → 2 → 4 → 0, skipping any step
 *  the inventory can't form (need ≥2/≥4 pieces) OR that doesn't fit in the
 *  plan's remaining armor slots (`slotsFree` = 4 minus what the plan's other
 *  sets already consume — a plan over 4 slots is infeasible in-game and the
 *  engine skips it entirely). Mirrors `nextSetChipState` minus the `excluded`
 *  state (exclusion is a separate, global toggle now). */
export function nextPlanCount(cur: number, reach: SetChipReach, slotsFree: number = ARMOR_SLOTS): number {
  const can2 = reach.has2pc && reach.canForm2pc && slotsFree >= 2;
  const can4 = reach.has4pc && reach.canForm4pc && slotsFree >= 4;
  if (cur === 0) return can2 ? 2 : can4 ? 4 : 0;
  if (cur === 2) return can4 ? 4 : 0;
  return 0; // was 4
}

/** Reducer `SolverFilters` → engine `SolveFilters` (Sets → arrays, empty set
 *  plans dropped). Shared by the live solve and the pre-solve cartesian estimate
 *  so both see the exact same pools. */
export function buildSolveFilters(filters: SolverFilters): SolveFilters {
  return {
    options: filters.options,
    excludedHeroes: Array.from(filters.excludedHeroes),
    statFilters: filters.statFilters,
    ratingFilters: filters.ratingFilters,
    priority: filters.priority,
    topPct: filters.topPct,
    mainPicks: filters.mainPicks,
    mainExcludes: filters.mainExcludes ?? {},
    // Drop empty plans before the engine sees them — an empty plan has no conds,
    // so `every` is vacuously true and it would nullify the whole OR (everything
    // matches). The editor keeps an empty plan around only so a tab exists.
    setPlans: filters.setPlans.filter((p) => p.length > 0),
    excludedSets: filters.excludedSets,
    weaponEffectPicks: filters.weaponEffectPicks as SolveFilters["weaponEffectPicks"],
    accessoryEffectPicks: filters.accessoryEffectPicks as SolveFilters["accessoryEffectPicks"],
    talismanEffectPicks: filters.talismanEffectPicks as SolveFilters["talismanEffectPicks"],
    minQuality: filters.minQuality,
  };
}

export const INITIAL_FILTERS: SolverFilters = {
  // Safe defaults that reflect how the game is actually played:
  //   reforgeMode "classic" — score gear at the +10 endgame norm (most players
  //     stop there; +15 is resource-gated), not the captured +0/+9 state.
  //   equippedScope "lower" — may only pull gear off STRICTLY lower-priority
  //     heroes (ranks set in the Builds tab; an unranked hero gets a default
  //     rank by CP there, below the manual ones), never strip an equal/higher one.
  //     With no ranks it degrades to own+free (isLowerPriority ∞>∞ is false).
  options: { onlyMaxed: false, reforgeMode: "classic", equippedScope: "lower", keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: new Set(),
  statFilters: {},
  ratingFilters: {},
  priority: {},
  // Default to Top% 30, not 100 (= keep everything). On a real account the
  // full cartesian is billions of combos; the combo budget bites even without
  // a hand-set priority (SOLVE CP ranks each slot by a CP proxy, SOLVE Score
  // falls back to raw roll magnitude). Drag to 100 = exhaustive.
  // 60 (was 30): the combo-budget prune is a lossy heuristic — field feedback
  // showed the true best build regularly living just past the 30% slice (users
  // "fixed" it by stacking stat filters). 60 doubles the walked budget (~16M
  // combos, still a few seconds) for materially better recall; 100 = exhaustive.
  topPct: 60,
  mainPicks: {},
  mainExcludes: {},
  setPlans: [[]],
  excludedSets: [],
  weaponEffectPicks: {},
  accessoryEffectPicks: {},
  talismanEffectPicks: {},
  minQuality: null,
};

export type SolverAction =
  | { type: "setOption"; key: Exclude<keyof SolverOptions, "reforgeMode" | "equippedScope">; value: boolean }
  | { type: "setReforgeMode"; value: ReforgeMode }
  | { type: "setEquippedScope"; value: EquippedScope }
  | { type: "setMinQuality"; value: QualityTier | null }
  | { type: "toggleHeroExcluded"; uid: string }
  | { type: "setStatFilter"; stat: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setRatingFilter"; rating: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setPriority"; stat: string; value: number }
  | { type: "setTopPct"; value: number }
  | { type: "toggleMainPick"; slot: SlotId; stat: string }
  /** Rule a main stat out of a slot (or clear its exclusion). */
  | { type: "toggleMainExclude"; slot: SlotId; stat: string }
  /** Cycle a set's piece-count within one plan: off → 2pc → 4pc → off
   *  (skipping any step the inventory can't form). */
  | { type: "cycleSetInPlan"; planIdx: number; setId: string; reach: SetChipReach }
  /** Append a new empty OR-alternative plan. */
  | { type: "addPlan" }
  /** Remove a plan by index (keeps at least one). */
  | { type: "removePlan"; planIdx: number }
  /** Toggle a set in/out of the hard-excluded list. */
  | { type: "toggleExcludedSet"; setId: string }
  | { type: "cycleEffectPick"; group: "weapon" | "accessory" | "talisman"; key: string }
  | { type: "clearPriority" }
  | { type: "resetAll" }
  /** Replace the entire filter state — used to apply a saved preset.
   *  Keeps the reducer as the single mutation point so React batches
   *  the rerender as a single update. */
  | { type: "loadPreset"; filters: SolverFilters }
  /** Overlay an imported reco onto the current state — replaces the gear-shape
   *  fields (weapon / accessory / talisman effects, sets, priority) and the
   *  weapon+accessory mains, but
   *  keeps options, excluded heroes, stat/rating bands, topPct and any other
   *  slot's main picks. Excluded sets are kept too, minus any set the reco's
   *  plans require (the reco's intent wins over a stale exclusion). Main
   *  exclusions are left as they are (the reco carries none). */
  | { type: "mergePreset"; patch: RecoFilterPatch }
  /** Reset the excluded-heroes list (action button on the multi-select). */
  | { type: "clearExcludedHeroes" };

export function solverFiltersReducer(state: SolverFilters, action: SolverAction): SolverFilters {
  switch (action.type) {
    case "setOption":
      return { ...state, options: { ...state.options, [action.key]: action.value } };
    case "setReforgeMode":
      return { ...state, options: { ...state.options, reforgeMode: action.value } };
    case "setEquippedScope":
      return { ...state, options: { ...state.options, equippedScope: action.value } };
    case "setMinQuality":
      return { ...state, minQuality: action.value };
    case "toggleHeroExcluded": {
      const next = new Set(state.excludedHeroes);
      if (next.has(action.uid)) next.delete(action.uid); else next.add(action.uid);
      return { ...state, excludedHeroes: next };
    }
    case "setStatFilter": {
      const prev = state.statFilters[action.stat] ?? {};
      const updated: MinMax = { ...prev, [action.bound]: action.value };
      const next = { ...state.statFilters };
      if (updated.min == null && updated.max == null) delete next[action.stat];
      else next[action.stat] = updated;
      return { ...state, statFilters: next };
    }
    case "setRatingFilter": {
      const prev = state.ratingFilters[action.rating] ?? {};
      const updated: MinMax = { ...prev, [action.bound]: action.value };
      const next = { ...state.ratingFilters };
      if (updated.min == null && updated.max == null) delete next[action.rating];
      else next[action.rating] = updated;
      return { ...state, ratingFilters: next };
    }
    case "setPriority": {
      const next = { ...state.priority };
      if (action.value === 0) delete next[action.stat];
      else next[action.stat] = action.value;
      return { ...state, priority: next };
    }
    case "setTopPct":
      return { ...state, topPct: action.value };
    case "toggleMainPick": {
      const slotMap = state.mainPicks[action.slot] ?? {};
      const next = { ...slotMap };
      if (next[action.stat]) delete next[action.stat];
      else next[action.stat] = true;
      // Accepting a main clears its exclusion (never both).
      const excludes = { ...(state.mainExcludes?.[action.slot] ?? {}) };
      delete excludes[action.stat];
      return {
        ...state,
        mainPicks: { ...state.mainPicks, [action.slot]: next },
        mainExcludes: { ...state.mainExcludes, [action.slot]: excludes },
      };
    }
    case "toggleMainExclude": {
      const slotMap = state.mainExcludes?.[action.slot] ?? {};
      const next = { ...slotMap };
      if (next[action.stat]) delete next[action.stat];
      else next[action.stat] = true;
      // Excluding a main clears its acceptance (never both).
      const picks = { ...(state.mainPicks[action.slot] ?? {}) };
      delete picks[action.stat];
      return {
        ...state,
        mainPicks: { ...state.mainPicks, [action.slot]: picks },
        mainExcludes: { ...state.mainExcludes, [action.slot]: next },
      };
    }
    case "cycleSetInPlan": {
      const plans = state.setPlans.length > 0 ? state.setPlans : [[]];
      const plan = plans[action.planIdx] ?? [];
      const curCount = plan.find((c) => c.setId === action.setId)?.count ?? 0;
      // Armor slots the plan's OTHER sets already consume — a step that would
      // push the plan past the 4 armor slots is unreachable in-game (the
      // engine skips such a plan entirely), so the cycle must skip it too:
      // with `2pc A + 2pc B` set, C can only stay off, and A can't go 4pc.
      const othersTotal = plan.reduce((n, c) => n + (c.setId === action.setId ? 0 : c.count), 0);
      const nextCount = nextPlanCount(curCount, action.reach, ARMOR_SLOTS - othersTotal);
      // Rebuild the plan: drop the set, then re-add at the new count (unless off).
      const rebuilt = plan.filter((c) => c.setId !== action.setId);
      if (nextCount !== 0) rebuilt.push({ setId: action.setId, count: nextCount });
      const nextPlans = plans.map((p, i) => (i === action.planIdx ? rebuilt : p));
      return { ...state, setPlans: nextPlans };
    }
    case "addPlan":
      return { ...state, setPlans: [...state.setPlans, []] };
    case "removePlan": {
      const filtered = state.setPlans.filter((_, i) => i !== action.planIdx);
      // Always keep at least one (empty) plan so the editor has a tab.
      return { ...state, setPlans: filtered.length > 0 ? filtered : [[]] };
    }
    case "toggleExcludedSet": {
      const has = state.excludedSets.includes(action.setId);
      return {
        ...state,
        excludedSets: has
          ? state.excludedSets.filter((id) => id !== action.setId)
          : [...state.excludedSets, action.setId],
      };
    }
    case "cycleEffectPick": {
      const mapKey = action.group === "weapon" ? "weaponEffectPicks"
        : action.group === "accessory" ? "accessoryEffectPicks" : "talismanEffectPicks";
      const cur = state[mapKey][action.key] ?? "off";
      const nxt = nextChipState(cur);
      const map = { ...state[mapKey] };
      if (nxt === "off") delete map[action.key];
      else map[action.key] = nxt;
      return { ...state, [mapKey]: map };
    }
    case "clearPriority":
      return { ...state, priority: {} };
    case "resetAll":
      return INITIAL_FILTERS;
    case "loadPreset":
      return action.filters;
    case "mergePreset": {
      const p = action.patch;
      // A set both required and excluded would leave no build and no reason
      // shown — drop from the ban list every set the new plans ask for.
      const required = new Set(p.setPlans.flatMap((plan) => plan.map((c) => c.setId)));
      return {
        ...state,
        // Overlay per-slot so a talisman main the user set survives (the reco
        // only ever specifies weapon + accessory mains).
        mainPicks: { ...state.mainPicks, ...p.mainPicks },
        // The reco fully specifies these — replace wholesale.
        weaponEffectPicks: { ...p.weaponEffectPicks },
        accessoryEffectPicks: { ...p.accessoryEffectPicks },
        talismanEffectPicks: { ...p.talismanEffectPicks },
        setPlans: p.setPlans.length > 0 ? p.setPlans : [[]],
        excludedSets: state.excludedSets.filter((id) => !required.has(id)),
        priority: { ...p.priority },
      };
    }
    case "clearExcludedHeroes":
      return { ...state, excludedHeroes: new Set() };
  }
}
