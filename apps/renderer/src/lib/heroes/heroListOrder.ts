/**
 * Hero list order — the one sort of every hero list (the `HeroPicker` of the
 * Builder, Options and Presets, the Builds roster), so a hero sits at the same
 * place on every screen.
 */
import { rankOrder, type HeroPriority } from "../storage/heroPriority.js";

export interface HeroOrderKeys {
  /** App's hero rank (`heroPriority`): rank 1 first, unranked after every
   *  ranked hero. Omitted (or null) = no rank key. */
  rank?: HeroPriority | null;
  /** The hero's CP, highest first; a hero without one (null / undefined)
   *  after those with one. Omitted (or null) = no CP key. */
  cp?: ((uid: string) => number | null | undefined) | null;
}

/** Heroes sorted by rank (ascending, unranked last), then CP (descending, no
 *  CP last), then capture order — the input order, which every caller takes
 *  from `inventory.characters`. Returns a new array; ties keep their input
 *  order. */
export function heroListOrder<T extends { uid: string }>(heroes: readonly T[], { rank, cp }: HeroOrderKeys = {}): T[] {
  const keyed = heroes.map((h, i) => ({
    h, i,
    rank: rank ? rankOrder(rank, h.uid) : 0,
    cp: cp ? (cp(h.uid) ?? Number.NEGATIVE_INFINITY) : 0,
  }));
  keyed.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    if (a.cp !== b.cp) return a.cp > b.cp ? -1 : 1;
    return a.i - b.i;
  });
  return keyed.map((k) => k.h);
}
