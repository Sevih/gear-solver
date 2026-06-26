/**
 * Flat-vs-% substat tick rentability for ATK / DEF / HP.
 *
 * A flat sub tick adds a constant; a %-tick adds proportionally to the hero's
 * no-gear base flat (base + evo + awak — exposed by `composeCharStats().scaling`).
 * Two facts collapse the comparison to a pure function of the hero's base:
 *  - the in-game `(1 + buffRate)` outer multiplier hits both equally → cancels;
 *  - gear flat is added AFTER the %-multiply (`combined = part1 + gearFlat`),
 *    so a %-tick scales the no-gear base only, independent of equipped gear.
 * See `packages/core/src/compose-stats.ts` `calcFinalStat` for the formula and
 * `data/build.mjs` (sub-ticks.json) for the per-tick values.
 */
export interface FlatVsPct {
  /** Final stat added by one flat tick. */
  flatTick: number;
  /** Percent added by one %-tick (display units, e.g. 4 = 4%). */
  pctTick: number;
  /** Flat-equivalent of one %-tick for this hero's base. */
  pctFlatEquiv: number;
  /** Which sub type yields more per tick for this hero. */
  winner: "flat" | "pct" | "tie";
  /** Base flat above which %-ticks overtake flat ticks. */
  breakeven: number;
}

export function flatVsPctTick(baseFlat: number, flatTick: number, pctTick: number): FlatVsPct {
  const pctFlatEquiv = (baseFlat * pctTick) / 100;
  const winner = pctFlatEquiv > flatTick ? "pct" : pctFlatEquiv < flatTick ? "flat" : "tie";
  const breakeven = pctTick > 0 ? (flatTick * 100) / pctTick : Infinity;
  return { flatTick, pctTick, pctFlatEquiv, winner, breakeven };
}
