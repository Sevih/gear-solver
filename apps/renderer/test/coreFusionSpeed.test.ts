/// <reference types="node" />
// Core Fusion SPD rate with gear, on the real contract (`data/derived/`): the
// client multiplies the WHOLE speed — base, evolutions, gear — by the buff rate
// once, last (`trunc(total × (1000 + 43) / 1000)` for Snow and Lisha). The
// gear-side composer must take the speed before that rate from the composer
// (`scaling.spd`), never re-add gear onto the already-multiplied no-gear speed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeCharStats, type CharactersTable, type CodexCurve, type GearPiece, type RolledStat } from "@gear-solver/core";
import {
  aggregatePrefixBuckets,
  computeFinalStats,
  computeFinalStatsFromPrefix,
  computeSetBonuses,
} from "../src/lib/composeBuild.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));
const characters = derived("characters.json") as CharactersTable;
const codexCurve = derived("codex-curve.json") as CodexCurve;
const charLevelMax = derived("char-level-max.json") as Record<string, { maxLevel: number; statModifierAfter100: number }>;

const compose = (id: string, level = 100, step = 0) =>
  composeCharStats(characters[id]!.ingredients!, codexCurve, {
    level, levelMaxStep: step, levelMaxModifier: step > 0 ? charLevelMax[`3|${step}`]!.statModifierAfter100 : 0,
  });

const piece = (slot: GearPiece["slot"], main: RolledStat[], subs: RolledStat[] = []): GearPiece => ({
  uid: `p-${slot}`, itemId: 1, slot, setId: null, armorSetId: null,
  rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: null, main, subs,
});
const flatSpd = (value: number): RolledStat => ({ stat: "spd", value, percent: false });

describe("Core Fusion SPD rate — applied once, on the total with gear", () => {
  it("fused Snow lv100 + 40 flat SPD → 197 (trunc((149 + 40) × 1.043)), not 155 + 40", () => {
    const c = compose("2700003");
    expect(c.noGearStats.spd).toBe(155);
    expect(c.scaling.spd).toEqual({ value: 149, rateBase: 149, buffPct: 4.3 });
    const fs = computeFinalStats(c.noGearStats, c.scaling, [piece("boots", [flatSpd(40)])], null);
    expect(fs.spd).toBe(197);
  });

  it("without gear, the gear side lands on the no-gear speed", () => {
    for (const id of ["2700003", "2700005"]) {
      const c = compose(id);
      expect(computeFinalStats(c.noGearStats, c.scaling, [], null).spd).toBe(c.noGearStats.spd);
    }
  });

  it("fused Lisha: 124 at every level, without gear", () => {
    for (let lv = 1; lv <= 120; lv++) {
      const step = lv <= 100 ? 0 : lv <= 105 ? 1 : lv <= 110 ? 2 : 3;
      const c = compose("2700005", lv, step);
      expect(computeFinalStats(c.noGearStats, c.scaling, [], null).spd, `lv${lv}`).toBe(124);
    }
  });

  it("the incremental path (computeFinalStatsFromPrefix) is bit-identical, rate included", () => {
    const c = compose("2700003");
    const prefix = [
      piece("weapon", [{ stat: "atkPct", value: 61.8, percent: true }], [flatSpd(4)]),
      piece("helmet", [{ stat: "hp", value: 1800, percent: false }], [flatSpd(3)]),
      piece("armor", [{ stat: "def", value: 300, percent: false }]),
      piece("gloves", [{ stat: "critRate", value: 30, percent: true }], [flatSpd(7)]),
      piece("boots", [flatSpd(45)]),
      piece("accessory", [{ stat: "critDmg", value: 37.4, percent: true }], [flatSpd(2)]),
    ];
    const talisman = piece("ooparts", [], [flatSpd(5)]);
    const ee = piece("exclusive", [{ stat: "spd", value: 40, percent: false, fromBuff: true } as RolledStat]);
    const all = [...prefix, talisman, ee];
    const full = computeFinalStats(c.noGearStats, c.scaling, all, null);
    const inc = computeFinalStatsFromPrefix(c.noGearStats, c.scaling, aggregatePrefixBuckets(prefix), talisman, ee, undefined, computeSetBonuses(all, null));
    expect(inc).toEqual(full);
    // 149 + 4 + 3 + 7 + 45 + 2 + 5 + 40 = 255, × 1.043 → 265
    expect(full.spd).toBe(Math.trunc(255 * 1043 / 1000));
  });

  it("a hero without a speed rate keeps today's plain sum", () => {
    const c = compose("2000003"); // unfused Snow
    expect(c.scaling.spd.buffPct).toBe(0);
    const fs = computeFinalStats(c.noGearStats, c.scaling, [piece("boots", [flatSpd(40)])], null);
    expect(fs.spd).toBe(c.noGearStats.spd + 40);
  });
});
