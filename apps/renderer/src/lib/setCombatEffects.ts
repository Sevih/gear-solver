/** Display lines for a set tier's combat effects (`SetLevel.combatEffects`,
 *  outerpedia B53). These buffs apply in battle only: the sheet and the CP never
 *  read them, this module only words them for the set-effect tooltips. */
import type { SetCombatEffect } from "@gear-solver/core";
import { STAT } from "../design/tokens.js";
import { setBonusStatKey } from "./composeBuild.js";

/** Fixed first line of every combat-effect tooltip. */
export const COMBAT_EFFECT_NOTE = "Applies in battle only — not counted in stats or CP.";

/** Short stat label (`ST_ATK` → "ATK"); the raw enum when no stat maps. */
function statLabel(st: string | undefined): string | null {
  if (!st) return null;
  const key = setBonusStatKey(st, false);
  return (key && STAT[key]?.label) || st;
}

/** Label of one effect, by buff type; the raw enum for a type not listed. */
function typeLabel(e: SetCombatEffect): string {
  switch (e.type) {
    case "BT_DMG_REDUCE": return "Damage reduction";
    case "BT_DMG": return "Damage dealt";
    case "BT_DMG_TARGET_BREAK": return "Damage vs Broken targets";
    case "BT_IMMUNE": return "Debuff immunity";
    case "BT_STAT": return statLabel(e.st) ?? e.type;
    // The value is the maximum, reached as HP drops (`_HALF`: at 50 % HP).
    case "BT_STAT_OWNER_LOST_HP_RATE":
    case "BT_STAT_OWNER_LOST_HP_RATE_HALF": return `${statLabel(e.st) ?? e.type} by missing HP, up to`;
    default: return e.type;
  }
}

/** `v` is raw ‰ → signed percent ("+40%", "−30%"). */
function signedPct(v: number): string {
  return `${v < 0 ? "−" : "+"}${Math.abs(v) / 10}%`;
}

/** One line per effect: label, signed `v / 10` % when `v` exists, " · enemies"
 *  when the target is not the wearer. `cond` is left to the prose. */
export function combatEffectLines(effects: readonly SetCombatEffect[]): string[] {
  return effects.map((e) => {
    let line = typeLabel(e);
    if (e.v != null) line += ` ${signedPct(e.v)}`;
    if (e.target !== "ME") line += " · enemies";
    return line;
  });
}
