/**
 * Crit rate past the sheet's 100 bound — how the results table and the
 * "Current → Projected" panel print it: the in-game 100 with the raw overflow
 * as an amber exponent ("100% ⁺42"), the tooltip naming the raw sum and the
 * waste per the shared overcap rule (`overcapOf`, +2% tolerance). Pure.
 */
import { round1, type FinalStats } from "../../lib/composeBuild.js";
import { CRIT_TOLERANCE, overcapOf } from "../../lib/overcap.js";

type CritStats = Pick<FinalStats, "critRate" | "critRateUncapped" | "pen">;

/** The raw crit sum — what the heatmap, the sort and the deltas read. */
export function critRawOf(fs: Pick<FinalStats, "critRate" | "critRateUncapped">): number {
  return fs.critRateUncapped ?? fs.critRate;
}

/** `shown` = the sheet's (bounded) crit, `over` = the raw sum past it, rounded
 *  to 0.1 — 0 when the raw sum doesn't exceed the bound. */
export function critCellParts(fs: Pick<FinalStats, "critRate" | "critRateUncapped">): { shown: number; over: number } {
  const over = round1(critRawOf(fs) - fs.critRate);
  return { shown: fs.critRate, over: over > 0 ? over : 0 };
}

/** "Crit rate 142% raw — capped at 100% in-game, 40% wasted over the 102%
 *  tolerance" (or "within the 2% buffer" up to 102); undefined when not over. */
export function critCellTitle(fs: CritStats): string | undefined {
  if (critCellParts(fs).over === 0) return undefined;
  const head = `Crit rate ${round1(critRawOf(fs))}% raw — capped at 100% in-game`;
  const o = overcapOf(fs).find((x) => x.key === "critRate");
  return o
    ? `${head}, ${o.waste}% wasted over the ${o.cap}% tolerance`
    : `${head}, within the ${CRIT_TOLERANCE - 100}% buffer`;
}
