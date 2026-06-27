/**
 * Hero priority store — the rank model behind the Builder's "Equipped items →
 * ≤ lower priority" scope. Rank 1 = highest priority (smaller number = more
 * important); unranked = lowest. Locks:
 *  - rankOrder: ranked → its integer, unranked → +Infinity (worst);
 *  - isLowerPriority: strict; unranked is lower than any ranked; two unranked
 *    NOT lower; a smaller rank number outranks a bigger one;
 *  - setHeroRank: clears on null, and enforces UNIQUE ranks by swapping the
 *    previous holder to the setter's old rank (or unranked).
 */
import { describe, expect, it } from "vitest";
import { fillUnrankedByOrder, isLowerPriority, moveRankBefore, rankOrder, reorderRank, type HeroPriority } from "../src/lib/storage/heroPriority.js";

describe("rankOrder", () => {
  it("returns the rank for a ranked hero, +Infinity for unranked", () => {
    const m: HeroPriority = { a: 5 };
    expect(rankOrder(m, "a")).toBe(5);
    expect(rankOrder(m, "b")).toBe(Infinity);
  });
});

describe("isLowerPriority", () => {
  const m: HeroPriority = { best: 1, worse: 3 }; // rank 1 = highest priority
  it("ranks unranked below any ranked hero", () => {
    expect(isLowerPriority(m, "unranked", "worse")).toBe(true);   // ∞ > 3
    expect(isLowerPriority(m, "worse", "unranked")).toBe(false);  // 3 > ∞ → no
  });
  it("a bigger rank number is lower priority (rank 1 = best)", () => {
    expect(isLowerPriority(m, "worse", "best")).toBe(true);   // rank 3 lower than rank 1
    expect(isLowerPriority(m, "best", "worse")).toBe(false);  // rank 1 not lower than rank 3
  });
  it("two unranked heroes are not lower than each other (strict)", () => {
    expect(isLowerPriority({}, "x", "y")).toBe(false); // ∞ > ∞ → false
  });
  it("equal ranks are never 'lower' (uniqueness makes this only matter for null)", () => {
    expect(isLowerPriority({ a: 4, b: 4 }, "a", "b")).toBe(false);
  });
});

describe("reorderRank", () => {
  it("ranks a fresh hero at the given position", () => {
    expect(reorderRank({}, "a", 1)).toEqual({ a: 1 });
  });
  it("inserts at a position and renumbers everyone contiguously", () => {
    // a=1, b=2, c=3; put c at position 1 → c,a,b → 1,2,3.
    expect(reorderRank({ a: 1, b: 2, c: 3 }, "c", 1)).toEqual({ c: 1, a: 2, b: 3 });
  });
  it("clamps an out-of-range position to the end", () => {
    expect(reorderRank({ a: 1, b: 2 }, "c", 99)).toEqual({ a: 1, b: 2, c: 3 });
  });
  it("unranks on null and renumbers the rest", () => {
    expect(reorderRank({ a: 1, b: 2, c: 3 }, "b", null)).toEqual({ a: 1, c: 2 });
  });
  it("always stays contiguous 1..N with unique ranks", () => {
    const m = reorderRank({ a: 1, b: 2, c: 3, d: 4 }, "d", 2);
    expect(m).toEqual({ a: 1, d: 2, b: 3, c: 4 });
    expect(new Set(Object.values(m)).size).toBe(4);
  });
  it("never mutates the input map", () => {
    const m: HeroPriority = { a: 1, b: 2 };
    reorderRank(m, "a", 2);
    expect(m).toEqual({ a: 1, b: 2 });
  });
});

describe("moveRankBefore", () => {
  it("inserts the dragged hero immediately before the target", () => {
    // order a,b,c; drag c before a → c,a,b.
    expect(moveRankBefore({ a: 1, b: 2, c: 3 }, "c", "a")).toEqual({ c: 1, a: 2, b: 3 });
  });
  it("dropping on a lower row moves it down (before that row)", () => {
    // order a,b,c; drag a before c → b,a,c.
    expect(moveRankBefore({ a: 1, b: 2, c: 3 }, "a", "c")).toEqual({ b: 1, a: 2, c: 3 });
  });
  it("ranks an unranked hero by dropping it onto a ranked row", () => {
    expect(moveRankBefore({ a: 1, b: 2 }, "x", "b")).toEqual({ a: 1, x: 2, b: 3 });
  });
  it("appends to the end when the target is unranked", () => {
    expect(moveRankBefore({ a: 1 }, "x", "unranked")).toEqual({ a: 1, x: 2 });
  });
  it("is a no-op when dragging onto itself", () => {
    const m = { a: 1, b: 2 };
    expect(moveRankBefore(m, "a", "a")).toBe(m);
  });
});

describe("fillUnrankedByOrder", () => {
  const byCp = ["a", "b", "c", "d"]; // roster in CP-desc order

  it("returns null when everyone is already ranked (skip the write)", () => {
    expect(fillUnrankedByOrder({ a: 1, b: 2, c: 3, d: 4 }, byCp)).toBeNull();
  });
  it("ranks all by the given order when none are ranked", () => {
    expect(fillUnrankedByOrder({}, byCp)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });
  it("keeps manual ranks (order preserved) and appends the unranked by CP", () => {
    // d manually #1, b #2; a + c unranked → appended in CP order after them.
    expect(fillUnrankedByOrder({ d: 1, b: 2 }, byCp)).toEqual({ d: 1, b: 2, a: 3, c: 4 });
  });
  it("compacts gaps in the existing ranks", () => {
    expect(fillUnrankedByOrder({ a: 1, b: 5 }, byCp)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });
  it("ignores stale ranked uids no longer in the roster", () => {
    // 'z' isn't in the roster → dropped; a,b,c,d filled by CP.
    expect(fillUnrankedByOrder({ z: 1 }, byCp)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });
});
