/**
 * Settings modal — left-rail tabbed panel (ported from the Claude Design
 * "Settings Redesign" brief). Six sections reachable from a vertical nav:
 *
 *  - Setup          — the Steam capture plugin checklist: game found / plugin
 *                     installed / plugin live. Doubles as the first-launch
 *                     wizard; self-dismisses once the checks pass.
 *  - Data & updates — the update center (app version, check, install) · game
 *                     data version · Sync game data · Wipe captured
 *                     (destructive).
 *  - Solver         — worker-pool size, result count (topN), per-worker depth
 *                     (topK, advanced): read at the next solve.
 *  - Display        — results heatmap, compact result cards, result rows:
 *                     applied at once.
 *  - Backup         — Export / Import backup (JSON).
 *  - Advanced       — developer toggles (stat-lock tooling, solver fan-out
 *                     logging) · Reset onboarding · the app journal (install
 *                     lines, timestamped status messages): Copy · Clear.
 *
 * Solver and Display edit persisted settings owned by App (`lib/settings.ts`);
 * the Presets screen's loss threshold is set on that screen.
 *
 * The nav stays put; the content pane scrolls. The footer is contextual —
 * Re-check lives only in the Setup pane, Close is global. Escape closes the
 * modal; it reopens on the last pane visited (`gs.settings.pane`), on Setup
 * until onboarding is done.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSetting } from "../../hooks/useSetting.js";
import type { SettingsPane } from "../../lib/settings.js";
import { cx } from "../cx.js";
import { Spinner } from "../Shell.js";
import type { DataSyncResult } from "../../lib/dataSync.js";
import type { UpdateStatus } from "../../lib/update.js";
import type { SteamStatus } from "../../steam.js";
import { SolverPane, type SolverSettings } from "./SolverPane.js";
import { DisplayPane, type DisplaySettings } from "./DisplayPane.js";
import { useMountedRef } from "./useConfirmClick.js";
import { SteamSetupPane } from "./SteamSetupPane.js";
import { DataPane } from "./DataPane.js";
import { BackupPane } from "./BackupPane.js";
import { AdvancedPane } from "./AdvancedPane.js";

type SettingsTab = SettingsPane;

interface Props {
  open: boolean;
  onClose: () => void;
  /** `gs.onboarding.done` — until then every open lands on Setup (the
   *  wizard) instead of the last pane visited. */
  onboardingDone: boolean;
  /** Pane to open on, overriding the last pane visited (the first-capture
   *  steps' Setup link, the header's update badge). */
  openOn?: SettingsPane | null;
  /** Fired the first time the wizard observes a ready=true result so App.tsx
   *  can flip the onboarding-done flag and skip future auto-pop-ups. */
  onReady?: () => void;
  /** Reset the onboarding flag (so the modal re-pops on next launch). The
   *  parent owns the persisted state, hence the indirection. */
  onResetOnboarding: () => void;
  /** Refresh the inventory after a destructive action (wipe captured). */
  onAfterWipe?: () => void;
  /** "Sync game data" — App's single sync path (syncs + re-imports, no reload;
   *  it reports the outcome itself — status, journal, toast). */
  onSyncData: () => Promise<DataSyncResult>;
  /** Report an action's outcome (status + journal; no blocking dialogs). */
  onStatus: (message: string) => void;
  /** The latest status message — the footer shows it in place of the tab
   *  note (the full history is in Advanced's journal). */
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
  /** Display settings (Display tab). */
  display: DisplaySettings;
  /** App update status (Data & updates tab), its check and its install. */
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  /** Steam capture plugin — last status poll, a re-probe, and the two actions. */
  steam: SteamStatus | null;
  onRefreshSteam: () => Promise<SteamStatus | null>;
  onSteamInstall: () => void;
  onSteamLaunch: () => void;
  /** An install / capture is streaming — disable the action buttons. */
  steamBusy: boolean;
  /** The app journal (Advanced tab) and its reset. */
  log: string[];
  onClearLog: () => void;
}

/** Per-tab footer note (left side of the contextual footer). */
const FOOTER_NOTE: Record<SettingsTab, string> = {
  setup: "Setup checks re-run on each open.",
  data: "App updates come from GitHub releases; game tables from outerpedia.",
  solver: "Changes are saved and apply on the next solve.",
  display: "Applied at once.",
  backup: "One JSON file holds everything you set up here — builds, filter sets, ranks, worklist, notes, settings — never the captured gear.",
  advanced: "Developer toggles and the app journal (kept for this session only).",
};

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: "setup",    label: "Setup",          icon: <IconCheckCircle /> },
  { id: "data",     label: "Data & updates", icon: <IconDatabase /> },
  { id: "solver",   label: "Solver",         icon: <IconSliders /> },
  { id: "display",  label: "Display",        icon: <IconMonitor /> },
  { id: "backup",   label: "Backup",         icon: <IconBackup /> },
  { id: "advanced", label: "Advanced",       icon: <IconCode /> },
];

export function SettingsModal({
  open, onClose, onboardingDone, openOn = null, onReady, onResetOnboarding, onAfterWipe, onSyncData, onStatus, status,
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver,
  solver, display, update, onCheckUpdate, onInstallUpdate, steam, onRefreshSteam, onSteamInstall, onSteamLaunch, steamBusy, log, onClearLog,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useSetting("settingsPane");
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

  /** Settings › Data & updates › "Sync": App's sync path re-imports on a real sync (no
   *  window reload, so a running solve survives) and reports the outcome
   *  itself. */
  async function runDataSync() {
    setSyncing(true);
    try {
      await onSyncData();
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }
  const setupReady = Boolean(steam?.ready);

  // The modal doubles as the onboarding wizard: until onboarding is done every
  // open (the first-launch auto-open included, hence `seenOpen` starting
  // closed) lands on Setup. After that it reopens on the last pane visited,
  // unless the opener asks for a pane (`openOn`).
  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open && !onboardingDone) setTab("setup");
    else if (open && openOn) setTab(openOn);
  }

  // Escape closes the modal. A nested dialog that handles its own Escape
  // stops it (`stopPropagation` / `preventDefault`) so only that dialog closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Re-probe whenever the modal opens AND the Setup tab is showing (no point
  // hitting the backend when the user is on Solver, Data & updates, etc.).
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
            <div className="text-[11px] text-zinc-400">Setup, data &amp; updates, solver, display, backup &amp; advanced</div>
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
              {tab === "data"   && <DataPane update={update} onCheckUpdate={onCheckUpdate} onInstallUpdate={onInstallUpdate} syncing={syncing} onSync={() => void runDataSync()} onAfterWipe={onAfterWipe} onStatus={onStatus} />}
              {tab === "solver" && <SolverPane solver={solver} showAdvanced={showAdvanced} onToggleAdvanced={() => setShowAdvanced((v) => !v)} />}
              {tab === "display" && <DisplayPane display={display} />}
              {tab === "backup" && <BackupPane importInputRef={importInputRef} onStatus={onStatus} />}
              {tab === "advanced" && <AdvancedPane debugStatLocks={debugStatLocks} onToggleDebugStatLocks={onToggleDebugStatLocks} debugSolver={debugSolver} onToggleDebugSolver={onToggleDebugSolver} onResetOnboarding={() => { onResetOnboarding(); onClose(); }} log={log} onClearLog={onClearLog} />}
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
function IconMonitor() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" />
    </svg>
  );
}
