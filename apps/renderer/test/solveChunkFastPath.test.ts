/**
 * Non-regression of the solver's fast path against the path it replaced, on a
 * synthetic inventory (seeded, so every run walks the same pieces):
 *  - the typed buckets (`BucketArray` + pre-resolved `BucketAdds`) compose the
 *    sheet bit for bit like the record path (`computeFinalStatsFromPrefix`);
 *  - `solveChunk` (running bucket per depth, set bonuses per boots node, the
 *    CHC read on the buckets and ONE composition per combo) gives the builds a
 *    per-combo reference written the old way gives: full `computeFinalStats`
 *    with the default gems, pre-gem CHC from that sheet, the allocator, a
 *    second `computeFinalStats` when its allocation differs;
 *  - the weapon × helmet (× deeper) partition: any chunk count merges to the
 *    mono-chunk builds and counters.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat, StatScaling } from "@gear-solver/core";
import {
  collapseTalismanVariants, compareBuilds, maxPartitionChunks, partitionDepthOf, solveChunk,
  TALISMAN_VARIANTS_KEPT, type SolveContext,
} from "../src/lib/solver/engine.js";
import {
  aggregatePrefixBuckets, applyBucketAdds, BUCKET_ARRAY_LENGTH, computeFinalStats, computeFinalStatsFromPrefix,
  computeSetBonuses, critRateUncappedOf, finalStatsFromBucketArray, gemOverrideBucketAdds, pieceBucketAdds,
  setBonusBucketAdds, type FinalStats, type FinalStatsBaseline, type GemOverride, type ScalingMap, type SetBonusList,
} from "../src/lib/composeBuild.js";
import {
  allocateGems, allocateGemsCapped, allocateGemsReachingCap, CRC_OVERSHOOT_CEIL, gemDeltaEquals, gemSlotsOf,
  type ScoredGem,
} from "../src/lib/solver/gems.js";
import { makeCpEvaluator } from "../src/lib/solver/cp.js";
import { computeScore } from "../src/lib/solver/ratings.js";
import type { SetPlan, SolveFilters, SolveMode, SolveRequest } from "../src/lib/solver/types.js";
import setsJson from "../../../data/derived/sets.json";

const SETS = setsJson as unknown as GameData["sets"];
const GAME = { options: {}, equipment: {}, sets: SETS, equipmentPassives: {}, multiTierPassives: {},
  gems: {}, singularityOptions: {}, eePassives: {}, characters: {},
  enhance: { enhanceFactor: 0, tierFactor: 0, maxEnhanceLevel: 15, singularity: { activation: 0, steps: [] }, expCurves: {} },
  buffs: {}, expCharacter: [], charLevelMax: {}, codexCurve: [], archiveBonus: [],
  trustCharacter: [], trustBuffs: [] } as unknown as GameData;

// Non-trivial scalings, so the in-game truncations see every bucket.
const sc = (baseValue: number, extra: Partial<StatScaling> = {}): StatScaling => ({
  baseValue, evoValue: 37, awakValue: 12, awakPct: 3.5, transcendPct: 6, codexPct: 2.1, buffPct: 4.3, buffValue: 9, ...extra,
});
const SCALING: ScalingMap = {
  atk: sc(1187), def: sc(623, { buffPct: 0 }), hp: sc(5911), eff: sc(97, { evoValue: 0 }), res: sc(103, { awakPct: 0 }),
  spd: { value: 111, rateBase: 101, buffPct: 4.3 },
};
const BASELINE: FinalStatsBaseline = { spd: 111, chc: 5.3, chd: 150.7, pen: 1.1, dmgInc: 3.3, dmgRed: 2.2 };
const SKILLS = { first: 3, second: 2, ultimate: 4, chainPassive: 1 };
const STAR_META = { showUIStar: 5, starPlus: 1, fused: false };

/** Deterministic PRNG (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stat = (s: string, value: number, percent: boolean, extra: Partial<RolledStat> = {}): RolledStat =>
  ({ stat: s, value, percent, ticks: 1, ...extra } as RolledStat);

// Sub-stat draws: [stat, percent, max value]. "unknownKey" lands in no slot of
// the typed buckets (and on no sheet axis of the record ones).
const SUBS: Array<[string, boolean, number]> = [
  ["atk", false, 120], ["atkPct", true, 14], ["def", false, 70], ["defPct", true, 12], ["hp", false, 600],
  ["hpPct", true, 13], ["spd", false, 9], ["critRate", true, 11.7], ["critDmg", true, 19.3], ["eff", true, 12.1],
  ["effRes", true, 12.9], ["dmgUp", true, 6.6], ["dmgReduce", true, 5.4], ["pen", true, 4.4],
  ["critDmgReduce", true, 3.3], ["unknownKey", false, 5],
];

function makeInventory(seed: number, sizes: { weapon: number; armor: number; accessory: number; ooparts: number }) {
  const rng = rngOf(seed);
  const val = (max: number) => Math.round(rng() * max * 10) / 10 + 0.1;
  const subs = (n: number) => Array.from({ length: n }, () => {
    const [s, percent, max] = SUBS[Math.floor(rng() * SUBS.length)]!;
    return stat(s, val(max), percent);
  });
  const piece = (slot: string, uid: string, extra: Partial<GearPiece>): GearPiece => ({
    uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "legendary", star: 6, name: uid, classLimit: null,
    breakthrough: Math.floor(rng() * 5), reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null, main: [], subs: [], ...extra,
  } as unknown as GearPiece);
  const armorSets = ["1", "4", "13", "9", null];
  // The gloves carry the CHC: low on even ones, high on odd ones, so the
  // combos land below, around and past the cap (every reallocation branch).
  const mainValue = (slot: string, i: number, percent: boolean) =>
    slot === "gloves" ? (i % 2 ? 60 + val(30) : val(30)) : val(percent ? 60 : 900);
  const armorSlot = (slot: string, mainStat: string, percent: boolean) =>
    Array.from({ length: sizes.armor }, (_, i) => piece(slot, `${slot}${i}`, {
      armorSetId: armorSets[Math.floor(rng() * armorSets.length)]!,
      main: [stat(mainStat, mainValue(slot, i, percent), percent)], subs: subs(4),
    }));
  return {
    weapon: Array.from({ length: sizes.weapon }, (_, i) => piece("weapon", `w${i}`, {
      main: [
        stat("atk", val(500), false),
        // A buff-routed speed rate (Phantasm-like), a buff-routed flat, a
        // combat-only line — every main routing the composer knows.
        ...(i % 3 === 0 ? [stat("spd", -30, true, { fromBuff: true })] : []),
        ...(i % 3 === 1 ? [stat("atk", val(80), false, { fromBuff: true }), stat("critRate", 7, true, { combatOnly: true })] : []),
      ],
      subs: subs(4),
    })),
    helmet: armorSlot("helmet", "hp", false),
    armor: armorSlot("armor", "def", false),
    gloves: armorSlot("gloves", "critRate", true),
    boots: armorSlot("boots", "spd", false),
    accessory: Array.from({ length: sizes.accessory }, (_, i) => piece("accessory", `ac${i}`, {
      main: [stat("critDmg", val(60), true), ...(i % 2 ? [stat("critRate", val(8), true, { fromBuff: true })] : [])],
      subs: subs(4),
    })),
    // Talismans carry socketed gems in `subs` (the no-override path reads
    // them) and alternate 5 / 4 gem slots (enhance 15 / 0).
    ooparts: Array.from({ length: sizes.ooparts }, (_, i) => piece("ooparts", `t${i}`, {
      enhanceLevel: i % 2 ? 0 : 15,
      main: [stat("atk", val(300), false, { fromBuff: true }), stat("atkPct", val(20), true, { fromBuff: true })],
      subs: [stat("critRate", 3, true), stat("atkPct", 6, true)],
    })),
    ee: piece("exclusive", "ee", {
      main: [stat("spd", 5, false, { fromBuff: true }), stat("critRate", 4, true, { fromBuff: true })],
      subs: [stat("critDmg", 4, true), stat("atk", 40, false)],
    }),
  };
}

/** Same numbers, +0 / −0 and NaN told apart. */
function expectSameSheet(actual: FinalStats, expected: FinalStats): void {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const k of Object.keys(expected) as Array<keyof FinalStats>) {
    expect(Object.is(actual[k], expected[k]), `${k}: ${actual[k]} vs ${expected[k]}`).toBe(true);
  }
}

describe("typed buckets — bit-identical to the record path", () => {
  const overrides: Array<GemOverride | undefined> = [
    undefined,
    { flat: {}, pct: {} },
    { flat: { atk: 80, spd: 4 }, pct: { critRate: 9, atkPct: 18.6, critDmg: 4.4, unknownKey: 3 } },
    { flat: { hp: 300 }, pct: { critRate: 0 } },
  ];

  it("random combos × gem overrides × set bonuses × with / without EE", () => {
    const inv = makeInventory(1337, { weapon: 6, armor: 6, accessory: 4, ooparts: 6 });
    const rng = rngOf(42);
    const draw = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;
    for (let n = 0; n < 400; n++) {
      const prefix = [draw(inv.weapon), draw(inv.helmet), draw(inv.armor), draw(inv.gloves), draw(inv.boots), draw(inv.accessory)];
      const talisman = draw(inv.ooparts);
      const ee = n % 2 ? inv.ee : null;
      const override = overrides[n % overrides.length];
      const setBonuses: SetBonusList = computeSetBonuses(prefix, SETS);

      const record = computeFinalStatsFromPrefix(BASELINE, SCALING, aggregatePrefixBuckets(prefix), talisman, ee, override, setBonuses);
      const typed = new Float64Array(BUCKET_ARRAY_LENGTH);
      for (const p of prefix) applyBucketAdds(typed, pieceBucketAdds(p, false));
      applyBucketAdds(typed, pieceBucketAdds(talisman, !!override));
      if (ee) applyBucketAdds(typed, pieceBucketAdds(ee, !!override));
      if (override) applyBucketAdds(typed, gemOverrideBucketAdds(override));
      applyBucketAdds(typed, setBonusBucketAdds(setBonuses));

      expectSameSheet(finalStatsFromBucketArray(BASELINE, SCALING, typed), record);
      expect(Object.is(critRateUncappedOf(BASELINE, typed), record.critRateUncapped)).toBe(true);
      // And the full-array path, the reference of both.
      const full = [...prefix, talisman, ...(ee ? [ee] : [])];
      expectSameSheet(record, computeFinalStats(BASELINE, SCALING, full, GAME, override));
    }
  });
});

const FILTERS: SolveFilters = {
  options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100,
  mainPicks: {}, setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
};

const crit = (id: number, score: number): ScoredGem => ({ id, stat: "critRate", value: 3, percent: true, score });
const atkGem = (id: number, score: number): ScoredGem => ({ id, stat: "atkPct", value: 6, percent: true, score });
const SCORED: ScoredGem[] = [
  ...[1, 2, 3, 4, 5, 6].map((i) => atkGem(i, 60)), ...[11, 12, 13, 14, 15, 16].map((i) => crit(i, 80)),
].sort((a, b) => b.score - a.score);

function makeCtx(opts: {
  seed: number; mode: SolveMode; priority: Record<string, number>; withEe: boolean;
  sizes?: { weapon: number; armor: number; accessory: number; ooparts: number };
  setPlans?: SetPlan[]; allowBrokenSets?: boolean; defaults?: Map<number, ReturnType<typeof allocateGems>>;
}): SolveContext {
  const inv = makeInventory(opts.seed, opts.sizes ?? { weapon: 3, armor: 2, accessory: 2, ooparts: 4 });
  const eeSlots = opts.withEe ? gemSlotsOf(inv.ee) : 0;
  const defaults = opts.defaults ?? new Map([4, 5].map((n) => [n, allocateGems(SCORED, n, eeSlots)]));
  const filters: SolveFilters = {
    ...FILTERS, priority: opts.priority, setPlans: opts.setPlans ?? [],
    options: { ...FILTERS.options, allowBrokenSets: opts.allowBrokenSets ?? true },
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: opts.mode, heroUid: "hero",
    inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
    game: GAME, userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: SKILLS,
    filters, topK: 100_000, chunkIndex: 0, chunkCount: 1,
  };
  const { ee, ...pools } = inv;
  return {
    req, pools, baseline: BASELINE, scaling: SCALING, ee: opts.withEe ? ee : null,
    poolSizes: {}, scoredGems: SCORED,
    gemDeltaByTalismanSlots: new Map([...defaults].map(([n, a]) => [n, a.delta])),
    gemAllocByTalismanSlots: new Map([...defaults].map(([n, a]) => [n, a.alloc])),
    skills: SKILLS, starMeta: STAR_META, dmgStat: "atk", noCrit: false, skillFactor: 1, turnFactor: 1,
    setPlans: opts.setPlans ?? [], excludedSets: new Set(), allowBrokenSets: opts.allowBrokenSets ?? true,
    excludedWeaponEffects: new Set(), excludedAccessoryEffects: new Set(), reforgeTickWeights: null,
  };
}

/** The old per-combo path: compose with the default gems, read the pre-gem CHC
 *  on that sheet, run the allocator, compose again when it differs (or, in
 *  SOLVE CP without a priority, keep the higher CP of the two). No filter, no
 *  set plan: every combo is a build. */
function referenceBuilds(ctx: SolveContext): Array<{ uids: string; fs: FinalStats; score: number; cp: number | null; gems: unknown }> {
  const { pools, ee, scoredGems } = ctx;
  const { mode, filters } = ctx.req;
  const wantCritCap = (filters.priority.critRate ?? 0) > 0;
  const cpGemAlloc = mode === "cp" && Object.values(filters.priority).every((w) => !w);
  const eeSlots = gemSlotsOf(ee);
  const cpEval = makeCpEvaluator({ showUIStar: STAR_META.showUIStar, starPlus: STAR_META.starPlus, skills: SKILLS, ee, fused: false });
  const out = [];
  for (const w of pools.weapon) for (const h of pools.helmet) for (const a of pools.armor) for (const g of pools.gloves)
    for (const b of pools.boots) for (const acc of pools.accessory) for (const t of pools.ooparts) {
      const pieces = [w, h, a, g, b, acc, t, ...(ee ? [ee] : [])];
      const slots = gemSlotsOf(t);
      const delta = ctx.gemDeltaByTalismanSlots.get(slots) ?? null;
      let alloc = ctx.gemAllocByTalismanSlots.get(slots)!;
      let fs = computeFinalStats(BASELINE, SCALING, pieces, GAME, delta ?? undefined);
      const defaultCrc = delta?.pct?.critRate ?? 0;
      const pre = fs.critRateUncapped! - defaultCrc;
      let cp: number | null = null;
      if (wantCritCap) {
        const reached = allocateGemsReachingCap(scoredGems, slots, eeSlots, pre);
        if (!gemDeltaEquals(reached.delta, delta)) {
          fs = computeFinalStats(BASELINE, SCALING, pieces, GAME, reached.delta ?? undefined);
          alloc = reached.alloc;
        }
      } else if (fs.critRateUncapped! > CRC_OVERSHOOT_CEIL && defaultCrc > 0) {
        const capped = allocateGemsCapped(scoredGems, slots, eeSlots, pre);
        if (!gemDeltaEquals(capped.delta, delta)) {
          const cappedFs = computeFinalStats(BASELINE, SCALING, pieces, GAME, capped.delta ?? undefined);
          const keepDefault = cpGemAlloc && cpEval(cappedFs, t) <= cpEval(fs, t);
          if (!keepDefault) { fs = cappedFs; alloc = capped.alloc; }
        }
      }
      if (mode === "cp") cp = cpEval(fs, t);
      // `pieceUids` lists the EE before the talisman (the talisman is last).
      const uids = [w, h, a, g, b, acc, ...(ee ? [ee] : []), t].map((p) => p.uid).join("|");
      out.push({ uids, fs, score: computeScore(fs, filters.priority), cp, gems: alloc });
    }
  return out;
}

async function solveAll(ctx: SolveContext, chunkCount: number) {
  const parts = [];
  for (let i = 0; i < chunkCount; i++) parts.push(await solveChunk(ctx, i, chunkCount, ctx.req.topK));
  const mode = ctx.req.mode;
  const merged = parts.flatMap((p) => p.builds).sort((a, b) => compareBuilds(a, b, mode));
  return {
    builds: collapseTalismanVariants(merged, TALISMAN_VARIANTS_KEPT),
    permutations: parts.reduce((n, p) => n + p.permutations, 0),
    searched: parts.reduce((n, p) => n + p.searched, 0),
    brokenSetsRejected: parts.reduce((n, p) => n + p.brokenSetsRejected, 0),
    perChunk: parts.map((p) => p.permutations),
  };
}

describe("solveChunk — one composition per combo, same builds as the old double composition", () => {
  const cases: Array<{ name: string; mode: SolveMode; priority: Record<string, number>; withEe: boolean }> = [
    { name: "Score, critRate priority (cap reached), EE", mode: "score", priority: { critRate: 3, atk: 1 }, withEe: true },
    { name: "Score, critRate priority, no EE", mode: "score", priority: { critRate: 1, critDmg: 2 }, withEe: false },
    { name: "CP, critRate priority", mode: "cp", priority: { critRate: 2, atk: 2 }, withEe: true },
    { name: "Score, no crit priority (overshoot reallocation)", mode: "score", priority: { atk: 1, critDmg: 1 }, withEe: true },
    { name: "CP without a priority (overshoot, higher CP kept)", mode: "cp", priority: {}, withEe: true },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const ctx = makeCtx({ seed: 7, ...c });
      const ref = new Map(referenceBuilds(ctx).map((r) => [r.uids, r]));
      // Every combo lands (no filter, top-K above the cartesian, 4 talismans
      // > the 3 variants kept per signature: compare the heap's survivors).
      const out = await solveChunk(ctx, 0, 1, ctx.req.topK);
      expect(out.permutations).toBe(ref.size);
      expect(out.builds.length).toBeGreaterThan(0);
      for (const b of out.builds) {
        const r = ref.get(b.pieceUids.join("|"))!;
        expect(r, b.pieceUids.join("|")).toBeDefined();
        expectSameSheet(b.finalStats, r.fs);
        expect(Object.is(b.score, r.score)).toBe(true);
        if (c.mode === "cp") expect(Object.is(b.cp, r.cp)).toBe(true);
        expect(b.gemAllocation).toEqual(r.gems);
      }
      // Both sides of the reallocation are walked: builds on the default
      // allocation (the precomputed object itself) and reallocated ones.
      const defaults = new Set(ctx.gemAllocByTalismanSlots.values());
      const kept = out.builds.filter((b) => defaults.has(b.gemAllocation)).length;
      expect(kept).toBeGreaterThan(0);
      expect(kept).toBeLessThan(out.builds.length);
    });
  }
});

describe("solveChunk — partition of the flattened outer loops", () => {
  it("partitionDepthOf: weapon × helmet, one level deeper while < 4 units per chunk", () => {
    expect(partitionDepthOf([10, 11, 11, 11, 12], 1)).toBe(2);
    expect(partitionDepthOf([10, 11, 11, 11, 12], 16)).toBe(2); // 110 ≥ 64
    expect(partitionDepthOf([10, 11, 11, 11, 12], 32)).toBe(3); // 110 < 128 ≤ 1210
    expect(partitionDepthOf([1, 1, 4, 4, 1], 2)).toBe(4);
    expect(partitionDepthOf([1, 1, 1, 1, 1], 8)).toBe(5); // never below boots
    expect(maxPartitionChunks([10, 11, 11, 11, 12])).toBe(10 * 11 * 11 * 11 * 12);
    expect(maxPartitionChunks([3, 0, 2, 2, 2])).toBe(0);
  });

  const variants: Array<{ name: string; mode: SolveMode; priority: Record<string, number>; setPlans?: SetPlan[]; allowBrokenSets?: boolean }> = [
    { name: "Score, crit priority, free sets", mode: "score", priority: { critRate: 2, atk: 1 } },
    { name: "CP, 4pc plan, broken sets refused", mode: "cp", priority: { atk: 1 }, setPlans: [[{ setId: "4", count: 2 }]], allowBrokenSets: false },
  ];
  for (const v of variants) {
    it(`${v.name}: every chunk count merges to the mono-chunk run`, async () => {
      const ctx = makeCtx({ seed: 99, withEe: true, sizes: { weapon: 3, armor: 3, accessory: 2, ooparts: 3 }, ...v });
      const mono = await solveAll(ctx, 1);
      expect(mono.permutations).toBeGreaterThan(0);
      for (const n of [2, 3, 5, 7, 16, 32, 64]) {
        const split = await solveAll(ctx, n);
        expect(split.builds).toEqual(mono.builds);
        expect(split.permutations).toBe(mono.permutations);
        expect(split.searched).toBe(mono.searched);
        expect(split.brokenSetsRejected).toBe(mono.brokenSetsRejected);
      }
      // 9 weapon × helmet units: 2 chunks both get work at depth 2, 16 chunks
      // go one level deeper (27 units) and still keep 16 workers busy.
      expect((await solveAll(ctx, 2)).perChunk.every((p) => p > 0)).toBe(true);
      if (!v.setPlans) expect((await solveAll(ctx, 16)).perChunk.every((p) => p > 0)).toBe(true);
    });
  }
});
