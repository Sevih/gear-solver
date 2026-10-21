/// <reference types="node" />
// EE level-gated passives read from the contract (`ee-passives.json`, real
// `data/derived/`): the key is the EE item id, which is also its hero's id
// (2000078 = Fatal's Eclipse). The parser looks it up by `item.ItemID` on an
// `exclusive` item, skips an entry until `enhanceLevel >= levelThreshold`
// (`levelThreshold <= 1` = always on), and pushes a `fromBuff` main with
// `source: "eePassive"`.
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
  equipmentPassives: {},
  enhance: derived("enhance.json"),
  singularityOptions: {},
  eePassives: derived("ee-passives.json"),
} as unknown as GameData;

// Exp at the bottom of `level` on the item's own curve (`enhance.json`).
const expAt = (ItemID: number, level: number): number => {
  const meta = game.equipment[String(ItemID)]!;
  return game.enhance.expCurves[`${meta.slot}|${meta.grade}|${meta.star}`]![level]!;
};
const item = (ItemID: number, level: number): RawItem => ({
  ItemUID: `u${ItemID}`, CharUID: "0", ItemID, Exp: expAt(ItemID, level), BreakLimitLevel: 0, Quantity: 1,
  SmeltingCount: 0, IsLock: 0, SelectSubOptionNum: 0,
  SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [], SubOptionList: [],
});
const ee = (id: number, level: number) => {
  const piece = parseGearPiece(item(id, level), game);
  expect(piece.enhanceLevel, `${id} +${level}`).toBe(level);
  return piece.main.filter((m) => m.source === "eePassive");
};

describe("EE passives (ee-passives.json) → fromBuff mains", () => {
  it("Fatal's Eclipse (2000078) at +0 → no eePassive main (gated at +10)", () => {
    expect(ee(2000078, 0)).toEqual([]);
  });

  it("Fatal's Eclipse (2000078) at +10 → CHD +30 % (v 300 ÷ 10)", () => {
    expect(ee(2000078, 10)).toEqual([
      { stat: "critDmg", value: 30, percent: true, fromBuff: true, source: "eePassive" },
    ]);
  });

  it("Edelweiss's EE (2000072), levelThreshold 1 → HP +35 % from +0", () => {
    expect(game.eePassives["2000072"]).toEqual([{ levelThreshold: 1, st: "ST_HP", ap: "OAT_RATE", v: 350 }]);
    for (const level of [0, 10]) {
      expect(ee(2000072, level), `+${level}`).toEqual([
        { stat: "hpPct", value: 35, percent: true, fromBuff: true, source: "eePassive" },
      ]);
    }
  });

  it("every key is an exclusive item of equipment.json, every entry is well-formed", () => {
    const table = game.eePassives;
    const ids = Object.keys(table);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(game.equipment[id]?.slot, id).toBe("exclusive");
      for (const ep of table[id]!) {
        expect(typeof ep.st, id).toBe("string");
        expect(typeof ep.ap, id).toBe("string");
        expect(typeof ep.v, id).toBe("number");
        expect(typeof ep.levelThreshold, id).toBe("number");
      }
    }
  });
});
