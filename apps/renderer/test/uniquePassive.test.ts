/// <reference types="node" />
// Weapon / accessory unique passives on the sheet (`source: "uniquePassive"`,
// `fromBuff`): Phantasm Necrosis' SPD −30 % goes on the speed buff rate
// (`buffPct.spdRate`, summed with the hero's rate and applied once, last), never
// as −30 flat SPD; Briareos's Ambition's RES rate already reaches
// `composeMultStat` as `gearBuffPct` through `buffPct.effRes`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeCharStats, type CharactersTable, type CodexCurve, type GearPiece, type RolledStat, type StatScaling } from "@gear-solver/core";
import {
  aggregateGearBuckets,
  aggregatePrefixBuckets,
  composeMultStat,
  computeFinalStats,
  computeFinalStatsFromPrefix,
  computeSetBonuses,
  type FinalStatsBaseline,
  type ScalingMap,
} from "../src/lib/composeBuild.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import { pruneDominatedForCp } from "../src/lib/solver/engine.js";
import { toUiPiece } from "../src/design/adapter.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));

const piece = (slot: GearPiece["slot"], main: RolledStat[], subs: RolledStat[] = [], uid = `p-${slot}`): GearPiece => ({
  uid, itemId: 1, slot, setId: null, armorSetId: null,
  rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: null, main, subs,
});
const atkMain: RolledStat = { stat: "atkPct", value: 60, percent: true, source: "option" };
const phantasm: RolledStat = { stat: "spd", value: -30, percent: true, fromBuff: true, source: "uniquePassive" };
const briareos = (value: number): RolledStat => ({ stat: "effRes", value, percent: true, fromBuff: true, source: "uniquePassive" });

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
// A sheet at 220 SPD with no other speed rate.
const SCALING: ScalingMap = { atk: sc(3000), def: sc(800), hp: sc(8000), eff: sc(120), res: sc(150), spd: { value: 220, buffPct: 0 } };
const BASELINE: FinalStatsBaseline = { spd: 220, chc: 60, chd: 180, pen: 10, dmgInc: 0, dmgRed: 0 };

describe("Phantasm Necrosis — SPD −30 % on the speed buff rate", () => {
  it("lands in buffPct.spdRate, not in the flat buffPct.spd (EE flat SPD)", () => {
    const b = aggregateGearBuckets([piece("weapon", [atkMain, phantasm])], null);
    expect(b.buffPct.spdRate).toBe(-30);
    expect(b.buffPct.spd).toBeUndefined();
  });

  it("220 SPD with the weapon → 154 (220 × 0.7)", () => {
    expect(computeFinalStats(BASELINE, SCALING, [piece("weapon", [atkMain])], null).spd).toBe(220);
    expect(computeFinalStats(BASELINE, SCALING, [piece("weapon", [atkMain, phantasm])], null).spd).toBe(154);
  });

  it("fused Snow (core rate +4.3 %) with the weapon → trunc(total × 743 / 1000), one rate", () => {
    const characters = derived("characters.json") as CharactersTable;
    const codexCurve = derived("codex-curve.json") as CodexCurve;
    const c = composeCharStats(characters["2700003"]!.ingredients!, codexCurve, { level: 100, levelMaxStep: 0, levelMaxModifier: 0 });
    expect(c.scaling.spd).toEqual({ value: 149, buffPct: 4.3 });
    const boots = piece("boots", [{ stat: "spd", value: 45, percent: false, source: "option" }]);
    const fs = computeFinalStats(c.noGearStats, c.scaling, [piece("weapon", [atkMain, phantasm]), boots], null);
    expect(fs.spd).toBe(Math.trunc((149 + 45) * 743 / 1000));
  });

  it("the incremental path (computeFinalStatsFromPrefix) stays bit-identical", () => {
    const prefix = [
      piece("weapon", [atkMain, phantasm], [{ stat: "spd", value: 4, percent: false }]),
      piece("boots", [{ stat: "spd", value: 45, percent: false, source: "option" }]),
      piece("accessory", [{ stat: "critDmg", value: 37.4, percent: true, source: "option" }, briareos(40)]),
    ];
    const talisman = piece("ooparts", [], [{ stat: "spd", value: 5, percent: false }]);
    const ee = piece("exclusive", [{ stat: "spd", value: 40, percent: false, fromBuff: true, source: "option" }]);
    const all = [...prefix, talisman, ee];
    const full = computeFinalStats(BASELINE, SCALING, all, null);
    const inc = computeFinalStatsFromPrefix(BASELINE, SCALING, aggregatePrefixBuckets(prefix), talisman, ee, undefined, computeSetBonuses(all, null));
    expect(inc).toEqual(full);
    expect(full.spd).toBe(Math.trunc((220 + 4 + 45 + 5 + 40) * 700 / 1000));
  });

  it("CP: the weapon's speed loss is counted (cited in the changelog)", () => {
    const cp = (pieces: GearPiece[]) => calcBattlePower({
      stats: computeFinalStats(BASELINE, SCALING, pieces, null),
      showUIStar: 6, starPlus: 0, skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 },
      ee: null, ooparts: null, fused: false,
    });
    const without = cp([piece("weapon", [atkMain])]);
    const withIt = cp([piece("weapon", [atkMain, phantasm])]);
    expect([without, withIt]).toEqual([36135, 31371]); // −4 764 CP, 220 → 154 SPD
  });

  it("dominance: of two weapons identical but for the speed rate, the negative one is eliminated", () => {
    const plain = piece("weapon", [atkMain], [], "plain");
    const slowed = piece("weapon", [atkMain, phantasm], [], "slowed");
    expect(pruneDominatedForCp([plain, slowed], () => "g").map((p) => p.uid)).toEqual(["plain"]);
    expect(pruneDominatedForCp([slowed, plain], () => "g").map((p) => p.uid)).toEqual(["plain"]);
  });

  it("is hidden from the displayed mains (the passive text already says it)", () => {
    const ui = toUiPiece(piece("weapon", [atkMain, phantasm]));
    expect(ui.main).toHaveLength(1);
    expect(ui.effects).toHaveLength(0);
  });
});

describe("Briareos's Ambition — RES rate through gearBuffPct", () => {
  it("breakthrough 4 (+40 %) → RES = composeMultStat(res, 0, 0, 40)", () => {
    const b = aggregateGearBuckets([piece("accessory", [briareos(40)])], null);
    expect(b.buffPct.effRes).toBe(40);
    const fs = computeFinalStats(BASELINE, SCALING, [piece("accessory", [briareos(40)])], null);
    expect(fs.effRes).toBe(composeMultStat(SCALING.res, 0, 0, 40));
    expect(fs.effRes).toBe(210); // trunc(150 × 1.4)
  });
});
