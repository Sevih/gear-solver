/**
 * Builder — Fribbels-style dense optimizer: filters reducer, every panel, and
 * the wiring to the solver orchestrator (worker pool), results and equip.
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
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Character, GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, effectiveCharacter, expToLevel } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import { SLOT_BY } from "../../design/tokens.js";
import { dmgSkillInfo } from "../../lib/dmgSkill.js";
import { computeFinalStats } from "../../lib/composeBuild.js";
import { calcBattlePower } from "../../lib/solver/cp.js";
import type { HeroPriority } from "../../lib/storage/heroPriority.js";
import {
  INITIAL_FILTERS, solverFiltersReducer,
} from "../../lib/solver/builderFilters.js";
import { talismanFamilyKeys, translateRecoBuild, type StructuredCharacterReco, type StructuredRecoBuild } from "../../lib/reco/translateReco.js";
import { fetchRecoForHero } from "../../lib/reco/fetchReco.js";
import { equipPieces } from "../../equip.js";
import type { WorklistChange, WorklistEntry } from "../../lib/storage/worklist.js";
import { loadHeroFilters, persistHeroFilters, cloneFilters, filtersForHero, snapshotOnHeroSwitch, type HeroFiltersMap } from "../../lib/storage/heroFilters.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { deltaCpLabel } from "../../lib/deltaCp.js";
import { diffBuildVsLoadout } from "../../lib/buildDiff.js";
import {
  addSavedBuild, loadSavedBuilds, persistSavedBuilds, removeSavedBuild,
  type SavedBuild, type SavedBuildsMap,
} from "../../lib/storage/savedBuilds.js";
import {
  addFilterPreset, loadFilterPresets, persistFilterPresets, removeFilterPreset,
  type FilterPreset, type FilterPresetsMap,
} from "../../lib/storage/filterPresets.js";
import { onBackupImported } from "../../lib/storage/transfer.js";
import { migrateReforge, REFORGE_MODES } from "./reforge.js";
import type { SelectedComposition } from "./composition.js";
import { displayNameOf } from "./heroName.js";
import { armorSetCatalogFromInventory, effectCatalogFromInventory, mainStatCatalogFromInventory, type MainStatEntry } from "./catalogs.js";
import { MAIN_STAT_SLOTS } from "./statColumns.js";
import { BuilderToolbar } from "./BuilderToolbar.js";
import { ResultsTable, RESULT_ROW_H } from "./ResultsTable.js";
import { EquipBuildButton } from "./EquipBuildButton.js";
import { BottomGearBand } from "./BottomGearBand.js";
import { StatsPanel } from "./StatsPanel.js";
import { BuildEffectsPanel } from "./BuildEffectsPanel.js";
import { SubValuePanel } from "./SubValuePanel.js";
import { DmgPer1PctPanel } from "./DmgPer1PctPanel.js";
import { RightSidebar } from "./RightSidebar.js";
import { RecoBuildPicker } from "./RecoBuildPicker.js";
import { FilterFooter } from "./FilterFooter.js";
import { PromptDialog } from "./PromptDialog.js";
import { useSolverSession } from "./useSolverSession.js";

interface BuilderScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Account-wide Geas node levels — falls back to per-node max in the composer. */
  userGeasLevels: UserGeasLevels | null;
  /** Resolved codex level 0..11 — composer fallback if null. */
  userCodexLevel: number | null;
  /** Account-global hero priority ranks (owned by App, edited in Builds) — fed
   *  to the solver for the "Equipped items → ≤ lower priority" scope. */
  heroPriority: HeroPriority;
  /** Account-global "never use" piece UIDs (owned by App, edited in Inventory)
   *  — dropped from every slot pool before the cartesian. */
  excludedPieceUids?: Set<string>;
  /** Worklist reservations (pieceUid → claiming heroUid, unapplied changes only,
   *  owned by App) — a claimed piece is treated by the solver as if equipped on
   *  the claiming hero, so the equipped scope + rank rules honor what earlier
   *  queued builds already reserved. */
  worklistClaims?: Record<string, string>;
  /** Toggle a piece in/out of the global exclusion set (App owns it) — wired to
   *  the results gear-card footer so a trash roll can be excluded from results. */
  onToggleExclude?: (uid: string) => void;
  /** Hero UID to preselect on mount — set when the user clicks "Optimize →"
   *  on the Builds tab. Read once via the `selectedUid` initializer. */
  initialHeroUid?: string | null;
  /** Called once on mount after consuming `initialHeroUid`, so the parent can
   *  clear it (a later plain visit to the Builder shouldn't re-preselect). */
  onInitialHeroConsumed?: () => void;
  /** Called after "Equip build" rewrote the captured snapshot, so the parent
   *  re-imports the inventory (App's `refreshInventory`). */
  onAfterEquip?: () => void;
  /** Queue the selected build's per-slot diff onto the cross-hero worklist
   *  (App owns the list). Undefined disables the "Add to worklist" button. */
  onAddToWorklist?: (entry: WorklistEntry) => void;
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

/** Cartesian size (∏ per-slot pools) above which the Builder warns the solve
 *  will be slow and nudges the user to prune. Sits above the combo budget of
 *  any pruned solve (`COMBO_BUDGET × topPct/30`: ~16M at the default Top% 60,
 *  ~26M at 99), so those clear it, while an exhaustive (Top% 100) solve on a
 *  real account trips it. */
const CARTESIAN_WARN = 50_000_000;

/** Compact big-number label for the guard-rail (2.4e9 → "2.4B"). */
function formatCombos(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Top-level layout
 * ───────────────────────────────────────────────────────────────────────── */
export function BuilderScreen({ inventory, game, userGeasLevels, userCodexLevel, heroPriority, excludedPieceUids, worklistClaims, onToggleExclude, initialHeroUid, onInitialHeroConsumed, onAfterEquip, onAddToWorklist, workerCount = null, topN = 1000, topK = 1000, heatmap = true }: BuilderScreenProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(initialHeroUid ?? null);
  // Results table viewport height, in rows — capped so the bottom gear band
  // stays visible instead of the table greedily eating all vertical space.
  // Persisted so the user's preferred split survives reloads.
  const [resultRows, setResultRows] = usePersistedState<number>("gs.builder.resultRows", 12);
  // Adopt a preselect from the parent (Builds → Optimize) whenever it arrives,
  // then let the parent clear it. Keyed on `initialHeroUid` (not mount-only) so
  // it works on later clicks too — the Builder now stays mounted across tabs,
  // so a fresh Optimize is a prop change rather than a remount.
  useEffect(() => {
    if (initialHeroUid) {
      setSelectedUid(initialHeroUid);
      onInitialHeroConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHeroUid]);
  // Per-hero filter memory (session-scoped). `filtersRef` mirrors the live
  // filters so the hero-change effect can snapshot the OUTGOING hero without
  // depending on `filters` (which would re-fire it on every edit). `prevHeroRef`
  // tracks whose filters are currently loaded; `heroFiltersRef` is the map.
  // The map is read from sessionStorage ONCE (lazy state init — a plain
  // `useRef(loadHeroFilters())` re-parsed it on every render); the reducer
  // starts on the initial hero's remembered set.
  const [initialHeroFilters] = useState<HeroFiltersMap>(loadHeroFilters);
  const heroFiltersRef = useRef<HeroFiltersMap>(initialHeroFilters);
  const [filters, dispatch] = useReducer(solverFiltersReducer, initialHeroUid ?? null,
    (uid: string | null) => filtersForHero(initialHeroFilters, uid, INITIAL_FILTERS));
  const filtersRef = useRef(filters);
  const prevHeroRef = useRef(selectedUid);
  // Live selection for async callbacks — their closure keeps the hero they
  // started on (see `getPreset`).
  const selectedUidRef = useRef(selectedUid);
  // Synced after the commit, not during render. Layout effects of a commit all
  // run before its passive effects, so the hero-change effect below still reads
  // the filters of the render that changed the hero (the OUTGOING hero's set).
  useLayoutEffect(() => {
    filtersRef.current = filters;
    selectedUidRef.current = selectedUid;
  });
  /** Transient "Added ✓" confirmation on the Add-to-worklist button. */
  const [worklistAdded, setWorklistAdded] = useState(false);

  // Persistence — loaded once on mount, mutated via the add/remove helpers
  // and re-persisted explicitly (vs hooking into a useEffect that fires
  // on every render, which would re-write the blob on hero switch etc.).
  const [savedBuildsMap, setSavedBuildsMap] = useState<SavedBuildsMap>(() => loadSavedBuilds());
  const [filterPresetsMap, setFilterPresetsMap] = useState<FilterPresetsMap>(() => loadFilterPresets());
  // A backup import (Settings) writes localStorage behind this mounted screen:
  // reload both maps, or the next persist would overwrite the imported entries.
  useEffect(() => onBackupImported(() => {
    setSavedBuildsMap(loadSavedBuilds());
    setFilterPresetsMap(loadFilterPresets());
  }), []);

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

  // Index characters by uid so the result gear cards can resolve each piece's
  // `equippedBy` to a character — surfacing whether applying a recommended
  // piece would steal it off another hero.
  const charsByUid = useMemo(() => {
    const m = new Map<string, Character>();
    if (inventory) for (const c of inventory.characters) m.set(c.uid, c);
    return m;
  }, [inventory]);

  const selected = useMemo<Character | null>(() => {
    if (!inventory) return null;
    return selectedUid ? inventory.characters.find((c) => c.uid === selectedUid) ?? null : null;
  }, [inventory, selectedUid]);

  // Solver session — orchestrator, solves, pre-solve estimate, progress and
  // results (`useSolverSession`).
  const {
    solveMode, setSolveMode, orchestratorRef, resultsReforge, setResultsReforge, solving, setSolving, progressStore,
    livePoolSizes, resetSolveProgress, solveResults, setSolveResults, lastSolveMs, setLastSolveMs, lastDebugInfo,
    setLastDebugInfo, solveError, setSolveError, emptyCause, setEmptyCause, estimatePools, selectedBuildIdx,
    setSelectedBuildIdx, displayFilter, setDisplayFilter, lastSolveMode, setLastSolveMode, startSolve, cancelSolve,
    displayedResults, resolvedWorkers, applyClientFilter,
  } = useSolverSession({ selectedUid, selected, inventory, game, filters, userGeasLevels, userCodexLevel, heroPriority, excludedPieceUids, worklistClaims, workerCount, topN, topK });

  /** Whether any stat/rating band is set — gates the Filter button (nothing to
   *  apply otherwise). */
  const hasAnyBand = Object.keys(filters.statFilters).length > 0 || Object.keys(filters.ratingFilters).length > 0;

  const selectedBuild = selectedBuildIdx != null ? displayedResults[selectedBuildIdx] ?? null : null;

  /** Selected build vs the hero's current loadout, per slot — the ONE "slot
   *  changed" rule (the engine's `upg`: piece not on the hero today) read by
   *  Equip, + Worklist and the bottom gear band. */
  const buildDiff = useMemo(
    () => (selectedBuild && selectedUid ? diffBuildVsLoadout(selectedBuild.pieceUids, selectedUid, pieceByUid) : []),
    [selectedBuild, selectedUid, pieceByUid],
  );

  // ── Equip build ──────────────────────────────────────────────────────────
  // Apply the selected build's pieces to the selected hero by rewriting the
  // captured snapshot (`equipPieces`), then let App re-import. We surface how
  // many pieces actually move: skip those already on this hero, and count the
  // ones that would be taken off another hero ("stolen") so the button can warn.
  const equipPlan = useMemo(() => {
    let moving = 0, steal = 0;
    for (const d of buildDiff) {
      if (!d.changed) continue; // already on this hero
      moving++;
      if (d.proposed.equippedBy) steal++; // currently on someone else
    }
    return { uids: buildDiff.map((d) => d.proposed.uid), moving, steal };
  }, [buildDiff]);

  // Returns false on a network error or a 409 (Steam plugin live) so the
  // button can flag it; on success App re-imports the rewritten snapshot.
  async function equipSelectedBuild(): Promise<boolean> {
    if (!game || !selectedUid || equipPlan.uids.length === 0) return false;
    const ok = await equipPieces(game, equipPlan.uids, selectedUid);
    if (ok) onAfterEquip?.();
    return ok;
  }

  // When a solve yields no builds, an empty per-slot pool is almost always
  // the cause (filters too strict, or the hero owns no piece for that slot).
  // Surface exactly which slots collapsed to 0 so "0 builds" isn't a silent
  // dead-end. Derived from the last solve's pool sizes (null until a solve
  // runs → falls back to the generic "pick a hero" hint). The EE slot is
  // skipped: a hero without one reports `exclusive: 0` and solves without it.
  const emptyReason = useMemo(() => {
    const ps = livePoolSizes;
    if (!ps) return null;
    const dead = Object.keys(ps).filter((s) => s !== "exclusive" && (ps[s]?.hit ?? 0) === 0);
    if (dead.length === 0) return null;
    return dead.map((s) => `${SLOT_BY[s]?.label ?? s}: 0 pieces after filters`).join(" · ");
  }, [livePoolSizes]);

  // Guard-rail — rough size of the cartesian the solver walks (∏ of the
  // partitionable per-slot pools, post-prune; EE isn't partitioned). While
  // solving the LIVE poolSizes are authoritative; when idle we use the debounced
  // pre-solve `estimatePools` so the warning shows BEFORE clicking SOLVE.
  // 0 if any slot is empty (the emptyReason banner covers that case).
  const cartesianEstimate = useMemo(() => {
    const ps = solving ? livePoolSizes : (estimatePools ?? livePoolSizes);
    if (!ps) return 0;
    let n = 1;
    for (const s of ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "talisman"] as const) {
      n *= ps[s]?.hit ?? 0;
    }
    return n;
  }, [solving, livePoolSizes, estimatePools]);

  // Saved-builds handlers — `selectedUid` gates everything; the UI hides /
  // disables the controls when no hero is picked so we don't have to thread
  // null-checks past these helpers' callers.
  // Save build AND its filter preset in one action — a build is only meaningful
  // alongside the filters that produced it, so the two are persisted together
  // under the same name (no separate "save preset" step).
  const saveCurrentBuild = () => {
    if (!selectedBuild || !selectedUid) return;
    const placeholder = `Build ${(savedBuildsMap[selectedUid]?.length ?? 0) + 1}`;
    setNamePrompt({
      title: "Save build + filter preset",
      placeholder,
      onConfirm: (name) => {
        const finalName = name.trim() || placeholder;
        const createdAt = Date.now();
        const buildEntry: SavedBuild = {
          id: crypto.randomUUID(),
          name: finalName,
          heroUid: selectedUid,
          mode: lastSolveMode,
          build: selectedBuild,
          reforge: resultsReforge,
          createdAt,
        };
        const nextBuilds = addSavedBuild(savedBuildsMap, buildEntry);
        setSavedBuildsMap(nextBuilds);
        persistSavedBuilds(nextBuilds);
        // Filter preset snapshot (same name). `excludedHeroes` is copied into a
        // fresh Set; a shallow copy is enough because the reducer never mutates
        // its Sets in place (it always builds a new one).
        const presetEntry: FilterPreset = {
          id: crypto.randomUUID(),
          name: finalName,
          heroUid: selectedUid,
          filters: { ...filters, excludedHeroes: new Set(filters.excludedHeroes) },
          createdAt,
        };
        const nextPresets = addFilterPreset(filterPresetsMap, presetEntry);
        setFilterPresetsMap(nextPresets);
        persistFilterPresets(nextPresets);
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

  // Filter-preset handlers. Presets are created alongside builds (see
  // `saveCurrentBuild`); these handle loading and removal.
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

  // "Get preset" — fetch this hero's outerpedia build reco and overlay it on
  // the current filters (mergePreset). Multiple named builds → a small picker.
  const [recoBusy, setRecoBusy] = useState(false);
  const [recoStatus, setRecoStatus] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [recoPicker, setRecoPicker] = useState<StructuredCharacterReco | null>(null);
  // Stable — the picker's Escape listener is keyed on `onClose`.
  const closeRecoPicker = useCallback(() => setRecoPicker(null), []);
  // Clear stale reco feedback when the hero changes.
  useEffect(() => { setRecoStatus(null); setRecoPicker(null); }, [selectedUid]);

  // Switching heroes: RESULTS are a clean slate (per-hero, stale otherwise), but
  // FILTERS are remembered per hero (session-scoped) — snapshot the outgoing
  // hero's set, restore the incoming hero's (or defaults if first time), so
  // returning to a hero brings back "what did I set here again?". Cancel any
  // in-flight solve first so its async `onResult` can't repopulate the table for
  // the wrong hero. No-op while the hero is unchanged — the initial mount and
  // StrictMode's re-run (the reducer already holds the initial hero's set).
  useEffect(() => {
    const prev = prevHeroRef.current;
    const snapshot = snapshotOnHeroSwitch(heroFiltersRef.current, prev, selectedUid, filtersRef.current);
    if (!snapshot) return;
    orchestratorRef.current?.cancel();
    if (prev) {
      heroFiltersRef.current = snapshot;
      persistHeroFilters(snapshot);
    }
    const saved = selectedUid ? heroFiltersRef.current[selectedUid] : undefined;
    dispatch(saved ? { type: "loadPreset", filters: cloneFilters(saved) } : { type: "resetAll" });
    prevHeroRef.current = selectedUid;
    setSolving(false);
    setSolveResults([]);
    setSelectedBuildIdx(null);
    setDisplayFilter(null);
    setSolveError(null);
    setEmptyCause(null);
    setLastSolveMs(null);
    setLastDebugInfo(null);
    setResultsReforge({ reforgeMode: "disable", priority: {} });
    resetSolveProgress();
    setLastSolveMode("score");
    // The session's setters and `orchestratorRef` are stable (useState / useRef
    // inside `useSolverSession`) — the lint can't see it through the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, resetSolveProgress]);

  const applyRecoBuild = (name: string, build: StructuredRecoBuild) => {
    // Resolve each recommended item to its unique effect key (setId) via the
    // loaded game data — the reco only carries effectIcon, which isn't unique.
    // A talisman widens to its whole family (4★/5★/6★ share a name, not a setId).
    const resolveEffectKey = (itemId: number | null) =>
      itemId != null && game ? game.equipment[String(itemId)]?.setId ?? null : null;
    const { patch, warnings } = translateRecoBuild(build, resolveEffectKey, game ? talismanFamilyKeys(game.equipment) : undefined);
    dispatch({ type: "mergePreset", patch });
    setRecoPicker(null);
    // No member of a preferred family owned leaves the pool open — say so.
    const preferredTalismans = Object.keys(patch.talismanEffectPicks);
    const talismanNote = preferredTalismans.length > 0 && game && inventory
      && !inventory.gear.some((g) => g.slot === "ooparts" && preferredTalismans.includes(game.equipment[String(g.itemId)]?.setId ?? ""))
      ? " None of the recommended talismans is owned — any talisman will be used."
      : "";
    setRecoStatus(
      warnings.length > 0
        ? { tone: "warn", text: `Applied "${name}" — ${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings[0]}${talismanNote}` }
        : { tone: "ok", text: `Applied "${name}".${talismanNote}` },
    );
  };

  const getPreset = async () => {
    if (!selected) return;
    setRecoBusy(true);
    setRecoStatus(null);
    setRecoPicker(null);
    const r = await fetchRecoForHero(selected.uid, selected.charId, () => selectedUidRef.current);
    setRecoBusy(false);
    // Hero switched mid-fetch: this reco belongs to the previous hero — never
    // merge it into the new one's filters (the switch already cleared reco UI).
    if (r === null) return;
    if (r.status === "none") { setRecoStatus({ tone: "warn", text: "No build reco for this hero yet." }); return; }
    if (r.status === "error") { setRecoStatus({ tone: "error", text: `Reco fetch failed: ${r.message}` }); return; }
    const names = Object.keys(r.reco.builds);
    const only = names[0];
    if (names.length === 1 && only) { applyRecoBuild(only, r.reco.builds[only]!); return; }
    setRecoPicker(r.reco); // multiple builds → let the user pick which one
  };

  /** Compose the picked hero's full stats (gear included) via the shared
   *  composeBuild helpers, on the hero's effective character (the Core Fusion
   *  variant when fused). Same pipeline the Builds tab uses — so a hero's
   *  Current column here matches their card there. */
  const composition = useMemo<SelectedComposition | null>(() => {
    if (!inventory || !game || !selected) return null;
    const meta = effectiveCharacter(selected, game.characters).def;
    if (!meta?.ingredients || !game.codexCurve) return null;
    const level = expToLevel(game.expCharacter, selected.exp);
    const lbKey = meta.star != null && selected.levelMaxStep > 0 ? `${meta.star}|${selected.levelMaxStep}` : null;
    const levelMaxModifier = lbKey ? (game.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
    const composed = composeCharStats(meta.ingredients, game.codexCurve, {
      transStar: selected.stars,
      fusionLevel: selected.fusionLevel,
      level,
      levelMaxModifier,
      levelMaxStep: selected.levelMaxStep,
      userGeasLevels,
      userSkillLevels: { first: selected.skills.first, second: selected.skills.second, ultimate: selected.skills.ultimate },
      ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
    });
    const equippedPieces = inventory.gear.filter((g) => g.equippedBy === selected.uid);
    const current = computeFinalStats(composed.noGearStats, composed.scaling, equippedPieces, game);
    // Current-loadout Battle Power — same CalcBattlePower the Builds tab computes,
    // so ΔCP in the gear-band header reads against a faithful baseline. Needs the
    // TransStar UI metadata (showUIStar/starPlus) + equipped EE/Talisman.
    const transRow = meta.ingredients.transcendByStar?.[String(selected.stars)] ?? null;
    const ee = equippedPieces.find((p) => p.slot === "exclusive") ?? null;
    const ooparts = equippedPieces.find((p) => p.slot === "ooparts") ?? null;
    const currentCp = transRow
      ? calcBattlePower({
          stats: current,
          showUIStar: transRow.showUIStar ?? 0,
          starPlus: transRow.starPlus ?? 0,
          skills: selected.skills,
          ee,
          ooparts,
          fused: selected.fusionCharId !== 0,
        })
      : null;
    const sumFlat = (s: { baseValue: number; evoValue: number; awakValue: number }) => s.baseValue + s.evoValue + s.awakValue;
    const baseFlat = { atk: sumFlat(composed.scaling.atk), def: sumFlat(composed.scaling.def), hp: sumFlat(composed.scaling.hp) };
    const dmgStat = meta.dmgStat ?? "atk";
    const amp = (k: "atk" | "def" | "hp") => 1 + (composed.scaling[k]?.buffPct ?? 0) / 100;
    const dmgAmp = { atk: amp("atk"), def: amp("def"), hp: amp("hp") };
    return { current, currentCp, baseFlat, dmgStat, dmgSec: meta.dmgSec, dmgAmp, noCrit: meta.noCrit ?? false, dmgSkill: dmgSkillInfo(meta.bestSkill) };
  }, [inventory, game, selected, userGeasLevels, userCodexLevel]);

  /** Battle-Power swing of the selected build vs the hero's current loadout —
   *  the headline number for "is this swap worth it?". Null until both a build
   *  is selected and the current-loadout CP composed. The build side is in the
   *  results' reforge mode, the loadout side as captured — the label says so
   *  (`deltaCpLabel`). */
  const deltaCp = selectedBuild?.cp != null && composition?.currentCp != null
    ? selectedBuild.cp - composition.currentCp
    : null;
  const deltaCpText = deltaCp != null
    ? deltaCpLabel(
        deltaCp,
        resultsReforge.reforgeMode,
        REFORGE_MODES.find((m) => m.value === resultsReforge.reforgeMode)?.label ?? resultsReforge.reforgeMode,
      )
    : null;

  // Queue the selected build's per-slot diff (changed slots only) onto the
  // cross-hero worklist — `buildDiff`, the same "changed" rule as Equip and
  // `upg`. No-op when nothing moves.
  const addToWorklist = () => {
    if (!selectedBuild || !selectedUid || !selected || !onAddToWorklist) return;
    const nameOf = (x: GearPiece) => game?.equipment[String(x.itemId)]?.name ?? x.name ?? `Item ${x.itemId}`;
    const changes: WorklistChange[] = [];
    for (const { slot, proposed: p, worn: current, changed } of buildDiff) {
      if (!changed) continue; // unchanged slot — not actionable
      const main = p.main.find((m) => !m.combatOnly) ?? null;
      changes.push({
        slot,
        toUid: p.uid,
        toName: nameOf(p),
        toMain: main ? { stat: main.stat, value: main.value, percent: main.percent } : null,
        fromUid: current?.uid ?? null,
        fromName: current ? nameOf(current) : null,
        done: false,
      });
    }
    if (changes.length === 0) return;
    const meta = game?.characters[String(selected.charId)] ?? null;
    onAddToWorklist({
      id: crypto.randomUUID(),
      heroUid: selectedUid,
      heroName: displayNameOf(selected, meta ? { nickname: meta.nickname ?? null } : null),
      // Portrait id — the fused variant's, like the Builds card.
      charId: effectiveCharacter(selected, game?.characters).charId,
      mode: lastSolveMode,
      cp: selectedBuild.cp ?? null,
      upg: selectedBuild.upg,
      changes,
      createdAt: Date.now(),
    });
    setWorklistAdded(true);
  };
  // "Added ✓" reverts after 1.5 s — the timer is cleared on unmount.
  useEffect(() => {
    if (!worklistAdded) return;
    const t = window.setTimeout(() => setWorklistAdded(false), 1500);
    return () => window.clearTimeout(t);
  }, [worklistAdded]);

  /** Selected hero's class (Striker / Mage / …). Null when no hero is picked
   *  yet — the weapon / accessory effect palettes fall back to "all classes"
   *  in that case so the user can scan what's possible. */
  const heroClass = useMemo<string | null>(() => {
    if (!selected || !game) return null;
    return effectiveCharacter(selected, game.characters).def?.cls ?? null;
  }, [selected, game]);

  /** Catalogs are inventory-driven: only show options the user has at least
   *  one matching piece for. Otherwise the chip is just clutter for the
   *  optimizer — picking a set / effect with 0 owned matches blocks every
   *  result. */
  const armorSetCatalog = useMemo(() => armorSetCatalogFromInventory(inventory, game), [inventory, game]);
  const weaponEffectCatalog = useMemo(() => effectCatalogFromInventory(inventory, game, "weapon", heroClass), [inventory, game, heroClass]);
  const accessoryEffectCatalog = useMemo(() => effectCatalogFromInventory(inventory, game, "accessory", heroClass), [inventory, game, heroClass]);
  const talismanEffectCatalog = useMemo(() => effectCatalogFromInventory(inventory, game, "talisman", heroClass), [inventory, game, heroClass]);
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
        talismanEffects={talismanEffectCatalog}
        mainStatCatalogs={mainStatCatalogs}
        filters={filters}
        dispatch={dispatch}
        solving={solving}
        canSolve={selectedUid != null}
        solveMode={solveMode}
        setSolveMode={setSolveMode}
        onSolve={startSolve}
        onCancelSolve={cancelSolve}
        canFilter={solveResults.length > 0 && hasAnyBand}
        filterActive={displayFilter != null}
        onFilter={applyClientFilter}
        onClearFilter={() => setDisplayFilter(null)}
        dmgSkill={composition?.dmgSkill ?? null}
      />
      {cartesianEstimate > CARTESIAN_WARN && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] leading-snug text-amber-200">
          <span aria-hidden className="mt-px">⚠</span>
          <span>
            ~{formatCombos(cartesianEstimate)} combinations to search — this can take minutes.
            Lower <b>Top %</b>, set a substat <b>priority</b>, or require a <b>set</b> to cut it down.
          </span>
        </div>
      )}
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
              brokenSetsEmpty={!emptyReason && emptyCause === "brokenSets"}
              filteredOut={solveResults.length > 0 && displayedResults.length === 0}
              statFilters={filters.statFilters}
              rows={resultRows}
              onRowsChange={setResultRows}
              pieceByUid={pieceByUid}
              armorSets={armorSetCatalog}
              game={game}
              heatmap={heatmap}
              dmgSkill={composition?.dmgSkill ?? null}
            />
          </div>
          {/* Gear band takes the remaining height and scrolls if the window is
              too short — so the results table above never has to shrink. */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/55">
                  {selectedBuild ? "Selected build" : "No build selected"}
                </span>
                {selectedBuild && (
                  <span className="flex items-center gap-2 text-[10px] tabular-nums text-white/45">
                    {/* Read off the live inventory (`buildDiff`), not the solve-time
                        `upg`: after Equip the re-imported snapshot says 0. */}
                    <span>{equipPlan.moving} slot{equipPlan.moving === 1 ? "" : "s"} change</span>
                    {deltaCp != null && deltaCpText && (
                      <span
                        className={cx("font-semibold", deltaCp > 0 ? "text-emerald-300" : deltaCp < 0 ? "text-rose-300" : "text-white/50")}
                        title={deltaCpText.title ?? undefined}
                      >
                        {deltaCpText.text}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={addToWorklist}
                  disabled={!selectedBuild || equipPlan.moving === 0 || !onAddToWorklist}
                  title="Queue these changes onto the Worklist tab to apply later (across heroes)."
                  className={cx(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors",
                    !selectedBuild || equipPlan.moving === 0 || !onAddToWorklist
                      ? "cursor-not-allowed border-white/6 bg-white/2 text-white/45"
                      : worklistAdded
                        ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        : "border-white/8 bg-white/3 text-white hover:bg-white/6",
                  )}
                >
                  {worklistAdded ? "Added ✓" : "+ Worklist"}
                </button>
                <EquipBuildButton
                  disabled={!selectedBuild || !selectedUid || !game || equipPlan.moving === 0}
                  moving={equipPlan.moving}
                  steal={equipPlan.steal}
                  heroName={selected?.name ?? null}
                  onEquip={equipSelectedBuild}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BottomGearBand build={selectedBuild} diff={buildDiff} game={game} reforge={resultsReforge} charsByUid={charsByUid} excludedPieceUids={excludedPieceUids} onToggleExclude={onToggleExclude} />
            </div>
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
          <BuildEffectsPanel build={selectedBuild} pieceByUid={pieceByUid} game={game} />
          <SubValuePanel baseFlat={composition?.baseFlat ?? null} subTicks={game?.subTicks} width="w-full" />
          <DmgPer1PctPanel comp={composition ?? null} width="w-full" />
          <RightSidebar
            canSave={selectedBuild != null}
            onSaveBuild={saveCurrentBuild}
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
          onClose={closeRecoPicker}
        />
      )}
      {/* Fixed at the viewport bottom — escapes the flex layout via
       *  position:fixed, so the rest of the screen sees an extra
       *  `pb-9` reservation instead of laying out for it. */}
      <FilterFooter
        progress={progressStore}
        poolSizes={livePoolSizes}
        resultCount={displayedResults.length}
        solving={solving}
        workerCount={resolvedWorkers}
        durationMs={lastSolveMs}
        debugInfo={lastDebugInfo}
      />
      <PromptDialog
        prompt={namePrompt}
        onClose={() => setNamePrompt(null)}
      />
    </div>
  );
}

/** Gems on a Talisman / EE card — the build's gems ONLY (showing the socketed
 *  set AS substats too was just noise). When the solver reallocated, show its
 *  recommendation with a "swap" badge; otherwise show the piece's currently-
 *  socketed gems, marked "current". The displayed stats are computed WITH the
 *  shown gems (SOLVE CP), so they stay consistent. */
function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h2 className="font-display text-[18px] font-semibold text-white">{title}</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/60">{subtitle}</p>
    </div>
  );
}
