/// <reference types="node" />
// In-game presets in the solver pool (`lib/presets/presetHolds.ts`): a locked
// preset's pieces leave every pool but its own solve's; "Optimize preset →" on
// a preset of rank N never takes the pieces of a preset not strictly lower
// priority; without a target preset only the locks count. Then the same rule
// through `precomputeContext` (`allow()`) on the real contract, stacked with
// `excludedPieceUids` and `worklistClaims`, and through the gem pool.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, Preset, StatType } from "@gear-solver/core";
import { presetBlockedUids, presetGameOrder, presetHoldersOf, presetHolds, type PresetHolds } from "../src/lib/presets/presetHolds.js";
import { fillUnrankedByOrder } from "../src/lib/storage/rankPriority.js";
import { buildGemPool } from "../src/lib/solver/gems.js";
import { precomputeContext } from "../src/lib/solver/engine.js";
import type { SolveFilters, SolveRequest } from "../src/lib/solver/types.js";

const preset = (num: number, itemUids: string[], extra: Partial<Preset> = {}): Preset => ({
  num, name: `P${num}`, itemUids, favorite: false, presetType: 0, sortOrder: 0, ...extra,
});
const piece = (uid: string, slot: GearPiece["slot"] = "ooparts"): GearPiece => ({ uid, slot } as GearPiece);
const holds = (presets: Preset[], rank: Record<string, number>, locked: number[] = [], gear?: GearPiece[]): PresetHolds =>
  presetHolds({ gear: gear ?? presets.flatMap((p) => p.itemUids).filter((u) => u !== "0").map((u) => piece(u)), presets }, rank, locked);
const blocked = (h: PresetHolds, target: number | null) => [...presetBlockedUids(h, target)].sort();

describe("presetHolds", () => {
  it("indexes each piece's presets, EE and empty slots left out", () => {
    const gear = [piece("w1", "weapon"), piece("ee", "exclusive"), piece("t1")];
    const h = presetHolds({ gear, presets: [preset(1, ["w1", "0", "ee", "t1"]), preset(2, ["t1", ""])] }, { 1: 1 }, [2]);
    expect(h.holders).toEqual({ w1: [1], t1: [1, 2] });
    expect(h.rank).toEqual({ 1: 1 });
    expect(h.locked).toEqual([2]);
  });
});

describe("presetBlockedUids", () => {
  // Ranks 1..4, preset 9 unranked; one piece each.
  const P = [preset(1, ["a"]), preset(2, ["b"]), preset(3, ["c"]), preset(4, ["d"]), preset(9, ["u"])];
  const RANK = { 1: 1, 2: 2, 3: 3, 4: 4 };

  it("no table → nothing blocked", () => {
    expect(presetBlockedUids(undefined, 3).size).toBe(0);
  });
  it("a locked preset's pieces leave every pool but its own solve's", () => {
    const h = holds(P, RANK, [4]);
    expect(blocked(h, null)).toEqual(["d"]);             // hero solve
    expect(blocked(h, 1)).toEqual(["d"]);                // rank 1 may take everything else
    expect(blocked(h, 4)).toEqual(["a", "b", "c"]);      // its own solve keeps them
  });
  it("target rank 3: the pieces of ranks 1 and 2 are out, rank 4 and the unranked stay", () => {
    expect(blocked(holds(P, RANK), 3)).toEqual(["a", "b"]);
  });
  it("target rank 1 takes everything; an unranked target takes nothing of another preset", () => {
    expect(blocked(holds(P, RANK), 1)).toEqual([]);
    expect(blocked(holds(P, RANK), 9)).toEqual(["a", "b", "c", "d"]);
  });
  it("without a target preset only the locks count", () => {
    expect(blocked(holds(P, RANK), null)).toEqual([]);
    expect(blocked(holds(P, RANK, [1, 9]), null)).toEqual(["a", "u"]);
  });
  it("a piece held by two presets: the most restrictive wins", () => {
    // s1: rank 4 + rank 1; s2: rank 4 + locked unranked 9; s3: the target + rank 4.
    const two = [preset(1, ["s1"]), preset(3, ["s3"]), preset(4, ["s1", "s2", "s3"]), preset(9, ["s2"])];
    const h = holds(two, RANK, [9]);
    expect(blocked(h, 3)).toEqual(["s1", "s2"]);
    expect(blocked(h, null)).toEqual(["s2"]);
    expect(blocked(h, 4)).toEqual(["s1", "s2", "s3"]); // s3: preset 3 outranks 4
  });
});

describe("presetHoldersOf", () => {
  const h = holds([preset(1, ["x"]), preset(2, ["x"]), preset(3, ["x"]), preset(5, ["y"])], { 3: 1, 1: 2 });
  it("the presets other than the target holding the piece, best-ranked first", () => {
    expect(presetHoldersOf(h, "x", null)).toEqual([3, 1, 2]);
    expect(presetHoldersOf(h, "x", 3)).toEqual([1, 2]);
    expect(presetHoldersOf(h, "y", 5)).toEqual([]);
    expect(presetHoldersOf(h, "free", null)).toEqual([]);
    expect(presetHoldersOf(undefined, "x", null)).toEqual([]);
  });
});

describe("default preset rank = the in-game order", () => {
  const presets = [
    preset(1, [], { sortOrder: 1 }),
    preset(2, [], { favorite: true }),
    preset(3, [], { sortOrder: 5 }),
    preset(4, [], { presetType: 1, favorite: true }),
    preset(5, []),
  ];
  it("favorites first, then sortOrder descending, then num; Master League last", () => {
    expect(presetGameOrder(presets)).toEqual(["2", "3", "1", "5", "4"]);
  });
  it("fills the presets never offered a rank below the ranked ones, a cleared one stays cleared", () => {
    expect(fillUnrankedByOrder({}, presetGameOrder(presets))).toEqual({ 2: 1, 3: 2, 1: 3, 5: 4, 4: 5 });
    expect(fillUnrankedByOrder({ 5: 1 }, presetGameOrder(presets), new Set(["3"]))).toEqual({ 5: 1, 2: 2, 1: 3, 4: 4 });
  });
});

/* ── through the engine, on the real contract ───────────────────────────── */

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

/** A 6★ talisman (Tactician's Charm), free unless `equippedBy`. */
function talisman(uid: string, equippedBy: string | null = null, gemSlots: number[] = []): GearPiece {
  return {
    uid, itemId: 10207, slot: "ooparts", setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main: [{ stat: "atkPct" as StatType, value: 30, percent: true }], subs: [], gemSlots,
  } as unknown as GearPiece;
}

function talismanPool(gear: GearPiece[], presets: Preset[], extra: Partial<SolveRequest> & { rank?: Record<string, number>; locked?: number[]; scope?: "none" | "lower" | "all" }): string[] {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const filters: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: extra.scope ?? "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const inventory = { characters: [hero], gear, presets } as unknown as Inventory;
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: "score", heroUid: "H", game: GAME, inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 10, chunkIndex: 0, chunkCount: 1, filters,
    presetHolds: presetHolds(inventory, extra.rank ?? {}, extra.locked ?? []),
    ...extra,
  };
  return precomputeContext(req).pools.ooparts.map((g) => g.uid).sort();
}

describe("allow() with presetHolds", () => {
  // t1 rank 1 · t3 rank 3 · t4 rank 4 · t5 locked rank 5 · t9 unranked · free = in no preset.
  const GEAR = ["t1", "t3", "t4", "t5", "t9", "free"].map((u) => talisman(u));
  const PRESETS = [preset(1, ["t1"]), preset(3, ["t3"]), preset(4, ["t4"]), preset(5, ["t5"]), preset(9, ["t9"])];
  const opts = { rank: { 1: 1, 3: 2, 4: 3, 5: 4 }, locked: [5] };

  it("no target preset: only the locked preset's pieces leave the pool", () => {
    expect(talismanPool(GEAR, PRESETS, { ...opts, targetPresetNum: null })).toEqual(["free", "t1", "t3", "t4", "t9"]);
  });
  it("optimizing preset 3 (rank 2): rank 1 and the locked one out, the lower and unranked ones in", () => {
    expect(talismanPool(GEAR, PRESETS, { ...opts, targetPresetNum: 3 })).toEqual(["free", "t3", "t4", "t9"]);
  });
  it("optimizing the locked preset keeps its own pieces", () => {
    expect(talismanPool(GEAR, PRESETS, { ...opts, targetPresetNum: 5 })).toEqual(["free", "t5", "t9"]);
  });
  it("a request without the table (older payload) keeps every piece", () => {
    expect(talismanPool(GEAR, PRESETS, { ...opts, presetHolds: undefined, targetPresetNum: 3 })).toEqual(["free", "t1", "t3", "t4", "t5", "t9"]);
  });
  it("stacks with excludedPieceUids and worklistClaims", () => {
    // t4 is fair game for preset 3 but excluded by hand; `free` is reserved by
    // the Worklist for hero X, not lower priority than H under "lower".
    expect(talismanPool(GEAR, PRESETS, {
      ...opts, targetPresetNum: 3, scope: "lower", excludedPieceUids: ["t4"], worklistClaims: { free: "X" },
    })).toEqual(["t3", "t9"]);
  });
  it("applies to the solving hero's own pieces too (a lock is account-wide)", () => {
    const worn = [talisman("mine", "H"), talisman("other")];
    expect(talismanPool(worn, [preset(2, ["mine"])], { locked: [2], targetPresetNum: null })).toEqual(["other"]);
  });
});

describe("gem pool with presetBlocked", () => {
  it("leaves the gems of a blocked preset's Talisman on it", () => {
    const inv = { gear: [talisman("tl", null, [15001]), talisman("tf", null, [15004])], characters: [], presets: [] } as unknown as Inventory;
    const opts = { heroUid: "H", equippedScope: "all" as const, heroPriority: {}, excludedHeroes: new Set<string>() };
    expect([...buildGemPool(inv, { ...opts, presetBlocked: new Set(["tl"]) }).keys()]).toEqual([15004]);
    expect([...buildGemPool(inv, opts).keys()].sort()).toEqual([15001, 15004]);
  });
});
