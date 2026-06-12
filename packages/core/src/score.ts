/**
 * Gear/build scoring — skeleton.
 *
 * A piece score = weighted sum of its rolled substats (and optionally main).
 * A build score = weighted sum of totals, or a derived metric (EHP, DPS) later.
 */
import type { GearPiece, StatType } from "./types.js";

export type StatWeights = Partial<Record<StatType, number>>;

export function scorePiece(piece: GearPiece, weights: StatWeights): number {
  let s = 0;
  for (const sub of piece.subs) {
    s += (weights[sub.stat] ?? 0) * sub.value;
  }
  return s;
}

export function sumTotals(pieces: GearPiece[]): Partial<Record<StatType, number>> {
  const totals: Partial<Record<StatType, number>> = {};
  for (const p of pieces) {
    for (const sub of p.subs) {
      totals[sub.stat] = (totals[sub.stat] ?? 0) + sub.value;
    }
    if (p.main) totals[p.main.stat] = (totals[p.main.stat] ?? 0) + p.main.value;
  }
  return totals;
}
