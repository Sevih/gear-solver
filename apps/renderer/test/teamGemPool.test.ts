/// <reference types="node" />
// A team member's gem pool (G142) on the real contract (`data/derived/`): in
// team context the gems socketed in a piece of the build retained by ANOTHER
// member are out of the member's gem pool (`reservedGemPieces` →
// `teamSolveScope` → `solveArgsOf` → the engine's `buildGemPool`), whoever
// wears the piece; the gems on any other hero's Talisman stay in (scope
// "all"). The solve runs as the orchestrator runs it, on one chunk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { buildSolveFilters, filterDefaults } from "../src/lib/solver/builderFilters.js";
import { compareBuilds, finalizeBuilds, precomputeContext, solveChunk } from "../src/lib/solver/engine.js";
import { solveArgsOf } from "../src/lib/solver/solveArgs.js";
import type { SolveBuild, SolveRequest } from "../src/lib/solver/types.js";
import { teamContextOf, teamSolveScope } from "../src/lib/teams/teamContext.js";
import { addMember, createTeam, retainBuild, type Team } from "../src/lib/teams/teams.js";

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

/** Lv6 CHD gem — the only gem of the inventory. */
const CHD6 = 15050;
const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false } as RolledStat],
  helmet: [{ stat: "hp", value: 2400, percent: false } as RolledStat],
  armor: [{ stat: "def", value: 300, percent: false } as RolledStat],
  gloves: [{ stat: "critRate", value: 24, percent: true } as RolledStat],
  boots: [{ stat: "spd", value: 40, percent: false } as RolledStat],
  accessory: [{ stat: "atkPct", value: 30, percent: true } as RolledStat],
  ooparts: [{ stat: "atk", value: 300, percent: false } as RolledStat],
};

function piece(uid: string, slot: string, equippedBy: string | null, gems: number[] = []): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main: MAINS[slot]!, subs: [], gemSlots: slot === "ooparts" ? [...gems, 0, 0, 0, 0, 0].slice(0, 5) : [],
  } as unknown as GearPiece;
}

const hero = (uid: string) => ({
  uid, charId: 2000001, name: uid, stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
  skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
});

/** Member 2 ("B") wears a full set, its Talisman without gems; member 1 ("A")
 *  wears Talisman tA, hero "X" (outside the team) Talisman tX. The CHD gem sits
 *  on `gemOn`. */
function inventory(gemOn: "tA" | "tX"): Inventory {
  const gear = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"].map((s) => piece(`${s}B`, s, "B"));
  gear.push(piece("tA", "ooparts", "A", gemOn === "tA" ? [CHD6] : []));
  gear.push(piece("tX", "ooparts", "X", gemOn === "tX" ? [CHD6] : []));
  return { characters: [hero("A"), hero("B"), hero("X")], gear, presets: [] } as unknown as Inventory;
}

/** Team A, B — member 1's retained build holds tA. */
function team(): Team {
  let t = createTeam("WB", "t1", 0)!;
  t = addMember(t, "A", filterDefaults("classic", false))!;
  t = addMember(t, "B", filterDefaults("classic", false))!;
  return retainBuild(t, "A", { pieceUids: ["", "", "", "", "", "", "tA", ""], mode: "score", cp: 1, at: 1 });
}

/** Member B's Optimizer solve in team context, CHD as priority, `critDmgMin` as
 *  a CHD bound. */
async function solveB(inv: Inventory, critDmgMin?: number): Promise<SolveBuild[]> {
  const ctx = teamContextOf([team()], { teamId: "t1", heroUid: "B" }, new Set(), new Map(inv.gear.map((g) => [g.uid, g])))!;
  const base = filterDefaults("classic", false);
  const filters = {
    ...base, priority: { critDmg: 1 },
    options: { ...base.options, reforgeMode: "disable" as const, allowBrokenSets: true },
    ...(critDmgMin != null ? { statFilters: { critDmg: { min: critDmgMin } } } : {}),
  };
  const scope = teamSolveScope(
    { filters, heroPriority: {}, excludedPieceUids: undefined, worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null },
    ctx,
  );
  const args = solveArgsOf({
    mode: "score", hero: inv.characters.find((c) => c.uid === "B")!, inventory: inv, game: GAME, userGeasLevels: null, userCodexLevel: null,
    heroPriority: scope.heroPriority, excludedPieceUids: scope.excludedPieceUids, worklistClaims: scope.worklistClaims,
    presetHolds: scope.presetHolds, targetPresetNum: scope.targetPresetNum, gemReservedPieceUids: scope.gemReservedPieceUids,
    filters: buildSolveFilters(scope.filters),
  }, { topN: 50, topK: 50 });
  const req: SolveRequest = { ...args, type: "solve", solveId: 1, topK: 50, chunkIndex: 0, chunkCount: 1 };
  const solveCtx = { req, ...precomputeContext(req) };
  const { builds } = await solveChunk(solveCtx, 0, 1, 50);
  return finalizeBuilds(solveCtx, builds, "score").sort((a, b) => compareBuilds(a, b, "score"));
}

const critDmgOf = (b: SolveBuild): number => (b.finalStats as unknown as Record<string, number>).critDmg!;
const gemsOf = (b: SolveBuild): number[] => [...(b.gemAllocation?.talisman ?? []), ...(b.gemAllocation?.ee ?? [])];

describe("team context — the gems of another member's retained pieces stay out of the gem pool", () => {
  it("a bound only member 1's Talisman gem reaches: member 2 gets no build; the same gem on a hero outside the team: it is socketed", async () => {
    // Without the gem: member 2's CHD with the reserved gem out (no bound).
    const free = await solveB(inventory("tA"));
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((b) => !gemsOf(b).includes(CHD6))).toBe(true);
    expect(free.every((b) => !b.pieceUids.includes("tA"))).toBe(true);
    const bound = Math.max(...free.map(critDmgOf)) + 1;

    // The gem sits on member 1's retained Talisman: the bound is out of reach.
    expect(await solveB(inventory("tA"), bound)).toEqual([]);

    // The same gem on X's Talisman (X outside the team): member 2 receives it.
    const outside = await solveB(inventory("tX"), bound);
    expect(outside.length).toBeGreaterThan(0);
    expect(gemsOf(outside[0]!)).toContain(CHD6);
    expect(critDmgOf(outside[0]!)).toBeGreaterThanOrEqual(bound);
  });
});
