import { describe, expect, it } from "vitest";
import { allocateGemsCapped, allocateGemsReachingCap, gemDeltaEquals, type ScoredGem } from "../src/lib/solver/gems.js";

// Helper to build a scored gem. Pool must be pre-sorted by score desc (the
// allocator assumes the same ordering `scoreGemPool` produces).
const crit = (id: number, score = 100): ScoredGem => ({ id, stat: "critRate", value: 3, percent: true, score });
const atk = (id: number, score = 50): ScoredGem => ({ id, stat: "atkPct", value: 6, percent: true, score });

describe("allocateGemsCapped", () => {
  it("no crit gems → fills slots with the top-scoring gems (parity with greedy)", () => {
    const pool = [atk(1), atk(2), atk(3)];
    const { alloc, delta } = allocateGemsCapped(pool, 2, 0, 50);
    expect(alloc.talisman).toEqual([1, 2]);
    expect(alloc.ee).toEqual([]);
    expect(delta?.pct.atkPct).toBe(12); // two atk% gems × 6
  });

  it("accepts crit gems until CHC reaches 100, allowing one ~102 overshoot", () => {
    // preGemCrc 90; 3% gems → 90→93→96→99→102 accepts 4, then the 5th is skipped.
    const pool = [crit(1), crit(2), crit(3), crit(4), crit(5), atk(9)];
    const { alloc, delta } = allocateGemsCapped(pool, 5, 0, 90);
    // 4 crit gems + the next non-crit (atk) for the 5th slot.
    expect(alloc.talisman).toEqual([1, 2, 3, 4, 9]);
    expect(delta?.pct.critRate).toBe(12); // 4 × 3 → CHC 90→102
    expect(delta?.pct.atkPct).toBe(6);
  });

  it("stops exactly at the cap when CHC lands on 100 without overshoot", () => {
    // preGemCrc 94; 94→97→100 accepts 2 (the 2nd reaches 100), 3rd skipped.
    const pool = [crit(1), crit(2), crit(3), atk(9)];
    const { alloc, delta } = allocateGemsCapped(pool, 4, 0, 94);
    expect(alloc.talisman).toEqual([1, 2, 9, 0]); // 2 crit + 1 atk + pad
    expect(delta?.pct.critRate).toBe(6); // 94→100
  });

  it("skips every crit gem when already at the cap, using non-crit instead", () => {
    const pool = [crit(1), crit(2), atk(9), atk(10)];
    const { alloc, delta } = allocateGemsCapped(pool, 2, 0, 100);
    expect(alloc.talisman).toEqual([9, 10]);
    expect(delta?.pct.critRate).toBeUndefined();
    expect(delta?.pct.atkPct).toBe(12);
  });

  it("splits across talisman then EE slots", () => {
    const pool = [atk(1), atk(2), atk(3)];
    const { alloc } = allocateGemsCapped(pool, 2, 1, 50);
    expect(alloc.talisman).toEqual([1, 2]);
    expect(alloc.ee).toEqual([3]);
  });

  it("returns a null delta when nothing useful can be placed (only-crit pool at cap)", () => {
    const pool = [crit(1), crit(2)];
    const { alloc, delta } = allocateGemsCapped(pool, 2, 0, 100);
    expect(delta).toBeNull();
    expect(alloc.talisman).toEqual([0, 0]);
  });

  it("never picks a non-positive-score gem", () => {
    const pool = [atk(1, 10), atk(2, 0), atk(3, -5)];
    const { alloc } = allocateGemsCapped(pool, 3, 0, 50);
    expect(alloc.talisman).toEqual([1, 0, 0]);
  });
});

describe("allocateGemsReachingCap", () => {
  it("spends crit gems to reach the cap FIRST, even when atk outranks them", () => {
    // atk gems score higher (80) than crit (50), but the cap-reaching pass
    // must still grab crit first: 94→97→100 (2 crit), then fill with atk.
    const pool = [atk(1, 80), atk(2, 80), crit(3, 50), crit(4, 50)];
    const { alloc, delta } = allocateGemsReachingCap(pool, 3, 0, 94);
    expect(alloc.talisman).toEqual([3, 4, 1]); // 2 crit (cap) + 1 atk
    expect(delta?.pct.critRate).toBe(6); // 94→100
    expect(delta?.pct.atkPct).toBe(6);
  });

  it("when already at the cap, takes no crit and fills purely by priority", () => {
    const pool = [crit(1), atk(2), atk(3)];
    const { alloc, delta } = allocateGemsReachingCap(pool, 2, 0, 100);
    expect(alloc.talisman).toEqual([2, 3]);
    expect(delta?.pct.critRate).toBeUndefined();
    expect(delta?.pct.atkPct).toBe(12);
  });

  it("stops adding crit the moment the cap is crossed, then skips further crit", () => {
    // preGemCrc 98; one 3% gem reaches 101 ≥ 100 → stop. Remaining slots skip crit.
    const pool = [crit(1), crit(2), crit(3), atk(9)];
    const { alloc, delta } = allocateGemsReachingCap(pool, 4, 0, 98);
    expect(alloc.talisman).toEqual([1, 9, 0, 0]);
    expect(delta?.pct.critRate).toBe(3);
    expect(delta?.pct.atkPct).toBe(6);
  });

  it("takes every available crit when the cap is unreachable, then fills the rest", () => {
    const pool = [crit(1), crit(2), atk(3)];
    const { alloc, delta } = allocateGemsReachingCap(pool, 4, 0, 50);
    expect(alloc.talisman).toEqual([1, 2, 3, 0]); // 2 crit (56 < 100) + 1 atk + pad
    expect(delta?.pct.critRate).toBe(6);
    expect(delta?.pct.atkPct).toBe(6);
  });

  it("splits across talisman then EE after reaching the cap", () => {
    const pool = [crit(1), atk(2), atk(3)];
    const { alloc } = allocateGemsReachingCap(pool, 2, 1, 94);
    // crit reaches 97 (<100, no more crit) → fill atk: talisman [1,2], ee [3].
    expect(alloc.talisman).toEqual([1, 2]);
    expect(alloc.ee).toEqual([3]);
  });
});

describe("gemDeltaEquals", () => {
  const d = (flat: Record<string, number>, pct: Record<string, number>) => ({ flat, pct });
  it("true for identical bucket contents", () => {
    expect(gemDeltaEquals(d({ atk: 5 }, { critRate: 3 }), d({ atk: 5 }, { critRate: 3 }))).toBe(true);
  });
  it("false when a value differs", () => {
    expect(gemDeltaEquals(d({}, { critRate: 3 }), d({}, { critRate: 6 }))).toBe(false);
  });
  it("false when key sets differ", () => {
    expect(gemDeltaEquals(d({}, { critRate: 3 }), d({}, { critRate: 3, atkPct: 6 }))).toBe(false);
  });
  it("handles null on either side", () => {
    expect(gemDeltaEquals(null, null)).toBe(true);
    expect(gemDeltaEquals(null, d({}, { critRate: 3 }))).toBe(false);
  });
});
