/**
 * Marginal damage-per-tick: which offensive substat tick adds the most expected
 * damage for the picked hero, right now. Reuses the validated `computeCheapRatings`
 * damage model (`solver/ratings.ts`, per the 1.4.9 binary formulas) — bump one
 * stat by a tick, recompute `.dmg`, report the % gain. No new damage assumptions.
 *
 * The damage stat (ATK / DEF-Caren / HP-scalers) is `dmgStat`; a %-tick on it
 * raises the FINAL stat by `base × pct% × (1+buffRate)` — pass that as the
 * candidate's `delta`. CHC / CHD / DMG-UP are additive, so their delta is just
 * the tick value (CHC past the 100% cap yields 0 gain — a useful "crit-capped"
 * signal that falls straight out of the model).
 */
import { computeCheapRatings } from "./solver/ratings.js";
import type { FinalStats } from "./composeBuild.js";

export interface DmgTickCandidate {
  key: string;
  label: string;
  /** FinalStats field this tick bumps. */
  field: keyof FinalStats;
  /** Amount added to that field by one 6★ tick (final-stat units). */
  delta: number;
}

export interface DmgTickGain {
  key: string;
  label: string;
  /** Expected-damage gain from one tick, in percent of the hero's current dmg. */
  gainPct: number;
}

export function dmgTickGains(
  current: FinalStats,
  dmgStat: "atk" | "def" | "hp",
  dmgSec: ReadonlyArray<{ stat: "atk" | "def" | "hp"; ratio: number }> | undefined,
  candidates: ReadonlyArray<DmgTickCandidate>,
): DmgTickGain[] {
  const base = computeCheapRatings(current, dmgStat, dmgSec).dmg;
  if (base <= 0) return [];
  return candidates
    .map((c) => {
      const perturbed: FinalStats = { ...current, [c.field]: (current[c.field] as number) + c.delta };
      const dmg = computeCheapRatings(perturbed, dmgStat, dmgSec).dmg;
      return { key: c.key, label: c.label, gainPct: ((dmg - base) / base) * 100 };
    })
    .sort((a, b) => b.gainPct - a.gainPct);
}
