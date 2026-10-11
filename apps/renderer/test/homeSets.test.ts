import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { computeStats } from "../src/screens/HomeScreen.js";

// The Home → Inventory drill sends `armorSet: se.id`, and the Inventory keeps
// a piece only when `f.armorSets.has(p.armorSetId)` — so `id` must be the
// numeric set id, not the set name.
const piece = (uid: string, armorSetId: string): GearPiece =>
  ({ uid, itemId: 1, slot: "helmet", armorSetId, breakthrough: 0, enhanceLevel: 0, main: [], subs: [] }) as unknown as GearPiece;

const inv = { characters: [], gear: [piece("a", "9"), piece("b", "9"), piece("c", "1")] } as unknown as Inventory;

describe("Home — armor-set ids", () => {
  it("top sets carry the numeric armorSetId (with game data)", () => {
    const game = {
      characters: {},
      equipment: { "1": { armorSetId: "9", armorSetIcon: null }, "2": { armorSetId: "1", armorSetIcon: null } },
      sets: { "9": { name: "Mitigation set", levels: [] }, "1": { name: "Attack Set", levels: [] } },
    } as unknown as GameData;
    const { sets, allSets } = computeStats(inv, game);
    expect(sets.map((s) => [s.name, s.id])).toEqual([["Mitigation set", "9"], ["Attack Set", "1"]]);
    expect(allSets.map((s) => s.id).sort()).toEqual(["1", "9"]);
  });

  it("top sets carry the numeric armorSetId (without game data)", () => {
    const { sets } = computeStats(inv, null);
    expect(sets.map((s) => s.id)).toEqual(["9", "1"]);
  });
});
