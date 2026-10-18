/**
 * Settings modal — left-rail tabbed panel (ported from the Claude Design
 * "Settings Redesign" brief). Five sections reachable from a vertical nav:
 *
 *  - Setup  — the Steam capture plugin checklist: game found / plugin
 *             installed / plugin live. Doubles as the first-launch wizard;
 *             self-dismisses once the checks pass.
 *  - Solver — worker-pool size, result count (topN), per-worker depth (topK,
 *             advanced), results heatmap. Edits persisted settings owned by App.
 *  - Data   — Sync game data · Reset onboarding · Wipe captured (destructive).
 *  - Backup — Export / Import builds & presets (JSON).
 *  - Debug  — developer toggles (stat-lock tooling, solver fan-out logging).
 *
 * The nav stays put; the content pane scrolls. The footer is contextual —
 * Re-check lives only in the Setup pane, Close is global.
 */
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { cx } from "./cx.js";
import { Spinner } from "./Shell.js";
import { applyBackup, buildBackup } from "../lib/storage/transfer.js";
import { resolveWorkerCount } from "../lib/solver/orchestrator.js";
import { loadDataVersion, type DataVersion } from "../data.js";
import { describeDataSync, type DataSyncResult } from "../lib/dataSync.js";
import { uninstallSteamPlugin, type SteamStatus } from "../steam.js";

/** Solver tuning settings — owned by App (persisted), edited here. */
export interface SolverSettings {
  /** null = auto (hardwareConcurrency − 1); a number pins the pool size. */
  workerCount: number | null;
  setWorkerCount: Dispatch<SetStateAction<number | null>>;
  /** Ranked builds returned to the results table. */
  topN: number;
  setTopN: Dispatch<SetStateAction<number>>;
  /** Per-worker heap depth before merge (advanced — too low loses recall). */
  topK: number;
  setTopK: Dispatch<SetStateAction<number>>;
  /** Results-table column heatmap on/off. */
  heatmap: boolean;
  setHeatmap: Dispatch<SetStateAction<boolean>>;
}

type SettingsTab = "setup" | "solver" | "data" | "backup" | "debug";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired the first time the wizard observes a ready=true result so App.tsx
   *  can flip the onboarding-done flag and skip future auto-pop-ups. */
  onReady?: () => void;
  /** Reset the onboarding flag (so the modal re-pops on next launch). The
   *  parent owns the persisted state, hence the indirection. */
  onResetOnboarding: () => void;
  /** Refresh the inventory after a destructive action (wipe captured). */
  onAfterWipe?: () => void;
  /** "Sync game data" — App's single sync path (syncs + re-imports, no reload). */
  onSyncData: () => Promise<DataSyncResult>;
  /** Current state of the developer-only stat-lock toggle (Builds tab). */
  debugStatLocks: boolean;
  /** Flip the stat-lock debug toggle on/off. */
  onToggleDebugStatLocks: () => void;
  /** Current state of the solver fan-out logging toggle (`gs.debug.solver`). */
  debugSolver: boolean;
  /** Flip the solver logging toggle on/off. */
  onToggleDebugSolver: () => void;
  /** Solver tuning settings (Solver tab). */
  solver: SolverSettings;
  /** Steam capture plugin — last status poll, a re-probe, and the two actions. */
  steam: SteamStatus | null;
  onRefreshSteam: () => Promise<SteamStatus | null>;
  onSteamInstall: () => void;
  onSteamLaunch: () => void;
  /** An install / capture is streaming — disable the action buttons. */
  steamBusy: boolean;
}

/** Per-tab footer note (left side of the contextual footer). */
const FOOTER_NOTE: Record<SettingsTab, string> = {
  setup: "Setup checks re-run on each open.",
  solver: "Changes are saved and apply on the next solve.",
  data: "Snapshots are stored locally.",
  backup: "JSON files include builds and presets only.",
  debug: "Developer toggles — off for normal use.",
};

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: "setup",  label: "Setup",  icon: <IconCheckCircle /> },
  { id: "solver", label: "Solver", icon: <IconSliders /> },
  { id: "data",   label: "Data",   icon: <IconDatabase /> },
  { id: "backup", label: "Backup", icon: <IconBackup /> },
  { id: "debug",  label: "Debug",  icon: <IconCode /> },
];

export function SettingsModal({
  open, onClose, onReady, onResetOnboarding, onAfterWipe, onSyncData,
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver,
  solver, steam, onRefreshSteam, onSteamInstall, onSteamLaunch, steamBusy,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("setup");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /** Re-run the checks: a plugin status poll (ready = plugin in place). */
  async function probe() {
    setLoading(true);
    try {
      const st = await onRefreshSteam();
      if (st?.ready) onReady?.();
    } catch {
      // Backend not reachable; keep the prior status so the user can still see it.
    } finally {
      setLoading(false);
    }
  }
  const setupReady = Boolean(steam?.ready);

  // The header's only entry point is labeled "Setup", and the modal doubles as
  // the onboarding wizard — so every open lands on the Setup tab (the wizard),
  // not whatever tab was last left. The other panes stay one rail-click away.
  useEffect(() => { if (open) setTab("setup"); }, [open]);

  // Re-probe whenever the modal opens AND the Setup tab is showing (no point
  // hitting the backend when the user is on Solver/Data/etc.).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && tab === "setup") void probe(); }, [open, tab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-150 max-h-[88vh] w-full max-w-220 flex-col overflow-hidden rounded-xl border border-white/9 bg-zinc-950 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 bg-zinc-950/80 px-4.5 py-3.5">
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold tracking-[-0.01em] text-zinc-100">Settings</div>
            <div className="text-[11px] text-zinc-400">Connection, solver, data &amp; developer tools</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-zinc-900 text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
            aria-label="Close"
          >✕</button>
        </header>

        {/* MAIN: nav rail + content column */}
        <div className="flex min-h-0 flex-1">
          {/* NAV RAIL */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-white/7 bg-zinc-950/80 px-2.5 py-3">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active}
                  className={cx(
                    "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors",
                    active
                      ? "bg-cyan-400/8 font-semibold text-cyan-300 shadow-[inset_3px_0_0_#22d3ee]"
                      : "font-medium text-zinc-400 hover:bg-white/4 hover:text-zinc-200",
                  )}
                >
                  <span className="shrink-0">{t.icon}</span>
                  <span className="flex-1">{t.label}</span>
                  {/* Attention dot on Setup while a check is failing. */}
                  {t.id === "setup" && steam != null && !setupReady && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* CONTENT COLUMN */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4.5 py-4">
              {tab === "setup"  && <SteamSetupPane steam={steam} loading={loading} busy={steamBusy} onInstall={onSteamInstall} onLaunch={onSteamLaunch} onProbe={() => void probe()} />}
              {tab === "solver" && <SolverPane solver={solver} showAdvanced={showAdvanced} onToggleAdvanced={() => setShowAdvanced((v) => !v)} />}
              {tab === "data"   && <DataPane syncing={syncing} setSyncing={setSyncing} onSyncData={onSyncData} onResetOnboarding={() => { onResetOnboarding(); onClose(); }} onAfterWipe={onAfterWipe} />}
              {tab === "backup" && <BackupPane importInputRef={importInputRef} />}
              {tab === "debug"  && <DebugPane debugStatLocks={debugStatLocks} onToggleDebugStatLocks={onToggleDebugStatLocks} debugSolver={debugSolver} onToggleDebugSolver={onToggleDebugSolver} />}
            </div>

            {/* CONTEXTUAL FOOTER */}
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/8 bg-zinc-950/80 px-4 py-2.5">
              <span className="text-[11px] text-zinc-400">{FOOTER_NOTE[tab]}</span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={onClose}
                  className="rounded-md border border-white/10 bg-zinc-900 px-3.5 py-1.5 text-[12px] font-semibold text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
                >Close</button>
                {tab === "setup" && (
                  <button
                    onClick={() => void probe()}
                    disabled={loading}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[12px] font-bold tracking-[0.02em]",
                      loading
                        ? "cursor-wait bg-zinc-800 text-zinc-400"
                        : "bg-linear-to-b from-cyan-400 to-cyan-500 text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_6px_16px_-8px_rgba(34,211,238,0.6)]",
                    )}
                  >
                    {loading && <Spinner className="h-3 w-3 text-cyan-300" />}
                    {loading ? "Checking…" : "Re-check"}
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Panes
 * ───────────────────────────────────────────────────────────────────────── */

/** Header note of the Steam pane: the installed build, then the client
 *  outerpedia last read ("build 123 · reference v1.4.18 (build 25744766)"). */
function steamBuildNote(s: SteamStatus | null): string | null {
  if (!s) return null;
  const reference = `reference v${s.reference.version} (build ${s.reference.buildId})`;
  return s.buildId ? `build ${s.buildId} · ${reference}` : reference;
}

/** Capture setup wizard: three checks, the first two gate "ready" (the plugin
 *  is in place); the third is live status (game running with the plugin
 *  loaded) shown for feedback, since capture itself needs no click. */
function SteamSetupPane({ steam, loading, busy, onInstall, onLaunch, onProbe }: {
  steam: SteamStatus | null; loading: boolean; busy: boolean;
  onInstall: () => void; onLaunch: () => void; onProbe: () => void;
}) {
  const s = steam;
  const installedOk = Boolean(s?.installed);
  const pluginOk = Boolean(s?.ready);
  const liveOk = Boolean(s?.live);
  const pluginDetail = !s ? "" : !s.bepinex.present ? "BepInEx runtime missing"
    : !s.plugin.present ? "plugin DLL missing"
    : !s.plugin.upToDate ? (s.bundleAvailable ? "installed plugin differs from the bundled one" : "bundled plugin not built (dev: npm run capture-steam:build)")
    : !s.plugin.outDirOk ? `plugin writes to ${s.plugin.outDir ?? "its default folder"}, not ours`
    : `plugin ok${s.bepinex.version ? ` · BepInEx ${s.bepinex.version}` : ""}`;
  const liveDetail = !s ? "" : s.live
    ? `plugin ${s.heartbeat?.version ?? ""} live · ${s.heartbeat?.captures ?? 0} captures${s.heartbeat?.lastPath ? ` · last ${s.heartbeat.lastPath}` : ""}`
    : s.gameRunning ? "game running, but no plugin heartbeat — restart the game after installing"
    : "game not running";
  const steps = [
    { id: "game", title: "OUTERPLANE installed via Steam", ok: installedOk, detail: s?.gameDir ?? (s ? "not found in any Steam library" : ""),
      fix: "Install OUTERPLANE from Steam (it's free). We find it through your Steam library folders — no path to type. Without it, you can still import your snapshot files by hand (Manual fallback, at the bottom of the window)." },
    { id: "plugin", title: "Capture plugin installed", ok: pluginOk, detail: pluginDetail,
      fix: "Click Install plugin: it drops the BepInEx loader (downloaded once from the official release, checksum-verified) and our GearSolverCapture.dll into the game folder, then points the plugin at this app's capture folder. The game must be closed while installing." },
    { id: "live", title: "Game running with the plugin loaded", ok: liveOk, detail: liveDetail,
      fix: "Launch OUTERPLANE from Steam. The plugin loads with the game and writes your roster + gear the moment the lobby loads — the app re-imports on its own." },
  ] as const;
  const ready = installedOk && pluginOk;
  const firstOpen = steps.findIndex((st) => !st.ok);
  const currentIndex = firstOpen < 0 ? steps.length : firstOpen;
  const doneCount = steps.filter((st) => st.ok).length;
  const canInstall = installedOk && !busy && !s?.gameRunning && Boolean(s?.bundleAvailable);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Capture setup · Steam" note={steamBuildNote(s)} />
      {s?.buildDiffers && (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200">
          This game build differs from the client outerpedia last read (v{s.reference.version}, build {s.reference.buildId}).
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {steps.map((st, i) => (
            <div key={st.id} className={cx("h-1.5 flex-1 rounded-full", st.ok ? "bg-emerald-400" : i === currentIndex ? "bg-cyan-400" : "bg-white/10")} />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-zinc-400">{doneCount}/{steps.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {steps.map((st, i) => {
          if (st.ok) return <StepDoneRow key={st.id} title={`${st.title}${st.detail ? ` — ${st.detail}` : ""}`} />;
          if (i !== currentIndex) return <StepUpcomingRow key={st.id} n={i + 1} title={st.title} />;
          return (
            <div key={st.id} className="flex flex-col gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/6 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-400 text-[11px] font-bold text-cyan-950">{i + 1}</span>
                <span className="text-[13.5px] font-semibold text-cyan-200">{st.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-cyan-300/70">step {i + 1} of {steps.length}</span>
              </div>
              <p className="text-[12px] leading-relaxed text-zinc-300">{st.fix}</p>
              {st.detail && <span className="font-mono text-[10.5px] text-zinc-500">{st.detail}</span>}
              <div className="flex items-center gap-2 pt-0.5">
                {st.id === "plugin" && (
                  <button
                    type="button" onClick={onInstall} disabled={!canInstall}
                    title={s?.gameRunning ? "Close OUTERPLANE first — the plugin file is locked while the game runs" : !s?.bundleAvailable ? "Plugin DLL not built on this side" : "Install / update the capture plugin"}
                    className={cx(
                      "inline-flex h-7 items-center rounded-md border px-3 text-[11.5px] font-semibold transition-colors",
                      canInstall ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25" : "cursor-not-allowed border-white/6 bg-white/2 text-zinc-500",
                    )}
                  >{busy ? "Installing…" : s?.plugin.present ? "Update plugin" : "Install plugin"}</button>
                )}
                {st.id === "live" && !s?.gameRunning && (
                  <button
                    type="button" onClick={onLaunch} disabled={busy}
                    className="inline-flex h-7 items-center rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 text-[11.5px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  >Launch game</button>
                )}
                <span className="text-[11px] text-zinc-500">
                  {loading ? "Re-checking…" : <>then click <b className="text-cyan-300">Re-check</b> below.</>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {ready && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-400/35 bg-emerald-500/8 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400 text-[12px] font-bold text-emerald-950">✓</span>
            <span className="text-[13.5px] font-semibold text-emerald-200">{liveOk ? "Capturing · plugin live" : "Ready · Steam"}</span>
          </div>
          <ol className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-zinc-300">
            <li><b className="text-zinc-200">1.</b> Launch <b className="text-zinc-200">OUTERPLANE</b> from Steam and play to the lobby — roster + gear import automatically (no Arm, no Reload).</li>
            <li><b className="text-zinc-200">2.</b> <span className="text-zinc-400">Optional:</span> open the in-game <b className="text-zinc-200">Hero Archive</b> + <b className="text-zinc-200">Gift</b> screens once — codex + geas import as soon as they load.</li>
            <li><b className="text-zinc-200">3.</b> After a game update, come back here: if the plugin needs a refresh the header says so.</li>
          </ol>
        </div>
      )}

      <SteamRemoveSection steam={s} busy={busy} onDone={onProbe} />
    </div>
  );
}

/** Collapsed "Remove plugin" escape hatch (also strips BepInEx when nothing
 *  else uses it). Confirms first; refused by the backend while the game runs. */
function SteamRemoveSection({ steam, busy, onDone }: { steam: SteamStatus | null; busy: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  if (!steam?.plugin.present) return null;
  const remove = async () => {
    if (!window.confirm("Remove the capture plugin from the Steam game folder? (BepInEx is removed too unless other plugins use it.)")) return;
    setWorking(true);
    try {
      const r = await uninstallSteamPlugin(true);
      if (!r.ok) window.alert(`Remove failed: ${r.error ?? "unknown error"}`);
      onDone();
    } finally { setWorking(false); }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-white/6 pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-fit items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200">
        <span className={cx("inline-block text-[9px] transition-transform", open && "rotate-90")}>▸</span>
        <span className="tracking-[0.04em]">Remove plugin</span>
      </button>
      {open && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-zinc-400">
            Deletes <span className="font-mono text-zinc-300">BepInEx/plugins/GearSolverCapture</span> and its config from the game folder. Your captured snapshots stay in the app. Close the game first.
          </p>
          <button
            type="button" onClick={() => void remove()} disabled={busy || working || steam.gameRunning}
            className={cx(
              "inline-flex h-7 shrink-0 items-center rounded-md border px-3 text-[11.5px] font-semibold",
              busy || working || steam.gameRunning ? "cursor-not-allowed border-white/6 bg-white/2 text-zinc-500" : "border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
            )}
          >{working ? "Removing…" : "Remove"}</button>
        </div>
      )}
    </div>
  );
}

function StepDoneRow({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 py-0.5">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/90 text-[10px] font-bold text-emerald-950">✓</span>
      <span className="text-[12.5px] text-zinc-300">{title}</span>
    </div>
  );
}

function StepUpcomingRow({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 py-0.5 opacity-45">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-zinc-600 text-[9px] font-mono text-zinc-400">{n}</span>
      <span className="text-[12.5px] text-zinc-400">{title}</span>
    </div>
  );
}

function SolverPane({
  solver, showAdvanced, onToggleAdvanced,
}: {
  solver: SolverSettings;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}) {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const autoEffective = resolveWorkerCount(null);
  const isAuto = solver.workerCount == null;
  // Local buffer so toggling Auto→Manual→Auto preserves the last manual count
  // within the modal session. Seeded from the persisted value or the auto count.
  const [manualBuf, setManualBuf] = useState(() => solver.workerCount ?? autoEffective);
  const manualVal = solver.workerCount ?? manualBuf;
  const setManualWorkers = (v: number) => {
    const clamped = Math.max(1, Math.min(cores, v));
    setManualBuf(clamped);
    solver.setWorkerCount(clamped);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Solver tuning" note="applies next solve" />

      {/* Worker threads */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Worker threads</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            More workers = faster solve, hotter and louder CPU. Takes effect on the next solve.
          </span>
          <span className="mt-0.5 font-mono text-[11px] text-cyan-300">
            {isAuto ? `Auto · ${autoEffective} of ${cores} cores` : `Manual · ${manualVal} of ${cores} cores`}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex overflow-hidden rounded-md border border-white/12">
            <SegButton label="Auto" on={isAuto} onClick={() => solver.setWorkerCount(null)} />
            <SegButton label="Manual" on={!isAuto} onClick={() => setManualWorkers(manualVal)} divided />
          </div>
          <Stepper
            value={manualVal}
            dim={isAuto}
            onDec={() => setManualWorkers(manualVal - 1)}
            onInc={() => setManualWorkers(manualVal + 1)}
          />
        </div>
      </div>

      <Divider />

      {/* Result count (topN) */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Result count</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            How many ranked builds the results table keeps. Range 10–5000.
          </span>
        </div>
        <Stepper
          value={solver.topN}
          wide
          onDec={() => solver.setTopN((v) => Math.max(10, v - 100))}
          onInc={() => solver.setTopN((v) => Math.min(5000, v + 100))}
        />
      </div>

      <Divider />

      {/* Heatmap */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Results heatmap</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">Emerald→rose column shading on the results table.</span>
        </div>
        <Switch checked={solver.heatmap} onToggle={() => solver.setHeatmap((v) => !v)} />
      </div>

      {/* Advanced disclosure → per-worker depth (topK) */}
      <div className="flex flex-col gap-3 border-t border-white/6 pt-3">
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="flex w-fit items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
        >
          <span className={cx("inline-block text-[9px] transition-transform", showAdvanced && "rotate-90")}>▸</span>
          <span className="tracking-[0.04em]">{showAdvanced ? "Hide advanced" : "Show advanced"}</span>
        </button>
        {showAdvanced && (
          <div className="flex items-start justify-between gap-4.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <div className="flex max-w-82.5 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-white">Per-worker depth</span>
                <span className="rounded bg-amber-500/16 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-amber-300">advanced</span>
              </div>
              <span className="text-[11.5px] leading-snug text-zinc-400">
                Heap each worker keeps before the merge. <b className="font-semibold text-amber-300">Too low silently drops good builds</b> — leave at default unless you know why. Range 100–5000.
              </span>
            </div>
            <Stepper
              value={solver.topK}
              wide
              onDec={() => solver.setTopK((v) => Math.max(100, v - 100))}
              onInc={() => solver.setTopK((v) => Math.min(5000, v + 100))}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            solver.setWorkerCount(null);
            solver.setTopN(1000);
            solver.setTopK(1000);
            solver.setHeatmap(true);
            setManualBuf(autoEffective);
          }}
          className="text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
        >Reset solver settings to defaults</button>
      </div>
    </div>
  );
}

function DataPane({
  syncing, setSyncing, onSyncData, onResetOnboarding, onAfterWipe,
}: {
  syncing: boolean;
  setSyncing: (b: boolean) => void;
  onSyncData: () => Promise<DataSyncResult>;
  onResetOnboarding: () => void;
  onAfterWipe?: () => void;
}) {
  // Read-only stamp of the loaded derived-data snapshot (data/derived/version.json,
  // written by build.mjs). Fetched once on open; absent on data built before the
  // stamp existed → renders an em-dash.
  const [version, setVersion] = useState<DataVersion | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDataVersion().then((v) => { if (alive) setVersion(v); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Data" />
      <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px]">
        <span className="text-white/50">Game data version</span>{" "}
        {version
          ? <>
              {version.resVersion && <span className="text-white/40">game {version.resVersion} · </span>}
              <span className="font-mono text-white/85">{version.hash}</span>
              <span className="text-white/40"> · built {new Date(version.builtAt).toLocaleString()}</span>
            </>
          : <span className="text-white/40">—</span>}
      </div>
      <DataAction
        label="Sync game data"
        description="Refresh the raw tables from the local outerpedia checkout and rebuild the derived data (run after a game patch). Auto-runs at launch when the source is newer."
        actionLabel={syncing ? "Syncing…" : "Sync"}
        disabled={syncing}
        onClick={() => void runDataSync(setSyncing, onSyncData)}
      />
      <DataAction
        label="Reset onboarding prompt"
        description="Show this Settings modal automatically on next launch as the setup wizard."
        onClick={onResetOnboarding}
      />
      <DataAction
        label="Wipe captured data"
        description="Empty the whole capture folder: imported snapshots, the seen-paths log and unknown endpoints (_unknown/). Cannot be undone · requires confirmation."
        tone="danger"
        onClick={() => void wipeCaptured(onAfterWipe)}
      />
    </div>
  );
}

function BackupPane({ importInputRef }: { importInputRef: { current: HTMLInputElement | null } }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Backup" />
      <DataAction
        label="Export builds & presets"
        description="Download your saved builds and filter presets as a JSON file (backup / move to another device). Captured gear is not included — re-capture it there."
        actionLabel="Export"
        onClick={exportBackupFile}
      />
      <DataAction
        label="Import builds & presets"
        description="Merge a previously exported JSON file into your current builds & presets (entries already present are kept)."
        actionLabel="Import"
        onClick={() => importInputRef.current?.click()}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importBackupFile(e.target.files?.[0] ?? null, () => { if (importInputRef.current) importInputRef.current.value = ""; })}
      />
    </div>
  );
}

function DebugPane({
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver,
}: {
  debugStatLocks: boolean;
  onToggleDebugStatLocks: () => void;
  debugSolver: boolean;
  onToggleDebugSolver: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Debug" />
      <ToggleAction
        label="Stat lock & drift tooling (Builds)"
        description="Reveal the per-stat lock buttons, drift indicators and copy-dump button on Builds cards. Used for stat-formula regression work — off by default."
        checked={debugStatLocks}
        onToggle={onToggleDebugStatLocks}
      />
      <ToggleAction
        label="Solver fan-out logging"
        description="Log the solver's fan-out (pool sizes, chunk count, workers) and per-solve merge/duration to the devtools console. Useful when profiling a slow solve — off by default."
        checked={debugSolver}
        onToggle={onToggleDebugSolver}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared primitives
 * ───────────────────────────────────────────────────────────────────────── */

function SectionStrip({ title, note }: { title: string; note?: string | null }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/6 bg-white/2 px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/70">{title}</span>
      {note && <span className="font-mono text-[10px] text-zinc-400">{note}</span>}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/6" />;
}

function SegButton({ label, on, onClick, divided }: { label: string; on: boolean; onClick: () => void; divided?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "px-3.5 py-1.5 text-[11px] font-semibold transition-colors",
        divided && "border-l border-white/12",
        on ? "bg-cyan-400/14 text-cyan-300" : "bg-transparent text-zinc-400 hover:text-zinc-300",
      )}
    >{label}</button>
  );
}

function Stepper({ value, onDec, onInc, dim, wide }: { value: number; onDec: () => void; onInc: () => void; dim?: boolean; wide?: boolean }) {
  return (
    <div className={cx("flex shrink-0 items-center overflow-hidden rounded-md border border-white/12 bg-zinc-900", dim && "opacity-40")}>
      <button type="button" onClick={onDec} className="grid h-7.5 w-7.5 place-items-center text-[15px] text-zinc-400 hover:bg-white/6 hover:text-white">−</button>
      <span className={cx("text-center font-mono text-[13px] font-semibold tabular-nums text-white", wide ? "min-w-15.5" : "min-w-12.5")}>
        {value.toLocaleString()}
      </span>
      <button type="button" onClick={onInc} className="grid h-7.5 w-7.5 place-items-center text-[15px] text-zinc-400 hover:bg-white/6 hover:text-white">+</button>
    </div>
  );
}

function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-cyan-400/55 bg-cyan-500/30" : "border-white/12 bg-white/6",
      )}
    >
      <span className={cx("inline-block h-3.5 w-3.5 transform rounded-full transition-transform", checked ? "translate-x-4.5 bg-cyan-300" : "translate-x-0.5 bg-zinc-400")} />
    </button>
  );
}

interface DataActionProps {
  label: string;
  description: string;
  onClick: () => void;
  tone?: "default" | "danger";
  /** Button caption — defaults to "Wipe" (danger) / "Reset" (default). */
  actionLabel?: string;
  disabled?: boolean;
}

function DataAction({ label, description, onClick, tone = "default", actionLabel, disabled }: DataActionProps) {
  const danger = tone === "danger";
  return (
    <div className={cx(
      "flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5",
      danger ? "border-rose-400/32 bg-rose-500/6" : "border-white/7 bg-zinc-900/40",
    )}>
      <div className="min-w-0 max-w-95">
        <div className="flex items-center gap-2">
          <span className={cx("text-[13px] font-medium", danger ? "font-semibold text-rose-300" : "text-zinc-100")}>{label}</span>
          {danger && <span className="rounded bg-rose-500/16 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-rose-300">destructive</span>}
        </div>
        <div className="text-[11.5px] leading-snug text-zinc-400">{description}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={cx(
          "inline-flex h-8 min-w-19 shrink-0 items-center justify-center rounded-md border px-3.5 text-[12px] font-semibold transition-colors active:scale-95",
          disabled && "cursor-wait opacity-60",
          danger
            ? "border-rose-400/55 bg-rose-500/14 font-bold text-rose-300 hover:bg-rose-500/24"
            : "border-white/12 bg-zinc-800 text-zinc-200 hover:bg-white/6",
        )}
      >
        {actionLabel ?? (danger ? "Wipe" : "Reset")}
      </button>
    </div>
  );
}

interface ToggleActionProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleAction({ label, description, checked, onToggle }: ToggleActionProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/7 bg-zinc-900/40 px-3 py-2.5">
      <div className="min-w-0 max-w-95">
        <div className="text-[13px] font-medium text-white">{label}</div>
        <div className="text-[11.5px] leading-snug text-zinc-400">{description}</div>
      </div>
      <Switch checked={checked} onToggle={onToggle} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Nav icons (inline SVG, currentColor)
 * ───────────────────────────────────────────────────────────────────────── */

function IconCheckCircle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" />
    </svg>
  );
}
function IconSliders() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2.6" fill="currentColor" stroke="none" />
      <line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconDatabase() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.6 3.1 3 7 3s7-1.4 7-3V6" /><path d="M5 12v6c0 1.6 3.1 3 7 3s7-1.4 7-3v-6" />
    </svg>
  );
}
function IconBackup() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10l5-5 5 5" /><path d="M7 14l5 5 5-5" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 8l-4 4 4 4" /><path d="M15 8l4 4-4 4" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Side-effect helpers (unchanged behavior)
 * ───────────────────────────────────────────────────────────────────────── */

/** Snapshot saved builds + filter presets and trigger a browser download.
 *  Filename carries the date so multiple backups don't collide. */
function exportBackupFile(): void {
  try {
    const now = Date.now();
    const bundle = buildBackup(now);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
    const a = document.createElement("a");
    a.href = url;
    a.download = `gear-solver-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read a user-picked JSON file, merge it into localStorage, and report the
 *  count. Always clears the input (via `done`) so re-picking the same file
 *  fires `onChange` again. */
async function importBackupFile(file: File | null, done: () => void): Promise<void> {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    const { builds, presets } = applyBackup(parsed);
    if (builds === 0 && presets === 0) {
      window.alert("Nothing new to import — every build and preset in this file is already present.");
    } else {
      window.alert(`Imported ${builds} build${builds === 1 ? "" : "s"} and ${presets} preset${presets === 1 ? "" : "s"}.`);
    }
  } catch (err) {
    window.alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    done();
  }
}

/** Settings → Data → "Sync": run App's sync path (it re-imports on a real
 *  sync — no window reload, so a running solve survives) and report the
 *  outcome. */
async function runDataSync(setSyncing: (b: boolean) => void, onSyncData: () => Promise<DataSyncResult>): Promise<void> {
  setSyncing(true);
  try {
    window.alert(describeDataSync(await onSyncData()));
  } finally {
    setSyncing(false);
  }
}

/** POST /api/capture/wipe (empties the whole capture folder) + refresh
 *  inventory. Confirms via native dialog first (destructive). */
async function wipeCaptured(onAfterWipe?: () => void): Promise<void> {
  if (!window.confirm("Empty the whole capture folder (gear / character snapshots, seen-paths log, _unknown/)? This cannot be undone (next capture will refill).")) return;
  try {
    const r = await fetch("/api/capture/wipe", { method: "POST" });
    if (!r.ok) {
      // The server's reason when it gives one (409: the Steam plugin is live).
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      window.alert(`Wipe failed: ${j?.error ?? `HTTP ${r.status}`}`);
      return;
    }
    onAfterWipe?.();
  } catch (err) {
    window.alert(`Wipe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
