/**
 * Stat option-id mapping.
 *
 * STATUS: PARTIAL — the OptionID -> (stat, per-tick value) table is the main
 * open data task (see docs/data-schema.md). The structure is wired up; values
 * must be filled by cross-checking captured items against the in-game display
 * and the Outerpedia equipment DB.
 *
 * Known from capture:
 *  - Substat OptionIDs observed: 160001..160013 (13 distinct types).
 *  - Substat value = ticks * perTick (orange/reforge ticks = Level - BaseLevel).
 *  - Main stat lives in RawItem.OptionList; observed patterns include
 *    (5024,5048), (4024,0), (3024,0), (6024,6048), (24,94|95|96).
 *    Encoding TBD (likely <statClass><tier> + value index).
 */
import type { StatType } from "./types.js";

export interface SubStatDef {
  stat: StatType;
  /** Value gained per tick. Fill from datamine. */
  perTick: number;
  /** Whether the value is a percentage (display only). */
  percent: boolean;
}

/**
 * OptionID -> substat definition. TODO: fill perTick + confirm stat per id.
 * Left intentionally sparse; resolveSubStat() degrades gracefully for unknowns.
 */
export const SUB_OPTION_STATS: Record<number, SubStatDef> = {
  // 160001: { stat: "atk",      perTick: 0,   percent: false },
  // 160002: { stat: "atkPct",   perTick: 0,   percent: true  },
  // ... 160003..160013
};

/** OptionID -> main stat. TODO: decode OptionList encoding. */
export const MAIN_OPTION_STATS: Record<number, { stat: StatType; percent: boolean }> = {
  // filled once OptionList encoding is decoded
};

/** All substat option ids seen in captures, for reference / validation. */
export const OBSERVED_SUB_OPTION_IDS: readonly number[] = [
  160001, 160002, 160004, 160005, 160006, 160007,
  160008, 160009, 160010, 160011, 160012, 160013,
];

export function resolveSubStat(
  optionId: number,
  ticks: number,
): { stat: StatType | null; value: number; percent: boolean } {
  const def = SUB_OPTION_STATS[optionId];
  if (!def) return { stat: null, value: ticks, percent: false };
  return { stat: def.stat, value: ticks * def.perTick, percent: def.percent };
}
