/**
 * Game-data change detection — compares the derived data's `version.json`
 * `hash` to the one seen last (`gs.data.hash`, localStorage) and, when the data
 * moved (a game patch synced in), prunes the stored filters of the references
 * the new data no longer knows: armor set ids in `setPlans` / `excludedSets`
 * and weapon / accessory / talisman effect keys (`EquipmentDef.setId`). A dead
 * required set or effect would otherwise turn a preset into a silent
 * "no builds".
 *
 * Nothing the user made is ever deleted: presets and per-hero filters keep
 * every other field, saved builds are left alone (their piece uids come from
 * the inventory, not from the data).
 */
import type { GameData } from "@gear-solver/core";
import type { SolverFilters } from "../solver/builderFilters.js";
import { loadFilterPresets, persistFilterPresets, type FilterPresetsMap } from "./filterPresets.js";
import { loadHeroFilters, persistHeroFilters, type HeroFiltersMap } from "./heroFilters.js";

export const DATA_HASH_KEY = "gs.data.hash";

/** The ids a stored filter may reference, as the loaded data knows them. */
export interface KnownRefs {
  /** Armor 4-piece set ids (`game.sets` keys). */
  sets: ReadonlySet<string>;
  /** Unique-option effect keys of weapons / accessories / talismans. */
  effects: ReadonlySet<string>;
}

export function knownRefs(game: GameData): KnownRefs {
  const effects = new Set<string>();
  for (const def of Object.values(game.equipment)) if (def.setId) effects.add(def.setId);
  return { sets: new Set(Object.keys(game.sets)), effects };
}

/** `filters` without the set ids and effect keys `known` lacks. Returns the
 *  same object when nothing is dead. A plan emptied by the prune is dropped
 *  (an empty plan would match everything); the editor keeps at least one. */
export function pruneFilters(filters: SolverFilters, known: KnownRefs): SolverFilters {
  let changed = false;
  const setPlans = filters.setPlans.flatMap((plan) => {
    const kept = plan.filter((c) => known.sets.has(c.setId));
    if (kept.length === plan.length) return [plan];
    changed = true;
    return kept.length > 0 ? [kept] : [];
  });
  const excludedSets = filters.excludedSets.filter((id) => known.sets.has(id));
  if (excludedSets.length !== filters.excludedSets.length) changed = true;
  const pruneEffects = <V>(picks: Record<string, V>): Record<string, V> => {
    const entries = Object.entries(picks ?? {});
    const kept = entries.filter(([k]) => known.effects.has(k));
    if (kept.length === entries.length) return picks;
    changed = true;
    return Object.fromEntries(kept);
  };
  const weaponEffectPicks = pruneEffects(filters.weaponEffectPicks);
  const accessoryEffectPicks = pruneEffects(filters.accessoryEffectPicks);
  const talismanEffectPicks = pruneEffects(filters.talismanEffectPicks);
  if (!changed) return filters;
  return {
    ...filters,
    setPlans: setPlans.length > 0 ? setPlans : [[]],
    excludedSets,
    weaponEffectPicks,
    accessoryEffectPicks,
    talismanEffectPicks,
  };
}

/** Prune every preset's filters; the same map back when nothing is dead. */
export function prunePresets(map: FilterPresetsMap, known: KnownRefs): FilterPresetsMap {
  let changed = false;
  const out: FilterPresetsMap = {};
  for (const [uid, list] of Object.entries(map)) {
    out[uid] = list.map((p) => {
      const filters = pruneFilters(p.filters, known);
      if (filters === p.filters) return p;
      changed = true;
      return { ...p, filters };
    });
  }
  return changed ? out : map;
}

/** Prune every remembered per-hero filter set; the same map back when nothing is dead. */
export function pruneHeroFilters(map: HeroFiltersMap, known: KnownRefs): HeroFiltersMap {
  let changed = false;
  const out: HeroFiltersMap = {};
  for (const [uid, f] of Object.entries(map)) {
    out[uid] = pruneFilters(f, known);
    if (out[uid] !== f) changed = true;
  }
  return changed ? out : map;
}

export type DataHashOutcome = "first" | "same" | "pruned" | "skipped";

/**
 * Startup / post-sync hook: first sight of a hash stores it, the same hash does
 * nothing, a new hash prunes the stored presets and per-hero filters, then
 * stores it. "skipped" = storage unreadable, or data that knows no set or no
 * effect (a broken load must not prune everything) — the hash is not stored,
 * so the next good load retries.
 */
export function reconcileDataHash(hash: string, game: GameData): DataHashOutcome {
  let stored: string | null;
  try {
    stored = localStorage.getItem(DATA_HASH_KEY);
  } catch {
    return "skipped";
  }
  if (stored === hash) return "same";
  let outcome: DataHashOutcome = "first";
  if (stored != null) {
    const known = knownRefs(game);
    if (known.sets.size === 0 || known.effects.size === 0) return "skipped";
    const presets = loadFilterPresets();
    const prunedPresets = prunePresets(presets, known);
    if (prunedPresets !== presets) persistFilterPresets(prunedPresets);
    const heroFilters = loadHeroFilters();
    const prunedHeroFilters = pruneHeroFilters(heroFilters, known);
    if (prunedHeroFilters !== heroFilters) persistHeroFilters(prunedHeroFilters);
    outcome = "pruned";
  }
  try {
    localStorage.setItem(DATA_HASH_KEY, hash);
  } catch {
    // Quota / locked-down context — the next load compares again.
  }
  return outcome;
}
