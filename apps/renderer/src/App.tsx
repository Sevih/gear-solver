import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { GameData, Inventory, RawUserItem, RawUserCharacter, UserGeasLevels } from "@gear-solver/core";
import { autoImport, parseFiles } from "./data.js";
import { streamCapture, getCaptureStatus, type CaptureStatus } from "./capture.js";
import { getEmulators, type EmulatorStatus } from "./emulator.js";
import { getGameVersion } from "./game-version.js";
import { GsHeader, PageBackground, type Tab } from "./design/Shell.js";
import { LogView } from "./design/LogView.js";
import { SettingsModal } from "./design/SettingsModal.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { usePersistedState } from "./hooks/usePersistedState.js";
import { HERO_PRIORITY_KEY, type HeroPriority } from "./lib/storage/heroPriority.js";
import { loadWorklist, persistWorklist, reconcileWorklist, remainingChangeCount, type WorklistEntry } from "./lib/storage/worklist.js";
import type { InventoryDrill } from "./screens/InventoryScreen.js";
import { loadExcludedPieces, persistExcludedPieces, toggleExcludedPiece } from "./lib/storage/excludedPieces.js";

// Per-screen code splits — each screen ships its own chunk so the initial
// bundle drops to just the shell + the first screen the user opens.
// BuildsScreen pulls in compose-stats + the gear icon set; InventoryScreen
// pulls the design tokens + the GearRow/Card pair; Builder is mostly empty
// today but isolated for future growth. Suspense boundary below renders a
// minimal placeholder while the chunk arrives (one-time, then cached).
const InventoryScreen = lazy(() => import("./screens/InventoryScreen.js").then((m) => ({ default: m.InventoryScreen })));
const BuildsScreen = lazy(() => import("./screens/BuildsScreen.js").then((m) => ({ default: m.BuildsScreen })));
const BuilderScreen = lazy(() => import("./screens/BuilderScreen.js").then((m) => ({ default: m.BuilderScreen })));
const WorklistScreen = lazy(() => import("./screens/WorklistScreen.js").then((m) => ({ default: m.WorklistScreen })));

/** Per-screen error boundary — a throw in a `useMemo`/render (e.g. a bad
 *  filter combo or stale persisted state) used to blank the whole app with
 *  no message. This catches it, shows the error + a Retry, and keeps the
 *  shell (header/tabs) alive. Conditionally-rendered screens remount fresh on
 *  return; the always-mounted Builder passes `resetKey={tab}` so navigating
 *  away and back clears a crash without remounting it (which would wipe the
 *  solver results we keep alive). */
class ScreenErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[screen crash]", error, info.componentStack);
  }
  override componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <h2 className="font-display text-[16px] font-semibold text-rose-300">Something broke on this screen</h2>
          <p className="max-w-md font-mono text-[11.5px] leading-relaxed text-zinc-400">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[12px] text-cyan-100 hover:bg-cyan-500/25"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Resolved-at-build-time site version (set in next.config / vite env).
const APP_VERSION =
  (typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION) ||
  "0.4";

export function App() {
  // Home is the default landing tab (fresh installs open here). Returning
  // users keep whatever tab they last left via the persisted value.
  const [tab, setTab] = usePersistedState<Tab>("gs.tab", "Home");
  // Builder mounts on first visit and then stays mounted (hidden when inactive),
  // so its solver results — and a solve still running — survive tab switches.
  const builderMounted = useRef(false);
  builderMounted.current ||= tab === "Builder";
  const [game, setGame] = useState<GameData | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [userGeas, setUserGeas] = useState<UserGeasLevels | null>(null);
  const [userCodex, setUserCodex] = useState<number | null>(null);
  // Account-global hero priority ranks — edited in Builds, read by the Builder
  // for the "Equipped items → ≤ lower priority" scope. Owned here so an edit in
  // Builds is live in the (kept-mounted) Builder.
  const [heroPriority, setHeroPriority] = usePersistedState<HeroPriority>(HERO_PRIORITY_KEY, {});
  const [status, setStatus] = useState("");
  const [capStatus, setCapStatus] = useState<CaptureStatus | null>(null);
  const [emulator, setEmulator] = useState<EmulatorStatus | null>(null);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [running, setRunning] = useState<"none" | "capture" | "disarm">("none");
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  // Onboarding wizard — persisted "seen" flag so the modal only auto-opens
  // once per fresh install. The header's gear icon re-opens it on demand.
  // `wizardOpen` is the immediate UI state; `onboardingDone` survives reloads.
  const [onboardingDone, setOnboardingDone] = usePersistedState<boolean>("gs.onboarding.done", false);
  const [wizardOpen, setWizardOpen] = useState(!onboardingDone);
  // Off by default — the stat-lock / drift / copy-dump tooling on the Builds
  // tab is a regression-debug aid for stat-formula work, not a normal user
  // feature. Toggling on in Settings reveals the lock buttons + drift badges.
  const [debugStatLocks, setDebugStatLocks] = usePersistedState<boolean>("gs.debug.statLocks", false);
  // Mirrors `gs.debug.solver` read by lib/log.ts — flips the orchestrator's
  // fan-out / merge / duration logging on. Persisted so it survives reloads
  // while profiling a slow solve.
  const [debugSolver, setDebugSolver] = usePersistedState<boolean>("gs.debug.solver", false);
  // Solver tuning (edited in Settings → Solver, consumed by the Builder).
  // workerCount: null = auto (hardwareConcurrency − 1); a number pins the pool
  // size. Shares `gs.solver.workerCount` with the non-React `resolveWorkerCount`.
  const [workerCount, setWorkerCount] = usePersistedState<number | null>("gs.solver.workerCount", null);
  // topN = ranked builds returned to the table; topK = per-worker heap depth
  // before merge (advanced — too low drops good builds). Heatmap = results-table
  // column shading.
  const [solverTopN, setSolverTopN] = usePersistedState<number>("gs.solver.topN", 1000);
  const [solverTopK, setSolverTopK] = usePersistedState<number>("gs.solver.topK", 1000);
  const [heatmap, setHeatmap] = usePersistedState<boolean>("gs.builder.heatmap", true);
  // Hero to preselect when the Builder tab opens — set by the Builds tab's
  // "Optimize →" button, consumed (and cleared) by BuilderScreen on mount so
  // a later normal visit to the Builder doesn't re-preselect a stale hero.
  const [builderHero, setBuilderHero] = useState<string | null>(null);
  // Cross-hero gear-change queue — built from the Builder ("Add to worklist"),
  // worked through on the Worklist tab. Owned here so an add in the (kept-mounted)
  // Builder is live on the Worklist tab. Persisted to localStorage on each change.
  const [worklist, setWorklist] = useState<WorklistEntry[]>(() => loadWorklist());
  const commitWorklist = (next: WorklistEntry[]) => { setWorklist(next); persistWorklist(next); };
  // Pending Inventory drill-down from a Home dashboard click — set + switch to
  // the Inventory tab, consumed (and cleared) by InventoryScreen on apply.
  const [invDrill, setInvDrill] = useState<InventoryDrill | null>(null);
  // Account-global "never use" piece UIDs — edited in Inventory (right-click),
  // consumed by the Builder's solver. Owned here so an Inventory edit is live
  // for the (kept-mounted) Builder. Durable (localStorage).
  const [excludedPieces, setExcludedPieces] = useState<Set<string>>(() => loadExcludedPieces());
  // Stable identity so the memoized Inventory GearTiles don't all re-render on
  // every App render (only the toggled tile's `excluded` prop changes).
  const toggleExclude = useCallback((uid: string) => setExcludedPieces((prev) => {
    const next = toggleExcludedPiece(prev, uid);
    persistExcludedPieces(next);
    return next;
  }), []);

  async function refreshInventory(label: string) {
    const r = await autoImport();
    setGame(r.game);
    setInv(r.inventory);
    setUserGeas(r.userGeasLevels);
    setUserCodex(r.userCodexLevel);
    if (r.inventory) {
      // Silent on the initial auto-import — the loaded inventory is its
      // own visual signal (tab badges fill in, tiles render). Only chime
      // when an explicit user action (Reload, Capture OK, Manual import)
      // produced the refresh.
      setStatus(label === "Auto-import" ? "" : `${label} · ${r.game ? "stats resolved" : "engine-only fallback"}`);
    } else setStatus(r.game ? "Game data loaded - no capture found." : "No data. Arm capture to begin.");
  }

  // Manual "Sync game data" — pulls fresh tables from the outerpedia repo and
  // rebuilds the derived data, then re-imports so the renderer picks it up.
  // Surfaced from the Home tab's System health / Quick actions.
  async function syncGameData() {
    setStatus("Syncing game data…");
    try {
      const r = await fetch("/api/data/sync", { method: "POST" });
      const j = (await r.json().catch(() => null)) as { status?: string; message?: string } | null;
      await refreshInventory("Game data synced");
      setStatus(j?.message ? `Game data: ${j.message}` : "Game data synced.");
    } catch {
      setStatus("Game data sync failed.");
    }
  }

  // Auto-prune the worklist whenever the inventory changes (recapture, reload,
  // local apply, data sync): any queued change whose target piece is now on the
  // hero is done for real → drop it (and any entry it empties). Source of truth
  // is the fresh snapshot, not the manual "done" ticks.
  useEffect(() => {
    setWorklist((prev) => {
      const { next, changed } = reconcileWorklist(prev, inv);
      if (changed) persistWorklist(next);
      return next;
    });
  }, [inv]);

  useEffect(() => { void refreshInventory("Auto-import"); }, []);
  useEffect(() => { void getCaptureStatus().then(setCapStatus); }, []);
  useEffect(() => { void getEmulators().then(setEmulator); }, []);
  useEffect(() => { void getGameVersion().then(setGameVersion); }, []);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    let userItem: RawUserItem | null = null;
    let userChar: RawUserCharacter | undefined;
    for (const f of Array.from(files)) {
      const j = JSON.parse(await f.text());
      if (j.ItemList) userItem = j as RawUserItem;
      else if (j.CharList) userChar = j as RawUserCharacter;
    }
    if (userItem) {
      setInv(parseFiles(game, userItem, userChar));
      setStatus("Manual import OK");
    }
  }

  async function runCapture(mode: "capture" | "disarm") {
    if (running !== "none") return;
    setRunning(mode);
    setLog([]); setLogOpen(true);
    try {
      const { exitCode } = await streamCapture(
        mode === "capture" ? "/api/capture/run" : "/api/capture/disarm",
        (line) => setLog((l) => [...l, line]),
      );
      if (mode === "capture") {
        if (exitCode === 0) {
          await refreshInventory("Capture OK");
          // Leave the pipeline ARMED. The lobby auto-tap only fetches
          // /user/{info,asset,character,item} — it never opens the Codex
          // (Hero Archive) or Gift screens, so /archive/info + /gift/info
          // (codex level + geas) are missing. Keeping it armed lets the user
          // open those two screens in-game; the endpoints then decode in the
          // background and a Disarm picks them up. mitmdump is still torn
          // down on app quit (disarmIfArmed on before-quit), so nothing leaks.
          setStatus("Inventory captured — pipeline still armed. Open the Codex and Gift screens in-game to grab codex + geas, then click Disarm.");
          void getCaptureStatus().then(setCapStatus);
        }
        else if (exitCode === 2) setStatus("Pipeline armed — play to the lobby, then reload.");
        else setStatus(`Capture failed (exit ${exitCode}) — see log.`);
      } else {
        // Disarm tears down the pipeline; reload so any supplementary
        // endpoints captured while armed (codex, geas) get ingested.
        if (exitCode === 0) await refreshInventory("Pipeline disarmed");
        else setStatus(`Disarm failed (exit ${exitCode}).`);
        void getCaptureStatus().then(setCapStatus);
      }
    } catch (err) {
      setLog((l) => [...l, `[client] ${err instanceof Error ? err.message : String(err)}`]);
      setStatus("Network error during capture.");
    } finally {
      setRunning("none");
      void getCaptureStatus().then(setCapStatus);
    }
  }

  const captureState = running === "capture" ? "capturing" : (capStatus?.armed ? "armed" : "idle");

  return (
    <PageBackground>
      <GsHeader
        active={tab}
        onTabChange={setTab}
        version={APP_VERSION}
        gameVersion={gameVersion}
        counts={{
          // Home has no natural count badge — it's the landing dashboard.
          Home: null,
          // Total piece count is the more useful at-a-glance figure than
          // "equipped/total" (we always know it from inv.gear.length without
          // resolving char ownership). Null while no capture has loaded yet.
          Inventory: inv ? inv.gear.length : null,
          // Builds = number of distinct equipped characters. Computed on the
          // fly — sparse enough to not need memoization.
          Builds: inv ? new Set(inv.gear.filter((g) => g.equippedBy).map((g) => g.equippedBy)).size : null,
          Builder: null,
          // Pending (not-yet-applied) gear changes across all queued builds.
          Worklist: remainingChangeCount(worklist, inv) || null,
        }}
        capture={{
          state: captureState,
          onCapture: () => runCapture("capture"),
          onDisarm: () => runCapture("disarm"),
          onReload: () => {
            void refreshInventory("Reloaded inventory");
            void getEmulators().then(setEmulator);
          },
          busy: running !== "none",
        }}
        emulator={{
          label: emulator?.chosen?.label ?? null,
          port: emulator?.chosenPort ?? null,
        }}
        onSetup={() => setWizardOpen(true)}
      />

      <SettingsModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onReady={() => {
          setOnboardingDone(true);
          // Re-poll the emulator status so the header badge flips green
          // immediately after the wizard confirms everything is set.
          void getEmulators().then(setEmulator);
        }}
        onResetOnboarding={() => setOnboardingDone(false)}
        onAfterWipe={() => void refreshInventory("Wiped captured data")}
        debugStatLocks={debugStatLocks}
        onToggleDebugStatLocks={() => setDebugStatLocks((v) => !v)}
        debugSolver={debugSolver}
        onToggleDebugSolver={() => setDebugSolver((v) => !v)}
        solver={{
          workerCount, setWorkerCount,
          topN: solverTopN, setTopN: setSolverTopN,
          topK: solverTopK, setTopK: setSolverTopK,
          heatmap, setHeatmap,
        }}
      />

      {(status || log.length > 0) && (
        <div className="border-b border-white/6 bg-black/30 px-6 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-400">{status}</span>
            {log.length > 0 && (
              <button
                onClick={() => setLogOpen((v) => !v)}
                className="font-mono text-[10px] text-cyan-300 hover:text-cyan-200"
              >
                {logOpen ? "Hide" : "Show"} log ({log.length})
              </button>
            )}
          </div>
          {logOpen && log.length > 0 && (
            <div className="mt-2">
              <LogView lines={log} />
            </div>
          )}
        </div>
      )}

      <main className="min-h-[calc(100vh-60px)]">
        <Suspense fallback={<div className="px-6 py-10 text-center text-[12px] text-zinc-400">Loading {tab.toLowerCase()}…</div>}>
          {/* Home / Inventory / Builds are cheap to rebuild, so they stay
              conditionally rendered (and remount fresh — which also resets
              their per-screen error boundary). */}
          {tab === "Home" && (
            <ScreenErrorBoundary>
              <HomeScreen
                inventory={inv}
                game={game}
                capStatus={capStatus}
                emulator={emulator}
                appVersion={APP_VERSION}
                busy={running !== "none"}
                onCapture={() => runCapture("capture")}
                onSyncData={() => void syncGameData()}
                onOpenBuilder={() => setTab("Builder")}
                onDrill={(d) => { setInvDrill(d); setTab("Inventory"); }}
              />
            </ScreenErrorBoundary>
          )}
          {tab === "Inventory" && <ScreenErrorBoundary><InventoryScreen inventory={inv} game={game} drill={invDrill} onDrillConsumed={() => setInvDrill(null)} excludedPieces={excludedPieces} onToggleExclude={toggleExclude} /></ScreenErrorBoundary>}
          {tab === "Worklist" && (
            <ScreenErrorBoundary>
              <WorklistScreen
                inventory={inv}
                game={game}
                worklist={worklist}
                onChange={commitWorklist}
                onAfterApply={() => void refreshInventory("Applied worklist change")}
              />
            </ScreenErrorBoundary>
          )}
          {tab === "Builds" && <ScreenErrorBoundary><BuildsScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} heroPriority={heroPriority} onHeroPriorityChange={setHeroPriority} debug={debugStatLocks} onOptimize={(uid) => { setBuilderHero(uid); setTab("Builder"); }} /></ScreenErrorBoundary>}
          {/* Builder stays MOUNTED once first opened (hidden via display:none
              when inactive), so its solver results survive tab switches and a
              solve can finish in the background. The `h-full` wrapper keeps the
              definite-height chain BuilderScreen's internal scroll relies on. */}
          {builderMounted.current && (
            <div className="h-full" style={{ display: tab === "Builder" ? undefined : "none" }}>
              <ScreenErrorBoundary resetKey={tab}>
                <BuilderScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} heroPriority={heroPriority} excludedPieceUids={excludedPieces} initialHeroUid={builderHero} onInitialHeroConsumed={() => setBuilderHero(null)} onAfterEquip={() => void refreshInventory("Equipped build")} onAddToWorklist={(entry) => setWorklist((prev) => { const next = [entry, ...prev]; persistWorklist(next); return next; })} workerCount={workerCount} topN={solverTopN} topK={solverTopK} heatmap={heatmap} />
              </ScreenErrorBoundary>
            </div>
          )}
        </Suspense>
      </main>

      {!inv && (
        <div className="px-6 py-2 text-center text-[11px] text-zinc-400">
          Manual fallback:{" "}
          <input
            type="file"
            accept="application/json"
            multiple
            onChange={(e) => onFiles(e.target.files)}
            className="text-[11px] text-zinc-400"
          />
        </div>
      )}
    </PageBackground>
  );
}
