/**
 * Builder stats panel — current → projected stats of the selected build.
 */
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { FinalStats } from "../../lib/composeBuild.js";
import { Panel } from "./Panel.js";
import { SOLVER_STATS } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Stats panel — current → new, side by side
 * ───────────────────────────────────────────────────────────────────────── */
export function StatsPanel({ stats, projected, width = "w-44" }: { stats: FinalStats | null; projected: FinalStats | null; width?: string }) {
  return (
    <Panel title="Current → Projected" hint="Current stats on the left, projected stats from the selected build on the right." width={width}>
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
        {SOLVER_STATS.map((s) => (
          <StatsPanelRow key={s.key} stat={s} stats={stats} projected={projected} />
        ))}
      </div>
    </Panel>
  );
}

function StatsPanelRow({
  stat, stats, projected,
}: { stat: typeof SOLVER_STATS[number]; stats: FinalStats | null; projected: FinalStats | null }) {
  const cur = stats ? stats[stat.key as keyof FinalStats] : null;
  const proj = projected ? projected[stat.key as keyof FinalStats] : null;
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
      <StatIcon stat={stat.iconKey} size={12} />
      <span className={cx("text-right", cur != null ? "text-white" : "text-white/55")}>
        {cur != null ? `${cur}${stat.unit}` : "—"}
      </span>
      <span className="text-white/65">▸</span>
      <span className={cx("flex items-baseline justify-end gap-1 text-right", projTone)}>
        {proj != null ? (
          <>
            <span>{`${proj}${stat.unit}`}</span>
            {delta != null && delta !== 0 && (
              <span className="text-[8.5px] opacity-70">{delta > 0 ? `+${delta}` : delta}{stat.unit}</span>
            )}
          </>
        ) : "—"}
      </span>
    </>
  );
}
