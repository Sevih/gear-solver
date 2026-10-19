/**
 * Builder selected-hero composition — the composed snapshot the right-column
 * panels read.
 */
import type { DmgSkillInfo } from "../../lib/dmgSkill.js";
import type { FinalStats } from "../../lib/composeBuild.js";

/** Composed snapshot for the selected hero — drives the Stats panel readout
 *  and (eventually) the solver scoring baseline. Null when no hero is picked
 *  or the composer lacked the ingredients to run. */
export interface SelectedComposition {
  current: FinalStats;
  /** In-game Battle Power of the hero's CURRENT loadout (CalcBattlePower, same
   *  evaluator the Builds tab uses) — the baseline a selected build's `cp` is
   *  diffed against to show ΔCP. Null when the star UI metadata is missing. */
  currentCp: number | null;
  /** Hero's no-gear base flat (base+evo+awak) for ATK/DEF/HP — what a %-sub
   *  tick scales against (gear-independent). Powers the flat-vs-% panel. */
  baseFlat: { atk: number; def: number; hp: number };
  /** Hero's damage-scaling stat (ATK default; DEF/HP exceptions) + secondary
   *  additive scalings — fed to `computeCheapRatings` for the damage panel. */
  dmgStat: "atk" | "def" | "hp";
  dmgSec?: Array<{ stat: "atk" | "def" | "hp" | "spd" | "eff" | "crc"; ratio: number }>;
  /** Per-stat (1 + buffRate) amplifier: a +1% sub on a scaling stat raises the
   *  final stat by `base × 1% × dmgAmp[stat]`. */
  dmgAmp: { atk: number; def: number; hp: number };
  /** Hero can never crit (permanent crit-disable passive) — the dmg panel then
   *  evaluates at 0% crit instead of the crit cap, and CHD reads as dead. */
  noCrit: boolean;
  /** Best-skill factor the offensive ratings are scaled by (label + ×factor,
   *  `missing` when the hero has no skill data → ×1.00 fallback). Drives the
   *  Dmg/DmgS/Mcd/McdS tooltips + header badge. */
  dmgSkill: DmgSkillInfo;
}
