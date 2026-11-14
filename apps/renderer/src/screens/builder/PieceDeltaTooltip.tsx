/**
 * "Why this piece?" — the body of the hover card on each Optimizer gear card
 * (`BottomGearBand`): what the build's piece brings over the worn one, stat by
 * stat, in the Score's grid (`pieceDelta`). Pure render of a `PieceDelta`.
 */
import type { PieceDelta, PieceDeltaRow } from "../../lib/solver/pieceDelta.js";
import { SOLVER_STATS } from "./statColumns.js";

const STAT_BY_KEY = new Map(SOLVER_STATS.map((s) => [s.key, s]));

/** Signed with a real minus sign, one decimal. */
const signed = (v: number, digits = 1): string => {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return `${v < 0 ? "−" : "+"}${s}`;
};

/** A stat value in its sheet unit: one decimal for the % axes, whole for the flat ones. */
const value = (v: number, unit: string): string => {
  const s = unit === "%" ? v.toFixed(1) : String(Math.round(v));
  return `${s.replace("-", "−")}${unit}`;
};

const deltaText = (v: number, unit: string): string => {
  const digits = unit === "%" ? 1 : 0;
  return `${signed(v, digits)}${unit}`;
};

/** A row the piece touches (either side non-zero). */
const touched = (r: PieceDeltaRow) => r.worn !== 0 || r.candidate !== 0;

/** The lead sentence: the score the swap gains, or why a losing piece is kept. */
export function pieceDeltaHeadline(d: PieceDelta): string {
  if (d.identical) return "Already equipped — the build keeps this piece.";
  if (!d.rows.some((r) => r.weight !== 0)) return "No stat is weighted in this solve's priority.";
  if (d.total < 0) return `${signed(d.total)} score — kept for its set / effect`;
  return `${signed(d.total)} score vs ${d.emptySlot ? "the empty slot" : "the worn piece"}`;
}

export function PieceDeltaTooltip({ delta }: { delta: PieceDelta }) {
  const headline = pieceDeltaHeadline(delta);
  if (delta.identical) return <div className="font-medium">{headline}</div>;
  const weighted = delta.rows.filter((r) => r.weight !== 0 && touched(r));
  const unweighted = delta.rows.filter((r) => r.weight === 0 && touched(r)).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={delta.total < 0 ? "font-medium text-amber-200" : "font-medium"}>{headline}</div>
      {weighted.length > 0 && (
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-white/60">
              <th className="pr-2 text-left font-medium">Stat</th>
              <th className="pr-2 text-right font-medium">Worn → this</th>
              <th className="pr-2 text-right font-medium">Δ</th>
              <th className="pr-2 text-right font-medium">Weight</th>
              <th className="text-right font-medium">Δ×w</th>
            </tr>
          </thead>
          <tbody>
            {weighted.map((r) => {
              const s = STAT_BY_KEY.get(r.key);
              const unit = s?.unit ?? "";
              return (
                <tr key={r.key} data-stat={r.key}>
                  <td className="pr-2 text-left text-white/80">{s?.label ?? r.key}</td>
                  <td className="whitespace-nowrap pr-2 text-right">{value(r.worn, unit)} → {value(r.candidate, unit)}</td>
                  <td className="pr-2 text-right">{deltaText(r.delta, unit)}</td>
                  <td className="pr-2 text-right text-white/70">{r.weight}</td>
                  <td className={r.weighted < 0 ? "text-right text-rose-300" : "text-right"}>{signed(r.weighted)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-white/10 font-semibold">
              <td className="pt-0.5 pr-2 text-left" colSpan={4}>Total</td>
              <td className="pt-0.5 text-right">{signed(delta.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {unweighted > 0 && <div className="text-white/60">+{unweighted} stat{unweighted > 1 ? "s" : ""} not weighted</div>}
      {delta.setChanged && <div className="text-white/60">Set bonus: see the Effects panel</div>}
    </div>
  );
}
