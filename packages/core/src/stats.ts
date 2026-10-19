/**
 * Stat resolution - maps the game's ST_xxx / OAT_xxx option encoding to the engine's
 * canonical StatType and computes display values.
 *
 * Validated against real capture + in-game display:
 *   crit rate  30/tick -> 12% at 4 ticks (div 10)
 *   crit dmg   40/tick -> 24% at 6 ticks (div 10)
 *   dmg boost  20/tick ->  8% at 4 ticks (div 10)
 *   speed       3/tick ->  9  at 3 ticks (raw)
 *   buff chance flat OAT_ADD v=21 on Overdrive accessory -> EFF +21 (flat)
 * Percent stats are stored x10 (one decimal); flat ATK/DEF/HP/SPEED/EFF/RES are raw.
 *
 * EFF (ST_BUFF_CHANCE) and RES (ST_BUFF_RESIST) are context-dependent: flat on gear
 * (OAT_ADD on accessories/armor) and percent on talismans/EE (OAT_RATE). The percent
 * flag follows ApplyingType only — addPercent stays false for these two.
 *
 * Two tables:
 *  - `GAME_STAT` (ST_* + OAT_* → engine StatType) is the runtime table; every
 *    caller goes through `resolveOption`.
 *  - `CONTRACT_STAT_TO_ENGINE` maps outerpedia's contract stat vocabulary
 *    (`stat-keys.json`: `atk`, `atkPct`, `chc`, `resRate`, …) to the same
 *    engine StatType. Nothing reads `stat-keys.json` at runtime:
 *    test/stat-keys.test.ts resolves every contract pair through `GAME_STAT`
 *    and checks it against this table and the contract's % nature, so a pair
 *    outerpedia adds fails CI here instead of silently dropping out of the panel.
 */
import type { StatType } from "./types.js";
import type { OptionDef, OptionsTable, StatOption } from "./gamedata.js";

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
  ST_BUFF_CHANCE: { add: "eff", rate: "eff", addPercent: false },
  ST_BUFF_RESIST: { add: "effRes", rate: "effRes", addPercent: false },
  ST_PIERCE_POWER_RATE: { add: "pen", rate: "pen", addPercent: true },
  ST_E_CRI_DMG_REDUCE: { add: "critDmgReduce", rate: "critDmgReduce", addPercent: true },
  ST_HIT_AP: { add: "hitAp", rate: "hitAp", addPercent: false },
  ST_KILL_AP: { add: "killAp", rate: "killAp", addPercent: false },
  // Set-bonus only stats — surfaced in sets.json, never on rolled subs.
  // Lifesteal + Counterattack store raw ×10 (v=100 → 10%); ENTER_AP is flat.
  ST_VAMPIRIC:      { add: "lifesteal", rate: "lifesteal", addPercent: true  },
  ST_COUNTER_RATE:  { add: "counter",   rate: "counter",   addPercent: true  },
  ST_ENTER_AP:      { add: "enterAp",   rate: "enterAp",   addPercent: false },
  // Combat-only EE main: accuracy against one element ("Accuracy vs Earth").
  // Shown on the piece, never on the sheet — `combatOnly` comes from the
  // contract's buff row, not from this table.
  ST_AVOID:         { add: "avoid",     rate: "avoid",     addPercent: false },
};

/** Contract stat key (outerpedia `stat-keys.json` › `key`) → engine StatType,
 *  or null for a key that is not an engine stat. Keyed by KEY, not by pair:
 *  `dmgInc` / `dmgRed` carry both OAT_ADD and OAT_RATE in the contract.
 *  `GAME_STAT` rows no contract pair carries yet are allowed (ST_HIT_AP,
 *  ST_KILL_AP as of 2026-10-18). */
export const CONTRACT_STAT_TO_ENGINE: Record<string, StatType | null> = {
  atk: "atk",
  atkPct: "atkPct",
  def: "def",
  defPct: "defPct",
  hp: "hp",
  hpPct: "hpPct",
  spd: "spd",
  spdPct: "spd", // the % channel of resolveOption (OAT_RATE → percent)
  chc: "critRate",
  chd: "critDmg",
  pen: "pen",
  dmgInc: "dmgUp",
  dmgRed: "dmgReduce",
  eff: "eff",
  effRate: "eff",
  res: "effRes",
  resRate: "effRes",
  cdmgRed: "critDmgReduce",
  lifesteal: "lifesteal",
  counter: "counter",
  enterAp: "enterAp",
  // Combat-only EE main (per-element accuracy): resolved for display, skipped
  // by the sheet through the row's `combatOnly`.
  avoid: "avoid",
};

export interface ResolvedStat {
  stat: StatType;
  value: number;
  percent: boolean;
}

/** Resolve a single stat-shaped option for a given tick count. Returns null for
 *  unknown StatTypes. Callers that look up by OptionID and may hit IOT_BUFF
 *  entries should check the shape first (or use `resolveStat` which handles
 *  the discriminator). */
export function resolveOption(def: StatOption, ticks: number): ResolvedStat | null {
  const meta = GAME_STAT[def.st];
  if (!meta) return null;
  const isRate = def.ap === "OAT_RATE";
  const stat = isRate ? meta.rate : meta.add;
  const percent = isRate || meta.addPercent;
  const raw = def.v * ticks;
  return { stat, value: percent ? raw / 10 : raw, percent };
}

function isStatOption(def: OptionDef): def is StatOption {
  return "st" in def;
}

/** Resolve a substat/main option by id from the options table. Handles both
 *  IOT_STAT (direct) and substat ticks; talisman main IOT_BUFF entries are
 *  resolved separately in parse.ts since they depend on the item's enhance level. */
export function resolveStat(
  optionId: number | string,
  ticks: number,
  options: OptionsTable,
): ResolvedStat | null {
  const def = options[String(optionId)];
  if (!def) return null;
  if (!isStatOption(def)) return null; // IOT_BUFF — caller must resolve via BuffsTable
  return resolveOption(def, ticks);
}
