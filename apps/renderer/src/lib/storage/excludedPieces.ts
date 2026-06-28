/**
 * Globally-excluded pieces — a persisted set of gear UIDs the user has marked
 * "never use in a solve" (typically because the rolls are trash). Account-wide,
 * not per-hero: it's a property of the PIECE, so every solve skips it at
 * pool-build time (engine `allow()`), regardless of which hero is being solved.
 *
 * Durable (localStorage) — the judgment "this piece is junk" outlives a session.
 * Distinct from the per-hero "Exclude equipped" multi-select (which excludes a
 * HERO's gear). Toggled from the Inventory (right-click a tile).
 */
export const EXCLUDED_PIECES_KEY = "gs.solver.excludedPieces";
const KEY = EXCLUDED_PIECES_KEY;

export function loadExcludedPieces(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function persistExcludedPieces(set: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Quota / locked-down context — skip; next toggle retries.
  }
}

/** Immutable toggle — returns a new set with `uid` flipped. */
export function toggleExcludedPiece(set: Set<string>, uid: string): Set<string> {
  const next = new Set(set);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  return next;
}
