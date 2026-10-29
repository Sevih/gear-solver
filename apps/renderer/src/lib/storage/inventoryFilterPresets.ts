/**
 * Inventory filter presets — named snapshots of the Inventory's
 * `FilterState`, global (not per hero, unlike the Builder's
 * `filterPresets.ts`), plus the built-in "Scrap candidates" preset.
 *
 * On disk each entry keeps `filters` as the `FILTER_CODEC.serialize` string,
 * so a preset saved before a filter field existed reads that field's current
 * default through `FILTER_CODEC.deserialize`. The search `query` is never
 * stored: a preset is a set of criteria, not a lookup.
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

export function deleteInventoryFilterPreset(id: string): void {
  const list = readStored();
  const next = list.filter((p) => p.id !== id);
  if (next.length !== list.length) persist(next);
}
