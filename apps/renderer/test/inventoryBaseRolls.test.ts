// Inventory Base rolls filter (screens/inventory/filters.ts): the base stages
// of the sub lines sorted best first, padded to 4, against "at least" or
// "worse than" a pattern — from the wire (`BaseLevel`), reforges ignored.
import { describe, expect, it } from "vitest";
import { parseGearPiece, type RawItem } from "@gear-solver/core";
import { toUiPiece } from "../src/design/adapter.js";
import {
  FILTER_CODEC, activeFilterCount, baseRollPattern, emptyFilters, matchesFilters, type FilterState,
} from "../src/screens/inventory/filters.js";

/** A wire item whose sub lines carry these base stages (BaseLevel = stage - 1)
 *  plus optional reforge procs on top (Level = BaseLevel + reforges). */
const item = (stages: number[], reforges: number[] = []): RawItem => ({
  ItemUID: "1", CharUID: "0", ItemID: 0, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0,
  SelectSubOptionNum: 0, SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [],
  SubOptionList: stages.map((st, i) => ({ OptionID: 160001 + i, BaseLevel: st - 1, Level: st - 1 + (reforges[i] ?? 0) })),
} as RawItem);
const ui = (stages: number[], reforges?: number[]) => toUiPiece(parseGearPiece(item(stages, reforges)));

const withBase = (min: [number, number, number, number], mode: "atLeast" | "below"): FilterState =>
  ({ ...emptyFilters(), baseRolls: { min, mode } });
const AT_LEAST_3330 = withBase([3, 3, 3, 0], "atLeast");
const BELOW_3330 = withBase([3, 3, 3, 0], "below");

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
  it("at least 3/3/3/0: 3/3/3/1 passes, 3/3/2/2 doesn't", () => {
    expect(matchesFilters(ui([3, 3, 3, 1]), AT_LEAST_3330)).toBe(true);
    expect(matchesFilters(ui([3, 3, 2, 2]), AT_LEAST_3330)).toBe(false);
  });

  it("worse than 3/3/3/0: the complement", () => {
    expect(matchesFilters(ui([3, 3, 3, 1]), BELOW_3330)).toBe(false);
    expect(matchesFilters(ui([3, 3, 2, 2]), BELOW_3330)).toBe(true);
  });

  it("the 4th line of a 3-line piece is 0", () => {
    expect(matchesFilters(ui([3, 3, 3]), AT_LEAST_3330)).toBe(true);
    expect(matchesFilters(ui([3, 3, 3]), withBase([3, 3, 3, 1], "atLeast"))).toBe(false);
  });

  it("reforge doesn't lift a line over the pattern", () => {
    expect(matchesFilters(ui([3, 3, 2, 1], [0, 0, 2, 0]), AT_LEAST_3330)).toBe(false);
    expect(matchesFilters(ui([3, 3, 2, 1], [0, 0, 2, 0]), BELOW_3330)).toBe(true);
  });

  it("all-zero pattern is inactive in both modes and not counted", () => {
    expect(matchesFilters(ui([1, 1, 1, 1]), withBase([0, 0, 0, 0], "below"))).toBe(true);
    expect(activeFilterCount(withBase([0, 0, 0, 0], "below"))).toBe(0);
    expect(activeFilterCount(AT_LEAST_3330)).toBe(1);
  });
});

describe("FILTER_CODEC — Base rolls", () => {
  it("round-trips the pattern and the mode", () => {
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(BELOW_3330)).baseRolls).toEqual(BELOW_3330.baseRolls);
  });

  it("an older stored state without baseRolls reads the inactive default", () => {
    const { baseRolls: _, ...old } = emptyFilters();
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(old as FilterState)).baseRolls).toEqual({ min: [0, 0, 0, 0], mode: "atLeast" });
  });
});
