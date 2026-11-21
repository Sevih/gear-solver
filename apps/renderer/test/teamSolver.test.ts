/**
 * "Build team"'s member solves (G140, lib/teams/teamSolver.ts) on a fake
 * orchestrator: the request is the Optimizer's (`solveArgsOf`) under the
 * team's piece rule — scope "all", the member's exclusion, the other members'
 * retained pieces' gems out of the gem pool (G142), no hero rank,
 * Worklist claim, preset hold or target preset — with Settings › Solver's topN
 * / topK; the best result comes back, an empty one with the solver's reason,
 * a failure with its message; dispose tears the pool down.
 */
import { describe, expect, it, vi } from "vitest";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import type { SolveBuild } from "../src/lib/solver/types.js";

const orch = vi.hoisted(() => {
  type Cb = {
    onProgress: (p: { permutations: number; searched: number; poolSizes?: unknown }) => void;
    onResult: (builds: unknown[], ms: number, debug?: unknown, tick?: unknown, cause?: unknown) => void;
    onError: (msg: string) => void;
  };
  const state = { cb: null as Cb | null, solves: [] as Array<Record<string, unknown>>, disposed: 0 };
  class FakeOrchestrator {
    constructor(cb: Cb) { state.cb = cb; }
    solve(args: Record<string, unknown>) { state.solves.push(args); }
    cancel() {}
    estimate() {}
    dispose() { state.disposed++; }
  }
  return { state, FakeOrchestrator };
});
vi.mock("../src/lib/solver/orchestrator.js", () => ({ SolverOrchestrator: orch.FakeOrchestrator }));

const { createTeamSolver } = await import("../src/lib/teams/teamSolver.js");
const { filterDefaults } = await import("../src/lib/solver/builderFilters.js");

const hero = { uid: "ak", charId: 7, skills: { first: 1, second: 2, ultimate: 3, chainPassive: 4 } } as unknown as Character;
const inventory = { gear: [], characters: [hero], presets: [] } as unknown as Inventory;
const game = {} as GameData;
const build = (cp: number): SolveBuild => ({
  pieceUids: ["w1", "", "", "", "", "", "", ""], gemAllocation: { talisman: [], ee: [] },
  finalStats: {} as SolveBuild["finalStats"], ratings: {} as SolveBuild["ratings"], score: cp, cp, upg: 0,
});

describe("createTeamSolver", () => {
  it("asks the orchestrator the Optimizer's request under the team's rule, and returns the best result", async () => {
    const solver = createTeamSolver({ inventory, game, userGeasLevels: null, userCodexLevel: 12, topN: 300, topK: 40 });
    const filters = filterDefaults("classic", false);
    filters.options = { ...filters.options, equippedScope: "unequipped" as typeof filters.options.equippedScope };
    const p = solver.solve({ heroUid: "ak", filters, mode: "cp", exclusion: new Set(["x1", "w9"]), gemReserved: new Set(["t2"]), talismanMains: new Map([["atkPct", "ma"]]) });
    const req = orch.state.solves.at(-1)!;
    expect(req).toMatchObject({
      mode: "cp", heroUid: "ak", inventory, game, userCodexLevel: 12, heroPriority: {}, worklistClaims: undefined,
      presetHolds: undefined, targetPresetNum: null, topN: 300, topK: 40,
      userSkills: { first: 1, second: 2, ultimate: 3, chainPassive: 4 },
    });
    expect(req.excludedPieceUids).toEqual(["x1", "w9"]);
    expect(req.gemReservedPieceUids).toEqual(["t2"]);
    // The earlier members' Talisman mains (G143), never in the member's filters.
    expect(req.reservedTalismanMains).toEqual(["atkPct"]);
    expect((req.filters as { mainExcludes: Record<string, unknown> }).mainExcludes).toEqual({});
    expect((req.filters as { options: { equippedScope: string } }).options.equippedScope).toBe("all");
    expect(req).not.toHaveProperty("pinPieceUids");
    orch.state.cb!.onResult([build(900), build(800)], 10, undefined, null, null);
    await expect(p).resolves.toEqual({ build: build(900), reason: null });
    solver.dispose();
    expect(orch.state.disposed).toBe(1);
  });

  it("no result: the solver's reason (an emptied slot); a failure: its message; a hero gone: said so", async () => {
    const solver = createTeamSolver({ inventory, game, userGeasLevels: null, userCodexLevel: null, topN: 200, topK: 20 });
    const filters = filterDefaults("classic", false);
    const empty = solver.solve({ heroUid: "ak", filters, mode: "score", exclusion: new Set(), gemReserved: new Set(), talismanMains: new Map() });
    orch.state.cb!.onProgress({ permutations: 0, searched: 0, poolSizes: { weapon: { hit: 0, of: 4 }, helmet: { hit: 2, of: 2 } } });
    expect(orch.state.solves.at(-1)).not.toHaveProperty("gemReservedPieceUids");
    expect(orch.state.solves.at(-1)).not.toHaveProperty("reservedTalismanMains");
    orch.state.cb!.onResult([], 5, undefined, null, null);
    await expect(empty).resolves.toEqual({ build: null, reason: "A slot has no pieces left after filtering — Weapon: 0 pieces after filters" });
    const failed = solver.solve({ heroUid: "ak", filters, mode: "score", exclusion: new Set(), gemReserved: new Set(), talismanMains: new Map() });
    orch.state.cb!.onError("worker 0: boom");
    await expect(failed).resolves.toEqual({ build: null, reason: "Solve failed: worker 0: boom" });
    const solves = orch.state.solves.length;
    await expect(solver.solve({ heroUid: "gone", filters, mode: "score", exclusion: new Set(), gemReserved: new Set(), talismanMains: new Map() })).resolves.toEqual({ build: null, reason: "No longer in the roster" });
    expect(orch.state.solves.length).toBe(solves);
  });
});
