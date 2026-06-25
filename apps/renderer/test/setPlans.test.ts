import { describe, expect, it } from "vitest";
import { planFeasible, planSetIds, setPicksToPlans, setsFeasible } from "../src/lib/solver/setPlans.js";
import type { SetPlan } from "../src/lib/solver/types.js";

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe("setPicksToPlans — chip expansion", () => {
  it("no required sets → no plan (anything goes)", () => {
    expect(setPicksToPlans({})).toEqual({ setPlans: [], excludedSets: [] });
    expect(setPicksToPlans({ A: "off" })).toEqual({ setPlans: [], excludedSets: [] });
  });

  it("a single required set → one plan with its cond", () => {
    expect(setPicksToPlans({ A: "req-4pc" })).toEqual({ setPlans: [[{ setId: "A", count: 4 }]], excludedSets: [] });
    expect(setPicksToPlans({ A: "req-2pc" })).toEqual({ setPlans: [[{ setId: "A", count: 2 }]], excludedSets: [] });
  });

  it("multiple required sets AND into a SINGLE plan (legacy parity)", () => {
    const { setPlans, excludedSets } = setPicksToPlans({ A: "req-2pc", B: "req-4pc" });
    expect(setPlans).toHaveLength(1);
    expect(setPlans[0]).toEqual([{ setId: "A", count: 2 }, { setId: "B", count: 4 }]);
    expect(excludedSets).toEqual([]);
  });

  it("excluded sets are orthogonal to plans", () => {
    expect(setPicksToPlans({ A: "req-4pc", X: "excluded", Y: "excluded" }))
      .toEqual({ setPlans: [[{ setId: "A", count: 4 }]], excludedSets: ["X", "Y"] });
  });
});

describe("planSetIds", () => {
  it("unions every setId across all plans", () => {
    const plans: SetPlan[] = [[{ setId: "A", count: 4 }], [{ setId: "B", count: 2 }, { setId: "C", count: 2 }]];
    expect(planSetIds(plans)).toEqual(new Set(["A", "B", "C"]));
  });
  it("empty for no plans", () => {
    expect(planSetIds([])).toEqual(new Set());
  });
});

describe("planFeasible", () => {
  const plan: SetPlan = [{ setId: "A", count: 4 }];
  it("feasible when the missing pieces fit the remaining slots", () => {
    expect(planFeasible(plan, counts({}), 4)).toBe(true);   // need 4, 4 left
    expect(planFeasible(plan, counts({ A: 2 }), 2)).toBe(true); // need 2, 2 left
  });
  it("infeasible when missing pieces exceed remaining slots", () => {
    expect(planFeasible(plan, counts({}), 3)).toBe(false);  // need 4, only 3 left
  });
  it("a multi-cond plan sums its needs (one piece can't cover two sets)", () => {
    const multi: SetPlan = [{ setId: "A", count: 2 }, { setId: "B", count: 2 }];
    expect(planFeasible(multi, counts({}), 3)).toBe(false); // need 2+2=4 > 3
    expect(planFeasible(multi, counts({ A: 2 }), 2)).toBe(true); // need 0+2=2 ≤ 2
  });
});

describe("setsFeasible — OR over plans + leaf validation", () => {
  it("empty plans → always feasible", () => {
    expect(setsFeasible([], counts({}), 0)).toBe(true);
  });

  it("OR: feasible while at least one plan is reachable, pruned only when none", () => {
    const plans: SetPlan[] = [[{ setId: "A", count: 4 }], [{ setId: "B", count: 2 }, { setId: "C", count: 2 }]];
    // 3 slots left, no pieces yet: plan A needs 4 (>3, dead) but plan B+C
    // needs 4 (>3, dead) → neither reachable → prune.
    expect(setsFeasible(plans, counts({}), 3)).toBe(false);
    // 4 slots left: both reachable.
    expect(setsFeasible(plans, counts({}), 4)).toBe(true);
    // plan A dead (need 4 in 2 slots) but B+C alive (have 2 B, need 2 C in 2).
    expect(setsFeasible(plans, counts({ B: 2 }), 2)).toBe(true);
  });

  it("at remainingSlots 0 it is exactly the build-valid test (satisfied)", () => {
    const plans: SetPlan[] = [[{ setId: "A", count: 4 }], [{ setId: "B", count: 2 }, { setId: "C", count: 2 }]];
    expect(setsFeasible(plans, counts({ A: 4 }), 0)).toBe(true);          // plan A met
    expect(setsFeasible(plans, counts({ B: 2, C: 2 }), 0)).toBe(true);    // plan B+C met
    expect(setsFeasible(plans, counts({ A: 3 }), 0)).toBe(false);         // 3/4 A, B+C absent
    expect(setsFeasible(plans, counts({ B: 2, C: 1 }), 0)).toBe(false);   // partial B+C
  });

  it("legacy mono-plan parity: a single req-4pc plan validates like before", () => {
    const { setPlans } = setPicksToPlans({ A: "req-4pc" });
    expect(setsFeasible(setPlans, counts({ A: 4 }), 0)).toBe(true);
    expect(setsFeasible(setPlans, counts({ A: 3 }), 0)).toBe(false);
    expect(setsFeasible(setPlans, counts({ A: 1 }), 3)).toBe(true);  // need 3 in 3 → still alive
    expect(setsFeasible(setPlans, counts({ A: 0 }), 3)).toBe(false); // need 4 in 3 → dead
  });
});
