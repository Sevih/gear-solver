/**
 * Builder sets panel — set plans, required sets and exclude lists.
 */
import { useMemo, useState, type Dispatch } from "react";
import { cx } from "../../design/cx.js";
import type { SetPlan } from "../../lib/solver/types.js";
import { ARMOR_SLOTS, planSlots } from "../../lib/solver/setPlans.js";
import type { SolverAction } from "../../lib/solver/builderFilters.js";
import type { ArmorSetEntry } from "./catalogs.js";
import { SetIconChip, type SetChipState } from "./IconChips.js";
import { Panel } from "./Panel.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Sets panel — required / piece-count requirements + exclude lists
 * ───────────────────────────────────────────────────────────────────────── */
export function SetsPanel({
  sets, setPlans, excludedSets, dispatch,
}: {
  sets: ArmorSetEntry[];
  setPlans: SetPlan[];
  excludedSets: string[];
  dispatch: Dispatch<SolverAction>;
}) {
  // Two authoring modes share the one icon grid: "require" edits the active
  // plan (a build matches if ANY plan holds), "exclude" toggles the global
  // ban list (orthogonal to plans).
  const [mode, setMode] = useState<"require" | "exclude">("require");
  const [activePlan, setActivePlan] = useState(0);
  const plans = setPlans.length > 0 ? setPlans : [[]];
  const active = Math.min(activePlan, plans.length - 1);
  const activeConds = plans[active] ?? [];
  // Armor slots the active plan consumes — drives the per-chip "slots free"
  // computation (chip cycle + tooltip both honor the 4-slot ceiling).
  const activeTotal = activeConds.reduce((n, c) => n + c.count, 0);
  const excluded = useMemo(() => new Set(excludedSets), [excludedSets]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sets) m.set(s.id, s.name);
    return m;
  }, [sets]);

  const chipState = (s: ArmorSetEntry): SetChipState => {
    if (mode === "exclude") return excluded.has(s.id) ? "excluded" : "off";
    const c = activeConds.find((x) => x.setId === s.id)?.count ?? 0;
    return c === 4 ? "req-4pc" : c === 2 ? "req-2pc" : "off";
  };
  const onChip = (s: ArmorSetEntry) => {
    if (mode === "exclude") { dispatch({ type: "toggleExcludedSet", setId: s.id }); return; }
    dispatch({
      type: "cycleSetInPlan", planIdx: active, setId: s.id,
      reach: { has2pc: s.has2pc, has4pc: s.has4pc, canForm2pc: s.canForm2pc, canForm4pc: s.canForm4pc },
    });
  };

  // Read-only summary of the whole OR constraint (only non-empty plans).
  const summary = plans
    .filter((p) => p.length > 0)
    .map((p) => p.map((c) => `${nameById.get(c.setId) ?? c.setId} ×${c.count}`).join(" + "))
    .join("  OR  ");

  const hint = mode === "require"
    ? "Each plan is an AND group (e.g. 2pc A + 2pc B). A build matches if ANY plan holds. Click a set to cycle off → 2pc → 4pc → off in the active plan; + OR adds an alternative. Skips steps the inventory can't form."
    : "Click a set to exclude it from every build (orthogonal to the require plans). Click again to clear.";

  return (
    <Panel title="Sets" hint={hint} width="w-60">
      <div className="mb-2 inline-flex rounded-md border border-white/10 bg-white/2 p-0.5 text-[10.5px]">
        {(["require", "exclude"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cx(
              "rounded px-2 py-0.5 capitalize transition-colors",
              mode === m ? "bg-cyan-500/20 text-cyan-100" : "text-white/70 hover:text-white/80",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "require" && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {plans.map((p, i) => (
            <PlanTab
              key={i}
              label={`Plan ${i + 1}`}
              count={p.length}
              active={i === active}
              onSelect={() => setActivePlan(i)}
              onRemove={plans.length > 1 ? () => {
                dispatch({ type: "removePlan", planIdx: i });
                setActivePlan((a) => (a >= i && a > 0 ? a - 1 : a));
              } : undefined}
            />
          ))}
          <button
            type="button"
            onClick={() => { dispatch({ type: "addPlan" }); setActivePlan(plans.length); }}
            className="rounded border border-white/10 bg-white/2 px-1.5 py-0.5 text-[10.5px] text-white/60 hover:bg-white/8 hover:text-white"
            title="Add an OR-alternative group"
          >
            + OR
          </button>
        </div>
      )}

      {sets.length === 0 ? (
        <div className="text-[11px] italic text-white/65">No forms-anything set in inventory</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {sets.map((s) => {
            // Armor slots still free for THIS set in the active plan (its own
            // count excluded) — mirrors the reducer's cycle guard so the chip
            // tooltip announces "plan full" instead of a click doing nothing.
            const own = activeConds.find((c) => c.setId === s.id)?.count ?? 0;
            const slotsFree = ARMOR_SLOTS - (activeTotal - own);
            return <SetIconChip key={s.id} set={s} state={chipState(s)} mode={mode} slotsFree={slotsFree} onClick={() => onChip(s)} />;
          })}
        </div>
      )}

      {mode === "require" && summary && (
        <div className="mt-2 text-[10px] leading-snug text-white/70">
          <span className="text-white/65">Match: </span>{summary}
        </div>
      )}
      {/* A plan over 4 armor slots can never match (the engine skips it) — only
       *  reachable via an imported preset / reco (the chip cycle now guards
       *  manual edits), so call it out instead of a silent "no builds". */}
      {mode === "require" && plans.some((p) => planSlots(p) > ARMOR_SLOTS) && (
        <div className="mt-2 text-[10px] leading-snug text-rose-300/90">
          ⚠ A plan requires more than {ARMOR_SLOTS} armor pieces — it can never match. Remove a set from it.
        </div>
      )}
    </Panel>
  );
}

/** One OR-alternative tab. Shows the plan label + a cond count badge; the ✕
 *  (when removable) deletes the plan. Clicking the body selects it for editing. */
function PlanTab({
  label, count, active, onSelect, onRemove,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
        active ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100" : "border-white/10 bg-white/2 text-white/70 hover:text-white/85",
      )}
    >
      <button type="button" onClick={onSelect} className="flex items-center gap-1">
        {label}
        {count > 0 && <span className="rounded-sm bg-white/10 px-1 text-[9px] tabular-nums">{count}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-white/65 hover:text-rose-300"
          title="Remove this group"
          aria-label={`Remove ${label}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}
