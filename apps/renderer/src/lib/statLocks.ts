/**
 * Stat-lock snapshots (debug tooling, Builds tab) — the shape persisted at
 * `data/stat-locks.json` through `/api/stat-locks`, and the validating reader
 * the Builds screen runs on the fetched file.
 *
 * NOTE: pure — no React, no IO, testable standalone.
 */
import type { FinalStats } from "./composeBuild.js";
import { renameLegacyStatKeys } from "./statRegistry.js";

/** Per-(char, stat) lock snapshot. `name`/`charId`/`level` are debug context
 *  for the json file. */
export interface LockEntry { name: string; charId: number; level: number; stats: Partial<FinalStats>; }

/** Locks keyed by character uid. */
export type LocksMap = Record<string, LockEntry>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** Keep only finite numeric values, legacy stat keys (`crc`, `chd`, …) renamed
 *  to their canonical axis. */
function readStats(v: Record<string, unknown>): Partial<FinalStats> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(renameLegacyStatKeys(v))) {
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out as Partial<FinalStats>;
}

/** Read a fetched stat-locks file. Anything but an object yields `{}`; entries
 *  that are not objects, or that keep no numeric stat, are dropped. An entry
 *  carrying `stats` is the enriched `LockEntry`; a bare object is the pre-rich
 *  legacy shape (the stats themselves, keyed by uid) and is wrapped with
 *  placeholder context. */
export function parseStatLocks(data: unknown): LocksMap {
  const out: LocksMap = {};
  if (!isObject(data)) return out;
  for (const [uid, v] of Object.entries(data)) {
    if (!isObject(v)) continue;
    const rich = "stats" in v;
    const stats = rich ? (isObject(v.stats) ? readStats(v.stats) : {}) : readStats(v);
    // An entry without a lock is never written (unlocking the last stat drops
    // the uid) — drop one read that way too.
    if (Object.keys(stats).length === 0) continue;
    out[uid] = rich
      ? {
          name: typeof v.name === "string" ? v.name : "?",
          charId: typeof v.charId === "number" ? v.charId : 0,
          level: typeof v.level === "number" ? v.level : 0,
          stats,
        }
      : { name: "?", charId: 0, level: 0, stats };
  }
  return out;
}
