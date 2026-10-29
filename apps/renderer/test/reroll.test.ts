// Transistone reroll potential (lib/solver/reroll.ts): which pieces can still
// climb, which line climbs and by how many ticks (up to base stage 4, or 3 on a
// piece that already has a stage-4 line, under the LV6 value cap), and the piece
// with it applied.
import { describe, expect, it } from "vitest";
import type { GearPiece, RolledStat, StatType } from "@gear-solver/core";
import { applyRerollPotential, rerollEligible, rerollGains, rerollMaxGain, rerollPotential } from "../src/lib/solver/reroll.js";

/** A substat line: base stage + reforge ticks, value = per-tick × ticks. */
const line = (stat: StatType, perTick: number, base: number, reforges = 0): RolledStat =>
  ({ stat, value: perTick * (base + reforges), percent: stat !== "spd" && stat !== "eff" && stat !== "effRes", ticks: base + reforges, reforgeTicks: reforges });

const piece = (subs: RolledStat[], o: Partial<GearPiece> = {}): GearPiece => ({
  uid: "p", itemId: 0, slot: "helmet", setId: null, armorSetId: null, rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy: null, main: [], subs, ...o,
});

// 3/3/3/1: CRC 4 %/tick, CHD 4 %/tick, ATK% 4 %/tick, SPD 2/tick.
const threeThreeThreeOne = () => piece([
  line("critRate", 4, 3), line("critDmg", 4, 3), line("atkPct", 4, 3), line("spd", 2, 1),
]);
const NO_PRIORITY = { priority: {} };

describe("rerollEligible — 6★ Legendary with 4 substat lines", () => {
  it("6★ unique with 4 lines", () => {
    expect(rerollEligible(threeThreeThreeOne())).toBe(true);
  });

  it("not under 6★, not below Legendary, not with fewer lines, not Talisman / EE", () => {
    expect(rerollEligible({ ...threeThreeThreeOne(), star: 5 })).toBe(false);
    expect(rerollEligible({ ...threeThreeThreeOne(), rarity: "rare" })).toBe(false);
    expect(rerollEligible({ ...threeThreeThreeOne(), subs: threeThreeThreeOne().subs.slice(0, 3) })).toBe(false);
    expect(rerollEligible({ ...threeThreeThreeOne(), slot: "ooparts" })).toBe(false);
    expect(rerollEligible({ ...threeThreeThreeOne(), slot: "exclusive" })).toBe(false);
  });
});

describe("rerollPotential", () => {
  it("ineligible piece → null", () => {
    expect(rerollPotential({ ...threeThreeThreeOne(), star: 5 }, null, NO_PRIORITY)).toBeNull();
    expect(rerollPotential({ ...threeThreeThreeOne(), rarity: "magic" }, null, NO_PRIORITY)).toBeNull();
  });

  it("nothing left to gain → null (4/3/3/3 drop, native 4/4/3/3)", () => {
    const fourThree = piece([line("critRate", 4, 4), line("critDmg", 4, 3), line("atkPct", 4, 3), line("spd", 2, 3)]);
    expect(rerollPotential(fourThree, null, NO_PRIORITY)).toBeNull();
    const native = piece([line("critRate", 4, 4), line("critDmg", 4, 4), line("atkPct", 4, 3), line("spd", 2, 3)]);
    expect(rerollPotential(native, null, NO_PRIORITY)).toBeNull();
    expect(rerollMaxGain(native)).toBe(0);
  });

  it("a piece that already has a stage-4 line can still raise one line to stage 3", () => {
    const p = piece([line("critRate", 4, 4), line("critDmg", 4, 4), line("atkPct", 4, 3), line("spd", 2, 2)]);
    expect(rerollPotential(p, null, NO_PRIORITY)).toEqual({ index: 3, ticks: 1 });
    expect(rerollPotential(p, null, { priority: { critRate: 3 } })).toEqual({ index: 3, ticks: 1 }); // the stage-4 lines don't climb
    expect(rerollPotential(p, null, { priority: { spd: -1 } })).toBeNull();
  });

  it("stage 4 is the BASE stage: reforge ticks on top don't count as a stage-4 line", () => {
    const reforged = piece([line("critRate", 4, 3, 3), line("critDmg", 4, 2), line("atkPct", 4, 3), line("spd", 2, 1)]);
    expect(rerollPotential(reforged, null, NO_PRIORITY)).not.toBeNull();
  });

  it("no substat → null", () => {
    expect(rerollPotential(piece([]), null, NO_PRIORITY)).toBeNull();
  });

  it("priority picks the line: the hero's heaviest stat", () => {
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { spd: 3, critRate: 1 } })).toEqual({ index: 3, ticks: 3 });
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { atk: 2, critRate: 1 } })).toEqual({ index: 2, ticks: 1 }); // atkPct → atk axis
  });

  it("equal weights or no priority → the largest normalized value", () => {
    // CRC 12 / 20 = 0.6 beats CHD 12 / 40 = 0.3, ATK% 12 / 40, SPD 2 / 20.
    expect(rerollPotential(threeThreeThreeOne(), null, NO_PRIORITY)).toEqual({ index: 0, ticks: 1 });
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { critRate: 2, critDmg: 2 } })).toEqual({ index: 0, ticks: 1 });
    // A priority on no line of the piece: every weight is 0 → by value.
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { hp: 3 } })).toEqual({ index: 0, ticks: 1 });
  });

  it("never a line ranked below zero; all of them below zero → null", () => {
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { critRate: -1 } })).toEqual({ index: 1, ticks: 1 });
    expect(rerollPotential(threeThreeThreeOne(), null, { priority: { critRate: -1, critDmg: -1, atk: -1, spd: -1 } })).toBeNull();
  });

  it("+1 to +3: up to base stage 4 from 3, 2 or 1", () => {
    for (const [base, gain] of [[3, 1], [2, 2], [1, 3]] as const) {
      const p = piece([line("critRate", 4, base), line("critDmg", 4, 1), line("atkPct", 4, 1), line("spd", 2, 1)]);
      expect(rerollPotential(p, null, { priority: { critRate: 3 } })).toEqual({ index: 0, ticks: gain });
    }
  });

  it("the LV6 value cap holds the climb; a line with nothing to gain is skipped", () => {
    // CRC base 1 + 5 reforges = LV6: nothing to gain → the next line.
    const p = piece([line("critRate", 4, 1, 5), line("critDmg", 4, 2, 3), line("atkPct", 4, 1), line("spd", 2, 1)], { reforgeCount: 8 });
    expect(rerollGains(p)).toEqual([0, 1, 3, 3]);
    expect(rerollPotential(p, null, { priority: { critRate: 3, critDmg: 2 } })).toEqual({ index: 1, ticks: 1 });
    expect(rerollMaxGain(p)).toBe(3);
  });
});

describe("rerollGains — stage 4 on a piece without one, stage 3 beside one", () => {
  const gains = (...bases: number[]) =>
    rerollGains(piece(bases.map((b, i) => line((["critRate", "critDmg", "atkPct", "spd"] as const)[i]!, 4, b))));

  it("no stage-4 line: every line up to stage 4", () => {
    expect(gains(3, 3, 3, 3)).toEqual([1, 1, 1, 1]);
    expect(rerollMaxGain(threeThreeThreeOne())).toBe(3);
    expect(rerollMaxGain(piece([line("critRate", 4, 3), line("critDmg", 4, 3), line("atkPct", 4, 3), line("spd", 2, 3)]))).toBe(1);
  });

  it("a stage-4 line already there: the others up to stage 3 only", () => {
    expect(gains(4, 4, 3, 2)).toEqual([0, 0, 0, 1]);
    expect(rerollMaxGain(piece([line("critRate", 4, 4), line("critDmg", 4, 4), line("atkPct", 4, 3), line("spd", 2, 2)]))).toBe(1);
    expect(gains(4, 4, 1, 1)).toEqual([0, 0, 2, 2]);
  });

  it("nothing to gain: gains all 0, max 0 (not null)", () => {
    expect(gains(4, 4, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(gains(4, 3, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(rerollMaxGain(piece([line("critRate", 4, 4), line("critDmg", 4, 3), line("atkPct", 4, 3), line("spd", 2, 3)]))).toBe(0);
  });

  it("null only when not eligible (5★, 3 lines)", () => {
    expect(rerollGains({ ...threeThreeThreeOne(), star: 5 })).toBeNull();
    expect(rerollGains({ ...threeThreeThreeOne(), subs: threeThreeThreeOne().subs.slice(0, 3) })).toBeNull();
    expect(rerollMaxGain({ ...threeThreeThreeOne(), star: 5 })).toBe(0);
  });

  it("the LV6 cap still holds beside a stage-4 line", () => {
    // Base 4 on CRC; CHD base 2 + 3 reforges = 5 ticks: stage 3 would be +1 → LV6, fine;
    // ATK% base 1 + 5 reforges = LV6: nothing; SPD base 1: +2 to stage 3.
    const p = piece([line("critRate", 4, 4), line("critDmg", 4, 2, 3), line("atkPct", 4, 1, 5), line("spd", 2, 1)], { reforgeCount: 8 });
    expect(rerollGains(p)).toEqual([0, 1, 0, 2]);
  });
});

describe("applyRerollPotential", () => {
  it("raises the picked line's base: ticks and value up, reforge ticks unchanged", () => {
    const p = piece([line("critRate", 4, 3), line("critDmg", 4, 2, 2), line("atkPct", 4, 3), line("spd", 2, 1)]);
    const out = applyRerollPotential(p, null, { priority: { critDmg: 3 } });
    expect(out.subs[1]).toMatchObject({ stat: "critDmg", ticks: 6, reforgeTicks: 2, value: 24 });
    expect(out.subs.filter((_, i) => i !== 1)).toEqual(p.subs.filter((_, i) => i !== 1));
    expect(p.subs[1]!.ticks).toBe(4); // the captured piece is not mutated
  });

  it("beside a stage-4 line: the picked line climbs by its gain, to stage 3, not to 4", () => {
    const p = piece([line("critRate", 4, 4), line("critDmg", 4, 4), line("atkPct", 4, 1, 2), line("spd", 2, 1)]);
    const out = applyRerollPotential(p, null, { priority: { atk: 3 } });
    expect(out.subs[2]).toMatchObject({ stat: "atkPct", ticks: 5, reforgeTicks: 2, value: 20 }); // base 1 → 3
    expect(out.subs.filter((_, i) => i !== 2)).toEqual(p.subs.filter((_, i) => i !== 2));
  });

  it("returns the piece itself when there is no potential", () => {
    const fourThree = piece([line("critRate", 4, 4), line("critDmg", 4, 3), line("atkPct", 4, 3), line("spd", 2, 3)]);
    expect(applyRerollPotential(fourThree, null, NO_PRIORITY)).toBe(fourThree);
  });
});
