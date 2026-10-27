/**
 * Priority ranking — the generic model behind the hero ranks (`heroPriority`)
 * and the preset ranks (`presetPriority`): a persisted map of `key → rank`.
 *
 * The rank is a UNIQUE integer per key (no two keys share one), where
 * **rank 1 = highest priority** (a smaller number is more important). A key
 * with no entry is "unranked", which counts as the LOWEST priority (below every
 * rank). `isLowerPriority` is strict: two unranked keys can't take from each
 * other.
 *
 * Pure apart from the `seen` list helpers (localStorage, keyed by the caller).
 */

/** key → unique integer rank. Absent = unranked (lowest priority). */
export type PriorityRank = Record<string, number>;

/** Every key already offered a default rank, stored under `storageKey`. A key
 *  in this list with no rank was unranked ON PURPOSE and is never re-filled. */
export function loadSeen(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : []);
  } catch {
    return new Set();
  }
}

export function persistSeen(storageKey: string, keys: Iterable<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...new Set(keys)]));
  } catch {
    // Quota / locked-down context — skip; next pass retries.
  }
}

/** Comparable rank order — the stored rank (1 = highest priority), or +Infinity
 *  for an unranked key (lowest). SMALLER = higher priority. Use it to sort
 *  ascending (rank 1 first, unranked last) or to compare priorities. */
export function rankOrder(map: PriorityRank, uid: string): number {
  const v = map[uid];
  return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
}

/** True when `aUid` is STRICTLY lower priority than `bUid` — i.e. `b` is
 *  allowed to take the gear held by `a`. Lower priority = bigger rank order
 *  (rank 1 best, unranked = +∞ worst). Two unranked keys (∞ vs ∞) are NOT
 *  comparable as lower, so neither can take from the other. */
export function isLowerPriority(map: PriorityRank, aUid: string, bUid: string): boolean {
  return rankOrder(map, aUid) > rankOrder(map, bUid);
}

/** Ranked keys in rank order (rank 1 first), excluding `omit`. */
function rankedOrder(map: PriorityRank, omit?: string): string[] {
  return Object.keys(map)
    .filter((u) => u !== omit)
    .sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
}

/** Reassign contiguous ranks 1..N to an ordered key list. */
function fromOrder(order: string[]): PriorityRank {
  const next: PriorityRank = {};
  order.forEach((u, i) => { next[u] = i + 1; });
  return next;
}

/** Move `uid` to 1-based position `pos` among the ranked keys (others shift);
 *  every rank is rewritten contiguous 1..N. `pos == null` / non-finite unranks
 *  `uid`. Out-of-range positions clamp to [1, N+1]. The positional model: typing
 *  "2" means "make this rank 2", exactly like dropping it there. New map;
 *  never mutates the input. */
export function reorderRank(map: PriorityRank, uid: string, pos: number | null): PriorityRank {
  const order = rankedOrder(map, uid);
  if (pos != null && Number.isFinite(pos)) {
    const i = Math.max(0, Math.min(order.length, Math.trunc(pos) - 1));
    order.splice(i, 0, uid);
  }
  return fromOrder(order);
}

/** Normalize against the full list (given in its default order — heroes by CP
 *  desc, presets in the in-game order): keep the already-ranked keys (in their
 *  current rank order, compacted — no gaps) and append every unranked NEWCOMER
 *  after them in the given order, renumbering contiguous 1..N. Preserves manual
 *  ranks while giving newcomers a sensible default below them. A key in `seen`
 *  was already offered a rank: if it has none, the user cleared it, and it
 *  stays unranked. Returns `null` when no newcomer is unranked (caller skips
 *  the write). */
export function fillUnrankedByOrder(map: PriorityRank, byOrder: string[], seen: ReadonlySet<string> = new Set()): PriorityRank | null {
  const unranked = byOrder.filter((u) => map[u] == null && !seen.has(u));
  if (unranked.length === 0) return null;
  const ranked = byOrder.filter((u) => map[u] != null).sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
  return fromOrder([...ranked, ...unranked]);
}

/** Drag-to-reorder: insert `draggedUid` immediately BEFORE `targetUid` in rank
 *  order (or at the end when `targetUid` is unranked), then renumber 1..N. */
export function moveRankBefore(map: PriorityRank, draggedUid: string, targetUid: string): PriorityRank {
  if (draggedUid === targetUid) return map;
  const order = rankedOrder(map, draggedUid);
  const ti = order.indexOf(targetUid);
  order.splice(ti === -1 ? order.length : ti, 0, draggedUid);
  return fromOrder(order);
}
