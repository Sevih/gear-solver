/// <reference types="node" />
// The Talisman mains of a team's other members in a member's stats (G144) on
// the real contract (`data/derived/`): a Talisman's main is a team buff that
// doesn't stack, so in team context a member's sheet takes, per stat,
// max(the other members' best, its own Talisman's) (`teamTalismanBuffs` →
// `teamContextOf` → `teamSolveScope` → `solveArgsOf` → the engine's combo
// sheet), its bounds and Score with it, while its CP stays the in-game one
// (without them). The Talismans are parsed from the wire (`parseGearPiece`),
// so their main is the value at their enhance level. The solve runs as the
// orchestrator runs it, on one chunk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGearPiece, type GameData, type GearPiece, type Inventory, type RawItem, type RolledStat } from "@gear-solver/core";
import { buildSolveFilters, filterDefaults, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { compareBuilds, finalizeBuilds, precomputeContext, solveChunk } from "../src/lib/solver/engine.js";
import { solveArgsOf } from "../src/lib/solver/solveArgs.js";
import type { SolveBuild, SolveMode, SolveRequest } from "../src/lib/solver/types.js";
import { teamContextOf, teamSolveScope, type SolveScope } from "../src/lib/teams/teamContext.js";
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

/** A 6★ Talisman (Executioner's Charm) and its main options: IOT_BUFF rows of
 *  `BID_ITEM_STAT_OOPARTS_ATK_6` (ATK% 12 at +0 … 15 at +10) and `_HP_6`. */
const TALISMAN_6 = 10201;
const ATK_PCT_6 = 10201;
const HP_PCT_6 = 10203;

/** A Talisman as the wire carries it, parsed at +`level`. */
function talisman(uid: string, option: number, level: number, wearer: string | null): GearPiece {
  const raw: RawItem = {
    ItemUID: uid, CharUID: wearer ?? "0", ItemID: TALISMAN_6, Exp: GAME.enhance.expCurves["ooparts|unique|6"]![level]!,
    BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0, SelectSubOptionNum: 0,
    SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [option], SubOptionList: [],
  };
  const p = parseGearPiece(raw, GAME);
  expect(p.enhanceLevel).toBe(level);
  return { ...p, uid, equippedBy: wearer };
}

const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false } as RolledStat],
  helmet: [{ stat: "hp", value: 2400, percent: false } as RolledStat],
  armor: [{ stat: "def", value: 300, percent: false } as RolledStat],
  gloves: [{ stat: "critRate", value: 24, percent: true } as RolledStat],
  boots: [{ stat: "spd", value: 40, percent: false } as RolledStat],
  accessory: [{ stat: "atkPct", value: 30, percent: true } as RolledStat],
};

function piece(uid: string, slot: string, equippedBy: string | null): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main: MAINS[slot]!, subs: [], gemSlots: [],
  } as unknown as GearPiece;
}

const hero = (uid: string) => ({
  uid, charId: 2000001, name: uid, stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
  skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
});

/** "B" wears a full set but a Talisman; their own Talisman pool is `own`.
 *  "A" wears tA, an ATK% Talisman at +`aLevel`. */
function inventory(own: GearPiece[], aLevel: number): Inventory {
  const gear = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"].map((s) => piece(`${s}B`, s, "B"));
  gear.push(talisman("tA", ATK_PCT_6, aLevel, "A"), ...own);
  return { characters: [hero("A"), hero("B")], gear, presets: [] } as unknown as Inventory;
}

/** Team B, A — member 2 (A, placed AFTER B: G143 leaves B's Talisman pool
 *  alone) retains tA. */
function team(): Team {
  let t = createTeam("WB", "t1", 0)!;
  t = addMember(t, "B", filterDefaults("classic", false))!;
  t = addMember(t, "A", filterDefaults("classic", false))!;
  return retainBuild(t, "A", { pieceUids: ["", "", "", "", "", "", "tA", ""], mode: "score", cp: 1, at: 1 });
}

const NO_TEAM: SolveScope = { filters: filterDefaults("classic", false), heroPriority: {}, excludedPieceUids: new Set(["tA"]), worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null };

/** B's solve, in team context or outside it (tA a never-use piece in both,
 *  so both see the same pools), ATK as priority, `atkMin` as an ATK bound. */
async function solve(inv: Inventory, inTeam: boolean, opts: { mode?: SolveMode; atkMin?: number } = {}): Promise<SolveBuild[]> {
  const mode = opts.mode ?? "score";
  const base = filterDefaults("classic", false);
  const filters: SolverFilters = {
    ...base, priority: { atk: 1 },
    statFilters: opts.atkMin != null ? { atk: { min: opts.atkMin } } : {},
    options: { ...base.options, reforgeMode: "disable" as const, allowBrokenSets: true, equippedScope: "all" },
  };
  // tA is a never-use piece here, so member 1 can't take it (in team, member 1 takes anything).
  const ctx = inTeam ? teamContextOf([team()], { teamId: "t1", heroUid: "B" }, new Set(["tA"]), new Map(inv.gear.map((g) => [g.uid, g])))! : null;
  const scope = teamSolveScope({ ...NO_TEAM, filters }, ctx);
  const args = solveArgsOf({
    mode, hero: inv.characters.find((c) => c.uid === "B")!, inventory: inv, game: GAME, userGeasLevels: null, userCodexLevel: null,
    heroPriority: scope.heroPriority, excludedPieceUids: scope.excludedPieceUids, worklistClaims: scope.worklistClaims,
    presetHolds: scope.presetHolds, targetPresetNum: scope.targetPresetNum, gemReservedPieceUids: scope.gemReservedPieceUids,
    reservedTalismanMains: scope.reservedTalismanMains, teamTalismanBuffs: scope.teamTalismanBuffs, filters: buildSolveFilters(scope.filters),
  }, { topN: 50, topK: 50 });
  const req: SolveRequest = { ...args, type: "solve", solveId: 1, topK: 50, chunkIndex: 0, chunkCount: 1 };
  const pre = precomputeContext(req);
  const solveCtx = { req, ...pre };
  const { builds } = await solveChunk(solveCtx, 0, 1, 50);
  return finalizeBuilds(solveCtx, builds, mode).sort((a, b) => compareBuilds(a, b, mode));
}

describe("team context — the other members' Talisman mains in a member's stats", () => {
  it("parses the Talisman main at its enhance level: ATK% 12 at +0, 15 at +10", () => {
    expect(talisman("t0", ATK_PCT_6, 0, null).main[0]).toMatchObject({ stat: "atkPct", value: 12, fromBuff: true });
    expect(talisman("t10", ATK_PCT_6, 10, null).main[0]).toMatchObject({ stat: "atkPct", value: 15, fromBuff: true });
    const t = team();
    const at = (level: number) => teamContextOf([t], { teamId: "t1", heroUid: "B" }, new Set(), new Map(inventory([], level).gear.map((g) => [g.uid, g])))!.talismanBuffs;
    expect(at(0)).toEqual([{ stat: "atkPct", value: 12, percent: true, fromBuff: true, heroUid: "A" }]);
    expect(at(10)).toEqual([{ stat: "atkPct", value: 15, percent: true, fromBuff: true, heroUid: "A" }]);
  });

  it("an ATK bound only member 2's ATK% Talisman lets member 1 reach: met in team, missed outside; the CP unchanged", async () => {
    const inv = inventory([talisman("tH", HP_PCT_6, 10, null)], 10);
    const outside = (await solve(inv, false))[0]!;
    const inside = (await solve(inv, true))[0]!;
    expect(inside.pieceUids).toEqual(outside.pieceUids);
    expect(inside.finalStats.atk).toBeGreaterThan(outside.finalStats.atk);
    expect(inside.finalStats.hp).toBe(outside.finalStats.hp);
    // The Score counts the buff, the CP doesn't (the in-game CP reads the hero's own sheet).
    expect(inside.score).toBeGreaterThan(outside.score);
    expect(inside.cp).toBe(outside.cp);
    const bound = outside.finalStats.atk + 1;
    expect(inside.finalStats.atk).toBeGreaterThanOrEqual(bound);
    expect(await solve(inv, false, { atkMin: bound })).toEqual([]);
    const met = await solve(inv, true, { atkMin: bound });
    expect(met.length).toBeGreaterThan(0);
    expect(met[0]!.finalStats.atk).toBeGreaterThanOrEqual(bound);
    // SOLVE CP: the same CP in and out of the team.
    const [cpIn, cpOut] = [(await solve(inv, true, { mode: "cp" }))[0]!, (await solve(inv, false, { mode: "cp" }))[0]!];
    expect(cpIn.cp).toBe(cpOut.cp);
    expect(cpIn.finalStats.atk).toBeGreaterThan(cpOut.finalStats.atk);
  });

  it("doesn't stack with the member's own Talisman: own ATK% 12 under the team's 15 reads as 15, not 27", async () => {
    // B's only Talisman: an ATK% one at +0 (12). Outside the team, B wearing a
    // 15 % one (tA's twin) gives the sheet the team must show.
    const low = await solve(inventory([talisman("tLow", ATK_PCT_6, 0, null)], 10), true);
    const twin = await solve(inventory([talisman("tLow", ATK_PCT_6, 10, null)], 10), false);
    const alone = await solve(inventory([talisman("tLow", ATK_PCT_6, 0, null)], 10), false);
    expect(low[0]!.finalStats).toEqual(twin[0]!.finalStats);
    expect(low[0]!.finalStats.atk).toBeGreaterThan(alone[0]!.finalStats.atk);
    // Its CP is the one of its own sheet (12 %).
    expect(low[0]!.cp).toBe(alone[0]!.cp);
  });
});
