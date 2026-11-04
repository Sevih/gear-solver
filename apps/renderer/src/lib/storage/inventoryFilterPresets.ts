/**
 * Inventory filter presets — named snapshots of the Inventory's
 * `FilterState`, global (not per hero, unlike the Builder's
 * `filterPresets.ts`), plus the built-in "Scrap candidates" preset.
 *
 * On disk each entry keeps `filters` as the `FILTER_CODEC.serialize` string,
 * so a preset saved before a filter field existed reads that field's current
 * default through `FILTER_CODEC.deserialize`. The search `query` is never
 * stored: a preset is a set of criteria, not a lookup.
 *
 * Also owns `gs.gear.scrap.default`: the ids of the filter sets Gear › Scrap
 * opens on, one rule each, in order (the built-in's when absent, empty or all
 * unknown).
 */
import { FILTER_CODEC, emptyFilters, type FilterState } from "../../screens/inventory/filters.js";

export interface InventoryFilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: number;
}

/** On-disk shape — `filters` is the codec's JSON string. */
interface StoredPreset {
  id: string;
  name: string;
  filters: string;
  createdAt: number;
}

export const INVENTORY_FILTER_PRESETS_KEY = "gs.inv.filterPresets";
const KEY = INVENTORY_FILTER_PRESETS_KEY;

export const PRESET_NAME_MAX = 24;

/** Trimmed name when it is 1–24 characters and not the built-in's, else null. */
export function validPresetName(name: string): string | null {
  const n = name.trim();
  if (n.length === 0 || n.length > PRESET_NAME_MAX || n === SCRAP_CANDIDATES.name) return null;
  return n;
}

// ── built-in preset ─────────────────────────────────────────────────────
/** Defined in code on top of `emptyFilters()` so it follows the filter shape
 *  as it evolves. Listed first, never stored, never deletable. */
export const SCRAP_CANDIDATES = {
  id: "builtin:scrap-candidates",
  name: "Scrap candidates",
  title: "Keeps the unequipped 5★ and 6★ gear at +0, T0 and never reforged that lacks three sub lines at base tier 3 or better.",
  filters: (): FilterState => ({
    ...emptyFilters(),
    stars: new Set([5, 6]),
    baseRolls: { op: "gte", lines: [3, 3, 3, null], not: true },
    enhanceZero: true,
    breakthroughZero: true,
    notReforged: true,
    showEquipped: false,
  }),
};

// ── storage ─────────────────────────────────────────────────────────────
function readStored(): StoredPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredPreset) : [];
  } catch {
    return [];
  }
}

function isStoredPreset(e: unknown): e is StoredPreset {
  if (!e || typeof e !== "object") return false;
  const s = e as Partial<StoredPreset>;
  return typeof s.id === "string" && typeof s.name === "string" && validPresetName(s.name) === s.name
    && typeof s.filters === "string" && typeof s.createdAt === "number";
}

/** The codec's state for a stored string, or null when it isn't a JSON object
 *  (the codec would throw, or spread an array / primitive). */
function readFilters(raw: string): FilterState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return FILTER_CODEC.deserialize(raw);
  } catch {
    return null;
  }
}

/** Whether `loadInventoryFilterPresets` would load this stored entry —
 *  `applyBackup` merges and counts only those. */
export function isReadableInventoryPreset(entry: unknown): boolean {
  return isStoredPreset(entry) && readFilters(entry.filters) !== null;
}

function persist(list: StoredPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota — silently skip. Next save retries.
  }
}

/** The user's presets, in save order. A malformed entry is skipped. */
export function loadInventoryFilterPresets(): InventoryFilterPreset[] {
  const out: InventoryFilterPreset[] = [];
  for (const s of readStored()) {
    const filters = readFilters(s.filters);
    if (filters) out.push({ ...s, filters });
  }
  return out;
}

/** Save `filters` (search cleared) under `name`. A name already taken
 *  overwrites that preset in place (same id, same position); an invalid name
 *  saves nothing. Returns the saved preset (null if nothing was saved). */
export function saveInventoryFilterPreset(name: string, filters: FilterState): InventoryFilterPreset | null {
  const n = validPresetName(name);
  if (!n) return null;
  const list = readStored();
  const serialized = FILTER_CODEC.serialize!({ ...filters, query: "" });
  const createdAt = Date.now();
  const existing = list.find((p) => p.name === n);
  const entry: StoredPreset = { id: existing?.id ?? crypto.randomUUID(), name: n, filters: serialized, createdAt };
  persist(existing ? list.map((p) => (p === existing ? entry : p)) : [...list, entry]);
  return { ...entry, filters: FILTER_CODEC.deserialize(serialized) };
}

/** Deleting a Scrap default set drops it from the list (the built-in comes
 *  back when the list empties). */
export function deleteInventoryFilterPreset(id: string): void {
  const list = readStored();
  const next = list.filter((p) => p.id !== id);
  if (next.length !== list.length) persist(next);
  const ids = readScrapDefaultIds();
  if (ids?.includes(id)) setScrapDefault(ids.filter((x) => x !== id));
}

// ── Scrap default ───────────────────────────────────────────────────────
export const SCRAP_DEFAULT_KEY = "gs.gear.scrap.default";

/** The ids stored under the key, whatever they point to: an array of
 *  non-empty strings (other entries dropped), or a single string (the
 *  one-set format, saves included) as one id; null when absent or neither. */
function readScrapDefaultIds(): string[] | null {
  try {
    const raw = localStorage.getItem(SCRAP_DEFAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") return parsed ? [parsed] : null;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string" && id !== "");
  } catch {
    return null;
  }
}

export interface ScrapDefaultPreset {
  id: string;
  name: string;
  title?: string;
  filters: FilterState;
}

/** The filter sets Gear › Scrap opens on, one rule each: the sets the key
 *  names that exist here (the built-in by its id, the user's sets), in
 *  order; ids unknown here (a deleted set, an imported id) are skipped, and
 *  the built-in alone stands when nothing is left. `filters` carries no
 *  search. */
export function scrapDefaultPresets(): ScrapDefaultPreset[] {
  const ids = readScrapDefaultIds() ?? [];
  const user = ids.some((id) => id !== SCRAP_CANDIDATES.id) ? loadInventoryFilterPresets() : [];
  const out: ScrapDefaultPreset[] = [];
  for (const id of new Set(ids)) {
    if (id === SCRAP_CANDIDATES.id) {
      out.push({ id, name: SCRAP_CANDIDATES.name, title: SCRAP_CANDIDATES.title, filters: SCRAP_CANDIDATES.filters() });
      continue;
    }
    const p = user.find((u) => u.id === id);
    if (p) out.push({ id: p.id, name: p.name, filters: { ...p.filters, query: "" } });
  }
  if (out.length > 0) return out;
  return [{ id: SCRAP_CANDIDATES.id, name: SCRAP_CANDIDATES.name, title: SCRAP_CANDIDATES.title, filters: SCRAP_CANDIDATES.filters() }];
}

/** Make `ids` (the built-in's or the user's sets) the Scrap default, in
 *  order; an empty list writes the built-in's. */
export function setScrapDefault(ids: string[]): void {
  try {
    localStorage.setItem(SCRAP_DEFAULT_KEY, JSON.stringify(ids.length > 0 ? ids : [SCRAP_CANDIDATES.id]));
  } catch {
    // Quota — silently skip.
  }
}

/** Append a set to the Scrap default (the sets it opens on today, then `id`). */
export function addScrapDefault(id: string): void {
  const ids = scrapDefaultPresets().map((p) => p.id);
  if (!ids.includes(id)) setScrapDefault([...ids, id]);
}

/** Drop a set from the Scrap default (the built-in comes back when the list
 *  empties). */
export function removeScrapDefault(id: string): void {
  const ids = scrapDefaultPresets().map((p) => p.id);
  if (ids.includes(id)) setScrapDefault(ids.filter((x) => x !== id));
}
