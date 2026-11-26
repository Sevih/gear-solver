/**
 * The orchestrator's request for one hero — what the Optimizer's SOLVE and its
 * pre-solve estimate send (`screens/builder/useSolverSession.ts`), and what a
 * team's "Build team" sends for each member (`lib/teams/teamSolver.ts`): one
 * builder, so both paths ask the engine the same thing.
 *
 * Pure: no React, no worker.
 */
import type { Character, GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import type { EstimateArgs, SolveArgs } from "./orchestrator.js";
import type { SolveFilters, SolveMode } from "./types.js";
import type { TeamBuff } from "../composeBuild.js";
import type { HeroPriority } from "../storage/heroPriority.js";
import type { PresetHolds } from "../presets/presetHolds.js";

export interface SolveInputs {
  mode: SolveMode;
  hero: Character;
  inventory: Inventory;
  game: GameData;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  heroPriority: HeroPriority;
  excludedPieceUids: ReadonlySet<string> | undefined;
  worklistClaims: Record<string, string> | undefined;
  presetHolds: PresetHolds | undefined;
  targetPresetNum: number | null;
  /** Talisman / EE uids whose gems stay out of the gem pool — a team member's
   *  solve (`teamSolveScope`). Absent = none. */
  gemReservedPieceUids?: ReadonlySet<string>;
  /** Talisman main stats out of the Talisman pool — a team member's solve
   *  (`teamSolveScope`: the earlier members' Talisman mains). Absent = none. */
  reservedTalismanMains?: ReadonlySet<string>;
  /** The other members' Talisman mains the stats count — a team member's
   *  solve (`teamSolveScope`). Absent = none. Not in the estimate: they change
   *  no pool. */
  teamTalismanBuffs?: readonly TeamBuff[];
  /** Already serialized (`buildSolveFilters`). */
  filters: SolveFilters;
}

/** The estimate request: a solve without the result-set knobs. */
export function estimateArgsOf(i: SolveInputs): EstimateArgs {
  return {
    mode: i.mode,
    heroUid: i.hero.uid,
    inventory: i.inventory,
    game: i.game,
    userGeasLevels: i.userGeasLevels,
    userCodexLevel: i.userCodexLevel,
    heroPriority: i.heroPriority,
    excludedPieceUids: i.excludedPieceUids ? Array.from(i.excludedPieceUids) : undefined,
    worklistClaims: i.worklistClaims,
    presetHolds: i.presetHolds,
    targetPresetNum: i.targetPresetNum,
    ...(i.gemReservedPieceUids?.size ? { gemReservedPieceUids: Array.from(i.gemReservedPieceUids) } : {}),
    ...(i.reservedTalismanMains?.size ? { reservedTalismanMains: Array.from(i.reservedTalismanMains) } : {}),
    userSkills: {
      first: i.hero.skills.first,
      second: i.hero.skills.second,
      ultimate: i.hero.skills.ultimate,
      chainPassive: i.hero.skills.chainPassive,
    },
    filters: i.filters,
  };
}

/** The solve request: the estimate's plus the result-set size and per-worker
 *  heap depth (Settings › Solver), the HP fraction the lost-HP sets are counted
 *  at (Settings › Solver's « Simulate 50% HP », null = not counted; it changes
 *  no pool, so the estimate doesn't carry it), and the pieces kept through the
 *  prunes (only a result cell's "Min ≥ / Max ≤" passes them). */
export function solveArgsOf(i: SolveInputs, extra: { topN: number; topK: number; lostHpFraction?: number | null; pinPieceUids?: readonly string[] }): SolveArgs {
  return {
    ...estimateArgsOf(i),
    topN: extra.topN,
    topK: extra.topK,
    ...(i.teamTalismanBuffs?.length ? { teamTalismanBuffs: i.teamTalismanBuffs.map((b) => ({ ...b })) } : {}),
    ...(extra.lostHpFraction != null ? { lostHpFraction: extra.lostHpFraction } : {}),
    ...(extra.pinPieceUids?.length ? { pinPieceUids: [...extra.pinPieceUids] } : {}),
  };
}
