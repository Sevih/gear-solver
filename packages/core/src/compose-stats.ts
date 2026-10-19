/**
 * Runtime no-gear stat composer — assembles the per-character ingredients
 * (`ingredients` of `data/derived/characters.json`, emitted by outerpedia's
 * `datagen/generators/solver-ingredients.ts` and synced by `data/sync.mjs`)
 * with the captured user progression and a few UI toggles. Returns the same
 * {NoGearStats, scaling} shape the BuildsScreen already consumes, so adding
 * gear on top stays identical to before.
 *
 * This file is the reference for the formula: the old-site admin stats route
 * it was first ported from no longer exists. The key insight is that
 * transcend% and the sum of class-passive + Skill_8 + gift %-bonuses compound
 * MULTIPLICATIVELY, while codex stacks additively on top of the compound
 * result (only on the baseMax leg, not on flats).
 */
import type {
  CharacterIngredients,
  CodexCurve,
  StatBlock,
  StatBracket,
  UserGeasLevels,
} from "./gamedata.js";
import { DEFAULT_RULES } from "./rules.js";

/** In-game per-level stat interpolation. Integer arithmetic — the per-level
 *  growth is FLOORED before being added to Min, never propagated as a float:
 *    stat(L) = Min + floor(rng × (L-1) / 99)                    for L ≤ 100
 *            + floor(rng × (L-100) × modifier / 99000)          extra above lv 100
 *  where `rng = Max - Min` and `modifier` is the per-mille amplifier from
 *  CharacterMaxLevelTemplet.LevelUpStatModifierAfter100 (200 / 400 / 700 for
 *  LB Step 1 / 2 / 3 on a 3★ char).
 *
 *  Both terms are floored INDEPENDENTLY: the lv-1..100 leg is the in-game
 *  per-level interpolation (first taken from the old site's python datamine
 *  parser, since removed; outerpedia's `src/lib/data/char-progression.ts`
 *  applies the same `floor(rng × (L-1) / 99)`); the lv > 100 amplification leg is `floor(rng × (L-100) × mod / 99000)` —
 *  reverse-engineered against M.S.Ame lv 105 mod=200 (ATK 1307 / HP 3913 /
 *  DEF 965 white all match in-game exactly).
 *
 *  Stats where min == max (SPD/CHC/CHD/EFF for most chars) collapse to a
 *  constant — rng=0 zeros both terms. */
export function baseAtLevel(bracket: StatBracket, level: number, modifier: number): number {
  if (bracket.max === bracket.min) return bracket.min;
  const rng = bracket.max - bracket.min;
  // baseTerm extrapolates naturally past lv 100 (rng × (L-1)/99 keeps growing);
  // at L=100 it lands exactly on `rng`. The modifier leg adds extra growth ON
  // TOP that's only unlocked once the char has LB'd past 100.
  const baseTerm = Math.floor(rng * (level - 1) / 99);
  const aboveTerm = level > 100
    ? Math.floor(rng * (level - 100) * modifier / 99000)
    : 0;
  return bracket.min + baseTerm + aboveTerm;
}

/** Per-character options the user (or capture) can dial in. Codex / Geas /
 *  Skill_8 are intentionally NOT toggleable — they're always active on the
 *  in-game character sheet and we just apply them at max. */
export interface ComposeOptions {
  /** Captured TransStar (0..9). Null = treat as max for the BasicStar. */
  transStar?: number | null;
  /** Codex level 0..11 — resolved by the caller from the captured
   *  `/archive/info` reward count via `resolveCodexLevel`. Missing/null
   *  falls back to the curve's max level (current default behavior). */
  codexLevel?: number;
  /** Captured character level (from Exp via expToLevel). Default 100. Used to
   *  interpolate base stats between lv 1 (Min) and lv 100 (Max). Above lv 100
   *  the limit-break modifier amplifies the per-level growth. */
  level?: number;
  /** CharacterMaxLevelTemplet.LevelUpStatModifierAfter100 — per-mille amplifier
   *  for the per-level growth above lv 100. Resolved by the caller from the
   *  captured `LevelMaxStep` + character `BasicStar`. Default 0 (no boost). */
  levelMaxModifier?: number;
  /** Captured Limit-Break step (0..3). Used to cap which evolution rows
   *  apply: the in-game rule is `EvolutionLevel ≤ 6 + LevelMaxStep`, so a
   *  non-LB char (step 0) gets evos 2..6 only and an LB3 char unlocks the
   *  full 2..9 range. Defaults to 3 (max — preserves the old behavior of
   *  summing every evo up to TransStar). */
  levelMaxStep?: number;
  /** EvolutionLevel row → character level it unlocks at — the contract's
   *  `gameRulesOf(game).evoUnlockLevel`. Omitted: `DEFAULT_RULES`. */
  evoUnlockLevel?: Record<number, number>;
  /** Account-wide Geas node levels from the captured `/gift/info` GiftList
   *  (NodeID → unlock level). Missing nodes are treated as Lv 0 (no bonus);
   *  pass `null`/omit to fall back to the per-node max level (assumes every
   *  applicable node is fully unlocked — useful for what-if previews). */
  userGeasLevels?: UserGeasLevels | null;
  /** Per-character user-leveled skill levels (S1 = First, S2 = Second,
   *  S3 = Ultimate). Used to pick the correct `s{1,2,3}ByLevel` row for
   *  chars whose skills have permanent self-stat passives (Ame S2 CHC,
   *  Bell Cranel S2 ATK, Claire S2 ATK at time of writing). A level with
   *  no row at or below it contributes nothing (Claire S2 lv1). Missing or
   *  `null` falls back to the highest available level emitted in the
   *  ingredient — matches "max-everything" previews. */
  userSkillLevels?: { first: number; second: number; ultimate: number } | null;
  /** Captured Core Fusion tier (`Character.fusionLevel`, 1..5; 0 when not
   *  fused). Picks the `corePassiveByFusion` block — the client takes the
   *  core passive (Skill_23) at the fusion tier's level. Missing or 0 falls
   *  back to the highest tier, the same "max-everything" preview as the
   *  skill levels above. */
  fusionLevel?: number;
}

const ZERO: StatBlock = {
  atk: 0, def: 0, hp: 0, spd: 0,
  chc: 0, chd: 0, pen: 0,
  dmgInc: 0, dmgRed: 0,
  eff: 0, res: 0,
  effRate: 0, resRate: 0,
  atkPct: 0, defPct: 0, hpPct: 0,
};

/** Resolve the Geas contribution for one char, split by node source. The
 *  in-game character sheet shows IOT_STAT geas additions in the WHITE
 *  portion (raw stat sources) and bundles IOT_BUFF geas (BT_STAT_PREMIUM
 *  buffs from nodes like RANGER_PASSIVE_3_10) into the YELLOW delta, so we
 *  return two separate StatBlocks for the composer to fold appropriately.
 *  `all` (= stat + buff) drives the no-gear total; `fromStat` drives the
 *  intrinsic "template" baseline. */
function resolveGeasTotal(
  geasByNode: CharacterIngredients["geasByNode"],
  userLevels: UserGeasLevels | null | undefined,
): { all: StatBlock; fromStat: StatBlock } {
  const all: StatBlock = { ...ZERO };
  const fromStat: StatBlock = { ...ZERO };
  for (const nodeId of Object.keys(geasByNode)) {
    const node = geasByNode[nodeId]!;
    const levels = node.levels;
    let effectiveLevel: number;
    if (userLevels) {
      effectiveLevel = userLevels[nodeId] ?? 0;
    } else {
      let max = 0;
      for (const k of Object.keys(levels)) {
        const n = Number(k);
        if (n > max) max = n;
      }
      effectiveLevel = max;
    }
    if (effectiveLevel <= 0) continue;
    const block = levels[String(effectiveLevel)];
    if (!block) continue;
    for (const k of Object.keys(all) as (keyof StatBlock)[]) {
      all[k] += block[k];
      if (node.source === "stat") fromStat[k] += block[k];
    }
  }
  return { all, fromStat };
}

function addBlock(a: StatBlock, b: StatBlock): StatBlock {
  return {
    atk: a.atk + b.atk, def: a.def + b.def, hp: a.hp + b.hp, spd: a.spd + b.spd,
    chc: a.chc + b.chc, chd: a.chd + b.chd, pen: a.pen + b.pen,
    dmgInc: a.dmgInc + b.dmgInc, dmgRed: a.dmgRed + b.dmgRed,
    eff: a.eff + b.eff, res: a.res + b.res,
    effRate: a.effRate + b.effRate, resRate: a.resRate + b.resRate,
    atkPct: a.atkPct + b.atkPct, defPct: a.defPct + b.defPct, hpPct: a.hpPct + b.hpPct,
  };
}

function maxTranscendStar(transcendByStar: CharacterIngredients["transcendByStar"]): number {
  let max = 0;
  for (const k of Object.keys(transcendByStar)) {
    const n = Number(k);
    if (n > max) max = n;
  }
  return max;
}

/** Pick the per-skill StatBlock row matching the user's captured level.
 *  The contract only emits the levels that carry a buff (Claire S2: 2..5,
 *  nothing at lv1), so a known level is floored onto the highest emitted
 *  row ≤ lv, and a known level below every row is ZERO — the skill line
 *  doesn't carry the buff yet (in-game Claire S2 lv1: ATK 1002, not 1096).
 *  Only an unknown level (no user level, or 0) falls back to the highest
 *  emitted row, the "max-everything" preview. Hoisted to module scope so it
 *  doesn't allocate a fresh closure on every `composeCharStats` call
 *  (× 121 chars × 3 skill slots per roster pass). */
export function pickSkillBlock(table: Record<string, StatBlock>, lv: number | undefined): StatBlock {
  const known = lv != null && lv > 0;
  let best = 0;
  for (const k of Object.keys(table)) {
    const n = Number(k);
    if (n > best && (!known || n <= lv)) best = n;
  }
  return best > 0 ? (table[String(best)] ?? ZERO) : ZERO;
}

/** Core Fusion passive (Skill_23) block at the captured fusion tier, plus its
 *  OAT_RATE speed (`spdPct`, display %). With `corePassiveByFusion`: the
 *  tier's block, the highest tier when the tier is unknown (missing or 0),
 *  ZERO when the tier has no block. Without it (a cache synced before the
 *  field existed): the legacy single `corePassive` block exactly as before —
 *  taken at max level whatever the tier, its speed rate pre-baked as flat
 *  `spd` by outerpedia, so `spdPct` is 0. */
function pickCoreBlock(
  ingredients: CharacterIngredients,
  fusionLevel: number | undefined,
): { block: StatBlock; spdPct: number } {
  const byFusion = ingredients.corePassiveByFusion;
  if (!byFusion) return { block: ingredients.corePassive ?? ZERO, spdPct: 0 };
  let tier = fusionLevel ?? 0;
  if (tier <= 0) {
    for (const k of Object.keys(byFusion)) {
      const n = Number(k);
      if (n > tier) tier = n;
    }
  }
  const row = byFusion[String(tier)];
  return row ? { block: row, spdPct: row.spdPct } : { block: ZERO, spdPct: 0 };
}

/** Apply the speed buff rate (`BuffValueRate`, display %) to a speed total,
 *  last, as the client's CalcFinalStat outer stage does:
 *  `trunc(total × (1000 + rate‰) / 1000)`. Shared by the no-gear composer
 *  and the gear-side `composeBuild.finalStatsFromBuckets`, so the rate
 *  multiplies the whole total once — base, evolutions, flats and gear alike.
 *  A zero rate returns the total untouched (bit-identical to the plain sum). */
export function applySpdRate(total: number, ratePct: number): number {
  return ratePct === 0 ? total : Math.trunc(total * (1000 + ratePct * 10) / 1000);
}

/** Character level at which an EvolutionLevel row unlocks in-game, from the
 *  contract's `progression.json › evoUnlockLevel` (fallback: DEFAULT_RULES).
 *  Evos 2..6 every 20 levels (20/40/60/80/100); 7/8/9 at the Limit-Break
 *  level caps 105/110/120 (NOT linear — LB3 jumps 110→120, skipping 115 —
 *  so a table, not a formula). Reaching those caps already requires the
 *  matching LB, so this level gate subsumes the LB gate for 7..9. Unknown
 *  rows fall back to lv120 (never unlocked below max). */
function evoUnlockLevelOf(table: Record<number, number>, evoLevel: number): number {
  return table[evoLevel] ?? 120;
}

/** Sum every evolution row that is BOTH unlocked by progression
 *  (EvolutionLevel ≤ min(targetStar, evoCap)) AND reached by the captured
 *  character `level` (`level ≥ evoUnlockLevel[row]`). The level gate is what
 *  the in-game sheet actually enforces: a transcended-but-underleveled hero
 *  (e.g. 6★ at lv5) shows NO evo bonuses until it hits lv20/40/… Previously
 *  only the star/LB cap was checked, so such heroes were over-credited every
 *  evo flat (def/hp/eff/spd) — the validation chars were all max-level, which
 *  masked the gap. Evos Lv 2..6 unlock via TransStar; Lv 7..9 via the LB step
 *  (LB1 → 7, LB2 → 8, LB3 → 9), so `evoCap = 6 + LB`.
 *  Verified against in-game Sterope (LB 0 → 2..6) and Luna (LB 3 → 2..9),
 *  plus Flamberge (6★ lv5 → none). */
export function sumEvoUpTo(
  evoByLevel: CharacterIngredients["evoByLevel"],
  targetStar: number,
  evoCap: number,
  level: number,
  evoUnlockLevel: Record<number, number> = DEFAULT_RULES.evoUnlockLevel,
): StatBlock {
  const cap = Math.min(targetStar, evoCap);
  let acc: StatBlock = { ...ZERO };
  for (const k of Object.keys(evoByLevel)) {
    const e = Number(k);
    if (e <= cap && level >= evoUnlockLevelOf(evoUnlockLevel, e)) acc = addBlock(acc, evoByLevel[k]!);
  }
  return acc;
}

/** CalcFinalStat — reverse-engineered from CFormula::CalcFinalStat in
 *  libil2cpp.so (1.4.9, RVA 0x2C59E48). All rate inputs are per-mille (×10
 *  of the % display), all flat inputs are integers. The two-stage compound
 *  is the key — additive rates are amplified first as a single bundle, then
 *  the (gearFlat + flat-buff)-extended sum is amplified by `buffRate` (where
 *  Skill_22 class passive, Skill_8 transcend passive, Geas BT_STAT_PREMIUM
 *  buffs, user-leveled S1/S2/S3 passives and the Core Fusion Skill_23
 *  passive all land per `SetBuffPremiumValue`):
 *    sum_flat = baseValue + evoValue + awakValue
 *    sum_rate = awakRate + transcendRate + gearRate           (per-mille)
 *    part1    = trunc(sum_flat × (1000 + sum_rate) / 1000)
 *    combined = part1 + gearFlat + buffValue
 *    part2    = trunc(combined × (1000 + buffRate) / 1000)
 *    codex    = trunc(baseValue × archiveRate / 1000)
 *    final    = max(0, part2 + codex)
 *  Validated 0-diff on 11/11 ATK/DEF/HP stats across 5 chars plus EFF/RES
 *  on G.Beth / Notia (core fusion +50% EFF baseline 120 → 255 exact match).
 *  `Math.trunc` mirrors the ARM64 signed-magic-divide-by-1000 — `Math.floor`
 *  would diverge on negative intermediates (rare but real on debuff sources). */
export function calcFinalStat(
  baseValue: number,
  evoValue: number,
  awakValue: number,
  awakRatePM: number,
  transcendRatePM: number,
  gearFlat: number,
  gearRatePM: number,
  archiveRatePM: number,
  buffRatePM: number,
  buffValue: number = 0,
): number {
  const sumFlat = baseValue + evoValue + awakValue;
  const sumRate = awakRatePM + transcendRatePM + gearRatePM;
  const part1 = Math.trunc(sumFlat * (1000 + sumRate) / 1000);
  const combined = part1 + gearFlat + buffValue;
  const part2 = Math.trunc(combined * (1000 + buffRatePM) / 1000);
  const codex = Math.trunc(baseValue * archiveRatePM / 1000);
  return Math.max(0, part2 + codex);
}

/** Result of composing the character ingredients without gear. ATK/DEF/HP
 *  (and EFF/RES) come through the compound formula; SPD is additive, then
 *  multiplied by its buff rate (`applySpdRate`); everything else is additive. */
export interface NoGearStats {
  atk: number; def: number; hp: number; spd: number;
  chc: number; chd: number; pen: number;
  dmgInc: number; dmgRed: number;
  eff: number; res: number;
}

/** CalcFinalStat ingredients. Mirrors the per-bucket parameters the in-game
 *  CFormula::CalcFinalStat takes (per-mille for rates, integer for flats):
 *   - baseValue  : per-level interpolated base stat (Min/Max bracket)
 *   - evoValue   : sum of evolution row flats up to evoCap
 *   - awakValue  : sum of geas IOT_STAT flats (raw stat adds from gift nodes)
 *                  — the ONLY geas source counted here, on every axis
 *   - awakPct    : sum of geas IOT_STAT rates                    (compounded first)
 *   - transcendPct: per-TransStar % bonus                         (compounded first)
 *   - codexPct   : ArchiveStatRate %                              (codex term, on baseValue only)
 *   - buffPct    : Skill_22 class passive + Skill_8 transcend passive +
 *                  Geas BT_STAT_PREMIUM rate                      (outermost amplifier)
 *  All %s are in DISPLAY units (10 = 10%). The composer converts to per-mille
 *  when applying the in-game formula. */
export interface StatScaling {
  baseValue: number;
  evoValue: number;
  awakValue: number;
  awakPct: number;
  transcendPct: number;
  codexPct: number;
  buffPct: number;
  /** Flat BuffValue contributions (BT_STAT_PREMIUM OAT_ADD via `SetBuffPremiumValue`):
   *  class passive + Skill_8 + Geas IOT_BUFF + S1/S2/S3 + core passive, the
   *  same sources on every axis. EFF / RES carry real ones (e.g.
   *  RANGER_PASSIVE_3_10 → +50 EFF); ATK / DEF / HP buffs are all OAT_RATE in
   *  today's data, so their buffValue is 0 — still summed, so a flat one lands
   *  here. Added to `combined` before the BR amplifier. */
  buffValue: number;
}

/** Speed ingredients for the gear-side composer. The speed buff rate (Core
 *  Fusion OAT_RATE SPD) must multiply the total that includes gear, so the
 *  composer hands over the speed BEFORE that rate rather than letting the
 *  gear side add onto `noGearStats.spd`, which already carries it. */
export interface SpeedScaling {
  /** No-gear speed before the buff rate: base + evo + every flat layer. */
  value: number;
  /** The part of `value` a gear speed RATE (Speed set, OAT_RATE) multiplies:
   *  base + evo + IOT_STAT geas — the client's `sum_flat`. The OAT_ADD buffs
   *  (Skill_8 +10 SPD, class / skill / core passives, Geas IOT_BUFF) sit in
   *  `combined`, outside that rate. */
  rateBase: number;
  /** Speed buff rate, display % (4.3 = +4.3 %), applied last by
   *  `applySpdRate`. 0 for every hero without a speed-rate passive. */
  buffPct: number;
}

export interface ComposedStats {
  /** Full no-gear stat sheet — includes every always-on permanent layer:
   *  base + evo + class passive + Skill_8 + Geas + (codex × transcend
   *  compound for ATK/DEF/HP). Equivalent to what the in-game shows when
   *  the character is unequipped. */
  noGearStats: NoGearStats;
  /** "Template" stat sheet — what the in-game character sheet shows in
   *  white (before the `(+X)` gear/investment delta).
   *  - ATK / DEF / HP : `floor(baseMax + evo + geas)` — raw additive sources
   *    only, NO compound (the codex/transcend/class/skill_8 multipliers all
   *    get bundled into the yellow delta alongside gear).
   *  - Other stats (SPD / CRC / CHD / EFF / RES / PEN / DMG±) : full no-gear
   *    baseline (base + evo + class + skill_8 + geas) since these stats are
   *    additive — there's no compound to isolate. */
  intrinsicStats: NoGearStats;
  /** Per-axis CalcFinalStat ingredients. ATK/DEF/HP carry the full compound
   *  inputs (codex / transcend / class / geas / skill passives); EFF/RES
   *  expose `awakPct` (rare IOT_STAT geas rates) and `buffPct` (Skill_8 /
   *  geas IOT_BUFF / core fusion OAT_RATE) so the gear-side composer can
   *  route them through the right CalcFinalStat channel. `spd` carries the
   *  speed before its buff rate and the rate itself (see `SpeedScaling`). */
  scaling: Record<"atk" | "def" | "hp" | "eff" | "res", StatScaling> & { spd: SpeedScaling };
}

/** Compose the no-gear stats and the ATK/DEF/HP scaling ingredients for one
 *  character. Pure — no mutation, no globals. */
export function composeCharStats(
  ingredients: CharacterIngredients,
  codexCurve: CodexCurve,
  options: ComposeOptions = {},
): ComposedStats {
  const codexLevel = Math.max(0, Math.min(codexCurve.length - 1, options.codexLevel ?? codexCurve.length - 1));
  const transStar = options.transStar != null && options.transStar > 0
    ? options.transStar
    : maxTranscendStar(ingredients.transcendByStar);

  const levelMaxStep = Math.max(0, Math.min(3, options.levelMaxStep ?? 3));
  // Captured level — also gates which evolution rows are unlocked (see
  // `sumEvoUpTo`), so it must be resolved before the evo sum, not just for
  // the base-stat interpolation below.
  const level = options.level ?? 100;
  const evo = sumEvoUpTo(ingredients.evoByLevel, transStar, 6 + levelMaxStep, level, options.evoUnlockLevel);
  const transRow = ingredients.transcendByStar[String(transStar)]
    ?? { atkPct: 0, defPct: 0, hpPct: 0, skillLevel: 0 };
  const codexRow = codexCurve[codexLevel] ?? { atkPct: 0, defPct: 0, hpPct: 0 };
  const classPass = ingredients.classPassive;
  // Codex / Geas / Skill_8 are always on per the in-game character sheet.
  const skill8 = transRow.skillLevel > 0
    ? (ingredients.skill8ByLevel[String(transRow.skillLevel)] ?? ZERO)
    : ZERO;
  const geasResolved = resolveGeasTotal(ingredients.geasByNode, options.userGeasLevels);
  const geas = geasResolved.all;
  const geasStat = geasResolved.fromStat;
  // Skill passives (S1/S2/S3 + core fusion). `pickSkillBlock` (hoisted
  // above) picks the row matching the captured user skill level — ZERO at a
  // level that doesn't carry the buff — and falls back to the highest
  // emitted level only when no user level is provided. The Core Fusion
  // passive is taken at the captured fusion tier (`pickCoreBlock`).
  const usl = options.userSkillLevels;
  const s1 = pickSkillBlock(ingredients.s1ByLevel ?? {}, usl?.first);
  const s2 = pickSkillBlock(ingredients.s2ByLevel ?? {}, usl?.second);
  const s3 = pickSkillBlock(ingredients.s3ByLevel ?? {}, usl?.ultimate);
  const core = pickCoreBlock(ingredients, options.fusionLevel);
  const skillPass = addBlock(addBlock(addBlock(s1, s2), s3), core.block);
  // Speed buff rate of the sheet (display %) — today only the core passive
  // carries one (Core Fusion Snow / Lisha +4.3 %).
  const spdRatePct = core.spdPct;

  // Resolve every base stat at the captured level (with LB modifier above
  // lv 100). Stats where min == max stay constant — baseAtLevel returns max.
  // (`level` resolved above — it also gates the evolution rows.)
  const modifier = options.levelMaxModifier ?? 0;
  const baseAtk = baseAtLevel(ingredients.base.atk, level, modifier);
  const baseDef = baseAtLevel(ingredients.base.def, level, modifier);
  const baseHp  = baseAtLevel(ingredients.base.hp,  level, modifier);
  const baseSpd = baseAtLevel(ingredients.base.spd, level, modifier);
  const baseChc = baseAtLevel(ingredients.base.chc, level, modifier);
  const baseChd = baseAtLevel(ingredients.base.chd, level, modifier);
  const baseEff = baseAtLevel(ingredients.base.eff, level, modifier);
  const baseRes = baseAtLevel(ingredients.base.res, level, modifier);

  // Bucket split mirrors the in-game CalcFinalStat parameters:
  //  - awakRate (`AwakeningValueRate` in IL2CPP) = geas IOT_STAT %-bonuses
  //  - buffRate (`BuffValueRate`, fed by `SetBuffPremiumValue`) = Skill_22
  //    class passive + Skill_8 transcend passive + Geas BT_STAT_PREMIUM +
  //    S1/S2/S3 user-leveled passives + Core Fusion passive
  //  - awakValue = geas IOT_STAT flat adds (a single bucket alongside evo)
  const atkBuffPct = classPass.atkPct + skill8.atkPct + (geas.atkPct - geasStat.atkPct) + skillPass.atkPct;
  const defBuffPct = classPass.defPct + skill8.defPct + (geas.defPct - geasStat.defPct) + skillPass.defPct;
  const hpBuffPct  = classPass.hpPct  + skill8.hpPct  + (geas.hpPct  - geasStat.hpPct)  + skillPass.hpPct;
  // EFF / RES buff bonuses split by ApplyingType:
  //  - OAT_ADD (flat) → `buffValue`: class passive +CHC/EFF, geas [141]
  //    +50 EFF, skill_8 EFF flats — added to `combined` before BuffRate.
  //  - OAT_RATE (rate, display %) → `buffPct`: Notia core +50% EFF, Skill_8
  //    `trancendent_8_buff_chance`/`_resist`, geas Awakening_Boss_*, etc.
  //    Routed via `BuffValueRate` per CalcFinalStat — multiplied with
  //    `combined` so the result correctly scales with whatever sum_flat ends
  //    up being (gear, geas, transcend already folded in). Pre-baking a rate
  //    to flat only matches when combined ≈ baseForRate.
  const effBuffValue = classPass.eff + skill8.eff + (geas.eff - geasStat.eff) + skillPass.eff;
  const resBuffValue = classPass.res + skill8.res + (geas.res - geasStat.res) + skillPass.res;
  const effBuffPct   = classPass.effRate + skill8.effRate + (geas.effRate - geasStat.effRate) + skillPass.effRate;
  const resBuffPct   = classPass.resRate + skill8.resRate + (geas.resRate - geasStat.resRate) + skillPass.resRate;

  // Floor (not round) on the per-level interpolated base stats to match the
  // in-game truncation — round() would push e.g. Luna's lv120 RES 130.91 to
  // 131 when the in-game sheet shows 130.
  const spdBeforeRate = Math.floor(baseSpd + evo.spd + classPass.spd + skill8.spd + geas.spd + skillPass.spd);
  const spdRateBase = Math.floor(baseSpd + evo.spd + geasStat.spd);

  // ATK / DEF / HP flats, same split as EFF / RES: IOT_STAT geas in
  // `awakValue`, every buff source (OAT_ADD) in `buffValue`.
  const atkBuffValue = classPass.atk + skill8.atk + (geas.atk - geasStat.atk) + skillPass.atk;
  const defBuffValue = classPass.def + skill8.def + (geas.def - geasStat.def) + skillPass.def;
  const hpBuffValue  = classPass.hp  + skill8.hp  + (geas.hp  - geasStat.hp)  + skillPass.hp;

  const scaling = {
    spd: { value: spdBeforeRate, rateBase: spdRateBase, buffPct: spdRatePct },
    atk: { baseValue: baseAtk, evoValue: evo.atk, awakValue: geasStat.atk, awakPct: geasStat.atkPct, transcendPct: transRow.atkPct, codexPct: codexRow.atkPct, buffPct: atkBuffPct, buffValue: atkBuffValue },
    def: { baseValue: baseDef, evoValue: evo.def, awakValue: geasStat.def, awakPct: geasStat.defPct, transcendPct: transRow.defPct, codexPct: codexRow.defPct, buffPct: defBuffPct, buffValue: defBuffValue },
    hp:  { baseValue: baseHp,  evoValue: evo.hp,  awakValue: geasStat.hp,  awakPct: geasStat.hpPct,  transcendPct: transRow.hpPct,  codexPct: codexRow.hpPct,  buffPct: hpBuffPct,  buffValue: hpBuffValue },
    // IOT_STAT geas EFF/RES rate (rare — e.g. some `Awakening_*` nodes) goes
    // to `awakPct` so it amplifies sum_flat at the inner CalcFinalStat layer,
    // mirroring how ATK/DEF/HP IOT_STAT geas rates route to `awakPct` above.
    eff: { baseValue: baseEff, evoValue: evo.eff, awakValue: geasStat.eff, awakPct: geasStat.effRate, transcendPct: 0, codexPct: 0, buffPct: effBuffPct, buffValue: effBuffValue },
    res: { baseValue: baseRes, evoValue: evo.res, awakValue: geasStat.res, awakPct: geasStat.resRate, transcendPct: 0, codexPct: 0, buffPct: resBuffPct, buffValue: resBuffValue },
  };

  const calcStat = (s: StatScaling): number =>
    calcFinalStat(s.baseValue, s.evoValue, s.awakValue, s.awakPct * 10, s.transcendPct * 10, 0, 0, s.codexPct * 10, s.buffPct * 10, s.buffValue);

  const noGearStats: NoGearStats = {
    atk: calcStat(scaling.atk),
    def: calcStat(scaling.def),
    hp:  calcStat(scaling.hp),
    // The speed rate multiplies the whole no-gear speed, last (client:
    // trunc(133 × 1.043) = 138 for Core Fusion Snow lv1, not 133 + 6).
    spd: applySpdRate(spdBeforeRate, spdRatePct),
    chc: Math.floor(baseChc + evo.chc + classPass.chc + skill8.chc + geas.chc + skillPass.chc),
    chd: Math.floor(baseChd + evo.chd + classPass.chd + skill8.chd + geas.chd + skillPass.chd),
    pen: evo.pen + classPass.pen + skill8.pen + geas.pen + skillPass.pen,
    dmgInc: evo.dmgInc + classPass.dmgInc + skill8.dmgInc + geas.dmgInc + skillPass.dmgInc,
    dmgRed: evo.dmgRed + classPass.dmgRed + skill8.dmgRed + geas.dmgRed + skillPass.dmgRed,
    // EFF / RES — full CalcFinalStat path so OAT_RATE buffs (Skill_8 /
    // geas IOT_BUFF / core fusion) amplify multiplicatively per the
    // in-game `BuffValueRate` channel. Matches in-game exactly on Notia
    // core (+50% EFF baseline 120 → 255) and G.Beth (636 with gear).
    eff: calcStat(scaling.eff),
    res: calcStat(scaling.res),
  };

  // Intrinsic = the in-game "white" portion of each stat. Rules per stat axis:
  //  - ATK / DEF / HP : raw sum (baseMax + evo + IOT_STAT geas). The compound
  //    amplifications (codex × transcend × class % × skill_8 % + IOT_BUFF
  //    geas + gear) all live in the yellow delta. Validated on M.S.Ame ATK
  //    (1307 = 783.5 + 124 + 400) and DEF (965 = 292 + 73 + 600).
  //  - SPD / CHC / CHD / EFF / RES / PEN / DMG± : additive sources only —
  //    base + evo + IOT_STAT geas. Class passive and Skill_8 PREMIUM buffs
  //    show up as yellow (they're permanent "buffs" rather than raw stats).
  //    Validated on M.S.Ame EFF (120 = 10 + 110 + 0; the +50 Geas EFF lives
  //    on an IOT_BUFF node and lands in the +125 yellow delta).
  const intrinsicStats: NoGearStats = {
    atk: Math.floor(scaling.atk.baseValue + evo.atk + geasStat.atk),
    def: Math.floor(scaling.def.baseValue + evo.def + geasStat.def),
    hp:  Math.floor(scaling.hp.baseValue  + evo.hp  + geasStat.hp),
    spd: Math.floor(baseSpd + evo.spd + geasStat.spd),
    chc: Math.floor(baseChc + evo.chc + geasStat.chc),
    chd: Math.floor(baseChd + evo.chd + geasStat.chd),
    pen: evo.pen + geasStat.pen,
    dmgInc: evo.dmgInc + geasStat.dmgInc,
    dmgRed: evo.dmgRed + geasStat.dmgRed,
    eff: Math.floor(baseEff + evo.eff + geasStat.eff),
    res: Math.floor(baseRes + evo.res + geasStat.res),
  };

  return { noGearStats, intrinsicStats, scaling };
}
