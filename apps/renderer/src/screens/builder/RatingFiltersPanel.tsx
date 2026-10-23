/**
 * Builder rating filters panel — min ≤ X ≤ max per build rating.
 */
import type { Dispatch } from "react";
import type { DmgSkillInfo } from "../../lib/dmgSkill.js";
import type { MinMax, SolverAction } from "../../lib/solver/builderFilters.js";
import { Panel } from "./Panel.js";
import { SOLVER_RATINGS, ratingTitle } from "./statColumns.js";
import { FilterInput } from "./StatFiltersPanel.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Rating filters panel — same min/max model on calculated build ratings
 * ───────────────────────────────────────────────────────────────────────── */
export function RatingFiltersPanel({ filters, dispatch, dmgSkill }: { filters: Record<string, MinMax>; dispatch: Dispatch<SolverAction>; dmgSkill: DmgSkillInfo | null }) {
  return (
    <Panel
      title="Rating filters"
      hint="Same as Stat filters but on calculated ratings (DPS, EHP, …). Score and Swaps are derived in the solver."
      width="w-56"
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-1 gap-y-0.5">
        {SOLVER_RATINGS.map((r) => (
          <RatingFilterRow
            key={r.key}
            ratingKey={r.key}
            label={r.label}
            title={ratingTitle(r, dmgSkill)}
            filters={filters}
            dispatch={dispatch}
          />
        ))}
        <RatingFilterRow ratingKey="score" label="Score" title="Priority-weighted score: Σ stat / norm × priority (CHC and PEN capped at 100%)." filters={filters} dispatch={dispatch} />
        <RatingFilterRow ratingKey="upg" label="Swaps" title="Slots that change vs the hero's current loadout — not upgrades to do." filters={filters} dispatch={dispatch} />
      </div>
    </Panel>
  );
}

function RatingFilterRow({
  ratingKey, label, title, filters, dispatch,
}: {
  ratingKey: string;
  label: string;
  title?: string;
  filters: Record<string, MinMax>;
  dispatch: Dispatch<SolverAction>;
}) {
  const cur = filters[ratingKey] ?? {};
  return (
    <>
      <div className="w-12 truncate text-[10.5px] text-white/70" title={title}>{label}</div>
      <FilterInput value={cur.min} onChange={(v) => dispatch({ type: "setRatingFilter", rating: ratingKey, bound: "min", value: v })} />
      <FilterInput value={cur.max} onChange={(v) => dispatch({ type: "setRatingFilter", rating: ratingKey, bound: "max", value: v })} />
    </>
  );
}
