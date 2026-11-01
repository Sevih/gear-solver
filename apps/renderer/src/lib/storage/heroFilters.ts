/**
 * Per-hero filter memory — the BuilderScreen's `SolverFilters` of each hero,
 * written at every change of the open hero's filters and restored when the
 * Builder opens that hero again, so "what did I set for this hero again?"
 * survives a hero switch AND a relaunch.
 *
 * Distinct from `filterPresets.ts`: those are NAMED, manual bookmarks; this is
 * the implicit last-used set per hero, in localStorage. App owns the map (state
 * + persistence) and hands it to the Builder, which writes it, and to the
 * Presets tab, which reads the hero's priority from it (`heroPriority/
 * weights.ts`). Only `excludedHeroes` (a Set) needs JSON conversion; everything
 * else in `SolverFilters` is already JSON-safe. A map left in sessionStorage by
 * an older version is ignored, not migrated.
 */
import type { SolverFilters } from "../solver/builderFilters.js";

export const HERO_FILTERS_KEY = "gs.solver.heroFilters";
const KEY = HERO_FILTERS_KEY;

export type HeroFiltersMap = Record<string, SolverFilters>;

type SerializedFilters = Omit<SolverFilters, "excludedHeroes"> & { excludedHeroes: string[] };

function serialize(f: SolverFilters): SerializedFilters {
  return { ...f, excludedHeroes: [...f.excludedHeroes] };
}

function deserialize(s: SerializedFilters): SolverFilters {
  return { ...s, excludedHeroes: new Set(Array.isArray(s.excludedHeroes) ? s.excludedHeroes : []) };
}

export function loadHeroFilters(): HeroFiltersMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: HeroFiltersMap = {};
    for (const [uid, f] of Object.entries(parsed as Record<string, SerializedFilters>)) {
      if (f && typeof f === "object") out[uid] = deserialize(f);
    }
    return out;
  } catch {
    return {};
  }
}

export function persistHeroFilters(map: HeroFiltersMap): void {
  try {
    const out: Record<string, SerializedFilters> = {};
    for (const [uid, f] of Object.entries(map)) out[uid] = serialize(f);
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // Quota / locked-down context — skip; the next change retries.
  }
}

/** Defensive clone (top-level + the `excludedHeroes` Set) so a stored snapshot
 *  can't be mutated by a later reducer update, and a restore can't alias the
 *  map's Set into the live reducer state. `mainExcludes` came later — a
 *  snapshot stored without it gets `{}`. */
export function cloneFilters(f: SolverFilters): SolverFilters {
  return { ...f, excludedHeroes: new Set(f.excludedHeroes), mainExcludes: f.mainExcludes ?? {} };
}

/** Starting filters for a hero the Builder opens: their remembered set, else
 *  `defaults` with `fallbackPriority` (the hero's `priorityOf` — the priority
 *  of their latest saved build, if any) instead of the empty one, so the
 *  Builder scores a hero first opened as the Presets tab does. */
export function filtersForHero(
  map: HeroFiltersMap,
  uid: string | null,
  defaults: SolverFilters,
  fallbackPriority?: Record<string, number> | null,
): SolverFilters {
  const saved = uid ? map[uid] : undefined;
  if (saved) return cloneFilters(saved);
  return fallbackPriority ? { ...cloneFilters(defaults), priority: { ...fallbackPriority } } : defaults;
}

/** The map with `uid`'s entry set to (a clone of) the live filters — the
 *  Builder's write at each change of the open hero's filters. */
export function withHeroFilters(map: HeroFiltersMap, uid: string, live: SolverFilters): HeroFiltersMap {
  return { ...map, [uid]: cloneFilters(live) };
}
