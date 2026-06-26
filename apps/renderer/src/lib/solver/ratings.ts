/**
 * Cheap build ratings — pure products of `FinalStats`, no extra inputs.
 * Hot path for the solver: ~5–10ns each so we can call them on every
 * surviving combo without measurably moving the per-combo cost.
 *
 * The 8 ratings + Score are surfaced in the Builder's results table and as
 * filter axes in the Rating filters panel. CP lives in `./cp.ts` because
 * it needs hero skills + EE/Talisman piece metadata, so it's much heavier.
 *
 * **Damage formulas** follow `docs/damage-calc/binary-formulas-1.4.9.md`
 * (`CFormula.<CalcDamage>g__CalcDamage|17_0`) reduced to a build-trait
 * scoring context:
 *
 *   E[damage per hit] ∝ Stat × E[DR]/1000 × penMult
 *   E[DR]   = 1000 + pCrit × (CHD×10 − 1000) + DMGBoost − DMGReduce  (clamped ≥ 300)
 *   penMult = (TARGET_DEF + 1000) / (TARGET_DEF × (1 − PEN/100) + 1000)
 *
 * The previous formula `ATK × CHC × CHD` had no physical meaning — it
 * implicitly assumed non-crits did zero damage, ranking a CHD=300 / CHC=0
 * build as "dmg = 0" instead of `ATK × 1.0`. PEN was ignored entirely.
 */
import type { FinalStats } from "../composeBuild.js";

export interface CheapRatings {
  /** HP × SPD — bulky-and-fast composite (proxy, not a damage formula). */
  hps: number;
  /** Effective HP — `HP × (1 + DEF/1000)`. Matches the in-game defense
   *  mitigation `1000/(DEF+1000)` exactly (defender side, no penetration). */
  ehp: number;
  /** EHP × SPD — tanky-and-fast composite. */
  ehps: number;
  /** Expected damage per ATK-scaling hit vs a `TARGET_DEF` enemy.
   *  Includes crit weighting (pCrit × CHD term), `dmgUp − dmgRed`, and the
   *  penetration multiplier against TARGET_DEF=2000. */
  dmg: number;
  /** DPS — Dmg × SPD. */
  dmgs: number;
  /** Max crit damage — assumes 100% CHC. Useful for setups with raid buffs
   *  that push CHC to 100% (the typical "crit cap" comparison). */
  mcd: number;
  /** Max DPS — Mcd × SPD. */
  mcds: number;
  /** Expected damage per HP-scaling hit (Aer's S3, Caren's heal-as-damage,
   *  etc.) vs a `TARGET_DEF` enemy. Same crit/PEN math as `dmg`, just HP
   *  instead of ATK. */
  dmgh: number;
}

/** Reference enemy DEF the offensive ratings (`dmg`, `dmgs`, `mcd`, `mcds`,
 *  `dmgh`) score against. PvE midgame bosses sit in the 1500-3000 range;
 *  2000 is a pragmatic middle that makes the PEN multiplier behave
 *  intuitively (PEN 50% → ×1.5, PEN 100% → ×3.0).
 *
 *  Constant rather than configurable for now — change it in one place if
 *  ranking against very tanky / very squishy targets becomes a real need.
 *  Note that this only shifts the relative weight of PEN vs other stats;
 *  builds with no PEN see the same ranking across any TARGET_DEF. */
const TARGET_DEF = 2000;

/** Hit-rate floor mirrored from `CheckDamageRate` (§3.2: `rate = Max(rate, 300)`).
 *  Means a build can never score below 30% of its uncrit damage even with
 *  large defender DMGReduce stacks. */
const DR_FLOOR = 0.3;

/** Compute every cheap rating in one pass. Inlined branches and no
 *  allocations besides the return object.
 *
 *  `dmgStat` is the character's main damage-scaling stat — "atk" for the
 *  majority, "def" (Caren) or "hp" (HP-scalers) for the exceptions. `dmgSec`
 *  adds secondary additive components (`stat × ratio`, e.g. D.Stella's HP×0.03)
 *  to the damage base. The offensive ratings `dmg`/`dmgs`/`mcd`/`mcds` score
 *  against `mainStat + Σ secondary` instead of bare ATK, so off-ATK and hybrid
 *  heroes get a meaningful "dmg" column. `dmgh` stays the explicit HP-scaling
 *  reference column regardless.
 *
 *  `noCrit` heroes (Rhona / K.Tamamo / G.Nella — their damage skills can never
 *  crit) score with `pCrit = 0` so the crit term drops out entirely, and `mcd`
 *  (the "assume 100% CHC" column) collapses to the non-crit hit — they have no
 *  crit ceiling to reach. Without this the offensive ratings reward CHC/CHD a
 *  no-crit hero can never cash in, over-ranking crit gear for them. */
export function computeCheapRatings(
  s: FinalStats,
  dmgStat: "atk" | "def" | "hp" = "atk",
  dmgSec?: ReadonlyArray<{ stat: "atk" | "def" | "hp" | "spd" | "eff" | "crc"; ratio: number }>,
  noCrit = false,
): CheapRatings {
  const hps = s.hp * s.spd;
  // EHP — combines DEF mitigation with the defender's DMGReduceRate
  // contribution to the DR rate per §3.2 (`rate -= defender.DMGReduceRate;
  // rate = Max(rate, 300)`). Inverting the rate gives the EHP multiplier:
  // a defender with 50% dmgRed effectively doubles their EHP. The DR_FLOOR
  // mirror means dmgRed past ~70% stops contributing (rate clamps to 300).
  const dmgRedTaken = Math.max(DR_FLOOR, 1 - s.dmgRed / 100);
  const ehp = s.hp * (1 + s.def / 1000) / dmgRedTaken;
  const ehps = ehp * s.spd;
  // CRC capped at 100% in-game — overflow is wasted. dmgUp (attacker's
  // DMGBoost) folds into the DR rate per §3.2 — dmgRed is the *defender's*
  // stat, so it doesn't reduce a build's own offensive output, only its
  // EHP intake (above). This was the subtle bug in the first pass.
  // No-crit heroes can never land a crit → pCrit collapses to 0, so the CHD
  // term drops out of every offensive rating.
  const pCrit = noCrit ? 0 : Math.min(s.crc, 100) / 100;
  const chdMult = s.chd / 100;
  const dmgUpMod = s.dmgUp / 100;
  // E[DR] / 1000 — normal hit = 1.0, crit = CHD/100, weighted by pCrit.
  // Then +dmgUp/100 from the attacker's DMGBoost buff chain.
  const drFactor = Math.max(DR_FLOOR, 1 + pCrit * (chdMult - 1) + dmgUpMod);
  // Same but assuming 100% CHC (the "I have raid crit buffs" comparison).
  // A no-crit hero has no crit ceiling to reach, so its "max crit" hit is just
  // the non-crit hit (== drFactor) — never a phantom CHD-scaled number.
  const mcdFactor = noCrit ? drFactor : Math.max(DR_FLOOR, chdMult + dmgUpMod);
  // Penetration multiplier vs the TARGET_DEF enemy. PPR caps at 100% per
  // §1.2: `min(PPR, 1000)`; we model PEN past 100% as "no extra credit"
  // (the flat PiercePower stat is rare on builds and ignored here).
  const penPct = Math.min(s.pen, 100) / 100;
  const effTargetDef = TARGET_DEF * (1 - penPct);
  const penMult = (TARGET_DEF + 1000) / (effTargetDef + 1000);
  // Offensive ratings scale off the hero's actual damage stat (ATK by default;
  // DEF / HP for the off-ATK exceptions) plus any additive secondary
  // (stat × ratio). `dmgh` keeps using HP as a fixed HP-scaling reference.
  let dmgBase = dmgStat === "def" ? s.def : dmgStat === "hp" ? s.hp : s.atk;
  if (dmgSec) {
    for (const { stat, ratio } of dmgSec) {
      dmgBase += (stat === "def" ? s.def : stat === "hp" ? s.hp : stat === "spd" ? s.spd : stat === "eff" ? s.eff : stat === "crc" ? s.crc : s.atk) * ratio;
    }
  }
  const dmg = dmgBase * drFactor * penMult;
  const dmgs = dmg * s.spd;
  const mcd = dmgBase * mcdFactor * penMult;
  const mcds = mcd * s.spd;
  const dmgh = s.hp * drFactor * penMult;
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
