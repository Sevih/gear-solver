/**
 * "Build team" — every member of a team rebuilt in one pass, in team order:
 * member 1's solve, then 2, 3, 4, each with the member's own filters and mode
 * and under the team's piece rule (`memberExclusion`: the whole inventory but
 * the never-use pieces and the builds of the members placed before — the ones
 * this very pass just retained — and, for the gems, without those socketed in
 * any other member's retained build: `reservedGemPieces`; for the Talisman,
 * without the main stats of the Talismans the members before retain:
 * `reservedTalismanMains`; and its stats count the main stats of the
 * Talismans the other members hold at that point: `teamTalismanBuffs`, the
 * ones just retained for the members before, the previous ones of the members
 * after — no second pass). The best result (the first, in the mode's
 * order) becomes the member's retained build. Rebuilding them all, in order,
 * is what keeps the builds consistent with each other; there is no joint
 * optimum (the team order and each member's filters decide).
 *
 * The mode is the one of the member's retained build (Score without one), and
 * SOLVE's rule applies as in the Optimizer (`solveDecision`): in Score mode
 * without a priority, the weights of the hero's reco become their priority
 * (written to the member's filters), and without reco weights the member is
 * solved by Combat Power this once.
 *
 * A member without a result keeps "no build" (their previous build, if any,
 * is dropped), with the reason the solver gives; they take nothing, so the
 * members after them see the same exclusion. Stopping (`shouldStop`) takes
 * effect after the solve in progress: what was retained stays, the members not
 * reached keep their previous build (marked stale by the usual rule if it now
 * is).
 *
 * Pure: the solve and the reco are injected (`lib/teams/teamSolver.ts` runs
 * them on the solver's worker pool), the caller applies each member's outcome
 * to the live list as it lands.
 */
import { hasPriority, type Priority } from "../heroPriority/weights.js";
import { solveDecision } from "../reco/recoPriority.js";
import { solverFiltersReducer, type SolverFilters } from "../solver/builderFilters.js";
import type { SolveBuild, SolveMode } from "../solver/types.js";
import { clearBuild, memberExclusion, reservedGemPieces, reservedTalismanMains, retainBuild, teamBuildOf, teamTalismanBuffs, type Team, type TeamBuild, type TeamPieces, type TeamTalismanBuff } from "./teams.js";

/** What one member's solve came back with: its best build, or none and why. */
export interface MemberSolveOutcome {
  build: SolveBuild | null;
  /** Why there is no build (the solver's reason, or the failure). */
  reason: string | null;
}

export interface MemberSolveRequest {
  heroUid: string;
  filters: SolverFilters;
  mode: SolveMode;
  /** The pieces this solve leaves out (`memberExclusion` on the pass's team). */
  exclusion: ReadonlySet<string>;
  /** The pieces whose gems this solve's gem pool leaves out (`reservedGemPieces`
   *  on the pass's team: every other member's retained build). */
  gemReserved: ReadonlySet<string>;
  /** The Talisman main stats this solve's Talisman pool leaves out, with the
   *  member holding each (`reservedTalismanMains` on the pass's team: the
   *  Talismans of the members before, the ones this pass just retained). */
  talismanMains: ReadonlyMap<string, string>;
  /** The other members' Talisman mains this solve's stats count
   *  (`teamTalismanBuffs` on the pass's team: the Talismans just retained for
   *  the members before, the current ones of the members after). */
  talismanBuffs: readonly TeamTalismanBuff[];
}

export type MemberSolver = (req: MemberSolveRequest) => Promise<MemberSolveOutcome>;

/** One member done: the build to retain (null = back to "no build"), why there
 *  is none, and the member's filters when the reco's weights were set. */
export interface MemberBuilt {
  heroUid: string;
  build: TeamBuild | null;
  reason: string | null;
  /** Set when the pass wrote the reco's weights as the member's priority. */
  filters?: SolverFilters;
  /** Score without a priority nor reco weights: solved by CP this once. */
  cpFallback: boolean;
}

export interface TeamBuildSummary {
  teamName: string;
  size: number;
  /** Members retained a build in this pass, in team order. */
  built: string[];
  /** Members without a result, with the reason. */
  noBuild: Array<{ heroUid: string; reason: string }>;
  /** Members solved by CP for want of a priority and reco weights. */
  cpFallback: string[];
  /** Members the pass didn't reach (stopped before them). */
  notReached: string[];
}

export interface TeamBuildPass {
  /** The team as the pass starts (its order, filters and builds). */
  team: Team;
  /** The never-use pieces (`excludedPieces`). */
  excludedPieces: ReadonlySet<string>;
  /** The inventory's pieces by uid (the Talisman main stats are read there). */
  pieces: TeamPieces;
  solve: MemberSolver;
  /** The weights of the hero's reco, null without (or on a failed fetch).
   *  Absent: no reco is looked up (Score runs on the filters as they are). */
  recoPriority?: (heroUid: string) => Promise<Priority | null>;
  /** True once Cancel was clicked — read before each member. */
  shouldStop: () => boolean;
  now: () => number;
  onMemberStart?: (heroUid: string) => void;
  onMemberDone?: (done: MemberBuilt) => void;
}

/** `filters` with `weights` as the priority, stat by stat as the Optimizer
 *  dispatches them. */
function withPriority(filters: SolverFilters, weights: Priority): SolverFilters {
  let out = filters;
  for (const [stat, value] of Object.entries(weights)) out = solverFiltersReducer(out, { type: "setPriority", stat, value });
  return out;
}

/** Run the pass; resolves once every member is done or the pass stopped. */
export async function runTeamBuild(pass: TeamBuildPass): Promise<TeamBuildSummary> {
  const { team, excludedPieces } = pass;
  const summary: TeamBuildSummary = { teamName: team.name, size: team.members.length, built: [], noBuild: [], cpFallback: [], notReached: [] };
  // The pass's own copy of the team: each retained build joins the exclusion
  // of the members after it, whatever happens to the live list meanwhile.
  let working = team;
  for (let i = 0; i < team.members.length; i++) {
    const member = team.members[i]!;
    if (pass.shouldStop()) {
      summary.notReached = team.members.slice(i).map((m) => m.heroUid);
      break;
    }
    pass.onMemberStart?.(member.heroUid);
    const mode: SolveMode = member.build?.mode ?? "score";
    let filters = member.filters;
    let runMode = mode;
    let cpFallback = false;
    if (mode === "score" && !hasPriority(filters.priority) && pass.recoPriority) {
      const weights = await pass.recoPriority(member.heroUid);
      const decision = solveDecision({ mode, hasPriority: false, recoPriority: weights });
      if (decision === "score-with-reco" && weights) filters = withPriority(filters, weights);
      else if (decision === "cp-fallback") { runMode = "cp"; cpFallback = true; }
    }
    const exclusion = memberExclusion(working, member.heroUid, excludedPieces);
    const gemReserved = reservedGemPieces(working, member.heroUid);
    const talismanMains = reservedTalismanMains(working, member.heroUid, pass.pieces);
    const talismanBuffs = teamTalismanBuffs(working, member.heroUid, pass.pieces);
    const outcome = await pass.solve({ heroUid: member.heroUid, filters, mode: runMode, exclusion, gemReserved, talismanMains, talismanBuffs });
    const build = outcome.build ? teamBuildOf(outcome.build, runMode, pass.now()) : null;
    const reason = build ? null : (outcome.reason ?? "No build passes the filters");
    working = build ? retainBuild(working, member.heroUid, build) : clearBuild(working, member.heroUid);
    if (build) summary.built.push(member.heroUid);
    else summary.noBuild.push({ heroUid: member.heroUid, reason: reason! });
    if (cpFallback) summary.cpFallback.push(member.heroUid);
    pass.onMemberDone?.({ heroUid: member.heroUid, build, reason, ...(filters !== member.filters ? { filters } : {}), cpFallback });
  }
  return summary;
}

/** The toast at the end of a pass: « GR PCU Ep1 built — 3/4 members », then
 *  the members without a build, those solved by CP for want of a priority, and
 *  those a Cancel left as they were. */
export function teamBuildNotice(s: TeamBuildSummary, nameOf: (heroUid: string) => string): string {
  const names = (uids: readonly string[]) => uids.map(nameOf).join(", ");
  return [
    `${s.teamName} built — ${s.built.length}/${s.size} member${s.size === 1 ? "" : "s"}`,
    s.noBuild.length > 0 && `no build: ${names(s.noBuild.map((n) => n.heroUid))}`,
    s.cpFallback.length > 0 && `solved by Combat Power (no priority, no reco): ${names(s.cpFallback)}`,
    s.notReached.length > 0 && `cancelled before ${names(s.notReached)} (previous builds kept)`,
  ].filter((p): p is string => !!p).join(" · ");
}

/** Why "Build team" is greyed out for `team` — one pass at a time in the app,
 *  and none while the Optimizer solves; null when it can run. */
export function buildTeamBlockedReason(team: Team, ctx: {
  /** The team a pass is running on, null when none. */
  passTeam: { id: string; name: string } | null;
  optimizerSolving: boolean;
  /** Game data and a capture are loaded. */
  ready: boolean;
}): string | null {
  if (ctx.passTeam && ctx.passTeam.id !== team.id) return `${ctx.passTeam.name} is being built — one team at a time`;
  if (ctx.optimizerSolving) return "A solve is running in the Optimizer — wait for it or cancel it";
  if (!ctx.ready) return "Game data is still loading";
  if (team.members.length === 0) return "Add a hero first";
  return null;
}
