/**
 * Home primitives — card, labels, numbers, segmented control, info tip,
 * action button, breakdown bar and stat tile shared by the dashboard sections.
 */
import { cx } from "../../design/cx.js";

// ── small shared primitives ─────────────────────────────────────────────
export function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cx("rounded-xl border border-white/8 p-4", className)}
      style={{ background: "#161618", ...style }}
    >
      {children}
    </div>
  );
}

export function SubLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-widest text-zinc-400">
      <span className="text-zinc-400">{icon}</span>{children}
    </span>
  );
}

export function SectionLabel({ children, right, icon, tint }: {
  children: React.ReactNode; right?: React.ReactNode; icon?: React.ReactNode; tint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-white/70">
        {icon && <span style={tint ? { color: tint } : undefined}>{icon}</span>}
        {children}
      </span>
      {right}
    </div>
  );
}
export function Num({ children, className, color }: { children: React.ReactNode; className?: string; color?: string }) {
  return <span className={cx("font-mono tabular-nums leading-none", className)} style={color ? { color } : undefined}>{children}</span>;
}
/** Compact segmented pill toggle — switches between the breakdown views. */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/4 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "rounded-md px-2 py-0.75 text-[9px] font-bold uppercase tracking-wide transition-colors",
            value === o.id ? "bg-white/12 text-white" : "text-zinc-400 hover:text-zinc-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
/** Small "?" affordance with a native tooltip — discoverable, zero layout cost. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="grid h-3.5 w-3.5 shrink-0 cursor-help place-items-center rounded-full border border-white/20 text-[8px] font-bold text-zinc-400"
    >
      ?
    </span>
  );
}
export function ActBtn({ children, tone = "neutral", onClick, className, disabled }: {
  children: React.ReactNode; tone?: "neutral" | "cyan" | "violet"; onClick?: () => void; className?: string; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-lg border px-2.5 py-2 text-[11.5px] font-semibold transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        tone === "cyan" ? "border-cyan-400/35 bg-cyan-500/8 text-cyan-200 hover:bg-cyan-500/15"
        : tone === "violet" ? "border-violet-400/35 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
        : "border-white/10 bg-white/4 text-zinc-300 hover:bg-white/8",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── breakdown bar row (element / class) ──────────────────────────────────
export function BarRow({ label, labelW, count, w, color, iconSrc }: { label: string; labelW: number; count: number; w: string; color: string; iconSrc?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {iconSrc && <img src={iconSrc} alt="" className="h-4 w-4 shrink-0" />}
      <span className="shrink-0 text-[11px] text-zinc-400" style={{ width: labelW }}>{label}</span>
      <div className="h-1.75 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: w, background: color }} />
      </div>
      <Num className="w-6 shrink-0 text-right text-[11px] font-semibold text-zinc-300">{count}</Num>
    </div>
  );
}

// ── small gear-state stat tile (ascended / +15 / locked) ─────────────────
export function Stat({ label, value, gradient }: { label: string; value: number; gradient?: boolean }) {
  return (
    <div className={cx(
      "flex flex-1 flex-col gap-0.5 rounded-lg px-2.5 py-2.5",
      gradient ? "border border-cyan-400/20 bg-cyan-400/5" : "border border-white/7 bg-white/3",
    )}>
      {gradient ? (
        <span className="bg-linear-to-r from-cyan-400 via-violet-500 to-pink-500 bg-clip-text text-[9px] font-bold uppercase tracking-wider text-transparent">{label}</span>
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      )}
      <Num className={cx("text-[18px] font-bold", gradient ? "text-cyan-300" : "text-zinc-200")}>{value.toLocaleString()}</Num>
    </div>
  );
}
