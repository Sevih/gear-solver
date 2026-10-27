/**
 * Hero priority ranking — an account-global, persisted map of `charUid → rank`
 * (the generic rank model lives in `rankPriority.ts`, shared with the presets).
 *
 * The rank is a UNIQUE integer per hero (no two heroes share one), where
 * **rank 1 = highest priority** (a smaller number is more important). A hero
 * with no entry is "unranked", which counts as the LOWEST priority (below every
 * rank).
 *
 * Drives the Builder's "Equipped items → ≤ lower priority" scope: the solver may
 * pull gear off a hero only when that hero is STRICTLY lower priority than the
 * one being optimized (so your important heroes never get stripped, and an
 * unranked hero is fair game for any ranked one — but two unranked heroes can't
 * take from each other).
 *
 * Edited (and filtered/sorted) from the Builds tab; read by the Builder to feed
 * the solver. Owned by `App` so an edit in Builds is live for the Builder.
 */
import { loadSeen, persistSeen, type PriorityRank } from "./rankPriority.js";

export { fillUnrankedByOrder, isLowerPriority, moveRankBefore, rankOrder, reorderRank } from "./rankPriority.js";

export const HERO_PRIORITY_KEY = "gs.priority.rank";
/** Every hero uid that has already been offered a default rank. A hero in this
 *  list with no rank was unranked ON PURPOSE and is never re-filled. */
export const HERO_PRIORITY_SEEN_KEY = "gs.priority.seen";

/** charUid → unique integer rank. Absent = unranked (lowest priority). */
export type HeroPriority = PriorityRank;

export function loadSeenHeroes(): Set<string> {
  return loadSeen(HERO_PRIORITY_SEEN_KEY);
}

export function persistSeenHeroes(uids: Iterable<string>): void {
  persistSeen(HERO_PRIORITY_SEEN_KEY, uids);
}
