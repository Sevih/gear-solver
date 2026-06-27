/**
 * Hero priority ranking — an account-global, persisted map of `charUid → rank`.
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
export const HERO_PRIORITY_KEY = "gs.priority.rank";

/** charUid → unique integer rank. Absent = unranked (lowest priority). */
export type HeroPriority = Record<string, number>;

export function loadHeroPriority(): HeroPriority {
  try {
    const raw = localStorage.getItem(HERO_PRIORITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: HeroPriority = {};
    for (const [uid, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[uid] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistHeroPriority(map: HeroPriority): void {
  try {
    localStorage.setItem(HERO_PRIORITY_KEY, JSON.stringify(map));
  } catch {
    // Quota / locked-down context — skip; next save retries.
  }
}

/** Comparable rank order — the stored rank (1 = highest priority), or +Infinity
 *  for an unranked hero (lowest). SMALLER = higher priority. Use it to sort
 *  ascending (rank 1 first, unranked last) or to compare priorities. */
export function rankOrder(map: HeroPriority, uid: string): number {
  const v = map[uid];
  return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
}

/** True when `aUid` is STRICTLY lower priority than `bUid` — i.e. hero `b` is
 *  allowed to take gear equipped on hero `a`. Lower priority = bigger rank order
 *  (rank 1 best, unranked = +∞ worst). Two unranked heroes (∞ vs ∞) are NOT
 *  comparable as lower, so neither can take from the other. */
export function isLowerPriority(map: HeroPriority, aUid: string, bUid: string): boolean {
  return rankOrder(map, aUid) > rankOrder(map, bUid);
}

/** Ranked uids in rank order (rank 1 first), excluding `omit`. */
function rankedOrder(map: HeroPriority, omit?: string): string[] {
  return Object.keys(map)
    .filter((u) => u !== omit)
    .sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
}

/** Reassign contiguous ranks 1..N to an ordered uid list. */
function fromOrder(order: string[]): HeroPriority {
  const next: HeroPriority = {};
  order.forEach((u, i) => { next[u] = i + 1; });
  return next;
}

/** Move `uid` to 1-based position `pos` among the ranked heroes (others shift);
 *  every rank is rewritten contiguous 1..N. `pos == null` / non-finite unranks
 *  `uid`. Out-of-range positions clamp to [1, N+1]. The positional model: typing
 *  "2" means "make this hero rank 2", exactly like dropping it there. New map;
 *  never mutates the input. */
export function reorderRank(map: HeroPriority, uid: string, pos: number | null): HeroPriority {
  const order = rankedOrder(map, uid);
  if (pos != null && Number.isFinite(pos)) {
    const i = Math.max(0, Math.min(order.length, Math.trunc(pos) - 1));
    order.splice(i, 0, uid);
  }
  return fromOrder(order);
}

/** Normalize against the roster (given in CP-desc order): keep the already-ranked
 *  heroes (in their current rank order, compacted — no gaps) and append every
 *  unranked roster hero after them in CP order, renumbering contiguous 1..N.
 *  Preserves manual ranks while giving newcomers a sensible default below them.
 *  Returns `null` when nothing is unranked (all set → caller skips the write). */
export function fillUnrankedByOrder(map: HeroPriority, rosterByCp: string[]): HeroPriority | null {
  const unranked = rosterByCp.filter((u) => map[u] == null);
  if (unranked.length === 0) return null;
  const ranked = rosterByCp.filter((u) => map[u] != null).sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0));
  return fromOrder([...ranked, ...unranked]);
}

/** Drag-to-reorder: insert `draggedUid` immediately BEFORE `targetUid` in rank
 *  order (or at the end when `targetUid` is unranked), then renumber 1..N. */
export function moveRankBefore(map: HeroPriority, draggedUid: string, targetUid: string): HeroPriority {
  if (draggedUid === targetUid) return map;
  const order = rankedOrder(map, draggedUid);
  const ti = order.indexOf(targetUid);
  order.splice(ti === -1 ? order.length : ti, 0, draggedUid);
  return fromOrder(order);
}
