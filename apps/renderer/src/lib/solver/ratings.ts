/**
 * Cheap build ratings — pure products of `FinalStats`, no extra inputs.
 * Hot path for the solver: ~5–10ns each so we can call them on every
 * surviving combo without measurably moving the per-combo cost.
 *
 * The 8 ratings + Score are surfaced in the Builder's results table and as
 * filter axes in the Rating filters panel. CP lives in `./cp.ts` because
 * it needs hero skills + EE/Talisman piece metadata, so it's much heavier.
 */
import type { FinalStats } from "../composeBuild.js";

export interface CheapRatings {
  /** HP × SPD — bulky-and-fast composite. */
  hps: number;
  /** Effective HP — HP × (DEF/300 + 1). Linear defense scaling chosen for
   *  filter-readability; CP's HD formula is more curve-y but harder to
   *  compare across builds at a glance. */
  ehp: number;
  /** EHP × SPD — tanky-and-fast composite. */
  ehps: number;
  /** Average damage — ATK × CHC × CHD (CHC/CHD in decimal form). */
  dmg: number;
  /** DPS — Dmg × SPD. */
  dmgs: number;
  /** Max crit damage — ATK × CHD (assumes 100% CHC, useful for crit caps). */
  mcd: number;
  /** Max DPS — Mcd × SPD. */
  mcds: number;
  /** Bruiser burst — HP × CHD (for HP-scaling kits). */
  dmgh: number;
}

/** Compute every cheap rating in one pass. Inlined branches and no
 *  allocations besides the return object. */
export function computeCheapRatings(s: FinalStats): CheapRatings {
  const hps = s.hp * s.spd;
  const ehp = s.hp * (s.def / 300 + 1);
  const ehps = ehp * s.spd;
  // CRC / CHD come out of the composer as displayed percent (35 = 35%) — the
  // damage products want decimal form. CRC is capped at 100% in-game: anything
  // beyond is wasted. Clamping here (not on FinalStats.crc, which is shown
  // raw in the UI so the user sees the overflow) keeps `dmg` / `dmgs` from
  // crediting non-existent crit rate, which would also bias the rating
  // filters and the score.
  const crcDec = Math.min(s.crc, 100) / 100;
  const chdDec = s.chd / 100;
  const dmg = s.atk * crcDec * chdDec;
  const dmgs = dmg * s.spd;
  const mcd = s.atk * chdDec;
  const mcds = mcd * s.spd;
  const dmgh = s.hp * chdDec;
  return { hps, ehp, ehps, dmg, dmgs, mcd, mcds, dmgh };
}

/** Endgame-ish reference values used to normalize wildly-different stat
 *  magnitudes (HP in tens of thousands, SPD in low hundreds, CHC in percent)
 *  so a single weighted-sum Score is meaningful across stats. Numbers are
 *  intentionally round — the ranking is what matters, not the absolute Score.
 *  Exported so the per-piece pruner and gem scorer normalize against the
 *  same baseline — otherwise the ranking shifts unintuitively across
 *  scoring contexts. Keyed by USER priority keys (the same shape the
 *  reducer's `priority` dict uses); engine keys go through `STAT_TO_PRIORITY`
 *  first. */
export const STAT_NORMS: Record<string, number> = {
  atk: 4000,
  def: 3000,
  hp: 30000,
  spd: 250,
  crc: 100,
  chd: 250,
  critDmgRed: 100,
  pen: 100,
  dmgUp: 100,
  dmgRed: 100,
  eff: 250,
  res: 300,
};

/** Engine `StatType` (as stored on `RolledStat.stat` and gem-resolved
 *  stats) → user-facing priority key (as stored on `priority` and
 *  `STAT_NORMS`). Flat / percent rolls of the same axis share a priority
 *  bucket — the user picks "I want ATK" once, the solver scores both
 *  atk and atkPct rolls against that single weight. */
export const STAT_TO_PRIORITY: Record<string, string> = {
  atk: "atk", atkPct: "atk",
  def: "def", defPct: "def",
  hp: "hp", hpPct: "hp",
  spd: "spd",
  critRate: "crc",
  critDmg: "chd",
  critDmgReduce: "critDmgRed",
  pen: "pen",
  dmgUp: "dmgUp",
  dmgReduce: "dmgRed",
  eff: "eff",
  effRes: "res",
};

/** Per-ROLL normalization — sized for a single substat / gem contribution,
 *  NOT for endgame final stats (those are `STAT_NORMS`). A max-rolled %ATK
 *  on a single sub is ~6%; a max-rolled flat ATK is ~50. Using `STAT_NORMS`
 *  (atk=4000, sized for full character ATK) for per-roll scoring would
 *  rank percent rolls 100× lower than flat rolls of comparable in-game
 *  impact, silently dropping percent-heavy pieces from the Top-% prune
 *  and gem allocator.
 *
 *  Keyed by ENGINE `StatType` so flat/percent variants get their own norm
 *  (atk vs atkPct), unlike STAT_NORMS which collapses everything under
 *  the user key. */
export const ROLL_NORMS: Record<string, number> = {
  // Flat per-roll ceilings (~max sub on a +15 T4 piece).
  atk: 300,
  def: 100,
  hp: 1500,
  spd: 20,
  // Percent per-roll ceilings.
  atkPct: 40,
  defPct: 40,
  hpPct: 40,
  critRate: 20,
  critDmg: 40,
  critDmgReduce: 25,
  pen: 30,
  dmgUp: 25,
  dmgReduce: 25,
  // EFF/RES are flat on accessory/armor, percent on EE/Talisman — average.
  eff: 50,
  effRes: 50,
};

/** Aggregate score driving the SOLVE-mode sort. Σ priority × (final / norm)
 *  scaled by 100 for readability (typical values land in 50–500). Negative
 *  priorities subtract — useful for "I want some of X but not too much".
 *  Builds with no stat in `priority` score 0. */
export function computeScore(s: FinalStats, priority: Record<string, number>): number {
  let total = 0;
  for (const key in priority) {
    const w = priority[key];
    if (!w) continue;
    const v = (s as unknown as Record<string, number>)[key];
    if (typeof v !== "number") continue;
    // CRC overflow past 100% is wasted in-game — don't reward builds that
    // stack +crc beyond the cap. STAT_NORMS[crc] = 100, so without this
    // clamp a 115% CRC build scored +15% on its crc contribution.
    const effective = key === "crc" ? Math.min(v, 100) : v;
    const norm = STAT_NORMS[key] ?? 100;
    total += (effective / norm) * w * 100;
  }
  return Math.round(total);
}
