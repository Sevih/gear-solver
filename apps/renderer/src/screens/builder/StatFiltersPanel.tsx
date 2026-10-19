/**
 * Builder stat filters panel — min ≤ X ≤ max per raw stat.
 */
import type { Dispatch } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { MinMax, SolverAction } from "../../lib/solver/builderFilters.js";
import { Panel } from "./Panel.js";
import { SOLVER_STATS } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Stat filters panel — min ≤ X ≤ max per raw stat
 * ───────────────────────────────────────────────────────────────────────── */
export function StatFiltersPanel({ filters, dispatch }: { filters: Record<string, MinMax>; dispatch: Dispatch<SolverAction> }) {
  return (
    <Panel
      title="Stat filters"
      hint="Min ≤ stat ≤ Max. Applied pre-solve and re-runnable post-solve via Filter."
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-1 gap-y-0.5">
        {SOLVER_STATS.map((s) => {
          const cur = filters[s.key] ?? {};
          return (
            <FilterRow
              key={s.key}
              iconKey={s.iconKey}
              minValue={cur.min}
              maxValue={cur.max}
              onMin={(v) => dispatch({ type: "setStatFilter", stat: s.key, bound: "min", value: v })}
              onMax={(v) => dispatch({ type: "setStatFilter", stat: s.key, bound: "max", value: v })}
            />
          );
        })}
      </div>
    </Panel>
  );
}

function FilterRow({
  iconKey, label, minValue, maxValue, onMin, onMax,
}: {
  iconKey?: string;
  label?: string;
  minValue: number | undefined;
  maxValue: number | undefined;
  onMin: (v: number | undefined) => void;
  onMax: (v: number | undefined) => void;
}) {
  // Inverted bound (min > max) silently returns zero builds — surface it as
  // a rose tint on both inputs so the user sees the misconfig at a glance.
  const inverted = minValue != null && maxValue != null && minValue > maxValue;
  return (
    <>
      <div className="flex w-12 items-center gap-1 text-[10.5px] text-white/70">
        {iconKey && <StatIcon stat={iconKey} size={12} />}
        {label && <span className="truncate">{label}</span>}
      </div>
      <FilterInput value={minValue} onChange={onMin} invalid={inverted} title={inverted ? "Min > Max — no build can match." : undefined} />
      <FilterInput value={maxValue} onChange={onMax} invalid={inverted} title={inverted ? "Min > Max — no build can match." : undefined} />
    </>
  );
}

export function FilterInput({
  value, onChange, invalid, title,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  invalid?: boolean;
  title?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ""}
      title={title}
      // Prevent the scroll wheel from silently changing a focused filter value
      // (a common type=number footgun) — blur instead so the page scrolls.
      onWheel={(e) => e.currentTarget.blur()}
      onChange={(e) => {
        const t = e.target.value;
        if (t === "") { onChange(undefined); return; }
        const n = Number(t);
        // Reject negatives — `min={0}` only constrains the spinner buttons,
        // not direct keyboard input. Filter ranges are unsigned by spec.
        if (!Number.isFinite(n) || n < 0) return;
        onChange(n);
      }}
      className={cx(
        "min-w-0 rounded border bg-black/30 px-1 py-0.5 text-right text-[10.5px] font-mono tabular-nums text-white focus:outline-none",
        invalid
          ? "border-rose-400/60 focus:border-rose-300"
          : "border-white/8 focus:border-cyan-400/40",
      )}
    />
  );
}
