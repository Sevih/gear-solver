/**
 * Crit rate past the sheet's 100 bound in the Builder — `critCellParts` /
 * `critCellTitle` (the "100% ⁺42" cell and its tooltip) and the results
 * table's heatmap ranges, which read the raw sum.
 */
import { describe, expect, it } from "vitest";
import { critCellParts, critCellTitle, critRawOf } from "../src/screens/builder/critCell.js";
import { computeColumnRanges } from "../src/screens/builder/ResultsTable.js";
import { SOLVER_STATS } from "../src/screens/builder/statColumns.js";
import type { FinalStats } from "../src/lib/composeBuild.js";
import type { SolveBuild } from "../src/lib/solver/types.js";

const fs = (critRateUncapped: number, pen = 0) =>
  ({ critRate: Math.min(100, critRateUncapped), critRateUncapped, pen }) as FinalStats;

describe("critCellParts", () => {
  it("shows 100 and the raw overflow", () => {
    expect(critCellParts(fs(142))).toEqual({ shown: 100, over: 42 });
  });

  it("nothing over at or under the bound", () => {
    expect(critCellParts(fs(100))).toEqual({ shown: 100, over: 0 });
    expect(critCellParts(fs(85.5))).toEqual({ shown: 85.5, over: 0 });
  });

  it("rounds the overflow to 0.1, falls back on critRate without the raw sum", () => {
    expect(critCellParts(fs(100.36)).over).toBe(0.4);
    expect(critCellParts({ critRate: 100 } as FinalStats)).toEqual({ shown: 100, over: 0 });
    expect(critRawOf({ critRate: 90 } as FinalStats)).toBe(90);
  });
});

describe("critCellTitle", () => {
  it("names the raw sum and the waste past the 102% tolerance", () => {
    expect(critCellTitle(fs(142))).toBe("Crit rate 142% raw — capped at 100% in-game, 40% wasted over the 102% tolerance");
  });

  it("within the buffer up to 102", () => {
    expect(critCellTitle(fs(101.5))).toBe("Crit rate 101.5% raw — capped at 100% in-game, within the 2% buffer");
  });

  it("no tooltip when not over", () => {
    expect(critCellTitle(fs(95))).toBeUndefined();
  });
});

describe("computeColumnRanges", () => {
  const build = (critRateUncapped: number): SolveBuild =>
    ({ finalStats: fs(critRateUncapped), ratings: {}, score: 0, cp: null }) as unknown as SolveBuild;
  const critCol = SOLVER_STATS.filter((s) => s.key === "critRate" || s.key === "pen");

  it("shades crit on the raw sum, past the sheet's 100", () => {
    const r = computeColumnRanges([build(142), build(100), build(80)], critCol);
    expect(r.stat.critRate).toEqual({ min: 80, max: 142 });
    expect(r.stat.pen).toEqual({ min: 0, max: 0 });
  });
});
