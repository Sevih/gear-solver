import { describe, expect, it } from "vitest";
import type { SolverFilters } from "../src/screens/BuilderScreen.js";
import { filtersForHero, snapshotOnHeroSwitch, type HeroFiltersMap } from "../src/lib/storage/heroFilters.js";

const DEFAULTS = { topPct: 60, excludedHeroes: new Set<string>() } as unknown as SolverFilters;
const TUNED_X = { topPct: 20, excludedHeroes: new Set(["z"]) } as unknown as SolverFilters;

describe("per-hero filter memory — initial hero", () => {
  it("the Builder opens on the initial hero's remembered filters", () => {
    const f = filtersForHero({ X: TUNED_X }, "X", DEFAULTS);
    expect(f.topPct).toBe(20);
    expect(f.excludedHeroes).not.toBe(TUNED_X.excludedHeroes); // cloned, not aliased
  });

  it("falls back to the defaults for an unknown or absent hero", () => {
    expect(filtersForHero({ X: TUNED_X }, "Y", DEFAULTS)).toBe(DEFAULTS);
    expect(filtersForHero({ X: TUNED_X }, null, DEFAULTS)).toBe(DEFAULTS);
  });
});

describe("per-hero filter memory — hero switch", () => {
  it("no snapshot while the hero is unchanged (mount / StrictMode re-run)", () => {
    // Before the fix StrictMode's second pass snapshotted the live (default)
    // filters over X's remembered set.
    expect(snapshotOnHeroSwitch({ X: TUNED_X }, "X", "X", DEFAULTS)).toBeNull();
  });

  it("Optimize → X, then switch to Y and back: X keeps its filters", () => {
    let map: HeroFiltersMap = { X: TUNED_X };
    const live = filtersForHero(map, "X", DEFAULTS); // mount on X
    map = snapshotOnHeroSwitch(map, "X", "Y", live)!; // X → Y
    expect(filtersForHero(map, "X", DEFAULTS).topPct).toBe(20);
  });

  it("switching from no hero stores nothing", () => {
    const map: HeroFiltersMap = { X: TUNED_X };
    expect(snapshotOnHeroSwitch(map, null, "X", DEFAULTS)).toBe(map);
  });
});
