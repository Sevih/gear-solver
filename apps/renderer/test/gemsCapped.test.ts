import { describe, expect, it } from "vitest";
import { allocateGemsCapped, type ScoredGem } from "../src/lib/solver/gems.js";

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
