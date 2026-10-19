import { describe, expect, it } from "vitest";
import {
  INITIAL_FILTERS,
  solverFiltersReducer,
  type SetChipReach,
  type SolverFilters,
} from "../src/lib/solver/builderFilters.js";
import type { RecoFilterPatch } from "../src/lib/reco/translateReco.js";

const FULL_REACH: SetChipReach = { has2pc: true, has4pc: true, canForm2pc: true, canForm4pc: true };

const patch = (over: Partial<RecoFilterPatch> = {}): RecoFilterPatch => ({
  mainPicks: {},
  weaponEffectPicks: {},
  accessoryEffectPicks: {},
  talismanEffectPicks: {},
  setPlans: [],
  priority: {},
  ...over,
});

describe("solverFiltersReducer — mergePreset", () => {
  it("a set excluded by the user then required by the reco is no longer excluded", () => {
    const state: SolverFilters = { ...INITIAL_FILTERS, excludedSets: ["A", "X"] };
    const next = solverFiltersReducer(state, {
      type: "mergePreset",
      patch: patch({ setPlans: [[{ setId: "A", count: 4 }], [{ setId: "B", count: 2 }]] }),
    });
    expect(next.setPlans).toEqual([[{ setId: "A", count: 4 }], [{ setId: "B", count: 2 }]]);
    // X isn't in any plan → the user's exclusion stays.
    expect(next.excludedSets).toEqual(["X"]);
  });

  it("keeps the main picks of slots the reco doesn't specify, overlays the others", () => {
    const state: SolverFilters = {
      ...INITIAL_FILTERS,
      mainPicks: { talisman: { atk_pct: true }, weapon: { def_pct: true } },
    };
    const next = solverFiltersReducer(state, {
      type: "mergePreset",
      patch: patch({ mainPicks: { weapon: { chc: true } } }),
    });
    expect(next.mainPicks).toEqual({ talisman: { atk_pct: true }, weapon: { chc: true } });
  });

  it("a reco without set plans leaves one empty plan and every exclusion", () => {
    const state: SolverFilters = { ...INITIAL_FILTERS, excludedSets: ["X"] };
    const next = solverFiltersReducer(state, { type: "mergePreset", patch: patch() });
    expect(next.setPlans).toEqual([[]]);
    expect(next.excludedSets).toEqual(["X"]);
  });
});

describe("solverFiltersReducer — cycleSetInPlan", () => {
  const cycle = (s: SolverFilters, setId: string, reach: SetChipReach = FULL_REACH) =>
    solverFiltersReducer(s, { type: "cycleSetInPlan", planIdx: 0, setId, reach });

  it("cycles 0 → 2 → 4 → 0", () => {
    const s1 = cycle(INITIAL_FILTERS, "A");
    expect(s1.setPlans).toEqual([[{ setId: "A", count: 2 }]]);
    const s2 = cycle(s1, "A");
    expect(s2.setPlans).toEqual([[{ setId: "A", count: 4 }]]);
    const s3 = cycle(s2, "A");
    expect(s3.setPlans).toEqual([[]]);
  });

  it("skips a step the inventory can't form", () => {
    const only4: SetChipReach = { ...FULL_REACH, has2pc: false };
    expect(cycle(INITIAL_FILTERS, "A", only4).setPlans).toEqual([[{ setId: "A", count: 4 }]]);
    const only2: SetChipReach = { ...FULL_REACH, canForm4pc: false };
    const s1 = cycle(INITIAL_FILTERS, "A", only2);
    expect(s1.setPlans).toEqual([[{ setId: "A", count: 2 }]]);
    expect(cycle(s1, "A", only2).setPlans).toEqual([[]]);
  });

  it("skips a step that would overflow the 4 armor slots", () => {
    const twoSets = cycle(cycle(INITIAL_FILTERS, "A"), "B");
    expect(twoSets.setPlans).toEqual([[{ setId: "A", count: 2 }, { setId: "B", count: 2 }]]);
    // A + B already use the 4 slots: C stays off, A can't go 4pc (→ off).
    expect(cycle(twoSets, "C").setPlans).toEqual(twoSets.setPlans);
    expect(cycle(twoSets, "A").setPlans).toEqual([[{ setId: "B", count: 2 }]]);
  });
});

describe("solverFiltersReducer — resetAll / loadPreset", () => {
  it("resetAll returns the initial filters", () => {
    const dirty: SolverFilters = {
      ...INITIAL_FILTERS,
      topPct: 10,
      excludedSets: ["X"],
      excludedHeroes: new Set(["h1"]),
      statFilters: { atk: { min: 1000 } },
    };
    expect(solverFiltersReducer(dirty, { type: "resetAll" })).toBe(INITIAL_FILTERS);
  });

  it("loadPreset replaces the whole state", () => {
    const preset: SolverFilters = {
      ...INITIAL_FILTERS,
      topPct: 25,
      setPlans: [[{ setId: "A", count: 4 }]],
      excludedSets: ["X"],
      excludedHeroes: new Set(["h2"]),
      minQuality: "good",
    };
    const state: SolverFilters = { ...INITIAL_FILTERS, topPct: 90, excludedSets: ["Y"] };
    expect(solverFiltersReducer(state, { type: "loadPreset", filters: preset })).toBe(preset);
  });
});
