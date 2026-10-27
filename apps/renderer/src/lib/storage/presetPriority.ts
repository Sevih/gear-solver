/**
 * Preset priority ranking and locks — account-global, persisted, on the model
 * of the hero ranks (`heroPriority`, same `rankPriority` operations).
 *
 * - Rank: a UNIQUE integer per preset (key = `preset.num` as a string), rank 1
 *   = highest priority, unranked = lowest. A preset never offered a rank gets
 *   one in the in-game order (`presetGameOrder`); clearing it sticks.
 * - Lock: the set of locked `preset.num`. A locked preset's pieces never enter
 *   a solve, except the solve of that preset itself.
 *
 * Edited from the Presets tab; read by the solver through `presetHolds`
 * (`lib/presets/presetHolds.ts`). Owned by `App` so an edit is live for the
 * (kept-mounted) Builder.
 */
import { loadSeen, persistSeen, type PriorityRank } from "./rankPriority.js";

export const PRESET_RANK_KEY = "gs.presets.rank";
/** Every preset num (as a string) already offered a default rank. */
export const PRESET_SEEN_KEY = "gs.presets.seen";
/** Locked preset nums (`number[]`). */
export const PRESET_LOCKED_KEY = "gs.presets.locked";

/** preset num (string) → unique integer rank. Absent = unranked (lowest). */
export type PresetRank = PriorityRank;

export function loadSeenPresets(): Set<string> {
  return loadSeen(PRESET_SEEN_KEY);
}

export function persistSeenPresets(keys: Iterable<string>): void {
  persistSeen(PRESET_SEEN_KEY, keys);
}

/** Toggle `num` in the locked list. New array; never mutates the input. */
export function toggleLocked(locked: readonly number[], num: number): number[] {
  return locked.includes(num) ? locked.filter((n) => n !== num) : [...locked, num];
}
