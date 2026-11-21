/**
 * Teams persistence — the Teams tab's list (`lib/teams/teams.ts`), in
 * localStorage under one list (`gs.teams`), newest first. Each member's filters
 * are stored like the per-hero ones (`heroFilters.ts`: the `excludedHeroes` Set
 * as a list) but live in the team only: `gs.solver.heroFilters` is never read
 * nor written from here.
 *
 * Read tolerantly: a malformed team is skipped, the rest loads; inside a team,
 * a malformed member is skipped (and a hero listed twice, or past the fourth,
 * dropped), a malformed build reads as none.
 */
import { cloneFilters, deserializeFilters, serializeFilters, type SerializedFilters } from "./heroFilters.js";
import { TEAM_MAX_MEMBERS, validTeamName, type Team, type TeamBuild, type TeamMember } from "../teams/teams.js";

export const TEAMS_KEY = "gs.teams";
const KEY = TEAMS_KEY;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number");

function readBuild(b: unknown): TeamBuild | null {
  if (!isRecord(b)) return null;
  if (!Array.isArray(b.pieceUids) || !b.pieceUids.every((u) => typeof u === "string")) return null;
  if (b.mode !== "score" && b.mode !== "cp") return null;
  if (b.cp !== null && typeof b.cp !== "number") return null;
  if (typeof b.at !== "number") return null;
  const gems = b.gemAllocation;
  const gemAllocation = isRecord(gems) && isNumberList(gems.talisman) && isNumberList(gems.ee)
    ? { talisman: [...gems.talisman], ee: [...gems.ee] }
    : undefined;
  return { pieceUids: [...b.pieceUids], ...(gemAllocation ? { gemAllocation } : {}), mode: b.mode, cp: b.cp, at: b.at };
}

function readMember(m: unknown): TeamMember | null {
  if (!isRecord(m) || typeof m.heroUid !== "string") return null;
  const f = m.filters;
  if (!isRecord(f) || !isRecord(f.options)) return null;
  return { heroUid: m.heroUid, filters: cloneFilters(deserializeFilters(f as unknown as SerializedFilters)), build: readBuild(m.build) };
}

/** The stored team as it loads, or null when the loader skips it. */
function readTeam(e: unknown): Team | null {
  if (!isRecord(e)) return null;
  if (typeof e.id !== "string" || typeof e.name !== "string" || validTeamName(e.name) !== e.name) return null;
  if (typeof e.createdAt !== "number" || !Array.isArray(e.members)) return null;
  const members: TeamMember[] = [];
  for (const raw of e.members) {
    const m = readMember(raw);
    if (!m || members.length >= TEAM_MAX_MEMBERS || members.some((x) => x.heroUid === m.heroUid)) continue;
    members.push(m);
  }
  return { id: e.id, name: e.name, members, createdAt: e.createdAt };
}

/** Whether `loadTeams` would load this stored team — `applyBackup` merges and
 *  counts only those. */
export function isReadableTeam(entry: unknown): boolean {
  return readTeam(entry) !== null;
}

export function loadTeams(): Team[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    return parsed.flatMap((e) => {
      const t = readTeam(e);
      if (!t || ids.has(t.id)) return [];
      ids.add(t.id);
      return [t];
    });
  } catch {
    // Poisoned storage — start fresh rather than crash the tab on mount.
    return [];
  }
}

export function persistTeams(teams: readonly Team[]): void {
  try {
    const out = teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m, filters: serializeFilters(m.filters) })) }));
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // Quota — skip; the next edit retries.
  }
}
