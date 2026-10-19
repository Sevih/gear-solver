/// <reference types="node" />
// Sheet minors of the October review, one block per point: the Speed set's
// rate base, CHC bounded on the sheet (raw sum kept for the crit-cap reads),
// CP in the client's float32 chain, buff-routed flats on CalcFinalStat's
// `BuffValue`, and `composeMultStat` = core's `calcFinalStat` exactly.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composeCharStats,
  type CharactersTable,
  type CodexCurve,
  type GameData,
  type GearPiece,
  type Inventory,
  type RolledStat,
  type StatScaling,
} from "@gear-solver/core";
import {
  aggregateGearBuckets,
  composeMultStat,
  computeFinalStats,
  type FinalStatsBaseline,
  type ScalingMap,
} from "../src/lib/composeBuild.js";
import { computeAdvice } from "../src/lib/buildAdvice.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import { pruneDominatedForCp, solveChunk, type SolveContext } from "../src/lib/solver/engine.js";
import type { ScoredGem } from "../src/lib/solver/gems.js";
import { computeCheapRatings } from "../src/lib/solver/ratings.js";
import type { SolveFilters, SolveRequest } from "../src/lib/solver/types.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));
const characters = derived("characters.json") as CharactersTable;
const codexCurve = derived("codex-curve.json") as CodexCurve;
const sets = derived("sets.json") as GameData["sets"];

const piece = (slot: GearPiece["slot"], main: RolledStat[], subs: RolledStat[] = [], armorSetId: string | null = null): GearPiece => ({
  uid: `p-${slot}`, itemId: 1, slot, setId: null, armorSetId,
  rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: null, main, subs,
});
const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(120), res: sc(100) };
const baseline = (chc: number): FinalStatsBaseline => ({ spd: 100, chc, chd: 150, pen: 0, dmgInc: 0, dmgRed: 0 });
const crc = (value: number): RolledStat => ({ stat: "critRate", value, percent: true });

describe("1. Speed set — the rate multiplies base + evo + IOT_STAT geas, not the OAT_ADD buffs", () => {
  // Skill_8 +10 SPD (OAT_ADD) sits outside the client's sum_flat: 4P Speed
  // (+25 %) on Claire is trunc(99 × 1.25) + 10 = 133, not trunc(109 × 1.25) = 136.
  it.each([["2000017", "Claire", 133], ["2000027", "Faenan", 137], ["2000100", "Delta", 146]])(
    "%s (%s) in 4P Speed → %i",
    (id, _name, expected) => {
      const c = composeCharStats(characters[id]!.ingredients!, codexCurve, { level: 100, transStar: null });
      expect(c.noGearStats.spd - c.scaling.spd.rateBase).toBe(10);
      const pieces = (["helmet", "armor", "gloves", "boots"] as const).map((s) => piece(s, [], [], "13"));
      const fs = computeFinalStats(c.noGearStats, c.scaling, pieces, { sets } as GameData);
      expect(fs.spd).toBe(expected);
    },
  );
});

describe("2. CHC bounded to [0, 100] on the sheet, the raw sum kept apart", () => {
  it("95 + 10 → critRate 100, critRateUncapped 105", () => {
    const fs = computeFinalStats(baseline(95), SCALING, [piece("gloves", [], [crc(10)])], null);
    expect(fs.critRate).toBe(100);
    expect(fs.critRateUncapped).toBe(105);
  });

  it("the crc secondary scaling (Regina) reads the bounded value: 130 raw = 100", () => {
    const sec = [{ stat: "crc" as const, ratio: 10 }];
    const at100 = computeFinalStats(baseline(70), SCALING, [piece("gloves", [], [crc(30)])], null);
    const at130 = computeFinalStats(baseline(70), SCALING, [piece("gloves", [], [crc(60)])], null);
    expect(at130.critRateUncapped).toBe(130);
    expect(computeCheapRatings(at130, "atk", sec).dmg).toBe(computeCheapRatings(at100, "atk", sec).dmg);
  });

  it("the waste advice reads the raw sum", () => {
    const fs = computeFinalStats(baseline(95), SCALING, [piece("gloves", [], [crc(17.5)])], null);
    const SLOTS = ["weapon", "accessory", "helmet", "armor", "gloves", "boots"] as const;
    const out = computeAdvice({
      equipped: new Map(SLOTS.map((s) => [s, true])),
      rawPieces: SLOTS.map((s) => ({ ...piece(s, []), reforgeCount: 9, ascended: true })),
      stats: fs,
      inventoryPieces: [],
      heroUid: "h",
      dmgStat: "atk",
    }, null);
    expect(out).toContainEqual({ tone: "warn", text: "Crit rate 112.5% — 10.5% wasted over the 102% cap" });
  });

  it("the solver's overshoot reallocation reads the raw sum (sheet 100, raw 107 → crit gems trimmed)", async () => {
    const gem = (id: number, stat: string, score: number): ScoredGem => ({ id, stat, value: stat === "critRate" ? 3 : 6, percent: true, score });
    const scoredGems = [gem(1, "critRate", 100), gem(2, "critRate", 100), gem(3, "critRate", 100), gem(4, "critRate", 100), gem(9, "atkPct", 50)];
    // The crit-blind default allocation: four crit gems + one ATK% (95 + 12 = 107).
    const defaultDelta = { flat: {}, pct: { critRate: 12, atkPct: 6 } };
    const filters: SolveFilters = {
      options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
      excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100,
      mainPicks: {}, setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
    };
    const skills = { first: 1, second: 1, ultimate: 1, chainPassive: 1 };
    const req: SolveRequest = {
      type: "solve", solveId: 1, mode: "score", heroUid: "hero",
      inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
      game: {} as GameData, userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: skills,
      filters, topK: 10, chunkIndex: 0, chunkCount: 1,
    };
    const ctx: SolveContext = {
      req, baseline: baseline(95), scaling: SCALING, ee: null, poolSizes: {}, scoredGems,
      pools: Object.fromEntries((["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const)
        .map((s) => [s, [{ ...piece(s, []), uid: s }]])) as SolveContext["pools"],
      gemDeltaByTalismanSlots: new Map([[5, defaultDelta]]),
      gemAllocByTalismanSlots: new Map([[5, { talisman: [1, 2, 3, 4, 9], ee: [] }]]),
      skills, starMeta: { showUIStar: 6, starPlus: 0, fused: false }, dmgStat: "atk", noCrit: false, skillFactor: 1,
      setPlans: [], excludedSets: new Set(), allowBrokenSets: true,
      excludedWeaponEffects: new Set(), excludedAccessoryEffects: new Set(), reforgeTickWeights: null,
    };
    const { builds } = await solveChunk(ctx, 0, 1, 1000);
    expect(builds).toHaveLength(1);
    // 95 → 98 → 101: two crit gems, then the ATK% one; the rest is wasted.
    expect(builds[0]!.gemAllocation.talisman).toEqual([1, 2, 9, 0, 0]);
    expect(builds[0]!.finalStats.critRateUncapped).toBe(101);
    expect(builds[0]!.finalStats.critRate).toBe(100);
  });
});

describe("3. CP in the client's float32 chain", () => {
  // Sheets where the former double computation came out 1 below the client
  // (review replay, CalcBattlePower in float32).
  const SKILLS = { first: 5, second: 5, ultimate: 5, chainPassive: 5 };
  it.each([
    [92267, { atk: 4206, def: 2166, hp: 17633, spd: 191, critRate: 41.2, critDmg: 331.5, pen: 46.7, eff: 307, effRes: 310, dmgUp: 15, dmgReduce: 39.5, critDmgReduce: 22.3 }],
    [40334, { atk: 3227, def: 1380, hp: 5969, spd: 274, critRate: 3.6, critDmg: 250, pen: 23.7, eff: 145, effRes: 61, dmgUp: 19.6, dmgReduce: 36.5, critDmgReduce: 24.9 }],
    [36374, { atk: 3557, def: 603, hp: 5578, spd: 274, critRate: 36.2, critDmg: 245.3, pen: 32.6, eff: 6, effRes: 287, dmgUp: 18.9, dmgReduce: 23.6, critDmgReduce: 6.8 }],
  ])("→ %i", (expected, stats) => {
    expect(calcBattlePower({ stats, showUIStar: 6, starPlus: 3, skills: SKILLS, ee: null, ooparts: null, fused: false })).toBe(expected);
  });
});

describe("4. Buff-routed flats go to CalcFinalStat's BuffValue", () => {
  it("a flat ATK buff counts (it was dropped)", () => {
    const ee = piece("exclusive", [{ stat: "atk", value: 100, percent: false, fromBuff: true }]);
    const b = aggregateGearBuckets([ee], null);
    expect(b.buffFlat.atk).toBe(100);
    expect(b.buffPct.atk).toBeUndefined();
    const fs = computeFinalStats(baseline(10), SCALING, [ee], null);
    expect(fs.atk).toBe(composeMultStat(SCALING.atk, 0, 0, 0, 100));
    expect(fs.atk).toBe(1300);
  });

  it("an OAT_ADD EFF buff is a flat, not a rate: 120 + 30 = 150 (not 120 × 1.3 = 156)", () => {
    const ee = piece("exclusive", [{ stat: "eff", value: 30, percent: false, fromBuff: true }]);
    expect(computeFinalStats(baseline(10), SCALING, [ee], null).eff).toBe(150);
    const rate = piece("exclusive", [{ stat: "eff", value: 30, percent: true, fromBuff: true }]);
    expect(computeFinalStats(baseline(10), SCALING, [rate], null).eff).toBe(156);
  });

  it("CP dominance compares the buff flats: a piece with a flat ATK buff is never dropped for a bare one", () => {
    const bare = { ...piece("weapon", []), uid: "bare" };
    const buffed = { ...piece("weapon", [{ stat: "atk", value: 100, percent: false, fromBuff: true }]), uid: "buffed" };
    expect(pruneDominatedForCp([bare, buffed], () => "g").map((p) => p.uid)).toEqual(["buffed"]);
  });
});

describe("7. composeMultStat is core's calcFinalStat — exact on every committed hero", () => {
  // The renderer's former private copy of CalcFinalStat, kept here as the
  // reference: codex as `base × codexPct / 100`, rates summed in this order.
  const former = (s: StatScaling, gearFlat: number, gearPct: number, gearBuffPct: number): number => {
    const sumFlat = s.baseValue + s.evoValue + s.awakValue;
    const sumRate = s.awakPct * 10 + s.transcendPct * 10 + gearPct * 10;
    const part1 = Math.trunc(sumFlat * (1000 + sumRate) / 1000);
    const combined = part1 + gearFlat + s.buffValue;
    const part2 = Math.trunc(combined * (1000 + (s.buffPct + gearBuffPct) * 10) / 1000);
    return Math.max(0, part2 + Math.trunc(s.baseValue * s.codexPct / 100));
  };
  it("heroes × codex levels × gear values: 0 difference", () => {
    const FLATS = [0, 37, 600, 4999];
    const PCTS = [0, 1.1, 6.6, 12.3, 33.3, 121.4];
    const BUFFS = [0, 8.8, 40];
    let n = 0;
    const diffs: string[] = [];
    for (const [id, c] of Object.entries(characters)) {
      if (!c.ingredients) continue;
      for (let codexLevel = 0; codexLevel < codexCurve.length; codexLevel++) {
        const { scaling } = composeCharStats(c.ingredients, codexCurve, { codexLevel });
        for (const ax of ["atk", "def", "hp", "eff", "res"] as const) {
          for (const f of FLATS) for (const p of PCTS) for (const b of BUFFS) {
            n++;
            if (composeMultStat(scaling[ax], f, p, b) !== former(scaling[ax], f, p, b)) diffs.push(`${id} ${ax} codex ${codexLevel} ${f}/${p}/${b}`);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(400_000);
    expect(diffs).toEqual([]);
  });
});
