/// <reference types="node" />
// Weapon / accessory unique passives that hit the sheet, read from the contract
// (`equipment-passives.json` `statsByTier`, real `data/derived/`): the client
// takes the buff at Level = 1 + breakthrough; the parser pushes it as a
// `fromBuff` main with `source: "uniquePassive"`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGearPiece } from "../src/parse.js";
import type { RawItem } from "../src/raw.js";
import type { GameData } from "../src/gamedata.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));
const game = {
  options: derived("options.json"),
  equipment: derived("equipment.json"),
  equipmentPassives: derived("equipment-passives.json"),
  enhance: derived("enhance.json"),
  singularityOptions: {},
  eePassives: {},
} as unknown as GameData;

const item = (ItemID: number, BreakLimitLevel: number, OptionList: number[] = []): RawItem => ({
  ItemUID: `u${ItemID}`, CharUID: "0", ItemID, Exp: 0, BreakLimitLevel, Quantity: 1,
  SmeltingCount: 0, IsLock: 0, InvenType: 0, SelectSubOptionNum: 0,
  SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList, SubOptionList: [],
});
const unique = (id: number, bt: number) =>
  parseGearPiece(item(id, bt), game).main.filter((m) => m.source === "uniquePassive");

describe("unique passive stats (statsByTier) → fromBuff mains", () => {
  it("Phantasm Necrosis (24, 93391) at breakthrough 0 and 4 → SPD −30 %", () => {
    for (const id of [24, 93391]) for (const bt of [0, 4]) {
      expect(unique(id, bt), `${id} bt${bt}`).toEqual([
        { stat: "spd", value: -30, percent: true, fromBuff: true, source: "uniquePassive" },
      ]);
    }
  });

  it("Briareos's Ambition (1797) → RES +20 % at breakthrough 0, +40 % at 4", () => {
    expect(unique(1797, 0)).toEqual([{ stat: "effRes", value: 20, percent: true, fromBuff: true, source: "uniquePassive" }]);
    expect(unique(1797, 4)).toEqual([{ stat: "effRes", value: 40, percent: true, fromBuff: true, source: "uniquePassive" }]);
  });

  it("a breakthrough past the list reads the last tier", () => {
    expect(unique(1797, 7).map((m) => m.value)).toEqual([40]);
  });

  it("a weapon without statsByTier keeps its mains unchanged", () => {
    const raw = item(754, 4, [24]); // Surefire Greatsword, ATK main
    const withContract = parseGearPiece(raw, game).main;
    expect(withContract.some((m) => m.source === "uniquePassive")).toBe(false);
    expect(withContract).toEqual(parseGearPiece(raw, { ...game, equipmentPassives: {} }).main);
  });

  it("covers exactly the 16 weapon / accessory items of the contract", () => {
    const table = game.equipmentPassives;
    const ids = Object.keys(table).filter((k) => table[k]!.statsByTier);
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(["weapon", "accessory"]).toContain(game.equipment[id]!.slot);
      expect(unique(Number(id), 0).length, id).toBeGreaterThan(0);
    }
  });
});
