/**
 * Combat Power (BP / BattlePower) — reverse-engineered from
 * `CalcBattlePower` in libil2cpp.so (1.4.9 build), validated 0-diff on 5
 * characters covering LB0/1/2/3.
 *
 * The client computes in FLOAT32: every operation is ported as is, in its
 * order, under `Math.fround` (as outerpedia's `calcNoGearBattlePower` does) —
 * in double, ~0.5 % of the sheets came out ±1.
 *
 * Stat conventions (critical):
 *  - CRC is CAPPED at 100% before entering the formula.
 *  - CRC/CHD/PEN/DMGup/DMGRed/ECDR are × 10 raw internally — these inputs
 *    here are the DISPLAYED (percent) values, multiplied to raw inside.
 *  - EFF/RES use the displayed integer directly.
 *
 * See `docs/reference.md` § 2.2 (CalcBattlePower) for the full derivation.
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
 *  integers (exact in float32 too), so pre-computing them changes nothing; they
 *  are added in the client's order below. */
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

const f = Math.fround;

/** Stat-dependent CP core + the captured constant bonuses + the talisman's
 *  per-piece bonus, in the client's float32 chain. */
function cpFrom(s: FinalStats, ooparts: GearPiece | null, b: CpBonuses): number {
  // Raw values (display × 10) are integers on the client; `round` drops the
  // ×10 float noise of the 1-decimal display values (41.2 × 10).
  const crcRaw = Math.min(Math.round(s.critRate * 10), 1000); // cap at 100%
  const chdRaw = Math.round(s.critDmg * 10);
  const penRaw = Math.round(s.pen * 10);
  const dmgupRaw = Math.round(s.dmgUp * 10);
  const dmgredRaw = Math.round(s.dmgReduce * 10);
  // ECDR (Crit Damage Reduction) IS exposed in FinalStats: it's summed from
  // `critDmgReduce` substats / mains in composeBuild. Same ×10 raw convention
  // as the other rate inputs. Builds stacking CDR were previously undervalued
  // (defR collapsed to the dmgredRaw-only contribution).
  const ecdrRaw = Math.round(s.critDmgReduce * 10);
  // Crit factor: linear up to 2000 raw (CHD + DMG+), then a saturating knee
  // (`Mathf.Pow` = `Math.pow` rounded to float).
  const sumCd = f(chdRaw + dmgupRaw);
  const critF = sumCd < 2001
    ? f(sumCd / 1000)
    : f(2.5 + f(2 * f(1 - f(Math.pow(f(1 - Math.min(1, f(f(sumCd - 2000) / 2500))), 2)))));
  // ATK part: (atk + atk × CHC × crit × PEN × SPD × EFF) / 8.
  const crcF = f(f(1000 + crcRaw) * f(0.001));
  const penF = f(f(1000 + f(penRaw * 1.5)) * f(0.001));
  const spdF = f(1 + f(s.spd / 50));
  const effF = f(1 + f(f(1.7) * f(s.eff / f(s.eff + 130))));
  let chain = f(s.atk * crcF);
  chain = f(chain * critF);
  chain = f(chain * penF);
  chain = f(chain * spdF);
  chain = f(chain * effF);
  const atkPart = f(f(s.atk + chain) / 8);
  // HP + DEF part: × DEF, × reductions, × RES.
  const hd = f(s.hp + s.def);
  const red = f(ecdrRaw + dmgredRaw);
  let defPart = f(hd * f(f(1.05) + f(f(0.15) * f(44000 / f(hd + 44000)))));
  defPart = f(defPart * f(1 + f(f(0.25) * f(red / f(red + 200)))));
  defPart = f(defPart * f(1 + f(f(0.25) * f(s.effRes / f(s.effRes + 200)))));
  // Additive constants: stars + skills, then EE, talisman, fusion.
  const constants = f(f(b.starBonus) + f(b.skillSum * 100));
  const ooBp = ooparts ? ooparts.enhanceLevel * 100 + (ooparts.star ?? 0) * 50 : 0;
  return Math.floor(f(f(f(f(f(atkPart + defPart) + constants) + b.eeBp) + ooBp) + b.fusionBp));
}

export function calcBattlePower(args: CpArgs): number {
  return cpFrom(args.stats, args.ooparts, cpBonuses(args.showUIStar, args.starPlus, args.skills, args.ee, args.fused));
}

/** Hot-loop CP evaluator. The solver computes CP for every surviving combo in
 *  SOLVE CP mode, so it pre-captures the constant bonuses ONCE and returns a
 *  closure `(stats, talisman) → cp` — no per-combo `CpArgs` allocation and no
 *  re-derivation of the star / skill / EE / fusion constants. Same `cpFrom` as
 *  `calcBattlePower`, so the same result. */
export function makeCpEvaluator(c: Omit<CpArgs, "stats" | "ooparts">): (s: FinalStats, ooparts: GearPiece | null) => number {
  const bonuses = cpBonuses(c.showUIStar, c.starPlus, c.skills, c.ee, c.fused);
  return (s, ooparts) => cpFrom(s, ooparts, bonuses);
}
