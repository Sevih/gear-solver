import { describe, expect, it } from "vitest";
import type { GameData, GearPiece } from "@gear-solver/core";
import type { SlotId } from "../src/design/tokens.js";
import { computeAdvice, type AdviceInput } from "../src/lib/buildAdvice.js";

// ── fixtures ──────────────────────────────────────────────────────────────
function mkPiece(p: Partial<GearPiece>): GearPiece {
  return {
    uid: "u", itemId: 0, slot: "weapon", setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: null, classLimit: null,
    // Default = a fully-maxed 6★ ascended piece (reforge 9/9) so a default
    // roster yields no upgrade advice; tests opt into under-investment.
    breakthrough: 0, reforgeCount: 9, enhanceLevel: 15, singularityLevel: 0,
    ascended: true, locked: false, equippedBy: "h", main: [], subs: [],
    ...p,
  };
}

/** A fully main-equipped hero (so rule 1 doesn't early-return) plus whatever
 *  extra pieces a test wants in `rawPieces`. */
function fullEntry(extra: GearPiece[] = [], stats: AdviceInput["stats"] = null): AdviceInput {
  const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
  const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
  // Default main pieces are fully maxed (reforge 6/6, ascended) → no upgrade noise.
  const base = SLOTS.map((s, i) => mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"] }));
  return { equipped, rawPieces: [...base, ...extra], stats };
}

describe("computeAdvice — rule 1 (missing / no gear)", () => {
  it("stays silent on a fully-unequipped hero", () => {
    const entry: AdviceInput = { equipped: new Map(), rawPieces: [], stats: null };
    expect(computeAdvice(entry, null)).toEqual([]);
  });

  it("flags missing slots on a nearly-complete hero and defers the other rules", () => {
    // Only Gloves + Boots missing (≤ MISSING_ADVICE_MAX) → actionable nudge.
    const equipped = new Map<SlotId, unknown>(
      ["weapon", "accessory", "helmet", "armor"].map((s) => [s as SlotId, true]),
    );
    // crc over cap would normally warn, but rule 1 returns early.
    const out = computeAdvice({ equipped, rawPieces: [], stats: { crc: 130 } as never }, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ tone: "warn", text: "Missing: Gloves, Boots" });
  });

  it("stays silent when a hero is missing more than MISSING_ADVICE_MAX slots (WIP/bench)", () => {
    // Only weapon + helmet equipped → 4 gaps → no Missing noise, no other advice.
    const equipped = new Map<SlotId, unknown>([["weapon", true], ["helmet", true]]);
    const out = computeAdvice({ equipped, rawPieces: [], stats: { crc: 130 } as never }, null);
    expect(out).toEqual([]);
  });
});

describe("computeAdvice — rules 2/3 (set composition)", () => {
  const game = {
    sets: {
      "7": { name: "Sharp", levels: [{ level: 2, p4: { st: "ST_ATK", v: 10 } }] },
    },
  } as unknown as GameData;

  it("warns on a lone set piece (no 1pc bonus)", () => {
    const out = computeAdvice(fullEntry([mkPiece({ uid: "x", slot: "helmet", armorSetId: "7" })]), game);
    expect(out).toContainEqual({ tone: "warn", text: "Sharp: 1 piece — no set bonus active" });
  });

  it("tips when 3/4 of a 4pc-capable set is equipped", () => {
    const three = ["helmet", "armor", "gloves"].map((s, i) =>
      mkPiece({ uid: `s${i}`, slot: s as GearPiece["slot"], armorSetId: "7" }));
    const out = computeAdvice(fullEntry(three), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — one more piece completes 4pc" });
  });
});

describe("computeAdvice — rule 4 (wasted caps)", () => {
  it("flags CRC past the 102% tolerance and PEN past 100% with the rounded waste", () => {
    const out = computeAdvice(fullEntry([], { crc: 112.5, pen: 104 } as never), null);
    expect(out).toContainEqual({ tone: "warn", text: "Crit rate 112.5% — 10.5% wasted over the 102% cap" });
    expect(out).toContainEqual({ tone: "warn", text: "Penetration 104% — 4% wasted over the 100% cap" });
  });

  it("tolerates crit rate up to 102% (anti crit-resist buffer) — no warn at 101", () => {
    const out = computeAdvice(fullEntry([], { crc: 101, pen: 100 } as never), null);
    expect(out.some((a) => a.text.includes("Crit rate"))).toBe(false);
  });

  it("warns once crit rate clears the 102% tolerance", () => {
    const out = computeAdvice(fullEntry([], { crc: 103.5, pen: 100 } as never), null);
    expect(out).toContainEqual({ tone: "warn", text: "Crit rate 103.5% — 1.5% wasted over the 102% cap" });
  });

  it("does not warn at or a hair over a cap (rounded waste must be > 0)", () => {
    const out = computeAdvice(fullEntry([], { crc: 102, pen: 100.02 } as never), null);
    expect(out.some((a) => a.text.includes("wasted"))).toBe(false);
  });
});

describe("computeAdvice — rule 5 (gem slots)", () => {
  it("warns about empty usable gem slots (Talisman, +5 → 5 usable)", () => {
    const tali = mkPiece({ uid: "t", slot: "ooparts", enhanceLevel: 7, gemSlots: [1, 2, 0, 0, 3] });
    const out = computeAdvice(fullEntry([tali]), null);
    expect(out).toContainEqual({ tone: "warn", text: "Talisman: 2 empty gem slots" });
  });

  it("tips to reach +5 when the first 4 are full but the 5th is locked", () => {
    const ee = mkPiece({ uid: "e", slot: "exclusive", enhanceLevel: 3, gemSlots: [1, 2, 3, 4, 0] });
    const out = computeAdvice(fullEntry([ee]), null);
    expect(out).toContainEqual({ tone: "tip", text: "EE: reach +5 to unlock a 5th gem slot" });
  });

  it("stays silent on a fully-gemmed +5 talisman", () => {
    const tali = mkPiece({ uid: "t", slot: "ooparts", enhanceLevel: 9, gemSlots: [1, 2, 3, 4, 5] });
    const out = computeAdvice(fullEntry([tali]), null);
    expect(out.some((a) => a.text.includes("gem"))).toBe(false);
  });
});

describe("computeAdvice — rule 6 (upgrade headroom, aggregated)", () => {
  it("aggregates unused reforges and un-ascended 6★ into one line each", () => {
    // Replace the default maxed roster with under-invested 6★ pieces.
    const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
    const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
    const raw = SLOTS.map((s, i) =>
      mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], star: 6, ascended: false, reforgeCount: 2 }));
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null }, null);
    expect(out).toContainEqual({ tone: "info", text: "6 6★ pieces not yet ascended" });
    expect(out).toContainEqual({ tone: "info", text: "6 pieces with unused reforges" });
  });

  it("singularizes the message for a single piece", () => {
    const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
    const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
    const raw = SLOTS.map((s, i) =>
      // Only the weapon is under-reforged; the rest are maxed (6/6 ascended).
      mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], reforgeCount: s === "weapon" ? 1 : 9 }));
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null }, null);
    expect(out).toContainEqual({ tone: "info", text: "1 piece with unused reforges" });
  });

  it("aggregates pieces below their enhance cap (+15 ascended, +10 normal)", () => {
    const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
    const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
    // weapon: ascended at +12 (< 15) → under; accessory: normal at +8 (< 10) →
    // under; the rest are maxed (ascended +15) → not under.
    const raw = SLOTS.map((s, i) => {
      if (s === "weapon") return mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], ascended: true, enhanceLevel: 12 });
      if (s === "accessory") return mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], ascended: false, reforgeCount: 6, enhanceLevel: 8 });
      return mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"] });
    });
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null }, null);
    expect(out).toContainEqual({ tone: "info", text: "2 pieces below max enhance" });
  });

  it("does not flag a maxed piece (+15 ascended) as below max enhance", () => {
    const out = computeAdvice(fullEntry(), null);
    expect(out.some((a) => a.text.includes("below max enhance"))).toBe(false);
  });
});
