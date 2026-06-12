import { describe, it, expect } from "vitest";
import { parseInventory, isGear } from "../src/parse.js";
import type { RawUserItem } from "../src/raw.js";
import type { GameData } from "../src/gamedata.js";

const game: GameData = {
  options: {
    "160009": { st: "ST_CRITICAL_RATE", ap: "OAT_ADD", v: 30 }, // 30/tick, percent ÷10
    "160013": { st: "ST_SPEED", ap: "OAT_ADD", v: 3 }, // raw
    "24": { st: "ST_ATK", ap: "OAT_ADD", v: 200 }, // flat main
  },
  equipment: {
    "754": { slot: "weapon", grade: "unique", classLimit: null, setId: "5", name: "Surefire Greatsword", mainGroup: "1,1001", subGroup: "101" },
  },
  sets: {},
  characters: {},
};

const sample: RawUserItem = {
  ItemList: [
    {
      ItemUID: "1", CharUID: "0", ItemID: 754, Exp: 0, BreakLimitLevel: 4, Quantity: 1,
      SmeltingCount: 2, IsLock: 1, InvenType: 0, SelectSubOptionNum: 99,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 5,
      OptionList: [24],
      SubOptionList: [
        { OptionID: 160009, Level: 4, BaseLevel: 1 }, // crit rate, 4 ticks
        { OptionID: 160013, Level: 3, BaseLevel: 1 }, // speed, 3 ticks
        { OptionID: 0, Level: 0, BaseLevel: 0 },
      ],
    },
    { ItemUID: "2", CharUID: "0", ItemID: 1, Exp: 0, BreakLimitLevel: 0, Quantity: 50,
      SmeltingCount: 0, IsLock: 0, InvenType: 0, SelectSubOptionNum: 0,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0,
      OptionList: [0, 0], SubOptionList: [] },
  ],
};

describe("parseInventory", () => {
  it("keeps gear (by equipment table), drops non-gear", () => {
    expect(sample.ItemList.filter((i) => isGear(i, game))).toHaveLength(1);
    expect(parseInventory(sample, undefined, game).gear).toHaveLength(1);
  });

  it("resolves identity + equipment meta", () => {
    const g = parseInventory(sample, undefined, game).gear[0]!;
    expect(g.itemId).toBe(754);
    expect(g.slot).toBe("weapon");
    expect(g.rarity).toBe("unique");
    expect(g.name).toBe("Surefire Greatsword");
    expect(g.setId).toBe("5");
    expect(g.breakthrough).toBe(4);
    expect(g.reforgeCount).toBe(2);
    expect(g.singularityLevel).toBe(5);
    expect(g.locked).toBe(true);
  });

  it("resolves stat values (percent ÷10, raw, reforge ticks)", () => {
    const g = parseInventory(sample, undefined, game).gear[0]!;
    expect(g.subs).toHaveLength(2);
    const crit = g.subs.find((s) => s.stat === "critRate")!;
    expect(crit.value).toBe(12); // 30 * 4 / 10
    expect(crit.percent).toBe(true);
    expect(crit.reforgeTicks).toBe(3); // 4 - 1
    const spd = g.subs.find((s) => s.stat === "spd")!;
    expect(spd.value).toBe(9); // 3 * 3, raw
    expect(spd.percent).toBe(false);
    // flat ATK main, base value at +0
    expect(g.main[0]).toMatchObject({ stat: "atk", value: 200, percent: false });
  });
});
