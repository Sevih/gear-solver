/**
 * Best-skill damage factor — the per-hero constant that turns the Builder's
 * "damage per hit at 100% skill factor" base into the expected hit of the
 * hero's STRONGEST skill (S1/S2/S3 at max level, burst states included when
 * they replace the base skill). Sourced from `characters.json` `bestSkill`,
 * emitted by outerpedia's solver generator from its damage engine (the same
 * per-clip hit accounting the damage calculator uses).
 *
 * The factor is a constant per hero, so it NEVER changes a single-hero solve's
 * ranking — it only makes the displayed `dmg`/`dmgs`/`mcd`/`mcds` numbers mean
 * something and comparable across heroes.
 *
 * Missing data (a hero the generator couldn't resolve, or a stale data
 * snapshot from before the field existed) falls back to ×1.00 EXPLICITLY and
 * is flagged (`missing`) so the UI can say so — never a silent 0 that would
 * blank the column.
 *
 * Not modeled (assumed, documented in the column tooltip): DoT ticks — a hero
 * whose real "biggest hit" is a DoT (e.g. Gnosis Beth) is under-estimated by a
 * direct-hit factor. Rotation DPS weighted by cooldowns is out of scope.
 */
import type { CharacterDef } from "@gear-solver/core";

export type BestSkill = NonNullable<CharacterDef["bestSkill"]>;

export interface DmgSkillInfo {
  /** Short winner label — "S3", "S2 B1" (burst 1 of the S2), or "—" when missing. */
  label: string;
  /** Multiplier applied to the damage base (‰ / 1000). 1 when missing. */
  factor: number;
  /** True when no skill data exists for the hero → ×1.00 fallback in effect. */
  missing: boolean;
  /** True when the winner's hit chain was unresolved in the data (factor
   *  assumed at the skill's full value — an approximation). */
  approx: boolean;
}

/** Multiplier for the offensive ratings — `bestSkill.factor / 1000`, or 1
 *  when the hero has no skill data (explicit fallback, see header). */
export function dmgSkillFactor(best: BestSkill | undefined | null): number {
  return best && best.factor > 0 ? best.factor / 1000 : 1;
}

/** Label + factor for the column tooltips / header badge. */
export function dmgSkillInfo(best: BestSkill | undefined | null): DmgSkillInfo {
  if (!best || best.factor <= 0) return { label: "—", factor: 1, missing: true, approx: false };
  return {
    label: best.burst ? `${best.slot} B${best.burst}` : best.slot,
    factor: best.factor / 1000,
    missing: false,
    approx: best.unresolvedHits === true,
  };
}
