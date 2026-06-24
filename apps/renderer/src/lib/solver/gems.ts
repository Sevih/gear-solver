/**
 * Gem sub-solver. Builds the player's gem pool from currently-socketed
 * gems on Talisman / EE pieces, scores each gem against the user's priority
 * weights, and greedily picks the top K to fill the available gem slots.
 *
 * Why greedy? Each gem is a pure additive contribution to a single stat
 * axis — there's no inter-gem synergy or marginal-diminishing-returns within
 * a single build. So the per-build optimal is "the K highest-scoring gems"
 * where K = open slot count (4 or 5 per piece, gated by enhanceLevel).
 *
 * The compose-time effect of a gem can still be non-linear (e.g. atkPct
 * gems compound through the ATK scaling formula, so two atk% gems on a
 * high-ATK build help more than on a low-ATK one). For ranking THIS build
 * vs THAT build, we use the build's own priority weights to capture intent —
 * the absolute compose value lands in the rated `finalStats` of the build
 * regardless.
 */
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { resolveStat } from "@gear-solver/core";
import { ROLL_NORMS, STAT_TO_PRIORITY } from "./ratings.js";

/** Multiset of OptionIDs the player can re-socket. Pool = union of every
 *  gem currently sitting on a Talisman / EE in the inventory. */
export function buildGemPool(inv: Inventory): Map<number, number> {
  const pool = new Map<number, number>();
  for (const g of inv.gear) {
    if (g.slot !== "ooparts" && g.slot !== "exclusive") continue;
    for (const id of g.gemSlots ?? []) {
      if (!id) continue;
      pool.set(id, (pool.get(id) ?? 0) + 1);
    }
  }
  return pool;
}

/** One scored gem instance — flattened from the multiset so that picking
 *  top-K is a single sort. `id` repeats when the player owns multiple
 *  copies (each copy ranks identically since they're stat-equivalent). */
export interface ScoredGem {
  id: number;
  stat: string;
  /** Per-tick resolved value (e.g. 4.0 for a +4% ATK gem). */
  value: number;
  percent: boolean;
  /** Priority × value — sort key. Zero or negative → never picked. */
  score: number;
}

/** Resolve every gem in the pool to its (stat, value) tuple and score by
 *  `priority × (value / norm)`. Normalization makes cross-stat comparison
 *  meaningful (a +24 ATK% gem vs a +10 CHC gem with equal user priority
 *  must score comparably, not "24 > 10").
 *
 *  When NO priority is set anywhere, every score collapses to 0 — caller
 *  is expected to detect this and fall back to "use the piece's own
 *  socketed gems" instead of allocating zero gems on the build. */
export function scoreGemPool(
  pool: Map<number, number>,
  priority: Record<string, number>,
  game: GameData,
): ScoredGem[] {
  const out: ScoredGem[] = [];
  for (const [id, count] of pool) {
    const r = resolveStat(id, 1, game.options);
    if (!r) continue;
    const pk = STAT_TO_PRIORITY[r.stat] ?? r.stat;
    const w = priority[pk] ?? 0;
    // Per-roll norm (atkPct≈40, flat atk≈300, crc≈20…), NOT final-stat norm
    // — gems are per-roll contributions, not endgame totals.
    const norm = ROLL_NORMS[r.stat] ?? 100;
    const score = w * r.value / norm;
    for (let i = 0; i < count; i++) {
      out.push({ id, stat: r.stat, value: r.value, percent: r.percent, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Number of gem slots open on a Talisman / EE piece. The 5th slot is
 *  gated behind `enhanceLevel >= 5` in-game; below that only 4 slots accept
 *  a gem. */
export function gemSlotsOf(piece: GearPiece | null): number {
  if (!piece) return 0;
  if (piece.slot !== "ooparts" && piece.slot !== "exclusive") return 0;
  return piece.enhanceLevel >= 5 ? 5 : 4;
}

/** Allocate the K best gems to (Talisman, EE) — first K in the scored
 *  pool, with the split decided by per-piece available slot counts.
 *  Greedy by score: piece with more available slots takes the first
 *  ones; both fill in pool-order. Returns the OptionID arrays the UI uses
 *  to display "which gems to socket where". */
export function allocateGems(
  scored: ScoredGem[],
  talismanSlots: number,
  eeSlots: number,
): { talisman: number[]; ee: number[] } {
  const talisman: number[] = [];
  const ee: number[] = [];
  for (let i = 0; i < scored.length; i++) {
    const g = scored[i];
    if (!g || g.score <= 0) break;
    if (talisman.length < talismanSlots) {
      talisman.push(g.id);
    } else if (ee.length < eeSlots) {
      ee.push(g.id);
    } else {
      break;
    }
  }
  // Pad with 0s so the array length matches the in-game slot count exactly
  // (downstream override iteration skips 0 entries anyway, but the shape
  // is easier to reason about with fixed length).
  while (talisman.length < talismanSlots) talisman.push(0);
  while (ee.length < eeSlots) ee.push(0);
  return { talisman, ee };
}

/** Pre-aggregate a gem allocation into a `{flat, pct}` bucket delta the
 *  composer can merge in O(stats) per combo instead of O(gems × resolveStat).
 *  Called once per `(talismanSlots, eeSlots)` variant in `prepareContext`
 *  — typically 1-2 variants per solve.
 *
 *  Returns `null` when the pool produces no gems worth picking (all scores
 *  ≤ 0) — caller should drop the gemOverride entirely and fall back to the
 *  Talisman/EE pieces' own subs. */
export function aggregateGemDelta(
  scored: ScoredGem[],
  talismanSlots: number,
  eeSlots: number,
): { flat: Record<string, number>; pct: Record<string, number> } | null {
  const total = talismanSlots + eeSlots;
  if (total <= 0) return null;
  const flat: Record<string, number> = {};
  const pct: Record<string, number> = {};
  let picked = 0;
  for (let i = 0; i < scored.length && picked < total; i++) {
    const g = scored[i];
    if (!g || g.score <= 0) break;
    const bucket = g.percent ? pct : flat;
    bucket[g.stat] = (bucket[g.stat] ?? 0) + g.value;
    picked++;
  }
  if (picked === 0) return null;
  return { flat, pct };
}
