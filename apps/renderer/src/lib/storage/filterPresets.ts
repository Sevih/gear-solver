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
import { setPicksToPlans } from "../solver/setPlans.js";

export interface FilterPreset {
  id: string;
  name: string;
  heroUid: string;
  filters: SolverFilters;
  createdAt: number;
}

export const FILTER_PRESETS_KEY = "gs.solver.filterPresets";
const KEY = FILTER_PRESETS_KEY;

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
  const f = s.filters;
  const ex = Array.isArray(f.excludedHeroes) ? f.excludedHeroes : [];
  // Backward-compat: presets saved before the SetPlan migration carry the old
  // `setPicks` map and no `setPlans`/`excludedSets`. Translate them through the
  // same expander the live UI used, so an old preset keeps its set constraints.
  let setPlans = Array.isArray(f.setPlans) && f.setPlans.length > 0 ? f.setPlans : null;
  let excludedSets = Array.isArray(f.excludedSets) ? f.excludedSets : null;
  if (setPlans == null || excludedSets == null) {
    const legacy = (f as { setPicks?: Parameters<typeof setPicksToPlans>[0] }).setPicks;
    const migrated = legacy ? setPicksToPlans(legacy) : { setPlans: [], excludedSets: [] };
    setPlans ??= migrated.setPlans.length > 0 ? migrated.setPlans : [[]];
    excludedSets ??= migrated.excludedSets;
  }
  // Effect picks switched from icon-keyed to setId-keyed (numeric UniqueOptionID).
  // A legacy preset's icon keys ("TI_Icon_…") would now match no piece and turn
  // a "required" effect filter into an empty pool (silent "no builds"). Drop any
  // non-numeric (legacy) effect key rather than break the solve.
  const sanitizeEffects = (m: Record<string, unknown> | undefined): Record<string, "required" | "excluded"> => {
    const out: Record<string, "required" | "excluded"> = {};
    for (const [k, v] of Object.entries(m ?? {})) {
      if (/^\d+$/.test(k) && (v === "required" || v === "excluded")) out[k] = v;
    }
    return out;
  };
  return {
    ...s,
    filters: {
      ...f,
      excludedHeroes: new Set(ex),
      setPlans,
      excludedSets,
      weaponEffectPicks: sanitizeEffects(f.weaponEffectPicks),
      accessoryEffectPicks: sanitizeEffects(f.accessoryEffectPicks),
      // Field added after some presets were saved — default to no quality gate.
      minQuality: f.minQuality ?? null,
    },
  };
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
