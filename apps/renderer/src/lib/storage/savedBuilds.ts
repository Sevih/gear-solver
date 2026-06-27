/**
 * Saved builds persistence — per-hero list of solver results the user
 * wanted to bookmark. Backed by `localStorage` (small payloads, ~500B per
 * build × maybe 50 per hero → way under the 5MB quota).
 *
 * Key layout: a single `gs.solver.savedBuilds` blob holding the whole
 * `heroUid → SavedBuild[]` map. One blob means one write per save (vs
 * one-key-per-build which would scatter writes), and the read on mount is
 * a single localStorage hit.
 */
import type { ReforgeMode } from "../solver/engine.js";
import type { SolveBuild, SolveMode } from "../solver/types.js";
import type { FinalStats } from "../composeBuild.js";
import { renameLegacyStatKeys } from "../statRegistry.js";

export interface SavedBuild {
  id: string;
  /** User-supplied label — shown in the "Saved Builds" list. */
  name: string;
  heroUid: string;
  /** Solve mode the build came from — affects how `cp` is treated
   *  (computed in-loop in CP mode, lazy in SOLVE). */
  mode: SolveMode;
  /** Verbatim solver output (uids + finalStats + ratings + gems). */
  build: SolveBuild;
  /** Reforge context the build was solved with — needed to reproduce the
   *  bottom gear band's projected (max-roll) substats on restore. Optional
   *  for backward compat: builds saved before this field fall back to
   *  showing the pieces' current rolls (their pre-existing behavior).
   *  `useReforged` is the legacy boolean shape (pre-reforge-modes) — read
   *  tolerantly and migrated to `reforgeMode` on restore. */
  reforge?: { reforgeMode?: ReforgeMode; useReforged?: boolean; priority: Record<string, number> };
  /** Wall-clock ms — sort key for newest-first display. */
  createdAt: number;
}

export const SAVED_BUILDS_KEY = "gs.solver.savedBuilds";
const KEY = SAVED_BUILDS_KEY;

export type SavedBuildsMap = Record<string, SavedBuild[]>;

export function loadSavedBuilds(): SavedBuildsMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    // Stat-key unification migration: builds saved with the old user keys
    // (crc/chd/res/dmgRed/critDmgRed) on `build.finalStats` and `reforge.priority`
    // are rewritten to the canonical engine keys so the restored build's stats
    // display and re-score correctly. Idempotent on already-canonical saves.
    const out: SavedBuildsMap = {};
    for (const [uid, list] of Object.entries(parsed as Record<string, SavedBuild[]>)) {
      if (!Array.isArray(list)) continue;
      out[uid] = list.map((b) => migrateSavedBuild(b));
    }
    return out;
  } catch {
    // Poisoned storage (stale schema or quota error mid-write) — start fresh
    // rather than crashing the screen on mount.
    return {};
  }
}

/** Rewrite a single saved build's legacy stat keys → canonical (see loader). */
function migrateSavedBuild(b: SavedBuild): SavedBuild {
  const fs = b.build?.finalStats as unknown as Record<string, number> | undefined;
  const next: SavedBuild = {
    ...b,
    build: fs ? { ...b.build, finalStats: renameLegacyStatKeys(fs) as unknown as FinalStats } : b.build,
  };
  if (b.reforge?.priority) {
    next.reforge = { ...b.reforge, priority: renameLegacyStatKeys(b.reforge.priority) };
  }
  return next;
}

export function persistSavedBuilds(map: SavedBuildsMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded — silently skip. Future saves will retry.
  }
}

export function addSavedBuild(map: SavedBuildsMap, entry: SavedBuild): SavedBuildsMap {
  const next: SavedBuildsMap = { ...map };
  const list = next[entry.heroUid] ?? [];
  next[entry.heroUid] = [entry, ...list];
  return next;
}

export function removeSavedBuild(map: SavedBuildsMap, heroUid: string, id: string): SavedBuildsMap {
  const list = map[heroUid];
  if (!list) return map;
  const filtered = list.filter((b) => b.id !== id);
  const next: SavedBuildsMap = { ...map };
  if (filtered.length === 0) delete next[heroUid];
  else next[heroUid] = filtered;
  return next;
}
