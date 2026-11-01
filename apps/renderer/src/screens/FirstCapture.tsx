/**
 * First-install empty state — what to do before anything is captured, shown
 * by Heroes and Gear while no inventory is loaded. No button of its own: the
 * plugin install / game launch button is the header's (and Setup's).
 */
import { captureBadge, type SteamStatus } from "../steam.js";

// ── empty state ──────────────────────────────────────────────────────────
/** The next step, in the header pill's words: the plugin needs installing
 *  once, then the game launched. */
export function FirstCapture({ steam, onOpenSetup }: {
  steam: SteamStatus | null; onOpenSetup: () => void;
}) {
  const s = steam;
  const badge = captureBadge(s);
  const next =
    !s ? "Looking for OUTERPLANE in your Steam library…"
    : !s.installed ? "OUTERPLANE wasn't found in Steam. Install it from Steam, or import your snapshot files with the Manual fallback at the bottom of the window."
    : !s.ready ? `Use the ${s.plugin.present ? "update" : "install"} button at the top right, next to the capture pill, to put the capture plugin in the game folder (game closed).`
    : !s.gameRunning ? "Start the game with the button at the top right, next to the capture pill, then play to the lobby."
    : s.live ? "Reach the lobby: the snapshot imports itself."
    : "The game is running without the plugin: restart it to load the plugin.";
  return (
    <div className="mx-auto flex h-full w-full flex-col overflow-y-auto px-3.5 py-3.5" style={{ maxWidth: 1480 }}>
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-white/8 px-10 py-16 text-center" style={{ background: "#161618" }}>
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-400/8">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="12" cy="12" r="3.4" /><path d="M8 5l1.4-2h5.2L16 5" />
          </svg>
        </div>
        <span className="mb-2 text-[20px] font-bold tracking-tight text-white">No account captured yet</span>
        <p className="mb-6 max-w-105 text-[13px] leading-relaxed text-zinc-400">
          Play OUTERPLANE on Steam with the capture plugin installed and Heroes and Gear fill in on their own — heroes, gear quality, breakdowns and your saved build library.
        </p>
        <div className="flex max-w-105 flex-col items-center gap-2 rounded-[10px] border border-white/10 bg-white/4 px-5 py-3" title={badge.title}>
          <span className="text-[13px] font-bold tracking-tight text-white">Capture · {badge.label}</span>
          <span className="text-[12px] leading-relaxed text-zinc-400">{next}</span>
          <button onClick={onOpenSetup} className="text-[12px] font-semibold text-cyan-300 underline-offset-2 hover:underline">
            Step by step in Settings › Setup
          </button>
        </div>
        <div className="mt-6 flex items-center gap-2.5 font-mono text-[11px] text-zinc-400">
          <span>install plugin</span><span className="text-zinc-400">→</span><span>launch game</span><span className="text-zinc-400">→</span><span>reach the lobby</span>
        </div>
      </div>
    </div>
  );
}
