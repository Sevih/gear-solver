import { describe, expect, it } from "vitest";
import { allocateGemsCapped, allocateGemsReachingCap, allocateGemsServingMins, gemDeltaEquals, type GemMinNeed, type ScoredGem } from "../src/lib/solver/gems.js";

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

describe("allocateGemsServingMins", () => {
  const chd = (id: number, score = 50): ScoredGem => ({ id, stat: "critDmg", value: 5, percent: true, score });
  // An ATK% gem lifts ATK by 60 on the sheet (6 % of a 1000 base); additive stats by their value.
  const gainOf = (g: ScoredGem) => (g.stat === "atkPct" ? g.value * 10 : g.value);
  const need = (stat: string, shortfall: number): GemMinNeed => ({ stat, shortfall, gainOf });

  it("a stat under its bound takes its gems first, up to the shortfall, then the priority", () => {
    // ATK% gems score 0 (outside the priority): still taken for the bound.
    const pool = [chd(1), chd(2), chd(3), chd(4), atk(11, 0), atk(12, 0), atk(13, 0), atk(14, 0)];
    const { alloc, delta } = allocateGemsServingMins(pool, 5, 0, [need("atk", 150)], 50);
    expect(alloc.talisman).toEqual([11, 12, 13, 1, 2]); // 3 × 60 ≥ 150, then CHD
    expect(delta?.pct.atkPct).toBe(18);
    expect(delta?.pct.critDmg).toBe(10);
  });

  it("takes a negatively-scored gem of the stat (the bound comes first)", () => {
    const pool = [chd(1), chd(2), atk(11, -5)];
    const { alloc } = allocateGemsServingMins(pool, 3, 0, [need("atk", 60)], 50);
    expect(alloc.talisman).toEqual([11, 1, 2]);
  });

  it("two stats under their bounds are served in the given order", () => {
    const pool = [chd(1), chd(2), chd(3), atk(11, 0), atk(12, 0)];
    const chdFirst = allocateGemsServingMins(pool, 4, 0, [need("critDmg", 8), need("atk", 60)], 50);
    expect(chdFirst.alloc.talisman).toEqual([1, 2, 11, 3]);
    const atkFirst = allocateGemsServingMins(pool, 4, 0, [need("atk", 60), need("critDmg", 8)], 50);
    expect(atkFirst.alloc.talisman).toEqual([11, 1, 2, 3]);
  });

  it("an uncoverable shortfall gets every gem of its stat, the rest by priority", () => {
    const pool = [chd(1), chd(2), chd(3), atk(11, 0), atk(12, 0)];
    const { alloc } = allocateGemsServingMins(pool, 3, 1, [need("atk", 1000)], 50);
    expect(alloc.talisman).toEqual([11, 12, 1]);
    expect(alloc.ee).toEqual([2]);
  });

  it("the CHC cap rule applies to the free slots: reached first with reachCap, never overshot", () => {
    const pool = [atk(1, 80), atk(2, 80), crit(3, 50), crit(4, 50), crit(5, 50), { ...atk(11, 0), fill: 0 }];
    // CHC 94: min on ATK (one gem), then two crit gems reach 100, then ATK by priority.
    const reached = allocateGemsServingMins(pool, 5, 0, [need("atk", 60)], 94, true);
    expect(reached.alloc.talisman).toEqual([1, 3, 4, 2, 11]);
    expect(reached.delta?.pct.critRate).toBe(6);
    // Without reachCap, at the cap: no crit gem at all.
    const guarded = allocateGemsServingMins(pool, 5, 0, [need("atk", 60)], 100);
    expect(guarded.alloc.talisman).toEqual([1, 2, 11, 0, 0]);
    expect(guarded.delta?.pct.critRate).toBeUndefined();
  });

  it("never places a gem twice", () => {
    // ATK% also in the priority: the bound takes the first copies, the priority the next ones.
    const pool = [atk(11, 80), atk(12, 80), chd(1), chd(2)];
    const { alloc } = allocateGemsServingMins(pool, 4, 1, [need("atk", 60)], 50);
    expect(alloc.talisman).toEqual([11, 12, 1, 2]);
    expect(alloc.ee).toEqual([0]);
  });
});
