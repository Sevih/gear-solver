/**
 * Backup transfer — export / import of the user's saved builds + filter
 * presets as a single JSON file (device migration, sharing, manual backup).
 *
 * Operates at the on-disk JSON level, NOT the in-memory level: the presets
 * blob already serializes its `Set` fields to arrays on disk (see
 * filterPresets.ts), so reading/merging/writing the raw blobs round-trips
 * faithfully without re-running any Set conversion. Saved builds are plain
 * JSON already. This keeps the transfer logic independent of either map's
 * in-memory shape.
 */
import { SAVED_BUILDS_KEY } from "./savedBuilds.js";
import { FILTER_PRESETS_KEY } from "./filterPresets.js";

const BACKUP_KIND = "gear-solver-backup";
const BACKUP_VERSION = 1 as const;

/** On-disk shape of a per-hero list blob: `heroUid → entries[]`, each entry
 *  carrying at least an `id` (used for merge dedup). Loosely typed on
 *  purpose — transfer never inspects entry internals, it only routes blobs. */
type ListMap = Record<string, Array<{ id?: unknown }>>;

export interface BackupBundle {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  /** Wall-clock ms of the export — shown in the filename + bundle, never
   *  read back (informational). Caller supplies it (Date.now() lives in the
   *  UI layer, not here). */
  exportedAt: number;
  /** Serialized `gs.solver.savedBuilds` blob (or `{}` if none). */
  savedBuilds: ListMap;
  /** Serialized `gs.solver.filterPresets` blob — Set fields already arrays. */
  filterPresets: ListMap;
}

export interface ImportResult {
  builds: number;
  presets: number;
}

function readRaw(key: string): ListMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ListMap) : {};
  } catch {
    return {};
  }
}

/** Snapshot both blobs into a self-describing bundle. `exportedAt` is passed
 *  in so this stays free of `Date.now()` (testable / SSR-safe). */
export function buildBackup(exportedAt: number): BackupBundle {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    savedBuilds: readRaw(SAVED_BUILDS_KEY),
    filterPresets: readRaw(FILTER_PRESETS_KEY),
  };
}

/** Merge an incoming per-hero list map into the current one, deduping by
 *  entry `id` (incoming wins are skipped when the id already exists — the
 *  existing entry is kept). Returns a fresh map and a count of added entries. */
function mergeListMap(current: ListMap, incoming: ListMap): { merged: ListMap; added: number } {
  const merged: ListMap = { ...current };
  let added = 0;
  for (const [uid, list] of Object.entries(incoming)) {
    if (!Array.isArray(list)) continue;
    const existing = merged[uid] ?? [];
    const seen = new Set(existing.map((e) => e.id).filter((id) => typeof id === "string"));
    const fresh = list.filter((e) => e && typeof e.id === "string" && !seen.has(e.id));
    added += fresh.length;
    merged[uid] = [...existing, ...fresh];
  }
  return { merged, added };
}

/** Type-guard a parsed JSON value as a BackupBundle (kind + version + the two
 *  maps). Throws a user-facing Error on mismatch so the UI can alert it. */
function assertBundle(value: unknown): asserts value is BackupBundle {
  if (!value || typeof value !== "object") throw new Error("Not a JSON object.");
  const b = value as Partial<BackupBundle>;
  if (b.kind !== BACKUP_KIND) throw new Error("Not a gear-solver backup file (wrong kind).");
  if (b.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version (${String(b.version)}).`);
  if (!b.savedBuilds || typeof b.savedBuilds !== "object") throw new Error("Missing savedBuilds.");
  if (!b.filterPresets || typeof b.filterPresets !== "object") throw new Error("Missing filterPresets.");
}

/**
 * Apply a parsed backup bundle to localStorage.
 *  - "merge": keep current entries, add any whose id isn't already present.
 *  - "replace": overwrite both blobs wholesale.
 * Writes the raw blobs directly (presets stay in their serialized array form,
 * so loadFilterPresets() deserializes them correctly on the next Builder mount).
 * Returns how many entries were added (merge) or written (replace).
 */
export function applyBackup(value: unknown, mode: "merge" | "replace"): ImportResult {
  assertBundle(value);
  const count = (m: ListMap) => Object.values(m).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);

  if (mode === "replace") {
    localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(value.savedBuilds));
    localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(value.filterPresets));
    return { builds: count(value.savedBuilds), presets: count(value.filterPresets) };
  }

  const builds = mergeListMap(readRaw(SAVED_BUILDS_KEY), value.savedBuilds);
  const presets = mergeListMap(readRaw(FILTER_PRESETS_KEY), value.filterPresets);
  localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(builds.merged));
  localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(presets.merged));
  return { builds: builds.added, presets: presets.added };
}
