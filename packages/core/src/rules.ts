/**
 * Game rules read from the solver contract (outerpedia B62) instead of being
 * copied by hand: gem slots of the gem-bearing pieces (`enhance.json ›
 * gemSlots`), the reforge budget (`enhance.json › reforge`) and the level each
 * evolution row unlocks at (`progression.json › evoUnlockLevel`).
 *
 * Every block falls back to `DEFAULT_RULES` when its key is missing: a cache
 * synced before B62, or an install whose launch sync hasn't fetched
 * `progression.json` yet (an incomplete cache stays usable offline). A missing
 * key — or table — never throws.
 */
import type { GameData } from "./gamedata.js";

/** Gem slots of one gem-bearing slot (`ooparts` / `exclusive`): `base` open
 *  slots, `unlockSlots` more from `+unlockLevel` (the first tier). `unlocks`
 *  lists every tier, sorted by level — one is expected; with several, a piece
 *  gets the sum of the tiers it has reached (`gemSlotsAt`). */
export interface GemSlotRule {
  base: number;
  unlockLevel: number;
  unlockSlots: number;
  unlocks: { enhanceLevel: number; slots: number }[];
}

export type GemSlotKind = "ooparts" | "exclusive";

export interface GameRules {
  gemSlots: Record<GemSlotKind, GemSlotRule>;
  reforge: {
    /** Per-substat tick cap of the reforge UI. */
    maxTicksPerSub: number;
    /** Reforge count of a piece by star. */
    countByStar: Record<number, number>;
    /** Extra reforges of an ascended (Singularity) 6★ piece. */
    ascendedBonus: number;
  };
  /** EvolutionLevel row → character level it unlocks at. */
  evoUnlockLevel: Record<number, number>;
}

const DEFAULT_GEM_SLOTS: GemSlotRule = { base: 4, unlockLevel: 5, unlockSlots: 1, unlocks: [{ enhanceLevel: 5, slots: 1 }] };

/** The rules as they were hard-coded before the contract carried them — the
 *  fallback of every missing block, and the default of every reader called
 *  without a `GameData` (test fixtures). */
export const DEFAULT_RULES: GameRules = {
  gemSlots: { ooparts: DEFAULT_GEM_SLOTS, exclusive: DEFAULT_GEM_SLOTS },
  reforge: { maxTicksPerSub: 6, countByStar: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }, ascendedBonus: 3 },
  evoUnlockLevel: { 2: 20, 3: 40, 4: 60, 5: 80, 6: 100, 7: 105, 8: 110, 9: 120 },
};

/** Talismans and EEs are all `unique` grade: their base is `baseByGrade.unique`. */
function gemSlotRuleOf(game: GameData, slot: GemSlotKind): GemSlotRule {
  const g = game.enhance?.gemSlots;
  const base = g?.baseByGrade.unique;
  const tiers = g?.unlocks[slot];
  if (base == null || !tiers) return DEFAULT_RULES.gemSlots[slot];
  const unlocks = [...tiers].sort((a, b) => a.enhanceLevel - b.enhanceLevel);
  const first = unlocks[0];
  return { base, unlockLevel: first?.enhanceLevel ?? 0, unlockSlots: first?.slots ?? 0, unlocks };
}

function numericKeys(table: Record<string, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(table)) out[Number(k)] = v;
  return out;
}

const cache = new WeakMap<GameData, GameRules>();

/** The rules of a loaded `GameData`, memoized per object: the solver's inner
 *  loops read them without recomputing anything. */
export function gameRulesOf(game: GameData): GameRules {
  const hit = cache.get(game);
  if (hit) return hit;
  // `enhance?.`: a partial GameData (test fixtures) may not carry the table.
  const reforge = game.enhance?.reforge;
  const evo = game.progression?.evoUnlockLevel;
  const rules: GameRules = {
    gemSlots: { ooparts: gemSlotRuleOf(game, "ooparts"), exclusive: gemSlotRuleOf(game, "exclusive") },
    reforge: reforge
      ? { maxTicksPerSub: reforge.maxTicksPerSub, countByStar: numericKeys(reforge.countByStar), ascendedBonus: reforge.ascendedBonus }
      : DEFAULT_RULES.reforge,
    evoUnlockLevel: evo ? numericKeys(evo) : DEFAULT_RULES.evoUnlockLevel,
  };
  cache.set(game, rules);
  return rules;
}

/** Gem slots open on a `slot` piece at `enhanceLevel`: the base plus every
 *  unlock tier reached. */
export function gemSlotsAt(rule: GemSlotRule, enhanceLevel: number): number {
  let n = rule.base;
  for (const u of rule.unlocks) if (enhanceLevel >= u.enhanceLevel) n += u.slots;
  return n;
}
