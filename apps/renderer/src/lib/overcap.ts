/**
 * Wasted stat caps — CRC / PEN overflow is dead weight (both hard-cap at 100%
 * in the damage model, `ratings.ts`; the overflow could be reallocated). One
 * rule for the Builds tab's advice (`buildAdvice.ts`, rule 4) and the Presets
 * tab's hero lines. Pure.
 *
 * Crit rate keeps a +2% tolerance (over only past 102%): players intentionally
 * overcap a couple points as a buffer against enemy crit-resist, so 100-102%
 * isn't truly wasted. PEN has no such buffer (cap 100%). Rounded waste must be
 * > 0 so a float a hair over the cap doesn't print a "0% wasted" line.
 */
import { round1, type FinalStats } from "./composeBuild.js";

export interface Overcap {
  key: "critRate" | "pen";
  label: string;
  /** The raw stat, rounded to 0.1. */
  value: number;
  cap: number;
  /** `value − cap`, rounded to 0.1, always > 0. */
  waste: number;
}

/** The capped axes over their cap, crit first. The sheet's CHC is bounded at
 *  100 (`computeFinalStats`): crit reads the raw sum (`critRateUncapped`). */
export function overcapOf(stats: Pick<FinalStats, "critRate" | "critRateUncapped" | "pen">): Overcap[] {
  const out: Overcap[] = [];
  const check = (key: Overcap["key"], label: string, v: number, cap: number) => {
    const waste = round1(v - cap);
    if (waste > 0) out.push({ key, label, value: round1(v), cap, waste });
  };
  check("critRate", "Crit rate", stats.critRateUncapped ?? stats.critRate, 102);
  check("pen", "Penetration", stats.pen, 100);
  return out;
}

/** "Crit rate 142% — 40% wasted over the 102% cap". */
export function overcapText(o: Overcap): string {
  return `${o.label} ${o.value}% — ${o.waste}% wasted over the ${o.cap}% cap`;
}
