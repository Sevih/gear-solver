/**
 * Best-skill factor (`lib/dmgSkill.ts`) — the explicit fallback contract:
 * missing data → ×1.00 AND flagged, never a silent 0 that would blank the
 * Dmg column. Plus the label the header badge / tooltips show.
 */
import { describe, expect, it } from "vitest";
import { dmgSkillFactor, dmgSkillInfo } from "../src/lib/dmgSkill.js";

describe("dmgSkillFactor", () => {
  it("‰ → multiplier", () => {
    expect(dmgSkillFactor({ slot: "S3", factor: 1670 })).toBeCloseTo(1.67);
    expect(dmgSkillFactor({ slot: "S2", burst: 1, factor: 2392 })).toBeCloseTo(2.392);
    expect(dmgSkillFactor({ slot: "S1", factor: 860 })).toBeCloseTo(0.86); // sub-100% skills exist (Primine S1)
  });

  it("missing / invalid data → ×1 (explicit fallback, never 0)", () => {
    expect(dmgSkillFactor(undefined)).toBe(1);
    expect(dmgSkillFactor(null)).toBe(1);
    expect(dmgSkillFactor({ slot: "S1", factor: 0 })).toBe(1);
    expect(dmgSkillFactor({ slot: "S1", factor: -5 })).toBe(1);
  });
});

describe("dmgSkillInfo", () => {
  it("labels the winning slot, burst state when any, flags unresolved chains", () => {
    expect(dmgSkillInfo({ slot: "S3", factor: 1670 })).toEqual({ label: "S3", factor: 1.67, missing: false, approx: false });
    expect(dmgSkillInfo({ slot: "S2", burst: 3, factor: 2730 })).toEqual({ label: "S2 B3", factor: 2.73, missing: false, approx: false });
    expect(dmgSkillInfo({ slot: "S1", factor: 1800, unresolvedHits: true })).toEqual({ label: "S1", factor: 1.8, missing: false, approx: true });
  });

  it("missing data → label '—', factor 1, missing=true (the UI warns instead of hiding)", () => {
    expect(dmgSkillInfo(undefined)).toEqual({ label: "—", factor: 1, missing: true, approx: false });
    expect(dmgSkillInfo({ slot: "S1", factor: 0 })).toEqual({ label: "—", factor: 1, missing: true, approx: false });
  });
});
