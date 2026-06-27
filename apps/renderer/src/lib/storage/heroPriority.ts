/**
 * Hero priority ranking — an account-global, persisted map of `charUid → rank`.
 *
 * The rank is a UNIQUE integer per hero (no two heroes share one). A hero with
 * no entry is "unranked", which counts as the LOWEST priority (below every
 * integer). Higher integer = higher priority.
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

/** Hero's rank as a comparable number; unranked → -Infinity (lowest). */
export function priorityValue(map: HeroPriority, uid: string): number {
  const v = map[uid];
  return typeof v === "number" ? v : -Number.POSITIVE_INFINITY;
}

/** True when `aUid` is STRICTLY lower priority than `bUid` — i.e. hero `b` is
 *  allowed to take gear equipped on hero `a`. Two unranked heroes (-∞ vs -∞)
 *  are NOT comparable as lower, so neither can take from the other. */
export function isLowerPriority(map: HeroPriority, aUid: string, bUid: string): boolean {
  return priorityValue(map, aUid) < priorityValue(map, bUid);
}

/** Set `uid`'s rank (null clears it). Enforces uniqueness: if another hero
 *  already holds that integer, the two SWAP (the previous holder takes `uid`'s
 *  old rank, or becomes unranked if `uid` had none) so ranks stay distinct.
 *  Returns a new map (never mutates the input). */
export function setHeroRank(map: HeroPriority, uid: string, rank: number | null): HeroPriority {
  const next: HeroPriority = { ...map };
  const prev = next[uid];
  if (rank == null || !Number.isFinite(rank)) {
    delete next[uid];
    return next;
  }
  const r = Math.trunc(rank);
  const holder = Object.keys(next).find((k) => k !== uid && next[k] === r);
  if (holder != null) {
    if (prev != null) next[holder] = prev;
    else delete next[holder];
  }
  next[uid] = r;
  return next;
}
