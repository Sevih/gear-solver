/**
 * Backup transfer — export / import of everything the user set up in the app
 * as a single JSON file (device migration, sharing, manual backup): every key
 * the registry marks `backup: true` (`lib/storage/keys.ts`), never the
 * captured gear (the capture plugin's files).
 *
 * Bundle v2: `kind`, `version: 2`, `exportedAt`, then one entry per backed-up
 * key, under its key, holding the stored JSON as is. A v1 file (its five
 * blocks: saved builds, filter presets, preset heroes, Inventory filter
 * presets, local presets) still imports: each block is read as its key.
 *
 * Operates at the on-disk JSON level, NOT the in-memory level: the blobs
 * already serialize their `Set` fields to arrays on disk (see
 * filterPresets.ts), so reading/merging/writing the raw values round-trips
 * faithfully without re-running any Set conversion. This keeps the transfer
 * logic independent of each key's in-memory shape: it only knows the shape
 * rules of the registry (`MergeRule`), each written once below.
 */
import { BACKUP_KEYS, type MergeRule } from "./keys.js";
import { SAVED_BUILDS_KEY } from "./savedBuilds.js";
import { FILTER_PRESETS_KEY } from "./filterPresets.js";
import { PRESET_HEROES_KEY } from "./presetHeroes.js";
import { INVENTORY_FILTER_PRESETS_KEY } from "./inventoryFilterPresets.js";
import { LOCAL_PRESETS_KEY } from "./localPresets.js";
import { notifyBackupImported } from "./importSignal.js";

export { onBackupImported } from "./importSignal.js";

const BACKUP_KIND = "gear-solver-backup";
const BACKUP_VERSION = 2 as const;

/** A v1 file's blocks and the key each one held. */
const V1_BLOCKS = {
  savedBuilds: SAVED_BUILDS_KEY,
  filterPresets: FILTER_PRESETS_KEY,
  presetHeroes: PRESET_HEROES_KEY,
  inventoryFilterPresets: INVENTORY_FILTER_PRESETS_KEY,
  localPresets: LOCAL_PRESETS_KEY,
} as const;

export interface BackupBundle {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  /** Wall-clock ms of the export — shown in the filename + bundle, never
   *  read back (informational). Caller supplies it (Date.now() lives in the
   *  UI layer, not here). */
  exportedAt: number;
  /** One entry per backed-up key that holds a value, under its key. */
  [key: string]: unknown;
}

/** Entries an import added or changed, per backed-up key (0 = nothing). */
export type ImportResult = Record<string, number>;

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The stored JSON under `key`; undefined when absent or unreadable. */
function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Snapshot every backed-up key into a self-describing bundle (a key never
 *  written is left out). `exportedAt` is passed in so this stays free of
 *  `Date.now()` (testable / SSR-safe). */
export function buildBackup(exportedAt: number): BackupBundle {
  const bundle: BackupBundle = { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt };
  for (const { key } of BACKUP_KEYS) {
    const value = readStored(key);
    if (value !== undefined) bundle[key] = value;
  }
  return bundle;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Merge rules — one per shape of data. Each returns the merged value and how
 * many entries it added or changed.
 * ───────────────────────────────────────────────────────────────────────── */

interface Merged { merged: unknown; count: number }

/** `heroUid → entries[]`: an entry whose id is already stored for that hero is
 *  skipped (the stored one wins), one `accept` refuses is neither merged nor
 *  counted, the others are appended. */
function mergeHeroLists(stored: unknown, incoming: Json, accept: (e: unknown) => boolean = () => true): Merged {
  const merged: Json = isRecord(stored) ? { ...stored } : {};
  let count = 0;
  for (const [uid, list] of Object.entries(incoming)) {
    if (!Array.isArray(list)) continue;
    const existing = Array.isArray(merged[uid]) ? (merged[uid] as unknown[]) : [];
    const seen = new Set(existing.map((e) => (isRecord(e) ? e.id : undefined)).filter((id) => typeof id === "string"));
    const fresh = list.filter((e) => isRecord(e) && typeof e.id === "string" && !seen.has(e.id) && accept(e));
    if (fresh.length === 0) continue;
    count += fresh.length;
    merged[uid] = [...existing, ...fresh];
  }
  return { merged, count };
}

/** A list of entries by identifier: an entry already stored (same id, or same
 *  name with `uniqueName`) is skipped (`keep: "stored"`) or replaced in place
 *  (`keep: "imported"`); a new one is appended. */
function mergeList(stored: unknown, incoming: unknown[], rule: Extract<MergeRule, { shape: "list" }>): Merged {
  const merged = Array.isArray(stored) ? [...stored] : [];
  const idOf = (e: unknown) => (isRecord(e) ? e[rule.id] : undefined);
  const nameOf = (e: unknown) => (isRecord(e) ? e.name : undefined);
  const at = new Map<unknown, number>();
  merged.forEach((e, i) => { if (idOf(e) !== undefined) at.set(idOf(e), i); });
  const names = new Set(rule.uniqueName ? merged.map(nameOf) : []);
  let count = 0;
  for (const e of incoming) {
    if (!rule.accept(e)) continue;
    const i = at.get(idOf(e));
    if (i !== undefined) {
      if (rule.keep === "stored" || same(merged[i], e)) continue;
      merged[i] = e;
      count++;
      continue;
    }
    if (rule.uniqueName && names.has(nameOf(e))) continue;
    at.set(idOf(e), merged.length);
    names.add(nameOf(e));
    merged.push(e);
    count++;
  }
  return { merged, count };
}

/** A record by identifier: the imported value replaces the stored one of the
 *  same key (unless `keepStored` keeps it), the other keys stay. Ranks are
 *  then renumbered 1..N — a rank is unique — in rank order, an imported key
 *  first on a tie. */
function mergeMap(stored: unknown, incoming: Json, rule: Extract<MergeRule, { shape: "map" }>): Merged {
  const merged: Json = isRecord(stored) ? { ...stored } : {};
  const taken = new Set<string>();
  for (const [k, v] of Object.entries(incoming)) {
    if (!rule.accept(v) || rule.keepStored?.(merged[k]) || same(merged[k], v)) continue;
    merged[k] = v;
    taken.add(k);
  }
  if (!rule.ranks || taken.size === 0) return { merged, count: taken.size };
  const rank = (k: string) => merged[k] as number;
  const order = Object.keys(merged)
    .filter((k) => typeof merged[k] === "number")
    .sort((a, b) => rank(a) - rank(b) || Number(taken.has(b)) - Number(taken.has(a)));
  return { merged: Object.fromEntries(order.map((k, i) => [k, i + 1])), count: taken.size };
}

/** A list of identifiers: union. */
function mergeSet(stored: unknown, incoming: unknown[], accept: (id: unknown) => boolean): Merged {
  const merged = Array.isArray(stored) ? [...stored] : [];
  const seen = new Set(merged);
  let count = 0;
  for (const id of incoming) {
    if (!accept(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
    count++;
  }
  return { merged, count };
}

/** One value: the imported one, normalized (bounded), replaces the stored one. */
function mergeValue(stored: unknown, incoming: unknown, normalize: (v: unknown) => unknown): Merged {
  const value = normalize(incoming);
  if (value === undefined || same(stored, value)) return { merged: stored, count: 0 };
  return { merged: value, count: 1 };
}

function merge(rule: MergeRule, stored: unknown, incoming: unknown): Merged {
  switch (rule.shape) {
    case "heroLists": return mergeHeroLists(stored, incoming as Json, rule.accept);
    case "list": return mergeList(stored, incoming as unknown[], rule);
    case "map": return mergeMap(stored, incoming as Json, rule);
    case "set": return mergeSet(stored, incoming as unknown[], rule.accept);
    case "value": return mergeValue(stored, incoming, rule.normalize);
  }
}

/** The JSON container a shape's value comes in (null = any value). */
function containerOf(rule: MergeRule): "object" | "array" | null {
  switch (rule.shape) {
    case "heroLists":
    case "map": return "object";
    case "list":
    case "set": return "array";
    case "value": return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Reading a file
 * ───────────────────────────────────────────────────────────────────────── */

/** A v1 bundle (kind + version + the two maps, three optional blocks). Throws
 *  a user-facing Error on mismatch so the UI can alert it. */
function assertV1(b: Json): void {
  if (!isRecord(b.savedBuilds)) throw new Error("Missing savedBuilds.");
  if (!isRecord(b.filterPresets)) throw new Error("Missing filterPresets.");
  if (b.presetHeroes != null && !isRecord(b.presetHeroes)) throw new Error("Malformed presetHeroes.");
  if (b.inventoryFilterPresets != null && !Array.isArray(b.inventoryFilterPresets)) throw new Error("Malformed inventoryFilterPresets.");
  if (b.localPresets != null && !Array.isArray(b.localPresets)) throw new Error("Malformed localPresets.");
}

/** The file's value per storage key — a v1 file's blocks under their keys, a
 *  v2 file's entries as they are. A key the registry doesn't back up is never
 *  read (ignored without error); a backed-up key in the wrong container
 *  (object vs list) throws. */
function bundleValues(value: unknown): Map<string, unknown> {
  if (!isRecord(value)) throw new Error("Not a JSON object.");
  if (value.kind !== BACKUP_KIND) throw new Error("Not a gear-solver backup file (wrong kind).");
  const values = new Map<string, unknown>();
  if (value.version === 1) {
    assertV1(value);
    for (const [block, key] of Object.entries(V1_BLOCKS)) if (value[block] != null) values.set(key, value[block]);
  } else if (value.version === BACKUP_VERSION) {
    for (const { key } of BACKUP_KEYS) if (value[key] !== undefined) values.set(key, value[key]);
  } else {
    throw new Error(`Unsupported backup version (${String(value.version)}).`);
  }
  for (const { key, label, merge: rule } of BACKUP_KEYS) {
    if (!values.has(key)) continue;
    const v = values.get(key);
    const container = containerOf(rule);
    if ((container === "object" && !isRecord(v)) || (container === "array" && !Array.isArray(v))) {
      throw new Error(`Malformed ${label.toLowerCase()} (${key}).`);
    }
  }
  return values;
}

/**
 * Merge a parsed backup file (v1 or v2) into localStorage, key by key, with
 * the key's rule (`keys.ts`). Writes the raw JSON directly (presets stay in
 * their serialized array form, so loadFilterPresets() deserializes them
 * correctly), only for a key the import changed, then notifies the
 * `onBackupImported` listeners. Returns what each key took from the file.
 */
export function applyBackup(value: unknown): ImportResult {
  const values = bundleValues(value);
  const result: ImportResult = {};
  const writes: Array<[string, unknown]> = [];
  for (const { key, merge: rule } of BACKUP_KEYS) {
    result[key] = 0;
    if (!values.has(key)) continue;
    const { merged, count } = merge(rule, readStored(key), values.get(key));
    result[key] = count;
    if (count > 0) writes.push([key, merged]);
  }
  // A write failing halfway (quota) still notifies: what was written must be
  // reloaded by the mounted screens, or their next save would drop it.
  try {
    for (const [key, merged] of writes) localStorage.setItem(key, JSON.stringify(merged));
  } finally {
    notifyBackupImported();
  }
  return result;
}
