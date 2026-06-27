/**
 * Hero priority store — the rank model behind the Builder's "Equipped items →
 * ≤ lower priority" scope. Locks:
 *  - priorityValue: unranked → -Infinity (lowest), ranked → its integer;
 *  - isLowerPriority: strict; unranked < any ranked; two unranked NOT lower;
 *  - setHeroRank: clears on null, and enforces UNIQUE ranks by swapping the
 *    previous holder to the setter's old rank (or unranked).
 */
import { describe, expect, it } from "vitest";
import { isLowerPriority, priorityValue, setHeroRank, type HeroPriority } from "../src/lib/storage/heroPriority.js";

describe("priorityValue", () => {
  it("returns the rank for a ranked hero, -Infinity for unranked", () => {
    const m: HeroPriority = { a: 5 };
    expect(priorityValue(m, "a")).toBe(5);
    expect(priorityValue(m, "b")).toBe(-Infinity);
  });
});

describe("isLowerPriority", () => {
  const m: HeroPriority = { hi: 9, lo: 3 };
  it("ranks unranked below any ranked hero", () => {
    expect(isLowerPriority(m, "unranked", "lo")).toBe(true);   // -∞ < 3
    expect(isLowerPriority(m, "lo", "unranked")).toBe(false);  // 3 < -∞ → no
  });
  it("compares integers (higher = higher priority)", () => {
    expect(isLowerPriority(m, "lo", "hi")).toBe(true);   // 3 < 9
    expect(isLowerPriority(m, "hi", "lo")).toBe(false);  // 9 < 3 → no
  });
  it("two unranked heroes are not lower than each other (strict)", () => {
    expect(isLowerPriority({}, "x", "y")).toBe(false); // -∞ < -∞ → false
  });
  it("equal ranks are never 'lower' (uniqueness makes this only matter for null)", () => {
    expect(isLowerPriority({ a: 4, b: 4 }, "a", "b")).toBe(false);
  });
});

describe("setHeroRank", () => {
  it("sets a fresh rank", () => {
    expect(setHeroRank({}, "a", 3)).toEqual({ a: 3 });
  });
  it("clears on null and is a no-op clone when already absent", () => {
    expect(setHeroRank({ a: 3 }, "a", null)).toEqual({});
    expect(setHeroRank({ a: 3 }, "b", null)).toEqual({ a: 3 });
  });
  it("swaps when the target rank is held by another hero (setter had a rank)", () => {
    // a=1, b=2; set a→2 → b takes a's old rank (1).
    expect(setHeroRank({ a: 1, b: 2 }, "a", 2)).toEqual({ a: 2, b: 1 });
  });
  it("bumps the previous holder to unranked when the setter had no rank", () => {
    // b=2; set a→2 (a was unranked) → b becomes unranked.
    expect(setHeroRank({ b: 2 }, "a", 2)).toEqual({ a: 2 });
  });
  it("never mutates the input map", () => {
    const m: HeroPriority = { a: 1, b: 2 };
    setHeroRank(m, "a", 2);
    expect(m).toEqual({ a: 1, b: 2 });
  });
  it("keeps every rank unique after a chain of edits", () => {
    let m: HeroPriority = {};
    m = setHeroRank(m, "a", 1);
    m = setHeroRank(m, "b", 2);
    m = setHeroRank(m, "c", 1); // steals 1 from a → a takes c's old (none) = unranked
    expect(m).toEqual({ b: 2, c: 1 });
    const ranks = Object.values(m);
    expect(new Set(ranks).size).toBe(ranks.length); // all distinct
  });
});
