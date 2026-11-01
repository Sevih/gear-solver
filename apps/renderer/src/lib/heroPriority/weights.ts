/**
 * A hero's substat priority (the weights the score multiplies) — one source
 * for the Builder and the Presets tab, so the same hero gets the same score in
 * both. Pure: the caller passes the stores it already holds.
 *
 * Where a hero's priority is found, in order (`priorityOf`):
 * 1. the Builder's kept filters for that hero (`gs.solver.heroFilters`,
 *    written at every filter change), when they carry a weight;
 * 2. the priority their most recent saved build was solved with
 *    (`reforge.priority` in `gs.solver.savedBuilds`);
 * 3. none.
 *
 * Not to be confused with the hero RANK (`storage/heroPriority.ts`).
 */
import type { HeroFiltersMap } from "../storage/heroFilters.js";
import type { SavedBuild, SavedBuildsMap } from "../storage/savedBuilds.js";

export type Priority = Record<string, number>;

/** Where `priorityOf` found the priority. */
export type PrioritySource = "filters" | "saved";

/** A priority and where it was found. */
export interface PriorityPick {
  priority: Priority;
  source: PrioritySource;
}

/** A priority counts when at least one stat carries a non-zero weight. */
export function hasPriority(p: Priority | null | undefined): boolean {
  return !!p && Object.values(p).some((v) => v !== 0);
}

/** `p` when it counts (`hasPriority`), else null. */
export function effectivePriority(p: Priority | null | undefined): Priority | null {
  return p && hasPriority(p) ? p : null;
}

/** The hero's most recent saved build, or null. */
export function latestSavedBuild(savedBuilds: SavedBuildsMap, uid: string): SavedBuild | null {
  return (savedBuilds[uid] ?? []).reduce<SavedBuild | null>((best, b) => (!best || b.createdAt > best.createdAt ? b : best), null);
}

/** The hero's priority and its source — kept Builder filters with a weight,
 *  else the most recent saved build's, else null. A priority without any
 *  weight doesn't count, the next source is read. */
export function priorityOf(
  uid: string,
  { heroFilters, savedBuilds }: { heroFilters: HeroFiltersMap; savedBuilds: SavedBuildsMap },
): PriorityPick | null {
  const kept = effectivePriority(heroFilters[uid]?.priority);
  if (kept) return { priority: kept, source: "filters" };
  const saved = effectivePriority(latestSavedBuild(savedBuilds, uid)?.reforge?.priority);
  return saved ? { priority: saved, source: "saved" } : null;
}
