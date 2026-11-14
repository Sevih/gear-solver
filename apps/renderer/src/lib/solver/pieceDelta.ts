/**
 * "Why this piece?" — what the piece a build puts in a slot brings over the
 * piece the hero wears there today, stat by stat, in the Score's own grid.
 *
 * Each piece is valued ALONE on the hero's sheet: its contribution to every
 * `FinalStats` axis is `computeFinalStats(hero, [piece])` minus the gearless
 * sheet — so a % roll is counted in final-stat units (ATK% → ATK through the
 * hero's base and buff amplifier), exactly like the solver's composer folds it.
 * The sheet is linear in the gear buckets (`calcFinalStat`: sums, then the
 * rates), so the delta of two pieces on one axis equals the delta of the two
 * full builds that differ only by this slot, up to the composer's truncations
 * (±1 per compound axis) and the 100 % caps of CHC / PEN (`computeScore`
 * clamps the build's total, a lone piece never reaches them) — the test locks
 * that equivalence.
 *
 * Weighted with `computeScore` itself (one axis at a time), so the
 * normalization (`STAT_NORMS`, ×100) can't drift from the score. Pieces are
 * the ones the solve scored: the caller passes them reforge-projected (the
 * band's `projectPieceForReforge`), the candidate Talisman / EE with the
 * build's gem allocation (`candidateGems`). Set bonuses are left out — they
 * depend on the other pieces (the Effects panel shows them): `setChanged`
 * flags the swap instead.
 *
 * Pure — no React, no IO.
 */
import type { GameData, GearPiece } from "@gear-solver/core";
import { computeFinalStats, type FinalStats, type FinalStatsBaseline, type ScalingMap } from "../composeBuild.js";
import { gemAllocationOverride } from "../presets/evaluate.js";
import { computeScore } from "./ratings.js";
import { FINAL_STAT_KEYS } from "../statRegistry.js";

/** What the sheet needs to value a piece: the hero's gearless baseline and
 *  scaling (the composer's `noGearStats` / `scaling`, as the solve's
 *  `precomputeContext`), the game (gem table), and the gem allocation the
 *  build was scored with on the candidate's slot (Talisman / EE only; absent
 *  or all-empty = the piece's own socketed gems, like the engine's fallback). */
export interface PieceDeltaContext {
  baseline: FinalStatsBaseline;
  scaling: ScalingMap;
  game: GameData | null;
  candidateGems?: readonly number[];
}

/** One axis of the solver's vocabulary — the registry's `FINAL_STAT_KEYS`,
 *  the same keys and order as the Builder's `SOLVER_STATS`. */
export interface PieceDeltaRow {
  key: string;
  /** Contribution of the worn piece (0 on an empty slot). */
  worn: number;
  /** Contribution of the build's piece. */
  candidate: number;
  /** `candidate − worn`. */
  delta: number;
  /** Priority weight of the axis (0 = not weighted). */
  weight: number;
  /** The delta's share of the score — `computeScore` of the delta alone. */
  weighted: number;
}

export interface PieceDelta {
  /** Every axis of `FINAL_STAT_KEYS`, in its order. */
  rows: PieceDeltaRow[];
  /** Σ weighted — the score the swap gains (negative = it loses score). */
  total: number;
  /** The build keeps the worn piece — every value zero. */
  identical: boolean;
  /** Nothing is worn in this slot today. */
  emptySlot: boolean;
  /** The piece changes the armor set of the slot — set bonuses not counted. */
  setChanged: boolean;
}

/** Per-axis contribution of ONE piece to the hero's sheet. CHC reads the
 *  uncapped sum (a delta, not a total). */
function contributionOf(piece: GearPiece, ctx: PieceDeltaContext, gems?: readonly number[]): Record<string, number> {
  const override = gems && gems.some((id) => id > 0) && ctx.game
    ? gemAllocationOverride([piece], piece.slot === "ooparts" ? { talisman: gems } : { ee: gems }, ctx.game)
    : undefined;
  const withPiece = computeFinalStats(ctx.baseline, ctx.scaling, [piece], ctx.game, override, []);
  const without = computeFinalStats(ctx.baseline, ctx.scaling, [], ctx.game, undefined, []);
  const read = (fs: FinalStats, key: string) =>
    key === "critRate" ? (fs.critRateUncapped ?? fs.critRate) : (fs as unknown as Record<string, number>)[key] ?? 0;
  const out: Record<string, number> = {};
  for (const key of FINAL_STAT_KEYS) out[key] = read(withPiece, key) - read(without, key);
  return out;
}

const isGemSlot = (p: GearPiece) => p.slot === "ooparts" || p.slot === "exclusive";

/** The build's piece vs the worn one, stat by stat — see the file header. */
export function pieceDelta(
  candidate: GearPiece,
  current: GearPiece | null,
  priority: Record<string, number>,
  ctx: PieceDeltaContext,
): PieceDelta {
  const identical = current != null && current.uid === candidate.uid;
  const cand = identical ? null : contributionOf(candidate, ctx, isGemSlot(candidate) ? ctx.candidateGems : undefined);
  const worn = identical || !current ? null : contributionOf(current, ctx);
  let total = 0;
  const rows = FINAL_STAT_KEYS.map((key): PieceDeltaRow => {
    const c = cand?.[key] ?? 0;
    const w = worn?.[key] ?? 0;
    const delta = c - w;
    const weight = priority[key] ?? 0;
    const weighted = weight && delta ? computeScore({ [key]: delta } as unknown as FinalStats, { [key]: weight }) : 0;
    total += weighted;
    return { key, worn: w, candidate: c, delta, weight, weighted };
  });
  return {
    rows,
    total,
    identical,
    emptySlot: current == null,
    setChanged: !identical && (candidate.armorSetId ?? null) !== (current?.armorSetId ?? null),
  };
}
