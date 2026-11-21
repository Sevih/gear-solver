/// <reference types="node" />
// One Talisman main stat per team (G143) on the real contract (`data/derived/`):
// in team context a member's Talisman pool leaves out the Talismans whose main
// stat is the one of the Talisman retained by a member placed BEFORE them
// (`reservedTalismanMains` → `teamContextOf` → `teamSolveScope` → `solveArgsOf`
// → the engine's `allow`), counted with the excluded mains in `poolSizes`;
// the member's own `mainExcludes` stay untouched. The solve runs as the
// orchestrator runs it, on one chunk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { buildSolveFilters, filterDefaults } from "../src/lib/solver/builderFilters.js";
import { compareBuilds, finalizeBuilds, precomputeContext, solveChunk } from "../src/lib/solver/engine.js";
import { solveArgsOf } from "../src/lib/solver/solveArgs.js";
import type { PoolSizes, SolveBuild, SolveRequest } from "../src/lib/solver/types.js";
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

const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false } as RolledStat],
  helmet: [{ stat: "hp", value: 2400, percent: false } as RolledStat],
  armor: [{ stat: "def", value: 300, percent: false } as RolledStat],
  gloves: [{ stat: "critRate", value: 24, percent: true } as RolledStat],
  boots: [{ stat: "spd", value: 40, percent: false } as RolledStat],
  accessory: [{ stat: "atkPct", value: 30, percent: true } as RolledStat],
};
/** A Talisman main as the parser reads one (an IOT_BUFF option). */
const talismanMain = (stat: string, value: number): RolledStat[] =>
  [{ stat, value, percent: true, fromBuff: true, source: "option" } as RolledStat];

function piece(uid: string, slot: string, equippedBy: string | null, main: RolledStat[] = MAINS[slot]!): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main, subs: [], gemSlots: slot === "ooparts" ? [0, 0, 0, 0, 0] : [],
  } as unknown as GearPiece;
}

const hero = (uid: string) => ({
  uid, charId: 2000001, name: uid, stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
  skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
});

/** Member 2 ("B") wears a full set but a Talisman; member 1 ("A") wears tA
 *  (`aMain`). On offer: tC, a CHD Talisman (B's best with CHD as priority),
 *  and tD, a DEF% one. */
function inventory(aMain: string): Inventory {
  const gear = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"].map((s) => piece(`${s}B`, s, "B"));
  gear.push(piece("tA", "ooparts", "A", talismanMain(aMain, 36)));
  gear.push(piece("tC", "ooparts", null, talismanMain("critDmg", 36)));
  gear.push(piece("tD", "ooparts", null, talismanMain("defPct", 18)));
  return { characters: [hero("A"), hero("B")], gear, presets: [] } as unknown as Inventory;
}

/** Team A, B — member 1's retained build holds tA. */
function team(): Team {
  let t = createTeam("WB", "t1", 0)!;
  t = addMember(t, "A", filterDefaults("classic", false))!;
  t = addMember(t, "B", filterDefaults("classic", false))!;
  return retainBuild(t, "A", { pieceUids: ["", "", "", "", "", "", "tA", ""], mode: "score", cp: 1, at: 1 });
}

/** A member's Optimizer solve in team context, CHD as priority. */
async function solve(inv: Inventory, heroUid: "A" | "B"): Promise<{ builds: SolveBuild[]; poolSizes: PoolSizes; mainExcludes: unknown }> {
  const ctx = teamContextOf([team()], { teamId: "t1", heroUid }, new Set(), new Map(inv.gear.map((g) => [g.uid, g])))!;
  const base = filterDefaults("classic", false);
  const filters = {
    ...base, priority: { critDmg: 1 },
    options: { ...base.options, reforgeMode: "disable" as const, allowBrokenSets: true },
  };
  const scope = teamSolveScope(
    { filters, heroPriority: {}, excludedPieceUids: undefined, worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null },
    ctx,
  );
  const args = solveArgsOf({
    mode: "score", hero: inv.characters.find((c) => c.uid === heroUid)!, inventory: inv, game: GAME, userGeasLevels: null, userCodexLevel: null,
    heroPriority: scope.heroPriority, excludedPieceUids: scope.excludedPieceUids, worklistClaims: scope.worklistClaims,
    presetHolds: scope.presetHolds, targetPresetNum: scope.targetPresetNum, gemReservedPieceUids: scope.gemReservedPieceUids,
    reservedTalismanMains: scope.reservedTalismanMains, filters: buildSolveFilters(scope.filters),
  }, { topN: 50, topK: 50 });
  const req: SolveRequest = { ...args, type: "solve", solveId: 1, topK: 50, chunkIndex: 0, chunkCount: 1 };
  const pre = precomputeContext(req);
  const solveCtx = { req, ...pre };
  const { builds } = await solveChunk(solveCtx, 0, 1, 50);
  return {
    builds: finalizeBuilds(solveCtx, builds, "score").sort((a, b) => compareBuilds(a, b, "score")),
    poolSizes: pre.poolSizes,
    mainExcludes: args.filters.mainExcludes,
  };
}

const talismanOf = (b: SolveBuild): string | undefined => b.pieceUids.find((u) => u.startsWith("t"));

describe("team context — one Talisman main stat per team", () => {
  it("member 1's Talisman is CHD: member 2's best Talisman (CHD) is out, they receive another; member 1 chooses freely", async () => {
    // A's Talisman is DEF%: B takes the CHD Talisman, their best.
    const free = await solve(inventory("defPct"), "B");
    expect(free.builds.length).toBeGreaterThan(0);
    expect(talismanOf(free.builds[0]!)).toBe("tC");

    // A's Talisman is CHD: no CHD Talisman for B, the DEF% one instead.
    const taken = await solve(inventory("critDmg"), "B");
    expect(taken.builds.length).toBeGreaterThan(0);
    expect(taken.builds.every((b) => talismanOf(b) === "tD")).toBe(true);
    expect(taken.poolSizes.talisman).toMatchObject({ hit: 1, mainExcluded: 1 });
    // Not written to the member's filters.
    expect(taken.mainExcludes).toEqual({});

    // Member 1 has the choice: nobody before them.
    const first = await solve(inventory("critDmg"), "A");
    expect(first.builds.length).toBeGreaterThan(0);
    expect(first.poolSizes.talisman!.mainExcluded).toBeUndefined();
    expect(["tA", "tC"]).toContain(talismanOf(first.builds[0]!));
  });
});
