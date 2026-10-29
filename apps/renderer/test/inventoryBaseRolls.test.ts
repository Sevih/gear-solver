// Inventory Base rolls filter (screens/inventory/filters.ts): the base stages
// of the sub lines sorted best first, padded to 4, compared line by line to a
// pattern with one operator, X = any — from the wire (`BaseLevel`), reforges
// ignored.
import { describe, expect, it } from "vitest";
import { parseGearPiece, type RawItem } from "@gear-solver/core";
import { toUiPiece, type UiPiece } from "../src/design/adapter.js";
import {
  FILTER_CODEC, activeFilterCount, baseRollPattern, emptyFilters, matchesFilters, type BaseRollsFilter, type FilterState,
} from "../src/screens/inventory/filters.js";

/** A wire item whose sub lines carry these base stages (BaseLevel = stage - 1)
 *  plus optional reforge procs on top (Level = BaseLevel + reforges). */
const item = (stages: number[], reforges: number[] = []): RawItem => ({
  ItemUID: "1", CharUID: "0", ItemID: 0, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0,
  SelectSubOptionNum: 0, SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [],
  SubOptionList: stages.map((st, i) => ({ OptionID: 160001 + i, BaseLevel: st - 1, Level: st - 1 + (reforges[i] ?? 0) })),
} as RawItem);
const ui = (stages: number[], reforges?: number[]) => toUiPiece(parseGearPiece(item(stages, reforges)));

const withBase = (op: BaseRollsFilter["op"], lines: BaseRollsFilter["lines"], not = false): FilterState =>
  ({ ...emptyFilters(), baseRolls: { op, lines, not } });
/** A gem-bearing piece: no rolled subs, five gem slots. */
const gemPiece = (slot: "talisman" | "exclusive"): UiPiece => ({
  ...ui([]), slot, gemSlots: Array.from({ length: 5 }, () => ({ unlocked: true, gem: null })),
});
const X = null;

describe("baseRollPattern", () => {
  it("sorts the wire lines best first: 1/3/3/3 reads 3/3/3/1", () => {
    expect(baseRollPattern(ui([1, 3, 3, 3]))).toEqual([3, 3, 3, 1]);
  });

  it("pads a 3-line piece with a 0 fourth line, a piece without subs is 0/0/0/0", () => {
    expect(baseRollPattern(ui([2, 3, 1]))).toEqual([3, 2, 1, 0]);
    expect(baseRollPattern(ui([]))).toEqual([0, 0, 0, 0]);
  });

  it("ignores reforges: a base 2 reforged to 4 stays 2", () => {
    expect(baseRollPattern(ui([2, 1, 1, 1], [2, 0, 0, 0]))).toEqual([2, 1, 1, 1]);
  });
});

describe("matchesFilters — Base rolls", () => {
  it("< 2-2-2-2: every line under 2, never a 3 or a 4", () => {
    const f = withBase("lt", [2, 2, 2, 2]);
    expect(matchesFilters(ui([3, 1, 3, 1]), f)).toBe(false);
    expect(matchesFilters(ui([2, 2, 2, 2]), f)).toBe(false);
    expect(matchesFilters(ui([1, 1, 1, 1]), f)).toBe(true);
  });

  it("≤ 2-2-2-2 keeps 2/2/2/2", () => {
    expect(matchesFilters(ui([2, 2, 2, 2]), withBase("lte", [2, 2, 2, 2]))).toBe(true);
    expect(matchesFilters(ui([3, 2, 2, 2]), withBase("lte", [2, 2, 2, 2]))).toBe(false);
  });

  it("≥ 4-3-X-X: best line 4, second at least 3, the rest free", () => {
    const f = withBase("gte", [4, 3, X, X]);
    expect(matchesFilters(ui([4, 3, 1]), f)).toBe(true);
    expect(matchesFilters(ui([4, 4, 4, 4]), f)).toBe(true);
    // sorted best first: 3/4/1/1 reads 4/3/1/1
    expect(matchesFilters(ui([3, 4, 1, 1]), f)).toBe(true);
    expect(matchesFilters(ui([3, 3, 3, 3]), f)).toBe(false);
    expect(matchesFilters(ui([4, 2, 2, 2]), f)).toBe(false);
  });

  it("= 3-3-3-1: exactly that pattern, a 3-line piece's 4th line is 0", () => {
    const f = withBase("eq", [3, 3, 3, 1]);
    expect(matchesFilters(ui([1, 3, 3, 3]), f)).toBe(true);
    expect(matchesFilters(ui([3, 3, 3]), f)).toBe(false);
    expect(matchesFilters(ui([3, 3, 3, 2]), f)).toBe(false);
    expect(matchesFilters(ui([4, 3, 3, 1]), f)).toBe(false);
  });

  it("> and a 0 line: < 0 never passes, ≤ 0 passes at 0 only", () => {
    expect(matchesFilters(ui([4, 3, 3, 2]), withBase("gt", [3, X, X, X]))).toBe(true);
    expect(matchesFilters(ui([3, 3, 3, 3]), withBase("gt", [3, X, X, X]))).toBe(false);
    expect(matchesFilters(ui([1, 1, 1]), withBase("lt", [X, X, X, 0]))).toBe(false);
    expect(matchesFilters(ui([1, 1, 1]), withBase("lte", [X, X, X, 0]))).toBe(true);
    expect(matchesFilters(ui([1, 1, 1, 1]), withBase("lte", [X, X, X, 0]))).toBe(false);
  });

  it("reforge doesn't lift a line over the pattern", () => {
    expect(matchesFilters(ui([3, 3, 2, 1], [0, 0, 2, 0]), withBase("gte", [3, 3, 3, X]))).toBe(false);
  });

  it("≥ X-X-X-X is inactive and not counted; one fixed line counts", () => {
    expect(matchesFilters(ui([]), withBase("gte", [X, X, X, X]))).toBe(true);
    expect(activeFilterCount(withBase("lt", [X, X, X, X]))).toBe(0);
    expect(activeFilterCount(withBase("gte", [X, X, 0, X]))).toBe(1);
    expect(activeFilterCount(emptyFilters())).toBe(0);
  });
});

describe("matchesFilters — Base rolls, not and gem pieces", () => {
  it("less than 2/2/2/2 keeps neither a talisman nor an EE", () => {
    const f = withBase("lt", [2, 2, 2, 2]);
    expect(matchesFilters(gemPiece("talisman"), f)).toBe(false);
    expect(matchesFilters(gemPiece("exclusive"), f)).toBe(false);
  });

  it("not + at least 2/2/2/2 keeps neither, the exclusion comes before the inversion", () => {
    const f = withBase("gte", [2, 2, 2, 2], true);
    expect(matchesFilters(gemPiece("talisman"), f)).toBe(false);
    expect(matchesFilters(gemPiece("exclusive"), f)).toBe(false);
    expect(matchesFilters(ui([2, 2, 2, 1]), f)).toBe(true);
  });

  it("an inactive pattern still shows the gem pieces", () => {
    expect(matchesFilters(gemPiece("talisman"), withBase("lt", [X, X, X, X], true))).toBe(true);
  });

  it("not + at least 3/3/3/X keeps a 3-2-2-1 and rejects a 3-3-3-0", () => {
    const f = withBase("gte", [3, 3, 3, X], true);
    expect(matchesFilters(ui([3, 2, 2, 1]), f)).toBe(true);
    expect(matchesFilters(ui([3, 3, 3]), f)).toBe(false);
    // less than 3/3/3/X would drop the 3-2-2-1
    expect(matchesFilters(ui([3, 2, 2, 1]), withBase("lt", [3, 3, 3, X]))).toBe(false);
  });
});

describe("matchesFilters — +0 / T0 / Not reforged", () => {
  const base = ui([2, 2, 2, 2]);
  it("+0 only rejects a +3 piece", () => {
    const f = { ...emptyFilters(), enhanceZero: true };
    expect(matchesFilters({ ...base, enhance: 0 }, f)).toBe(true);
    expect(matchesFilters({ ...base, enhance: 3 }, f)).toBe(false);
  });

  it("T0 only rejects bt 1", () => {
    const f = { ...emptyFilters(), breakthroughZero: true };
    expect(matchesFilters({ ...base, bt: 0 }, f)).toBe(true);
    expect(matchesFilters({ ...base, bt: 1 }, f)).toBe(false);
  });

  it("Not reforged rejects reforge.n 1", () => {
    const f = { ...emptyFilters(), notReforged: true };
    expect(matchesFilters({ ...base, reforge: { n: 0, max: 5 } }, f)).toBe(true);
    expect(matchesFilters({ ...base, reforge: { n: 1, max: 5 } }, f)).toBe(false);
  });

  it("activeFilterCount counts each box", () => {
    expect(activeFilterCount({ ...emptyFilters(), enhanceZero: true })).toBe(1);
    expect(activeFilterCount({ ...emptyFilters(), enhanceZero: true, breakthroughZero: true })).toBe(2);
    expect(activeFilterCount({ ...emptyFilters(), enhanceZero: true, breakthroughZero: true, notReforged: true })).toBe(3);
  });
});

describe("FILTER_CODEC — Base rolls", () => {
  it("round-trips the operator, the lines and not, X included", () => {
    const f = withBase("lte", [4, X, 0, 2]);
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(f)).baseRolls).toEqual(f.baseRolls);
    const g = withBase("gte", [3, 3, 3, X], true);
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(g)).baseRolls).toEqual(g.baseRolls);
  });

  /** A stored state in G62's shape (`min` + `mode`). */
  const g62 = (min: number[], mode: string) =>
    FILTER_CODEC.deserialize(JSON.stringify({ ...JSON.parse(FILTER_CODEC.serialize!(emptyFilters())), baseRolls: { min, mode } })).baseRolls;

  it("migrates G62's at least: gte, a 0 minimum becomes X", () => {
    expect(g62([3, 3, 3, 0], "atLeast")).toEqual({ op: "gte", lines: [3, 3, 3, X], not: false });
  });

  it("migrates G62's worse than: lt, a 0 minimum becomes X", () => {
    expect(g62([2, 2, 0, 0], "below")).toEqual({ op: "lt", lines: [2, 2, X, X], not: false });
    expect(g62([0, 0, 0, 0], "below")).toEqual({ op: "lt", lines: [X, X, X, X], not: false });
  });

  it("writes the new shape only", () => {
    const stored = JSON.parse(FILTER_CODEC.serialize!(FILTER_CODEC.deserialize(JSON.stringify({ baseRolls: { min: [3, 0, 0, 0], mode: "atLeast" } }))));
    expect(stored.baseRolls).toEqual({ op: "gte", lines: [3, null, null, null], not: false });
  });

  it("an older stored state without baseRolls reads the inactive default", () => {
    const { baseRolls: _, ...old } = emptyFilters();
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(old as FilterState)).baseRolls).toEqual({ op: "gte", lines: [X, X, X, X], not: false });
  });

  it("a v3 state stored before not and the three boxes reads them false", () => {
    const stored = JSON.parse(FILTER_CODEC.serialize!(emptyFilters()));
    delete stored.enhanceZero;
    delete stored.breakthroughZero;
    delete stored.notReforged;
    stored.baseRolls = { op: "gte", lines: [3, 3, 3, null] };
    const f = FILTER_CODEC.deserialize(JSON.stringify(stored));
    expect(f.enhanceZero).toBe(false);
    expect(f.breakthroughZero).toBe(false);
    expect(f.notReforged).toBe(false);
    expect(f.baseRolls).toEqual({ op: "gte", lines: [3, 3, 3, X], not: false });
  });
});
