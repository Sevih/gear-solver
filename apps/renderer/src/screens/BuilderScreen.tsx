/**
 * Builder — Fribbels-style dense optimizer UX. UX-only (no logic wired).
 *
 *   ┌─────┬─────┬───────┬──────┬─────┬─────┬──────┬─────┐
 *   │Hero │Stats│Options│StFilt│RatFt│SsPri│AccMst│Sets │     ← top band
 *   ├─────┴─────┴───────┴──────┴─────┴─────┴──────┴─────┤
 *   │  RESULTS TABLE (sortable, color heatmap)  │ Search│     ← middle
 *   │                                            │ stats │
 *   │                                            │Actions│
 *   ├────────────────────────────────────────────┴───────┤
 *   │ [Weapon][Helmet][Armor][Acc][Gloves][Boots]        │     ← bottom
 *   └────────────────────────────────────────────────────┘
 *
 * Every input is visual placeholder — state lives only where needed to
 * demonstrate behavior (hero combobox open/close, picker selection).
 */
import { Fragment, memo, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Character, GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, expToLevel, resolveStat } from "@gear-solver/core";
import { CharacterPortrait, SlotIcon, SlotMini, StatIcon } from "../design/EquipmentIcon.js";
import { Pill } from "../design/Chips.js";
import { cx } from "../design/cx.js";
import { HoverHint } from "../design/HoverHint.js";
import { GameText } from "../design/GameText.js";
import { RichTooltip } from "../design/RichTooltip.js";
import { SLOT_BY, STAT, toDesignSlot, type SlotId } from "../design/tokens.js";
import { toIconPiece, toUiPiece } from "../design/adapter.js";
import { flatVsPctTick } from "../lib/subValue.js";
import { dmgTickGains, type DmgTickCandidate } from "../lib/dmgValue.js";
import { computeFinalStats, type FinalStats } from "../lib/composeBuild.js";
import { projectPieceForReforge, type ReforgeMode } from "../lib/solver/engine.js";
import { resolveWorkerCount, SolverOrchestrator } from "../lib/solver/orchestrator.js";
import type { PoolSizes, SetPlan, SolveBuild, SolveFilters, SolveMode } from "../lib/solver/types.js";
import { translateRecoBuild, type RecoFilterPatch, type StructuredCharacterReco, type StructuredRecoBuild } from "../lib/reco/translateReco.js";
import { fetchReco } from "../lib/reco/fetchReco.js";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { QUALITY_TIERS, QUALITY_LABEL, type QualityTier } from "../lib/quality.js";
import {
  addSavedBuild, loadSavedBuilds, persistSavedBuilds, removeSavedBuild,
  type SavedBuild, type SavedBuildsMap,
} from "../lib/storage/savedBuilds.js";
import {
  addFilterPreset, loadFilterPresets, persistFilterPresets, removeFilterPreset,
  type FilterPreset, type FilterPresetsMap,
} from "../lib/storage/filterPresets.js";

interface BuilderScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Account-wide Geas node levels — falls back to per-node max in the composer. */
  userGeasLevels: UserGeasLevels | null;
  /** Resolved codex level 0..11 — composer fallback if null. */
  userCodexLevel: number | null;
  /** Hero UID to preselect on mount — set when the user clicks "Optimize →"
   *  on the Builds tab. Read once via the `selectedUid` initializer. */
  initialHeroUid?: string | null;
  /** Called once on mount after consuming `initialHeroUid`, so the parent can
   *  clear it (a later plain visit to the Builder shouldn't re-preselect). */
  onInitialHeroConsumed?: () => void;
  /** Solver-pool override (Settings → Solver): null = auto. Drives the footer
   *  read-out and forces a worker-pool rebuild when it changes. */
  workerCount?: number | null;
  /** Ranked builds returned by a solve (Settings → Solver, default 1000). */
  topN?: number;
  /** Per-worker heap depth before merge (Settings → Solver, default 1000). */
  topK?: number;
  /** Results-table column heatmap on/off (Settings → Solver, default on). */
  heatmap?: boolean;
}

/** Composed snapshot for the selected hero — drives the Stats panel readout
 *  and (eventually) the solver scoring baseline. Null when no hero is picked
 *  or the composer lacked the ingredients to run. */
interface SelectedComposition {
  current: FinalStats;
  /** Hero's no-gear base flat (base+evo+awak) for ATK/DEF/HP — what a %-sub
   *  tick scales against (gear-independent). Powers the flat-vs-% panel. */
  baseFlat: { atk: number; def: number; hp: number };
  /** Hero's damage-scaling stat (ATK default; DEF/HP exceptions) + secondary
   *  additive scalings — fed to `computeCheapRatings` for the damage panel. */
  dmgStat: "atk" | "def" | "hp";
  dmgSec?: Array<{ stat: "atk" | "def" | "hp" | "spd"; ratio: number }>;
  /** Per-stat (1 + buffRate) amplifier: a +1% sub on a scaling stat raises the
   *  final stat by `base × 1% × dmgAmp[stat]`. */
  dmgAmp: { atk: number; def: number; hp: number };
}

/** Hero display name aligned with the Builds tab: "Nickname Name" when the
 *  character has an in-game shown nickname (e.g. "Mystic Sage Ame"),
 *  "Core Fusion …" prefix when the captured Character was forged from a
 *  fusion, and a `#${charId}` fallback when the data layer didn't resolve
 *  a name at all. */
function displayNameOf(c: Character, meta: { nickname: string | null } | null): string {
  const base = meta?.nickname ? `${meta.nickname} ${c.name ?? ""}`.trim() : (c.name ?? `#${c.charId}`);
  return c.fusionCharId !== 0 ? `Core Fusion ${base}` : base;
}

/** Slots shown in the bottom card band — all 8 pieces, in the same order
 *  the in-game build screen displays them. EE and Talisman are full
 *  citizens of the solver scope (their mains contribute via the IOT_BUFF
 *  channel and the filter chips below count them). */
const RESULT_GEAR_SLOTS: SlotId[] = [
  "weapon", "exclusive", "helmet", "armor",
  "accessory", "talisman", "gloves", "boots",
];

/** Compact main-stat-axis labels rendered in the Stats / Stat filters /
 *  Substat priority panels (and across as table columns). Ordered to match
 *  the Builds tab's StatBlock column reading so muscle memory transfers. */
// Labels are the in-game stat abbreviations (source of truth:
// outerpedia-v2/data/stats.json) — used as the column-header tooltips and any
// text fallback. The table headers themselves render the stat icon, not the
// text, so a long label like "CDMG RED%" never crowds the column.
const SOLVER_STATS: ReadonlyArray<{ key: string; iconKey: string; label: string; unit: string }> = [
  { key: "atk",        iconKey: "atk",           label: "ATK",       unit: "" },
  { key: "def",        iconKey: "def",           label: "DEF",       unit: "" },
  { key: "hp",         iconKey: "hp",            label: "HP",        unit: "" },
  { key: "spd",        iconKey: "spd",           label: "SPD",       unit: "" },
  { key: "crc",        iconKey: "critRate",      label: "CHC",       unit: "%" },
  { key: "chd",        iconKey: "critDmg",       label: "CHD",       unit: "%" },
  { key: "critDmgRed", iconKey: "critDmgReduce", label: "CDMG RED%", unit: "%" },
  { key: "pen",        iconKey: "pen",           label: "PEN%",      unit: "%" },
  { key: "dmgUp",      iconKey: "dmgUp",         label: "DMG UP%",   unit: "%" },
  { key: "dmgRed",     iconKey: "dmgReduce",     label: "DMG RED%",  unit: "%" },
  { key: "eff",        iconKey: "eff",           label: "EFF",       unit: "" },
  { key: "res",        iconKey: "effRes",        label: "RES",       unit: "" },
];

/** Calculated ratings — visible only in the Rating filters panel and as
 *  result-table columns. Formulas mirror the Fribbels E7 model; final
 *  Outerplane tuning may differ (e.g. EHP defense scaling uses the in-game
 *  HD formula). Score and Upg are derived in the solver, not user-bound.
 *
 *  `hideInTable` flags a rating that's still useful as a filter axis but
 *  rarely needed in the per-row table (avoids cluttering 20+ columns).
 *  Filters panel always shows everything. */
const SOLVER_RATINGS: ReadonlyArray<{ key: string; label: string; formula: string; desc: string; hideInTable?: boolean }> = [
  { key: "cp",   label: "Cp",   formula: "in-game CalcBattlePower",         desc: "Combat Power as shown on the unit page (no skill enhances)." },
  { key: "hps",  label: "HpS",  formula: "HP × SPD",                        desc: "HP × Speed composite — fast-and-bulky proxy." },
  { key: "ehp",  label: "Ehp",  formula: "HP × (1 + DEF/1000) / max(0.3, 1 − dmgRed/100)", desc: "Effective HP — combines the in-game DEF mitigation 1000/(DEF+1000) with the build's own dmgRed (defender-side reduction)." },
  { key: "ehps", label: "EhpS", formula: "EHP × SPD",                       desc: "EHP × Speed — tanky-and-fast." },
  { key: "dmg",  label: "Dmg",  formula: "DmgStat × E[DR] × penMult(2000)", desc: "Expected damage per hit vs DEF=2000 — scales off the hero's damage stat (ATK by default; DEF/HP for off-ATK heroes), weighting crit (1 + pCrit×(CHD/100−1)), attacker's dmgUp, and PEN. dmgRed doesn't reduce a build's own offensive output (defender stat)." },
  { key: "dmgs", label: "DmgS", formula: "Dmg × SPD",                       desc: "DPS — Dmg × speed." },
  { key: "mcd",  label: "Mcd",  formula: "ATK × (CHD/100 + dmgMod) × penMult(2000)", desc: "Max crit damage vs DEF=2000 — assumes 100% CHC (raid-buff scenario).", hideInTable: true },
  { key: "mcds", label: "McdS", formula: "Mcd × SPD",                       desc: "Max DPS — Mcd × speed.",            hideInTable: true },
  { key: "dmgh", label: "DmgH", formula: "HP × E[DR] × penMult(2000)",      desc: "Expected damage for HP-scaling kits vs DEF=2000 — fixed HP reference column (the Dmg column already scales off the hero's actual stat).", hideInTable: true },
];

/** Ratings actually rendered in the results table — filters out the
 *  `hideInTable` ones so the row stays scannable. */
const TABLE_RATINGS = SOLVER_RATINGS.filter((r) => !r.hideInTable);

/** Slots whose in-game main is user-selectable — Weapon, Accessory, Talisman.
 *  Helmet / Armor / Gloves / Boots all have a fixed in-game main stat and
 *  don't need a filter. The actual stat options per slot are derived from
 *  the user's inventory (see `mainStatCatalogFromInventory`); the only
 *  hardcoded part is which rows show up. */
const MAIN_STAT_SLOTS: ReadonlyArray<{ slot: SlotId; label: string }> = [
  { slot: "weapon",    label: "Weapon" },
  { slot: "accessory", label: "Accessory" },
  { slot: "talisman",  label: "Talisman" },
];

/** Canonical display order for main-stat chips — all engine stat keys we
 *  expect to ever encounter on a rolled main, ordered so the user sees the
 *  same column layout regardless of which slot they're looking at. Unknown
 *  keys (future game updates, exotic talisman / EE buffs) sort last but
 *  still render (with a fallback label). */
const STAT_DISPLAY_ORDER: ReadonlyArray<string> = [
  "atk", "atkPct",
  "def", "defPct",
  "hp",  "hpPct",
  "spd",
  "critRate", "critDmg", "critDmgReduce",
  "pen", "dmgUp", "dmgReduce",
  "eff", "effRes",
  "hitAp", "killAp",
  "lifesteal", "counter", "enterAp",
];

/** Engine stat key → short user-facing label rendered on the chip tooltip.
 *  Falls back to the upper-cased key when unmapped. Percent variants share
 *  the flat label and get a `%` overlay on the chip. */
const STAT_LABEL: Record<string, string> = {
  atk: "ATK", atkPct: "ATK%",
  def: "DEF", defPct: "DEF%",
  hp:  "HP",  hpPct:  "HP%",
  spd: "SPD",
  critRate: "CHC",
  critDmg:  "CHD",
  critDmgReduce: "CDMG RED%",
  pen:    "PEN%",
  dmgUp:  "DMG UP%",
  dmgReduce: "DMG RED%",
  eff:    "EFF",
  effRes: "RES",
  hitAp:  "HitAP",
  killAp: "KillAP",
  lifesteal: "LIFE",
  counter:   "CTR",
  enterAp:   "AP+",
};

function statLabelFor(key: string): string {
  return STAT_LABEL[key] ?? key.toUpperCase();
}

/** Engine key → STAT-token icon key. `*Pct` rolls share the icon of their
 *  flat counterpart (the chip overlays a `%` badge to distinguish them). */
function statIconKeyFor(key: string): string {
  if (key.endsWith("Pct")) return key.slice(0, -3);
  return key;
}

/** Full name + in-game definition per result-table stat, for the column-header
 *  tooltip (so a hover explains the stat instead of just repeating the icon).
 *  Definitions are condensed from the game's `TextSystem` (`SYS_DESC_*` /
 *  `SYS_STAT_DESC_*` keys) — the same source the in-game stat info panel uses. */
const STAT_TOOLTIP: Record<string, { full: string; desc: string }> = {
  atk:        { full: "Attack",                desc: "The higher your Attack, the more damage you deal to enemies." },
  def:        { full: "Defense",               desc: "The higher your Defense, the less damage you take from enemies." },
  hp:         { full: "Health",                desc: "You're defeated once your Health falls to zero." },
  spd:        { full: "Speed",                 desc: "The higher your Speed, the more often you can act." },
  crc:        { full: "Crit Chance",           desc: "Chance for an attack to land a critical hit (dealing Crit Damage)." },
  chd:        { full: "Crit Damage",           desc: "Increases damage dealt on critical hits." },
  critDmgRed: { full: "Crit Damage Reduction", desc: "Reduces crit damage taken when hit (caps at 70% combined with Damage Reduction)." },
  pen:        { full: "Penetration",           desc: "Ignores a portion of the target's Defense when attacking." },
  dmgUp:      { full: "Damage Increase",       desc: "Increases damage dealt when attacking." },
  dmgRed:     { full: "Damage Reduction",      desc: "Reduces damage taken when hit." },
  eff:        { full: "Effectiveness",         desc: "The higher it is, the lower the target's chance to resist your debuffs." },
  res:        { full: "Resilience",            desc: "The higher it is, the higher your chance to resist debuffs." },
};

/** Column-header tooltip text: "Full Name — definition", falling back to the
 *  abbreviation when a stat has no curated entry. */
function statHeaderTooltip(key: string, label: string): string {
  const t = STAT_TOOLTIP[key];
  return t ? `${t.full} — ${t.desc}` : label;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Solver filters — one reducer drives every panel. Lifting state up here
 * means we can hand the whole shape to the worker on SOLVE, and that the
 * "Reset filters" / "Clear" buttons are 1-line dispatches instead of having
 * to chase callbacks across each panel.
 * ───────────────────────────────────────────────────────────────────────── */
interface SolverOptions {
  onlyMaxed: boolean;
  /** Reforge-mode preview — replaces the old `useReforged` boolean.
   *  "disable" scores gear as captured; "classic"/"ascended" project each
   *  piece to the +10 / +15 endgame (main re-scale + substat reforge ticks). */
  reforgeMode: ReforgeMode;
  /** Include gear equipped on OTHER heroes in the candidate pool. The
   *  selected hero's own gear is always in. */
  includeEquippedOnOthers: boolean;
  /** Lock the selected hero's currently-equipped pieces — only fill empty
   *  slots and leave the rest alone. */
  keepCurrent: boolean;
}

/** Reforge context carried alongside a result set — the mode + priority the
 *  build was solved with, so the bottom gear band can re-project the same
 *  main/substats it was scored against. */
interface ReforgeContext {
  reforgeMode: ReforgeMode;
  priority: Record<string, number>;
}

/** Migrate a persisted reforge context (saved builds) to the current shape.
 *  Pre-reforge-modes builds stored a `useReforged` boolean → map true to
 *  "classic" (the only projection that existed then), false/absent to
 *  "disable". */
function migrateReforge(r: { reforgeMode?: ReforgeMode; useReforged?: boolean; priority: Record<string, number> } | undefined): ReforgeContext {
  if (!r) return { reforgeMode: "disable", priority: {} };
  const reforgeMode = r.reforgeMode ?? (r.useReforged ? "classic" : "disable");
  return { reforgeMode, priority: r.priority };
}

/** UI metadata for the reforge-mode segmented control — order = cycle order,
 *  label = chip text, hint = tooltip. */
const REFORGE_MODES: ReadonlyArray<{ value: ReforgeMode; label: string; hint: string }> = [
  { value: "disable",  label: "Off",      hint: "Reforge preview off — score gear exactly as captured." },
  { value: "classic",  label: "Classic",  hint: "Project every piece to the +10 endgame (6 reforge ticks): main stats re-scaled, substats max-rolled by priority." },
  { value: "ascended", label: "Ascended", hint: "Project every piece to the +15 Singularity endgame (9 reforge ticks): main stats re-scaled, substats max-rolled by priority." },
];

type MinMax = { min?: number; max?: number };

/** Subset of `ArmorSetEntry` the reducer needs to compute the chip's next
 *  state (avoids coupling the reducer module to the panel's render type). */
interface SetChipReach {
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
  /** Set requirements as an OR-list of AND-plans (a build matches if ANY plan
   *  holds). The editor keeps at least one (possibly empty) plan so there's
   *  always a tab to edit; empty plans are dropped before the engine sees them. */
  setPlans: SetPlan[];
  /** Set ids hard-excluded from every build — orthogonal to `setPlans`. */
  excludedSets: string[];
  weaponEffectPicks: Record<string, ChipState>;
  accessoryEffectPicks: Record<string, ChipState>;
  /** Minimum gear quality tier admitted into the solve pool. Null = no gate.
   *  Talisman / EE have no quality and are always kept. */
  minQuality: QualityTier | null;
}

const INITIAL_FILTERS: SolverFilters = {
  options: { onlyMaxed: false, reforgeMode: "disable", includeEquippedOnOthers: true, keepCurrent: false },
  excludedHeroes: new Set(),
  statFilters: {},
  ratingFilters: {},
  priority: {},
  topPct: 100,
  mainPicks: {},
  setPlans: [[]],
  excludedSets: [],
  weaponEffectPicks: {},
  accessoryEffectPicks: {},
  minQuality: null,
};

type SolverAction =
  | { type: "setOption"; key: Exclude<keyof SolverOptions, "reforgeMode">; value: boolean }
  | { type: "setReforgeMode"; value: ReforgeMode }
  | { type: "setMinQuality"; value: QualityTier | null }
  | { type: "toggleHeroExcluded"; uid: string }
  | { type: "setStatFilter"; stat: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setRatingFilter"; rating: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setPriority"; stat: string; value: number }
  | { type: "setTopPct"; value: number }
  | { type: "toggleMainPick"; slot: SlotId; stat: string }
  /** Cycle a set's piece-count within one plan: off → 2pc → 4pc → off
   *  (skipping any step the inventory can't form). */
  | { type: "cycleSetInPlan"; planIdx: number; setId: string; reach: SetChipReach }
  /** Append a new empty OR-alternative plan. */
  | { type: "addPlan" }
  /** Remove a plan by index (keeps at least one). */
  | { type: "removePlan"; planIdx: number }
  /** Toggle a set in/out of the hard-excluded list. */
  | { type: "toggleExcludedSet"; setId: string }
  | { type: "cycleEffectPick"; group: "weapon" | "accessory"; key: string }
  | { type: "clearPriority" }
  | { type: "resetAll" }
  /** Replace the entire filter state — used to apply a saved preset.
   *  Keeps the reducer as the single mutation point so React batches
   *  the rerender as a single update. */
  | { type: "loadPreset"; filters: SolverFilters }
  /** Overlay an imported reco onto the current state — replaces the gear-shape
   *  fields (effects / sets / priority) and the weapon+accessory mains, but
   *  keeps options, excluded heroes, stat/rating bands, topPct and any other
   *  slot's main picks. */
  | { type: "mergePreset"; patch: RecoFilterPatch }
  /** Reset the excluded-heroes list (action button on the multi-select). */
  | { type: "clearExcludedHeroes" };

function solverFiltersReducer(state: SolverFilters, action: SolverAction): SolverFilters {
  switch (action.type) {
    case "setOption":
      return { ...state, options: { ...state.options, [action.key]: action.value } };
    case "setReforgeMode":
      return { ...state, options: { ...state.options, reforgeMode: action.value } };
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
      return { ...state, mainPicks: { ...state.mainPicks, [action.slot]: next } };
    }
    case "cycleSetInPlan": {
      const plans = state.setPlans.length > 0 ? state.setPlans : [[]];
      const plan = plans[action.planIdx] ?? [];
      const curCount = plan.find((c) => c.setId === action.setId)?.count ?? 0;
      const nextCount = nextPlanCount(curCount, action.reach);
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
      const mapKey = action.group === "weapon" ? "weaponEffectPicks" : "accessoryEffectPicks";
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
      return {
        ...state,
        // Overlay per-slot so a talisman main the user set survives (the reco
        // only ever specifies weapon + accessory mains).
        mainPicks: { ...state.mainPicks, ...p.mainPicks },
        // The reco fully specifies these — replace wholesale.
        weaponEffectPicks: { ...p.weaponEffectPicks },
        accessoryEffectPicks: { ...p.accessoryEffectPicks },
        setPlans: p.setPlans.length > 0 ? p.setPlans : [[]],
        priority: { ...p.priority },
      };
    }
    case "clearExcludedHeroes":
      return { ...state, excludedHeroes: new Set() };
  }
}

/** Client-side equivalent of the solver's stat/rating band check — used by the
 *  post-solve "Filter" action to narrow the already-computed result set without
 *  re-running the solve. Stat keys read off `finalStats`, ratings off `ratings`
 *  (with cp/score/upg pulled from the build's own fields). */
function buildPassesFilters(
  b: SolveBuild,
  statFilters: Record<string, MinMax>,
  ratingFilters: Record<string, MinMax>,
): boolean {
  const inBand = (v: unknown, band: MinMax): boolean => {
    if (typeof v !== "number") return true; // missing stat → don't exclude
    if (band.min != null && v < band.min) return false;
    if (band.max != null && v > band.max) return false;
    return true;
  };
  const fs = b.finalStats as unknown as Record<string, number>;
  for (const [k, band] of Object.entries(statFilters)) {
    if (!inBand(fs[k], band)) return false;
  }
  const ratings = b.ratings as unknown as Record<string, number>;
  for (const [k, band] of Object.entries(ratingFilters)) {
    const v = k === "cp" ? b.cp : k === "score" ? b.score : k === "upg" ? b.upg : ratings[k];
    if (!inBand(v, band)) return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Top-level layout
 * ───────────────────────────────────────────────────────────────────────── */
export function BuilderScreen({ inventory, game, userGeasLevels, userCodexLevel, initialHeroUid, onInitialHeroConsumed, workerCount = null, topN = 1000, topK = 1000, heatmap = true }: BuilderScreenProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(initialHeroUid ?? null);
  // Results table viewport height, in rows — capped so the bottom gear band
  // stays visible instead of the table greedily eating all vertical space.
  // Persisted so the user's preferred split survives reloads.
  const [resultRows, setResultRows] = usePersistedState<number>("gs.builder.resultRows", 12);
  // Consume the preselect once on mount so the parent can clear it (the
  // initializer above already captured the value into `selectedUid`).
  useEffect(() => {
    if (initialHeroUid) onInitialHeroConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, dispatch] = useReducer(solverFiltersReducer, INITIAL_FILTERS);

  // Solver state — orchestrator stays alive for the screen's lifetime so
  // the worker pool isn't torn down between solves. Lazy-init on first SOLVE.
  const orchestratorRef = useRef<SolverOrchestrator | null>(null);
  /** Reforge context of the most recent solve — snapshotted at solve start so
   *  the async `onResult` reads the run's own value (not a later filter edit).
   *  The bottom gear band re-runs the deterministic `projectPieceForReforge`
   *  with this mode + priority to display the same projected main/substats the
   *  engine scored. */
  const solveReforgeRef = useRef<ReforgeContext>({ reforgeMode: "disable", priority: {} });
  /** Reforge context tied to whatever currently populates `solveResults` —
   *  set from `solveReforgeRef` on a live solve, or from the saved build's
   *  stored context on restore. Drives the bottom band's projection. */
  const [resultsReforge, setResultsReforge] = useState<ReforgeContext>({ reforgeMode: "disable", priority: {} });
  const [solving, setSolving] = useState(false);
  const [solveProgress, setSolveProgress] = useState<{ permutations: number; searched: number; poolSizes: PoolSizes | null }>(
    { permutations: 0, searched: 0, poolSizes: null },
  );
  const [solveResults, setSolveResults] = useState<SolveBuild[]>([]);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [selectedBuildIdx, setSelectedBuildIdx] = useState<number | null>(null);
  /** Post-solve client filter — a snapshot of the stat/rating bands applied to
   *  the STORED results (no re-solve). Null = show every stored build. Set by
   *  the toolbar's "Filter" button; cleared whenever a fresh result set lands
   *  (a new solve already applied the bands server-side). */
  const [displayFilter, setDisplayFilter] = useState<{ statFilters: Record<string, MinMax>; ratingFilters: Record<string, MinMax> } | null>(null);
  /** Track the mode used for the last solve — surfaces on Save Build so we
   *  preserve "this build came from SOLVE CP" vs "from SOLVE". */
  const [lastSolveMode, setLastSolveMode] = useState<SolveMode>("score");

  // Persistence — loaded once on mount, mutated via the add/remove helpers
  // and re-persisted explicitly (vs hooking into a useEffect that fires
  // on every render, which would re-write the blob on hero switch etc.).
  const [savedBuildsMap, setSavedBuildsMap] = useState<SavedBuildsMap>(() => loadSavedBuilds());
  const [filterPresetsMap, setFilterPresetsMap] = useState<FilterPresetsMap>(() => loadFilterPresets());

  // In-app name prompt (replaces window.prompt which blocked the renderer
  // thread and didn't match the rest of the UI's styling). `pending` carries
  // the action to run once the user confirms the name.
  const [namePrompt, setNamePrompt] = useState<{
    title: string;
    placeholder: string;
    onConfirm: (name: string) => void;
  } | null>(null);

  // Build inventory uid→piece lookup once per inventory change — bottom
  // gear band needs full piece data to render and the results table only
  // carries UIDs (saves bytes through postMessage).
  const pieceByUid = useMemo(() => {
    const m = new Map<string, GearPiece>();
    if (inventory) for (const g of inventory.gear) m.set(g.uid, g);
    return m;
  }, [inventory]);

  useEffect(() => {
    // Dispose on unmount so the worker pool tears down with the screen.
    return () => { orchestratorRef.current?.dispose(); orchestratorRef.current = null; };
  }, []);

  // Worker-count override changed (Settings → Solver): tear the pool down so
  // the next solve lazily rebuilds it at the new size. The orchestrator reads
  // the count via `resolveWorkerCount()` (localStorage), which App has already
  // written by the time this effect runs. Skips the initial mount (nothing to
  // dispose yet — the ref is null).
  useEffect(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.dispose();
      orchestratorRef.current = null;
    }
  }, [workerCount]);

  const startSolve = (mode: SolveMode) => {
    // The SOLVE button is only gated on `selectedUid`, so it can be clicked
    // while game data is still loading — surface that instead of bailing
    // silently (user otherwise gets no feedback at all).
    if (!selectedUid) return;
    if (!inventory || !game) {
      setSolveError("Game data is still loading — try again in a moment.");
      return;
    }
    const selected = inventory.characters.find((c) => c.uid === selectedUid);
    if (!selected) {
      setSolveError("Selected hero was not found in the captured roster.");
      return;
    }
    if (!orchestratorRef.current) {
      orchestratorRef.current = new SolverOrchestrator({
        onProgress: (p) => setSolveProgress({ permutations: p.permutations, searched: p.searched, poolSizes: p.poolSizes ?? null }),
        onResult:   (builds) => { setSolveResults(builds); setResultsReforge(solveReforgeRef.current); setSelectedBuildIdx(builds.length > 0 ? 0 : null); setDisplayFilter(null); setSolving(false); },
        onError:    (msg) => { setSolveError(msg); setSolving(false); },
      });
    }
    setSolving(true);
    setSolveError(null);
    setSolveResults([]);
    setSelectedBuildIdx(null);
    setDisplayFilter(null);
    setSolveProgress({ permutations: 0, searched: 0, poolSizes: null });
    setLastSolveMode(mode);
    // Snapshot the reforge context for this run (shallow-copy the priority so
    // a later filter edit can't mutate what `onResult` reads).
    solveReforgeRef.current = { reforgeMode: filters.options.reforgeMode, priority: { ...filters.priority } };
    const serializedFilters: SolveFilters = {
      options: filters.options,
      excludedHeroes: Array.from(filters.excludedHeroes),
      statFilters: filters.statFilters,
      ratingFilters: filters.ratingFilters,
      priority: filters.priority,
      topPct: filters.topPct,
      mainPicks: filters.mainPicks,
      // Drop empty plans before the engine sees them — an empty plan has no
      // conds, so `every` is vacuously true and it would nullify the whole OR
      // (everything matches). The editor keeps an empty plan around only so a
      // tab exists to fill in.
      setPlans: filters.setPlans.filter((p) => p.length > 0),
      excludedSets: filters.excludedSets,
      weaponEffectPicks: filters.weaponEffectPicks as SolveFilters["weaponEffectPicks"],
      accessoryEffectPicks: filters.accessoryEffectPicks as SolveFilters["accessoryEffectPicks"],
      minQuality: filters.minQuality,
    };
    orchestratorRef.current.solve({
      mode,
      heroUid: selectedUid,
      inventory,
      game,
      userGeasLevels,
      userCodexLevel,
      userSkills: {
        first: selected.skills.first,
        second: selected.skills.second,
        ultimate: selected.skills.ultimate,
        chainPassive: selected.skills.chainPassive,
      },
      filters: serializedFilters,
      // Result-set size + per-worker heap depth from Settings → Solver.
      topN,
      topK,
    });
  };

  const cancelSolve = () => orchestratorRef.current?.cancel();

  // Results actually shown — the stored set, optionally narrowed by the
  // post-solve client filter (no re-solve). Selection + gear band index into
  // THIS array, so a Filter that drops rows doesn't desync the selection.
  const displayedResults = useMemo(
    () => (displayFilter
      ? solveResults.filter((b) => buildPassesFilters(b, displayFilter.statFilters, displayFilter.ratingFilters))
      : solveResults),
    [solveResults, displayFilter],
  );
  // Resolved solver worker-pool size — surfaced in the footer so the user can
  // confirm the search uses the whole machine. Recomputes when the override
  // setting changes (Settings → Solver) so the read-out stays live.
  const resolvedWorkers = useMemo(() => resolveWorkerCount(workerCount), [workerCount]);
  // Apply the current stat/rating bands to the stored results without
  // re-solving. Re-anchors the selection to the new top row.
  const applyClientFilter = () => {
    setDisplayFilter({ statFilters: filters.statFilters, ratingFilters: filters.ratingFilters });
    setSelectedBuildIdx(solveResults.length > 0 ? 0 : null);
  };
  /** Whether any stat/rating band is set — gates the Filter button (nothing to
   *  apply otherwise). */
  const hasAnyBand = Object.keys(filters.statFilters).length > 0 || Object.keys(filters.ratingFilters).length > 0;

  const selectedBuild = selectedBuildIdx != null ? displayedResults[selectedBuildIdx] ?? null : null;

  // When a solve yields no builds, an empty per-slot pool is almost always
  // the cause (filters too strict, or the hero owns no piece for that slot).
  // Surface exactly which slots collapsed to 0 so "0 builds" isn't a silent
  // dead-end. Derived from the last solve's pool sizes (null until a solve
  // runs → falls back to the generic "pick a hero" hint).
  const emptyReason = useMemo(() => {
    const ps = solveProgress.poolSizes;
    if (!ps) return null;
    const dead = Object.keys(ps).filter((s) => (ps[s]?.hit ?? 0) === 0);
    if (dead.length === 0) return null;
    return dead.map((s) => `${SLOT_BY[s]?.label ?? s}: 0 pieces after filters`).join(" · ");
  }, [solveProgress.poolSizes]);

  // Saved-builds handlers — `selectedUid` gates everything; the UI hides /
  // disables the controls when no hero is picked so we don't have to thread
  // null-checks past these helpers' callers.
  const saveCurrentBuild = () => {
    if (!selectedBuild || !selectedUid) return;
    const placeholder = `Build ${(savedBuildsMap[selectedUid]?.length ?? 0) + 1}`;
    setNamePrompt({
      title: "Save build",
      placeholder,
      onConfirm: (name) => {
        const entry: SavedBuild = {
          id: crypto.randomUUID(),
          name: name.trim() || placeholder,
          heroUid: selectedUid,
          mode: lastSolveMode,
          build: selectedBuild,
          reforge: resultsReforge,
          createdAt: Date.now(),
        };
        const next = addSavedBuild(savedBuildsMap, entry);
        setSavedBuildsMap(next);
        persistSavedBuilds(next);
      },
    });
  };
  const removeBuildById = (id: string) => {
    if (!selectedUid) return;
    const next = removeSavedBuild(savedBuildsMap, selectedUid, id);
    setSavedBuildsMap(next);
    persistSavedBuilds(next);
  };
  const restoreBuild = (b: SavedBuild) => {
    // Push the saved build to the results table (visual confirmation) AND
    // select it so the BottomGearBand renders its 8 pieces. Replaces the
    // last solve's results — user can re-solve to get them back.
    // Clear any stale solve error so the red banner from a previous failed
    // solve doesn't linger over a freshly restored build.
    setSolveError(null);
    setSolveResults([b.build]);
    setDisplayFilter(null); // a single restored build is never client-filtered
    // Restore the build's reforge context so the bottom band projects the
    // same substats it was solved with (pre-field / legacy builds migrated).
    setResultsReforge(migrateReforge(b.reforge));
    setSelectedBuildIdx(0);
    setLastSolveMode(b.mode);
  };

  // Filter-preset handlers.
  const saveCurrentPreset = () => {
    if (!selectedUid) return;
    const placeholder = `Preset ${(filterPresetsMap[selectedUid]?.length ?? 0) + 1}`;
    setNamePrompt({
      title: "Save preset",
      placeholder,
      onConfirm: (name) => {
        const entry: FilterPreset = {
          id: crypto.randomUUID(),
          name: name.trim() || placeholder,
          heroUid: selectedUid,
          // Shallow snapshot: only `excludedHeroes` (a Set) is re-materialized;
          // `statFilters` / `mainPicks` / `setPicks` stay shared references.
          // Safe today because the reducer is immutable (every action returns
          // fresh objects, never mutates in place) — revisit with a
          // structuredClone if a future action ever edits state in place.
          filters: { ...filters, excludedHeroes: new Set(filters.excludedHeroes) },
          createdAt: Date.now(),
        };
        const next = addFilterPreset(filterPresetsMap, entry);
        setFilterPresetsMap(next);
        persistFilterPresets(next);
      },
    });
  };
  const loadPreset = (p: FilterPreset) => {
    dispatch({ type: "loadPreset", filters: { ...p.filters, excludedHeroes: new Set(p.filters.excludedHeroes) } });
  };
  const removePresetById = (id: string) => {
    if (!selectedUid) return;
    const next = removeFilterPreset(filterPresetsMap, selectedUid, id);
    setFilterPresetsMap(next);
    persistFilterPresets(next);
  };

  const savedBuildsForHero = selectedUid ? savedBuildsMap[selectedUid] ?? [] : [];
  const presetsForHero = selectedUid ? filterPresetsMap[selectedUid] ?? [] : [];

  const selected = useMemo<Character | null>(() => {
    if (!inventory) return null;
    return selectedUid ? inventory.characters.find((c) => c.uid === selectedUid) ?? null : null;
  }, [inventory, selectedUid]);

  // "Get preset" — fetch this hero's outerpedia build reco and overlay it on
  // the current filters (mergePreset). Multiple named builds → a small picker.
  const [recoBusy, setRecoBusy] = useState(false);
  const [recoStatus, setRecoStatus] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [recoPicker, setRecoPicker] = useState<StructuredCharacterReco | null>(null);
  // Clear stale reco feedback when the hero changes.
  useEffect(() => { setRecoStatus(null); setRecoPicker(null); }, [selectedUid]);

  const applyRecoBuild = (name: string, build: StructuredRecoBuild) => {
    // Resolve each recommended item to its unique effect key (setId) via the
    // loaded game data — the reco only carries effectIcon, which isn't unique.
    const resolveEffectKey = (itemId: number | null) =>
      itemId != null && game ? game.equipment[String(itemId)]?.setId ?? null : null;
    const { patch, warnings } = translateRecoBuild(build, resolveEffectKey);
    dispatch({ type: "mergePreset", patch });
    setRecoPicker(null);
    setRecoStatus(
      warnings.length > 0
        ? { tone: "warn", text: `Applied "${name}" — ${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings[0]}` }
        : { tone: "ok", text: `Applied "${name}".` },
    );
  };

  const getPreset = async () => {
    if (!selected) return;
    setRecoBusy(true);
    setRecoStatus(null);
    setRecoPicker(null);
    const r = await fetchReco(selected.charId);
    setRecoBusy(false);
    if (r.status === "none") { setRecoStatus({ tone: "warn", text: "No build reco for this hero yet." }); return; }
    if (r.status === "error") { setRecoStatus({ tone: "error", text: `Reco fetch failed: ${r.message}` }); return; }
    const names = Object.keys(r.reco.builds);
    const only = names[0];
    if (names.length === 1 && only) { applyRecoBuild(only, r.reco.builds[only]!); return; }
    setRecoPicker(r.reco); // multiple builds → let the user pick which one
  };

  /** Compose the picked hero's full stats (gear included) via the shared
   *  composeBuild helpers. Same pipeline the Builds tab uses — so a hero's
   *  Current column here matches their card there. */
  const composition = useMemo<SelectedComposition | null>(() => {
    if (!inventory || !game || !selected) return null;
    const meta = game.characters[String(selected.charId)];
    if (!meta?.ingredients || !game.codexCurve) return null;
    const level = expToLevel(game.expCharacter, selected.exp);
    const lbKey = meta.star != null && selected.levelMaxStep > 0 ? `${meta.star}|${selected.levelMaxStep}` : null;
    const levelMaxModifier = lbKey ? (game.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
    const composed = composeCharStats(meta.ingredients, game.codexCurve, {
      transStar: selected.stars,
      level,
      levelMaxModifier,
      levelMaxStep: selected.levelMaxStep,
      userGeasLevels,
      userSkillLevels: { first: selected.skills.first, second: selected.skills.second, ultimate: selected.skills.ultimate },
      ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
    });
    const equippedPieces = inventory.gear.filter((g) => g.equippedBy === selected.uid);
    const current = computeFinalStats(composed.noGearStats, composed.scaling, equippedPieces, game);
    const sumFlat = (s: { baseValue: number; evoValue: number; awakValue: number }) => s.baseValue + s.evoValue + s.awakValue;
    const baseFlat = { atk: sumFlat(composed.scaling.atk), def: sumFlat(composed.scaling.def), hp: sumFlat(composed.scaling.hp) };
    const dmgStat = meta.dmgStat ?? "atk";
    const amp = (k: "atk" | "def" | "hp") => 1 + (composed.scaling[k]?.buffPct ?? 0) / 100;
    const dmgAmp = { atk: amp("atk"), def: amp("def"), hp: amp("hp") };
    return { current, baseFlat, dmgStat, dmgSec: meta.dmgSec, dmgAmp };
  }, [inventory, game, selected, userGeasLevels, userCodexLevel]);

  /** Selected hero's class (Striker / Mage / …). Null when no hero is picked
   *  yet — the weapon / accessory effect palettes fall back to "all classes"
   *  in that case so the user can scan what's possible. */
  const heroClass = useMemo<string | null>(() => {
    if (!selected || !game) return null;
    return game.characters[String(selected.charId)]?.cls ?? null;
  }, [selected, game]);

  /** Catalogs are inventory-driven: only show options the user has at least
   *  one matching piece for. Otherwise the chip is just clutter for the
   *  optimizer — picking a set / effect with 0 owned matches blocks every
   *  result. */
  const armorSetCatalog = useMemo(() => armorSetCatalogFromInventory(inventory, game), [inventory, game]);
  const weaponEffectCatalog = useMemo(() => effectCatalogFromInventory(inventory, game, "weapon", heroClass), [inventory, game, heroClass]);
  const accessoryEffectCatalog = useMemo(() => effectCatalogFromInventory(inventory, game, "accessory", heroClass), [inventory, game, heroClass]);
  /** Per-slot main-stat catalogs keyed by SlotId — only the variable-main
   *  slots from `MAIN_STAT_SLOTS` appear, each populated by scanning the
   *  inventory for owned pieces. Stats from `STAT_DISPLAY_ORDER` come
   *  first; unknown keys sort last. */
  const mainStatCatalogs = useMemo(() => {
    const out: Record<string, MainStatEntry[]> = {};
    for (const row of MAIN_STAT_SLOTS) {
      out[row.slot] = mainStatCatalogFromInventory(inventory, row.slot, heroClass);
    }
    return out;
  }, [inventory, heroClass]);

  if (!inventory) {
    return <Empty title="No capture yet" subtitle="Arm capture and import your roster to use the Builder." />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2 pb-9">
      <BuilderToolbar
        heroes={inventory.characters}
        game={game}
        selectedUid={selectedUid}
        onSelect={setSelectedUid}
        armorSets={armorSetCatalog}
        weaponEffects={weaponEffectCatalog}
        accessoryEffects={accessoryEffectCatalog}
        mainStatCatalogs={mainStatCatalogs}
        filters={filters}
        dispatch={dispatch}
        solving={solving}
        canSolve={selectedUid != null}
        onSolve={startSolve}
        onCancelSolve={cancelSolve}
        canFilter={solveResults.length > 0 && hasAnyBand}
        filterActive={displayFilter != null}
        onFilter={applyClientFilter}
        onClearFilter={() => setDisplayFilter(null)}
      />
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left column — results table (height-capped so the gear band below
         *  stays visible) stacked over the gear band. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div
            className="flex shrink-0 gap-2"
            // Fixed height at the chosen row count (capped at 15 — the table is
            // virtualized and scrolls for the rest), so it keeps its size and the
            // gear band below yields (scrolls) when space is tight, not the table.
            style={{ height: Math.min(resultRows, 15) * RESULT_ROW_H + 46 }}
          >
            <ResultsTable
              builds={displayedResults}
              selectedIdx={selectedBuildIdx}
              onSelect={setSelectedBuildIdx}
              solving={solving}
              error={solveError}
              emptyReason={emptyReason}
              statFilters={filters.statFilters}
              rows={resultRows}
              onRowsChange={setResultRows}
              pieceByUid={pieceByUid}
              armorSets={armorSetCatalog}
              game={game}
              heatmap={heatmap}
            />
          </div>
          {/* Gear band takes the remaining height and scrolls if the window is
              too short — so the results table above never has to shrink. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <BottomGearBand build={selectedBuild} pieceByUid={pieceByUid} game={game} reforge={resultsReforge} />
          </div>
        </div>
        {/* Right column — spans the FULL height (next to both the results table
         *  AND the gear band) so Current→Projected · Sub tick · Damage · Library
         *  fit without scrolling on a normal window. overflow-y-auto stays as a
         *  safety for very long saved-build lists / short screens. */}
        <div className="flex w-72 shrink-0 flex-col gap-1.5 overflow-y-auto">
          <StatsPanel
            stats={composition?.current ?? null}
            projected={selectedBuild?.finalStats ?? null}
            width="w-full"
          />
          <SubValuePanel baseFlat={composition?.baseFlat ?? null} subTicks={game?.subTicks} width="w-full" />
          <DmgPer1PctPanel comp={composition ?? null} width="w-full" />
          <RightSidebar
            canSave={selectedBuild != null}
            canSavePreset={selectedUid != null}
            onSaveBuild={saveCurrentBuild}
            onSavePreset={saveCurrentPreset}
            canGetPreset={selectedUid != null}
            onGetPreset={() => void getPreset()}
            recoBusy={recoBusy}
            recoStatus={recoStatus}
            savedBuilds={savedBuildsForHero}
            onRestoreBuild={restoreBuild}
            onRemoveBuild={removeBuildById}
            presets={presetsForHero}
            onLoadPreset={loadPreset}
            onRemovePreset={removePresetById}
          />
        </div>
      </div>
      {recoPicker && (
        <RecoBuildPicker
          reco={recoPicker}
          onPick={applyRecoBuild}
          onClose={() => setRecoPicker(null)}
        />
      )}
      {/* Fixed at the viewport bottom — escapes the flex layout via
       *  position:fixed, so the rest of the screen sees an extra
       *  `pb-9` reservation instead of laying out for it. */}
      <FilterFooter
        permutations={solveProgress.permutations}
        searched={solveProgress.searched}
        poolSizes={solveProgress.poolSizes}
        resultCount={displayedResults.length}
        solving={solving}
        workerCount={resolvedWorkers}
      />
      <PromptDialog
        prompt={namePrompt}
        onClose={() => setNamePrompt(null)}
      />
    </div>
  );
}

/** Minimal modal prompt replacing `window.prompt`. Esc cancels, Enter
 *  submits, click outside cancels. Single text field; submits the trimmed
 *  value (or the placeholder when blank). Stays in DOM and renders nothing
 *  when `prompt` is null — no Portal needed (parent screen is full-bleed
 *  inside the app shell). */
function PromptDialog({
  prompt, onClose,
}: {
  prompt: { title: string; placeholder: string; onConfirm: (name: string) => void } | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (prompt) setValue("");
  }, [prompt]);
  if (!prompt) return null;
  const submit = () => {
    prompt.onConfirm(value.trim() || prompt.placeholder);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-80 rounded-lg border border-white/10 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-white/70">{prompt.title}</div>
        <input
          type="text"
          value={value}
          autoFocus
          placeholder={prompt.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/8 px-3 py-1 text-[11px] text-white/70 hover:bg-white/6"
          >Cancel</button>
          <button
            type="button"
            onClick={submit}
            className="rounded border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/25"
          >Save</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Game-data extraction — turns the raw equipment / sets tables into the
 * compact {name, icon} lists the Sets and Weapons/Accessories panels render.
 * ───────────────────────────────────────────────────────────────────────── */
interface ArmorSetEntry {
  id: string;
  name: string;
  icon: string;
  /** Whether the set's T4 row (`level === 2`) defines a 2-piece effect. */
  has2pc: boolean;
  /** Whether the set's T4 row defines a 4-piece effect. Some sets carry
   *  only one of (2pc, 4pc) — the chip cycle skips the missing one. */
  has4pc: boolean;
  /** Whether the inventory can actually form a 2-piece bonus: ≥ 2 owned
   *  pieces spread across ≥ 2 distinct armor slots. A single slot with 2+
   *  duplicates doesn't trigger the in-game 2pc bonus. */
  canForm2pc: boolean;
  /** Whether the inventory can form a 4-piece bonus: ≥ 4 owned pieces
   *  spread across 4 distinct armor slots (helmet + armor + gloves + boots). */
  canForm4pc: boolean;
  /** Number of owned armor pieces belonging to this set. */
  owned: number;
  /** Localized T4 effect descriptions (`SetLevel.p2_desc / p4_desc`).
   *  Null when no curated string exists — chip tooltip falls back to
   *  the bare "no description" marker. */
  desc2pc: string | null;
  desc4pc: string | null;
}
interface EffectEntry {
  /** Unique effect identity = `EquipmentDef.setId` (the game's UniqueOptionID).
   *  This is the filter/dedup key — NOT the icon. Several distinct effects
   *  (e.g. the five Recklessness variants) share one icon, so keying on the
   *  icon collapsed them into one chip and the filter matched all five. */
  key: string;
  /** Icon filename for display only — `/img/ui/effect/<icon>.webp`. May be
   *  shared across different effects; never used as an identity. Null when the
   *  effect has no curated icon (→ the chip shows a text placeholder). */
  icon: string | null;
  /** Effect display name — pulled from `game.equipmentPassives[itemId].name`
   *  (the canonical effect title like "Destruction"), with a fallback to
   *  the equipment item name and finally the effect key. */
  name: string;
  /** Localized T4 effect description (`textByTier[4]`). Same passive applies
   *  to every item sharing this `key` (same UniqueOptionID), so any sample is
   *  canonical. Null when no passive is resolved (data gap). */
  descT4: string | null;
  /** Number of owned weapons / accessories rolling this effect (≥ 1). */
  owned: number;
}
interface MainStatEntry {
  /** Engine stat key from `RolledStat.stat` (e.g. "atkPct", "eff"). Stable
   *  identity for `picks` keying. */
  key: string;
  /** User-facing short label ("ATK%", "EFF", …) — `statLabelFor(key)`. */
  label: string;
  /** Number of owned pieces in this slot whose main matches `key`. */
  owned: number;
}

/** Build the armor-set palette — keep only sets whose currently-owned
 *  pieces can ACTUALLY trigger at least one of the set's T4 bonuses. A
 *  set is dropped when:
 *   - it grants only a 4pc bonus and the inventory has < 4 pieces across
 *     4 distinct slots, OR
 *   - it grants only a 2pc bonus and the inventory has < 2 pieces across
 *     2 distinct slots, OR
 *   - it grants both and neither threshold is reachable.
 *  Icons resolve via the first equipment template carrying each `armorSetId`
 *  (same map the Inventory tab uses). T4 = `setLevel === 2` in the schema. */
function armorSetCatalogFromInventory(inventory: Inventory | null, game: GameData | null): ArmorSetEntry[] {
  if (!game || !inventory) return [];
  const iconBySet = new Map<string, string>();
  for (const e of Object.values(game.equipment)) {
    if (!e.armorSetId || !e.armorSetIcon) continue;
    if (!iconBySet.has(e.armorSetId)) iconBySet.set(e.armorSetId, e.armorSetIcon);
  }
  // Per-set: total owned pieces + distinct armor slots represented. The
  // distinct-slot count is what gates 2pc / 4pc viability (two pieces in
  // the same slot don't trigger 2pc in-game).
  const slotsBySet = new Map<string, Set<string>>();
  const ownedCounts = new Map<string, number>();
  for (const g of inventory.gear) {
    if (!g.armorSetId || !g.slot) continue;
    ownedCounts.set(g.armorSetId, (ownedCounts.get(g.armorSetId) ?? 0) + 1);
    let slots = slotsBySet.get(g.armorSetId);
    if (!slots) { slots = new Set(); slotsBySet.set(g.armorSetId, slots); }
    slots.add(g.slot);
  }
  const out: ArmorSetEntry[] = [];
  for (const [id, def] of Object.entries(game.sets)) {
    const owned = ownedCounts.get(id) ?? 0;
    if (owned === 0) continue;
    const icon = iconBySet.get(id);
    if (!icon) continue;
    const t4 = def.levels.find((l) => l.level === 2);
    const has2pc = !!(t4?.p2 && t4.p2.st !== "ST_NONE" && t4.p2.v != null);
    const has4pc = !!(t4?.p4 && t4.p4.st !== "ST_NONE" && t4.p4.v != null);
    const distinctSlots = slotsBySet.get(id)?.size ?? 0;
    const canForm2pc = owned >= 2 && distinctSlots >= 2;
    const canForm4pc = owned >= 4 && distinctSlots >= 4;
    // Drop sets where no achievable bonus exists.
    const usable2pc = has2pc && canForm2pc;
    const usable4pc = has4pc && canForm4pc;
    if (!usable2pc && !usable4pc) continue;
    out.push({
      id, name: def.name ?? `Set ${id}`, icon,
      has2pc, has4pc, canForm2pc, canForm4pc, owned,
      desc2pc: t4?.p2_desc ?? null,
      desc4pc: t4?.p4_desc ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the per-slot effect palette — only effects the player actually
 *  owns a piece for, gated by the picked hero's class restriction. The
 *  chip's identity is the effect icon (the gear renderer overlays the
 *  same icon on equipped pieces). */
function effectCatalogFromInventory(
  inventory: Inventory | null,
  game: GameData | null,
  slot: "weapon" | "accessory",
  heroClass: string | null,
): EffectEntry[] {
  if (!game || !inventory) return [];
  // Key on the effect IDENTITY (`setId` = UniqueOptionID), not the icon — the
  // icon is shared across distinct effects (the Recklessness family), so icon-
  // keying collapsed five effects into one chip. Store the icon for display.
  const map = new Map<string, { icon: string | null; name: string; descT4: string | null; owned: number }>();
  for (const g of inventory.gear) {
    // Use the design SlotId so the comparison is symmetric with the rest
    // of the panels (weapon/accessory happen to match the engine name 1:1
    // but going through `toDesignSlot` is the cheapest insurance against
    // future slot renames).
    if (toDesignSlot(g.slot) !== slot) continue;
    if (heroClass && g.classLimit && g.classLimit !== heroClass) continue;
    const def = game.equipment[String(g.itemId)];
    if (!def?.setId) continue; // no unique-option effect → not filterable
    const existing = map.get(def.setId);
    if (existing) { existing.owned++; continue; }
    // First-seen effect: snapshot its title + T4 text from this item's passive.
    // Items sharing a `setId` (UniqueOptionID) carry the same passive, so a
    // single sample is canonical. textByTier[4] = T4 (build pipeline already
    // substituted Value/Rate/Turn placeholders).
    const passive = game.equipmentPassives[String(g.itemId)];
    const name = passive?.name ?? def.name ?? def.setId;
    const descT4 = passive?.textByTier?.[4] ?? null;
    map.set(def.setId, { icon: def.effectIcon ?? null, name, descT4, owned: 1 });
  }
  return Array.from(map.entries())
    .map(([key, { icon, name, descT4, owned }]) => ({ key, icon, name, descT4, owned }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Per-slot main-stat catalog — scan owned pieces in `slot`, collect every
 *  distinct main-stat engine key with an owned count, render in the global
 *  `STAT_DISPLAY_ORDER` for stable column alignment across slots. Anything
 *  unrecognized (future exotic talisman / EE buffs) lands at the end with a
 *  fallback label so we don't drop data we don't know about yet.
 *
 *  Two heuristics keep the palette useful:
 *  1. Only count mains tagged `source: "option"` — the real main slot.
 *     `singularity` rolls (ascension extras like "+DMG up" on a weapon) and
 *     `eePassive` rolls are effects, not main-stat configurations the user
 *     picks when crafting, so they don't belong here.
 *  2. Drop stats present on **every** owned piece in the slot — flat ATK on
 *     weapons, for instance: filtering by it would do nothing (every piece
 *     matches), so the chip is just visual noise. */
function mainStatCatalogFromInventory(
  inventory: Inventory | null,
  slot: SlotId,
  heroClass: string | null,
): MainStatEntry[] {
  if (!inventory) return [];
  const counts = new Map<string, number>();
  let total = 0;
  for (const g of inventory.gear) {
    // GearPiece.slot is the engine GearSlot (e.g. "ooparts"); the design
    // SlotId we filter on uses friendlier names ("talisman"). Convert via
    // toDesignSlot so the comparison lines up.
    if (toDesignSlot(g.slot) !== slot) continue;
    if (heroClass && g.classLimit && g.classLimit !== heroClass) continue;
    total++;
    // Dedup per piece — a single piece can list the same stat multiple times
    // across its main rolls (e.g. weapons that buff ATK% twice). Counts here
    // measure "how many pieces have this stat", not "how many rolls".
    const seenInPiece = new Set<string>();
    for (const m of g.main) {
      if (m.combatOnly) continue;
      const src = m.source ?? "option";
      if (src !== "option") continue;
      if (seenInPiece.has(m.stat)) continue;
      seenInPiece.add(m.stat);
      counts.set(m.stat, (counts.get(m.stat) ?? 0) + 1);
    }
  }
  const seen = new Set<string>();
  const out: MainStatEntry[] = [];
  // 1) Known keys in canonical order — drop ubiquitous stats (every piece
  //    has them → filtering useless).
  for (const key of STAT_DISPLAY_ORDER) {
    const owned = counts.get(key);
    if (!owned || owned >= total) continue;
    seen.add(key);
    out.push({ key, label: statLabelFor(key), owned });
  }
  // 2) Anything not in STAT_DISPLAY_ORDER (defensive — surfaces unknowns
  //    instead of silently dropping them).
  for (const [key, owned] of counts) {
    if (seen.has(key)) continue;
    if (owned >= total) continue;
    out.push({ key, label: statLabelFor(key), owned });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Builder toolbar — Direction B (toolbar + popovers). A slim top bar carries
 * the always-needed controls (hero · Solve / Solve CP · two quick toggles);
 * the heavier filters live behind labeled popovers with active-count badges,
 * so the results table below can run near edge-to-edge. Each popover reuses
 * the existing panel components verbatim — only the layout/chrome is new.
 * ───────────────────────────────────────────────────────────────────────── */
function BuilderToolbar({
  heroes, game, selectedUid, onSelect,
  armorSets, weaponEffects, accessoryEffects, mainStatCatalogs,
  filters, dispatch,
  solving, canSolve, onSolve, onCancelSolve,
  canFilter, filterActive, onFilter, onClearFilter,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  armorSets: ArmorSetEntry[];
  weaponEffects: EffectEntry[];
  accessoryEffects: EffectEntry[];
  mainStatCatalogs: Record<string, MainStatEntry[]>;
  filters: SolverFilters;
  dispatch: Dispatch<SolverAction>;
  solving: boolean;
  canSolve: boolean;
  onSolve: (mode: SolveMode) => void;
  onCancelSolve: () => void;
  /** Whether the post-solve Filter action can run (results stored + a band set). */
  canFilter: boolean;
  /** Whether a client filter is currently narrowing the stored results. */
  filterActive: boolean;
  onFilter: () => void;
  onClearFilter: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const close = () => setOpenKey(null);
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));

  // Active-count badges — how many constraints each popover currently holds,
  // so the user can see what's set without opening every one.
  const statCount = Object.keys(filters.statFilters).length;
  const ratingCount = Object.keys(filters.ratingFilters).length;
  const priorityCount = Object.keys(filters.priority).length;
  const mainCount = Object.values(filters.mainPicks)
    .reduce((n, m) => n + Object.values(m).filter(Boolean).length, 0);
  const setCount = filters.setPlans.filter((p) => p.length > 0).length + filters.excludedSets.length;
  const effectCount = Object.keys(filters.weaponEffectPicks).length + Object.keys(filters.accessoryEffectPicks).length;
  // Options badge counts only the constraints NOT surfaced as inline toggles
  // (include-equipped flipped off, keep-current on, plus each excluded hero).
  const optionCount =
    (filters.options.includeEquippedOnOthers ? 0 : 1) +
    (filters.options.keepCurrent ? 1 : 0) +
    (filters.minQuality ? 1 : 0) +
    filters.excludedHeroes.size;

  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-white/8 bg-bg-elev-2 px-2.5 py-2">
      <div className="w-48 shrink-0">
        <HeroSelect heroes={heroes} game={game} value={selectedUid} onChange={onSelect} />
      </div>
      {solving ? (
        <button
          type="button"
          onClick={onCancelSolve}
          className="h-9 shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/10 px-5 text-[12px] font-bold uppercase tracking-wider text-rose-200 transition-colors hover:bg-rose-500/20"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSolve("score")}
          disabled={!canSolve}
          style={{
            background: "linear-gradient(180deg,#22d3ee,#0bb6d4)",
            boxShadow: "0 0 0 1px rgba(34,211,238,0.5),0 6px 16px -6px rgba(34,211,238,0.6)",
          }}
          className="h-9 shrink-0 rounded-lg px-5 text-[12px] font-bold uppercase tracking-wider text-[#06262b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Solve
        </button>
      )}
      <button
        type="button"
        onClick={() => onSolve("cp")}
        disabled={!canSolve || solving}
        className="h-9 shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-400/8 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-400/16 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Solve CP
      </button>
      {/* Post-solve client filter: re-applies the stat/rating bands to the
       *  stored results without re-solving (instant after the first solve). */}
      <button
        type="button"
        onClick={onFilter}
        disabled={!canFilter || solving}
        title="Filter the existing results by the stat/rating bands — no re-solve (instant after the first optimization)."
        className={cx(
          "h-9 shrink-0 rounded-lg border px-3.5 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          filterActive
            ? "border-amber-400/50 bg-amber-400/12 text-amber-200 hover:bg-amber-400/20"
            : "border-white/12 bg-white/4 text-white/70 hover:text-white",
        )}
      >
        Filter
      </button>
      {filterActive && (
        <button
          type="button"
          onClick={onClearFilter}
          title="Show all stored results again."
          className="h-9 shrink-0 rounded-lg px-1 text-[11px] text-white/65 hover:text-white/80"
        >
          ✕
        </button>
      )}
      <ToolbarDivider />
      <ReforgeModeControl value={filters.options.reforgeMode} dispatch={dispatch} />
      <ToolbarToggle
        label="Maxed only"
        on={filters.options.onlyMaxed}
        onClick={() => dispatch({ type: "setOption", key: "onlyMaxed", value: !filters.options.onlyMaxed })}
      />
      <ToolbarDivider />
      <PopoverButton label="Options" count={optionCount} openKey={openKey} myKey="options" onToggle={toggle} onClose={close}>
        <OptionsPanel options={filters.options} minQuality={filters.minQuality} excludedHeroes={filters.excludedHeroes} heroes={heroes} game={game} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Stat filters" count={statCount} openKey={openKey} myKey="stat" onToggle={toggle} onClose={close}>
        <StatFiltersPanel filters={filters.statFilters} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Ratings" count={ratingCount} openKey={openKey} myKey="rating" onToggle={toggle} onClose={close}>
        <RatingFiltersPanel filters={filters.ratingFilters} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Priority" count={priorityCount} accent="violet" openKey={openKey} myKey="priority" onToggle={toggle} onClose={close}>
        <SubstatPriorityPanel priority={filters.priority} topPct={filters.topPct} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Mains" count={mainCount} openKey={openKey} myKey="mains" onToggle={toggle} onClose={close}>
        <AccessoryMainStatsPanel catalogs={mainStatCatalogs} picks={filters.mainPicks} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Sets" count={setCount} accent="violet" align="right" openKey={openKey} myKey="sets" onToggle={toggle} onClose={close}>
        <SetsPanel sets={armorSets} setPlans={filters.setPlans} excludedSets={filters.excludedSets} dispatch={dispatch} />
      </PopoverButton>
      <PopoverButton label="Effects" count={effectCount} align="right" openKey={openKey} myKey="effects" onToggle={toggle} onClose={close}>
        <WeaponsAccessoriesPanel
          weapons={weaponEffects}
          accessories={accessoryEffects}
          weaponPicks={filters.weaponEffectPicks}
          accPicks={filters.accessoryEffectPicks}
          dispatch={dispatch}
        />
      </PopoverButton>
      <button
        type="button"
        onClick={() => dispatch({ type: "resetAll" })}
        className="ml-auto shrink-0 text-[11px] text-white/70 underline-offset-2 hover:text-white/80 hover:underline"
      >
        reset filters
      </button>
    </div>
  );
}

/** Slim divider between toolbar groups. */
function ToolbarDivider() {
  return <span className="h-6 w-px shrink-0 bg-white/10" />;
}

/** Reforge-mode segmented control — Off / Classic / Ascended. Replaces the
 *  old binary "Reforged" toggle: each chip projects pool pieces to a different
 *  endgame ceiling (see REFORGE_MODES). The active chip is highlighted; the
 *  whole strip carries a label so it reads as one control. */
function ReforgeModeControl({ value, dispatch }: { value: ReforgeMode; dispatch: Dispatch<SolverAction> }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 pl-2.5 pr-1">
      <span className="text-[11px] text-white/70">Reforge</span>
      <div className="flex items-center gap-0.5">
        {REFORGE_MODES.map((m) => {
          const on = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => dispatch({ type: "setReforgeMode", value: m.value })}
              aria-pressed={on}
              title={m.hint}
              className={cx(
                "h-5 rounded px-1.5 text-[10.5px] font-semibold transition-colors",
                on ? "bg-cyan-400/20 text-cyan-200" : "text-white/70 hover:text-white/80",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact inline toggle pill (the two always-visible quick options). */
function ToolbarToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "flex h-7 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[11px] transition-colors",
        on ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/4 text-white/70 hover:text-white",
      )}
    >
      <span
        className={cx(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          on ? "border-cyan-400/55 bg-cyan-400/25" : "border-white/10 bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute top-px h-3 w-3 rounded-full transition-all",
            on ? "left-3.25 bg-cyan-300" : "left-px bg-zinc-400",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/** Toolbar popover trigger — a labeled pill with an optional active-count
 *  badge that floats its children (an existing filter panel) below on click.
 *  Only one popover is open at a time (driven by the parent's `openKey`);
 *  outside-click and Escape close it. `accent` tints the active state /
 *  badge (cyan default, violet for priority/sets). `align="right"` anchors
 *  the floating panel to the trigger's right edge so right-side popovers
 *  don't overflow the viewport. */
function PopoverButton({
  label, count, accent = "cyan", align = "left", openKey, myKey, onToggle, onClose, children,
}: {
  label: string;
  count: number;
  accent?: "cyan" | "violet";
  align?: "left" | "right";
  openKey: string | null;
  myKey: string;
  onToggle: (k: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const open = openKey === myKey;
  const ref = useClickOutside<HTMLDivElement>(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const activeTone = accent === "violet"
    ? "border-violet-400/50 bg-violet-400/12 text-violet-200 shadow-[0_0_16px_-4px_rgba(157,81,255,0.5)]"
    : "border-cyan-400/50 bg-cyan-400/12 text-cyan-200 shadow-[0_0_16px_-4px_rgba(34,211,238,0.5)]";
  const badgeTone = accent === "violet" ? "bg-violet-400/25 text-violet-200" : "bg-cyan-400/20 text-cyan-200";
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onToggle(myKey)}
        aria-expanded={open}
        className={cx(
          "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors",
          open ? activeTone : "border-white/10 bg-white/4 text-white/70 hover:text-white",
        )}
      >
        {label}
        {count > 0 && (
          <span className={cx("rounded px-1.5 font-mono text-[9px] tabular-nums", badgeTone)}>{count}</span>
        )}
        <span className="text-[8px] text-white/65">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={cx("absolute top-[calc(100%+8px)] z-40 rounded-lg bg-bg-elev-1 shadow-2xl shadow-black/70", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}

function Panel({ title, hint, action, children, width }: {
  title: string;
  hint?: string;
  /** Optional small trailing element rendered next to the title (e.g. a
   *  "clear" link for the Substat priority panel). */
  action?: ReactNode;
  children: ReactNode;
  /** Tailwind width class — most panels are 36 or 44, the Stat/Rating
   *  filters need more headroom. */
  width: string;
}) {
  return (
    <section className={cx("shrink-0 rounded-lg border border-white/8 bg-bg-elev-2 p-2", width)}>
      <header className="flex items-center justify-between gap-1">
        {hint ? (
          <HoverHint
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70"
            name={title}
            text={hint}
          />
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{title}</span>
        )}
        {action}
      </header>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function ActionButton({
  children, tone = "neutral", onClick, disabled,
}: { children: ReactNode; tone?: "primary" | "neutral"; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        tone === "primary"
          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
          : "border-white/8 bg-white/4 text-white hover:bg-white/8",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

/** Close-on-outside-click for a popup. Returns a ref to attach to the wrapper;
 *  while `active`, a `mousedown` outside the wrapper fires `onOutside`. The
 *  callback is held in a ref so the effect only re-subscribes when `active`
 *  flips (not on every render when the caller passes an inline closure). */
function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active]);
  return ref;
}

/** Hero search haystack — shared between `HeroSelect` and
 *  `ExcludeHeroesPicker`. Same matching the Builds tab uses: display name +
 *  raw name + nickname + charId, plus a "core fusion" tag for fused chars
 *  so the user can find them by typing "core" or "fusion". */
function heroSearchHaystack(c: Character, game: GameData | null): string {
  const meta = game?.characters[String(c.charId)] ?? null;
  const fusionTag = c.fusionCharId !== 0 ? "core fusion" : "";
  return `${fusionTag} ${displayNameOf(c, meta)} ${meta?.nickname ?? ""} ${c.name ?? ""} ${c.charId}`.toLowerCase();
}

/** Searchable hero combobox (kept compact for the Hero panel — input fits
 *  inside w-44 with room for the portrait below). Escape closes the popup. */
function HeroSelect({
  heroes, game, value, onChange,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  value: string | null;
  onChange: (uid: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Keyboard-highlighted option index (distinct from the currently-selected
  // `value`). Reset to the top whenever the list changes or the popup opens.
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const selected = value ? heroes.find((c) => c.uid === value) ?? null : null;
  const selectedName = selected ? displayNameOf(selected, game?.characters[String(selected.charId)] ?? null) : "";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((c) => heroSearchHaystack(c, game).includes(q));
  }, [heroes, game, query]);
  useEffect(() => { setActiveIdx(0); }, [query, open]);
  const display = open ? query : selectedName;
  const pick = (c: Character | undefined) => {
    if (!c) return;
    onChange(c.uid); setOpen(false); setQuery("");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(filtered[activeIdx]); }
  };
  const activeId = open && filtered[activeIdx] ? `hero-opt-${filtered[activeIdx]!.uid}` : undefined;
  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="hero-listbox"
        aria-activedescendant={activeId}
        value={display}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={onKeyDown}
        placeholder={selectedName || "Search hero…"}
        className="w-full rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[11.5px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</div>
          ) : (
            <ul id="hero-listbox" role="listbox" className="flex flex-col py-1">
              {filtered.map((c, i) => (
                <HeroOption
                  key={c.uid}
                  id={`hero-opt-${c.uid}`}
                  hero={c}
                  game={game}
                  active={c.uid === value}
                  highlighted={i === activeIdx}
                  onPick={() => pick(c)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function HeroOption({
  id, hero, game, active, highlighted, onPick,
}: { id: string; hero: Character; game: GameData | null; active: boolean; highlighted: boolean; onPick: () => void }) {
  const meta = game?.characters[String(hero.charId)] ?? null;
  const name = displayNameOf(hero, meta);
  const ref = useRef<HTMLLIElement>(null);
  // Keep the keyboard-highlighted option in view as the user arrows through.
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: "nearest" }); }, [highlighted]);
  return (
    <li ref={ref} id={id} role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onPick}
        className={cx(
          "flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-white/6",
          highlighted && "bg-white/8",
          active && "bg-cyan-500/10",
        )}
      >
        <CharacterPortrait
          charId={hero.charId}
          name={name}
          cls={meta?.cls}
          element={meta?.element}
          size={26}
        />
        <span className="truncate text-[11.5px] text-white">{name}</span>
      </button>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Stats panel — current → new, side by side
 * ───────────────────────────────────────────────────────────────────────── */
function StatsPanel({ stats, projected, width = "w-44" }: { stats: FinalStats | null; projected: FinalStats | null; width?: string }) {
  return (
    <Panel title="Current → Projected" hint="Current stats on the left, projected stats from the selected build on the right." width={width}>
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
        {SOLVER_STATS.map((s) => (
          <StatsPanelRow key={s.key} stat={s} stats={stats} projected={projected} />
        ))}
      </div>
    </Panel>
  );
}

function StatsPanelRow({
  stat, stats, projected,
}: { stat: typeof SOLVER_STATS[number]; stats: FinalStats | null; projected: FinalStats | null }) {
  const cur = stats ? stats[stat.key as keyof FinalStats] : null;
  const proj = projected ? projected[stat.key as keyof FinalStats] : null;
  // Color the projected column by delta vs current so the user sees at a
  // glance which axes improve / regress on the selected build.
  let projTone = "text-cyan-300/40";
  if (proj != null && cur != null) {
    if (proj > cur) projTone = "text-emerald-300";
    else if (proj < cur) projTone = "text-rose-300";
    else projTone = "text-white/60";
  } else if (proj != null) {
    projTone = "text-cyan-300";
  }
  return (
    <>
      <StatIcon stat={stat.iconKey} size={12} />
      <span className={cx("text-right", cur != null ? "text-white" : "text-white/55")}>
        {cur != null ? `${cur}${stat.unit}` : "—"}
      </span>
      <span className="text-white/65">▸</span>
      <span className={cx("text-right", projTone)}>
        {proj != null ? `${proj}${stat.unit}` : "—"}
      </span>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Sub tick value — flat vs % rentability for ATK / DEF / HP
 * ───────────────────────────────────────────────────────────────────────── */
const SUB_VALUE_STATS = [
  { key: "atk", pctKey: "atkPct", label: "ATK" },
  { key: "def", pctKey: "defPct", label: "DEF" },
  { key: "hp", pctKey: "hpPct", label: "HP" },
] as const;

/** Per-tick flat-vs-% sub value for the picked hero. A %-tick scales with the
 *  hero's no-gear base (base+evo+awak), a flat tick is constant — so which is
 *  worth more depends only on the hero. Reference = 6★ substats. Hidden until a
 *  hero is picked and the sub-tick table is present. */
function SubValuePanel({ baseFlat, subTicks, width = "w-full" }: {
  baseFlat: { atk: number; def: number; hp: number } | null;
  subTicks: GameData["subTicks"] | undefined;
  width?: string;
}) {
  const tier = subTicks?.["6"];
  if (!baseFlat || !tier) return null;
  const rows = SUB_VALUE_STATS.map((s) => {
    const flat = tier[s.key];
    const pct = tier[s.pctKey];
    if (!flat || !pct) return null;
    const base = baseFlat[s.key];
    return { key: s.key, label: s.label, cmp: flatVsPctTick(base, flat.step, pct.step) };
  }).filter((r): r is NonNullable<typeof r> => r != null);
  if (rows.length === 0) return null;
  return (
    <Panel
      title="Sub tick value"
      hint="Per 6★ substat tick: flat vs %. A %-tick scales with the hero's base (base+evo+awak); flat is fixed. The cyan side is the more valuable sub to roll for this hero — % overtakes flat above the breakeven base shown."
      width={width}
    >
      <div className="grid grid-cols-[auto_1fr_1.4fr] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tabular-nums">
        <span />
        <span className="text-right text-[8.5px] uppercase tracking-wider text-white/65">flat</span>
        <span className="text-right text-[8.5px] uppercase tracking-wider text-white/65">% (≈ flat)</span>
        {rows.map((r) => (
          <Fragment key={r.key}>
            <StatIcon stat={r.key} size={12} />
            <span className={cx("text-right", r.cmp.winner === "flat" ? "text-cyan-300" : "text-white/65")}>
              +{r.cmp.flatTick}
            </span>
            <span className={cx("text-right", r.cmp.winner === "pct" ? "text-cyan-300" : "text-white/65")}>
              +{r.cmp.pctTick}% <span className="text-white/55">≈{Math.round(r.cmp.pctFlatEquiv)}</span>
            </span>
          </Fragment>
        ))}
      </div>
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Damage / +1% — expected-damage gain from +1% of each relevant stat
 * ───────────────────────────────────────────────────────────────────────── */
const DMG_STAT_ICON: Record<string, { iconKey: string; label: string }> = {
  atk: { iconKey: "atk", label: "ATK" },
  def: { iconKey: "def", label: "DEF" },
  hp: { iconKey: "hp", label: "HP" },
  spd: { iconKey: "spd", label: "SPD" },
  chd: { iconKey: "critDmg", label: "CHD" },
  dmgUp: { iconKey: "dmgUp", label: "DMG UP%" },
};

/** Expected-damage gain from **+1%** of each relevant stat for the picked hero,
 *  computed at the **crit cap (100% CHC)** — the endgame theorycraft baseline you
 *  build toward (otherwise CHD is undervalued). Compares the hero's scaling
 *  stat(s) (ATK / DEF / HP per `dmgStat` + `dmgSec`) vs CHD vs DMG inc, ranked,
 *  best in cyan. A "1%" of a scaling stat = a 1% sub → `base × 1% × (1+buffRate)`
 *  added to the final; CHD / DMG-UP are additive (+1). Reuses the validated
 *  `computeCheapRatings` model (crit folded into the hit rate per the binary). */
function DmgPer1PctPanel({ comp, width = "w-full" }: {
  comp: SelectedComposition | null;
  width?: string;
}) {
  if (!comp) return null;
  const { current, baseFlat, dmgStat, dmgSec, dmgAmp } = comp;
  // Evaluate at 100% crit — the crit-cap baseline (so CHD is valued at full
  // weight, matching how endgame builds reach the cap via gems/buffs).
  const atCap: FinalStats = { ...current, crc: 100 };
  // Scaling stats = main dmg stat + any additive secondary stats (deduped).
  const scalingStats = Array.from(new Set<"atk" | "def" | "hp" | "spd">([dmgStat, ...(dmgSec?.map((s) => s.stat) ?? [])]));
  const candidates: DmgTickCandidate[] = scalingStats.map((s) => ({
    key: s, label: DMG_STAT_ICON[s]!.label, field: s,
    // ATK/DEF/HP: a 1% sub = base × 1% × (1+buffRate). SPD subs are flat, so a
    // "1%" there is read as 1% of the hero's current speed (current.spd × 1%).
    delta: s === "spd" ? current.spd / 100 : (baseFlat[s] * dmgAmp[s]) / 100,
  }));
  candidates.push({ key: "chd", label: "CHD", field: "chd", delta: 1 });
  candidates.push({ key: "dmgUp", label: "DMG UP%", field: "dmgUp", delta: 1 });
  const gains = dmgTickGains(atCap, dmgStat, dmgSec, candidates);
  if (gains.length === 0) return null;
  const bestKey = gains[0]!.gainPct > 0 ? gains[0]!.key : null;
  return (
    <Panel
      title="Damage / +1% · 100% crit"
      hint="Expected-damage gain from +1% of each stat for this hero, computed at the crit cap (100% CHC) — the endgame baseline you build toward (below the cap, CHD is undervalued). Compares the hero's scaling stat(s), CHD and DMG inc. For ATK/DEF/HP, +1% = a 1% sub (base × 1%, through the hero's multipliers); CHD / DMG inc = +1 point; SPD (for SPD-scalers, flat subs) = 1% of the hero's speed. Cyan = where 1% buys the most damage. Uses the in-game crit / DMG± / PEN model."
      width={width}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tabular-nums">
        {gains.map((g) => {
          const icon = DMG_STAT_ICON[g.key]!;
          const best = g.key === bestKey;
          return (
            <Fragment key={g.key}>
              <StatIcon stat={icon.iconKey} size={12} />
              <span className={best ? "text-cyan-300" : "text-white/70"}>{icon.label}</span>
              <span className={cx("text-right", best ? "text-cyan-300" : "text-white/65")}>+{g.gainPct.toFixed(2)}%</span>
            </Fragment>
          );
        })}
      </div>
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Options panel — pool / steal toggles + exclude-heroes multi-pill
 * ───────────────────────────────────────────────────────────────────────── */
function OptionsPanel({
  options, minQuality, excludedHeroes, heroes, game, dispatch,
}: {
  options: SolverOptions;
  minQuality: QualityTier | null;
  excludedHeroes: ReadonlySet<string>;
  heroes: Inventory["characters"];
  game: GameData | null;
  dispatch: Dispatch<SolverAction>;
}) {
  const set = (key: Exclude<keyof SolverOptions, "reforgeMode">) => (v: boolean) => dispatch({ type: "setOption", key, value: v });
  return (
    <Panel title="Options" hint="Pool toggles. Equipped items + Exclude equipped together drive what gear the solver may touch. (Reforged / Maxed-only live as quick toggles in the toolbar.)" width="w-52">
      <div className="space-y-0.5">
        <ToggleRow label="Equipped items" hint="Include gear equipped on other heroes (own hero always in)." checked={options.includeEquippedOnOthers} onChange={set("includeEquippedOnOthers")} />
        <ToggleRow label="Keep current" hint="Lock current pieces (only fill empty slots). Gems are still re-allocated — useful for 'keep my gear, tell me which gems to socket'." checked={options.keepCurrent} onChange={set("keepCurrent")} />
      </div>
      <label className="mt-2 flex items-center justify-between gap-2" title="Drop gear below this rolled-substat quality from the pool. Talisman / EE have no quality and are always kept.">
        <span className="text-[11px] text-white/80">Min quality</span>
        <select
          value={minQuality ?? ""}
          onChange={(e) => dispatch({ type: "setMinQuality", value: (e.target.value || null) as QualityTier | null })}
          className="rounded-md border border-white/8 bg-black/30 px-1.5 py-0.5 text-[11px] text-white focus:border-cyan-400/40 focus:outline-none"
        >
          <option value="">Any</option>
          {QUALITY_TIERS.map((q) => (
            <option key={q} value={q}>{QUALITY_LABEL[q]}</option>
          ))}
        </select>
      </label>
      <div className="mt-2">
        <ExcludeHeroesPicker
          excluded={excludedHeroes}
          heroes={heroes}
          game={game}
          onToggle={(uid) => dispatch({ type: "toggleHeroExcluded", uid })}
          onClear={() => dispatch({ type: "clearExcludedHeroes" })}
        />
      </div>
    </Panel>
  );
}

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/4" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
      />
      <span className="truncate text-[11px] text-white">{label}</span>
    </label>
  );
}

/** Combobox-style multi-select for "Exclude equipped" — drops all gear
 *  currently equipped on the listed heroes from the solver's pool. Closed
 *  state shows count + clear ✕; open state is a searchable list of heroes
 *  with checkboxes. Reuses the Hero picker haystack (display name +
 *  nickname + charId + 'core fusion' tag). */
function ExcludeHeroesPicker({
  excluded, heroes, game, onToggle, onClear,
}: {
  excluded: ReadonlySet<string>;
  heroes: Inventory["characters"];
  game: GameData | null;
  onToggle: (uid: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((c) => heroSearchHaystack(c, game).includes(q));
  }, [heroes, game, query]);
  return (
    // Two sibling buttons inside a flex wrapper instead of a nested
    // <span role="button"> inside the toggle <button> — the previous shape
    // was invalid HTML and not keyboard-reachable for the clear action.
    <div
      ref={wrapRef}
      className="relative flex w-full items-center gap-0 rounded-md border border-white/8 bg-black/30 text-[11px] text-white/70 hover:bg-white/6"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-1 items-center justify-between gap-1.5 px-2 py-1 text-left focus:outline-none"
        title="Drop gear currently equipped on these heroes from the solver's candidate pool."
      >
        <span className="truncate">
          {excluded.size === 0 ? "Exclude equipped" : `Excluded: ${excluded.size}`}
        </span>
        <span className="text-white/55">▾</span>
      </button>
      {excluded.size > 0 && (
        <button
          type="button"
          onClick={() => onClear()}
          className="px-1.5 py-1 text-white/65 hover:text-rose-300 focus:outline-none"
          title="Clear all"
          aria-label="Clear all excluded heroes"
        >✕</button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-72 flex-col overflow-hidden rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            autoFocus
            placeholder="Search hero…"
            className="shrink-0 border-b border-white/8 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/55 focus:outline-none"
          />
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</li>
            ) : filtered.map((c) => {
              const meta = game?.characters[String(c.charId)] ?? null;
              const checked = excluded.has(c.uid);
              return (
                <li key={c.uid}>
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-white/6">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(c.uid)}
                      className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
                    />
                    <span className="truncate text-[11.5px] text-white">{displayNameOf(c, meta)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Stat filters panel — min ≤ X ≤ max per raw stat
 * ───────────────────────────────────────────────────────────────────────── */
function StatFiltersPanel({ filters, dispatch }: { filters: Record<string, MinMax>; dispatch: Dispatch<SolverAction> }) {
  return (
    <Panel
      title="Stat filters"
      hint="Min ≤ stat ≤ Max. Applied pre-solve and re-runnable post-solve via Filter."
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-1 gap-y-0.5">
        {SOLVER_STATS.map((s) => {
          const cur = filters[s.key] ?? {};
          return (
            <FilterRow
              key={s.key}
              iconKey={s.iconKey}
              minValue={cur.min}
              maxValue={cur.max}
              onMin={(v) => dispatch({ type: "setStatFilter", stat: s.key, bound: "min", value: v })}
              onMax={(v) => dispatch({ type: "setStatFilter", stat: s.key, bound: "max", value: v })}
            />
          );
        })}
      </div>
    </Panel>
  );
}

function FilterRow({
  iconKey, label, minValue, maxValue, onMin, onMax,
}: {
  iconKey?: string;
  label?: string;
  minValue: number | undefined;
  maxValue: number | undefined;
  onMin: (v: number | undefined) => void;
  onMax: (v: number | undefined) => void;
}) {
  // Inverted bound (min > max) silently returns zero builds — surface it as
  // a rose tint on both inputs so the user sees the misconfig at a glance.
  const inverted = minValue != null && maxValue != null && minValue > maxValue;
  return (
    <>
      <div className="flex w-12 items-center gap-1 text-[10.5px] text-white/70">
        {iconKey && <StatIcon stat={iconKey} size={12} />}
        {label && <span className="truncate">{label}</span>}
      </div>
      <FilterInput value={minValue} onChange={onMin} invalid={inverted} title={inverted ? "Min > Max — no build can match." : undefined} />
      <FilterInput value={maxValue} onChange={onMax} invalid={inverted} title={inverted ? "Min > Max — no build can match." : undefined} />
    </>
  );
}

function FilterInput({
  value, onChange, invalid, title,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  invalid?: boolean;
  title?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ""}
      title={title}
      // Prevent the scroll wheel from silently changing a focused filter value
      // (a common type=number footgun) — blur instead so the page scrolls.
      onWheel={(e) => e.currentTarget.blur()}
      onChange={(e) => {
        const t = e.target.value;
        if (t === "") { onChange(undefined); return; }
        const n = Number(t);
        // Reject negatives — `min={0}` only constrains the spinner buttons,
        // not direct keyboard input. Filter ranges are unsigned by spec.
        if (!Number.isFinite(n) || n < 0) return;
        onChange(n);
      }}
      className={cx(
        "min-w-0 rounded border bg-black/30 px-1 py-0.5 text-right text-[10.5px] font-mono tabular-nums text-white focus:outline-none",
        invalid
          ? "border-rose-400/60 focus:border-rose-300"
          : "border-white/8 focus:border-cyan-400/40",
      )}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Rating filters panel — same min/max model on calculated build ratings
 * ───────────────────────────────────────────────────────────────────────── */
function RatingFiltersPanel({ filters, dispatch }: { filters: Record<string, MinMax>; dispatch: Dispatch<SolverAction> }) {
  return (
    <Panel
      title="Rating filters"
      hint="Same as Stat filters but on calculated ratings (DPS, EHP, …). Score and Upg are derived in the solver."
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-1 gap-y-0.5">
        {SOLVER_RATINGS.map((r) => (
          <RatingFilterRow
            key={r.key}
            ratingKey={r.key}
            label={r.label}
            title={`${r.formula} — ${r.desc}`}
            filters={filters}
            dispatch={dispatch}
          />
        ))}
        <RatingFilterRow ratingKey="score" label="Score" title="Aggregate score from priorities + rating filters." filters={filters} dispatch={dispatch} />
        <RatingFilterRow ratingKey="upg" label="Upg" title="Number of slots improved over the current build." filters={filters} dispatch={dispatch} />
      </div>
    </Panel>
  );
}

function RatingFilterRow({
  ratingKey, label, title, filters, dispatch,
}: {
  ratingKey: string;
  label: string;
  title?: string;
  filters: Record<string, MinMax>;
  dispatch: Dispatch<SolverAction>;
}) {
  const cur = filters[ratingKey] ?? {};
  return (
    <>
      <div className="w-12 truncate text-[10.5px] text-white/70" title={title}>{label}</div>
      <FilterInput value={cur.min} onChange={(v) => dispatch({ type: "setRatingFilter", rating: ratingKey, bound: "min", value: v })} />
      <FilterInput value={cur.max} onChange={(v) => dispatch({ type: "setRatingFilter", rating: ratingKey, bound: "max", value: v })} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Substat priority panel — per-stat -1..3 + Top % slider
 * ───────────────────────────────────────────────────────────────────────── */
function SubstatPriorityPanel({
  priority, topPct, dispatch,
}: {
  priority: Record<string, number>;
  topPct: number;
  dispatch: Dispatch<SolverAction>;
}) {
  // The Top-% prune is gated on having at least one non-zero priority (the
  // engine skips it otherwise — scoring every piece 0 would prune arbitrarily).
  // Surface that so a user lowering Top % with no priorities set isn't puzzled
  // when nothing changes.
  const hasPriority = Object.values(priority).some((v) => v !== 0);
  return (
    <Panel
      title="Substat priority"
      hint="Score gear by Σ(max-rolls × priority); only keep the Top % per slot. Heuristic — too low a Top % drops optimal builds. Top % needs at least one priority set to take effect."
      action={
        <button
          type="button"
          onClick={() => dispatch({ type: "clearPriority" })}
          className="text-[10px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200"
          title="Reset every priority to 0."
        >
          (clear)
        </button>
      }
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {SOLVER_STATS.map((s) => (
          <SubstatPriorityPanelRow
            key={s.key}
            stat={s}
            value={priority[s.key] ?? 0}
            onChange={(v) => dispatch({ type: "setPriority", stat: s.key, value: v })}
          />
        ))}
      </div>
      <div className={cx("mt-2 flex items-center gap-2 border-t border-white/6 pt-2", !hasPriority && "opacity-60")}>
        <span className="text-[10.5px] uppercase tracking-wider text-white/60">Top %</span>
        <input
          type="range"
          min={5}
          max={100}
          step={1}
          value={topPct}
          onChange={(e) => dispatch({ type: "setTopPct", value: Number(e.target.value) })}
          className="min-w-0 flex-1 accent-cyan-400"
        />
        <span className="w-7 text-right font-mono text-[11px] tabular-nums text-white">{topPct}</span>
      </div>
      {topPct < 100 && !hasPriority && (
        <div className="mt-1 text-[10px] leading-snug text-amber-300/80">
          No effect yet — set a substat priority above for the Top % to filter.
        </div>
      )}
    </Panel>
  );
}

function SubstatPriorityPanelRow({
  stat, value, onChange,
}: { stat: typeof SOLVER_STATS[number]; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <StatIcon stat={stat.iconKey} size={14} className="pointer-events-none shrink-0" />
      <input
        type="range"
        min={-1}
        max={3}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-cyan-400"
      />
      <span className="w-4 text-right font-mono text-[10px] tabular-nums text-white">{value}</span>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Accessory main stats panel — per-slot OR-list of acceptable mains
 * ───────────────────────────────────────────────────────────────────────── */
function AccessoryMainStatsPanel({
  catalogs, picks, dispatch,
}: {
  catalogs: Record<string, MainStatEntry[]>;
  picks: Record<string, Record<string, boolean>>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Main stats"
      hint="Acceptable main stats per slot (OR). Only options you own at least one piece for are shown — picking an option the inventory has zero of would block every result."
      width="w-48"
    >
      <div className="space-y-1.5">
        {MAIN_STAT_SLOTS.map((row) => (
          <MainStatRow
            key={row.slot}
            label={row.label}
            entries={catalogs[row.slot] ?? []}
            picks={picks[row.slot] ?? {}}
            onToggle={(statKey) => dispatch({ type: "toggleMainPick", slot: row.slot, stat: statKey })}
          />
        ))}
      </div>
    </Panel>
  );
}

function MainStatRow({
  label, entries, picks, onToggle,
}: {
  label: string;
  entries: ReadonlyArray<MainStatEntry>;
  picks: Record<string, boolean>;
  onToggle: (statKey: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/70">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {entries.length === 0 ? (
          <span className="text-[10.5px] italic text-white/55">none owned</span>
        ) : (
          entries.map((e) => (
            <MainStatChip key={e.key} entry={e} picked={!!picks[e.key]} onClick={() => onToggle(e.key)} />
          ))
        )}
      </div>
    </div>
  );
}

/** Square icon chip for a main-stat OR-pick. Click toggles selection.
 *  Percent variants overlay a tiny `%` badge so ATK% reads distinctly from
 *  the flat ATK option. */
function MainStatChip({ entry, picked, onClick }: { entry: MainStatEntry; picked: boolean; onClick: () => void }) {
  const iconKey = statIconKeyFor(entry.key);
  const isPercent = entry.key.endsWith("Pct");
  return (
    <button
      type="button"
      title={`${entry.label} — ${entry.owned} owned · ${picked ? "selected (click to clear)" : "click to allow"}`}
      onClick={onClick}
      className={cx(
        "relative grid h-7 w-7 place-items-center rounded-md border transition-colors",
        picked
          ? "border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20"
          : "border-white/10 bg-white/2 opacity-55 hover:opacity-100 hover:bg-white/6",
      )}
    >
      {/* `pointer-events-none` keeps the inner img / span from capturing
       *  the hover — otherwise StatIcon's own `title={meta.label}` would
       *  shadow this button's rich "{stat} — N owned" tooltip on icons
       *  that resolved to a real image (the text fallback span has no
       *  title so it doesn't shadow). */}
      <StatIcon stat={iconKey} size={16} className="pointer-events-none" />
      {isPercent && (
        <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 grid h-3 w-3 place-items-center rounded-full bg-zinc-900 font-mono text-[8px] font-bold text-white">
          %
        </span>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Sets panel — required / piece-count requirements + exclude lists
 * ───────────────────────────────────────────────────────────────────────── */
function SetsPanel({
  sets, setPlans, excludedSets, dispatch,
}: {
  sets: ArmorSetEntry[];
  setPlans: SetPlan[];
  excludedSets: string[];
  dispatch: Dispatch<SolverAction>;
}) {
  // Two authoring modes share the one icon grid: "require" edits the active
  // plan (a build matches if ANY plan holds), "exclude" toggles the global
  // ban list (orthogonal to plans).
  const [mode, setMode] = useState<"require" | "exclude">("require");
  const [activePlan, setActivePlan] = useState(0);
  const plans = setPlans.length > 0 ? setPlans : [[]];
  const active = Math.min(activePlan, plans.length - 1);
  const activeConds = plans[active] ?? [];
  const excluded = useMemo(() => new Set(excludedSets), [excludedSets]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sets) m.set(s.id, s.name);
    return m;
  }, [sets]);

  const chipState = (s: ArmorSetEntry): SetChipState => {
    if (mode === "exclude") return excluded.has(s.id) ? "excluded" : "off";
    const c = activeConds.find((x) => x.setId === s.id)?.count ?? 0;
    return c === 4 ? "req-4pc" : c === 2 ? "req-2pc" : "off";
  };
  const onChip = (s: ArmorSetEntry) => {
    if (mode === "exclude") { dispatch({ type: "toggleExcludedSet", setId: s.id }); return; }
    dispatch({
      type: "cycleSetInPlan", planIdx: active, setId: s.id,
      reach: { has2pc: s.has2pc, has4pc: s.has4pc, canForm2pc: s.canForm2pc, canForm4pc: s.canForm4pc },
    });
  };

  // Read-only summary of the whole OR constraint (only non-empty plans).
  const summary = plans
    .filter((p) => p.length > 0)
    .map((p) => p.map((c) => `${nameById.get(c.setId) ?? c.setId} ×${c.count}`).join(" + "))
    .join("  OR  ");

  const hint = mode === "require"
    ? "Each plan is an AND group (e.g. 2pc A + 2pc B). A build matches if ANY plan holds. Click a set to cycle off → 2pc → 4pc → off in the active plan; + OR adds an alternative. Skips steps the inventory can't form."
    : "Click a set to exclude it from every build (orthogonal to the require plans). Click again to clear.";

  return (
    <Panel title="Sets" hint={hint} width="w-60">
      <div className="mb-2 inline-flex rounded-md border border-white/10 bg-white/2 p-0.5 text-[10.5px]">
        {(["require", "exclude"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cx(
              "rounded px-2 py-0.5 capitalize transition-colors",
              mode === m ? "bg-cyan-500/20 text-cyan-100" : "text-white/70 hover:text-white/80",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "require" && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {plans.map((p, i) => (
            <PlanTab
              key={i}
              label={`Plan ${i + 1}`}
              count={p.length}
              active={i === active}
              onSelect={() => setActivePlan(i)}
              onRemove={plans.length > 1 ? () => {
                dispatch({ type: "removePlan", planIdx: i });
                setActivePlan((a) => (a >= i && a > 0 ? a - 1 : a));
              } : undefined}
            />
          ))}
          <button
            type="button"
            onClick={() => { dispatch({ type: "addPlan" }); setActivePlan(plans.length); }}
            className="rounded border border-white/10 bg-white/2 px-1.5 py-0.5 text-[10.5px] text-white/60 hover:bg-white/8 hover:text-white"
            title="Add an OR-alternative group"
          >
            + OR
          </button>
        </div>
      )}

      {sets.length === 0 ? (
        <div className="text-[11px] italic text-white/65">No forms-anything set in inventory</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {sets.map((s) => (
            <SetIconChip key={s.id} set={s} state={chipState(s)} mode={mode} onClick={() => onChip(s)} />
          ))}
        </div>
      )}

      {mode === "require" && summary && (
        <div className="mt-2 text-[10px] leading-snug text-white/70">
          <span className="text-white/65">Match: </span>{summary}
        </div>
      )}
    </Panel>
  );
}

/** One OR-alternative tab. Shows the plan label + a cond count badge; the ✕
 *  (when removable) deletes the plan. Clicking the body selects it for editing. */
function PlanTab({
  label, count, active, onSelect, onRemove,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
        active ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100" : "border-white/10 bg-white/2 text-white/70 hover:text-white/85",
      )}
    >
      <button type="button" onClick={onSelect} className="flex items-center gap-1">
        {label}
        {count > 0 && <span className="rounded-sm bg-white/10 px-1 text-[9px] tabular-nums">{count}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-white/65 hover:text-rose-300"
          title="Remove this group"
          aria-label={`Remove ${label}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Weapons & Accessories panel — effect-icon-based pick lists. Each chip is
 * the in-game effect icon (e.g. ATK%, CHC) that identifies the piece. The
 * solver keeps only pieces whose effect is among the picked icons.
 * ───────────────────────────────────────────────────────────────────────── */
function WeaponsAccessoriesPanel({
  weapons, accessories, weaponPicks, accPicks, dispatch,
}: {
  weapons: EffectEntry[];
  accessories: EffectEntry[];
  weaponPicks: Record<string, ChipState>;
  accPicks: Record<string, ChipState>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Weapons & accessories"
      hint="Click an effect to cycle off → required → excluded. Empty = solver may use every effect."
      width="w-60"
    >
      <div className="space-y-2">
        <EffectGroup
          title="Weapons"
          effects={weapons}
          picks={weaponPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "weapon", key })}
        />
        <EffectGroup
          title="Accessories"
          effects={accessories}
          picks={accPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "accessory", key })}
        />
      </div>
    </Panel>
  );
}

function EffectGroup({
  title, effects, picks, onCycle,
}: {
  title: string;
  effects: EffectEntry[];
  picks: Record<string, ChipState>;
  onCycle: (key: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/70">{title}</div>
      {effects.length === 0 ? (
        <div className="text-[10.5px] italic text-white/65">none</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {effects.map((e) => (
            <EffectIconChip
              key={e.key}
              effect={e}
              state={picks[e.key] ?? "off"}
              onClick={() => onCycle(e.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Icon chip atoms — shared by Sets and Weapons & accessories. Click cycles
 * the chip through its valid states; the surrounding panel owns the state
 * map. Two state machines:
 *  - effect chips:   off → required → excluded → off
 *  - set chips (require mode): off → req-2pc → req-4pc → off in the active plan
 *  - set chips (exclude mode): off → excluded → off (global ban list)
 *                    (each step the inventory/set can't form is skipped —
 *                    cf. `nextPlanCount` + the Sets panel hint)
 * ───────────────────────────────────────────────────────────────────────── */
type ChipState = "off" | "required" | "excluded";
type SetChipState = "off" | "req-4pc" | "req-2pc" | "excluded";

function nextChipState(s: ChipState | undefined): ChipState {
  if (s === "required") return "excluded";
  if (s === "excluded") return "off";
  return "required";
}

/** Cycle a set's piece-count within a plan: 0 → 2 → 4 → 0, skipping any step
 *  the inventory can't form (need ≥2/≥4 pieces). Mirrors `nextSetChipState`
 *  minus the `excluded` state (exclusion is a separate, global toggle now). */
function nextPlanCount(cur: number, reach: SetChipReach): number {
  const can2 = reach.has2pc && reach.canForm2pc;
  const can4 = reach.has4pc && reach.canForm4pc;
  if (cur === 0) return can2 ? 2 : can4 ? 4 : 0;
  if (cur === 2) return can4 ? 4 : 0;
  return 0; // was 4
}

/** State-driven chip styling — cyan for required, rose for excluded, dim
 *  for off. Reused by both chip flavors. */
function chipClasses(picked: boolean, excluded: boolean): string {
  if (picked) return "border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20";
  if (excluded) return "border-rose-400/40 bg-rose-500/15 hover:bg-rose-500/25 opacity-90";
  return "border-white/10 bg-white/2 opacity-55 hover:opacity-100 hover:bg-white/6";
}

/** Armor-set chip — icon + piece-count badge (2 / 4 when required, ✕ when
 *  excluded). The cycle skips `req-2pc` for sets without a real 2pc effect. */
function SetIconChip({ set, state, mode, onClick }: { set: ArmorSetEntry; state: SetChipState; mode: "require" | "exclude"; onClick: () => void }) {
  const picked = state === "req-2pc" || state === "req-4pc";
  const excluded = state === "excluded";
  const can2pc = set.has2pc && set.canForm2pc;
  const can4pc = set.has4pc && set.canForm4pc;
  const stateLabel =
    mode === "exclude"
      ? (state === "excluded" ? "excluded (click to clear)" : "click to exclude")
    : state === "off" ? (can2pc ? "click to require 2pc" : "click to require 4pc")
    : state === "req-2pc" ? (can4pc ? "required 2pc (click to switch to 4pc)" : "required 2pc (click to clear)")
    : "required 4pc (click to clear)";
  return (
    <RichTooltip content={<SetTooltipBody set={set} stateLabel={stateLabel} />}>
      <button
        type="button"
        onClick={onClick}
        className={cx("relative grid h-7 w-7 place-items-center rounded-md border transition-colors", chipClasses(picked, excluded))}
      >
        <img src={`/img/ui/effect/${set.icon}.webp`} alt={set.name} className="pointer-events-none h-5 w-5 object-contain" />
        <SetBadge state={state} />
      </button>
    </RichTooltip>
  );
}

/** Three-section tooltip body (header / effects / state). Effect lines
 *  flow through `GameText` so the in-game `<color=#hex>…</color>` tags
 *  render with their original highlight colors (e.g. cyan values, red
 *  debuffs). Skips rows the set doesn't carry at T4. */
function SetTooltipBody({ set, stateLabel }: { set: ArmorSetEntry; stateLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] font-semibold">
        {set.name} <span className="font-normal text-white/60">({set.owned} owned)</span>
      </div>
      <div className="border-t border-white/10" />
      {set.has2pc && (
        <div className="text-[11px] leading-snug">
          <span className="mr-1 font-mono text-white/60">2pc</span>
          <GameText text={set.desc2pc ?? "(no description)"} />
        </div>
      )}
      {set.has4pc && (
        <div className="text-[11px] leading-snug">
          <span className="mr-1 font-mono text-white/60">4pc</span>
          <GameText text={set.desc4pc ?? "(no description)"} />
        </div>
      )}
      <div className="border-t border-white/10" />
      <div className="text-[10.5px] italic text-white/70">{stateLabel}</div>
    </div>
  );
}

/** Weapon / accessory effect chip — simpler off/required/excluded. */
function EffectIconChip({ effect, state, onClick }: { effect: EffectEntry; state: ChipState; onClick: () => void }) {
  const stateLabel =
    state === "off" ? "click to require"
    : state === "required" ? "required (click to exclude)"
    : "excluded (click to clear)";
  return (
    <RichTooltip content={<EffectTooltipBody effect={effect} stateLabel={stateLabel} />}>
      <button
        type="button"
        onClick={onClick}
        className={cx("relative grid h-7 w-7 place-items-center rounded-md border transition-colors", chipClasses(state === "required", state === "excluded"))}
      >
        {effect.icon ? (
          <img src={`/img/ui/effect/${effect.icon}.webp`} alt={effect.name} className="pointer-events-none h-5 w-5 object-contain" />
        ) : (
          // No curated icon — show the effect's initials so the chip is still
          // identifiable (and we don't request `/img/ui/effect/.webp` → 404).
          <span className="pointer-events-none text-[9px] font-semibold uppercase text-white/70">{effect.name.slice(0, 2)}</span>
        )}
        <EffectBadge state={state} />
      </button>
    </RichTooltip>
  );
}

/** Same three-section layout as `SetTooltipBody` — header / T4 description
 *  via `GameText` (renders the in-game `<color>` highlights) / state hint. */
function EffectTooltipBody({ effect, stateLabel }: { effect: EffectEntry; stateLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] font-semibold">
        {effect.name} <span className="font-normal text-white/60">({effect.owned} owned)</span>
      </div>
      <div className="border-t border-white/10" />
      <div className="text-[11px] leading-snug">
        <GameText text={effect.descT4 ?? "(no description)"} />
      </div>
      <div className="border-t border-white/10" />
      <div className="text-[10.5px] italic text-white/70">{stateLabel}</div>
    </div>
  );
}

function SetBadge({ state }: { state: SetChipState }) {
  if (state === "off") return null;
  const label = state === "req-4pc" ? "4" : state === "req-2pc" ? "2" : "✕";
  const tone = state === "excluded" ? "text-rose-300" : "text-cyan-200";
  return (
    <span className={cx("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-900 font-mono text-[9px] font-bold", tone)}>
      {label}
    </span>
  );
}

function EffectBadge({ state }: { state: ChipState }) {
  if (state === "off") return null;
  const label = state === "required" ? "✓" : "✕";
  const tone = state === "excluded" ? "text-rose-300" : "text-cyan-200";
  return (
    <span className={cx("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-900 font-mono text-[9px] font-bold", tone)}>
      {label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Middle area — results table + right sidebar
 * ───────────────────────────────────────────────────────────────────────── */
/** Header dropdown to show/hide result columns. Stats default to the first 8
 *  visible, ratings + Score + Upg default on; a column targeted by an active
 *  stat filter is force-shown (locked) so you can't hide what you're filtering
 *  on. Preferences persist via the parent's `colPrefs`. */
function ColumnsMenu({
  statFilters, colPrefs, onToggle, onReset,
}: {
  statFilters: Record<string, MinMax>;
  colPrefs: Record<string, boolean>;
  onToggle: (key: string, def: boolean) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const items: Array<{ key: string; label: string; iconKey: string | null; def: boolean; forced: boolean }> = [
    { key: "wpn", label: "Weapon effect", iconKey: null, def: true, forced: false },
    { key: "acc", label: "Accessory effect", iconKey: null, def: true, forced: false },
    ...SOLVER_STATS.map((s, i) => {
      const b = statFilters[s.key];
      return { key: s.key, label: s.label, iconKey: s.iconKey, def: i < 8, forced: b != null && (b.min != null || b.max != null) };
    }),
    ...TABLE_RATINGS.map((r) => ({ key: r.key, label: r.label, iconKey: null, def: true, forced: false })),
    { key: "score", label: "Score", iconKey: null, def: true, forced: false },
    { key: "upg", label: "Upg", iconKey: null, def: true, forced: false },
  ];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[9.5px] uppercase tracking-wider text-white/60 hover:text-white"
      >
        columns <span className="text-[8px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-white/10 bg-bg-elev-1 p-2 shadow-2xl shadow-black/70">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-white/65">Visible columns</span>
            <button type="button" onClick={onReset} className="text-[10px] text-cyan-300 hover:text-cyan-200">reset</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.map((it) => {
              const checked = it.forced || (colPrefs[it.key] ?? it.def);
              return (
                <label
                  key={it.key}
                  title={it.forced ? "Forced visible — an active filter targets this column." : undefined}
                  className={cx(
                    "flex items-center gap-2 rounded px-1 py-0.5 text-[11px]",
                    it.forced ? "opacity-60" : "cursor-pointer hover:bg-white/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={it.forced}
                    onChange={() => onToggle(it.key, it.def)}
                    className="h-3 w-3 shrink-0 accent-cyan-400"
                  />
                  {it.iconKey && <StatIcon stat={it.iconKey} size={12} />}
                  <span className="truncate text-white/80">{it.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsTable({
  builds, selectedIdx, onSelect, solving, error, emptyReason, statFilters, rows, onRowsChange,
  pieceByUid, armorSets, game, heatmap,
}: {
  builds: SolveBuild[];
  selectedIdx: number | null;
  onSelect: (i: number | null) => void;
  solving: boolean;
  error: string | null;
  /** Why the last solve returned nothing (e.g. a slot pool collapsed to 0
   *  after filters). Null → show the generic "pick a hero" hint instead. */
  emptyReason: string | null;
  /** Active stat bands — the table always shows the first 8 stat columns;
   *  any of the remaining stats (dmgRed/eff/res) that carry a live min/max
   *  band get appended so you never filter on an invisible column. */
  statFilters: Record<string, MinMax>;
  /** Viewport height in rows (the parent caps the row's maxHeight to match);
   *  the slider in the header drives it so the bottom gear band stays visible. */
  rows: number;
  onRowsChange: (n: number) => void;
  /** Inventory uid→piece lookup — drives the per-build Set column (the build
   *  only carries piece UIDs; set composition is derived from their armor
   *  set ids). */
  pieceByUid: Map<string, GearPiece>;
  /** Owned armor sets — used as the setId→{name,icon} lookup for the Set cell. */
  armorSets: ArmorSetEntry[];
  /** Game data — resolves a build's weapon/accessory pieces to their effect
   *  (icon + name) for the Weapon/Accessory effect columns. */
  game: GameData | null;
  /** Results-table column heatmap on/off (Settings → Solver). */
  heatmap: boolean;
}) {
  // setId → display meta, for the per-build Set tags.
  const armorSetById = useMemo(() => {
    const m = new Map<string, ArmorSetEntry>();
    for (const s of armorSets) m.set(s.id, s);
    return m;
  }, [armorSets]);
  // Per-build weapon + accessory effect chips (icon + name), resolved from the
  // pieces' equipment defs. Memoized on the result set like the Set tags so the
  // virtualized rows don't recompute on hover/sort.
  const effectByBuild = useMemo(() => {
    const m = new Map<SolveBuild, { weapon: EffectChip | null; accessory: EffectChip | null }>();
    if (!game) return m;
    const resolve = (uid: string | undefined): EffectChip | null => {
      if (!uid) return null;
      const piece = pieceByUid.get(uid);
      if (!piece) return null;
      const def = game.equipment[String(piece.itemId)];
      if (!def?.setId) return null;
      const name = game.equipmentPassives[String(piece.itemId)]?.name ?? def.name ?? def.setId;
      return { icon: def.effectIcon ?? null, name };
    };
    for (const b of builds) {
      let wUid: string | undefined, aUid: string | undefined;
      for (const uid of b.pieceUids) {
        const slot = pieceByUid.get(uid)?.slot;
        if (slot === "weapon") wUid = uid;
        else if (slot === "accessory") aUid = uid;
      }
      m.set(b, { weapon: resolve(wUid), accessory: resolve(aUid) });
    }
    return m;
  }, [builds, pieceByUid, game]);
  // Per-build active set tags: tally each build's pieces by armor set id, keep
  // sets with ≥2 pieces, and render the bonus tier (4 when ≥4 pieces, else 2).
  // Memoized on the result set so 1000 rows don't recompute on every hover.
  const setTagsByBuild = useMemo(() => {
    const m = new Map<SolveBuild, SetTag[]>();
    for (const b of builds) {
      const counts = new Map<string, number>();
      for (const uid of b.pieceUids) {
        const sid = pieceByUid.get(uid)?.armorSetId;
        if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
      const tags: SetTag[] = [];
      for (const [sid, n] of counts) {
        if (n < 2) continue;
        const meta = armorSetById.get(sid);
        if (meta) tags.push({ icon: meta.icon, name: meta.name, count: n >= 4 ? 4 : 2 });
      }
      tags.sort((a, z) => z.count - a.count); // 4pc before 2pc
      if (tags.length > 0) m.set(b, tags);
    }
    return m;
  }, [builds, pieceByUid, armorSetById]);
  // Column visibility — persisted per-key overrides (key → shown). Stats
  // default to the first 8 visible; ratings + Score + Upg default visible. A
  // stat with an active filter band is force-shown regardless so you never
  // filter on a hidden column. The "Columns" menu in the header toggles these.
  const [colPrefs, setColPrefs] = usePersistedState<Record<string, boolean>>("gs.builder.cols", {});
  const statCols = useMemo(
    () => SOLVER_STATS.filter((s, i) => {
      const b = statFilters[s.key];
      const filtered = b != null && (b.min != null || b.max != null);
      return filtered || (colPrefs[s.key] ?? i < 8);
    }),
    [statFilters, colPrefs],
  );
  const ratingCols = useMemo(
    () => TABLE_RATINGS.filter((r) => colPrefs[r.key] ?? true),
    [colPrefs],
  );
  const showScore = colPrefs["score"] ?? true;
  const showUpg = colPrefs["upg"] ?? true;
  const showWpn = colPrefs["wpn"] ?? true;
  const showAcc = colPrefs["acc"] ?? true;
  // Per-column min/max for the heatmap — recomputed when builds (or the set
  // of visible stat columns) change. Stats and ratings computed once; reused
  // across every row. When the heatmap setting is off, empty ranges make
  // `heatStyle` return undefined for every cell (no tint), skipping the scan.
  const ranges = useMemo(
    () => (heatmap ? computeColumnRanges(builds, statCols) : EMPTY_RANGES),
    [builds, statCols, heatmap],
  );
  // Sort state — column key + direction. Default null = solver's native
  // order (Score desc in SOLVE, CP desc in SOLVE CP). Click cycles
  // null → desc → asc → null per column; clicking a different column resets.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const cycleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortDir("asc"); return; }
    setSortKey(null); // back to native order
  };
  const sortedBuilds = useMemo(() => {
    if (!sortKey) return builds;
    const get = (b: SolveBuild): number => {
      if (sortKey === "score") return b.score;
      if (sortKey === "upg") return b.upg;
      if (sortKey === "cp") return b.cp ?? -Infinity;
      const stat = (b.finalStats as unknown as Record<string, number>)[sortKey];
      if (typeof stat === "number") return stat;
      const rating = (b.ratings as unknown as Record<string, number>)[sortKey];
      if (typeof rating === "number") return rating;
      return 0;
    };
    const sign = sortDir === "desc" ? -1 : 1;
    return [...builds].sort((a, b) => sign * (get(a) - get(b)));
  }, [builds, sortKey, sortDir]);
  // Map each build to its index in the original `builds` array — used as
  // both the row key and the click payload (selectedIdx points into the
  // ORIGINAL order so it survives a re-sort). Replaces a previous
  // `builds.indexOf(b)` in the render loop that was O(n²) — ~1M ops per
  // re-render at the default topN=1000 (every hover, every sort).
  const buildIndexOf = useMemo(() => {
    const m = new Map<SolveBuild, number>();
    for (let i = 0; i < builds.length; i++) m.set(builds[i]!, i);
    return m;
  }, [builds]);
  const selectedBuildRef = selectedIdx != null ? builds[selectedIdx] : null;

  // Row virtualization — at the default topN=1000 the old table mounted ~1000
  // rows × ~20 cells (~20k DOM nodes) and re-rendered every one on hover/sort.
  // Now only the visible window (+overscan) is mounted; two spacer rows
  // reserve the scroll height so the sticky thead and scrollbar stay correct.
  // Fixed row height (forced on each ResultRow) → estimate == actual, no drift.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedBuilds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESULT_ROW_H,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const padTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const padBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1]!.end : 0;
  const colSpan = 1 + (showWpn ? 1 : 0) + (showAcc ? 1 : 0) + statCols.length + ratingCols.length + (showScore ? 1 : 0) + (showUpg ? 1 : 0) + 1;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/8 bg-bg-elev-2">
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-1.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Results</span>
          <span className="text-[10.5px] italic text-white/65">
            {solving ? "Solving…" : error ? "Solver error — see below." : "Click a row to reveal the equipment that produced it. Click a column header to sort."}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5" title="Results table height (rows visible before scrolling) — lower it to keep the gear cards below in view">
            <span className="text-[9.5px] uppercase tracking-wider text-white/65">height</span>
            <input
              type="range"
              min={5}
              max={15}
              step={1}
              value={Math.min(rows, 15)}
              onChange={(e) => onRowsChange(Number(e.target.value))}
              className="w-20 accent-cyan-400"
            />
          </label>
          <ColumnsMenu
            statFilters={statFilters}
            colPrefs={colPrefs}
            onToggle={(key, def) => setColPrefs((p) => ({ ...p, [key]: !(p[key] ?? def) }))}
            onReset={() => setColPrefs({})}
          />
          <Pill tone={error ? "rose" : "emerald"}>{builds.length} builds</Pill>
        </div>
      </div>
      {error && (
        <div className="border-b border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">{error}</div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[10.5px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-bg-elev-1 text-white/70 [&_th]:bg-bg-elev-1">
            <tr className="border-b border-white/8">
              <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider">sets</th>
              {showWpn && <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider" title="Weapon effect">wpn</th>}
              {showAcc && <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider" title="Accessory effect">acc</th>}
              {statCols.map((s) => (
                <SortHeader key={s.key} colKey={s.key} title={statHeaderTooltip(s.key, s.label)} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  <StatIcon stat={s.iconKey} size={14} title={null} className="inline-block align-middle" />
                </SortHeader>
              ))}
              {ratingCols.map((r) => (
                <SortHeader key={r.key} colKey={r.key} title={r.desc} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  {r.label.toLowerCase()}
                </SortHeader>
              ))}
              {showScore && (
                <SortHeader colKey="score" title="Aggregate priority-weighted score" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort} className="text-amber-300">
                  score
                </SortHeader>
              )}
              {showUpg && (
                <SortHeader colKey="upg" title="Number of slots that differ from the hero's current loadout" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  upg
                </SortHeader>
              )}
              <th className="px-1.5 py-1 text-right text-[9.5px] uppercase tracking-wider">actions</th>
            </tr>
          </thead>
          <tbody>
            {builds.length === 0 && !solving && !error && (
              // colSpan = 1 sets + statCols + N ratings + score + upg + actions.
              <tr><td colSpan={colSpan} className="px-3 py-12 text-center text-[11px] italic">
                {emptyReason ? (
                  <span className="text-amber-300/80">
                    No builds — a slot has no pieces left after filtering.<br />
                    <span className="not-italic font-mono text-[10.5px]">{emptyReason}</span>
                  </span>
                ) : (
                  <span className="text-white/65">Pick a hero and click SOLVE to populate the results.</span>
                )}
              </td></tr>
            )}
            {/* Spacer rows reserve the offscreen scroll height above/below the
                rendered window so the scrollbar + sticky thead stay accurate. */}
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={colSpan} /></tr>}
            {virtualRows.map((vr) => {
              const b = sortedBuilds[vr.index]!;
              const idx = buildIndexOf.get(b) ?? 0;
              return (
                <ResultRow
                  key={idx}
                  build={b}
                  selected={b === selectedBuildRef}
                  ranges={ranges}
                  statCols={statCols}
                  ratingCols={ratingCols}
                  showScore={showScore}
                  showUpg={showUpg}
                  showWpn={showWpn}
                  showAcc={showAcc}
                  effects={effectByBuild.get(b)}
                  setTags={setTagsByBuild.get(b)}
                  index={idx}
                  onSelect={onSelect}
                />
              );
            })}
            {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={colSpan} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sortable column header — chevron indicates active sort + direction. */
function SortHeader({
  colKey, title, sortKey, sortDir, onClick, className, children,
}: {
  colKey: string;
  title?: string;
  sortKey: string | null;
  sortDir: "desc" | "asc";
  onClick: (key: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sortKey === colKey;
  const arrow = active ? (sortDir === "desc" ? "▼" : "▲") : "";
  return (
    <th
      onClick={() => onClick(colKey)}
      title={title}
      className={cx(
        "cursor-pointer select-none px-1.5 py-1 text-right text-[9.5px] uppercase tracking-wider hover:text-white",
        active && "text-cyan-300",
        className,
      )}
    >
      {children}{arrow && <span className="ml-0.5 text-[8px]">{arrow}</span>}
    </th>
  );
}

/** Per-column min/max for the heatmap shading. Pre-computed once per
 *  result set so each cell render is just a (v − min) / (max − min) lerp. */
interface ColumnRanges {
  stat: Record<string, { min: number; max: number }>;
  rating: Record<string, { min: number; max: number }>;
  score: { min: number; max: number };
}
/** Heatmap-off ranges — `score` non-finite + empty stat/rating maps make
 *  `heatStyle` bail (no tint) on every cell. */
const EMPTY_RANGES: ColumnRanges = { stat: {}, rating: {}, score: { min: Infinity, max: -Infinity } };

function computeColumnRanges(builds: SolveBuild[], statCols: ReadonlyArray<typeof SOLVER_STATS[number]>): ColumnRanges {
  const stat: ColumnRanges["stat"] = {};
  const rating: ColumnRanges["rating"] = {};
  let scoreMin = Infinity, scoreMax = -Infinity;
  for (const b of builds) {
    for (const s of statCols) {
      const v = (b.finalStats as unknown as Record<string, number>)[s.key];
      if (typeof v !== "number") continue;
      const cur = stat[s.key] ?? { min: Infinity, max: -Infinity };
      if (v < cur.min) cur.min = v;
      if (v > cur.max) cur.max = v;
      stat[s.key] = cur;
    }
    for (const r of TABLE_RATINGS) {
      const v = r.key === "cp" ? (b.cp ?? null) : (b.ratings as unknown as Record<string, number>)[r.key];
      if (v == null) continue;
      const cur = rating[r.key] ?? { min: Infinity, max: -Infinity };
      if (v < cur.min) cur.min = v;
      if (v > cur.max) cur.max = v;
      rating[r.key] = cur;
    }
    if (b.score < scoreMin) scoreMin = b.score;
    if (b.score > scoreMax) scoreMax = b.score;
  }
  return { stat, rating, score: { min: scoreMin, max: scoreMax } };
}

/** Fixed result-row height (px) — forced on each row so the virtualizer's
 *  size estimate equals the actual height (zero scroll drift). */
const RESULT_ROW_H = 26;

/** One active armor-set bonus on a build — icon + bonus tier (2 or 4). */
interface SetTag { icon: string; name: string; count: 2 | 4 }

/** A weapon/accessory effect chip on a build — icon (may be null → initials)
 *  + effect name for the tooltip. */
interface EffectChip { icon: string | null; name: string }

/** Memoized so a hover/sort/selection change only re-renders the rows whose
 *  props actually changed. Requires stable props: `onSelect` is the parent's
 *  useState setter, `ranges` is memoized, `build` refs are stable. The click
 *  handler is bound to the stable `index` here rather than passed pre-closed. */
const ResultRow = memo(function ResultRow({
  build, selected, ranges, statCols, ratingCols, showScore, showUpg, showWpn, showAcc, effects, setTags, index, onSelect,
}: {
  build: SolveBuild;
  selected?: boolean;
  ranges: ColumnRanges;
  /** Stat columns to render — stable (memoized) reference from ResultsTable
   *  so it doesn't defeat the row memo on hover/sort. */
  statCols: ReadonlyArray<typeof SOLVER_STATS[number]>;
  /** Visible rating columns — stable (memoized) reference, same rationale. */
  ratingCols: ReadonlyArray<typeof TABLE_RATINGS[number]>;
  showScore: boolean;
  showUpg: boolean;
  showWpn: boolean;
  showAcc: boolean;
  /** This build's weapon + accessory effect chips (stable memoized ref). */
  effects: { weapon: EffectChip | null; accessory: EffectChip | null } | undefined;
  /** Active set bonuses for this build (icon + tier), or undefined for none.
   *  Stable reference (from ResultsTable's memoized map) so it doesn't defeat
   *  the row memo. */
  setTags: SetTag[] | undefined;
  index: number;
  onSelect: (i: number) => void;
}) {
  return (
    <tr
      onClick={() => onSelect(index)}
      style={{ height: RESULT_ROW_H }}
      className={cx(
        "cursor-pointer border-b border-white/4 hover:bg-white/4",
        selected && "bg-rose-900/30 hover:bg-rose-900/40",
      )}
    >
      <td className="px-1.5 py-1 text-left">
        {setTags && setTags.length > 0 ? (
          <div className="flex items-center gap-1">
            {setTags.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-0.5" title={`${t.name} ·${t.count}pc`}>
                <img src={`/img/ui/effect/${t.icon}.webp`} alt={t.name} className="h-3.5 w-3.5 object-contain" />
                <span className="text-[9px] text-white/60">{t.count}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-white/55">—</span>
        )}
      </td>
      {showWpn && <EffectCell chip={effects?.weapon ?? null} />}
      {showAcc && <EffectCell chip={effects?.accessory ?? null} />}
      {statCols.map((s) => {
        const v = (build.finalStats as unknown as Record<string, number>)[s.key];
        return (
          <td key={s.key} style={heatStyle(v, ranges.stat[s.key])} className="px-1.5 py-1 text-right text-white">
            {fmt(v, s.unit)}
          </td>
        );
      })}
      {ratingCols.map((r) => {
        const v = r.key === "cp" ? build.cp : (build.ratings as unknown as Record<string, number>)[r.key];
        return (
          <td key={r.key} style={heatStyle(v, ranges.rating[r.key])} className="px-1.5 py-1 text-right text-white">
            {fmt(v, "")}
          </td>
        );
      })}
      {showScore && (
        <td style={heatStyle(build.score, ranges.score)} className="px-1.5 py-1 text-right font-semibold text-amber-200">
          {build.score}
        </td>
      )}
      {showUpg && (
        <td className="px-1.5 py-1 text-right text-white/70" title={`${build.upg} slot(s) differ from current loadout`}>
          {build.upg}
        </td>
      )}
      <td className="px-1.5 py-1 text-right text-white/70">
        {selected && <span title="Selected">★</span>}
      </td>
    </tr>
  );
});

/** Single weapon/accessory effect cell — the effect icon (or initials when the
 *  effect has no curated icon), with the effect name as the hover tooltip. */
function EffectCell({ chip }: { chip: EffectChip | null }) {
  return (
    <td className="px-1.5 py-1 text-left">
      {chip ? (
        <span className="inline-flex items-center" title={chip.name}>
          {chip.icon ? (
            <img src={`/img/ui/effect/${chip.icon}.webp`} alt={chip.name} className="h-4 w-4 object-contain" />
          ) : (
            <span className="text-[9px] font-semibold uppercase text-white/60">{chip.name.slice(0, 2)}</span>
          )}
        </span>
      ) : (
        <span className="text-white/25">—</span>
      )}
    </td>
  );
}

/** Display rounding: integer at |v| ≥ 100, else one decimal. Shared by `fmt`
 *  (the printed value) and `heatStyle` (the shade) so a cell is never tinted
 *  on a precision the user can't see — two cells printing the same number get
 *  the same colour. */
function roundDisplay(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  return `${roundDisplay(v)}${unit}`;
}

/** Continuous heatmap from rose (worst column value) through a transparent
 *  midline to emerald (best). Returns an inline `backgroundColor` rather than
 *  discrete Tailwind bands so the shade interpolates smoothly (no visible
 *  steps between adjacent rows). No style when the column is flat (min === max)
 *  or the value is missing. Shades on the *displayed* (rounded) value so
 *  identically-printed cells never differ in tint. */
const HEAT_EMERALD = [16, 185, 129] as const; // emerald-500
const HEAT_ROSE = [244, 63, 94] as const;     // rose-500
const HEAT_MAX_ALPHA = 0.22;                  // peak tint at the column extremes
function heatStyle(v: number | null | undefined, range: { min: number; max: number } | undefined): CSSProperties | undefined {
  if (v == null || !range || !isFinite(range.min) || range.min === range.max) return undefined;
  const tRaw = (roundDisplay(v) - range.min) / (range.max - range.min);
  const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
  const d = (t - 0.5) * 2; // -1 (worst) .. +1 (best); 0 at the midline
  const alpha = Math.abs(d) * HEAT_MAX_ALPHA;
  if (alpha < 0.01) return undefined; // mid-band → no tint (keeps the row clean)
  const [r, g, b] = d >= 0 ? HEAT_EMERALD : HEAT_ROSE;
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})` };
}

/** Modal shown when a reco carries more than one named build — lets the user
 *  pick which one to apply. Single-build recos skip this and apply directly. */
function RecoBuildPicker({ reco, onPick, onClose }: {
  reco: StructuredCharacterReco;
  onPick: (name: string, build: StructuredRecoBuild) => void;
  onClose: () => void;
}) {
  const names = Object.keys(reco.builds);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const summarize = (b: StructuredRecoBuild): string => {
    const parts: string[] = [];
    if (b.Weapon?.length) parts.push("weapon");
    if (b.Amulet?.length) parts.push("amulet");
    const setN = (b.Set ?? []).length;
    if (setN) parts.push(`${setN} set alt${setN > 1 ? "s" : ""}`);
    const prioN = (b.SubstatPrio ?? []).length;
    if (prioN) parts.push(`${prioN}-tier prio`);
    return parts.join(" · ") || "empty build";
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="font-display text-[13px] font-semibold text-white">Choose a build</h3>
          <button type="button" onClick={onClose} className="text-white/65 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-white/70">
          This hero has multiple recommended builds. Pick one to apply its mains, sets, effects and substat priority.
        </p>
        <ul className="flex flex-col gap-1.5">
          {names.map((name) => {
            const b = reco.builds[name]!;
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onPick(name, b)}
                  className="w-full rounded-md border border-white/10 bg-white/2 px-3 py-2 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10"
                >
                  <div className="text-[12.5px] font-medium text-white">{name}</div>
                  <div className="text-[10.5px] text-white/70">{summarize(b)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Right sidebar — Save build / save preset actions + per-hero library
 * ───────────────────────────────────────────────────────────────────────── */
function RightSidebar({
  canSave, canSavePreset,
  onSaveBuild, onSavePreset,
  canGetPreset, onGetPreset, recoBusy, recoStatus,
  savedBuilds, onRestoreBuild, onRemoveBuild,
  presets, onLoadPreset, onRemovePreset,
}: {
  canSave: boolean;
  canSavePreset: boolean;
  onSaveBuild: () => void;
  onSavePreset: () => void;
  canGetPreset: boolean;
  onGetPreset: () => void;
  recoBusy: boolean;
  /** Inline result of the last Get-preset attempt (error / none / warnings). */
  recoStatus: { tone: "ok" | "warn" | "error"; text: string } | null;
  savedBuilds: ReadonlyArray<SavedBuild>;
  onRestoreBuild: (b: SavedBuild) => void;
  onRemoveBuild: (id: string) => void;
  presets: ReadonlyArray<FilterPreset>;
  onLoadPreset: (p: FilterPreset) => void;
  onRemovePreset: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-2">
      <Panel title="Library" hint="Get preset pulls the outerpedia build reco for this hero (mains / sets / effects / substat priority). Save build / preset bookmark your current setup. Per-hero, persisted in localStorage." width="w-full">
        <div className="grid grid-cols-1 gap-1">
          <ActionButton tone="primary" disabled={!canGetPreset || recoBusy} onClick={onGetPreset}>
            {recoBusy ? "Fetching…" : "Get preset"}
          </ActionButton>
          <ActionButton disabled={!canSave} onClick={onSaveBuild}>Save build</ActionButton>
          <ActionButton disabled={!canSavePreset} onClick={onSavePreset}>Save filter preset</ActionButton>
        </div>
        {recoStatus && (
          <div className={cx(
            "mt-1.5 text-[10px] leading-snug",
            recoStatus.tone === "ok" && "text-emerald-300/80",
            recoStatus.tone === "warn" && "text-amber-300/80",
            recoStatus.tone === "error" && "text-rose-300/80",
          )}>
            {recoStatus.text}
          </div>
        )}
      </Panel>

      <Panel title="Saved builds" hint="Click a build to load it into the table + bottom band. The trash icon removes it permanently." width="w-full">
        {savedBuilds.length === 0 ? (
          <div className="text-[10.5px] italic text-white/65">No saved builds for this hero.</div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {savedBuilds.map((b) => (
              <LibraryRow
                key={b.id}
                title={b.name}
                subtitle={`${b.mode === "cp" ? "CP" : "Score"} ${b.mode === "cp" ? (b.build.cp ?? "—") : b.build.score} · ${formatTimeAgo(b.createdAt)}`}
                onClick={() => onRestoreBuild(b)}
                onDelete={() => onRemoveBuild(b.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Filter presets" hint="Load a saved filter set into the panels. Useful to switch between e.g. 'CHC build' and 'tank build' without re-clicking every chip." width="w-full">
        {presets.length === 0 ? (
          <div className="text-[10.5px] italic text-white/65">No presets for this hero.</div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {presets.map((p) => (
              <LibraryRow
                key={p.id}
                title={p.name}
                subtitle={formatTimeAgo(p.createdAt)}
                onClick={() => onLoadPreset(p)}
                onDelete={() => onRemovePreset(p.id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </aside>
  );
}

/** Compact row for the Library panels — title (clickable) + small subtitle
 *  + delete affordance on hover. Same shape for builds and presets. */
function LibraryRow({
  title, subtitle, onClick, onDelete,
}: { title: string; subtitle: string; onClick: () => void; onDelete: () => void }) {
  return (
    <li className="group flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-white/4">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
        title={title}
      >
        <span className="truncate text-[11px] text-white">{title}</span>
        <span className="truncate text-[10px] text-white/65">{subtitle}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 px-1 text-[12px] text-white/55 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
        title="Delete"
      >
        ✕
      </button>
    </li>
  );
}

/** Quick relative-time stamp — "3m ago", "2h ago", "5d ago", else absolute
 *  date. No deps; good enough for a sidebar timestamp. */
function formatTimeAgo(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const min = Math.floor(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ─────────────────────────────────────────────────────────────────────────
 * Filter / Search details footer — horizontal stat strip pinned at the
 * bottom of the screen. Same data the right-sidebar block used to carry,
 * just laid out left-to-right with `|` separators so it fits on one line.
 * ───────────────────────────────────────────────────────────────────────── */
function FilterFooter({
  permutations, searched, poolSizes, resultCount, solving, workerCount,
}: {
  permutations: number;
  searched: number;
  poolSizes: PoolSizes | null;
  resultCount: number;
  solving: boolean;
  /** Resolved solver worker-pool size — pinned at the far right so the user
   *  can confirm the search parallelism at a glance. */
  workerCount: number;
}) {
  // Slots rendered in the same order the inventory tab uses so the user's
  // eye-flow is identical across tabs.
  const slots: SlotId[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "talisman"];
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex flex-nowrap items-center gap-x-3 overflow-x-auto whitespace-nowrap border-t border-white/8 bg-bg-elev-2/95 px-3 py-1.5 font-mono text-[10.5px] tabular-nums backdrop-blur-sm">
      <HoverHint
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70"
        name="Filter"
        text="Live counts of how many pieces survive each filter, plus total permutations explored."
      />
      {slots.map((slot) => {
        const ps = poolSizes?.[slot];
        return <FilterChip key={slot} slot={slot} hit={ps?.hit ?? 0} of={ps?.of ?? 0} />;
      })}
      <span className="text-white/20">|</span>
      <FilterBig label="P" value={permutations} title="Total permutations explored across the worker pool." />
      <span className="text-white/55">/</span>
      <FilterBig label="S" value={searched} title="Permutations that survived stat + rating filters and got scored." />
      <span className="text-white/20">|</span>
      <FilterBig label="Results" value={resultCount} title="Builds returned to the table (top-N by Score or CP)." />
      <span className="ml-auto inline-flex items-center gap-3">
        {solving && (
          <span className="text-[10px] uppercase tracking-wider text-cyan-300/80 animate-pulse">solving…</span>
        )}
        <span
          className="inline-flex items-center gap-1 text-white/70"
          title={`Solver worker pool — parallel search threads (hardwareConcurrency − 1, override via gs.solver.workerCount). ${workerCount} worker${workerCount === 1 ? "" : "s"}.`}
        >
          <span aria-hidden>⚙</span>
          <span className="text-white/80">{workerCount}</span>
          <span className="text-white/65">{workerCount === 1 ? "worker" : "workers"}</span>
        </span>
      </span>
    </footer>
  );
}

/** Single per-slot chip — slot icon + hit/total + percent in dim parens.
 *  Uses the same `SlotIcon` as the Inventory tab so the icon language stays
 *  consistent across the app. */
function FilterChip({ slot, hit, of }: { slot: SlotId; hit: number; of: number }) {
  const pct = of > 0 ? Math.round((hit / of) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1">
      <SlotIcon slot={slot} size={14} />
      <span className="text-white">{hit}/{of}</span>
      <span className="text-white/65">({pct}%)</span>
    </span>
  );
}

function FilterBig({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
      <span className="text-white/70">{label}</span>
      <span className="text-white">{value.toLocaleString()}</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Bottom gear band — one card per main slot for the selected result
 * ───────────────────────────────────────────────────────────────────────── */
function BottomGearBand({
  build, pieceByUid, game, reforge,
}: {
  build: SolveBuild | null;
  pieceByUid: Map<string, GearPiece>;
  game: GameData | null;
  /** Reforge context the displayed build was solved with — when the mode is
   *  not "disable", each card re-runs the deterministic `projectPieceForReforge`
   *  so its main/substats match the build's projected `finalStats` instead of
   *  the pieces' current rolls (the engine scored the projected clones). */
  reforge: ReforgeContext;
}) {
  // Map engine slot → display piece for the selected build. The result's
  // `pieceUids` carries slot order (engine names); we re-key by GearSlot and,
  // when a reforge mode is active, swap in the projected clone.
  // `projectPieceForReforge` self-filters (returns the original for Talisman/EE,
  // "disable" mode, or when there's nothing left to project), so identity
  // inequality is a reliable "was projected" signal for the badge.
  const pieceBySlot = useMemo(() => {
    const map = new Map<string, { piece: GearPiece; reforged: boolean }>();
    if (!build) return map;
    for (const uid of build.pieceUids) {
      const original = pieceByUid.get(uid);
      if (!original?.slot) continue;
      const piece = game ? projectPieceForReforge(original, game, reforge.reforgeMode, reforge.priority) : original;
      map.set(original.slot, { piece, reforged: piece !== original });
    }
    return map;
  }, [build, pieceByUid, game, reforge]);

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {RESULT_GEAR_SLOTS.map((slot) => {
        // RESULT_GEAR_SLOTS uses design names — convert "talisman" back to
        // the engine "ooparts" lookup key.
        const engineSlot = slot === "talisman" ? "ooparts" : slot;
        const entry = pieceBySlot.get(engineSlot) ?? null;
        const piece = entry?.piece ?? null;
        // Only Talisman / EE carry gems — surface the build's recommended
        // gem allocation there so the displayed stats (computed WITH those
        // gems in SOLVE CP) are reachable, not silently mismatched against
        // the piece's currently-socketed gems.
        const recommendedGems = slot === "talisman"
          ? build?.gemAllocation.talisman
          : slot === "exclusive"
            ? build?.gemAllocation.ee
            : undefined;
        return <GearCard key={slot} slot={slot} piece={piece} game={game} recommendedGems={recommendedGems} reforged={entry?.reforged ?? false} reforgeMode={reforge.reforgeMode} />;
      })}
    </div>
  );
}

/** Per-slot in-game allowed main stat — same fixed mapping the Inventory
 *  detail panel uses for its main-stat line label when no piece is present. */
const SLOT_MAIN_PLACEHOLDER: Record<string, string> = {
  weapon: "atk", helmet: "hp", armor: "def",
  gloves: "atk", boots: "spd", accessory: "hp",
  exclusive: "atk", talisman: "atk",
};

/** Compact mirror of the Inventory tab's `ItemDetail` panel — same section
 *  flow (header / icon+label / main stat / substats). Renders em-dash
 *  placeholders when no piece is wired (no build selected yet). */
function GearCard({ slot, piece, game, recommendedGems, reforged, reforgeMode }: {
  slot: SlotId;
  piece: GearPiece | null;
  game: GameData | null;
  /** Build's recommended gem allocation for this slot (Talisman/EE only),
   *  OptionIDs with 0 = empty. Undefined for non-gem slots. */
  recommendedGems?: number[];
  /** True when `piece` was projected (main re-scale + reforge ticks), not the
   *  current rolls — flags the substat list with a mode badge. */
  reforged?: boolean;
  /** Reforge mode driving the projection — labels the badge (classic/ascended). */
  reforgeMode?: ReforgeMode;
}) {
  const slotMeta = SLOT_BY[slot];
  const def = piece && game ? game.equipment[String(piece.itemId)] : null;
  const name = piece ? (def?.name ?? piece.name ?? `Item ${piece.itemId}`) : null;
  const mainStat = piece?.main.find((m) => !m.combatOnly) ?? null;
  const mainStatKey = mainStat?.stat ?? SLOT_MAIN_PLACEHOLDER[slot] ?? "atk";
  const mainStatMeta = STAT[mainStatKey];
  // SlotMini wants the design's IconPiece shape (stars/enhance/bt/singularity);
  // go through the same adapter the Inventory tab uses so the tile renders
  // with the right rarity / breakthrough / image overlays.
  const iconPiece = piece && game ? toIconPiece(toUiPiece(piece, game)) : null;
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 rounded-lg border border-white/8 bg-bg-elev-1 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cx("truncate font-display text-[13px] font-semibold", name ? "text-white" : "text-white/65")}>
          {name ?? "—"}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <SlotMini slot={slot} piece={iconPiece} size={56} />
        <div className="min-w-0 flex-1 text-[11px] leading-tight">
          <div className={cx("italic", piece ? "text-white/70" : "text-white/65")}>
            {piece ? `+${piece.enhanceLevel}${piece.ascended ? " · ascended" : ""}` : "—"}
          </div>
          <div className="text-white">{slotMeta?.label ?? slot}</div>
        </div>
      </div>

      {/* The EE's main stat is fixed (ATK% — only one option exists), so it's
       *  pure noise on the card; skip it for the exclusive slot. */}
      {slot !== "exclusive" && (
        <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
          <StatIcon stat={mainStatKey} size={16} className="shrink-0" />
          <span className="flex-1 text-white">{mainStatMeta?.longLabel ?? mainStatKey}</span>
          <span className={cx("font-semibold", mainStat ? "text-white" : "text-white/65")}>
            {mainStat ? `${mainStat.value}${mainStat.percent ? "%" : ""}` : "—"}
          </span>
        </div>
      )}

      {reforged && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/60">Substats</span>
          <span className="rounded border border-cyan-400/40 bg-cyan-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
            {reforgeMode === "ascended" ? "ascended" : reforgeMode === "classic" ? "classic" : "projected"}
          </span>
        </div>
      )}
      <div className="space-y-1 font-mono text-[10.5px] tabular-nums">
        {piece && piece.subs.length > 0 ? piece.subs.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-white/80">
            <StatIcon stat={s.stat} size={12} className="shrink-0" />
            {s.ticks != null && (
              <span className="rounded border border-white/8 px-1 py-px text-[9.5px] text-white/60">LV{s.ticks}</span>
            )}
            <span className="flex-1 truncate text-white/80">{STAT[s.stat]?.longLabel ?? s.stat}</span>
            <span className="text-white">{s.value}{s.percent ? "%" : ""}</span>
          </div>
        )) : (
          <div className="text-[10.5px] italic text-white/55">—</div>
        )}
      </div>

      {piece && game && recommendedGems && (
        <GemRecommendation recommended={recommendedGems} piece={piece} game={game} />
      )}
    </div>
  );
}

/** Recommended gem allocation for a Talisman / EE card. The solver scores
 *  the player's whole gem pool and proposes the K best for this build —
 *  surfaced here so the displayed stats (computed WITH these gems in SOLVE
 *  CP) are actually reachable. A "swap" badge flags when the recommendation
 *  differs from the piece's currently-socketed gems; renders nothing when
 *  the solver kept the current gems (all-zero allocation, e.g. SOLVE with
 *  no priority). */
function GemRecommendation({ recommended, piece, game }: {
  recommended: number[];
  piece: GearPiece;
  game: GameData;
}) {
  const recIds = recommended.filter((id) => id > 0);
  if (recIds.length === 0) return null; // no reallocation — current gems kept
  const currentIds = (piece.gemSlots ?? []).filter((id) => id > 0);
  // Multiset equality (slot order is irrelevant — gems are interchangeable).
  const sortedEq = (a: number[], b: number[]): boolean => {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
  };
  const isSwap = !sortedEq(recIds, currentIds);
  const gems = recIds
    .map((id) => resolveStat(id, 1, game.options))
    .filter((r): r is NonNullable<typeof r> => r != null);
  return (
    <div className="space-y-1 border-t border-white/8 pt-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/60">Gems</span>
        {isSwap && (
          <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-300">
            swap
          </span>
        )}
      </div>
      <div className="space-y-1 font-mono text-[10.5px] tabular-nums">
        {gems.map((g, i) => (
          <div key={i} className="flex items-center gap-1.5 text-white/80">
            <StatIcon stat={g.stat} size={12} className="shrink-0" />
            <span className="flex-1 truncate text-white/80">{STAT[g.stat]?.longLabel ?? g.stat}</span>
            <span className="text-white">{g.value}{g.percent ? "%" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h2 className="font-display text-[18px] font-semibold text-white">{title}</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/60">{subtitle}</p>
    </div>
  );
}
