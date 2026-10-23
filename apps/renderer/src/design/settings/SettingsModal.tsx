/**
 * Settings modal — left-rail tabbed panel (ported from the Claude Design
 * "Settings Redesign" brief). Five sections reachable from a vertical nav:
 *
 *  - Setup  — the Steam capture plugin checklist: game found / plugin
 *             installed / plugin live. Doubles as the first-launch wizard;
 *             self-dismisses once the checks pass.
 *  - Solver — worker-pool size, result count (topN), per-worker depth (topK,
 *             advanced), results heatmap, compact result cards. Edits
 *             persisted settings owned by App.
 *  - Data   — Sync game data · Reset onboarding · Wipe captured (destructive).
 *  - Backup — Export / Import builds & presets (JSON).
 *  - Debug  — developer toggles (stat-lock tooling, solver fan-out logging).
 *
 * The nav stays put; the content pane scrolls. The footer is contextual —
 * Re-check lives only in the Setup pane, Close is global.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx.js";
import { Spinner } from "../Shell.js";
import type { DataSyncResult } from "../../lib/dataSync.js";
import type { SteamStatus } from "../../steam.js";
import { SolverPane, type SolverSettings } from "./SolverPane.js";
import { useMountedRef } from "./useConfirmClick.js";
import { SteamSetupPane } from "./SteamSetupPane.js";
import { DataPane } from "./DataPane.js";
import { BackupPane } from "./BackupPane.js";
import { DebugPane } from "./DebugPane.js";

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
  /** "Sync game data" — App's single sync path (syncs + re-imports, no reload;
   *  it reports the outcome on the status bar itself). */
  onSyncData: () => Promise<DataSyncResult>;
  /** Report an action's outcome on the App's status bar (no blocking dialogs). */
  onStatus: (message: string) => void;
  /** The status bar's current message — the bar sits under this modal's
   *  backdrop, so the footer echoes it in place of the tab note. */
  status: string;
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
  open, onClose, onReady, onResetOnboarding, onAfterWipe, onSyncData, onStatus, status,
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver,
  solver, steam, onRefreshSteam, onSteamInstall, onSteamLaunch, steamBusy,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("setup");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useMountedRef();

  /** Re-run the checks: a plugin status poll (ready = plugin in place). */
  async function probe() {
    setLoading(true);
    try {
      const st = await onRefreshSteam();
      if (st?.ready) onReady?.();
    } catch {
      // Backend not reachable; keep the prior status so the user can still see it.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  /** Settings → Data → "Sync": App's sync path re-imports on a real sync (no
   *  window reload, so a running solve survives) and reports the outcome on
   *  the status bar. */
  async function runDataSync() {
    setSyncing(true);
    try {
      await onSyncData();
    } finally {
      if (mounted.current) setSyncing(false);
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
              {tab === "setup"  && <SteamSetupPane steam={steam} loading={loading} busy={steamBusy} onInstall={onSteamInstall} onLaunch={onSteamLaunch} onProbe={() => void probe()} onStatus={onStatus} />}
              {tab === "solver" && <SolverPane solver={solver} showAdvanced={showAdvanced} onToggleAdvanced={() => setShowAdvanced((v) => !v)} />}
              {tab === "data"   && <DataPane syncing={syncing} onSync={() => void runDataSync()} onResetOnboarding={() => { onResetOnboarding(); onClose(); }} onAfterWipe={onAfterWipe} onStatus={onStatus} />}
              {tab === "backup" && <BackupPane importInputRef={importInputRef} onStatus={onStatus} />}
              {tab === "debug"  && <DebugPane debugStatLocks={debugStatLocks} onToggleDebugStatLocks={onToggleDebugStatLocks} debugSolver={debugSolver} onToggleDebugSolver={onToggleDebugSolver} />}
            </div>

            {/* CONTEXTUAL FOOTER */}
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/8 bg-zinc-950/80 px-4 py-2.5">
              <span className="text-[11px] text-zinc-400">{status || FOOTER_NOTE[tab]}</span>
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
