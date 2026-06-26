import { describe, it, expect } from "vitest";
import { parseInventory, isGear, projectMainToCeiling } from "../src/parse.js";
import type { RawUserItem } from "../src/raw.js";
import type { GameData } from "../src/gamedata.js";

const game: GameData = {
  options: {
    "160009": { st: "ST_CRITICAL_RATE", ap: "OAT_ADD", v: 30 }, // 30/tick, percent ÷10
    "160013": { st: "ST_SPEED", ap: "OAT_ADD", v: 3 }, // raw
    "24": { st: "ST_ATK", ap: "OAT_ADD", v: 200 }, // flat main
    "1093": { st: "ST_BUFF_CHANCE", ap: "OAT_ADD", v: 21 }, // EFF flat (accessory main)
    "10207": { buffId: "BID_ITEM_STAT_OOPARTS_DMG_6" }, // Rogue's Charm main (IOT_BUFF)
  },
  equipment: {
    "754": { slot: "weapon", grade: "unique", star: 6, classLimit: null, setId: "5", armorSetId: null, name: "Surefire Greatsword", mainGroup: "1,1001", subGroup: "101", image: "TI_Equipment_Weapon_06", effectIcon: "TI_Icon_UO_Weapon_11", armorSetIcon: null, class: "Striker" },
    "1764": { slot: "accessory", grade: "unique", star: 6, classLimit: null, setId: "1004", armorSetId: null, name: "Overdrive", mainGroup: "2014", subGroup: "201", image: null, effectIcon: null, armorSetIcon: null, class: null },
    "10203": { slot: "ooparts", grade: "unique", star: 6, classLimit: null, setId: null, armorSetId: null, name: "Rogue's Charm", mainGroup: "10002", subGroup: null, image: null, effectIcon: null, armorSetIcon: null, class: null },
  },
  sets: {},
  equipmentPassives: {},
  multiTierPassives: {},
  gems: {},
  singularityOptions: {},
  eePassives: {},
  characters: {},
  enhance: {
    enhanceFactor: 0.4,
    tierFactor: 0.05,
    maxEnhanceLevel: 10,
    singularity: { activation: 0.15, steps: [0.1, 0.1, 0.1, 0.1, 0.2] },
    expCurves: {
      "weapon|unique|6": [0, 450, 1050, 1850, 2900, 4300, 6200, 8800, 12400, 17500, 25000],
      "accessory|unique|6": [0, 450, 1050, 1850, 2900, 4300, 6200, 8800, 12400, 17500, 25000],
      // Ooparts curve — Rogue's Charm captured Exp at +10 is "infinite" (11910000), the
      // last bucket of this curve.
      "ooparts|unique|6": [0, 100000, 250000, 480000, 830000, 1360000, 2160000, 3360000, 5160000, 7860000, 11910000],
    },
  },
  expCharacter: [],
  charLevelMax: {},
  codexCurve: [],
  archiveBonus: [],
  trustCharacter: [],
  trustBuffs: [],
  buffs: {
    // Lv 1..11 = enhanceLevel 0..10. v=120 at Lv11 → DMG_BOOST OAT_ADD → percent ÷10 = 12%.
    "BID_ITEM_STAT_OOPARTS_DMG_6": [
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 96 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 98 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 100 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 102 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 104 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 106 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 108 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 111 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 114 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 117 },
      { st: "ST_DMG_BOOST", ap: "OAT_ADD", v: 120 },
    ],
  },
};

const sample: RawUserItem = {
  ItemList: [
    {
      // T4, Exp=0 (= +0), not ascended. Sub values use (Level + 1) × per-tick.
      ItemUID: "1", CharUID: "0", ItemID: 754, Exp: 0, BreakLimitLevel: 4, Quantity: 1,
      SmeltingCount: 2, IsLock: 1, InvenType: 0, SelectSubOptionNum: 99,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0,
      OptionList: [24],
      SubOptionList: [
        { OptionID: 160009, Level: 3, BaseLevel: 1 }, // crit rate, displays as LV4 → 12%
        { OptionID: 160013, Level: 0, BaseLevel: 0 }, // speed, displays as LV1 → 3 SPD (1 proc)
        { OptionID: 0, Level: 0, BaseLevel: 0 },      // padding (skipped)
      ],
    },
    {
      // Same item, T4 +10 ascended +15 (SingStep=1, SingLevel=5).
      // mult = 1 + 0.4*10 + 0.15 + 0.6 (steps) = 5.75 ; × 1.20 (T4) = 6.90
      // Subs pinned against the user's actual capture + in-game readout.
      ItemUID: "1asc", CharUID: "0", ItemID: 754, Exp: 25000, BreakLimitLevel: 4, Quantity: 1,
      SmeltingCount: 9, IsLock: 1, InvenType: 0, SelectSubOptionNum: 99,
      SingularityOptionID: 300121, SingularityStep: 1, SingularityLevel: 5,
      OptionList: [24],
      SubOptionList: [
        { OptionID: 160009, Level: 5, BaseLevel: 2 }, // LV6 → 18%
        { OptionID: 160013, Level: 3, BaseLevel: 1 }, // LV4 → 12
      ],
    },
    {
      // Overdrive accessory unique +0 T0 — ST_BUFF_CHANCE OAT_ADD v=21
      // should display flat (EFF +21), NOT 2.1%. EFF/RES are context-dependent.
      ItemUID: "od", CharUID: "0", ItemID: 1764, Exp: 0, BreakLimitLevel: 0, Quantity: 1,
      SmeltingCount: 0, IsLock: 0, InvenType: 0, SelectSubOptionNum: 99,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0,
      OptionList: [1093, 0], SubOptionList: [],
    },
    {
      // Rogue's Charm talisman unique +10 — main is IOT_BUFF (buffId), resolved per level.
      // At enhanceLevel=10, Lv11 in BuffTemplet → ST_DMG_BOOST OAT_ADD v=120 → 12% DMG_UP.
      ItemUID: "tal", CharUID: "0", ItemID: 10203, Exp: 11910000, BreakLimitLevel: 0, Quantity: 1,
      SmeltingCount: 0, IsLock: 0, InvenType: 0, SelectSubOptionNum: 99,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0,
      OptionList: [10207, 0], SubOptionList: [],
    },
    {
      // Non-gear (no equipment lookup): dropped.
      ItemUID: "2", CharUID: "0", ItemID: 1, Exp: 0, BreakLimitLevel: 0, Quantity: 50,
      SmeltingCount: 0, IsLock: 0, InvenType: 0, SelectSubOptionNum: 0,
      SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0,
      OptionList: [0, 0], SubOptionList: [],
    },
  ],
};

describe("parseInventory", () => {
  it("keeps gear (by equipment table), drops non-gear", () => {
    expect(sample.ItemList.filter((i) => isGear(i, game))).toHaveLength(4);
    expect(parseInventory(sample, undefined, game).gear).toHaveLength(4);
  });

  it("resolves identity + equipment meta", () => {
    const g = parseInventory(sample, undefined, game).gear[0]!;
    expect(g.itemId).toBe(754);
    expect(g.slot).toBe("weapon");
    expect(g.rarity).toBe("unique");
    expect(g.star).toBe(6);
    expect(g.name).toBe("Surefire Greatsword");
    expect(g.setId).toBe("5");
    expect(g.breakthrough).toBe(4);
    expect(g.reforgeCount).toBe(2);
    expect(g.singularityLevel).toBe(0);
    expect(g.ascended).toBe(false);
    expect(g.enhanceLevel).toBe(0); // Exp=0
    expect(g.locked).toBe(true);
  });

  it("resolves substats: in-game LV = Level + 1, value = LV × per-tick", () => {
    const g = parseInventory(sample, undefined, game).gear[0]!;
    // Two real subs + one padding (OptionID=0) → 2 kept.
    expect(g.subs).toHaveLength(2);
    const crit = g.subs.find((s) => s.stat === "critRate")!;
    expect(crit.value).toBe(12); // (3+1) × 30 / 10
    expect(crit.percent).toBe(true);
    expect(crit.ticks).toBe(4); // Level + 1
    expect(crit.reforgeTicks).toBe(2); // 3 - 1 (no +1 here, raw delta)
    const spd = g.subs.find((s) => s.stat === "spd")!;
    expect(spd.value).toBe(3); // (0+1) × 3 — Level=0 is a real proc, not a placeholder
    expect(spd.ticks).toBe(1);
    expect(spd.reforgeTicks).toBe(0);
  });

  it("scales main stat: T4 +0 = base × 1 × 1.20", () => {
    const g = parseInventory(sample, undefined, game).gear[0]!;
    // ATK 200 base × (1 + 0.4*0) × (1 + 0.05*4) = 200 × 1.20 = 240
    expect(g.main[0]).toMatchObject({ stat: "atk", value: 240, percent: false });
  });

  it("Talisman (ooparts) main resolves via BuffTemplet at item's enhanceLevel", () => {
    const inv = parseInventory(sample, undefined, game);
    const tal = inv.gear.find((g) => g.uid === "tal")!;
    expect(tal.slot).toBe("ooparts");
    expect(tal.enhanceLevel).toBe(10); // Exp at the last bucket of ooparts|unique|6 curve
    expect(tal.main).toHaveLength(1);
    // Lv11 row: ST_DMG_BOOST OAT_ADD v=120 → 12% DMG_UP (percent, ÷10).
    expect(tal.main[0]).toMatchObject({ stat: "dmgUp", value: 12, percent: true });
  });

  it("EFF on accessory main is FLAT (OAT_ADD → not percent)", () => {
    const inv = parseInventory(sample, undefined, game);
    const od = inv.gear.find((g) => g.uid === "od")!;
    expect(od.slot).toBe("accessory");
    expect(od.main).toHaveLength(1);
    expect(od.main[0]).toMatchObject({ stat: "eff", value: 21, percent: false });
  });

  it("scales main + subs: T4 +15 ascended Surefire pinned to in-game readout", () => {
    const g = parseInventory(sample, undefined, game).gear[1]!;
    expect(g.ascended).toBe(true);
    expect(g.enhanceLevel).toBe(15);
    expect(g.singularityLevel).toBe(5);
    // Main: 200 × (1 + 0.4*10 + 0.15 + 0.6) × 1.20 = 200 × 6.90 = 1380
    expect(g.main[0]).toMatchObject({ stat: "atk", value: 1380, percent: false });
    // Subs pinned to the user-screenshot validation: Crit LV6 = 18%, SPD LV4 = 12
    const crit = g.subs.find((s) => s.stat === "critRate")!;
    expect(crit.value).toBe(18);
    const spd = g.subs.find((s) => s.stat === "spd")!;
    expect(spd.value).toBe(12);
  });
});

describe("projectMainToCeiling", () => {
  // The +0 weapon (main ATK 240) and its +15-ascended twin (ATK 1380) are
  // pinned to the real in-game readout above — so projecting the +0 piece to
  // the ascended ceiling must reproduce exactly 1380 (validates the
  // recover-base-via-multiplier-ratio approach against ground truth).
  const ASCENDED = { enhanceLevel: 15, ascended: true, singularityLevel: 5 };
  const CLASSIC = { enhanceLevel: 10, ascended: false, singularityLevel: 0 };

  it("projects a +0 main to the +15 ascended ceiling, matching the parsed +15 piece", () => {
    const base = parseInventory(sample, undefined, game).gear[0]!; // +0, ATK 240
    const projected = projectMainToCeiling(base, game, ASCENDED);
    expect(projected.main[0]).toMatchObject({ stat: "atk", value: 1380 });
    expect(projected.enhanceLevel).toBe(15);
    expect(projected.ascended).toBe(true);
  });

  it("projects a +0 main to the +10 classic ceiling (mult 5×1.20)", () => {
    const base = parseInventory(sample, undefined, game).gear[0]!; // +0, ATK 240
    const projected = projectMainToCeiling(base, game, CLASSIC);
    // 240 / 1.20 × (1 + 0.4*10) × 1.20 = 240 × 5 = 1200
    expect(projected.main[0]).toMatchObject({ stat: "atk", value: 1200 });
    expect(projected.enhanceLevel).toBe(10);
  });

  it("never downgrades: a +15 ascended piece previewed as classic is untouched", () => {
    const asc = parseInventory(sample, undefined, game).gear[1]!; // +15 ascended, ATK 1380
    const projected = projectMainToCeiling(asc, game, CLASSIC);
    expect(projected).toBe(asc); // identity — no change
    expect(projected.main[0]).toMatchObject({ stat: "atk", value: 1380 });
  });

  it("leaves Talisman (ooparts) mains untouched (enhance doesn't scale them)", () => {
    const tal = parseInventory(sample, undefined, game).gear.find((g) => g.uid === "tal")!;
    expect(projectMainToCeiling(tal, game, ASCENDED)).toBe(tal); // identity
  });
});
