/// <reference types="node" />
// The renderer's rule readers (gem slots, reforge budget) follow the
// contract's rules (`gameRulesOf`) when they differ from DEFAULT_RULES.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameRulesOf, type GameData, type GearPiece } from "@gear-solver/core";
import { computeAdvice } from "../src/lib/buildAdvice.js";
import { maxReforgesOf, pieceReforgePlan } from "../src/lib/solver/engine.js";
import { gemSlotsOf } from "../src/lib/solver/gems.js";

const enhance = JSON.parse(readFileSync(new URL("../../../data/derived/enhance.json", import.meta.url), "utf8")) as GameData["enhance"];
const game = {
  enhance: {
    ...enhance,
    gemSlots: { ...enhance.gemSlots!, unlocks: { ...enhance.gemSlots!.unlocks, ooparts: [{ enhanceLevel: 7, slots: 2 }] } },
    reforge: { ...enhance.reforge!, countByStar: { ...enhance.reforge!.countByStar, "6": 7 }, ascendedBonus: 2 },
  },
} as unknown as GameData;
const rules = gameRulesOf(game);

const piece = (p: Partial<GearPiece>): GearPiece => ({
  uid: "u", itemId: 0, slot: "weapon", setId: null, armorSetId: null,
  rarity: "unique", star: 6, name: null, classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: "h", main: [], subs: [],
  ...p,
});

describe("rule readers on a contract that differs from DEFAULT_RULES", () => {
  it("gemSlotsOf: 4 under +7, 6 from +7 on a Talisman; the EE keeps its +5 tier", () => {
    expect(gemSlotsOf(piece({ slot: "ooparts", enhanceLevel: 6 }), rules)).toBe(4);
    expect(gemSlotsOf(piece({ slot: "ooparts", enhanceLevel: 7 }), rules)).toBe(6);
    expect(gemSlotsOf(piece({ slot: "exclusive", enhanceLevel: 5 }), rules)).toBe(5);
  });

  it("maxReforgesOf: 7 for a 6★, 9 ascended; pieceReforgePlan follows", () => {
    expect(maxReforgesOf(piece({}), false, rules)).toBe(7);
    expect(maxReforgesOf(piece({}), true, rules)).toBe(9);
    expect(maxReforgesOf(piece({ star: 5 }), true, rules)).toBe(5);
    expect(pieceReforgePlan(piece({}), "classic", rules).budget).toBe(7);
    expect(pieceReforgePlan(piece({}), "ascended", rules).budget).toBe(9);
  });

  it("the gem-slot tip reads the unlock tier of the rules", () => {
    const SLOTS = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"] as const;
    const base = SLOTS.map((s, i) => piece({ uid: `m${i}`, slot: s, reforgeCount: 9, enhanceLevel: 15, ascended: true }));
    const tali = piece({ uid: "t", slot: "ooparts", enhanceLevel: 5, gemSlots: [1, 2, 3, 4, 0] });
    const out = computeAdvice({
      equipped: new Map(SLOTS.map((s) => [s, true])),
      rawPieces: [...base, tali],
      stats: null,
      inventoryPieces: [],
      dmgStat: "atk",
    }, game);
    expect(out).toContainEqual({ tone: "tip", text: "Talisman: reach +7 to unlock 2 more gem slots" });
  });
});
