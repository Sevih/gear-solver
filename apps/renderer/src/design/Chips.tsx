import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { StatIcon } from "./EquipmentIcon.js";
import { RARITY, type DesignRarity } from "./tokens.js";

/** Generic small pill. */
export function Pill({
  children, tone = "neutral", className,
}: { children: ReactNode; tone?: "neutral" | "violet" | "amber" | "emerald" | "rose"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "border-white/7 bg-white/4 text-zinc-300",
    violet: "border-violet-400/30 bg-violet-500/15 text-violet-100",
    amber: "border-amber-400/25 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
    rose: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  };
  return (
    <span className={cx(
      "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium uppercase tracking-wider",
      tones[tone], className,
    )}>{children}</span>
  );
}

/** Rarity chip — color from the design rarity tokens. */
export function RarityPill({ rarity, size = "sm" }: { rarity: DesignRarity; size?: "xs" | "sm" }) {
  const r = RARITY[rarity] ?? RARITY.normal;
  return (
    <span
      className={cx("inline-flex items-center rounded-md font-medium uppercase tracking-wider",
        size === "xs" ? "h-4 px-1 text-[9px]" : "h-5 px-1.5 text-[10px]")}
      style={{ color: r.fg, background: r.bg, border: `1px solid ${r.bd}` }}
    >
      {r.label}
    </span>
  );
}

/** Status chip combining `Singularity`, `Equipped`, `Locked`, `Free`. */
export function StatusChip({
  equipped, locked, singularity,
}: { equipped: boolean; locked: boolean; singularity: boolean }) {
  if (singularity) {
    return (
      <Pill tone="violet" className="gap-1">
        <span style={{ width: 5, height: 5, borderRadius: 1, background: "#9D51FF", transform: "rotate(45deg)" }} />
        Singularity
      </Pill>
    );
  }
  if (equipped) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-500/10 px-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
        Equipped
      </span>
    );
  }
  if (locked) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-md border border-amber-400/25 bg-amber-500/10 px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-200">
        Locked
      </span>
    );
  }
  return <Pill tone="neutral">Free</Pill>;
}

export function LockIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.2}>
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5 V4 a2 2 0 0 1 4 0 V5.5" />
    </svg>
  );
}

/** Substat chip — `[icon] value [lvN]`, monospace. The stat icon already
 *  conveys "what kind of stat" — coloring the value too (was: off=yellow,
 *  def=blue, util=cyan) added visual noise without payoff, so the value
 *  stays uniform zinc. */
export function SubstatChip({
  stat, value, lv, className,
}: { stat: string; value: string | number; lv?: number; className?: string }) {
  return (
    <span className={cx(
      "inline-flex items-center gap-1 rounded border border-white/5 bg-black/25 px-1.5 py-0.5 font-mono text-[11.5px] tabular-nums",
      className,
    )}>
      <StatIcon stat={stat} size={14} />
      <span className="text-zinc-100">{value}</span>
      {lv != null && <span className="text-[9px] text-zinc-400">lv{lv}</span>}
    </span>
  );
}
