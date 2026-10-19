/**
 * Home update card — the state-driven update center (all five states).
 */
import { Spinner } from "../../design/Shell.js";
import type { UpdatePhase, UpdateStatus } from "../../lib/update.js";
import { IC_UPDATE } from "./HomeIcons.js";
import { Num } from "./HomePrimitives.js";

// ── update card (compact column — all five states) ───────────────────────
function IconBox({ phase, bg, color }: { phase: UpdatePhase; bg: string; color: string }) {
  return (
    <div className="grid h-10.5 w-10.5 shrink-0 place-items-center rounded-xl" style={{ background: bg, color }}>
      {phase === "checking" ? (
        <Spinner className="h-4.5 w-4.5" />
      ) : phase === "error" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l9 16H3z" /><path d="M12 10v4" /><circle cx={12} cy={17} r={0.6} fill="currentColor" />
        </svg>
      ) : phase === "downloading" || phase === "downloaded" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v10" /><path d="M8 11l4 4 4-4" /><path d="M5 19h14" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={9} /><path d="M8 12.5l2.6 2.6L16 9.5" />
        </svg>
      )}
    </div>
  );
}

export function UpdateCard({ status, onCheck, onInstall }: {
  status: UpdateStatus; onCheck: () => void; onInstall: () => void;
}) {
  const ver = status.version ?? "update";
  const cfg = {
    uptodate:    { bg: "rgba(52,211,153,0.12)", color: "#34d399", title: "Up to date",          titleColor: "#fafafa", sub: `gear·solver v${status.appVersion} — latest`, tag: "Up to date", tagColor: "#34d399", border: "rgba(255,255,255,0.09)", glow: "none" },
    checking:    { bg: "rgba(34,211,238,0.10)", color: "#67e8f9", title: "Checking for updates…", titleColor: "#fafafa", sub: "Contacting GitHub releases",                  tag: "Checking",   tagColor: "#67e8f9", border: "rgba(255,255,255,0.09)", glow: "none" },
    downloading: { bg: "rgba(34,211,238,0.10)", color: "#67e8f9", title: `Downloading v${ver}`,   titleColor: "#fafafa", sub: "Fetching in the background",                tag: "Downloading", tagColor: "#67e8f9", border: "rgba(34,211,238,0.22)", glow: "none" },
    downloaded:  { bg: "rgba(34,211,238,0.16)", color: "#67e8f9", title: `v${ver} ready`,          titleColor: "#fafafa", sub: "Restarts and applies on install",           tag: "Ready",      tagColor: "#67e8f9", border: "rgba(34,211,238,0.45)", glow: "0 0 0 1px rgba(34,211,238,0.18), 0 0 34px -10px rgba(34,211,238,0.5)" },
    error:       { bg: "rgba(251,113,133,0.10)", color: "#fb7185", title: "Update check failed",  titleColor: "#fda4af", sub: "Offline? Couldn’t reach GitHub",            tag: "Offline",    tagColor: "#fb7185", border: "rgba(251,113,133,0.3)", glow: "none" },
  }[status.state];
  const showNew = status.state === "downloading" || status.state === "downloaded";

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-xl p-4"
      style={{ background: "#101012", border: `1px solid ${cfg.border}`, boxShadow: cfg.glow }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-white/70">
          <span className="text-white/65">{IC_UPDATE}</span>Updates
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: cfg.tagColor }}>{cfg.tag}</span>
      </div>

      <div className="flex items-center gap-3">
        <IconBox phase={status.state} bg={cfg.bg} color={cfg.color} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold leading-tight" style={{ color: cfg.titleColor }}>{cfg.title}</span>
            {showNew && <span className="rounded-[5px] bg-cyan-400/15 px-1.5 py-px font-mono text-[8.5px] font-bold tracking-wider text-cyan-300">NEW</span>}
          </div>
          <span className="truncate text-[11px] text-zinc-400">{cfg.sub}</span>
        </div>
      </div>

      {status.state === "downloading" && (
        <div className="flex items-center gap-2.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-linear-to-r from-cyan-400 to-cyan-500 transition-[width] duration-200" style={{ width: `${status.progress}%` }} />
          </div>
          <Num className="min-w-9 text-right text-[11px] font-semibold text-cyan-300">{status.progress}%</Num>
        </div>
      )}

      {status.state === "downloaded" ? (
        <button
          onClick={onInstall}
          className="w-full rounded-lg bg-linear-to-b from-cyan-400 to-cyan-500 py-2.5 text-[12.5px] font-bold tracking-tight text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_7px_18px_-8px_rgba(34,211,238,0.7)] hover:brightness-105"
        >
          Install new version
        </button>
      ) : status.state === "error" ? (
        <button onClick={onCheck} className="w-full rounded-lg border border-rose-400/40 bg-rose-500/10 py-2 text-[12px] font-semibold text-rose-300 hover:bg-rose-500/20">Retry</button>
      ) : status.state === "uptodate" ? (
        <button onClick={onCheck} className="w-full rounded-lg border border-white/10 bg-zinc-900 py-2 text-[12px] font-semibold text-zinc-400 hover:bg-zinc-800">Check again</button>
      ) : null}

      {/* version metadata (always) */}
      <div className="flex items-center justify-between border-t border-white/7 pt-2.5">
        <div className="flex flex-col gap-px">
          <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/65">App</span>
          <Num className="text-[11.5px] font-semibold text-zinc-300">v{status.appVersion}</Num>
        </div>
        <div className="flex flex-col items-end gap-px">
          <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/65">Game data</span>
          <Num className="text-[11.5px] font-semibold text-zinc-400">{status.dataSha ?? "—"}</Num>
        </div>
      </div>
      {status.state === "downloaded" && <span className="-mt-1 text-center text-[9.5px] text-zinc-400">Installing restarts the app</span>}
    </div>
  );
}
