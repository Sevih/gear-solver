/**
 * Builder substat priority panel — per-stat weights and the Top % slider.
 */
import type { Dispatch } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import type { SolverAction } from "../../lib/solver/builderFilters.js";
import { Panel } from "./Panel.js";
import { SOLVER_STATS } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Substat priority panel — per-stat -1..3 + Top % slider
 * ───────────────────────────────────────────────────────────────────────── */
export function SubstatPriorityPanel({
  priority, topPct, dispatch,
}: {
  priority: Record<string, number>;
  topPct: number;
  dispatch: Dispatch<SolverAction>;
}) {
  // The Top-% prune runs whenever Top % < 100, priority or not: with no
  // priority the engine ranks each slot by a CP proxy (SOLVE CP) or by raw roll
  // magnitude (SOLVE, Score) — the latter has no objective, so its results are
  // arbitrary. Surface that so a user lowering Top % with no priorities set
  // knows what the slider is pruning by.
  const hasPriority = Object.values(priority).some((v) => v !== 0);
  return (
    <Panel
      title="Substat priority"
      hint="Score gear by Σ(max-rolls × priority). Top % scales an absolute combo budget (100 = exhaustive) and each slot keeps its best-ranked pieces. Heuristic — too low a Top % drops optimal builds."
      action={
        <button
          type="button"
          onClick={() => dispatch({ type: "clearPriority" })}
          className="text-[10px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200"
          title="Reset every priority to 0."
        >
          (clear)
        </button>
      }
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {SOLVER_STATS.map((s) => (
          <SubstatPriorityPanelRow
            key={s.key}
            stat={s}
            value={priority[s.key] ?? 0}
            onChange={(v) => dispatch({ type: "setPriority", stat: s.key, value: v })}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-white/6 pt-2">
        <span className="text-[10.5px] uppercase tracking-wider text-white/60">Top %</span>
        <input
          type="range"
          min={5}
          max={100}
          step={1}
          value={topPct}
          onChange={(e) => dispatch({ type: "setTopPct", value: Number(e.target.value) })}
          className="min-w-0 flex-1 accent-cyan-400"
        />
        <span className="w-7 text-right font-mono text-[11px] tabular-nums text-white">{topPct}</span>
      </div>
      {topPct < 100 && !hasPriority && (
        <div className="mt-1 text-[10px] leading-snug text-amber-300/80">
          SOLVE CP ranks each slot by a CP proxy. SOLVE (Score) without a priority
          keeps the fullest-rolled pieces, which is arbitrary: set a priority above.
        </div>
      )}
    </Panel>
  );
}

function SubstatPriorityPanelRow({
  stat, value, onChange,
}: { stat: typeof SOLVER_STATS[number]; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <StatIcon stat={stat.iconKey} size={14} className="pointer-events-none shrink-0" />
      <input
        type="range"
        min={-1}
        max={3}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-cyan-400"
      />
      <span className="w-4 text-right font-mono text-[10px] tabular-nums text-white">{value}</span>
    </>
  );
}
