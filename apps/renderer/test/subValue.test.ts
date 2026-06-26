import { describe, expect, it } from "vitest";
import { flatVsPctTick } from "../src/lib/subValue.js";

// 6★ reference ticks (sub-ticks.json): ATK 40 flat / 4%, HP 73 flat / 3%.
describe("flatVsPctTick", () => {
  it("% wins above the breakeven base (ATK 40 vs 4%)", () => {
    const r = flatVsPctTick(2000, 40, 4);
    expect(r.pctFlatEquiv).toBe(80); // 2000 × 4%
    expect(r.winner).toBe("pct");
    expect(r.breakeven).toBe(1000); // 40 × 100 / 4
  });

  it("flat wins below the breakeven base", () => {
    const r = flatVsPctTick(500, 40, 4);
    expect(r.pctFlatEquiv).toBe(20);
    expect(r.winner).toBe("flat");
  });

  it("ties exactly at the breakeven base", () => {
    expect(flatVsPctTick(1000, 40, 4).winner).toBe("tie");
  });

  it("HP breakeven ≈ 2433 (73 vs 3%)", () => {
    expect(flatVsPctTick(1, 73, 3).breakeven).toBeCloseTo(2433.33, 1);
    expect(flatVsPctTick(2433, 73, 3).winner).toBe("flat"); // 72.99 < 73
    expect(flatVsPctTick(2434, 73, 3).winner).toBe("pct"); // 73.02 > 73
  });

  it("guards a zero %-tick (no breakeven)", () => {
    expect(flatVsPctTick(3000, 40, 0).breakeven).toBe(Infinity);
    expect(flatVsPctTick(3000, 40, 0).winner).toBe("flat");
  });
});
