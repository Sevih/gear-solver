/**
 * First-launch / on-demand onboarding wizard.
 *
 * Sequentially probes the four preflight checks the capture pipeline relies
 * on (emulator installed, instance running, ADB connecting, root toggle ON)
 * and renders each as a row with a ✓/✗ and — when failed — a "how to fix"
 * panel specific to that step. The user can re-check anytime; the modal
 * closes when all four pass (or when the user dismisses it manually).
 *
 * The backend (`/api/preflight`) drives the actual probing — this component
 * is pure presentation + polling.
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

/** Per-check user-facing copy. Kept in the renderer (rather than the
 *  backend) so the maintainer can iterate on UX strings without
 *  republishing the Electron app. */
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

/** All four check ids in display order (matches the dependency chain in
 *  `preflight()` on the backend). */
const ORDER: CheckId[] = ["emulator-installed", "emulator-running", "adb-connection", "root-toggle"];

interface Props {
  /** Controlled visibility — App.tsx owns the open/close state so it can
   *  combine first-launch detection with the manual "Setup" header button. */
  open: boolean;
  onClose: () => void;
  /** Called once the wizard observes a ready=true result, so App.tsx can
   *  set the "onboarding completed" flag and skip future first-launch
   *  pop-ups. The wizard itself stays visible (user can dismiss manually). */
  onReady?: () => void;
}

export function OnboardingWizard({ open, onClose, onReady }: Props) {
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
      // Backend not reachable (e.g. dev server down) — keep last result if any.
    } finally {
      setLoading(false);
    }
  }

  // Run a fresh probe whenever the wizard opens so the user sees current
  // state (their emulator may have started since the last open).
  useEffect(() => { if (open) void probe(); }, [open]);

  if (!open) return null;

  // Map backend results onto every step in ORDER. Steps the backend didn't
  // emit (because an earlier step failed and it bailed) get rendered as
  // "pending" — gray, no detail.
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
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/8 bg-zinc-950 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/6 bg-linear-to-b from-white/4 to-transparent px-5 py-3.5">
          <div className="leading-tight">
            <div className="font-display text-[14px] font-semibold text-zinc-100">Setup check</div>
            <div className="text-[11px] text-zinc-500">
              {result?.ready ? "All set — capture is ready to arm." : "We need a rooted Android emulator to capture your inventory."}
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
                    {c.detail && (
                      <div className="mt-0.5 font-mono text-[10.5px] text-zinc-500">{c.detail}</div>
                    )}
                    {c.status === "fail" && (
                      <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-400">{copy.fix}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="flex items-center justify-between gap-3 border-t border-white/6 bg-white/2 px-5 py-3">
          <span className="text-[11px] text-zinc-500">
            {result?.device && <span className="font-mono">{result.device}</span>}
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

function StatusDot({ status }: { status: "ok" | "fail" | "pending" }) {
  if (status === "ok") {
    return (
      <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-[12px] font-bold text-emerald-300">✓</span>
    );
  }
  if (status === "fail") {
    return (
      <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-amber-500/15 text-[12px] font-bold text-amber-300">!</span>
    );
  }
  return (
    <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-white/5 text-[12px] text-zinc-600">·</span>
  );
}
