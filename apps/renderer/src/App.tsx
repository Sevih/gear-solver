import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import type { GameData, Inventory, RawUserItem, RawUserCharacter, UserGeasLevels } from "@gear-solver/core";
import { autoImport, parseFiles } from "./data.js";
import { streamCapture, getCaptureStatus, type CaptureStatus } from "./capture.js";
import { getEmulators, type EmulatorStatus } from "./emulator.js";
import { getGameVersion } from "./game-version.js";
import { GsHeader, PageBackground, type Tab } from "./design/Shell.js";
import { LogView } from "./design/LogView.js";
import { SettingsModal } from "./design/SettingsModal.js";
import { usePersistedState } from "./hooks/usePersistedState.js";

// Per-screen code splits — each screen ships its own chunk so the initial
// bundle drops to just the shell + the first screen the user opens.
// BuildsScreen pulls in compose-stats + the gear icon set; InventoryScreen
// pulls the design tokens + the GearRow/Card pair; Builder is mostly empty
// today but isolated for future growth. Suspense boundary below renders a
// minimal placeholder while the chunk arrives (one-time, then cached).
const InventoryScreen = lazy(() => import("./screens/InventoryScreen.js").then((m) => ({ default: m.InventoryScreen })));
const BuildsScreen = lazy(() => import("./screens/BuildsScreen.js").then((m) => ({ default: m.BuildsScreen })));
const BuilderScreen = lazy(() => import("./screens/BuilderScreen.js").then((m) => ({ default: m.BuilderScreen })));

/** Per-screen error boundary — a throw in a `useMemo`/render (e.g. a bad
 *  filter combo or stale persisted state) used to blank the whole app with
 *  no message. This catches it, shows the error + a Retry, and keeps the
 *  shell (header/tabs) alive. Reset by remounting on tab change (`key={tab}`)
 *  so navigating away recovers automatically. */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[screen crash]", error, info.componentStack);
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
  const [tab, setTab] = usePersistedState<Tab>("gs.tab", "Inventory");
  const [game, setGame] = useState<GameData | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [userGeas, setUserGeas] = useState<UserGeasLevels | null>(null);
  const [userCodex, setUserCodex] = useState<number | null>(null);
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
          // Total piece count is the more useful at-a-glance figure than
          // "equipped/total" (we always know it from inv.gear.length without
          // resolving char ownership). Null while no capture has loaded yet.
          Inventory: inv ? inv.gear.length : null,
          // Builds = number of distinct equipped characters. Computed on the
          // fly — sparse enough to not need memoization.
          Builds: inv ? new Set(inv.gear.filter((g) => g.equippedBy).map((g) => g.equippedBy)).size : null,
          Builder: null,
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
        {/* key={tab} remounts the boundary on tab switch so a crash on one
            screen doesn't persist after navigating away. */}
        <ScreenErrorBoundary key={tab}>
          <Suspense fallback={<div className="px-6 py-10 text-center text-[12px] text-zinc-500">Loading {tab.toLowerCase()}…</div>}>
            {tab === "Inventory" && <InventoryScreen inventory={inv} game={game} />}
            {tab === "Builds" && <BuildsScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} debug={debugStatLocks} onOptimize={(uid) => { setBuilderHero(uid); setTab("Builder"); }} />}
            {tab === "Builder" && <BuilderScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} initialHeroUid={builderHero} onInitialHeroConsumed={() => setBuilderHero(null)} workerCount={workerCount} topN={solverTopN} topK={solverTopK} heatmap={heatmap} />}
          </Suspense>
        </ScreenErrorBoundary>
      </main>

      {!inv && (
        <div className="px-6 py-2 text-center text-[11px] text-zinc-500">
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
