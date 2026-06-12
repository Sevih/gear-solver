/**
 * Stat resolution - maps the game's ST_xxx / OAT_xxx option encoding to the engine's
 * canonical StatType and computes display values.
 *
 * Validated against real capture + in-game display:
 *   crit rate  30/tick -> 12% at 4 ticks (div 10)
 *   crit dmg   40/tick -> 24% at 6 ticks (div 10)
 *   dmg boost  20/tick ->  8% at 4 ticks (div 10)
 *   speed       3/tick ->  9  at 3 ticks (raw)
 * Percent stats are stored x10 (one decimal); flat ATK/DEF/HP and SPEED are raw.
 */
import type { StatType } from "./types.js";
import type { OptionDef, OptionsTable } from "./gamedata.js";

interface StatMeta {
  /** flat vs percent variant resolved from ApplyingType. */
  add: StatType;
  rate: StatType;
  /** whether the stat displays as a percentage (÷10 from raw). */
  addPercent: boolean;
}

/** ST_* → engine stat, split by OAT_ADD vs OAT_RATE. */
const GAME_STAT: Record<string, StatMeta> = {
  ST_ATK: { add: "atk", rate: "atkPct", addPercent: false },
  ST_DEF: { add: "def", rate: "defPct", addPercent: false },
  ST_HP: { add: "hp", rate: "hpPct", addPercent: false },
  ST_SPEED: { add: "spd", rate: "spd", addPercent: false },
  ST_CRITICAL_RATE: { add: "critRate", rate: "critRate", addPercent: true },
  ST_CRITICAL_DMG_RATE: { add: "critDmg", rate: "critDmg", addPercent: true },
  ST_DMG_BOOST: { add: "dmgUp", rate: "dmgUp", addPercent: true },
  ST_DMG_REDUCE_RATE: { add: "dmgReduce", rate: "dmgReduce", addPercent: true },
  ST_BUFF_CHANCE: { add: "eff", rate: "eff", addPercent: true },
  ST_BUFF_RESIST: { add: "effRes", rate: "effRes", addPercent: true },
  ST_PIERCE_POWER_RATE: { add: "pen", rate: "pen", addPercent: true },
  ST_E_CRI_DMG_REDUCE: { add: "critDmgReduce", rate: "critDmgReduce", addPercent: true },
  ST_HIT_AP: { add: "hitAp", rate: "hitAp", addPercent: false },
  ST_KILL_AP: { add: "killAp", rate: "killAp", addPercent: false },
};

export interface ResolvedStat {
  stat: StatType;
  value: number;
  percent: boolean;
}

/** Resolve a single option definition for a given tick count. */
export function resolveOption(def: OptionDef, ticks: number): ResolvedStat | null {
  const meta = GAME_STAT[def.st];
  if (!meta) return null;
  const isRate = def.ap === "OAT_RATE";
  const stat = isRate ? meta.rate : meta.add;
  const percent = isRate || meta.addPercent;
  const raw = def.v * ticks;
  return { stat, value: percent ? raw / 10 : raw, percent };
}

/** Resolve a substat/main option by id from the options table. */
export function resolveStat(
  optionId: number | string,
  ticks: number,
  options: OptionsTable,
): ResolvedStat | null {
  const def = options[String(optionId)];
  return def ? resolveOption(def, ticks) : null;
}
