/**
 * Two builds side by side — the Optimizer's "Compare" panel (a pinned result
 * vs the selected one, or vs the hero's current loadout). Pure: per-axis
 * values and deltas (stats, table ratings, score, CP) and the per-slot pieces,
 * the slots whose piece differs flagged.
 *
 * Deltas read `b − a`: `a` is the reference (the pinned build, on the left),
 * `b` the build it is compared with. Crit reads its raw sum
 * (`critRateUncapped`), like the results table's sort and the "Current →
 * Projected" panel. The axes are the registry's (`FINAL_STAT_KEYS`, the order
 * of `SOLVER_STATS`) and `COMPARE_RATING_KEYS` (the table's ratings but CP, a
 * test keeps them equal): the lib doesn't import `screens/`.
 */
import type { GearPiece, GearSlot } from "@gear-solver/core";
import type { FinalStats } from "../composeBuild.js";
import type { CheapRatings } from "./ratings.js";
import { FINAL_STAT_KEYS } from "../statRegistry.js";

/** One side of a comparison — a solve result (`SolveBuild` fits) or the
 *  hero's current loadout (ratings / score / CP null when unknown). */
export interface CompareSide {
  pieceUids: readonly string[];
  finalStats: FinalStats;
  ratings: CheapRatings | null;
  score: number | null;
  cp: number | null;
}

/** One compared axis: both values and `b − a` (null when a side is unknown). */
export interface AxisCompare {
  key: string;
  a: number | null;
  b: number | null;
  delta: number | null;
}

/** One gear slot: the piece each side puts there (null = empty) and whether
 *  they differ (by uid; an empty slot on one side only differs too). */
export interface SlotCompare {
  slot: GearSlot;
  a: GearPiece | null;
  b: GearPiece | null;
  differs: boolean;
}

export interface BuildComparison {
  /** `FINAL_STAT_KEYS` order (= `SOLVER_STATS`). */
  stats: AxisCompare[];
  /** `COMPARE_RATING_KEYS` order. */
  ratings: AxisCompare[];
  score: AxisCompare;
  cp: AxisCompare;
  /** The eight slots, engine order. */
  slots: SlotCompare[];
  /** Slots whose piece differs. */
  differing: number;
}

/** The ratings the results table shows (`TABLE_RATINGS`) but CP, which has
 *  its own field. */
export const COMPARE_RATING_KEYS: readonly (keyof CheapRatings)[] = ["hps", "ehp", "ehps", "dmg", "dmgs"];

/** The eight gear slots in the engine's order (`SolveBuild.pieceUids`). */
export const COMPARE_SLOTS: readonly GearSlot[] = [
  "weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "ooparts",
];

function axis(key: string, a: number | null | undefined, b: number | null | undefined): AxisCompare {
  const av = typeof a === "number" ? a : null;
  const bv = typeof b === "number" ? b : null;
  return { key, a: av, b: bv, delta: av != null && bv != null ? bv - av : null };
}

function statOf(fs: FinalStats, key: string): number | null {
  if (key === "critRate") return fs.critRateUncapped ?? fs.critRate;
  const v = (fs as unknown as Record<string, number>)[key];
  return typeof v === "number" ? v : null;
}

/** Each slot's piece of one side, from its uids (a uid missing from the
 *  inventory or a piece without a slot is skipped). */
function piecesBySlot(uids: readonly string[], pieceByUid: ReadonlyMap<string, GearPiece>): Map<GearSlot, GearPiece> {
  const m = new Map<GearSlot, GearPiece>();
  for (const uid of uids) {
    const p = pieceByUid.get(uid);
    if (p?.slot) m.set(p.slot, p);
  }
  return m;
}

export function compareBuilds(a: CompareSide, b: CompareSide, pieceByUid: ReadonlyMap<string, GearPiece>): BuildComparison {
  const stats = FINAL_STAT_KEYS.map((key) => axis(key, statOf(a.finalStats, key), statOf(b.finalStats, key)));
  const ratings = COMPARE_RATING_KEYS.map((key) => axis(key, a.ratings?.[key], b.ratings?.[key]));
  const aSlots = piecesBySlot(a.pieceUids, pieceByUid);
  const bSlots = piecesBySlot(b.pieceUids, pieceByUid);
  const slots = COMPARE_SLOTS.map((slot): SlotCompare => {
    const pa = aSlots.get(slot) ?? null;
    const pb = bSlots.get(slot) ?? null;
    return { slot, a: pa, b: pb, differs: (pa?.uid ?? null) !== (pb?.uid ?? null) };
  });
  return {
    stats,
    ratings,
    score: axis("score", a.score, b.score),
    cp: axis("cp", a.cp, b.cp),
    slots,
    differing: slots.filter((s) => s.differs).length,
  };
}

/** The hero's current loadout as uids — the pieces `pieceByUid` says they
 *  wear (physical `equippedBy`, the `diffBuildVsLoadout` rule). */
export function loadoutUidsOf(heroUid: string, pieceByUid: ReadonlyMap<string, GearPiece>): string[] {
  const out: string[] = [];
  for (const g of pieceByUid.values()) if (g.equippedBy === heroUid && g.slot) out.push(g.uid);
  return out;
}
