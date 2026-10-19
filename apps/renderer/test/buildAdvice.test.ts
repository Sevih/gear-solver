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
function fullEntry(extra: GearPiece[] = [], stats: AdviceInput["stats"] = null, inventoryPieces: GearPiece[] = [], claimedBy?: AdviceInput["claimedBy"]): AdviceInput {
  const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
  const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
  // Default main pieces are fully maxed (reforge 6/6, ascended) → no upgrade noise.
  const base = SLOTS.map((s, i) => mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"] }));
  return { equipped, rawPieces: [...base, ...extra], stats, inventoryPieces, heroUid: "h", claimedBy, dmgStat: "atk" };
}

/** The inventory-side fields for the hand-built entries (empty inventory). */
const NO_INV = { inventoryPieces: [], heroUid: "h", dmgStat: "atk" } as const;

describe("computeAdvice — rule 1 (missing / no gear)", () => {
  it("stays silent on a fully-unequipped hero", () => {
    const entry: AdviceInput = { equipped: new Map(), rawPieces: [], stats: null, ...NO_INV };
    expect(computeAdvice(entry, null)).toEqual([]);
  });

  it("flags missing slots on a nearly-complete hero and defers the other rules", () => {
    // Only Gloves + Boots missing (≤ MISSING_ADVICE_MAX) → actionable nudge.
    const equipped = new Map<SlotId, unknown>(
      ["weapon", "accessory", "helmet", "armor"].map((s) => [s as SlotId, true]),
    );
    // crc over cap would normally warn, but rule 1 returns early.
    const out = computeAdvice({ equipped, rawPieces: [], stats: { critRate: 130 } as never, ...NO_INV }, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ tone: "warn", text: "Missing: Gloves, Boots" });
  });

  it("stays silent when a hero is missing more than MISSING_ADVICE_MAX slots (WIP/bench)", () => {
    // Only weapon + helmet equipped → 4 gaps → no Missing noise, no other advice.
    const equipped = new Map<SlotId, unknown>([["weapon", true], ["helmet", true]]);
    const out = computeAdvice({ equipped, rawPieces: [], stats: { critRate: 130 } as never, ...NO_INV }, null);
    expect(out).toEqual([]);
  });
});

describe("computeAdvice — rules 2/3 (set composition)", () => {
  const game = {
    sets: {
      "7": { name: "Sharp", levels: [{ level: 2, p4: { st: "ST_ATK", v: 10 } }] },
      // Combat-effect 4pc: no sheet stat, only its description.
      "8": { name: "Pulverization", levels: [{ level: 2, p4: null, p4_desc: "Deals extra damage" }] },
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

  it("tips 3/4 for a combat-effect 4pc too (no sheet stat, p4_desc only)", () => {
    const three = ["helmet", "armor", "gloves"].map((s, i) =>
      mkPiece({ uid: `p${i}`, slot: s as GearPiece["slot"], armorSetId: "8" }));
    const out = computeAdvice(fullEntry(three), game);
    expect(out).toContainEqual({ tone: "tip", text: "Pulverization: 3/4 — one more piece completes 4pc" });
  });

  // Helmet / Armor / Gloves of Sharp worn → the 4th piece goes in Boots.
  const threeSharp = () => ["helmet", "armor", "gloves"].map((s, i) =>
    mkPiece({ uid: `s${i}`, slot: s as GearPiece["slot"], armorSetId: "7" }));

  it("says so when a free piece of the set is in the inventory for the missing slot", () => {
    const freeBoots = mkPiece({ uid: "fb", slot: "boots", armorSetId: "7", equippedBy: null });
    const out = computeAdvice(fullEntry(threeSharp(), null, [freeBoots]), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — a free Boots of this set is in your inventory" });
    expect(out.some((a) => a.text.includes("one more piece"))).toBe(false);
  });

  it("keeps the plain text when the only matching piece is worn by another hero", () => {
    const wornBoots = mkPiece({ uid: "wb", slot: "boots", armorSetId: "7", equippedBy: "other" });
    const out = computeAdvice(fullEntry(threeSharp(), null, [wornBoots]), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — one more piece completes 4pc" });
  });

  it("a piece claimed by ANOTHER hero in the Worklist is not free", () => {
    const freeBoots = mkPiece({ uid: "fb", slot: "boots", armorSetId: "7", equippedBy: null });
    const out = computeAdvice(fullEntry(threeSharp(), null, [freeBoots], { fb: "other" }), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — one more piece completes 4pc" });
    expect(out.some((a) => a.text.includes("a free"))).toBe(false);
  });

  it("a piece claimed by this hero in the Worklist is still free", () => {
    const freeBoots = mkPiece({ uid: "fb", slot: "boots", armorSetId: "7", equippedBy: null });
    const out = computeAdvice(fullEntry(threeSharp(), null, [freeBoots], { fb: "h" }), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — a free Boots of this set is in your inventory" });
  });

  it("keeps the plain text when the inventory has no piece of the set for the missing slot", () => {
    // Free Sharp pieces, but none in Boots; free Boots, but of another set.
    const inv = [
      mkPiece({ uid: "fh", slot: "helmet", armorSetId: "7", equippedBy: null }),
      mkPiece({ uid: "fo", slot: "boots", armorSetId: "8", equippedBy: null }),
    ];
    const out = computeAdvice(fullEntry(threeSharp(), null, inv), game);
    expect(out).toContainEqual({ tone: "tip", text: "Sharp: 3/4 — one more piece completes 4pc" });
  });
});

describe("computeAdvice — rule 4 (wasted caps)", () => {
  it("flags CRC past the 102% tolerance and PEN past 100% with the rounded waste", () => {
    const out = computeAdvice(fullEntry([], { critRate: 112.5, pen: 104 } as never), null);
    expect(out).toContainEqual({ tone: "warn", text: "Crit rate 112.5% — 10.5% wasted over the 102% cap" });
    expect(out).toContainEqual({ tone: "warn", text: "Penetration 104% — 4% wasted over the 100% cap" });
  });

  it("tolerates crit rate up to 102% (anti crit-resist buffer) — no warn at 101", () => {
    const out = computeAdvice(fullEntry([], { critRate: 101, pen: 100 } as never), null);
    expect(out.some((a) => a.text.includes("Crit rate"))).toBe(false);
  });

  it("warns once crit rate clears the 102% tolerance", () => {
    const out = computeAdvice(fullEntry([], { critRate: 103.5, pen: 100 } as never), null);
    expect(out).toContainEqual({ tone: "warn", text: "Crit rate 103.5% — 1.5% wasted over the 102% cap" });
  });

  it("does not warn at or a hair over a cap (rounded waste must be > 0)", () => {
    const out = computeAdvice(fullEntry([], { critRate: 102, pen: 100.02 } as never), null);
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
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null, ...NO_INV }, null);
    expect(out).toContainEqual({ tone: "info", text: "6 6★ pieces not yet ascended" });
    expect(out).toContainEqual({ tone: "info", text: "6 pieces with unused reforges" });
  });

  it("singularizes the message for a single piece", () => {
    const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
    const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));
    const raw = SLOTS.map((s, i) =>
      // Only the weapon is under-reforged; the rest are maxed (6/6 ascended).
      mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], reforgeCount: s === "weapon" ? 1 : 9 }));
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null, ...NO_INV }, null);
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
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null, ...NO_INV }, null);
    expect(out).toContainEqual({ tone: "info", text: "2 pieces below max enhance" });
  });

  it("does not flag a maxed piece (+15 ascended) as below max enhance", () => {
    const out = computeAdvice(fullEntry(), null);
    expect(out.some((a) => a.text.includes("below max enhance"))).toBe(false);
  });
});

describe("computeAdvice — rule 7 (low quality)", () => {
  // Ticks vs 14 + reforgeCount (9 by default → 23): 5 = 22% poor, 20 = 87% excellent.
  const subs = (ticks: number[]) => ticks.map((t) => ({ ticks: t })) as unknown as GearPiece["subs"];
  const SLOTS: SlotId[] = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"];
  const equipped = new Map<SlotId, unknown>(SLOTS.map((s) => [s, true]));

  it("lists the equipped poor pieces in one line, in slot order", () => {
    const raw = SLOTS.map((s, i) => mkPiece({
      uid: `m${i}`, slot: s as GearPiece["slot"],
      subs: subs(s === "boots" || s === "weapon" ? [2, 2, 1] : [5, 5, 5, 5]),
    }));
    const out = computeAdvice({ equipped, rawPieces: raw, stats: null, ...NO_INV }, null);
    expect(out.filter((a) => a.text.startsWith("Poor quality"))).toEqual([
      { tone: "info", text: "Poor quality: Weapon, Boots" },
    ]);
  });

  it("stays silent without a poor piece (and on Talisman / EE, which have no tier)", () => {
    const tali = mkPiece({ uid: "t", slot: "ooparts", enhanceLevel: 9, gemSlots: [1, 2, 3, 4, 5], subs: subs([1]) });
    const raw = SLOTS.map((s, i) => mkPiece({ uid: `m${i}`, slot: s as GearPiece["slot"], subs: subs([5, 5, 5, 5]) }));
    const out = computeAdvice({ equipped, rawPieces: [...raw, tali], stats: null, ...NO_INV }, null);
    expect(out.some((a) => a.text.startsWith("Poor quality"))).toBe(false);
  });
});
