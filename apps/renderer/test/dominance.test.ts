/**
 * CP-mode dominance prune (`pruneDominatedForCp`) — the structural combo-count
 * cut for SOLVE CP. CP is monotone in every gear stat, so a piece whose stat
 * contribution is ≥ another's of the same set/effect group on every axis (and >
 * on one) can never produce a higher-CP build than that dominator. These tests
 * lock:
 *  - strictly-dominated pieces are dropped, Pareto-incomparable + ties kept;
 *  - pieces in different groups (set / effect) are never pitted;
 *  - the prune compares the PASSED (post-reforge) stats, not anything cached;
 *  - end-to-end, applying the prune leaves the CP ranking's TOP untouched and
 *    only removes builds a higher-CP twin already dominates (no recall loss at
 *    the top, dropped pieces never appear in the pruned result set).
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat, StatScaling } from "@gear-solver/core";
import { finalizeBuilds, pruneDominatedForCp, solveChunk, type SolveContext } from "../src/lib/solver/engine.js";
import type { FinalStatsBaseline, ScalingMap } from "../src/lib/composeBuild.js";
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

const flatSub = (stat: string, value: number): RolledStat =>
  ({ stat, value, percent: false, ticks: 1 } as unknown as RolledStat);

const ONE_GROUP = () => "g";

describe("pruneDominatedForCp — single group", () => {
  it("drops a strictly-dominated piece (≥ on all axes, > on one)", () => {
    const hi = piece("armor", "hi", { subs: [flatSub("atk", 300), flatSub("hp", 500)] });
    const lo = piece("armor", "lo", { subs: [flatSub("atk", 200), flatSub("hp", 500)] });
    const out = pruneDominatedForCp([hi, lo], ONE_GROUP);
    expect(out.map((p) => p.uid)).toEqual(["hi"]);
  });

  it("keeps Pareto-incomparable pieces (each best on a different axis)", () => {
    const a = piece("armor", "a", { subs: [flatSub("atk", 300), flatSub("hp", 100)] });
    const b = piece("armor", "b", { subs: [flatSub("atk", 100), flatSub("hp", 300)] });
    const out = pruneDominatedForCp([a, b], ONE_GROUP);
    expect(out.map((p) => p.uid).sort()).toEqual(["a", "b"]);
  });

  it("keeps exact ties (equal on every CP-relevant axis → not strictly dominated)", () => {
    const a = piece("armor", "a", { subs: [flatSub("atk", 300)] });
    const b = piece("armor", "b", { subs: [flatSub("atk", 300)] });
    expect(pruneDominatedForCp([a, b], ONE_GROUP).map((p) => p.uid).sort()).toEqual(["a", "b"]);
  });

  it("ignores axes CP never reads (a difference there isn't dominance)", () => {
    // `score`/`combatOnly`-style keys aren't in the CP-relevant set. Two pieces
    // equal on every relevant axis but differing on an irrelevant sub stay both.
    const a = piece("armor", "a", { subs: [flatSub("atk", 300), flatSub("unknownStat", 10)] });
    const b = piece("armor", "b", { subs: [flatSub("atk", 300), flatSub("unknownStat", 99)] });
    expect(pruneDominatedForCp([a, b], ONE_GROUP).map((p) => p.uid).sort()).toEqual(["a", "b"]);
  });

  it("collapses a transitive chain to the frontier", () => {
    const top = piece("armor", "top", { subs: [flatSub("atk", 300)] });
    const mid = piece("armor", "mid", { subs: [flatSub("atk", 200)] });
    const bot = piece("armor", "bot", { subs: [flatSub("atk", 100)] });
    // Order shuffled so the dropped dominator (mid) is visited before the
    // survivor for `bot` — the prune must still kill bot via the surviving top.
    expect(pruneDominatedForCp([bot, mid, top], ONE_GROUP).map((p) => p.uid)).toEqual(["top"]);
  });

  it("returns the input unchanged for < 2 pieces", () => {
    const only = [piece("armor", "x", { subs: [flatSub("atk", 100)] })];
    expect(pruneDominatedForCp(only, ONE_GROUP)).toBe(only);
  });
});

describe("pruneDominatedForCp — grouping", () => {
  it("never pits pieces of different groups (a dominated-looking piece of another set survives)", () => {
    const a = piece("armor", "a", { armorSetId: "A", subs: [flatSub("atk", 300)] });
    const b = piece("armor", "b", { armorSetId: "B", subs: [flatSub("atk", 100)] });
    const out = pruneDominatedForCp([a, b], (p) => p.armorSetId ?? "—");
    expect(out.map((p) => p.uid).sort()).toEqual(["a", "b"]);
  });

  it("prunes within a group while keeping every group's frontier", () => {
    const aHi = piece("armor", "aHi", { armorSetId: "A", subs: [flatSub("atk", 300)] });
    const aLo = piece("armor", "aLo", { armorSetId: "A", subs: [flatSub("atk", 100)] });
    const bHi = piece("armor", "bHi", { armorSetId: "B", subs: [flatSub("atk", 300)] });
    const bLo = piece("armor", "bLo", { armorSetId: "B", subs: [flatSub("atk", 100)] });
    const out = pruneDominatedForCp([aHi, aLo, bHi, bLo], (p) => p.armorSetId ?? "—");
    expect(out.map((p) => p.uid).sort()).toEqual(["aHi", "bHi"]);
  });

  it("compares the PASSED stats — a reforge-boosted twin escapes dominance", () => {
    // Captured: lo (atk 200) is dominated by hi (atk 300). After a reforge
    // projection the caller passes lo with atk 350 + a fresh hp roll → now
    // Pareto-incomparable, so it must survive. This is why the prune runs on
    // the projected pool pieces, not the raw inventory.
    const hi = piece("armor", "hi", { subs: [flatSub("atk", 300), flatSub("hp", 400)] });
    const loReforged = piece("armor", "lo", { subs: [flatSub("atk", 350), flatSub("hp", 100)] });
    expect(pruneDominatedForCp([hi, loReforged], ONE_GROUP).map((p) => p.uid).sort()).toEqual(["hi", "lo"]);
  });
});

/* ── End-to-end: the prune preserves the top of the CP ranking ─────────────── */

const FILTERS: SolveFilters = {
  options: { onlyMaxed: false, reforgeMode: "disable", includeEquippedOnOthers: true, keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100,
  mainPicks: {}, setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
};

type Pools = SolveContext["pools"];

function makeCtx(pools: Pools, mode: SolveMode): SolveContext {
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode, heroUid: "hero",
    inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
    game: GAME, userGeasLevels: null, userCodexLevel: null, userSkills: SKILLS,
    filters: FILTERS, topK: 1000, chunkIndex: 0, chunkCount: 1,
  };
  return {
    req, pools, baseline: BASELINE, scaling: SCALING, ee: null,
    poolSizes: {}, scoredGems: [],
    gemDeltaByTalismanSlots: new Map([[4, null], [5, null]]),
    gemAllocByTalismanSlots: new Map([[4, { talisman: [], ee: [] }], [5, { talisman: [], ee: [] }]]),
    skills: SKILLS, starMeta: STAR_META, dmgStat: "atk", noCrit: false,
    setPlans: [] as SetPlan[], excludedSets: new Set(), allowBrokenSets: true,
    excludedWeaponEffects: new Set(), excludedAccessoryEffects: new Set(),
  };
}

describe("dominance prune — end-to-end CP equivalence", () => {
  it("dropping a dominated accessory leaves the #1 CP unchanged and removes only dominated builds", async () => {
    // Two accessories in the same (empty-effect) group: acHi strictly dominates
    // acLo (more crit damage, all else equal). A second armor axis gives the
    // search real breadth so the dominated piece isn't trivially the whole pool.
    const acHi = piece("accessory", "acHi", { main: [{ stat: "critDmg", value: 60, percent: true } as unknown as RolledStat] });
    const acLo = piece("accessory", "acLo", { main: [{ stat: "critDmg", value: 30, percent: true } as unknown as RolledStat] });
    const basePools = (): Pools => ({
      weapon: [piece("weapon", "w1", { main: [{ stat: "atkPct", value: 50, percent: true } as unknown as RolledStat] })],
      helmet: [piece("helmet", "h1"), piece("helmet", "h2", { subs: [flatSub("hp", 400)] })],
      armor: [piece("armor", "a1"), piece("armor", "a2", { subs: [flatSub("def", 120)] })],
      gloves: [piece("gloves", "g1")],
      boots: [piece("boots", "b1")],
      accessory: [acHi, acLo],
      ooparts: [piece("ooparts", "t1", { subs: [flatSub("atk", 150)] })],
    });

    // Full enumeration (no prune).
    const fullCtx = makeCtx(basePools(), "cp");
    const full = finalizeBuilds(fullCtx, (await solveChunk(fullCtx, 0, 1, 1000)).builds, "cp");

    // Pruned: apply the same dominance the engine applies to the accessory pool.
    const prunedPools = basePools();
    prunedPools.accessory = pruneDominatedForCp(prunedPools.accessory, () => "g");
    expect(prunedPools.accessory.map((p) => p.uid)).toEqual(["acHi"]); // acLo dropped
    const prunedCtx = makeCtx(prunedPools, "cp");
    const pruned = finalizeBuilds(prunedCtx, (await solveChunk(prunedCtx, 0, 1, 1000)).builds, "cp");

    // The very best build is identical (same pieces, same CP).
    expect(pruned[0]!.cp).toBe(full[0]!.cp);
    expect(pruned[0]!.pieceUids).toEqual(full[0]!.pieceUids);
    expect(full[0]!.pieceUids).toContain("acHi"); // the dominator wins the top

    // Every pruned build's CP exists in the full run (pruned ⊆ full).
    const fullCps = full.map((b) => b.cp);
    for (const b of pruned) expect(fullCps).toContain(b.cp);

    // The dominated accessory never appears in the pruned result set.
    for (const b of pruned) expect(b.pieceUids).not.toContain("acLo");

    // For every dominated build (one using acLo) there is a pruned build of ≥ CP.
    const bestPruned = pruned[0]!.cp!;
    for (const b of full) {
      if (b.pieceUids.includes("acLo")) expect(bestPruned).toBeGreaterThanOrEqual(b.cp!);
    }
  });
});
