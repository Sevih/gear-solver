/**
 * Filter presets persistence — per-hero snapshots of the BuilderScreen's
 * `SolverFilters` reducer state, so the user can re-apply a previously
 * tuned setup (e.g. "CHC ≥ 90, Sharp 4pc, Top 20%") without re-clicking
 * every chip.
 *
 * Sets need conversion before/after JSON. `excludedHeroes` is the only
 * non-JSON-safe field; we round-trip via array.
 */
import type { SolverFilters } from "../../screens/BuilderScreen.js";

export interface FilterPreset {
  id: string;
  name: string;
  heroUid: string;
  filters: SolverFilters;
  createdAt: number;
}

const KEY = "gs.solver.filterPresets";

export type FilterPresetsMap = Record<string, FilterPreset[]>;

/** On-disk shape — `Set` fields are flattened to arrays. */
interface SerializedFilters extends Omit<SolverFilters, "excludedHeroes"> {
  excludedHeroes: string[];
}
interface SerializedPreset extends Omit<FilterPreset, "filters"> {
  filters: SerializedFilters;
}

function toSerialized(p: FilterPreset): SerializedPreset {
  return { ...p, filters: { ...p.filters, excludedHeroes: [...p.filters.excludedHeroes] } };
}

function fromSerialized(s: SerializedPreset): FilterPreset {
  const ex = Array.isArray(s.filters.excludedHeroes) ? s.filters.excludedHeroes : [];
  return { ...s, filters: { ...s.filters, excludedHeroes: new Set(ex) } };
}

export function loadFilterPresets(): FilterPresetsMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: FilterPresetsMap = {};
    for (const [uid, list] of Object.entries(parsed as Record<string, SerializedPreset[]>)) {
      if (Array.isArray(list)) out[uid] = list.map(fromSerialized);
    }
    return out;
  } catch {
    return {};
  }
}

export function persistFilterPresets(map: FilterPresetsMap): void {
  try {
    const serialized: Record<string, SerializedPreset[]> = {};
    for (const [uid, list] of Object.entries(map)) {
      serialized[uid] = list.map(toSerialized);
    }
    localStorage.setItem(KEY, JSON.stringify(serialized));
  } catch {
    // Quota — silently skip. Next save retries.
  }
}

export function addFilterPreset(map: FilterPresetsMap, entry: FilterPreset): FilterPresetsMap {
  const next: FilterPresetsMap = { ...map };
  const list = next[entry.heroUid] ?? [];
  next[entry.heroUid] = [entry, ...list];
  return next;
}

export function removeFilterPreset(map: FilterPresetsMap, heroUid: string, id: string): FilterPresetsMap {
  const list = map[heroUid];
  if (!list) return map;
  const filtered = list.filter((p) => p.id !== id);
  const next: FilterPresetsMap = { ...map };
  if (filtered.length === 0) delete next[heroUid];
  else next[heroUid] = filtered;
  return next;
}
