/**
 * `solveChunk` crit-cap slow path, end to end — with a `critRate` priority and
 * crit gems in the pool (`wantCritCap`), each combo's gems are re-allocated by
 * `allocateGemsReachingCap` on ITS pre-gem CHC, and the build recomposed only
 * when that allocation differs from the precomputed default.
 *
 * Hand-built `SolveContext` (same shape as `solveChunk.test.ts`): the gloves
 * carry the CHC, so the combos land below, on and above the 100% cap; one
 * 5-slot and one 4-slot talisman cover both cached variants of
 * `capAllocCache`. Each build is checked against an independent recompute:
 * pre-gem CHC from `computeFinalStats` without gems → the allocator →
 * `computeFinalStats` with its delta → `calcBattlePower`.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat, StatScaling } from "@gear-solver/core";
import { solveChunk, type SolveContext } from "../src/lib/solver/engine.js";
import { allocateGems, allocateGemsReachingCap, gemDeltaEquals, gemSlotsOf, type ScoredGem } from "../src/lib/solver/gems.js";
import { computeFinalStats, type FinalStatsBaseline, type ScalingMap } from "../src/lib/composeBuild.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import type { SolveBuild, SolveFilters, SolveRequest } from "../src/lib/solver/types.js";

const GAME = { options: {}, equipment: {}, sets: {}, equipmentPassives: {}, multiTierPassives: {},
  gems: {}, singularityOptions: {}, eePassives: {}, characters: {},
  enhance: { enhanceFactor: 0, tierFactor: 0, maxEnhanceLevel: 15, singularity: { activation: 0, steps: [] }, expCurves: {} },
  buffs: {}, expCharacter: [], charLevelMax: {}, codexCurve: [], archiveBonus: [],
  trustCharacter: [], trustBuffs: [] } as unknown as GameData;

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
const SKILLS = { first: 3, second: 2, ultimate: 4, chainPassive: 1 };
const STAR_META = { showUIStar: 5, starPlus: 1, fused: false };

function piece(
  slot: string,
  uid: string,
  opts: { main?: RolledStat[]; subs?: RolledStat[]; enhanceLevel?: number } = {},
): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "epic", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: opts.enhanceLevel ?? 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: opts.main ?? [], subs: opts.subs ?? [],
  } as unknown as GearPiece;
}

const stat = (s: string, value: number, percent: boolean): RolledStat => ({ stat: s, value, percent, ticks: 1 } as RolledStat);

/** The gloves set the pre-gem CHC: 5 (baseline) + 80/89/95/100 → 85, 94,
 *  100 (on the cap) and 105 (above it). The talismans carry no subs, so the
 *  gem override replaces nothing the no-gem recompute would count. */
function pools(): SolveContext["pools"] {
  return {
    weapon: [piece("weapon", "w1", { main: [stat("atkPct", 30, true)] }), piece("weapon", "w2", { main: [stat("atkPct", 45, true)] })],
    helmet: [piece("helmet", "h1", { subs: [stat("hp", 500, false)] })],
    armor: [piece("armor", "a1", { subs: [stat("def", 100, false)] })],
    gloves: [80, 89, 95, 100].map((c) => piece("gloves", `g${c}`, { subs: [stat("critRate", c, true)] })),
    boots: [piece("boots", "b1", { subs: [stat("spd", 12, false)] })],
    accessory: [piece("accessory", "ac1", { main: [stat("critDmg", 40, true)] })],
    ooparts: [
      piece("ooparts", "t5", { main: [stat("atk", 150, false)] }), // enhance 15 → 5 gem slots
      piece("ooparts", "t4", { main: [stat("atk", 100, false)], enhanceLevel: 0 }), // → 4 gem slots
    ],
  };
}

const crit = (id: number, score: number): ScoredGem => ({ id, stat: "critRate", value: 3, percent: true, score });
const atk = (id: number, score: number): ScoredGem => ({ id, stat: "atkPct", value: 6, percent: true, score });
/** Scored pool, sorted by score desc like `scoreGemPool`'s output. */
const gemPool = (critScore: number, atkScore: number): ScoredGem[] =>
  [...[1, 2, 3, 4, 5].map((i) => atk(i, atkScore)), ...[11, 12, 13, 14, 15].map((i) => crit(i, critScore))]
    .sort((a, b) => b.score - a.score);

const FILTERS: SolveFilters = {
  options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: { critRate: 1, atk: 1 }, topPct: 100,
  mainPicks: {}, setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
};

/** A CP solve whose default gem allocations (one per talisman slot count) are
 *  the CHC-blind greedy, as `precomputeContext` builds them. */
function makeCtx(scoredGems: ScoredGem[]): SolveContext {
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: "cp", heroUid: "hero",
    inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
    game: GAME, userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: SKILLS,
    filters: FILTERS, topK: 1000, chunkIndex: 0, chunkCount: 1,
  };
  const defaults = new Map([4, 5].map((n) => [n, allocateGems(scoredGems, n, 0)]));
  return {
    req, pools: pools(), baseline: BASELINE, scaling: SCALING, ee: null,
    poolSizes: {}, scoredGems,
    gemDeltaByTalismanSlots: new Map([...defaults].map(([n, a]) => [n, a.delta])),
    gemAllocByTalismanSlots: new Map([...defaults].map(([n, a]) => [n, a.alloc])),
    skills: SKILLS, starMeta: STAR_META, dmgStat: "atk", noCrit: false, skillFactor: 1,
    setPlans: [], excludedSets: new Set(), allowBrokenSets: true,
    excludedWeaponEffects: new Set(), excludedAccessoryEffects: new Set(), reforgeTickWeights: null,
  };
}

/** Recompute one build from its pieces alone and check it against the
 *  solver's. Returns whether the default allocation was kept. */
function checkBuild(ctx: SolveContext, b: SolveBuild): { preGemCrc: number; keptDefault: boolean } {
  const byUid = new Map<string, GearPiece>();
  for (const arr of Object.values(ctx.pools)) for (const p of arr) byUid.set(p.uid, p);
  const pieces = b.pieceUids.map((u) => byUid.get(u)!);
  const talisman = pieces[pieces.length - 1]!;
  const slots = gemSlotsOf(talisman);

  const preGemCrc = computeFinalStats(BASELINE, SCALING, pieces, GAME).critRateUncapped!;
  const expected = allocateGemsReachingCap(ctx.scoredGems, slots, 0, preGemCrc);
  expect(b.gemAllocation).toEqual(expected.alloc);

  const fs = computeFinalStats(BASELINE, SCALING, pieces, GAME, expected.delta ?? undefined);
  expect(b.finalStats).toEqual(fs);
  expect(b.cp).toBe(calcBattlePower({
    stats: fs, showUIStar: STAR_META.showUIStar, starPlus: STAR_META.starPlus,
    skills: SKILLS, ee: null, ooparts: talisman, fused: STAR_META.fused,
  }));

  // No recompose when the cap-aware allocation equals the default: the build
  // carries the precomputed allocation object itself, not the allocator's copy.
  const keptDefault = gemDeltaEquals(expected.delta, ctx.gemDeltaByTalismanSlots.get(slots) ?? null);
  if (keptDefault) expect(b.gemAllocation).toBe(ctx.gemAllocByTalismanSlots.get(slots));
  else expect(b.gemAllocation).not.toBe(ctx.gemAllocByTalismanSlots.get(slots));
  return { preGemCrc, keptDefault };
}

const gloveOf = (b: SolveBuild) => b.pieceUids[3]!;
const talismanOf = (b: SolveBuild) => b.pieceUids[6]!;

describe("solveChunk — crit-cap slow path (critRate priority + crit gems)", () => {
  it("crit gems ranked below ATK: under the cap they are spent first, on/above it the default stays", async () => {
    const ctx = makeCtx(gemPool(50, 80)); // default = ATK gems only
    const out = await solveChunk(ctx, 0, 1, 1000);
    expect(out.permutations).toBe(16); // 2 weapons × 4 gloves × 2 talismans
    expect(out.builds).toHaveLength(16);

    for (const b of out.builds) {
      const { preGemCrc, keptDefault } = checkBuild(ctx, b);
      // Below the cap the default (no crit gem) differs → recomposed; on or
      // above it the allocator takes no crit gem either → default kept.
      expect(keptDefault).toBe(preGemCrc >= 100);
    }

    // Spot values. CHC 85 + 5 crit gems → 100 exactly (5-slot talisman); the
    // 4-slot one only reaches 97. CHC 94 + 2 crit gems → 100, then 3 ATK.
    const find = (g: string, t: string) => out.builds.find((b) => gloveOf(b) === `g${g}` && talismanOf(b) === t && b.pieceUids[0] === "w1")!;
    expect(find("80", "t5").gemAllocation.talisman).toEqual([11, 12, 13, 14, 15]);
    expect(find("80", "t5").finalStats.critRate).toBe(100);
    expect(find("80", "t4").gemAllocation.talisman).toEqual([11, 12, 13, 14]);
    expect(find("80", "t4").finalStats.critRate).toBe(97);
    expect(find("89", "t5").gemAllocation.talisman).toEqual([11, 12, 1, 2, 3]);
    expect(find("95", "t5").gemAllocation.talisman).toEqual([1, 2, 3, 4, 5]);
    expect(find("100", "t5").finalStats.critRateUncapped).toBe(105);
  });

  it("crit gems ranked above ATK: the default's crit gems are taken back above the cap", async () => {
    const ctx = makeCtx(gemPool(100, 50)); // default = crit gems first
    const out = await solveChunk(ctx, 0, 1, 1000);
    expect(out.builds).toHaveLength(16);

    const kept = new Set<string>();
    for (const b of out.builds) {
      if (checkBuild(ctx, b).keptDefault) kept.add(`${gloveOf(b)}/${talismanOf(b)}`);
    }
    // Only CHC 85 matches the default (all crit gems are still useful there);
    // from 94 up the allocator drops the crit gems that would overshoot.
    expect([...kept].sort()).toEqual(["g80/t4", "g80/t5"]);
  });

  it("two chunks sharing the combos give the single chunk's builds", async () => {
    for (const gems of [gemPool(50, 80), gemPool(100, 50)]) {
      const mono = await solveChunk(makeCtx(gems), 0, 1, 1000);
      const parts = [await solveChunk(makeCtx(gems), 0, 2, 1000), await solveChunk(makeCtx(gems), 1, 2, 1000)];
      for (const p of parts) expect(p.permutations).toBeGreaterThan(0);
      expect(parts[0]!.permutations + parts[1]!.permutations).toBe(mono.permutations);
      const byKey = (bs: SolveBuild[]) => [...bs].sort((x, y) => x.pieceUids.join("|").localeCompare(y.pieceUids.join("|")));
      expect(byKey(parts.flatMap((p) => p.builds))).toEqual(byKey(mono.builds));
    }
  });
});
