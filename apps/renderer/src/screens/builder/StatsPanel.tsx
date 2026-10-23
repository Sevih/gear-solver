/**
 * Builder stats panel — current → projected stats of the selected build.
 */
import type { ReactNode } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { FinalStats } from "../../lib/composeBuild.js";
import { critCellParts, critCellTitle, critRawOf } from "./critCell.js";
import { Panel } from "./Panel.js";
import { SOLVER_STATS } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Stats panel — current → new, side by side
 * ───────────────────────────────────────────────────────────────────────── */
export function StatsPanel({
  stats, projected, cp, width = "w-44",
}: {
  stats: FinalStats | null;
  projected: FinalStats | null;
  /** Battle Power of the current loadout and of the selected build — the
   *  panel's first row, read like the stats (current ▸ projected + delta). */
  cp: { current: number | null; projected: number | null };
  width?: string;
}) {
  return (
    <Panel title="Current → Projected" hint="Current stats on the left, projected stats from the selected build on the right." width={width}>
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
        {/* CP has no stat icon — labelled like StatIcon's text fallback. Takes
            the left half of its own row so the stat pairs below keep their grid. */}
        <StatsPanelRow
          icon={<span className="text-[9px] uppercase tracking-wider text-zinc-400" title="Combat Power">CP</span>}
          unit=""
          cur={cp.current}
          proj={cp.projected}
        />
        <span className="col-span-4" />
        {SOLVER_STATS.map((s) =>
          s.key === "critRate" ? (
            // Crit reads its raw sum (delta, colour) and prints "100% ⁺N" past
            // the sheet's 100 bound, on either side.
            <StatsPanelRow
              key={s.key}
              icon={<StatIcon stat={s.iconKey} size={12} />}
              unit={s.unit}
              cur={stats ? critRawOf(stats) : null}
              proj={projected ? critRawOf(projected) : null}
              curCap={stats ? { ...critCellParts(stats), title: critCellTitle(stats) } : undefined}
              projCap={projected ? { ...critCellParts(projected), title: critCellTitle(projected) } : undefined}
            />
          ) : (
            <StatsPanelRow
              key={s.key}
              icon={<StatIcon stat={s.iconKey} size={12} />}
              unit={s.unit}
              cur={stats?.[s.key as keyof FinalStats] ?? null}
              proj={projected?.[s.key as keyof FinalStats] ?? null}
            />
          ),
        )}
      </div>
    </Panel>
  );
}

/** A side past its in-game bound: the bounded value shown, the raw overflow
 *  as an amber exponent (`critCellParts`). */
interface CappedSide { shown: number; over: number; title?: string }

function StatsPanelRow({
  icon, unit, cur, proj, curCap, projCap,
}: {
  icon: ReactNode;
  unit: string;
  /** Values the delta and the colour read — the raw sum for a capped axis. */
  cur: number | null;
  proj: number | null;
  curCap?: CappedSide;
  projCap?: CappedSide;
}) {
  // Signed change the selected build makes on this axis — the "by how much" the
  // colour alone couldn't convey. Rounded to kill float noise (489.999 → 490).
  const delta = proj != null && cur != null ? Math.round((proj - cur) * 10) / 10 : null;
  // Color the projected column by delta vs current so the user sees at a
  // glance which axes improve / regress on the selected build.
  let projTone = "text-cyan-300/40";
  if (proj != null && cur != null) {
    if (proj > cur) projTone = "text-emerald-300";
    else if (proj < cur) projTone = "text-rose-300";
    else projTone = "text-white/60";
  } else if (proj != null) {
    projTone = "text-cyan-300";
  }
  return (
    <>
      {icon}
      <span className={cx("text-right", cur != null ? "text-white" : "text-white/55")} title={curCap?.title}>
        {cur != null ? <CappedValue v={cur} unit={unit} cap={curCap} /> : "—"}
      </span>
      <span className="text-white/65">▸</span>
      <span className={cx("flex items-baseline justify-end gap-1 text-right", projTone)}>
        {proj != null ? (
          <>
            <span title={projCap?.title}><CappedValue v={proj} unit={unit} cap={projCap} /></span>
            {delta != null && delta !== 0 && (
              <span className="text-[8.5px] opacity-70">{delta > 0 ? `+${delta}` : delta}{unit}</span>
            )}
          </>
        ) : "—"}
      </span>
    </>
  );
}

/** `v` + unit, or — past the bound — the shown value + the amber "⁺N". */
function CappedValue({ v, unit, cap }: { v: number; unit: string; cap?: CappedSide }) {
  if (!cap) return <>{`${v}${unit}`}</>;
  if (cap.over === 0) return <>{`${cap.shown}${unit}`}</>;
  return (
    <>
      {`${cap.shown}${unit}`}
      <sup className="ml-px text-[7.5px] leading-none text-amber-300">+{cap.over}</sup>
    </>
  );
}
