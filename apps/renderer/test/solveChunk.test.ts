/**
 * End-to-end `solveChunk` regression tests — exercise the cartesian + the
 * mid-tree set prune + the per-combo compose/CP path against a hand-built
 * `SolveContext` (no heavy hero fixture: baseline/scaling are plain numbers,
 * so `computeFinalStats` runs without `composeCharStats`).
 *
 * Covers:
 *  - mid-tree set-feasibility pruning visibly cuts the visited-combo count
 *    (a req-4pc with too few set pieces never descends the armor subtree);
 *  - the solver's per-combo FinalStats + CP match an independent
 *    `computeFinalStats` + `calcBattlePower` recompute (the "solver vs Builds"
 *    0-diff guarantee — both screens must agree on the same build);
 *  - SOLVE CP's deferred ratings are filled back in by `finalizeBuilds`.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat, StatScaling } from "@gear-solver/core";
import { finalizeBuilds, solveChunk, type SolveContext } from "../src/lib/solver/engine.js";
import { computeFinalStats, type FinalStatsBaseline, type ScalingMap } from "../src/lib/composeBuild.js";
import { calcBattlePower } from "../src/lib/solver/cp.js";
import { computeCheapRatings } from "../src/lib/solver/ratings.js";
import type { SetPlan, SolveFilters, SolveMode, SolveRequest } from "../src/lib/solver/types.js";

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

/** Minimal gear piece — only the fields the cartesian + compose touch. */
function piece(
  slot: string,
  uid: string,
  opts: { armorSetId?: string | null; main?: RolledStat[]; subs?: RolledStat[] } = {},
): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: opts.armorSetId ?? null,
    rarity: "epic", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: opts.main ?? [], subs: opts.subs ?? [],
  } as unknown as GearPiece;
}

const FILTERS: SolveFilters = {
  options: { onlyMaxed: false, reforgeMode: "disable", includeEquippedOnOthers: true, keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100,
  mainPicks: {}, setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
};

type Pools = SolveContext["pools"];

function makeCtx(pools: Pools, setPlans: SetPlan[], mode: SolveMode): SolveContext {
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode, heroUid: "hero",
    inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
    game: GAME, userGeasLevels: null, userCodexLevel: null, userSkills: SKILLS,
    filters: { ...FILTERS, setPlans }, topK: 1000, chunkIndex: 0, chunkCount: 1,
  };
  return {
    req, pools, baseline: BASELINE, scaling: SCALING, ee: null,
    poolSizes: {}, scoredGems: [],
    gemDeltaByTalismanSlots: new Map([[4, null], [5, null]]),
    gemAllocByTalismanSlots: new Map([[4, { talisman: [], ee: [] }], [5, { talisman: [], ee: [] }]]),
    skills: SKILLS, starMeta: STAR_META, dmgStat: "atk", noCrit: false,
    setPlans, excludedSets: new Set(), allowBrokenSets: true,
    excludedWeaponEffects: new Set(), excludedAccessoryEffects: new Set(),
  };
}

/** Two pieces per armor slot — one of set "A", one of set "B" — so a req-4pc A
 *  is satisfiable by exactly the all-A path. Single weapon/accessory/talisman. */
function abPools(): Pools {
  return {
    weapon: [piece("weapon", "w1")],
    helmet: [piece("helmet", "h_A", { armorSetId: "A" }), piece("helmet", "h_B", { armorSetId: "B" })],
    armor: [piece("armor", "a_A", { armorSetId: "A" }), piece("armor", "a_B", { armorSetId: "B" })],
    gloves: [piece("gloves", "g_A", { armorSetId: "A" }), piece("gloves", "g_B", { armorSetId: "B" })],
    boots: [piece("boots", "b_A", { armorSetId: "A" }), piece("boots", "b_B", { armorSetId: "B" })],
    accessory: [piece("accessory", "ac1")],
    ooparts: [piece("ooparts", "t1")],
  };
}

describe("solveChunk — mid-tree set pruning", () => {
  it("a req-4pc visits far fewer combos than the brute-force product", async () => {
    // Brute force = 1×2×2×2×2×1×1 = 16 talisman-loop iterations.
    const noReq = await solveChunk(makeCtx(abPools(), [], "score"), 0, 1, 1000);
    expect(noReq.permutations).toBe(16);

    // req-4pc A: only the all-A armor path can satisfy it. Every branch that
    // picks a B piece early is pruned at the depth it becomes infeasible —
    // BEFORE reaching the innermost talisman loop (which is where the
    // permutation counter ticks). So exactly 1 combo is ever scored.
    const req = await solveChunk(makeCtx(abPools(), [[{ setId: "A", count: 4 }]], "score"), 0, 1, 1000);
    expect(req.permutations).toBe(1);
    expect(req.permutations).toBeLessThan(noReq.permutations);

    // The single surviving build is the all-A armor loadout.
    expect(req.builds).toHaveLength(1);
    expect(req.builds[0]!.pieceUids).toEqual(["w1", "h_A", "a_A", "g_A", "b_A", "ac1", "t1"]);
  });

  it("an unsatisfiable req-4pc prunes the entire search (0 combos scored)", async () => {
    // Only ONE set-A armor piece exists (helmet) → 4pc A is impossible. The
    // prune kills every branch before the talisman loop; nothing is scored.
    const pools = abPools();
    pools.armor = [piece("armor", "a_B", { armorSetId: "B" })];
    pools.gloves = [piece("gloves", "g_B", { armorSetId: "B" })];
    pools.boots = [piece("boots", "b_B", { armorSetId: "B" })];
    const req = await solveChunk(makeCtx(pools, [[{ setId: "A", count: 4 }]], "score"), 0, 1, 1000);
    expect(req.permutations).toBe(0);
    expect(req.builds).toHaveLength(0);
  });
});

describe("solveChunk — CP / FinalStats match an independent recompute (solver vs Builds)", () => {
  it("every CP build's stats + CP equal computeFinalStats + calcBattlePower on the same pieces", async () => {
    // Pieces carry real stats so FinalStats + CP are non-trivial.
    const pools: Pools = {
      weapon: [piece("weapon", "w1", { main: [{ stat: "atkPct", value: 60, percent: true } as RolledStat] })],
      helmet: [piece("helmet", "h1", { subs: [{ stat: "hp", value: 500, percent: false, ticks: 6 } as RolledStat] })],
      armor: [piece("armor", "a1", { subs: [{ stat: "def", value: 100, percent: false, ticks: 6 } as RolledStat] })],
      gloves: [piece("gloves", "g1", { subs: [{ stat: "critRate", value: 8, percent: true, ticks: 4 } as RolledStat] })],
      boots: [piece("boots", "b1", { subs: [{ stat: "spd", value: 12, percent: false, ticks: 5 } as RolledStat] })],
      accessory: [
        piece("accessory", "ac1", { main: [{ stat: "critDmg", value: 30, percent: true } as RolledStat] }),
        piece("accessory", "ac2", { main: [{ stat: "critDmg", value: 45, percent: true } as RolledStat] }),
      ],
      ooparts: [
        piece("ooparts", "t1", { subs: [{ stat: "atk", value: 200, percent: false, ticks: 1 } as RolledStat] }),
        piece("ooparts", "t2", { subs: [{ stat: "pen", value: 15, percent: true, ticks: 1 } as RolledStat] }),
      ],
    };
    const ctx = makeCtx(pools, [], "cp");
    const result = await solveChunk(ctx, 0, 1, 1000);
    // 1×1×1×1×1×2×2 = 4 combos.
    expect(result.permutations).toBe(4);

    const finals = finalizeBuilds(ctx, result.builds, "cp");
    expect(finals.length).toBe(4);

    // Index every pool piece by uid for the independent recompute.
    const byUid = new Map<string, GearPiece>();
    for (const arr of Object.values(pools)) for (const p of arr) byUid.set(p.uid, p);

    for (const b of finals) {
      // pieceUids order (no EE) == the engine's compose order: w,h,a,g,b,acc,tali.
      const pieces = b.pieceUids.map((u) => byUid.get(u)!);
      const fs = computeFinalStats(BASELINE, SCALING, pieces, GAME);
      expect(b.finalStats).toEqual(fs);

      const talisman = pieces[pieces.length - 1]!;
      const cp = calcBattlePower({
        stats: fs, showUIStar: STAR_META.showUIStar, starPlus: STAR_META.starPlus,
        skills: SKILLS, ee: null, ooparts: talisman, fused: STAR_META.fused,
      });
      expect(b.cp).toBe(cp);

      // Ratings were deferred in the CP hot loop (no rating filter) and
      // recomputed for the top-N by finalizeBuilds — must be the real values.
      expect(b.ratings).toEqual(computeCheapRatings(fs, "atk", undefined, false));
    }

    // CP is the sort key → results are CP-descending.
    for (let i = 1; i < finals.length; i++) {
      expect(finals[i - 1]!.cp!).toBeGreaterThanOrEqual(finals[i]!.cp!);
    }
  });
});
