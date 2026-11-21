/**
 * A team's "+ Worklist" — one Worklist entry per member whose retained build
 * isn't stale, made the way the Optimizer's "+ Worklist" makes one (the changed
 * slots of `diffBuildVsLoadout`, then the gems `worklistChangesFor` lists), and
 * the single toast that says what was queued. The entries go through the
 * Worklist's one-entry-per-hero rule (`upsertWorklistEntry`): each replaces the
 * entry its hero already had.
 *
 * Pure: the screen gives the ids and the clock.
 */
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { diffBuildVsLoadout } from "../buildDiff.js";
import { worklistChangesFor } from "../worklist/changes.js";
import { displayNameOf } from "../heroes/heroName.js";
import { upsertWorklistEntry, type WorklistEntry } from "../storage/worklist.js";
import { teamWorklistPlan, type Team } from "./teams.js";

export interface TeamWorklist {
  /** In team order. */
  entries: WorklistEntry[];
  /** Members left out, by reason (hero uids). */
  noBuild: string[];
  stale: string[];
  /** A build the hero already wears — nothing to do in-game. */
  unchanged: string[];
  /** Hero no longer in the roster. */
  notInRoster: string[];
}

export function teamWorklistFor(
  team: Team,
  inventory: Inventory,
  game: GameData | null,
  newId: () => string,
  now: number,
): TeamWorklist {
  const pieceByUid = new Map<string, GearPiece>(inventory.gear.map((g) => [g.uid, g]));
  const plan = teamWorklistPlan(team, pieceByUid);
  const out: TeamWorklist = { entries: [], noBuild: plan.noBuild, stale: plan.stale, unchanged: [], notInRoster: [] };
  for (const m of plan.ready) {
    const hero = inventory.characters.find((c) => c.uid === m.heroUid);
    if (!hero) { out.notInRoster.push(m.heroUid); continue; }
    const build = m.build!;
    const diff = diffBuildVsLoadout(build.pieceUids, m.heroUid, pieceByUid);
    const changes = worklistChangesFor(diff, build.gemAllocation, game);
    if (changes.length === 0) { out.unchanged.push(m.heroUid); continue; }
    const meta = game?.characters[String(hero.charId)] ?? null;
    out.entries.push({
      id: newId(),
      heroUid: m.heroUid,
      heroName: displayNameOf(hero, meta ? { nickname: meta.nickname ?? null } : null),
      // Portrait id — the fused variant's, like the Optimizer's entry.
      charId: effectiveCharacter(hero, game?.characters).charId,
      mode: build.mode,
      cp: build.cp,
      upg: diff.filter((d) => d.changed).length,
      changes,
      createdAt: now,
    });
  }
  return out;
}

/** `entries` queued in one go, each replacing its hero's entry. The list is
 *  newest-first: the team's members land on top, member 1 first. */
export function upsertWorklistEntries(list: WorklistEntry[], entries: readonly WorklistEntry[]): WorklistEntry[] {
  return entries.reduceRight((l, e) => upsertWorklistEntry(l, e), list);
}

/** The toast of a team's "+ Worklist" — « Added to worklist — GR PCU Ep1
 *  (4 heroes, 1 replaced) ». */
export function teamWorklistNotice(teamName: string, heroes: number, replaced: number): string {
  return `Added to worklist — ${teamName} (${heroes} hero${heroes === 1 ? "" : "es"}, ${replaced} replaced)`;
}
