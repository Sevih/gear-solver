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
import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import type { Character, GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, expToLevel } from "@gear-solver/core";
import { CharacterPortrait, SlotIcon, SlotMini, StatIcon } from "../design/EquipmentIcon.js";
import { Pill } from "../design/Chips.js";
import { cx } from "../design/cx.js";
import { HoverHint } from "../design/HoverHint.js";
import { GameText } from "../design/GameText.js";
import { RichTooltip } from "../design/RichTooltip.js";
import { SLOT_BY, STAT, toDesignSlot, type SlotId } from "../design/tokens.js";
import { toIconPiece, toUiPiece } from "../design/adapter.js";
import { computeFinalStats, type FinalStats } from "../lib/composeBuild.js";
import { SolverOrchestrator } from "../lib/solver/orchestrator.js";
import type { PoolSizes, SolveBuild, SolveFilters, SolveMode } from "../lib/solver/types.js";
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
}

/** Composed snapshot for the selected hero — drives the Stats panel readout
 *  and (eventually) the solver scoring baseline. Null when no hero is picked
 *  or the composer lacked the ingredients to run. */
interface SelectedComposition {
  current: FinalStats;
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
const SOLVER_STATS: ReadonlyArray<{ key: string; iconKey: string; label: string; unit: string }> = [
  { key: "atk",        iconKey: "atk",           label: "Atk",  unit: "" },
  { key: "def",        iconKey: "def",           label: "Def",  unit: "" },
  { key: "hp",         iconKey: "hp",            label: "Hp",   unit: "" },
  { key: "spd",        iconKey: "spd",           label: "Spd",  unit: "" },
  { key: "crc",        iconKey: "critRate",      label: "Cr",   unit: "%" },
  { key: "chd",        iconKey: "critDmg",       label: "Cd",   unit: "%" },
  { key: "critDmgRed", iconKey: "critDmgReduce", label: "Cdr",  unit: "%" },
  { key: "pen",        iconKey: "pen",           label: "Pen",  unit: "%" },
  { key: "dmgUp",      iconKey: "dmgUp",         label: "D↑",   unit: "%" },
  { key: "dmgRed",     iconKey: "dmgReduce",     label: "D↓",   unit: "%" },
  { key: "eff",        iconKey: "eff",           label: "Eff",  unit: "" },
  { key: "res",        iconKey: "effRes",        label: "Res",  unit: "" },
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
  { key: "hps",  label: "HpS",  formula: "HP × SPD",                        desc: "HP × Speed composite — fast-and-bulky." },
  { key: "ehp",  label: "Ehp",  formula: "HP × (DEF/300 + 1)",              desc: "Effective HP — how much damage the unit can soak." },
  { key: "ehps", label: "EhpS", formula: "EHP × SPD",                       desc: "EHP × Speed — tanky-and-fast." },
  { key: "dmg",  label: "Dmg",  formula: "ATK × CHC × CHD",                 desc: "Average damage, crit-chance weighted." },
  { key: "dmgs", label: "DmgS", formula: "ATK × CHC × CHD × SPD",           desc: "DPS — average damage × speed." },
  { key: "mcd",  label: "Mcd",  formula: "ATK × CHD",                       desc: "Max crit damage (assumes 100% CHC).", hideInTable: true },
  { key: "mcds", label: "McdS", formula: "ATK × CHD × SPD",                 desc: "Max DPS — Mcd × speed.",            hideInTable: true },
  { key: "dmgh", label: "DmgH", formula: "HP × CHD",                        desc: "Bruiser — HP-scaling burst.",       hideInTable: true },
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
  critDmgReduce: "CDR",
  pen:    "PEN",
  dmgUp:  "DMG↑",
  dmgReduce: "DMG↓",
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

/* ─────────────────────────────────────────────────────────────────────────
 * Solver filters — one reducer drives every panel. Lifting state up here
 * means we can hand the whole shape to the worker on SOLVE, and that the
 * "Reset filters" / "Clear" buttons are 1-line dispatches instead of having
 * to chase callbacks across each panel.
 * ───────────────────────────────────────────────────────────────────────── */
interface SolverOptions {
  onlyMaxed: boolean;
  useReforged: boolean;
  /** Include gear equipped on OTHER heroes in the candidate pool. The
   *  selected hero's own gear is always in. */
  includeEquippedOnOthers: boolean;
  /** Lock the selected hero's currently-equipped pieces — only fill empty
   *  slots and leave the rest alone. */
  keepCurrent: boolean;
}

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
  setPicks: Record<string, SetChipState>;
  weaponEffectPicks: Record<string, ChipState>;
  accessoryEffectPicks: Record<string, ChipState>;
}

const INITIAL_FILTERS: SolverFilters = {
  options: { onlyMaxed: false, useReforged: false, includeEquippedOnOthers: true, keepCurrent: false },
  excludedHeroes: new Set(),
  statFilters: {},
  ratingFilters: {},
  priority: {},
  topPct: 100,
  mainPicks: {},
  setPicks: {},
  weaponEffectPicks: {},
  accessoryEffectPicks: {},
};

type SolverAction =
  | { type: "setOption"; key: keyof SolverOptions; value: boolean }
  | { type: "toggleHeroExcluded"; uid: string }
  | { type: "setStatFilter"; stat: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setRatingFilter"; rating: string; bound: "min" | "max"; value: number | undefined }
  | { type: "setPriority"; stat: string; value: number }
  | { type: "setTopPct"; value: number }
  | { type: "toggleMainPick"; slot: SlotId; stat: string }
  | { type: "cycleSetPick"; setId: string; reach: SetChipReach }
  | { type: "cycleEffectPick"; group: "weapon" | "accessory"; icon: string }
  | { type: "clearPriority" }
  | { type: "resetAll" }
  /** Replace the entire filter state — used to apply a saved preset.
   *  Keeps the reducer as the single mutation point so React batches
   *  the rerender as a single update. */
  | { type: "loadPreset"; filters: SolverFilters }
  /** Reset the excluded-heroes list (action button on the multi-select). */
  | { type: "clearExcludedHeroes" };

function solverFiltersReducer(state: SolverFilters, action: SolverAction): SolverFilters {
  switch (action.type) {
    case "setOption":
      return { ...state, options: { ...state.options, [action.key]: action.value } };
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
    case "cycleSetPick": {
      const cur = state.setPicks[action.setId] ?? "off";
      const nxt = nextSetChipState(cur, action.reach);
      const next = { ...state.setPicks };
      if (nxt === "off") delete next[action.setId];
      else next[action.setId] = nxt;
      return { ...state, setPicks: next };
    }
    case "cycleEffectPick": {
      const key = action.group === "weapon" ? "weaponEffectPicks" : "accessoryEffectPicks";
      const cur = state[key][action.icon] ?? "off";
      const nxt = nextChipState(cur);
      const map = { ...state[key] };
      if (nxt === "off") delete map[action.icon];
      else map[action.icon] = nxt;
      return { ...state, [key]: map };
    }
    case "clearPriority":
      return { ...state, priority: {} };
    case "resetAll":
      return INITIAL_FILTERS;
    case "loadPreset":
      return action.filters;
    case "clearExcludedHeroes":
      return { ...state, excludedHeroes: new Set() };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Top-level layout
 * ───────────────────────────────────────────────────────────────────────── */
export function BuilderScreen({ inventory, game, userGeasLevels, userCodexLevel }: BuilderScreenProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [filters, dispatch] = useReducer(solverFiltersReducer, INITIAL_FILTERS);

  // Solver state — orchestrator stays alive for the screen's lifetime so
  // the worker pool isn't torn down between solves. Lazy-init on first SOLVE.
  const orchestratorRef = useRef<SolverOrchestrator | null>(null);
  const [solving, setSolving] = useState(false);
  const [solveProgress, setSolveProgress] = useState<{ permutations: number; searched: number; poolSizes: PoolSizes | null }>(
    { permutations: 0, searched: 0, poolSizes: null },
  );
  const [solveResults, setSolveResults] = useState<SolveBuild[]>([]);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [selectedBuildIdx, setSelectedBuildIdx] = useState<number | null>(null);
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

  const startSolve = (mode: SolveMode) => {
    if (!inventory || !game || !selectedUid) return;
    const selected = inventory.characters.find((c) => c.uid === selectedUid);
    if (!selected) return;
    if (!orchestratorRef.current) {
      orchestratorRef.current = new SolverOrchestrator({
        onProgress: (p) => setSolveProgress({ permutations: p.permutations, searched: p.searched, poolSizes: p.poolSizes ?? null }),
        onResult:   (builds) => { setSolveResults(builds); setSelectedBuildIdx(builds.length > 0 ? 0 : null); setSolving(false); },
        onError:    (msg) => { setSolveError(msg); setSolving(false); },
      });
    }
    setSolving(true);
    setSolveError(null);
    setSolveResults([]);
    setSelectedBuildIdx(null);
    setSolveProgress({ permutations: 0, searched: 0, poolSizes: null });
    setLastSolveMode(mode);
    const serializedFilters: SolveFilters = {
      options: filters.options,
      excludedHeroes: Array.from(filters.excludedHeroes),
      statFilters: filters.statFilters,
      ratingFilters: filters.ratingFilters,
      priority: filters.priority,
      topPct: filters.topPct,
      mainPicks: filters.mainPicks,
      // Reducer state uses the engine encoding 1:1, so the cast is safe.
      setPicks: filters.setPicks as SolveFilters["setPicks"],
      weaponEffectPicks: filters.weaponEffectPicks as SolveFilters["weaponEffectPicks"],
      accessoryEffectPicks: filters.accessoryEffectPicks as SolveFilters["accessoryEffectPicks"],
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
    });
  };

  const cancelSolve = () => orchestratorRef.current?.cancel();

  const selectedBuild = selectedBuildIdx != null ? solveResults[selectedBuildIdx] ?? null : null;

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
    setSolveResults([b.build]);
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
          // Deep-copy via JSON round-trip + Set re-materialization so a later
          // edit to the live `filters` doesn't mutate the stored snapshot.
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
    return { current };
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
      <TopPanelBand
        heroes={inventory.characters}
        game={game}
        selectedUid={selectedUid}
        onSelect={setSelectedUid}
        composition={composition}
        projectedStats={selectedBuild?.finalStats ?? null}
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
      />
      <div className="flex min-h-0 flex-1 gap-2">
        <ResultsTable
          builds={solveResults}
          selectedIdx={selectedBuildIdx}
          onSelect={setSelectedBuildIdx}
          solving={solving}
          error={solveError}
        />
        <RightSidebar
          canSave={selectedBuild != null}
          canSavePreset={selectedUid != null}
          onSaveBuild={saveCurrentBuild}
          onSavePreset={saveCurrentPreset}
          savedBuilds={savedBuildsForHero}
          onRestoreBuild={restoreBuild}
          onRemoveBuild={removeBuildById}
          presets={presetsForHero}
          onLoadPreset={loadPreset}
          onRemovePreset={removePresetById}
        />
      </div>
      <BottomGearBand build={selectedBuild} pieceByUid={pieceByUid} game={game} />
      {/* Fixed at the viewport bottom — escapes the flex layout via
       *  position:fixed, so the rest of the screen sees an extra
       *  `pb-9` reservation instead of laying out for it. */}
      <FilterFooter
        permutations={solveProgress.permutations}
        searched={solveProgress.searched}
        poolSizes={solveProgress.poolSizes}
        resultCount={solveResults.length}
        solving={solving}
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
          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none"
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
  icon: string;
  /** Effect display name — pulled from `game.equipmentPassives[itemId].name`
   *  (the canonical effect title like "Destruction"), with a fallback to
   *  the equipment item name and finally the icon filename. */
  name: string;
  /** Localized T4 effect description (`textByTier[4]`). Same passive applies
   *  to every item sharing this `effectIcon`, so any sample is canonical.
   *  Null when no passive is resolved (data gap). */
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
  const map = new Map<string, { name: string; descT4: string | null; owned: number }>();
  for (const g of inventory.gear) {
    // Use the design SlotId so the comparison is symmetric with the rest
    // of the panels (weapon/accessory happen to match the engine name 1:1
    // but going through `toDesignSlot` is the cheapest insurance against
    // future slot renames).
    if (toDesignSlot(g.slot) !== slot) continue;
    if (heroClass && g.classLimit && g.classLimit !== heroClass) continue;
    const def = game.equipment[String(g.itemId)];
    if (!def?.effectIcon) continue;
    const existing = map.get(def.effectIcon);
    if (existing) { existing.owned++; continue; }
    // First-seen icon: snapshot the effect title + T4 text from this
    // item's passive. Items sharing an icon carry the same passive, so a
    // single sample is canonical. textByTier[4] = T4 (build pipeline
    // already substituted Value/Rate/Turn placeholders).
    const passive = game.equipmentPassives[String(g.itemId)];
    const name = passive?.name ?? def.name ?? def.effectIcon;
    const descT4 = passive?.textByTier?.[4] ?? null;
    map.set(def.effectIcon, { name, descT4, owned: 1 });
  }
  return Array.from(map.entries())
    .map(([icon, { name, descT4, owned }]) => ({ icon, name, descT4, owned }))
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
 * Top band — 8 panels in a horizontal row (overflows on small widths)
 * ───────────────────────────────────────────────────────────────────────── */
function TopPanelBand({
  heroes, game, selectedUid, onSelect, composition, projectedStats,
  armorSets, weaponEffects, accessoryEffects, mainStatCatalogs,
  filters, dispatch,
  solving, canSolve, onSolve, onCancelSolve,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  composition: SelectedComposition | null;
  /** finalStats from the selected build in the results table, or null when
   *  no row is selected — drives the right column of `StatsPanel`. */
  projectedStats: FinalStats | null;
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
}) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2 pb-1">
      <HeroPanel
        heroes={heroes}
        game={game}
        value={selectedUid}
        onChange={onSelect}
        onResetFilters={() => dispatch({ type: "resetAll" })}
        solving={solving}
        canSolve={canSolve}
        onSolve={onSolve}
        onCancelSolve={onCancelSolve}
      />
      <StatsPanel stats={composition?.current ?? null} projected={projectedStats} />
      <OptionsPanel
        options={filters.options}
        excludedHeroes={filters.excludedHeroes}
        heroes={heroes}
        game={game}
        dispatch={dispatch}
      />
      <StatFiltersPanel filters={filters.statFilters} dispatch={dispatch} />
      <RatingFiltersPanel filters={filters.ratingFilters} dispatch={dispatch} />
      <SubstatPriorityPanel priority={filters.priority} topPct={filters.topPct} dispatch={dispatch} />
      <AccessoryMainStatsPanel catalogs={mainStatCatalogs} picks={filters.mainPicks} dispatch={dispatch} />
      <SetsPanel sets={armorSets} picks={filters.setPicks} dispatch={dispatch} />
      <WeaponsAccessoriesPanel
        weapons={weaponEffects}
        accessories={accessoryEffects}
        weaponPicks={filters.weaponEffectPicks}
        accPicks={filters.accessoryEffectPicks}
        dispatch={dispatch}
      />
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

/* ─────────────────────────────────────────────────────────────────────────
 * Hero panel — picker + portrait + action buttons stack
 * ───────────────────────────────────────────────────────────────────────── */
function HeroPanel({
  heroes, game, value, onChange, onResetFilters,
  solving, canSolve, onSolve, onCancelSolve,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  value: string | null;
  onChange: (uid: string | null) => void;
  onResetFilters: () => void;
  solving: boolean;
  canSolve: boolean;
  onSolve: (mode: SolveMode) => void;
  onCancelSolve: () => void;
}) {
  const selected = value ? heroes.find((c) => c.uid === value) ?? null : null;
  const meta = selected ? game?.characters[String(selected.charId)] ?? null : null;
  return (
    <Panel title="Hero" hint="Pick the hero to optimize gear for. The current snapshot is shown below." width="w-44">
      <HeroSelect heroes={heroes} game={game} value={value} onChange={onChange} />
      <div className="mt-2 flex flex-col items-center gap-1.5">
        {selected ? (
          <CharacterPortrait
            charId={selected.charId}
            name={displayNameOf(selected, meta)}
            cls={meta?.cls}
            element={meta?.element}
            size={88}
          />
        ) : (
          <div className="grid h-22 w-22 place-items-center rounded-md border border-dashed border-white/8 text-[10px] italic text-white/40">
            no hero
          </div>
        )}
        <div className="mt-1 grid w-full grid-cols-1 gap-0.5">
          <ActionButton tone="primary" disabled={!canSolve || solving} onClick={() => onSolve("score")}>SOLVE</ActionButton>
          <ActionButton disabled={!canSolve || solving} onClick={() => onSolve("cp")}>SOLVE CP</ActionButton>
          <ActionButton disabled={!solving} onClick={onCancelSolve}>Cancel</ActionButton>
          <ActionButton onClick={onResetFilters}>Reset filters</ActionButton>
        </div>
      </div>
    </Panel>
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const selected = value ? heroes.find((c) => c.uid === value) ?? null : null;
  const selectedName = selected ? displayNameOf(selected, game?.characters[String(selected.charId)] ?? null) : "";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((c) => heroSearchHaystack(c, game).includes(q));
  }, [heroes, game, query]);
  const display = open ? query : selectedName;
  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={display}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        placeholder={selectedName || "Search hero…"}
        className="w-full rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[11.5px] text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] italic text-white/40">No hero matches</div>
          ) : (
            <ul className="flex flex-col py-1">
              {filtered.map((c) => (
                <HeroOption
                  key={c.uid}
                  hero={c}
                  game={game}
                  active={c.uid === value}
                  onPick={() => { onChange(c.uid); setOpen(false); setQuery(""); }}
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
  hero, game, active, onPick,
}: { hero: Character; game: GameData | null; active: boolean; onPick: () => void }) {
  const meta = game?.characters[String(hero.charId)] ?? null;
  const name = displayNameOf(hero, meta);
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={cx(
          "flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-white/6",
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
function StatsPanel({ stats, projected }: { stats: FinalStats | null; projected: FinalStats | null }) {
  return (
    <Panel title="Stats" hint="Current stats on the left, projected stats from the selected build on the right." width="w-44">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
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
      <span className={cx("text-right", cur != null ? "text-white" : "text-white/30")}>
        {cur != null ? `${cur}${stat.unit}` : "—"}
      </span>
      <span className="text-white/40">▸</span>
      <span className={cx("text-right", projTone)}>
        {proj != null ? `${proj}${stat.unit}` : "—"}
      </span>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Options panel — pool / steal toggles + exclude-heroes multi-pill
 * ───────────────────────────────────────────────────────────────────────── */
function OptionsPanel({
  options, excludedHeroes, heroes, game, dispatch,
}: {
  options: SolverOptions;
  excludedHeroes: ReadonlySet<string>;
  heroes: Inventory["characters"];
  game: GameData | null;
  dispatch: Dispatch<SolverAction>;
}) {
  const set = (key: keyof SolverOptions) => (v: boolean) => dispatch({ type: "setOption", key, value: v });
  return (
    <Panel title="Options" hint="Pool toggles. Equipped items + Exclude equipped together drive what gear the solver may touch." width="w-44">
      <div className="space-y-0.5">
        <ToggleRow label="Use reforged stats" hint="Predict orange-tick reforges on +15 gear." checked={options.useReforged} onChange={set("useReforged")} />
        <ToggleRow label="Only maxed gear" hint="+15 pieces that can't enhance further." checked={options.onlyMaxed} onChange={set("onlyMaxed")} />
        <ToggleRow label="Equipped items" hint="Include gear equipped on other heroes (own hero always in)." checked={options.includeEquippedOnOthers} onChange={set("includeEquippedOnOthers")} />
        <ToggleRow label="Keep current" hint="Lock current pieces (only fill empty slots). Gems are still re-allocated — useful for 'keep my gear, tell me which gems to socket'." checked={options.keepCurrent} onChange={set("keepCurrent")} />
      </div>
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
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
        <span className="text-white/30">▾</span>
      </button>
      {excluded.size > 0 && (
        <button
          type="button"
          onClick={() => onClear()}
          className="px-1.5 py-1 text-white/40 hover:text-rose-300 focus:outline-none"
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
            className="shrink-0 border-b border-white/8 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:outline-none"
          />
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-[11px] italic text-white/40">No hero matches</li>
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
  return (
    <Panel
      title="Substat priority"
      hint="Score gear by Σ(max-rolls × priority); only keep the Top % per slot. Heuristic — too low a Top % drops optimal builds."
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
      <div className="mt-2 flex items-center gap-2 border-t border-white/6 pt-2">
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
      <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {entries.length === 0 ? (
          <span className="text-[10.5px] italic text-white/30">none owned</span>
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
  sets, picks, dispatch,
}: {
  sets: ArmorSetEntry[];
  picks: Record<string, SetChipState>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Sets"
      hint="Click cycles a set: off → 2pc → 4pc → excluded → off. The cycle skips any step the inventory can't form (need ≥2 pieces across 2 slots for 2pc, ≥4 across 4 slots for 4pc). Sets with no reachable bonus are dropped entirely. Score uses T4 effect values."
      width="w-60"
    >
      {sets.length === 0 ? (
        <div className="text-[11px] italic text-white/40">No forms-anything set in inventory</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {sets.map((s) => (
            <SetIconChip
              key={s.id}
              set={s}
              state={picks[s.id] ?? "off"}
              onClick={() => dispatch({
                type: "cycleSetPick",
                setId: s.id,
                reach: { has2pc: s.has2pc, has4pc: s.has4pc, canForm2pc: s.canForm2pc, canForm4pc: s.canForm4pc },
              })}
            />
          ))}
        </div>
      )}
    </Panel>
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
          onCycle={(icon) => dispatch({ type: "cycleEffectPick", group: "weapon", icon })}
        />
        <EffectGroup
          title="Accessories"
          effects={accessories}
          picks={accPicks}
          onCycle={(icon) => dispatch({ type: "cycleEffectPick", group: "accessory", icon })}
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
  onCycle: (icon: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">{title}</div>
      {effects.length === 0 ? (
        <div className="text-[10.5px] italic text-white/40">none</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {effects.map((e) => (
            <EffectIconChip
              key={e.icon}
              effect={e}
              state={picks[e.icon] ?? "off"}
              onClick={() => onCycle(e.icon)}
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
 *  - set chips:      off → req-4pc → (req-2pc when has2pc) → excluded → off
 * ───────────────────────────────────────────────────────────────────────── */
type ChipState = "off" | "required" | "excluded";
type SetChipState = "off" | "req-4pc" | "req-2pc" | "excluded";

function nextChipState(s: ChipState | undefined): ChipState {
  if (s === "required") return "excluded";
  if (s === "excluded") return "off";
  return "required";
}

/** Cycle a set chip through the states actually reachable for that set.
 *  Reachability blends two axes:
 *   - does the set HAVE the bonus at all? (`has2pc` / `has4pc` on the T4 row)
 *   - can the inventory FORM it? (`canForm2pc` / `canForm4pc`)
 *  Only states that pass both gates appear in the cycle. We never reach
 *  an "off" set without at least one usable state — the catalog drops
 *  fully-unusable sets upstream. */
function nextSetChipState(s: SetChipState | undefined, reach: SetChipReach): SetChipState {
  const can2pc = reach.has2pc && reach.canForm2pc;
  const can4pc = reach.has4pc && reach.canForm4pc;
  if (s === undefined || s === "off") return can2pc ? "req-2pc" : "req-4pc";
  if (s === "req-2pc") return can4pc ? "req-4pc" : "excluded";
  if (s === "req-4pc") return "excluded";
  return "off"; // excluded
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
function SetIconChip({ set, state, onClick }: { set: ArmorSetEntry; state: SetChipState; onClick: () => void }) {
  const picked = state === "req-2pc" || state === "req-4pc";
  const excluded = state === "excluded";
  const can2pc = set.has2pc && set.canForm2pc;
  const can4pc = set.has4pc && set.canForm4pc;
  const stateLabel =
    state === "off" ? (can2pc ? "click to require 2pc" : "click to require 4pc")
    : state === "req-2pc" ? (can4pc ? "required 2pc (click to switch to 4pc)" : "required 2pc (click to exclude)")
    : state === "req-4pc" ? "required 4pc (click to exclude)"
    : "excluded (click to clear)";
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
        <img src={`/img/ui/effect/${effect.icon}.webp`} alt={effect.name} className="pointer-events-none h-5 w-5 object-contain" />
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
function ResultsTable({
  builds, selectedIdx, onSelect, solving, error,
}: {
  builds: SolveBuild[];
  selectedIdx: number | null;
  onSelect: (i: number | null) => void;
  solving: boolean;
  error: string | null;
}) {
  // Per-column min/max for the heatmap — recomputed when builds change.
  // Stats and ratings are computed once; reused across every row.
  const ranges = useMemo(() => computeColumnRanges(builds), [builds]);
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
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/8 bg-bg-elev-2">
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-1.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Results</span>
          <span className="text-[10.5px] italic text-white/40">
            {solving ? "Solving…" : error ? "Solver error — see below." : "Click a row to reveal the equipment that produced it. Click a column header to sort."}
          </span>
        </div>
        <Pill tone={error ? "rose" : "emerald"}>{builds.length} builds</Pill>
      </div>
      {error && (
        <div className="border-b border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[10.5px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-bg-elev-2 text-white/70">
            <tr className="border-b border-white/8">
              <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider">sets</th>
              {SOLVER_STATS.slice(0, 8).map((s) => (
                <SortHeader key={s.key} colKey={s.key} title={s.label} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  {s.label.toLowerCase()}
                </SortHeader>
              ))}
              {TABLE_RATINGS.map((r) => (
                <SortHeader key={r.key} colKey={r.key} title={r.desc} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  {r.label.toLowerCase()}
                </SortHeader>
              ))}
              <SortHeader colKey="score" title="Aggregate priority-weighted score" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort} className="text-amber-300">
                score
              </SortHeader>
              <SortHeader colKey="upg" title="Number of slots that differ from the hero's current loadout" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                upg
              </SortHeader>
              <th className="px-1.5 py-1 text-right text-[9.5px] uppercase tracking-wider">actions</th>
            </tr>
          </thead>
          <tbody>
            {builds.length === 0 && !solving && !error && (
              // 1 sets + 8 stats + N ratings + score + upg + actions.
              // Derived rather than hardcoded — TABLE_RATINGS can change.
              <tr><td colSpan={1 + 8 + TABLE_RATINGS.length + 3} className="px-3 py-12 text-center text-[11px] italic text-white/40">
                Pick a hero and click SOLVE to populate the results.
              </td></tr>
            )}
            {sortedBuilds.map((b) => {
              const idx = buildIndexOf.get(b) ?? 0;
              return (
                <ResultRow
                  key={idx}
                  build={b}
                  selected={b === selectedBuildRef}
                  ranges={ranges}
                  onClick={() => onSelect(idx)}
                />
              );
            })}
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
function computeColumnRanges(builds: SolveBuild[]): ColumnRanges {
  const stat: ColumnRanges["stat"] = {};
  const rating: ColumnRanges["rating"] = {};
  let scoreMin = Infinity, scoreMax = -Infinity;
  for (const b of builds) {
    for (const s of SOLVER_STATS.slice(0, 8)) {
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

function ResultRow({
  build, selected, ranges, onClick,
}: {
  build: SolveBuild;
  selected?: boolean;
  ranges: ColumnRanges;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cx(
        "cursor-pointer border-b border-white/4 hover:bg-white/4",
        selected && "bg-rose-900/30 hover:bg-rose-900/40",
      )}
    >
      <td className="px-1.5 py-1 text-left text-white/40">—</td>
      {SOLVER_STATS.slice(0, 8).map((s) => {
        const v = (build.finalStats as unknown as Record<string, number>)[s.key];
        return (
          <td key={s.key} className={cx("px-1.5 py-1 text-right text-white", heatCellNew(v, ranges.stat[s.key]))}>
            {fmt(v, s.unit)}
          </td>
        );
      })}
      {TABLE_RATINGS.map((r) => {
        const v = r.key === "cp" ? build.cp : (build.ratings as unknown as Record<string, number>)[r.key];
        return (
          <td key={r.key} className={cx("px-1.5 py-1 text-right text-white", heatCellNew(v, ranges.rating[r.key]))}>
            {fmt(v, "")}
          </td>
        );
      })}
      <td className={cx("px-1.5 py-1 text-right font-semibold text-amber-200", heatCellNew(build.score, ranges.score))}>
        {build.score}
      </td>
      <td className="px-1.5 py-1 text-right text-white/70" title={`${build.upg} slot(s) differ from current loadout`}>
        {build.upg}
      </td>
      <td className="px-1.5 py-1 text-right text-white/70">
        {selected && <span title="Selected">★</span>}
      </td>
    </tr>
  );
}

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded}${unit}`;
}

/** Continuous heatmap from rose (worst column value) to emerald (best),
 *  with neutral midline. Falls back to no shading when the column is flat
 *  (min === max) or the value is missing. */
function heatCellNew(v: number | null | undefined, range: { min: number; max: number } | undefined): string {
  if (v == null || !range || !isFinite(range.min) || range.min === range.max) return "";
  const t = (v - range.min) / (range.max - range.min);
  if (t > 0.75) return "bg-emerald-500/20";
  if (t > 0.55) return "bg-emerald-500/10";
  if (t < 0.25) return "bg-rose-500/15";
  if (t < 0.45) return "bg-rose-500/6";
  return "";
}

/* ─────────────────────────────────────────────────────────────────────────
 * Right sidebar — Save build / save preset actions + per-hero library
 * ───────────────────────────────────────────────────────────────────────── */
function RightSidebar({
  canSave, canSavePreset,
  onSaveBuild, onSavePreset,
  savedBuilds, onRestoreBuild, onRemoveBuild,
  presets, onLoadPreset, onRemovePreset,
}: {
  canSave: boolean;
  canSavePreset: boolean;
  onSaveBuild: () => void;
  onSavePreset: () => void;
  savedBuilds: ReadonlyArray<SavedBuild>;
  onRestoreBuild: (b: SavedBuild) => void;
  onRemoveBuild: (id: string) => void;
  presets: ReadonlyArray<FilterPreset>;
  onLoadPreset: (p: FilterPreset) => void;
  onRemovePreset: (id: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2">
      <Panel title="Library" hint="Save the currently selected build / current filter setup for this hero. Per-hero, persisted in localStorage." width="w-full">
        <div className="grid grid-cols-1 gap-1">
          <ActionButton tone="primary" disabled={!canSave} onClick={onSaveBuild}>Save build</ActionButton>
          <ActionButton disabled={!canSavePreset} onClick={onSavePreset}>Save filter preset</ActionButton>
        </div>
      </Panel>

      <Panel title="Saved builds" hint="Click a build to load it into the table + bottom band. The trash icon removes it permanently." width="w-full">
        {savedBuilds.length === 0 ? (
          <div className="text-[10.5px] italic text-white/40">No saved builds for this hero.</div>
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
          <div className="text-[10.5px] italic text-white/40">No presets for this hero.</div>
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
        <span className="truncate text-[10px] text-white/40">{subtitle}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 px-1 text-[12px] text-white/30 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
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
  permutations, searched, poolSizes, resultCount, solving,
}: {
  permutations: number;
  searched: number;
  poolSizes: PoolSizes | null;
  resultCount: number;
  solving: boolean;
}) {
  // Slots rendered in the same order the inventory tab uses so the user's
  // eye-flow is identical across tabs.
  const slots: SlotId[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "talisman"];
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/8 bg-bg-elev-2/95 px-3 py-1.5 font-mono text-[10.5px] tabular-nums backdrop-blur-sm">
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
      <span className="text-white/30">/</span>
      <FilterBig label="S" value={searched} title="Permutations that survived stat + rating filters and got scored." />
      <span className="text-white/20">|</span>
      <FilterBig label="Results" value={resultCount} title="Builds returned to the table (top-N by Score or CP)." />
      {solving && (
        <span className="ml-auto text-[10px] uppercase tracking-wider text-cyan-300/80 animate-pulse">solving…</span>
      )}
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
      <span className="text-white/40">({pct}%)</span>
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
  build, pieceByUid, game,
}: {
  build: SolveBuild | null;
  pieceByUid: Map<string, GearPiece>;
  game: GameData | null;
}) {
  // Map engine slot → piece UID for the selected build. The result's
  // `pieceUids` array carries slot order (engine names) but here we re-key
  // by GearSlot to render the design slot icons.
  const pieceBySlot = useMemo(() => {
    const map = new Map<string, GearPiece>();
    if (!build) return map;
    for (const uid of build.pieceUids) {
      const p = pieceByUid.get(uid);
      if (p?.slot) map.set(p.slot, p);
    }
    return map;
  }, [build, pieceByUid]);

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {RESULT_GEAR_SLOTS.map((slot) => {
        // RESULT_GEAR_SLOTS uses design names — convert "talisman" back to
        // the engine "ooparts" lookup key.
        const engineSlot = slot === "talisman" ? "ooparts" : slot;
        const piece = pieceBySlot.get(engineSlot) ?? null;
        return <GearCard key={slot} slot={slot} piece={piece} game={game} />;
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
function GearCard({ slot, piece, game }: { slot: SlotId; piece: GearPiece | null; game: GameData | null }) {
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
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-white/8 bg-bg-elev-1 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cx("truncate font-display text-[13px] font-semibold", name ? "text-white" : "text-white/40")}>
          {name ?? "—"}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <SlotMini slot={slot} piece={iconPiece} size={56} />
        <div className="min-w-0 flex-1 text-[11px] leading-tight">
          <div className={cx("italic", piece ? "text-white/70" : "text-white/40")}>
            {piece ? `+${piece.enhanceLevel}${piece.ascended ? " · ascended" : ""}` : "—"}
          </div>
          <div className="text-white">{slotMeta?.label ?? slot}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
        <StatIcon stat={mainStatKey} size={16} className="shrink-0" />
        <span className="flex-1 text-white">{mainStatMeta?.longLabel ?? mainStatKey}</span>
        <span className={cx("font-semibold", mainStat ? "text-white" : "text-white/40")}>
          {mainStat ? `${mainStat.value}${mainStat.percent ? "%" : ""}` : "—"}
        </span>
      </div>

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
          <div className="text-[10.5px] italic text-white/30">—</div>
        )}
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
