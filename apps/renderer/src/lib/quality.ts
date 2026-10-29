/**
 * Gear "Quality" — the single source of truth for the rolled-substat score
 * (`qualityScore`) and its tier thresholds, shared between the Inventory tab's
 * quality bar/filter, the detail panels and the Builder's solve-pool quality
 * filter. Keeping the rule here (rather than duplicated in each screen) stops
 * them from silently drifting apart.
 */
import type { GearPiece, GearSlot } from "@gear-solver/core";
import { rerollMaxGain } from "./solver/reroll.js";

export type QualityTier = "poor" | "decent" | "good" | "excellent" | "perfect";
export const QUALITY_TIERS: QualityTier[] = ["poor", "decent", "good", "excellent", "perfect"];
export const QUALITY_LABEL: Record<QualityTier, string> = {
  poor: "Poor", decent: "Decent", good: "Good", excellent: "Excellent", perfect: "Perfect",
};

/** Per-tier accent color — the single source of truth shared by the Inventory
 *  tab's quality filter/bar (`QUALITY_TONE`) and the Home gear-quality
 *  distribution, so the two never drift. */
export const QUALITY_COLOR: Record<QualityTier, string> = {
  poor: "#a1a1aa",
  decent: "#7dd3fc",
  good: "#6ee7b7",
  excellent: "#c4b5fd",
  perfect: "#fbbf24",
};

/** Tier from a tick score: the piece's current rolled ticks vs the achievable
 *  max. The only place the percentage cutoffs live. */
export function qualityTierFromScore(current: number, max: number): QualityTier {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return pct >= 100 ? "perfect"
    : pct >= 85 ? "excellent"
    : pct >= 70 ? "good"
    : pct >= 50 ? "decent"
    : "poor";
}

/** A piece's quality score: rolled ticks vs the cap for its CURRENT
 *  investment, the rounded percentage and the resulting tier. */
export interface QualityScore {
  current: number;
  max: number;
  pct: number;
  tier: QualityTier;
  /** Score reachable with the Transistone potential (`lib/solver/reroll.ts`:
   *  one line's base up to stage 4, or 3 when the piece already has a stage-4
   *  line) — set only when the piece has one. The max,
   *  the percentage and the tier stay those of the current rolls. */
  reachable?: number;
}

/** Tooltip of the "→ N reachable" suffix, shared by the detail panels. */
export const QUALITY_REACHABLE_HELP =
  "With a Transistone: a 6★ Legendary can reroll one line up to stage 4 (a 5 % draw per pass, one such line per piece); a piece that already has a stage-4 line can still raise one line to stage 3 (4/4/3/2 → 4/4/3/3). Reachable = the current score with the best line raised.";

/** The one quality rule — sum of every substat tick vs the cap for the piece's
 *  CURRENT investment (base 14 + 1 per spent reforge proc). Null for slots
 *  without rollable subs (Talisman / EE — they carry gems / fixed stats, not a
 *  quality score, and are never quality-filtered) and for un-rolled pieces (no
 *  subs, or no star tier). */
export function qualityScore(
  slot: GearSlot | null,
  star: number | null,
  reforgeCount: number,
  ticks: readonly number[],
  /** Ticks the Transistone potential would add (`rerollMaxGain`) — > 0 sets
   *  `reachable`. */
  rerollGain = 0,
): QualityScore | null {
  if (slot === "ooparts" || slot === "exclusive") return null;
  if (ticks.length === 0 || (star ?? 0) <= 0) return null;
  const current = ticks.reduce((sum, t) => sum + t, 0);
  const max = 14 + reforgeCount;
  const pct = Math.min(100, Math.round((current / max) * 100));
  const score: QualityScore = { current, max, pct, tier: qualityTierFromScore(current, max) };
  if (rerollGain > 0) score.reachable = Math.min(max, current + rerollGain);
  return score;
}

/** `qualityScore` of a raw gear piece, its Transistone potential included. */
export function gearPieceQuality(p: GearPiece): QualityScore | null {
  return qualityScore(p.slot, p.star, p.reforgeCount, p.subs.map((s) => s.ticks ?? 0), rerollMaxGain(p));
}

/** Quality tier of a raw gear piece, or null when it has no quality score
 *  (see `qualityScore`). */
export function gearPieceQualityTier(p: GearPiece): QualityTier | null {
  return gearPieceQuality(p)?.tier ?? null;
}
