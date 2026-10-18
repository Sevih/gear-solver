import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, RolledStat, SetCombatEffect, StatScaling } from "@gear-solver/core";
import { combatEffectLines } from "../src/lib/setCombatEffects.js";
import { computeFinalStats, type FinalStatsBaseline, type ScalingMap } from "../src/lib/composeBuild.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import setsJson from "../../../data/derived/sets.json";

// The real set catalog (outerpedia B53 `combatEffects`), not a fixture.
const SETS = setsJson as unknown as GameData["sets"];
const FORTIFICATION = "8", REVENGE = "15", PULVERIZATION = "17", IMMUNITY = "18", WEAKNESS = "20";

function effects(setId: string, level: number, tier: "p2" | "p4"): SetCombatEffect[] {
  const row = SETS[setId]!.levels.find((l) => l.level === level)!;
  const list = row.combatEffects?.[tier];
  if (!list) throw new Error(`set ${setId} L${level} ${tier}: no combat effect`);
  return list;
}

describe("combatEffectLines", () => {
  it("Weakness L2 → damage reduction on enemies, signed", () => {
    expect(combatEffectLines(effects(WEAKNESS, 2, "p2"))).toEqual(["Damage reduction −35% · enemies"]);
  });

  it("Immunity L1 → no value", () => {
    expect(combatEffectLines(effects(IMMUNITY, 1, "p2"))).toEqual(["Debuff immunity"]);
  });

  it("Fortification L1 → two lines, the stat by its label", () => {
    expect(combatEffectLines(effects(FORTIFICATION, 1, "p2"))).toEqual(["Damage reduction +40%", "SPD −30%"]);
  });

  it("Revenge L2 → ATK by missing HP, up to the maximum", () => {
    expect(combatEffectLines(effects(REVENGE, 2, "p4"))).toEqual(["ATK by missing HP, up to +160%"]);
  });

  it("Pulverization L1 → damage vs Broken targets", () => {
    expect(combatEffectLines(effects(PULVERIZATION, 1, "p2"))).toEqual(["Damage vs Broken targets +35%"]);
  });

  it("an unknown type → its raw enum", () => {
    const e: SetCombatEffect = { buffId: "X", type: "BT_SOMETHING_NEW", ap: "OAT_RATE", v: 150, target: "ME" };
    expect(combatEffectLines([e])).toEqual(["BT_SOMETHING_NEW +15%"]);
    expect(combatEffectLines([{ ...e, v: undefined, target: "ENEMY_TEAM" }])).toEqual(["BT_SOMETHING_NEW · enemies"]);
  });
});

// Guard: `combatEffects` is display only — the sheet and the CP of a build are
// the same with and without the field in the data.
describe("combat effects never reach the sheet nor the CP", () => {
  const sc = (baseValue: number): StatScaling => ({
    baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
  });
  const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
  const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
  const ARMOR = ["helmet", "armor", "gloves", "boots"];
  const main = (stat: string, value: number, percent: boolean) => ({ stat, value, percent }) as RolledStat;

  const STRIPPED = Object.fromEntries(Object.entries(SETS).map(([id, def]) => [id, {
    ...def, levels: def.levels.map(({ combatEffects: _c, ...l }) => l),
  }])) as GameData["sets"];
  const game = (sets: GameData["sets"]) => ({ options: {}, equipment: {}, sets, equipmentPassives: {} }) as unknown as GameData;

  function sheetAndCp(setId: string, bts: number[], sets: GameData["sets"]) {
    const pieces = [
      { slot: "weapon", main: [main("atk", 500, false)] },
      ...bts.map((bt, i) => ({ slot: ARMOR[i], armorSetId: setId, breakthrough: bt, main: [main("hp", 2000, false)] })),
      { slot: "accessory", main: [main("critDmg", 45, true)] },
    ].map((p) => ({ breakthrough: 0, armorSetId: null, subs: [], ...p }) as unknown as GearPiece);
    const stats = computeFinalStats(BASELINE, SCALING, pieces, game(sets));
    const cp = calcBattlePower({
      stats, showUIStar: 5, starPlus: 1, skills: { first: 3, second: 2, ultimate: 4, chainPassive: 1 },
      ee: null, ooparts: null, fused: false,
    });
    return { stats, cp };
  }

  const cases: Array<[string, string, number[]]> = [
    ["Pulverization 4P", PULVERIZATION, [4, 4, 4, 4]],
    ["Pulverization 4P", PULVERIZATION, [3, 3, 3, 3]],
    ["Weakness 2P", WEAKNESS, [4, 4]],
    ["Weakness 2P", WEAKNESS, [0, 0]],
  ];
  for (const [label, setId, bts] of cases) {
    it(`${label} at BT [${bts.join(",")}]`, () => {
      expect(SETS[setId]!.levels.some((l) => l.combatEffects?.p2)).toBe(true);
      expect(sheetAndCp(setId, bts, SETS)).toEqual(sheetAndCp(setId, bts, STRIPPED));
    });
  }
});
