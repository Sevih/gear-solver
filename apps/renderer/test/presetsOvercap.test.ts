/**
 * Wasted stat caps — `overcapOf` (the rule shared by the Builds tab's advice
 * and the Presets tab) and `presetOvercap` (a preset's hero line: warning tone
 * from `OVERCAP_WARN_PTS`, the proposed EE gems' share).
 */
import { describe, expect, it } from "vitest";
import { overcapOf, overcapText } from "../src/lib/overcap.js";
import { OVERCAP_WARN_PTS, presetOvercap, type PresetEval } from "../src/lib/presets/evaluate.js";
import type { FinalStats } from "../src/lib/composeBuild.js";

const stats = (critRate: number, pen: number, critRateUncapped?: number) => ({ critRate, pen, critRateUncapped });

const evalOf = (critRateUncapped: number, pen = 0): PresetEval => ({
  finalStats: { critRate: Math.min(100, critRateUncapped), critRateUncapped, pen } as FinalStats,
  ratings: {} as PresetEval["ratings"],
  score: null,
});

describe("overcapOf", () => {
  it("nothing under the caps", () => {
    expect(overcapOf(stats(85, 60, 85))).toEqual([]);
  });

  it("nothing at 102 crit exactly (tolerance) nor at 100 pen", () => {
    expect(overcapOf(stats(100, 100, 102))).toEqual([]);
  });

  it("reads the raw crit sum past the sheet's 100 bound", () => {
    const [o] = overcapOf(stats(100, 0, 142));
    expect(o).toEqual({ key: "critRate", label: "Crit rate", value: 142, cap: 102, waste: 40 });
    expect(overcapText(o!)).toBe("Crit rate 142% — 40% wasted over the 102% cap");
  });

  it("falls back on critRate without the raw sum", () => {
    expect(overcapOf(stats(105, 0)).map((o) => o.waste)).toEqual([3]);
  });

  it("penetration over 100", () => {
    expect(overcapOf(stats(50, 120, 50))).toEqual([{ key: "pen", label: "Penetration", value: 120, cap: 100, waste: 20 }]);
  });

  it("both axes, crit first", () => {
    expect(overcapOf(stats(100, 110.04, 130.5)).map((o) => [o.key, o.waste])).toEqual([["critRate", 28.5], ["pen", 10]]);
  });
});

describe("presetOvercap", () => {
  it("warning tone from OVERCAP_WARN_PTS of waste, the badge alone below", () => {
    expect(presetOvercap(evalOf(102 + OVERCAP_WARN_PTS), null)[0]?.warn).toBe(true);
    expect(presetOvercap(evalOf(102 + OVERCAP_WARN_PTS - 0.1), null)[0]?.warn).toBe(false);
  });

  it("no evaluation → nothing", () => {
    expect(presetOvercap(null, null)).toEqual([]);
  });

  it("flags the proposed EE gems when they add to the overflow", () => {
    expect(presetOvercap(evalOf(142), evalOf(120))[0]?.fromGems).toBe(true);
    expect(presetOvercap(evalOf(142), evalOf(95))[0]?.fromGems).toBe(true);
    expect(presetOvercap(evalOf(142), evalOf(142))[0]?.fromGems).toBe(false);
    // No gem proposed: the line shows the gems as socketed.
    expect(presetOvercap(evalOf(142), null)[0]?.fromGems).toBe(false);
  });
});
