/**
 * Combat Power (BP / BattlePower) — reverse-engineered from
 * `CalcBattlePower` in libil2cpp.so (1.4.9 build), validated 0-diff on 5
 * characters covering LB0/1/2/3.
 *
 * Stat conventions (critical):
 *  - CRC is CAPPED at 100% before entering the formula.
 *  - CRC/CHD/PEN/DMGup/DMGRed/ECDR are × 10 raw internally — these inputs
 *    here are the DISPLAYED (percent) values, multiplied to raw inside.
 *  - EFF/RES use the displayed integer directly.
 *
 * See `memory/game_combat_power_formula.md` for the full derivation.
 *
 * Moved out of BuildsScreen so the solver worker can import it without
 * pulling React (BuildsScreen.tsx transitively pulls the design system).
 */
import type { GearPiece } from "@gear-solver/core";
import type { FinalStats } from "../composeBuild.js";

export interface CpArgs {
  stats: FinalStats;
  showUIStar: number;
  starPlus: number;
  skills: { first: number; second: number; ultimate: number; chainPassive: number };
  ee: GearPiece | null;
  ooparts: GearPiece | null;
  fused: boolean;
}

/** The four constant-per-solve additive bonuses, captured once. All are exact
 *  integers, so pre-computing them and re-summing in the original order below
 *  is byte-identical to the all-inline formula (no float-order drift). */
interface CpBonuses {
  starBonus: number;
  /** Σ (skillLevel − 1) over the four skills — already summed (still an int). */
  skillSum: number;
  eeBp: number;
  fusionBp: number;
}

function cpBonuses(showUIStar: number, starPlus: number, skills: CpArgs["skills"], ee: GearPiece | null, fused: boolean): CpBonuses {
  // Each skill contributes (level − 1) × 100 to CP. All four skills start at
  // Lv1 in-game and max at Lv5, so a fresh character (every skill Lv1) adds 0.
  // Verified on Flamberge (6★ lv5): S1 Lv1/2/3 → in-game CP 6085/6185/6285
  // (+100 per level from Lv1), and her all-Lv1 sheet decomposes exactly onto
  // 6085 only when skillSum = 0. S1 is symmetric with the other three — an
  // earlier `max(0, first-4)` wrongly assumed a Lv4 baseline (the all-Lv1 case
  // was never exercised). Clamped ≥0 so a partial capture (level 0) can't
  // subtract CP.
  const skillSum =
      Math.max(0, skills.first - 1)
    + Math.max(0, skills.second - 1)
    + Math.max(0, skills.ultimate - 1)
    + Math.max(0, skills.chainPassive - 1);
  return {
    starBonus: showUIStar * 500 + starPlus * 120,
    skillSum,
    eeBp: ee ? ee.enhanceLevel * 100 + 300 : 0,
    fusionBp: fused ? 5000 : 0,
  };
}

/** Stat-dependent CP core + the captured constant bonuses + the talisman's
 *  per-piece bonus. The final summation order is exactly the original
 *  all-inline formula, so results are bit-for-bit identical. */
function cpFrom(s: FinalStats, ooparts: GearPiece | null, b: CpBonuses): number {
  const crcRaw = Math.min(s.crc * 10, 1000); // cap at 100%
  const chdRaw = s.chd * 10;
  const penRaw = s.pen * 10;
  const dmgupRaw = s.dmgUp * 10;
  const dmgredRaw = s.dmgRed * 10;
  // ECDR (Crit Damage Reduction) IS exposed in FinalStats: it's summed from
  // `critDmgReduce` substats / mains in composeBuild. Same ×10 raw convention
  // as the other rate inputs. Builds stacking CDR were previously undervalued
  // (defR collapsed to the dmgredRaw-only contribution).
  const ecdrRaw = s.critDmgRed * 10;
  const sumCd = dmgupRaw + chdRaw;
  let critF: number;
  if (sumCd < 2001) {
    critF = sumCd / 1000;
  } else {
    const x = Math.min((sumCd - 2000) / 2500, 1.0);
    critF = 2.0 * (1 - (1 - x) ** 2) + 2.5;
  }
  const crcF = (crcRaw + 1000) / 1000;
  const penF = (penRaw * 1.5 + 1000) / 1000;
  const spdF = 1 + s.spd / 50;
  const effF = 1.7 * s.eff / (s.eff + 130);
  const hdF = 44000 / (s.hp + s.def + 44000);
  const defF = hdF * 0.15 + 1.05;
  const resR = 1 + 0.25 * s.res / (s.res + 200);
  const defR = 1 + 0.25 * (ecdrRaw + dmgredRaw) / ((ecdrRaw + dmgredRaw) + 200);
  const chain = (1 + effF) * crcF * critF * penF * spdF;
  const atkPart = 0.125 * s.atk * (1 + chain);
  const defPart = (s.hp + s.def) * defF * defR * resR;
  const ooBp = ooparts ? ooparts.enhanceLevel * 100 + (ooparts.star ?? 0) * 50 : 0;
  return Math.floor(atkPart + defPart + b.starBonus + b.skillSum * 100 + b.eeBp + ooBp + b.fusionBp);
}

export function calcBattlePower(args: CpArgs): number {
  return cpFrom(args.stats, args.ooparts, cpBonuses(args.showUIStar, args.starPlus, args.skills, args.ee, args.fused));
}

/** Hot-loop CP evaluator. The solver computes CP for every surviving combo in
 *  SOLVE CP mode, so it pre-captures the constant bonuses ONCE and returns a
 *  closure `(stats, talisman) → cp` — no per-combo `CpArgs` allocation and no
 *  re-derivation of the star / skill / EE / fusion constants. Bit-identical to
 *  `calcBattlePower` with the same inputs (see `cpFrom`). */
export function makeCpEvaluator(c: Omit<CpArgs, "stats" | "ooparts">): (s: FinalStats, ooparts: GearPiece | null) => number {
  const bonuses = cpBonuses(c.showUIStar, c.starPlus, c.skills, c.ee, c.fused);
  return (s, ooparts) => cpFrom(s, ooparts, bonuses);
}
