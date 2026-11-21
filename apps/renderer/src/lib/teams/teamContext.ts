/**
 * The Optimizer in team context — opened by a member's "Optimize →" on the
 * Teams tab: the member's filters, and a solve under the team's piece rule
 * (`teams.ts`): every piece of the inventory but the excluded ones and those
 * of the earlier members' builds, whoever wears them, a gem pool without
 * the gems of the pieces the other members' builds retain, and a Talisman pool
 * without the main stats of the earlier members' Talismans; and the member's
 * stats count the main stats of the Talismans the other members retain (a
 * fixed input of the solve: its stats, bounds and Score, not its CP — the
 * in-game CP doesn't count them — nor its pools). So the scope is pinned to
 * "all", and neither the Worklist reservations, the in-game presets' holds nor
 * the hero ranks reach the solve.
 *
 * Pure: App resolves the context from its teams, the solver session swaps its
 * inputs through `teamSolveScope`.
 */
import type { TeamBuff } from "../composeBuild.js";
import type { SolverFilters } from "../solver/builderFilters.js";
import type { HeroPriority } from "../storage/heroPriority.js";
import type { PresetHolds } from "../presets/presetHolds.js";
import { memberExclusion, reservedGemPieces, reservedTalismanMains, teamTalismanBuffs, type Team, type TeamPieces, type TeamTalismanBuff } from "./teams.js";

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
  /** The Talisman main stats the member's Talisman pool leaves out, each with
   *  the earlier member whose Talisman carries it (`reservedTalismanMains`). */
  talismanMains: ReadonlyMap<string, string>;
  /** The main stats of the other members' Talismans the member's stats count,
   *  with the member bringing each (`teamTalismanBuffs`). */
  talismanBuffs: readonly TeamTalismanBuff[];
}

/** The context of member `target.heroUid` of team `target.teamId`; null when
 *  there is no target or it no longer exists (team deleted, hero removed).
 *  `pieces`: the inventory's pieces by uid (the Talisman rule reads the
 *  retained Talismans' main stats there). */
export function teamContextOf(
  teams: readonly Team[],
  target: { teamId: string; heroUid: string } | null,
  excludedPieces: ReadonlySet<string>,
  pieces: TeamPieces,
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
    talismanMains: reservedTalismanMains(team, target.heroUid, pieces),
    talismanBuffs: teamTalismanBuffs(team, target.heroUid, pieces),
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
  /** Talisman main stats out of the Talisman pool (a team member's solve
   *  only: the earlier members' Talisman mains). */
  reservedTalismanMains?: ReadonlySet<string>;
  /** The other members' Talisman mains the member's stats count (a team
   *  member's solve only, `teamTalismanBuffs`). */
  teamTalismanBuffs?: readonly TeamBuff[];
}

/** The Optimizer banner's line on the Talisman rule — « Talisman main stat
 *  taken by Akarie: ATK% · Maxie: CHD », one part per earlier member (team
 *  order), their stats by `labelOf`; null when no main is reserved. */
export function talismanMainsNotice(
  mains: ReadonlyMap<string, string>,
  nameOf: (heroUid: string) => string,
  labelOf: (stat: string) => string,
): string | null {
  if (mains.size === 0) return null;
  const byHero = new Map<string, string[]>();
  for (const [stat, heroUid] of mains) byHero.set(heroUid, [...(byHero.get(heroUid) ?? []), labelOf(stat)]);
  return `Talisman main stat taken by ${[...byHero].map(([uid, stats]) => `${nameOf(uid)}: ${stats.join(", ")}`).join(" · ")}`;
}

/** The Optimizer banner's line on the team buffs — « Team talismans: ATK%
 *  +15% (Akarie), CHD +12% (Maxie) », one part per stat counted (team order),
 *  its label by `labelOf` and the member bringing it by `nameOf`; null when no
 *  other member's Talisman brings anything. */
export function talismanBuffsNotice(
  buffs: readonly TeamTalismanBuff[],
  nameOf: (heroUid: string) => string,
  labelOf: (stat: string) => string,
): string | null {
  if (buffs.length === 0) return null;
  const value = (b: TeamTalismanBuff) => `+${Math.round(b.value * 10) / 10}${b.percent ? "%" : ""}`;
  return `Team talismans: ${buffs.map((b) => `${labelOf(b.stat)} ${value(b)} (${nameOf(b.heroUid)})`).join(", ")}`;
}

const NO_PRIORITY: HeroPriority = {};

/** What the team's rule hands a member's solve (a `TeamContext`, or a "Build
 *  team" member request). */
export interface TeamSolveRule {
  exclusion: ReadonlySet<string>;
  gemReserved: ReadonlySet<string>;
  /** Talisman main stat → the earlier member whose Talisman carries it. */
  talismanMains: ReadonlyMap<string, string>;
  /** The other members' Talisman mains the member's stats count. */
  talismanBuffs: readonly TeamTalismanBuff[];
}

/** `scope` as a team member's solve sees it: the equipped scope "all", the
 *  member's exclusion, the gems of the other members' retained pieces out of
 *  the gem pool, the earlier members' Talisman mains out of the Talisman pool
 *  (not written to the member's `mainExcludes`), the other members' Talisman
 *  mains counted in its stats, and no hero rank, Worklist claim, preset hold
 *  or target preset. Without a team, `scope` as is. */
export function teamSolveScope(
  scope: SolveScope,
  team: TeamSolveRule | null,
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
    reservedTalismanMains: new Set(team.talismanMains.keys()),
    teamTalismanBuffs: team.talismanBuffs.map((b) => ({ stat: b.stat, value: b.value, percent: b.percent, ...(b.fromBuff ? { fromBuff: true } : {}) })),
  };
}
