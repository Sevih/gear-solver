/**
 * Builder solver session — the orchestrator (worker pool) lifecycle, SOLVE and
 * cancel, the debounced pre-solve estimate, live progress and the result set
 * with its post-solve client filter. State the Builder screen owned inline,
 * grouped in one hook; the screen keeps the hero switch, which resets it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character, GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { resolveWorkerCount, SolverOrchestrator, type SolveDebugInfo } from "../../lib/solver/orchestrator.js";
import type { PoolSizes, SolveBuild, SolveEmptyCause, SolveMode } from "../../lib/solver/types.js";
import type { HeroPriority } from "../../lib/storage/heroPriority.js";
import type { PresetHolds } from "../../lib/presets/presetHolds.js";
import { buildSolveFilters, type MinMax, type SolverFilters } from "../../lib/solver/builderFilters.js";
import type { ReforgeContext } from "../../lib/solver/reforge.js";
import { teamSolveScope } from "../../lib/teams/teamContext.js";
import { ZERO_SOLVE_COUNTS, createSolveCountsStore } from "./solveCounts.js";

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

type DisplayFilter = { statFilters: Record<string, MinMax>; ratingFilters: Record<string, MinMax> };

/** The stored results narrowed by the post-solve client filter (all of them
 *  without one). */
function applyDisplayFilter(results: SolveBuild[], filter: DisplayFilter | null): SolveBuild[] {
  return filter ? results.filter((b) => buildPassesFilters(b, filter.statFilters, filter.ratingFilters)) : results;
}

interface SolverSessionInput {
  selectedUid: string | null;
  selected: Character | null;
  inventory: Inventory | null;
  game: GameData | null;
  filters: SolverFilters;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  heroPriority: HeroPriority;
  excludedPieceUids: Set<string> | undefined;
  worklistClaims: Record<string, string> | undefined;
  /** In-game presets' pieces, ranks and locks (App's `presetHolds`). */
  presetHolds: PresetHolds | undefined;
  /** The preset being optimized ("Optimize preset →"), null otherwise. */
  targetPresetNum: number | null;
  /** Team context (a member's "Optimize →" on the Teams tab): the solve takes
   *  any piece but `exclusion`, scope "all", without the ranks, the Worklist
   *  claims, the preset holds or a target preset (`teamSolveScope`). */
  team?: { exclusion: ReadonlySet<string> } | null;
  workerCount: number | null;
  topN: number;
  topK: number;
}

export function useSolverSession({ selectedUid, selected, inventory, game, filters, userGeasLevels, userCodexLevel, heroPriority: globalHeroPriority, excludedPieceUids: globalExcludedPieceUids, worklistClaims: globalWorklistClaims, presetHolds: globalPresetHolds, targetPresetNum: globalTargetPresetNum, team = null, workerCount, topN, topK }: SolverSessionInput) {
  // What the solve and the estimate read beyond the hero — the filters and the
  // account-wide rules, or a team member's piece rule in team context.
  const scope = useMemo(
    () => teamSolveScope({ filters, heroPriority: globalHeroPriority, excludedPieceUids: globalExcludedPieceUids, worklistClaims: globalWorklistClaims, presetHolds: globalPresetHolds, targetPresetNum: globalTargetPresetNum }, team),
    [filters, globalHeroPriority, globalExcludedPieceUids, globalWorklistClaims, globalPresetHolds, globalTargetPresetNum, team],
  );
  const { heroPriority, excludedPieceUids, worklistClaims, presetHolds, targetPresetNum } = scope;
  const solveFilters = scope.filters;
  // SOLVE mode (the toolbar's Score | CP control), lifted here so the pre-solve cartesian
  // estimate can prepare pools for the mode that will actually fire (the prune
  // RANKING differs: Score ranks by priority — or raw roll magnitude without
  // one — while CP uses a CP proxy; the combo budget bounds both).
  // The mode defaults to Score and is NOT persisted — every launch starts on
  // Score rather than remembering a prior CP.
  const [solveMode, setSolveMode] = useState<SolveMode>("score");

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
  // Live solve progress. The P / S counts tick ~10×/s during a solve, so they
  // live in a store only the footer subscribes to (re-rendering the whole
  // screen per tick was the cost); `poolSizes` lands once per solve (precompute)
  // and feeds the empty-pool banner + cartesian guard-rail here, so it stays
  // state (the orchestrator re-sends the same object each tick → no re-render).
  const [progressStore] = useState(createSolveCountsStore);
  const [livePoolSizes, setLivePoolSizes] = useState<PoolSizes | null>(null);
  const resetSolveProgress = useCallback(() => { progressStore.set(ZERO_SOLVE_COUNTS); setLivePoolSizes(null); }, [progressStore]);
  const [solveResults, setSolveResults] = useState<SolveBuild[]>([]);
  /** Wall-clock of the last completed solve (ms), shown in the footer; null
   *  while solving or before the first solve. */
  const [lastSolveMs, setLastSolveMs] = useState<number | null>(null);
  /** Per-solve diagnostic from the orchestrator — only populated when
   *  `gs.debug.solver` is on. Backs the footer's "Copy Debug Info" button. */
  const [lastDebugInfo, setLastDebugInfo] = useState<SolveDebugInfo | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  /** Why the last completed solve came back empty when no slot pool is (see
   *  `SolveEmptyCause`) — null otherwise. */
  const [emptyCause, setEmptyCause] = useState<SolveEmptyCause | null>(null);
  /** Pre-solve pool sizes — `precomputeContext` run on the main thread (debounced)
   *  as filters/hero change, so the cartesian guard-rail appears BEFORE clicking
   *  SOLVE, not after the precompute at solve start. Null until first computed. */
  const [estimatePools, setEstimatePools] = useState<PoolSizes | null>(null);
  /** The selected result, held by reference — not as an index: an index into
   *  the filtered list pointed at another build once "Clear filter" brought
   *  the full list back (the 3rd filtered row, #17, became row #3). The index
   *  the table reads is derived from it (`selectedBuildIdx`). */
  const [selectedBuild, setSelectedBuild] = useState<SolveBuild | null>(null);
  /** Post-solve client filter — a snapshot of the stat/rating bands applied to
   *  the STORED results (no re-solve). Null = show every stored build. Set by
   *  the toolbar's "Filter" button; cleared whenever a fresh result set lands
   *  (a new solve already applied the bands server-side). */
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter | null>(null);
  /** Track the mode used for the last solve — surfaces on Save Build so we
   *  preserve "this build came from SOLVE CP" vs "from SOLVE". */
  const [lastSolveMode, setLastSolveMode] = useState<SolveMode>("score");

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
      // dispose() tears the pool down WITHOUT flushing — if a solve was in
      // flight, its onResult will never fire, which stranded the screen in
      // "solving…" with a no-op Cancel (the ref is null). Release the UI here.
      setSolving(false);
      resetSolveProgress();
    }
  }, [workerCount, resetSolveProgress]);

  // Lazily create the orchestrator — shared by SOLVE and the debounced
  // pre-solve estimate (which runs on the orchestrator's dedicated estimate
  // worker, so the main thread never pays the precompute).
  const getOrchestrator = (): SolverOrchestrator => {
    if (!orchestratorRef.current) {
      orchestratorRef.current = new SolverOrchestrator({
        onProgress: (p) => { progressStore.set({ permutations: p.permutations, searched: p.searched }); setLivePoolSizes(p.poolSizes ?? null); },
        onResult:   (builds, durationMs, debugInfo, tickWeights, cause) => { setSolveResults(builds); setResultsReforge({ ...solveReforgeRef.current, tickWeights }); setSelectedBuild(builds[0] ?? null); setDisplayFilter(null); setSolving(false); setLastSolveMs(durationMs); setLastDebugInfo(debugInfo ?? null); setEmptyCause(cause); },
        // A failed solve never shows builds: the orchestrator drops what the
        // finished workers returned (a partial search), the table stays empty.
        onError:    (msg) => { setSolveError(msg); setSolving(false); setSolveResults([]); setSelectedBuild(null); },
      });
    }
    return orchestratorRef.current;
  };

  /** `pinPieceUids`: the pieces kept through the prunes — only the solve a
   *  result cell's "Min ≥ / Max ≤" launches passes them (its row). */
  const startSolve = (mode: SolveMode, pinPieceUids?: readonly string[]) => {
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
    const orchestrator = getOrchestrator();
    setSolving(true);
    setSolveError(null);
    setEmptyCause(null);
    setSolveResults([]);
    setSelectedBuild(null);
    setDisplayFilter(null);
    setLastSolveMs(null);
    resetSolveProgress();
    setLastSolveMode(mode);
    // Snapshot the reforge context for this run (shallow-copy the priority so
    // a later filter edit can't mutate what `onResult` reads). Under "Only
    // maxed" the engine skips the projection (pieces scored as-is), so the
    // display context is "disable" — the cards must show the real rolls the
    // engine scored, not a re-projected preview. Same for the Transistone
    // potential. The passive picks go with it: the table marks the required
    // families the engine counted (the solve's, not a later edit).
    const serializedFilters = buildSolveFilters(solveFilters);
    solveReforgeRef.current = {
      reforgeMode: filters.options.onlyMaxed ? "disable" : filters.options.reforgeMode,
      priority: { ...filters.priority },
      rerollPotential: !filters.options.onlyMaxed && (filters.options.rerollPotential ?? false),
      ...(serializedFilters.passivePicks ? { passivePicks: serializedFilters.passivePicks } : {}),
    };
    orchestrator.solve({
      mode,
      heroUid: selectedUid,
      inventory,
      game,
      userGeasLevels,
      userCodexLevel,
      heroPriority,
      excludedPieceUids: excludedPieceUids ? Array.from(excludedPieceUids) : undefined,
      worklistClaims,
      presetHolds,
      targetPresetNum,
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
      ...(pinPieceUids?.length ? { pinPieceUids: [...pinPieceUids] } : {}),
    });
  };

  const cancelSolve = () => orchestratorRef.current?.cancel();

  // Results actually shown — the stored set, optionally narrowed by the
  // post-solve client filter (no re-solve). The table's selection index points
  // into THIS array; it is derived from the selected build, so adding or
  // clearing the filter keeps the same build selected wherever its row moves
  // (null while the build isn't shown).
  const displayedResults = useMemo(() => applyDisplayFilter(solveResults, displayFilter), [solveResults, displayFilter]);
  const selectedBuildIdx = useMemo(() => {
    if (!selectedBuild) return null;
    const i = displayedResults.indexOf(selectedBuild);
    return i >= 0 ? i : null;
  }, [displayedResults, selectedBuild]);
  /** Select the row at `i` of the shown results (the table's click payload). */
  const selectBuildAt = useCallback((i: number | null) => setSelectedBuild(i != null ? displayedResults[i] ?? null : null), [displayedResults]);
  // Resolved solver worker-pool size — surfaced in the footer so the user can
  // confirm the search uses the whole machine. Recomputes when the override
  // setting changes (Settings → Solver) so the read-out stays live.
  const resolvedWorkers = useMemo(() => resolveWorkerCount(workerCount), [workerCount]);
  // Apply the current stat/rating bands to the stored results without
  // re-solving. Re-anchors the selection to the new top row.
  const applyClientFilter = () => {
    const next: DisplayFilter = { statFilters: filters.statFilters, ratingFilters: filters.ratingFilters };
    setDisplayFilter(next);
    setSelectedBuild(applyDisplayFilter(solveResults, next)[0] ?? null);
  };

  // Recompute the pre-solve cartesian estimate (debounced) whenever the hero /
  // filters / mode change while idle. Runs the same `precomputeContext` a solve
  // would — but for the mode that will fire, so the prune matches — on the
  // orchestrator's DEDICATED estimate worker: on a big inventory the CP-mode
  // precompute (reforge sim + per-piece CP ranking + dominance) costs 100ms+,
  // which used to jank the main thread on every filter edit. Skips while
  // solving (live poolSizes win) and when not ready; a stale response is
  // dropped by the orchestrator (latest estimate wins).
  useEffect(() => {
    // No hero / mid-solve: drop any stale estimate so the guard-rail banner
    // doesn't linger from a previous hero. Live poolSizes cover the solving case.
    if (solving || !selectedUid || !inventory || !game || !selected) { setEstimatePools(null); return; }
    const handle = setTimeout(() => {
      getOrchestrator().estimate({
        mode: solveMode,
        heroUid: selectedUid,
        inventory,
        game,
        userGeasLevels,
        userCodexLevel,
        heroPriority,
        excludedPieceUids: excludedPieceUids ? Array.from(excludedPieceUids) : undefined,
        worklistClaims,
        presetHolds,
        targetPresetNum,
        userSkills: {
          first: selected.skills.first,
          second: selected.skills.second,
          ultimate: selected.skills.ultimate,
          chainPassive: selected.skills.chainPassive,
        },
        filters: buildSolveFilters(solveFilters),
      }, (poolSizes) => setEstimatePools(poolSizes));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solving, selectedUid, inventory, game, selected, solveFilters, solveMode, heroPriority, excludedPieceUids, worklistClaims, presetHolds, targetPresetNum, userGeasLevels, userCodexLevel]);

  return {
    solveMode, setSolveMode, orchestratorRef, resultsReforge, setResultsReforge, solving, setSolving, progressStore,
    livePoolSizes, resetSolveProgress, solveResults, setSolveResults, lastSolveMs, setLastSolveMs, lastDebugInfo,
    setLastDebugInfo, solveError, setSolveError, emptyCause, setEmptyCause, estimatePools, selectedBuild: selectedBuildIdx != null ? selectedBuild : null,
    selectedBuildIdx, setSelectedBuild, selectBuildAt, displayFilter, setDisplayFilter, lastSolveMode, setLastSolveMode, startSolve, cancelSolve,
    displayedResults, resolvedWorkers, applyClientFilter,
  };
}
