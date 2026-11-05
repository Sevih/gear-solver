import { describe, expect, it } from "vitest";
import {
  INITIAL_FILTERS,
  buildSolveFilters,
  solverFiltersReducer,
  type SetChipReach,
  type SolverFilters,
} from "../src/lib/solver/builderFilters.js";
import type { RecoFilterPatch } from "../src/lib/reco/translateReco.js";
import { cloneFilters } from "../src/lib/storage/heroFilters.js";

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
    expect(solverFiltersReducer(dirty, { type: "resetAll", to: INITIAL_FILTERS })).toBe(INITIAL_FILTERS);
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

describe("solverFiltersReducer — main exclusions", () => {
  const exclude = (s: SolverFilters, stat: string) =>
    solverFiltersReducer(s, { type: "toggleMainExclude", slot: "talisman", stat });
  const pick = (s: SolverFilters, stat: string) =>
    solverFiltersReducer(s, { type: "toggleMainPick", slot: "talisman", stat });

  it("toggleMainExclude sets then clears the exclusion", () => {
    const s1 = exclude(INITIAL_FILTERS, "atkPct");
    expect(s1.mainExcludes).toEqual({ talisman: { atkPct: true } });
    expect(exclude(s1, "atkPct").mainExcludes).toEqual({ talisman: {} });
  });

  it("excluding an acceptable main clears its acceptance", () => {
    const s1 = exclude(pick(INITIAL_FILTERS, "atkPct"), "atkPct");
    expect(s1.mainPicks.talisman).toEqual({});
    expect(s1.mainExcludes.talisman).toEqual({ atkPct: true });
  });

  it("accepting an excluded main clears its exclusion", () => {
    const s1 = pick(exclude(INITIAL_FILTERS, "atkPct"), "atkPct");
    expect(s1.mainPicks.talisman).toEqual({ atkPct: true });
    expect(s1.mainExcludes.talisman).toEqual({});
  });

  it("other stats and slots are left alone", () => {
    const state: SolverFilters = {
      ...INITIAL_FILTERS,
      mainPicks: { talisman: { hpPct: true }, weapon: { atkPct: true } },
      mainExcludes: { accessory: { pen: true } },
    };
    const s1 = exclude(state, "atkPct");
    expect(s1.mainPicks).toEqual({ talisman: { hpPct: true }, weapon: { atkPct: true } });
    expect(s1.mainExcludes).toEqual({ accessory: { pen: true }, talisman: { atkPct: true } });
  });

  it("a reco overlay keeps the exclusions", () => {
    const state: SolverFilters = { ...INITIAL_FILTERS, mainExcludes: { weapon: { atkPct: true } } };
    const next = solverFiltersReducer(state, { type: "mergePreset", patch: patch({ mainPicks: { weapon: { critDmg: true } } }) });
    expect(next.mainExcludes).toEqual({ weapon: { atkPct: true } });
  });

  it("cloneFilters copies the exclusions; a filter stored without the field gets {}", () => {
    const state: SolverFilters = { ...INITIAL_FILTERS, mainExcludes: { talisman: { atkPct: true } } };
    expect(cloneFilters(state).mainExcludes).toEqual({ talisman: { atkPct: true } });
    const { mainExcludes: _omit, ...legacy } = INITIAL_FILTERS;
    const restored = cloneFilters(legacy as SolverFilters);
    expect(restored.mainExcludes).toEqual({});
    // …and the reducer works on it.
    expect(exclude(restored, "atkPct").mainExcludes).toEqual({ talisman: { atkPct: true } });
  });
});

describe("solverFiltersReducer — +15 passive picks", () => {
  const DS = "Increased DMG within Dimensional Singularity";
  const cycle = (s: SolverFilters, group: "weapon" | "accessory" | "armor" = "weapon") =>
    solverFiltersReducer(s, { type: "cyclePassivePick", group, family: DS });

  it("starts empty in the three groups", () => {
    expect(INITIAL_FILTERS.passivePicks).toEqual({ weapon: {}, accessory: {}, armor: {} });
  });

  it("cycles off → required at C → excluded → off", () => {
    const s1 = cycle(INITIAL_FILTERS);
    expect(s1.passivePicks.weapon).toEqual({ [DS]: { state: "required", minGrade: "C" } });
    const s2 = cycle(s1);
    expect(s2.passivePicks.weapon).toEqual({ [DS]: { state: "excluded", minGrade: "C" } });
    expect(cycle(s2).passivePicks.weapon).toEqual({});
    // The other groups are left alone, the initial state untouched.
    expect(s1.passivePicks.armor).toEqual({});
    expect(INITIAL_FILTERS.passivePicks.weapon).toEqual({});
  });

  it("setPassiveMinGrade sets a required family's grade, no-op otherwise; a cycle back resets it to C", () => {
    const req = cycle(INITIAL_FILTERS, "armor");
    const graded = solverFiltersReducer(req, { type: "setPassiveMinGrade", group: "armor", family: DS, grade: "A" });
    expect(graded.passivePicks.armor[DS]).toEqual({ state: "required", minGrade: "A" });
    const excluded = cycle(graded, "armor");
    expect(excluded.passivePicks.armor[DS]).toEqual({ state: "excluded", minGrade: "C" });
    expect(solverFiltersReducer(excluded, { type: "setPassiveMinGrade", group: "armor", family: DS, grade: "S" })).toBe(excluded);
    expect(solverFiltersReducer(INITIAL_FILTERS, { type: "setPassiveMinGrade", group: "weapon", family: DS, grade: "S" })).toBe(INITIAL_FILTERS);
  });

  it("buildSolveFilters passes the picks through; a reco overlay keeps them", () => {
    const graded = solverFiltersReducer(cycle(INITIAL_FILTERS), { type: "setPassiveMinGrade", group: "weapon", family: DS, grade: "S+" });
    expect(buildSolveFilters(graded).passivePicks).toEqual({ weapon: { [DS]: { state: "required", minGrade: "S+" } }, accessory: {}, armor: {} });
    expect(solverFiltersReducer(graded, { type: "mergePreset", patch: patch() }).passivePicks).toBe(graded.passivePicks);
  });

  it("cloneFilters gives a filter stored without the field no pick", () => {
    const { passivePicks: _omit, ...legacy } = INITIAL_FILTERS;
    expect(cloneFilters(legacy as SolverFilters).passivePicks).toEqual({ weapon: {}, accessory: {}, armor: {} });
  });
});
