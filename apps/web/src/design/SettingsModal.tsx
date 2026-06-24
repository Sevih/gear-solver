/**
 * Settings modal — accessible from the gear icon in the header, and
 * auto-opened on first launch (App-level state).
 *
 * Sections (stacked, all visible):
 *  - Setup status — sequential probe of emulator / ADB / root via the
 *    backend's `/api/preflight`. The wizard closes itself once all four
 *    checks pass (so first-launch dismisses on its own).
 *  - Data — destructive actions: wipe captured snapshots, reset the
 *    onboarding flag so the modal re-pops on next launch.
 */
import { useEffect, useState } from "react";
import { cx } from "./cx.js";
import { Spinner } from "./Shell.js";

export type CheckId = "emulator-installed" | "emulator-running" | "adb-connection" | "root-toggle";

export interface PreflightCheck {
  id: CheckId;
  ok: boolean;
  detail: string;
}

export interface PreflightResult {
  emulator: { type: string; label: string } | null;
  device: string | null;
  checks: PreflightCheck[];
  ready: boolean;
}

interface CheckCopy {
  title: string;
  fix: string;
}

/** Per-check copy lives in the renderer so the maintainer can iterate on
 *  UX strings without republishing the Electron app. */
const COPY: Record<CheckId, CheckCopy> = {
  "emulator-installed": {
    title: "Android emulator installed",
    fix: "Install LDPlayer 9 (recommended), MuMu Player 12, or NoxPlayer at its default location. The capture pipeline needs a rooted x86 Android emulator — Google Play Games is not supported (Google disables root).",
  },
  "emulator-running": {
    title: "Emulator instance running",
    fix: "Open your emulator and start an instance. The detector probes every common ADB port for LDPlayer / MuMu / Nox — if none responds, no instance is up.",
  },
  "adb-connection": {
    title: "ADB Debug = Local Connection",
    fix: "In your emulator's settings → Others (or équivalent), set ADB Debugging to \"Local Connection\" (LDPlayer) / enable ADB (MuMu/Nox). Restart the instance if you changed it.",
  },
  "root-toggle": {
    title: "Root toggle ON",
    fix: "Enable the Root toggle in your emulator's settings (LDPlayer: Settings → Others → Root permission ON, then restart instance). MuMu / Nox have the same toggle under their own settings panel. Without root we can't bind-mount the MITM cert into Android's system store.",
  },
};

const ORDER: CheckId[] = ["emulator-installed", "emulator-running", "adb-connection", "root-toggle"];

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
  /** Current state of the developer-only stat-lock toggle (Builds tab). */
  debugStatLocks: boolean;
  /** Flip the stat-lock debug toggle on/off. */
  onToggleDebugStatLocks: () => void;
}

export function SettingsModal({ open, onClose, onReady, onResetOnboarding, onAfterWipe, debugStatLocks, onToggleDebugStatLocks }: Props) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function probe() {
    setLoading(true);
    try {
      const r = await fetch("/api/preflight");
      if (r.ok) {
        const data = (await r.json()) as PreflightResult;
        setResult(data);
        if (data.ready) onReady?.();
      }
    } catch {
      // Backend not reachable; keep prior result so the user can still see history.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void probe(); }, [open]);

  if (!open) return null;

  type DisplayStatus = "ok" | "fail" | "pending";
  const checks = ORDER.map((id) => {
    const hit = result?.checks.find((c) => c.id === id);
    const status: DisplayStatus = hit ? (hit.ok ? "ok" : "fail") : "pending";
    return { id, status, detail: hit?.detail ?? "" };
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/8 bg-zinc-950 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/6 bg-linear-to-b from-white/4 to-transparent px-5 py-3.5">
          <div className="leading-tight">
            <div className="font-display text-[14px] font-semibold text-zinc-100">Settings</div>
            <div className="text-[11px] text-zinc-500">
              {result?.ready ? "Setup is complete — capture is ready to arm." : "Configure the capture pipeline."}
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-white/6 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SectionHeader title="Setup status" subtitle={result?.device ? `Target: ${result.device}` : null} />
          <ul className="divide-y divide-white/6">
            {checks.map((c) => {
              const copy = COPY[c.id];
              return (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <StatusDot status={c.status} />
                    <div className="min-w-0 flex-1">
                      <div className={cx(
                        "text-[12.5px] font-medium",
                        c.status === "ok" && "text-zinc-200",
                        c.status === "fail" && "text-amber-200",
                        c.status === "pending" && "text-zinc-500",
                      )}>
                        {copy.title}
                      </div>
                      {c.detail && <div className="mt-0.5 font-mono text-[10.5px] text-zinc-500">{c.detail}</div>}
                      {c.status === "fail" && (
                        <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-400">{copy.fix}</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <SectionHeader title="Data" />
          <div className="space-y-2 px-5 py-3">
            <DataAction
              label="Reset onboarding prompt"
              description="Show this Settings modal automatically on next launch."
              onClick={() => { onResetOnboarding(); onClose(); }}
            />
            <DataAction
              label="Wipe captured data"
              description="Delete every imported snapshot (gear, characters, …). The next Arm capture will refill them. Requires the pipeline to be disarmed."
              tone="danger"
              onClick={() => void wipeCaptured(onAfterWipe)}
            />
          </div>

          <SectionHeader title="Debug" />
          <div className="space-y-2 px-5 py-3">
            <ToggleAction
              label="Stat lock & drift tooling (Builds)"
              description="Reveal the per-stat lock buttons, drift indicators and copy-dump button on Builds cards. Used for stat-formula regression work — off by default."
              checked={debugStatLocks}
              onToggle={onToggleDebugStatLocks}
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/6 bg-white/2 px-5 py-3">
          <span className="text-[11px] text-zinc-500">
            Setup checks re-run on each open / Re-check
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/8 bg-white/3 px-2.5 text-[11.5px] text-zinc-300 hover:bg-white/6"
            >
              Close
            </button>
            <button
              onClick={() => void probe()}
              disabled={loading}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium",
                loading
                  ? "cursor-wait border-white/8 bg-white/3 text-zinc-500"
                  : "border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
              )}
            >
              {loading && <Spinner className="h-3 w-3 text-cyan-300" />}
              {loading ? "Checking…" : "Re-check"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string | null }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/6 bg-white/2 px-5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">{title}</span>
      {subtitle && <span className="font-mono text-[10px] text-zinc-500">{subtitle}</span>}
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "fail" | "pending" }) {
  if (status === "ok") {
    return <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-[12px] font-bold text-emerald-300">✓</span>;
  }
  if (status === "fail") {
    return <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-amber-500/15 text-[12px] font-bold text-amber-300">!</span>;
  }
  return <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-white/5 text-[12px] text-zinc-600">·</span>;
}

interface DataActionProps {
  label: string;
  description: string;
  onClick: () => void;
  tone?: "default" | "danger";
}

function DataAction({ label, description, onClick, tone = "default" }: DataActionProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/6 bg-white/2 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-zinc-200">{label}</div>
        <div className="text-[11px] leading-snug text-zinc-500">{description}</div>
      </div>
      <button
        onClick={onClick}
        className={cx(
          "shrink-0 inline-flex h-7 items-center rounded-md border px-2.5 text-[11.5px] font-medium transition-colors active:scale-95",
          tone === "danger"
            ? "border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
            : "border-white/8 bg-white/3 text-zinc-200 hover:bg-white/6",
        )}
      >
        {tone === "danger" ? "Wipe" : "Reset"}
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
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/6 bg-white/2 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-white">{label}</div>
        <div className="text-[11px] leading-snug text-zinc-400">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-cyan-400/40 bg-cyan-500/30" : "border-white/8 bg-white/6",
        )}
      >
        <span
          className={cx(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** POST /api/capture/wipe + refresh inventory. Confirms via native dialog
 *  first (destructive). 409 means the pipeline is armed — we surface it as
 *  an alert so the user knows to Disarm first. */
async function wipeCaptured(onAfterWipe?: () => void): Promise<void> {
  if (!window.confirm("Delete every imported gear / character snapshot? This cannot be undone (next capture will refill).")) return;
  try {
    const r = await fetch("/api/capture/wipe", { method: "POST" });
    if (r.status === 409) {
      window.alert("The capture pipeline is still armed. Click Disarm in the header first, then retry.");
      return;
    }
    if (!r.ok) {
      window.alert(`Wipe failed: HTTP ${r.status}`);
      return;
    }
    onAfterWipe?.();
  } catch (err) {
    window.alert(`Wipe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
