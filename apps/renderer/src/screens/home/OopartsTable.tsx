/**
 * Home talisman table — talisman × main-stat cross-tab.
 */
import { Fragment } from "react";
import { cx } from "../../design/cx.js";
import { StatIcon } from "../../design/EquipmentIcon.js";
import type { HomeStats } from "../../lib/homeStats.js";

// ── talisman × main-stat cross-tab ───────────────────────────────────────
// Rows = talisman types (red name when unowned), cols = the 9 main stats.
// Cells are a light cyan heatmap; 0 reads muted. A totals row/col closes it.
export function OopartsTable({ ooparts }: { ooparts: HomeStats["ooparts"] }) {
  const { cols, rows, colTotals, total } = ooparts;
  const max = Math.max(1, ...rows.flatMap((r) => r.counts));
  const cell = "grid place-items-center py-1 text-[11px] tabular-nums";
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-fit gap-px" style={{ gridTemplateColumns: `48px repeat(${cols.length}, 30px) 34px` }}>
        {/* header */}
        <span />
        {cols.map((c) => (
          <span key={c.key} title={c.label} className="grid place-items-center pb-1">
            <StatIcon stat={c.key} size={16} />
          </span>
        ))}
        <span className="grid place-items-center pb-1 text-[8px] font-bold uppercase tracking-wide text-zinc-500">Σ</span>

        {/* rows — item art only; hover reveals name + effect */}
        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className="grid cursor-help place-items-center py-1" title={r.effect ? `${r.name} — ${r.effect}` : r.name}>
              {/* same framed look as the inventory: rarity slot bg (talismans
                  are all Unique → red) under the item art. */}
              <span className={cx("relative h-7 w-7 shrink-0 overflow-hidden rounded", r.total === 0 && "opacity-30 grayscale")}>
                <img src="/img/ui/bg/TI_Slot_Unique.webp" alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                {r.icon && <img src={`/img/equipment/${r.icon}.webp`} alt={r.name} className="absolute inset-0 h-full w-full object-contain p-0.5" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
              </span>
            </span>
            {r.counts.map((n, i) => (
              <span
                key={i}
                className={cx(cell, "rounded", n > 0 ? "font-semibold text-zinc-100" : "text-zinc-700")}
                style={n > 0 ? { background: `rgba(34,211,238,${Math.min(0.08 + (n / max) * 0.32, 0.4)})` } : undefined}
              >
                {n > 0 ? n : "·"}
              </span>
            ))}
            <span className={cx(cell, "font-semibold", r.total > 0 ? "text-zinc-200" : "text-zinc-700")}>{r.total || "·"}</span>
          </Fragment>
        ))}

        {/* totals row */}
        <span className="grid place-items-center py-1 text-[8px] font-bold uppercase tracking-wide text-zinc-500">Total</span>
        {colTotals.map((n, i) => (
          <span key={i} className={cx(cell, "font-semibold", n > 0 ? "text-zinc-300" : "text-zinc-700")}>{n || "·"}</span>
        ))}
        <span className={cx(cell, "font-bold text-zinc-200")}>{total || "·"}</span>
      </div>
    </div>
  );
}
