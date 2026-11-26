/// <reference types="node" />
// « Simulate 50% HP » (G146): the lost-HP sets — Revenge (15, ATK), Patience
// (16, DEF), Swiftness (19, SPD) — counted as if the wearer were at a given HP
// fraction. The pure value (`lostHpRateValue`, the client's integer formula),
// the sheet on the real set catalog (`data/derived/sets.json`: ATK / DEF in
// the buff rate, SPD in the speed buff rate, the CP never), the tooltip line,
// and a full solve on the real contract as the orchestrator runs it, on one
// chunk: a Min SPD only Swiftness reaches is met with the setting, missed
// without it, the CP the same.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGearPiece, type GameData, type GearPiece, type Inventory, type RawItem, type RolledStat, type SetCombatEffect, type SpeedScaling, type StatScaling } from "@gear-solver/core";
import {
  computeFinalStats, computeFinalStatsInTeam, lostHpRateValue, lostHpSetBuffs, SIMULATED_HP_FRACTION,
  type FinalStatsBaseline, type LostHpFraction, type ScalingMap,
} from "../src/lib/composeBuild.js";
import { combatEffectLines } from "../src/lib/setCombatEffects.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import { buildSolveFilters, filterDefaults, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { compareBuilds, finalizeBuilds, precomputeContext, sheetUpperBound, solveChunk } from "../src/lib/solver/engine.js";
import { solveArgsOf } from "../src/lib/solver/solveArgs.js";
import type { SolveBuild, SolveMode, SolveRequest } from "../src/lib/solver/types.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));

const GAME = {
  options: derived("options.json"), equipment: derived("equipment.json"), sets: derived("sets.json"),
  equipmentPassives: derived("equipment-passives.json"), multiTierPassives: derived("multi-tier-passives.json"),
  gems: derived("gems.json"), singularityOptions: derived("singularity-options.json"),
  eePassives: derived("ee-passives.json"), characters: derived("characters.json"), enhance: derived("enhance.json"),
  buffs: derived("buffs.json"), expCharacter: derived("exp-character.json"), charLevelMax: derived("char-level-max.json"),
  codexCurve: derived("codex-curve.json"), archiveBonus: derived("archive-bonus.json"),
  trustCharacter: derived("trust-character.json"), trustBuffs: derived("trust-buffs.json"), subTicks: derived("sub-ticks.json"),
} as unknown as GameData;
const SETS = GAME.sets;
const REVENGE = "15", PATIENCE = "16", SWIFTNESS = "19", WEAKNESS = "20";

function effects(setId: string, level: number, tier: "p2" | "p4"): SetCombatEffect[] {
  const list = SETS[setId]!.levels.find((l) => l.level === level)!.combatEffects?.[tier];
  if (!list) throw new Error(`set ${setId} L${level} ${tier}: no combat effect`);
  return list;
}

describe("lostHpRateValue — the client's formula on a 1000-HP scale", () => {
  const L1 = "BT_STAT_OWNER_LOST_HP_RATE", HALF = "BT_STAT_OWNER_LOST_HP_RATE_HALF";

  it("at 50 % HP: level 1 gives v / 2, _HALF its whole v", () => {
    expect(lostHpRateValue(L1, 1600, 0.5)).toBe(800);
    expect(lostHpRateValue(L1, 1000, 0.5)).toBe(500);
    expect(lostHpRateValue(HALF, 1600, 0.5)).toBe(1600);
    expect(lostHpRateValue(HALF, 1000, 0.5)).toBe(1000);
  });

  it("at full HP: 0; at 0 HP: v; _HALF over 50 %: 2·HP − MaxHP", () => {
    for (const t of [L1, HALF]) {
      expect(lostHpRateValue(t, 1600, 1)).toBe(0);
      expect(lostHpRateValue(t, 1600, 0)).toBe(1600);
    }
    expect(lostHpRateValue(HALF, 1600, 0.75)).toBe(800);
    expect(lostHpRateValue(HALF, 1600, 0.25)).toBe(1600);
    expect(lostHpRateValue(L1, 1600, 0.75)).toBe(400);
  });

  it("truncates like the client's integer division, the fraction rounded to ‰ and held in [0, 1]", () => {
    expect(lostHpRateValue(L1, 7, 0.5)).toBe(3);
    expect(lostHpRateValue(L1, 1000, 1 / 3)).toBe(667);
    expect(lostHpRateValue(L1, 1600, 0.3335)).toBe(1065);
    expect(lostHpRateValue(L1, 1600, 1.2)).toBe(0);
    expect(lostHpRateValue(L1, 1600, -0.5)).toBe(1600);
  });

  it("another type is no lost-HP effect", () => {
    expect(lostHpRateValue("BT_STAT", 1600, 0.5)).toBeNull();
  });
});

describe("combatEffectLines — the value counted at 50 % HP", () => {
  it("setting on: the counted value follows the lost-HP line", () => {
    expect(combatEffectLines(effects(REVENGE, 2, "p4"), 0.5)).toEqual(["ATK by missing HP, up to +160%", "counted at 50% HP: ATK +160%"]);
    expect(combatEffectLines(effects(REVENGE, 1, "p4"), 0.5)).toEqual(["ATK by missing HP, up to +160%", "counted at 50% HP: ATK +80%"]);
    expect(combatEffectLines(effects(SWIFTNESS, 1, "p2"), 0.5)).toEqual(["SPD by missing HP, up to +100%", "counted at 50% HP: SPD +50%"]);
    expect(combatEffectLines(effects(PATIENCE, 2, "p4"), 0.5)).toEqual(["DEF by missing HP, up to +160%", "counted at 50% HP: DEF +160%"]);
  });

  it("setting off, or another effect: the lines as before", () => {
    expect(combatEffectLines(effects(REVENGE, 2, "p4"))).toEqual(["ATK by missing HP, up to +160%"]);
    expect(combatEffectLines(effects(WEAKNESS, 2, "p2"), 0.5)).toEqual(["Damage reduction −35% · enemies"]);
  });
});

describe("the sheet with the lost-HP sets at 50 % HP — real set catalog", () => {
  const sc = (baseValue: number): StatScaling => ({
    baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
  });
  const SPD: SpeedScaling = { value: 100, rateBase: 100, buffPct: 0 } as SpeedScaling;
  const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100), spd: SPD };
  const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
  const ARMOR = ["helmet", "armor", "gloves", "boots"];
  const main = (stat: string, value: number, percent: boolean) => ({ stat, value, percent }) as RolledStat;

  /** Weapon, the armor pieces of `setId` at breakthroughs `bts` (boots with
   *  +40 flat SPD), accessory. */
  function sheet(setId: string, bts: number[], hp: LostHpFraction) {
    const pieces = [
      { slot: "weapon", main: [main("atk", 500, false)] },
      ...bts.map((bt, i) => ({ slot: ARMOR[i], armorSetId: setId, breakthrough: bt, main: [ARMOR[i] === "boots" ? main("spd", 40, false) : main("hp", 2000, false)] })),
      { slot: "accessory", main: [main("critDmg", 45, true)] },
    ].map((p) => ({ breakthrough: 0, armorSetId: null, subs: [], ...p }) as unknown as GearPiece);
    const game = { options: {}, equipment: {}, sets: SETS, equipmentPassives: {} } as unknown as GameData;
    const stats = computeFinalStatsInTeam(BASELINE, SCALING, pieces, game, [], hp);
    const own = computeFinalStats(BASELINE, SCALING, pieces, game);
    const cpOf = (s: typeof own) => calcBattlePower({
      stats: s, showUIStar: 5, starPlus: 1, skills: { first: 3, second: 2, ultimate: 4, chainPassive: 1 }, ee: null, ooparts: null, fused: false,
    });
    return { stats, own, cp: cpOf(own), pieces };
  }

  it("Swiftness 2-pc: the speed buff rate on the whole total (base + gear), +50 % at level 1, +100 % at 6★", () => {
    // Base 100 + boots 40 = 140, then the rate once: trunc(140 × 1.5) / × 2.
    // (As the gear's own speed rate it would read 100 × 0.5 + 140 = 190.)
    const l1 = sheet(SWIFTNESS, [0, 0, 0, 0], SIMULATED_HP_FRACTION);
    expect(l1.own.spd).toBe(140);
    expect(l1.stats.spd).toBe(210);
    expect(sheet(SWIFTNESS, [4, 4, 4, 4], 0.5).stats.spd).toBe(280);
    // Two pieces only (helmet + armor): the boots' flat isn't there.
    expect(sheet(SWIFTNESS, [0, 0], 0.5).stats.spd).toBe(150);
    expect(sheet(SWIFTNESS, [4, 4], 0.5).stats.spd).toBe(200);
    expect(sheet(SWIFTNESS, [4, 3], 0.5).stats.spd).toBe(150);
  });

  it("Revenge 4-pc: ATK in the buff rate, +80 % at level 1, +160 % at 6★, the 4-pc at the 4th best piece's level", () => {
    // ATK (1200 + 500) × (1000 + rate) / 1000.
    expect(sheet(REVENGE, [0, 0, 0, 0], 0.5).stats.atk).toBe(Math.trunc(1700 * 1.8));
    expect(sheet(REVENGE, [4, 4, 4, 4], 0.5).stats.atk).toBe(Math.trunc(1700 * 2.6));
    expect(sheet(REVENGE, [4, 4, 4, 3], 0.5).stats.atk).toBe(Math.trunc(1700 * 1.8));
    // Two pieces: no 4-pc, nothing counted.
    expect(sheet(REVENGE, [4, 4], 0.5).stats).toEqual(sheet(REVENGE, [4, 4], null).stats);
  });

  it("Patience 4-pc: DEF in the buff rate, the other stats untouched", () => {
    const on = sheet(PATIENCE, [4, 4, 4, 4], 0.5), off = sheet(PATIENCE, [4, 4, 4, 4], null);
    expect(on.stats.def).toBe(Math.trunc(600 * 2.6));
    expect({ ...on.stats, def: 0 }).toEqual({ ...off.stats, def: 0 });
  });

  it("the CP never counts them; off, the sheet is the plain one", () => {
    for (const [setId, bts] of [[SWIFTNESS, [4, 4]], [REVENGE, [0, 0, 0, 0]], [PATIENCE, [4, 4, 4, 4]]] as const) {
      const on = sheet(setId, [...bts], 0.5), off = sheet(setId, [...bts], null);
      expect(on.stats).not.toEqual(on.own);
      expect(on.cp).toBe(off.cp);
      expect(off.stats).toEqual(off.own);
    }
  });

  it("lostHpSetBuffs: one buff per lost-HP tier, as a buff main; none for another set or at full HP", () => {
    expect(lostHpSetBuffs(sheet(SWIFTNESS, [0, 0], null).pieces, SETS, 0.5)).toEqual([{ stat: "spd", value: 50, percent: true, fromBuff: true }]);
    expect(lostHpSetBuffs(sheet(REVENGE, [4, 4, 4, 4], null).pieces, SETS, 0.5)).toEqual([{ stat: "atkPct", value: 160, percent: true, fromBuff: true }]);
    expect(lostHpSetBuffs(sheet(REVENGE, [4, 4, 4, 4], null).pieces, SETS, 1)).toEqual([]);
    expect(lostHpSetBuffs(sheet(WEAKNESS, [4, 4], null).pieces, SETS, 0.5)).toEqual([]);
  });
});

/* ── Full solve on the real contract ─────────────────────────────────────── */

const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false } as RolledStat],
  helmet: [{ stat: "hp", value: 2400, percent: false } as RolledStat],
  armor: [{ stat: "def", value: 300, percent: false } as RolledStat],
  gloves: [{ stat: "critRate", value: 24, percent: true } as RolledStat],
  boots: [{ stat: "spd", value: 40, percent: false } as RolledStat],
  accessory: [{ stat: "atkPct", value: 30, percent: true } as RolledStat],
};

function piece(uid: string, slot: string, armorSetId: string | null, subs: RolledStat[] = []): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: null, main: MAINS[slot]!, subs, gemSlots: [],
  } as unknown as GearPiece;
}

/** A 6★ Talisman (Executioner's Charm, HP% main), parsed from the wire. */
function talisman(uid: string): GearPiece {
  const raw: RawItem = {
    ItemUID: uid, CharUID: "0", ItemID: 10201, Exp: GAME.enhance.expCurves["ooparts|unique|6"]![10]!,
    BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0, SelectSubOptionNum: 0,
    SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [10203], SubOptionList: [],
  };
  return { ...parseGearPiece(raw, GAME), uid, equippedBy: null };
}

const HERO = {
  uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
  skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
};

/** Swiftness helmet + armor (6★), or a set-less helmet carrying +4 SPD. */
const INV = {
  characters: [HERO],
  gear: [
    piece("w", "weapon", null), piece("hS", "helmet", SWIFTNESS), piece("hX", "helmet", null, [{ stat: "spd", value: 4, percent: false } as RolledStat]),
    piece("aS", "armor", SWIFTNESS), piece("g", "gloves", null), piece("b", "boots", null), piece("acc", "accessory", null), talisman("t"),
  ],
  presets: [],
} as unknown as Inventory;

function requestOf(mode: SolveMode, hp: LostHpFraction, spdMin?: number): SolveRequest {
  const base = filterDefaults("classic", false);
  const filters: SolverFilters = {
    ...base, priority: { spd: 1 },
    statFilters: spdMin != null ? { spd: { min: spdMin } } : {},
    options: { ...base.options, reforgeMode: "disable" as const, allowBrokenSets: true, equippedScope: "all" },
  };
  const args = solveArgsOf({
    mode, hero: HERO as unknown as Inventory["characters"][number], inventory: INV, game: GAME, userGeasLevels: null, userCodexLevel: null,
    heroPriority: {}, excludedPieceUids: undefined, worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null,
    filters: buildSolveFilters(filters),
  }, { topN: 50, topK: 50, lostHpFraction: hp });
  return { ...args, type: "solve", solveId: 1, topK: 50, chunkIndex: 0, chunkCount: 1 };
}

async function solve(mode: SolveMode, hp: LostHpFraction, spdMin?: number): Promise<SolveBuild[]> {
  const req = requestOf(mode, hp, spdMin);
  const pre = precomputeContext(req);
  const ctx = { req, ...pre };
  const { builds } = await solveChunk(ctx, 0, 1, 50);
  return finalizeBuilds(ctx, builds, mode).sort((a, b) => compareBuilds(a, b, mode));
}

const uses = (b: SolveBuild, uid: string) => b.pieceUids.includes(uid);

describe("solve with « Simulate 50% HP » — real contract", () => {
  it("the request carries the fraction only when it is set", () => {
    expect(requestOf("score", 0.5).lostHpFraction).toBe(0.5);
    expect("lostHpFraction" in requestOf("score", null)).toBe(false);
  });

  it("a Min SPD only Swiftness reaches: met with the setting, missed without; the same build's CP either way", async () => {
    const off = await solve("score", null);
    const on = await solve("score", 0.5);
    const offBest = Math.max(...off.map((b) => b.finalStats.spd));
    // Without the setting the set-less +4 SPD helmet tops the speed.
    expect(uses(off.find((b) => b.finalStats.spd === offBest)!, "hX")).toBe(true);
    const swiftOn = on.find((b) => uses(b, "hS") && uses(b, "aS"))!;
    const swiftOff = off.find((b) => uses(b, "hS") && uses(b, "aS"))!;
    expect(swiftOn.finalStats.spd).toBeGreaterThan(offBest);
    expect(swiftOn.cp).toBe(swiftOff.cp);
    expect(swiftOn.score).toBeGreaterThan(swiftOff.score);
    // The sheet the Optimizer's Current column composes for the same pieces.
    const pre = precomputeContext(requestOf("score", 0.5));
    const pieces = swiftOn.pieceUids.map((u) => INV.gear.find((g) => g.uid === u)!);
    expect(computeFinalStatsInTeam(pre.baseline, pre.scaling, pieces, GAME, [], 0.5).spd).toBe(swiftOn.finalStats.spd);

    const min = offBest + 1;
    expect(await solve("score", null, min)).toEqual([]);
    const met = await solve("score", 0.5, min);
    expect(met.length).toBeGreaterThan(0);
    expect(met.every((b) => uses(b, "hS") && uses(b, "aS") && b.finalStats.spd >= min)).toBe(true);
    // SOLVE CP: the CP of a build doesn't move with the setting.
    const [cpOn, cpOff] = [await solve("cp", 0.5), await solve("cp", null)];
    for (const b of cpOn) expect(b.cp).toBe(cpOff.find((x) => x.pieceUids.join() === b.pieceUids.join())!.cp);
  });

  it("setting off: every sheet is the plain one; on, a build without a lost-HP set reads the same", async () => {
    const pre = precomputeContext(requestOf("score", null));
    const off = await solve("score", null);
    for (const b of off) {
      const pieces = b.pieceUids.map((u) => INV.gear.find((g) => g.uid === u)!);
      expect(b.finalStats).toEqual(computeFinalStats(pre.baseline, pre.scaling, pieces, GAME));
    }
    const on = await solve("score", 0.5);
    const plainOn = on.filter((b) => !(uses(b, "hS") && uses(b, "aS")));
    expect(plainOn.length).toBeGreaterThan(0);
    for (const b of plainOn) {
      const twin = off.find((x) => x.pieceUids.join() === b.pieceUids.join())!;
      expect(b.finalStats).toEqual(twin.finalStats);
      expect(b.cp).toBe(twin.cp);
    }
  });

  it("sheetUpperBound counts the lost-HP sets with the fraction", async () => {
    const pre = precomputeContext(requestOf("score", 0.5));
    const on = await solve("score", 0.5);
    const best = Math.max(...on.map((b) => b.finalStats.spd));
    expect(sheetUpperBound(pre.baseline, pre.scaling, pre.pools, null, GAME.sets, [], 0, [], 0.5).spd).toBeGreaterThanOrEqual(best);
    expect(sheetUpperBound(pre.baseline, pre.scaling, pre.pools, null, GAME.sets, [], 0, []).spd).toBeLessThan(best);
  });
});
