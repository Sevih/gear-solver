/**
 * The member solves of a "Build team" pass (`buildTeam.ts`), run by the
 * solver's orchestrator — the same `SolverOrchestrator` and worker pool the
 * Optimizer solves with (sized by Settings › Solver's worker count, read by
 * the orchestrator itself), the same request (`solveArgsOf`) with the same
 * result-set size and heap depth, under the team's piece rule
 * (`teamSolveScope`: scope "all", the member's exclusion, the other members'
 * retained pieces' gems out of the gem pool, the earlier members' Talisman
 * mains out of the Talisman pool, the other members' Talisman mains counted
 * in the stats, no hero rank, Worklist claim, preset hold or target preset).
 *
 * One orchestrator per pass, created at its start and disposed at its end
 * (`dispose`), so its workers live only while a team is being built: the
 * Optimizer's own orchestrator belongs to its screen (created at its first
 * SOLVE, torn down with it or at a worker-count change), and App lets no pass
 * start while it solves.
 */
import type { GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { buildSolveFilters } from "../solver/builderFilters.js";
import { emptySolveReason } from "../solver/emptyReason.js";
import { SolverOrchestrator } from "../solver/orchestrator.js";
import { solveArgsOf } from "../solver/solveArgs.js";
import type { PoolSizes } from "../solver/types.js";
import { teamSolveScope } from "./teamContext.js";
import type { MemberSolveOutcome, MemberSolver } from "./buildTeam.js";

export interface TeamSolverContext {
  inventory: Inventory;
  game: GameData;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  topN: number;
  topK: number;
}

export interface TeamSolver {
  solve: MemberSolver;
  /** Tear the pass's worker pool down. */
  dispose(): void;
}

export function createTeamSolver(ctx: TeamSolverContext): TeamSolver {
  // The solve in flight: its promise's resolver and the pool sizes its
  // precompute reported (an empty slot is the reason a solve has no build).
  let pending: { resolve: (o: MemberSolveOutcome) => void; poolSizes: PoolSizes | null } | null = null;
  const settle = (o: MemberSolveOutcome) => {
    const p = pending;
    pending = null;
    p?.resolve(o);
  };
  const orchestrator = new SolverOrchestrator({
    onProgress: (p) => { if (pending && p.poolSizes) pending.poolSizes = p.poolSizes; },
    onResult: (builds, _ms, _debug, _tick, cause) => {
      const best = builds[0] ?? null;
      settle({ build: best, reason: best ? null : emptySolveReason(pending?.poolSizes, cause) });
    },
    onError: (message) => settle({ build: null, reason: `Solve failed: ${message}` }),
  });

  const solve: MemberSolver = ({ heroUid, filters, mode, exclusion, gemReserved, talismanMains, talismanBuffs }) => {
    const hero = ctx.inventory.characters.find((c) => c.uid === heroUid);
    if (!hero) return Promise.resolve({ build: null, reason: "No longer in the roster" });
    const scope = teamSolveScope(
      { filters, heroPriority: {}, excludedPieceUids: undefined, worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null },
      { exclusion, gemReserved, talismanMains, talismanBuffs },
    );
    return new Promise<MemberSolveOutcome>((resolve) => {
      pending = { resolve, poolSizes: null };
      orchestrator.solve(solveArgsOf(
        {
          mode, hero, inventory: ctx.inventory, game: ctx.game, userGeasLevels: ctx.userGeasLevels, userCodexLevel: ctx.userCodexLevel,
          heroPriority: scope.heroPriority, excludedPieceUids: scope.excludedPieceUids, worklistClaims: scope.worklistClaims,
          presetHolds: scope.presetHolds, targetPresetNum: scope.targetPresetNum, gemReservedPieceUids: scope.gemReservedPieceUids,
          reservedTalismanMains: scope.reservedTalismanMains, teamTalismanBuffs: scope.teamTalismanBuffs,
          filters: buildSolveFilters(scope.filters),
        },
        { topN: ctx.topN, topK: ctx.topK },
      ));
    });
  };

  // A solve still in flight never settles (the pool is gone without a flush):
  // nothing is retained nor cleared for that member.
  return { solve, dispose: () => { pending = null; orchestrator.dispose(); } };
}
