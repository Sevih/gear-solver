/**
 * Best-skill damage factor — the per-hero constant that turns the Builder's
 * "damage per hit at 100% skill factor" base into the expected hit of the
 * hero's STRONGEST skill (S1/S2/S3 at max level, burst states included when
 * they replace the base skill). Sourced from `characters.json` `bestSkill`,
 * emitted by outerpedia's solver generator from its damage engine (the same
 * per-clip hit accounting the damage calculator uses).
 *
 * The per-TURN ratings (`dmgs`/`mcds`, damage × SPD) use the hero's cooldown
 * rotation instead (`characters.json` `rotation`: the average factor per turn
 * when the hero casts the strongest ready skill every turn, S3 > S2 > S1) —
 * `turnSkillFactor`, falling back to the best-skill factor when a stale
 * snapshot has no `rotation`. The per-HIT ratings (`dmg`/`mcd`) keep the best
 * skill.
 *
 * Both factors are constants per hero, so they NEVER change a single-hero
 * solve's ranking — they only make the displayed `dmg`/`dmgs`/`mcd`/`mcds`
 * numbers mean something and comparable across heroes.
 *
 * Missing data (a hero the generator couldn't resolve, or a stale data
 * snapshot from before the field existed) falls back to ×1.00 EXPLICITLY and
 * is flagged (`missing`) so the UI can say so — never a silent 0 that would
 * blank the column.
 *
 * Not modeled (assumed, documented in the column tooltip): DoT ticks — a hero
 * whose real "biggest hit" is a DoT (e.g. Gnosis Beth) is under-estimated by a
 * direct-hit factor. Neither are bursts nor AP in the rotation.
 */
import type { CharacterDef } from "@gear-solver/core";

export type BestSkill = NonNullable<CharacterDef["bestSkill"]>;
export type SkillRotation = NonNullable<CharacterDef["rotation"]>;

export interface TurnSkillInfo {
  /** Multiplier for the per-turn ratings (‰ / 1000) — the rotation's average
   *  factor per turn, else the best-skill factor, else 1. */
  factor: number;
  /** Tooltip label — "S3 ×1, S2 ×2, S1 ×1 over 4 turns", or the best-skill
   *  label when the snapshot has no rotation, "—" when nothing is known. */
  label: string;
  /** True when the snapshot has no rotation → best-skill fallback in effect. */
  missing: boolean;
  /** True when the rotation flags an unresolved hit chain (approximate). */
  approx: boolean;
}

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
  /** The per-turn factor (`dmgs`/`mcds`) — see `turnSkillFactor`. */
  turn: TurnSkillInfo;
}

/** Multiplier for the offensive ratings — `bestSkill.factor / 1000`, or 1
 *  when the hero has no skill data (explicit fallback, see header). */
export function dmgSkillFactor(best: BestSkill | undefined | null): number {
  return best && best.factor > 0 ? best.factor / 1000 : 1;
}

/** Multiplier for the per-turn ratings (`dmgs`/`mcds`) —
 *  `rotation.factorPerTurn / 1000`, or `dmgSkillFactor(best)` when the
 *  snapshot has no rotation (explicit fallback, never an error). */
export function turnSkillFactor(rotation: SkillRotation | undefined | null, best: BestSkill | undefined | null): number {
  return rotation && rotation.factorPerTurn > 0 ? rotation.factorPerTurn / 1000 : dmgSkillFactor(best);
}

/** Label + factor for the column tooltips / header badge. */
export function dmgSkillInfo(best: BestSkill | undefined | null, rotation?: SkillRotation | null): DmgSkillInfo {
  const hit = !best || best.factor <= 0
    ? { label: "—", factor: 1, missing: true, approx: false }
    : {
      label: best.burst ? `${best.slot} B${best.burst}` : best.slot,
      factor: best.factor / 1000,
      missing: false,
      approx: best.unresolvedHits === true,
    };
  const turn: TurnSkillInfo = rotation && rotation.factorPerTurn > 0
    ? {
      factor: rotation.factorPerTurn / 1000,
      label: `${(["S3", "S2", "S1"] as const).filter((s) => rotation.uses[s] > 0).map((s) => `${s} ×${rotation.uses[s]}`).join(", ")} over ${rotation.cycle} turn${rotation.cycle > 1 ? "s" : ""}`,
      missing: false,
      approx: rotation.approx === true,
    }
    : { factor: hit.factor, label: hit.label, missing: true, approx: hit.approx };
  return { ...hit, turn };
}
