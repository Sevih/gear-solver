/**
 * The Optimizer in team context — opened by a member's "Optimize →" on the
 * Teams tab: the member's filters, and a solve under the team's piece rule
 * (`teams.ts`): every piece of the inventory but the excluded ones and those
 * of the earlier members' builds, whoever wears them, and a gem pool without
 * the gems of the pieces the other members' builds retain. So the scope is
 * pinned to "all", and neither the Worklist reservations, the in-game presets' holds nor
 * the hero ranks reach the solve.
 *
 * Pure: App resolves the context from its teams, the solver session swaps its
 * inputs through `teamSolveScope`.
 */
import type { SolverFilters } from "../solver/builderFilters.js";
import type { HeroPriority } from "../storage/heroPriority.js";
import type { PresetHolds } from "../presets/presetHolds.js";
import { memberExclusion, reservedGemPieces, type Team } from "./teams.js";

/** The member the Optimizer is open on, as App hands it to the Builder. */
export interface TeamContext {
  teamId: string;
  teamName: string;
  heroUid: string;
  /** 1-based place in the team, and the team's size (« 2/4 »). */
  position: number;
  size: number;
  /** The member's filters (the Builder loads them, then writes its edits back). */
  filters: SolverFilters;
  /** The pieces the member's solve leaves out (`memberExclusion`). */
  exclusion: ReadonlySet<string>;
  /** The pieces whose gems the member's gem pool leaves out (`reservedGemPieces`). */
  gemReserved: ReadonlySet<string>;
}

/** The context of member `target.heroUid` of team `target.teamId`; null when
 *  there is no target or it no longer exists (team deleted, hero removed). */
export function teamContextOf(
  teams: readonly Team[],
  target: { teamId: string; heroUid: string } | null,
  excludedPieces: ReadonlySet<string>,
): TeamContext | null {
  if (!target) return null;
  const team = teams.find((t) => t.id === target.teamId);
  const index = team ? team.members.findIndex((m) => m.heroUid === target.heroUid) : -1;
  if (!team || index < 0) return null;
  return {
    teamId: team.id,
    teamName: team.name,
    heroUid: target.heroUid,
    position: index + 1,
    size: team.members.length,
    filters: team.members[index]!.filters,
    exclusion: memberExclusion(team, target.heroUid, excludedPieces),
    gemReserved: reservedGemPieces(team, target.heroUid),
  };
}

/** What a solve reads beyond the hero: the filters and the account-wide rules. */
export interface SolveScope {
  filters: SolverFilters;
  heroPriority: HeroPriority;
  excludedPieceUids: ReadonlySet<string> | undefined;
  worklistClaims: Record<string, string> | undefined;
  presetHolds: PresetHolds | undefined;
  targetPresetNum: number | null;
  /** Talisman / EE uids whose gems stay out of the gem pool (a team member's
   *  solve only). */
  gemReservedPieceUids?: ReadonlySet<string>;
}

const NO_PRIORITY: HeroPriority = {};

/** `scope` as a team member's solve sees it: the equipped scope "all", the
 *  member's exclusion, the gems of the other members' retained pieces out of
 *  the gem pool, and no hero rank, Worklist claim, preset hold or target
 *  preset. Without a team, `scope` as is. */
export function teamSolveScope(
  scope: SolveScope,
  team: { exclusion: ReadonlySet<string>; gemReserved: ReadonlySet<string> } | null,
): SolveScope {
  if (!team) return scope;
  const options = scope.filters.options;
  return {
    filters: options.equippedScope === "all" ? scope.filters : { ...scope.filters, options: { ...options, equippedScope: "all" } },
    heroPriority: NO_PRIORITY,
    excludedPieceUids: team.exclusion,
    worklistClaims: undefined,
    presetHolds: undefined,
    targetPresetNum: null,
    gemReservedPieceUids: team.gemReserved,
  };
}
