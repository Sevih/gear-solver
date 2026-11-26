/// <reference types="node" />
// A Min and a Max on the same stat under the combo-budget prune (Top % < 100),
// on the real engine (`precomputeContext` → `solveChunk` → `finalizeBuilds`)
// and the real contract (`data/derived/`). `keepTopUnion` splits each slot's
// budget between the objective and one floor scorer per Min-bounded stat;
// engaged for a Min the objective's pieces already reach, it halved the
// objective's slice and the fastest pieces it added overshot the Max: the
// builds the Max alone found were gone (Max SPD 164 → builds at 162, Min 162 +
// Max 164 → none). The floor scorer of a stat is now engaged only when the
// objective's kept pieces can't reach its Min (`minReachBound`).
//
// The inventory: per armor / weapon / accessory slot three pieces —
//   A: the best ATK, no SPD (the objective's first pick),
//   B: a little less ATK, +3 SPD (its second),
//   F: little ATK, +11 SPD (the SPD floor scorer's first pick);
// one Talisman without gems, no EE, no set. Top % 0.00025 keeps 2 pieces per
// slot (budget 66 for 729 combos): the objective alone keeps {A, B}, a split
// with one floor scorer keeps {A, F}. All-B is the only {A, B} build at its
// speed; no {A, F} build lands within one point of it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { compareBuilds, finalizeBuilds, precomputeContext, sheetUpperBound, solveChunk } from "../src/lib/solver/engine.js";
import type { SolveBuild, SolveFilters, SolveMode, SolveRequest } from "../src/lib/solver/types.js";

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

const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false }],
  helmet: [{ stat: "hp", value: 2400, percent: false }],
  armor: [{ stat: "def", value: 300, percent: false }],
  gloves: [{ stat: "critRate", value: 24, percent: true }],
  boots: [{ stat: "spd", value: 40, percent: false }],
  accessory: [{ stat: "atkPct", value: 30, percent: true }],
  ooparts: [{ stat: "atk", value: 300, percent: false }],
};
const KINDS: Record<string, { atk: number; spd: number }> = {
  A: { atk: 260, spd: 0 },
  B: { atk: 140, spd: 3 },
  F: { atk: 20, spd: 11 },
};
const PIECE_SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];

const ARMOR = new Set(["helmet", "armor", "gloves", "boots"]);

function piece(uid: string, slot: string, subs: RolledStat[], armorSetId: string | null = null): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: ARMOR.has(slot) ? armorSetId : null, rarity: "unique", star: 6, name: uid,
    classLimit: null, breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false,
    locked: false, equippedBy: null, main: MAINS[slot]!, subs, gemSlots: [],
  } as unknown as GearPiece;
}

/** `armorSetId`: the set every armor piece belongs to (none by default). */
function inventory(armorSetId: string | null = null): Inventory {
  const gear: GearPiece[] = [];
  for (const slot of PIECE_SLOTS) {
    for (const [kind, k] of Object.entries(KINDS)) {
      const subs: RolledStat[] = [{ stat: "atk", value: k.atk, percent: false, ticks: 1 } as RolledStat];
      if (k.spd) subs.push({ stat: "spd", value: k.spd, percent: false, ticks: 1 } as RolledStat);
      gear.push(piece(`${slot}-${kind}`, slot, subs, armorSetId));
    }
  }
  gear.push(piece("ooparts-T", "ooparts", []));
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  return { characters: [hero], gear, presets: [] } as unknown as Inventory;
}
const INV = inventory();

const TOP = 1000;
function requestOf(mode: SolveMode, filters: Partial<SolveFilters>, inv: Inventory = INV): SolveRequest {
  const base: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode, heroUid: "H", game: GAME, inventory: inv,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 },
    topK: TOP, chunkIndex: 0, chunkCount: 1, filters: { ...base, ...filters },
  };
  return req;
}
async function solve(mode: SolveMode, filters: Partial<SolveFilters>, inv: Inventory = INV): Promise<SolveBuild[]> {
  const req = requestOf(mode, filters, inv);
  const ctx = { req, ...precomputeContext(req) };
  const { builds } = await solveChunk(ctx, 0, 1, TOP);
  return finalizeBuilds(ctx, builds, mode).sort((a, b) => compareBuilds(a, b, mode));
}

const PRUNED = 0.00025;
const allOf = (kind: string): string[] => [...PIECE_SLOTS.map((s) => `${s}-${kind}`), "ooparts-T"];
const isAll = (b: SolveBuild, kind: string): boolean => allOf(kind).every((u) => b.pieceUids.includes(u));
const spdOf = (b: SolveBuild): number => b.finalStats.spd;

const CASES: Array<[string, SolveMode, Partial<SolveFilters>]> = [
  ["SOLVE (priority)", "score", { priority: { atk: 1 } }],
  ["SOLVE CP", "cp", {}],
];

describe("a Min under a Max on the same stat keeps the pruned results (real engine)", () => {
  for (const [label, mode, start] of CASES) {
    it(`${label}: Min ≤ the Max-only results' speed + Max → the same builds`, async () => {
      const full = await solve(mode, start);
      const allB = full.find((b) => isAll(b, "B"))!;
      const allF = full.find((b) => isAll(b, "F"))!;
      const s = spdOf(allB);
      // No {A, F} build within one point of all-B: a {A, F} pool can't serve it.
      expect(full.filter((b) => b.pieceUids.every((u) => !u.endsWith("-B")) && Math.abs(spdOf(b) - s) <= 1)).toEqual([]);
      expect(spdOf(allF)).toBeGreaterThan(s + 1);

      // Max alone: the pruned pools are the objective's {A, B}, all-B in the band.
      const maxOnly = await solve(mode, { ...start, topPct: PRUNED, statFilters: { spd: { max: s + 1 } } });
      expect(maxOnly.some((b) => isAll(b, "B"))).toBe(true);
      expect(maxOnly.every((b) => spdOf(b) <= s + 1)).toBe(true);

      // Min that those results already meet + the same Max: the same builds.
      const both = await solve(mode, { ...start, topPct: PRUNED, statFilters: { spd: { min: s, max: s + 1 } } });
      expect(both.map((b) => b.pieceUids.join(","))).toEqual(
        maxOnly.filter((b) => spdOf(b) >= s).map((b) => b.pieceUids.join(",")),
      );
      expect(both.length).toBeGreaterThan(0);
    });

    it(`${label}: a Min only the floor scorer reaches stays reachable, with or without a Max`, async () => {
      const full = await solve(mode, start);
      const f = spdOf(full.find((b) => isAll(b, "F"))!);
      // The objective's {A, B} tops out at all-B, under that Min: the SPD
      // floor scorer is engaged and its F pieces make all-F reachable.
      const minOnly = await solve(mode, { ...start, topPct: PRUNED, statFilters: { spd: { min: f } } });
      expect(minOnly.some((b) => isAll(b, "F"))).toBe(true);
      const both = await solve(mode, { ...start, topPct: PRUNED, statFilters: { spd: { min: f, max: f + 1 } } });
      expect(both.some((b) => isAll(b, "F"))).toBe(true);
      expect(both.every((b) => spdOf(b) >= f && spdOf(b) <= f + 1)).toBe(true);
    });
  }

  it("sheetUpperBound: no build beats it, and it is the best speed when one build maxes every slot (Speed set)", async () => {
    // Every armor piece in the Speed set (13) at BT4: the 4-pc's level-2
    // rows (2-pc 13 % + 4-pc 12 %) on top of the pieces.
    const inv = inventory("13");
    const req = requestOf("score", { priority: { atk: 1 } }, inv);
    const ctx = precomputeContext(req);
    const full = await solve("score", { priority: { atk: 1 } }, inv);
    const best = Math.max(...full.map(spdOf));
    const bound = sheetUpperBound(ctx.baseline, ctx.scaling, ctx.pools, null, GAME.sets, [], 0, []);
    expect(full.find((b) => isAll(b, "F"))!.finalStats.spd).toBe(best);
    expect(bound.spd).toBe(best);
    // Without the set the bound would sit under that build.
    expect(sheetUpperBound(ctx.baseline, ctx.scaling, ctx.pools, null, null, [], 0, []).spd).toBeLessThan(best);
  });
});
