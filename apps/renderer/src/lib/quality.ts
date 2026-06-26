/**
 * Gear "Quality" tiers — a single source of truth for the rolled-substat score
 * thresholds, shared between the Inventory tab's quality bar/filter and the
 * Builder's solve-pool quality filter. Keeping the thresholds here (rather than
 * duplicated in each screen) stops the two from silently drifting apart.
 */
import type { GearPiece } from "@gear-solver/core";

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

/** Quality tier of a raw gear piece, or null for slots without rollable subs
 *  (Talisman / EE) — those carry gems / fixed stats, not a quality score, and
 *  are never quality-filtered. Mirrors the Inventory tab's `computeQuality`:
 *  base tick cap 14, +1 per spent reforge proc. */
export function gearPieceQualityTier(p: GearPiece): QualityTier | null {
  if (p.slot === "ooparts" || p.slot === "exclusive") return null;
  if (p.subs.length === 0 || (p.star ?? 0) <= 0) return null;
  const current = p.subs.reduce((sum, s) => sum + (s.ticks ?? 0), 0);
  return qualityTierFromScore(current, 14 + p.reforgeCount);
}
