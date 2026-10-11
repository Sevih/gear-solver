/**
 * Per-hero filter memory — auto-snapshots the BuilderScreen's `SolverFilters`
 * when you switch away from a hero, and restores them when you come back, so a
 * working session doesn't lose "what did I set for this hero again?".
 *
 * Distinct from `filterPresets.ts`: those are NAMED, durable, manual bookmarks;
 * this is the implicit last-used set per hero, SESSION-SCOPED (sessionStorage)
 * so each app launch starts clean — matching the Inventory/Builds view-state
 * convention. Only `excludedHeroes` (a Set) needs JSON conversion; everything
 * else in `SolverFilters` is already JSON-safe. No legacy migration: snapshots
 * are written by the current code within the same session.
 */
import type { SolverFilters } from "../../screens/BuilderScreen.js";

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
    const raw = sessionStorage.getItem(KEY);
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
    sessionStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // Quota / locked-down context — skip; next snapshot retries.
  }
}

/** Defensive clone (top-level + the `excludedHeroes` Set) so a stored snapshot
 *  can't be mutated by a later reducer update, and a restore can't alias the
 *  map's Set into the live reducer state. */
export function cloneFilters(f: SolverFilters): SolverFilters {
  return { ...f, excludedHeroes: new Set(f.excludedHeroes) };
}

/** Starting filters for the Builder: the remembered set of the hero it opens on
 *  (Optimize →, or a reload mid-session), else `defaults`. Lazy-init of the
 *  filters reducer — the hero-switch effect never runs for the initial hero. */
export function filtersForHero(map: HeroFiltersMap, uid: string | null, defaults: SolverFilters): SolverFilters {
  const saved = uid ? map[uid] : undefined;
  return saved ? cloneFilters(saved) : defaults;
}

/** Hero switch: the map with the OUTGOING hero's live filters snapshotted, or
 *  null when the hero did not actually change (initial mount, StrictMode's
 *  effect re-run) — snapshotting then would store the defaults over that
 *  hero's remembered set. */
export function snapshotOnHeroSwitch(
  map: HeroFiltersMap,
  prevUid: string | null,
  nextUid: string | null,
  live: SolverFilters,
): HeroFiltersMap | null {
  if (prevUid === nextUid) return null;
  return prevUid ? { ...map, [prevUid]: cloneFilters(live) } : map;
}
