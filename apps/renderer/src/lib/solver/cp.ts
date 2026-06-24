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

export function calcBattlePower(args: CpArgs): number {
  const { stats: s, showUIStar, starPlus, skills, ee, ooparts, fused } = args;
  const crcRaw = Math.min(s.crc * 10, 1000); // cap at 100%
  const chdRaw = s.chd * 10;
  const penRaw = s.pen * 10;
  const dmgupRaw = s.dmgUp * 10;
  const dmgredRaw = s.dmgRed * 10;
  const ecdrRaw = 0; // not exposed in FinalStats; non-buffed chars have 0
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
  const starBonus = showUIStar * 500 + starPlus * 120;
  const skillSum = (skills.first - 4) + skills.second + skills.ultimate + skills.chainPassive;
  const eeBp = ee ? ee.enhanceLevel * 100 + 300 : 0;
  const ooBp = ooparts ? ooparts.enhanceLevel * 100 + (ooparts.star ?? 0) * 50 : 0;
  const fusionBp = fused ? 5000 : 0;
  return Math.floor(atkPart + defPart + starBonus + skillSum * 100 + eeBp + ooBp + fusionBp);
}
