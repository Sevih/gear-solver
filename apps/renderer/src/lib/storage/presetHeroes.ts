/**
 * Preset heroes persistence — per in-game preset, the reference hero whose
 * outfit it is and the heroes associated with it (who wear it as-is and tune
 * themselves through their own EE gems). Groups are made by hand in the
 * Presets tab.
 *
 * Backed by `localStorage` under one blob (`gs.presetHeroes`), keyed by the
 * preset's in-game number — same shape rationale as `savedBuilds.ts` (one
 * write per mutation, one read on mount). A uid that left the roster is kept
 * in storage but ignored on read (`presetHeroesFor`), so a hero coming back
 * from a re-capture finds its place again.
 */

export interface PresetHeroes {
  referenceUid: string | null;
  associatedUids: string[];
}

export const PRESET_HEROES_KEY = "gs.presetHeroes";
const KEY = PRESET_HEROES_KEY;

/** Default loss (percent) past which an associated hero's line turns orange —
 *  the `gs.solver.presetLossWarn` setting (Settings → Solver). */
export const DEFAULT_PRESET_LOSS_WARN = 15;

/** Preset number (as a string key) → its heroes. */
export type PresetHeroesMap = Record<string, PresetHeroes>;

const EMPTY: PresetHeroes = { referenceUid: null, associatedUids: [] };

export function loadPresetHeroes(): PresetHeroesMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: PresetHeroesMap = {};
    for (const [num, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Partial<PresetHeroes>;
      out[num] = {
        referenceUid: typeof e.referenceUid === "string" ? e.referenceUid : null,
        associatedUids: Array.isArray(e.associatedUids) ? e.associatedUids.filter((u): u is string => typeof u === "string") : [],
      };
    }
    return out;
  } catch {
    // Poisoned storage — start fresh rather than crash the screen on mount.
    return {};
  }
}

export function persistPresetHeroes(map: PresetHeroesMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded — silently skip. The next edit retries.
  }
}

/** A preset's heroes as the screen reads them — uids outside `roster` dropped. */
export function presetHeroesFor(map: PresetHeroesMap, num: number, roster: ReadonlySet<string>): PresetHeroes {
  const e = map[String(num)] ?? EMPTY;
  return {
    referenceUid: e.referenceUid != null && roster.has(e.referenceUid) ? e.referenceUid : null,
    associatedUids: e.associatedUids.filter((u) => roster.has(u)),
  };
}

/** Set (or clear) a preset's reference hero. A hero promoted to reference
 *  leaves the associated list — one hero holds one role per preset. */
export function setPresetReference(map: PresetHeroesMap, num: number, uid: string | null): PresetHeroesMap {
  const e = map[String(num)] ?? EMPTY;
  return {
    ...map,
    [String(num)]: { referenceUid: uid, associatedUids: uid ? e.associatedUids.filter((u) => u !== uid) : e.associatedUids },
  };
}

/** Add a hero to a preset's associated list — no-op when already there or
 *  when it is the reference. */
export function addPresetAssociated(map: PresetHeroesMap, num: number, uid: string): PresetHeroesMap {
  const e = map[String(num)] ?? EMPTY;
  if (e.referenceUid === uid || e.associatedUids.includes(uid)) return map;
  return { ...map, [String(num)]: { ...e, associatedUids: [...e.associatedUids, uid] } };
}

export function removePresetAssociated(map: PresetHeroesMap, num: number, uid: string): PresetHeroesMap {
  const e = map[String(num)];
  if (!e || !e.associatedUids.includes(uid)) return map;
  return { ...map, [String(num)]: { ...e, associatedUids: e.associatedUids.filter((u) => u !== uid) } };
}
