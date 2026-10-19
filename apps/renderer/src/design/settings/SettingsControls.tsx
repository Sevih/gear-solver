/**
 * Settings shared primitives — section strip, divider, segmented button,
 * stepper, switch and the action row the panes are built from.
 */
import { cx } from "../cx.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Shared primitives
 * ───────────────────────────────────────────────────────────────────────── */

export function SectionStrip({ title, note }: { title: string; note?: string | null }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/6 bg-white/2 px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/70">{title}</span>
      {note && <span className="font-mono text-[10px] text-zinc-400">{note}</span>}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-white/6" />;
}

export function SegButton({ label, on, onClick, divided }: { label: string; on: boolean; onClick: () => void; divided?: boolean }) {
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

export function Stepper({ value, onDec, onInc, dim, wide }: { value: number; onDec: () => void; onInc: () => void; dim?: boolean; wide?: boolean }) {
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

export function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
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

export function DataAction({ label, description, onClick, tone = "default", actionLabel, disabled }: DataActionProps) {
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
