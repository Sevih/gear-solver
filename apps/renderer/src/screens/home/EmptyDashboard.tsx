/**
 * Home empty state — the capture CTA shown before anything is captured.
 */
import type { SteamStatus } from "../../steam.js";
import { cx } from "../../design/cx.js";

// ── empty state ──────────────────────────────────────────────────────────
/** Capture CTA: the plugin needs installing once, then the game launched. */
export function EmptyDashboard({ steam, busy, onSteamInstall, onSteamLaunch }: {
  steam: SteamStatus | null; busy: boolean;
  onSteamInstall: () => void; onSteamLaunch: () => void;
}) {
  const s = steam;
  const cta: { label: string; onClick?: () => void } =
    !s ? { label: "Checking Steam…" }
    : !s.installed ? { label: "OUTERPLANE not found in Steam" }
    : !s.ready ? { label: busy ? "Installing…" : s.plugin.present ? "Update the capture plugin" : "Install the capture plugin", onClick: busy ? undefined : onSteamInstall }
    : !s.gameRunning ? { label: "Launch OUTERPLANE", onClick: onSteamLaunch }
    : s.live ? { label: "Waiting for the lobby…" }
    : { label: "Restart the game to load the plugin" };
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-white/8 px-10 py-16 text-center" style={{ background: "#161618" }}>
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-400/8">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="12" cy="12" r="3.4" /><path d="M8 5l1.4-2h5.2L16 5" />
        </svg>
      </div>
      <span className="mb-2 text-[20px] font-bold tracking-tight text-white">No account captured yet</span>
      <p className="mb-6 max-w-105 text-[13px] leading-relaxed text-zinc-400">
        Play OUTERPLANE on Steam with the capture plugin installed and this home fills in on its own — heroes, gear quality, breakdowns and your saved build library.
      </p>
      <button
        onClick={cta.onClick}
        disabled={!cta.onClick}
        className={cx(
          "rounded-[10px] px-6.5 py-3 text-[13px] font-bold tracking-tight",
          cta.onClick
            ? "bg-linear-to-b from-cyan-400 to-cyan-500 text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_8px_22px_-8px_rgba(34,211,238,0.7)] hover:brightness-105"
            : "cursor-default border border-white/10 bg-white/4 text-zinc-400",
        )}
      >
        {cta.label}
      </button>
      <div className="mt-6 flex items-center gap-2.5 font-mono text-[11px] text-zinc-400">
        <span>install plugin</span><span className="text-zinc-400">→</span><span>launch game</span><span className="text-zinc-400">→</span><span>reach the lobby</span>
      </div>
    </div>
  );
}
