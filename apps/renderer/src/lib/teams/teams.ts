/**
 * Teams — a team built for one fight (a World Boss, a Dimensional Singularity,
 * a guild raid boss…): a name, 1 to 4 heroes of the roster (the size of a team
 * in-game) in an order the user sets, each with their own Optimizer filters for
 * that fight and the build retained for them.
 *
 * The pieces a member may take ignore the rest of the roster: the whole
 * inventory — pieces worn by a hero outside the team, held by an in-game
 * preset or reserved by the Worklist included — minus only the pieces excluded
 * by hand (`excludedPieces`) and the pieces of the builds retained by the
 * members placed BEFORE them (`memberExclusion`): member 1 takes anything,
 * member 2 anything but member 1's build, and so on. The hero ranks play no
 * part.
 *
 * A retained build is STALE when one of its pieces left the inventory, or when
 * a member placed before (after a reorder or a new build) retained one of them
 * (`buildStaleness`). It stays shown, flagged, and never goes to the Worklist.
 *
 * Pure: no React, no storage (`lib/storage/teams.ts` keeps the list). Every
 * edit returns a new team, the same one when nothing changes; a refused edit
 * (a fifth member, a hero twice, an invalid name) returns null.
 */
import type { SolverFilters } from "../solver/builderFilters.js";
import type { SolveBuild, SolveMode } from "../solver/types.js";

/** Heroes in a team — the in-game team size. */
export const TEAM_MAX_MEMBERS = 4;
/** Longest team name (trimmed). */
export const TEAM_NAME_MAX = 40;

/** The build retained for a member ("Use for team" on an Optimizer result). */
export interface TeamBuild {
  /** The result's piece uids, engine order (`SolveBuild.pieceUids`: the 8
   *  slots, the EE included when the result carries one). */
  pieceUids: string[];
  /** Gems the result was scored with — the gem lines of "+ Worklist", as the
   *  Optimizer's own "+ Worklist" queues them. */
  gemAllocation?: SolveBuild["gemAllocation"];
  mode: SolveMode;
  /** The result's CP (null when the solve didn't compute it). */
  cp: number | null;
  /** Wall-clock ms the build was retained. */
  at: number;
}

export interface TeamMember {
  heroUid: string;
  /** The member's Optimizer filters for this fight — never read from nor
   *  written to the hero's own (`gs.solver.heroFilters`). */
  filters: SolverFilters;
  build: TeamBuild | null;
}

export interface Team {
  id: string;
  /** 1–40 characters, trimmed (`validTeamName`). */
  name: string;
  /** In team order: member 1 first. */
  members: TeamMember[];
  createdAt: number;
}

/** Trimmed name when it is 1–40 characters, else null. */
export function validTeamName(name: string): string | null {
  const n = name.trim();
  return n.length > 0 && n.length <= TEAM_NAME_MAX ? n : null;
}

/** A new empty team; null when the name is refused. */
export function createTeam(name: string, id: string, createdAt: number): Team | null {
  const n = validTeamName(name);
  return n ? { id, name: n, members: [], createdAt } : null;
}

/** The team renamed; null when the name is refused. */
export function renameTeam(team: Team, name: string): Team | null {
  const n = validTeamName(name);
  if (!n) return null;
  return n === team.name ? team : { ...team, name: n };
}

/** The first `Team N` name no team holds yet (N from the team count + 1). */
export function defaultTeamName(teams: readonly Team[]): string {
  const taken = new Set(teams.map((t) => t.name));
  let n = teams.length + 1;
  while (taken.has(`Team ${n}`)) n++;
  return `Team ${n}`;
}

/** `heroUid` added last with `filters` (the blank defaults, not the hero's
 *  own); null when the team is full or already holds the hero. */
export function addMember(team: Team, heroUid: string, filters: SolverFilters): Team | null {
  if (team.members.length >= TEAM_MAX_MEMBERS || team.members.some((m) => m.heroUid === heroUid)) return null;
  return { ...team, members: [...team.members, { heroUid, filters, build: null }] };
}

export function removeMember(team: Team, heroUid: string): Team {
  const members = team.members.filter((m) => m.heroUid !== heroUid);
  return members.length === team.members.length ? team : { ...team, members };
}

/** `heroUid` moved to position `to` (0-based, clamped), the others keeping
 *  their relative order. */
export function moveMember(team: Team, heroUid: string, to: number): Team {
  const from = team.members.findIndex((m) => m.heroUid === heroUid);
  if (from < 0) return team;
  const target = Math.max(0, Math.min(team.members.length - 1, Math.trunc(to)));
  if (target === from) return team;
  const members = [...team.members];
  const [moved] = members.splice(from, 1);
  members.splice(target, 0, moved!);
  return { ...team, members };
}

function updateMember(team: Team, heroUid: string, update: (m: TeamMember) => TeamMember): Team {
  let changed = false;
  const members = team.members.map((m) => {
    if (m.heroUid !== heroUid) return m;
    const next = update(m);
    if (next !== m) changed = true;
    return next;
  });
  return changed ? { ...team, members } : team;
}

export function setMemberFilters(team: Team, heroUid: string, filters: SolverFilters): Team {
  return updateMember(team, heroUid, (m) => (m.filters === filters ? m : { ...m, filters }));
}

/** `build` becomes the member's retained build (replacing the previous one). */
export function retainBuild(team: Team, heroUid: string, build: TeamBuild): Team {
  return updateMember(team, heroUid, (m) => ({ ...m, build }));
}

/** A build's real pieces — an empty slot ("" or "0") holds none. */
export function buildPieces(build: TeamBuild): string[] {
  return build.pieceUids.filter((u) => u !== "" && u !== "0");
}

/** pieceUid → heroUid of the member placed before `heroUid` whose retained
 *  build holds it (the first of them when two builds do). */
function earlierClaims(team: Team, heroUid: string): Map<string, string> {
  const claims = new Map<string, string>();
  for (const m of team.members) {
    if (m.heroUid === heroUid) break;
    if (!m.build) continue;
    for (const uid of buildPieces(m.build)) if (!claims.has(uid)) claims.set(uid, m.heroUid);
  }
  return claims;
}

/** The pieces a member's solve leaves out: the pieces excluded by hand plus
 *  those of the builds retained by the members placed before them (never
 *  those of the members after). */
export function memberExclusion(team: Team, heroUid: string, excludedPieces: ReadonlySet<string>): Set<string> {
  const out = new Set(excludedPieces);
  for (const uid of earlierClaims(team, heroUid).keys()) out.add(uid);
  return out;
}

/** Why a retained build is stale: its pieces gone from the inventory, and
 *  those retained by an earlier member (with that member). */
export interface BuildStaleness {
  stale: boolean;
  missing: string[];
  taken: Array<{ pieceUid: string; byHeroUid: string }>;
}

/** The staleness of `heroUid`'s retained build against the inventory's piece
 *  uids (`present`); null when the member has no build (or isn't in the team). */
export function buildStaleness(team: Team, heroUid: string, present: ReadonlySet<string>): BuildStaleness | null {
  const member = team.members.find((m) => m.heroUid === heroUid);
  if (!member?.build) return null;
  const claims = earlierClaims(team, heroUid);
  const missing: string[] = [];
  const taken: BuildStaleness["taken"] = [];
  for (const uid of buildPieces(member.build)) {
    if (!present.has(uid)) missing.push(uid);
    else {
      const by = claims.get(uid);
      if (by) taken.push({ pieceUid: uid, byHeroUid: by });
    }
  }
  return { stale: missing.length > 0 || taken.length > 0, missing, taken };
}

/** What "+ Worklist" can push for a team: the members with a retained build
 *  that isn't stale (in team order), and those it leaves out. */
export interface TeamWorklistPlan {
  ready: TeamMember[];
  noBuild: string[];
  stale: string[];
}

export function teamWorklistPlan(team: Team, present: ReadonlySet<string>): TeamWorklistPlan {
  const plan: TeamWorklistPlan = { ready: [], noBuild: [], stale: [] };
  for (const m of team.members) {
    const s = buildStaleness(team, m.heroUid, present);
    if (!s) plan.noBuild.push(m.heroUid);
    else if (s.stale) plan.stale.push(m.heroUid);
    else plan.ready.push(m);
  }
  return plan;
}

// ── the list ────────────────────────────────────────────────────────────

/** The list with `team` first (a new team shows at the top). */
export function addTeam(teams: readonly Team[], team: Team): Team[] {
  return [team, ...teams.filter((t) => t.id !== team.id)];
}

export function removeTeam(teams: readonly Team[], id: string): Team[] {
  return teams.filter((t) => t.id !== id);
}

/** The list with team `id` passed through `update` — the same list when the
 *  team is unknown, or when `update` changes nothing or refuses (null). */
export function updateTeam(teams: Team[], id: string, update: (t: Team) => Team | null): Team[] {
  const i = teams.findIndex((t) => t.id === id);
  if (i < 0) return teams;
  const next = update(teams[i]!);
  if (!next || next === teams[i]) return teams;
  return teams.map((t, j) => (j === i ? next : t));
}
