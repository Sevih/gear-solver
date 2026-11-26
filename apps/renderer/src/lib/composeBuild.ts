/**
 * Shared stat-composition pipeline. Extracted from BuildsScreen so the
 * Builder screen (and any future consumer — solver, gear card hovers, …)
 * can compute a hero's gear-included stats without duplicating logic.
 *
 * Mirror of the in-game CFormula::CalcFinalStat from libil2cpp.so 1.4.9
 * (RVA 0x2C59E48). Validated 0-diff on a fleet of LB0/1/2/3 chars; see
 * `docs/reference.md` § 2.1 (CalcFinalStat) for the derivation.
 *
 * NOTE: keep this file pure — no React, no IO. The screens own the React
 * state + memoization; this lib is the deterministic engine.
 */
import { applySpdRate, calcFinalStat, wornSetRows, type GameData, type GearPiece, type RolledStat, type SetCombatEffect, type SetLevel, type SpeedScaling, type StatScaling } from "@gear-solver/core";

export interface FinalStats {
  atk: number; hp: number; def: number; spd: number;
  /** Crit chance, bounded to [0, 100] as the client bounds CHC on the sheet
   *  (`CStatValue.SetFinalValue`, [0, 1000] raw): the sheet, the stat
   *  filters and every rating read this one. */
  critRate: number;
  /** Crit chance BEFORE that bound — for the reads that measure the overflow:
   *  the solver's crit-cap gem reallocation (`CRC_OVERSHOOT_CEIL`) and the
   *  "wasted over the cap" advice. Always set by the composer; optional so a
   *  hand-built sheet reads `critRate` instead. */
  critRateUncapped?: number;
  critDmg: number; eff: number; effRes: number;
  dmgUp: number; dmgReduce: number; pen: number;
  /** Critical Damage Reduction — gear-only (no character baseline). Summed
   *  from `critDmgReduce` substats / mains, displayed as a percent. */
  critDmgReduce: number;
}

/** The sheet's stat keys — every `FinalStats` field but the raw CHC overflow
 *  (`critRateUncapped`), which nothing displays or locks. */
export type SheetStatKey = Exclude<keyof FinalStats, "critRateUncapped">;

export type ScalingAxis = "atk" | "def" | "hp" | "eff" | "res";
/** The composer's `scaling`. `spd` (speed before its buff rate + the rate) is
 *  what `composeCharStats` always emits; it is optional only so a hand-built
 *  map (tests) can leave it out — speed then reads `baseline.spd`, rate 0. */
export type ScalingMap = Record<ScalingAxis, StatScaling> & { spd?: SpeedScaling };

/** Minimal subset of NoGearStats needed by `computeFinalStats`. Re-typed
 *  here to keep this lib decoupled from the composer's heavier
 *  `NoGearStats` interface (only the additive baselines matter for the
 *  non-compound stats — SPD/CHC/CHD/PEN/DmgInc/DmgRed). */
export interface FinalStatsBaseline {
  /** Read only when `scaling.spd` is absent. The composer's `noGearStats.spd`
   *  already carries the speed buff rate, so the gear side takes the speed
   *  before that rate from `scaling.spd` and applies the rate once, on the
   *  total that includes gear. */
  spd: number;
  chc: number;
  chd: number;
  pen: number;
  dmgInc: number;
  dmgRed: number;
}

/** Round to 1 decimal place — the display granularity for percent stats
 *  (CHC/CHD/DMG±/…). Shared with BuildsScreen's drift comparison. */
export const round1 = (x: number) => Math.round(x * 10) / 10;

/** Plug gear flat + gear % (and the gear's buff rate / flat buff) into the
 *  in-game CalcFinalStat formula — core's `calcFinalStat`, the single copy. */
export function composeMultStat(sc: StatScaling, gearFlat: number, gearPct: number, gearBuffPct: number, gearBuffFlat = 0): number {
  return calcFinalStat(
    sc.baseValue, sc.evoValue, sc.awakValue,
    sc.awakPct * 10, sc.transcendPct * 10,
    gearFlat, gearPct * 10,
    sc.codexPct * 10,
    (sc.buffPct + gearBuffPct) * 10,
    sc.buffValue + gearBuffFlat,
  );
}

/** Sheet axes composed through `composeMultStat`, with their `ScalingMap` axis. */
const MULT_AXIS: Record<string, ScalingAxis> = { atk: "atk", def: "def", hp: "hp", eff: "eff", effRes: "res" };

/** Estimated gain of ONE roll (a gem) on the sheet axis `axis`, in `FinalStats`
 *  units. On the compound axes it is `composeMultStat` with the roll alone
 *  minus without it — base × value / 100 × the buff amplifier for a %, the
 *  flat × the amplifier for a flat: the gear's own rates add to the same
 *  bundle, so it holds on any build up to the truncations and the gear's
 *  buff-routed rates. Every other axis is additive: the value itself. */
export function rollGainOnSheet(scaling: ScalingMap, axis: string, value: number, percent: boolean): number {
  const m = MULT_AXIS[axis];
  if (!m) return value;
  const sc = scaling[m];
  return composeMultStat(sc, percent ? 0 : value, percent ? value : 0, 0) - composeMultStat(sc, 0, 0, 0);
}

/** Aggregate active 2pc / 4pc armor-set bonuses into one list of stat options.
 *  The rows come from `wornSetRows` (core `set-level.ts`: per-piece level,
 *  min of the 2 / 4 best pieces, `ignoreLowSet`). Combat-only sets
 *  (Counterattack, Lifesteal, Bursting, …) carry their effects as buffs and
 *  are stored as `ST_NONE` / null rows that get skipped here. */
export function computeSetBonuses(
  pieces: GearPiece[],
  sets: GameData["sets"] | null,
): Array<{ st: string; ap: string; v: number }> {
  const out: Array<{ st: string; ap: string; v: number }> = [];
  forEachWornSet(pieces, sets, (row2, row4, drop2) => {
    const p2 = drop2 ? null : row2?.p2;
    const p4 = row4?.p4;
    if (p2 && p2.st !== "ST_NONE" && p2.v != null) out.push({ st: p2.st, ap: p2.ap, v: p2.v });
    if (p4 && p4.st !== "ST_NONE" && p4.v != null) out.push({ st: p4.st, ap: p4.ap, v: p4.v });
  });
  return out;
}

/** Visit each armor set worn ≥ 2× in `pieces` with its rows (`wornSetRows`),
 *  in first-seen order — the one grouping `computeSetBonuses` and
 *  `lostHpSetBuffs` share. */
function forEachWornSet(
  pieces: GearPiece[],
  sets: GameData["sets"] | null,
  visit: (row2: SetLevel | null, row4: SetLevel | null, drop2: boolean) => void,
): void {
  if (!sets) return;
  const bts = new Map<string, number[]>();
  for (const p of pieces) {
    // `p?.` tolerates a sparse `pieces` array — the solver hoists this call
    // out of its talisman loop, where the talisman slot may not be filled yet.
    if (!p?.armorSetId) continue;
    const arr = bts.get(p.armorSetId);
    if (arr) arr.push(p.breakthrough); else bts.set(p.armorSetId, [p.breakthrough]);
  }
  for (const [setId, list] of bts) {
    if (list.length < 2) continue;
    const def = sets[setId];
    if (!def) continue;
    const { row2, row4, drop2 } = wornSetRows(def, list);
    visit(row2, row4, drop2);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Lost-HP sets — Revenge (ATK), Patience (DEF), Swiftness (SPD)
 *
 * Their tier is a combat effect (`combatEffects`), a `BT_STAT` buff whose
 * value scales with the wearer's missing HP (client `CBuff.OnCreate`, then
 * `CCharacterBattle.GetLostHPRateValue`): level 1 (`BT_STAT_OWNER_LOST_HP_RATE`)
 * `trunc((MaxHP − HP) × v / MaxHP)` ‰, level 2 (`…_HALF`) the same formula on
 * `clamp(2·HP − MaxHP, 0, MaxHP)` — its maximum reached at 50 % HP. The sheet
 * never counts them on its own (no HP model); « Simulate 50% HP » (Settings ›
 * Solver) has the Optimizer and Teams count them at that fraction. An
 * `OAT_RATE` `BT_STAT` lands in CalcFinalStat's `BuffValueRate`, so ATK / DEF go
 * to the buff-rate buckets and SPD to the speed buff rate (`spdRate`, applied
 * once on the total) — never the gear's own rates. The CP never counts them.
 * ───────────────────────────────────────────────────────────────────────── */

/** HP fraction the lost-HP sets are counted at; null = not counted (the
 *  setting off, and every sheet outside the Optimizer and Teams). */
export type LostHpFraction = number | null;

/** The fraction « Simulate 50% HP » counts them at. */
export const SIMULATED_HP_FRACTION = 0.5;

const LOST_HP_RATE = "BT_STAT_OWNER_LOST_HP_RATE";
const LOST_HP_RATE_HALF = "BT_STAT_OWNER_LOST_HP_RATE_HALF";

/** A combat effect that scales with the wearer's missing HP. */
export function isLostHpEffect(e: Pick<SetCombatEffect, "type">): boolean {
  return e.type === LOST_HP_RATE || e.type === LOST_HP_RATE_HALF;
}

/** Value (raw ‰) of a lost-HP effect of type `type` and maximum `v` ‰ with the
 *  wearer at `hpFraction` of their max HP — the client's integer formula on a
 *  1000-HP scale (the fraction rounded to ‰, held in [0, 1]); null for a type
 *  that isn't one. Level 1 at 50 % → `v / 2`, `_HALF` at 50 % → `v`, full HP → 0. */
export function lostHpRateValue(type: string, v: number, hpFraction: number): number | null {
  if (type !== LOST_HP_RATE && type !== LOST_HP_RATE_HALF) return null;
  const hp = Math.min(1000, Math.max(0, Math.round(hpFraction * 1000)));
  const n = type === LOST_HP_RATE_HALF ? Math.min(1000, Math.max(0, 2 * hp - 1000)) : hp;
  return Math.trunc((1000 - n) * v / 1000);
}

/** The value a lost-HP effect counts at `hpFraction`, as a buff routed like a
 *  buff main (`forEachMainAdd`: `fromBuff` rate → the buff-rate bucket, SPD →
 *  `spdRate`); null when it isn't a lost-HP `OAT_RATE` stat on the wearer or
 *  counts 0. */
export function lostHpEffectBuff(e: SetCombatEffect, hpFraction: number): TeamBuff | null {
  if (!isLostHpEffect(e) || e.target !== "ME" || e.ap !== "OAT_RATE" || e.v == null || !e.st) return null;
  const stat = setBonusStatKey(e.st, true) as TeamBuff["stat"] | null;
  const v = lostHpRateValue(e.type, e.v, hpFraction);
  if (!stat || !v) return null;
  return { stat, value: v / 10, percent: true, fromBuff: true };
}

/** The lost-HP effects of the sets worn in `pieces` (the tiers
 *  `computeSetBonuses` reads: `wornSetRows`, a 2-pc dropped by `ignoreLowSet`
 *  left out) at `hpFraction`, as buffs (`lostHpEffectBuff`). */
export function lostHpSetBuffs(pieces: GearPiece[], sets: GameData["sets"] | null, hpFraction: number): TeamBuff[] {
  const out: TeamBuff[] = [];
  forEachWornSet(pieces, sets, (row2, row4, drop2) => {
    const effects = [...(drop2 ? [] : row2?.combatEffects?.p2 ?? []), ...(row4?.combatEffects?.p4 ?? [])];
    for (const e of effects) {
      const b = lostHpEffectBuff(e, hpFraction);
      if (b) out.push(b);
    }
  });
  return out;
}

/** The lost-HP buffs' additions (`lostHpSetBuffs`). */
export function lostHpBucketAdds(pieces: GearPiece[], sets: GameData["sets"] | null, hpFraction: number): BucketAdds {
  return collectAdds((add) => { for (const s of lostHpSetBuffs(pieces, sets, hpFraction)) forEachMainAdd(s, add); });
}

/** Stat keys that the engine renders as a percent — gear contributions on
 *  these axes are scaled to display units (e.g. /10 from per-mille). */
export const PERCENT_STATS = new Set(["critRate", "critDmg", "critDmgReduce", "dmgUp", "dmgReduce", "pen"]);

/** Pre-aggregated gem contribution override for the solver hot path.
 *  Presence = "skip the gem-bearing slots' subs (Talisman + EE) and use
 *  these deltas instead". The solver pre-computes this once per
 *  talismanSlots variant (4 or 5) in `prepareContext`, avoiding O(combos
 *  × gems) `resolveStat` calls inside the inner loop.
 *
 *  When `gemOverride` is absent, Talisman/EE pieces contribute through
 *  their own `subs` (the parser stores socketed gems there), so BuildsScreen
 *  and any non-solver consumer see "what's actually equipped". */
export interface GemOverride {
  flat: Record<string, number>;
  pct: Record<string, number>;
}

/** Result of `computeSetBonuses` — the active 2pc/4pc bonus stat options. */
export type SetBonusList = ReadonlyArray<{ st: string; ap: string; v: number }>;

/** The four stat buckets fed to the in-game CalcFinalStat split: the gear's
 *  own flats and rates, then its buff-routed (`fromBuff`) rates and flats —
 *  `BuffValueRate` and `BuffValue` of CalcFinalStat. */
export interface GearBuckets {
  flat: Record<string, number>;
  pct: Record<string, number>;
  buffPct: Record<string, number>;
  buffFlat: Record<string, number>;
}

/** Bucket categories, in `GearBuckets` field order — the first argument of a
 *  `BucketAdd`. */
const CAT_FLAT = 0;
const CAT_PCT = 1;
const CAT_BUFF_PCT = 2;
const CAT_BUFF_FLAT = 3;

/** One addition into a bucket: category, engine stat key, value. The record
 *  buckets (`GearBuckets`) and the solver's typed ones (`BucketArray`) both
 *  apply the sequence the visitors below emit, so they sum the same values in
 *  the same order. */
type BucketAdd = (cat: number, key: string, value: number) => void;

/** Emit one piece's mains + subs as bucket additions, in fold order. Shared by
 *  the full-array aggregation, the solver's incremental path and its typed
 *  pre-resolution so all apply the exact same per-piece logic (and thus the
 *  same float summation when fed the same piece order). `gemOverrideActive`
 *  skips a gem-slot piece's subs (its socketed gems are replaced by the
 *  override delta). */
/** Emit one main stat as its bucket addition. */
function forEachMainAdd(s: TeamBuff, add: BucketAdd): void {
  // A buff-routed SPEED RATE (Phantasm Necrosis' −30 %) gets its own key,
  // the speed buff rate, applied once on the total (`finalStatsFromBuckets`).
  // A buff-routed FLAT (EE mains `ST_SPEED OAT_ADD`, an ATK / EFF OAT_ADD
  // buff) goes to `buffFlat` — CalcFinalStat's `BuffValue`, never a rate.
  const key = s.fromBuff && s.percent && s.stat === "spd" ? "spdRate" : s.stat;
  add(s.fromBuff ? (s.percent ? CAT_BUFF_PCT : CAT_BUFF_FLAT) : (s.percent ? CAT_PCT : CAT_FLAT), key, s.value);
}

function forEachPieceAdd(p: GearPiece, gemOverrideActive: boolean, add: BucketAdd): void {
  for (const s of p.main) {
    if (s.combatOnly) continue;
    forEachMainAdd(s, add);
  }
  const isGemSlot = p.slot === "ooparts" || p.slot === "exclusive";
  if (!(isGemSlot && gemOverrideActive)) {
    for (const s of p.subs) add(s.percent ? CAT_PCT : CAT_FLAT, s.stat, s.value);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Team buffs — the Talisman mains of a team's other members
 *
 * A Talisman's main stat is a `BT_STAT_PREMIUM` buff with `TargetType`
 * `MY_TEAM`: in a fight it applies to every member. It doesn't stack: each
 * main stat has its own `PriorityGroup` (1 ATK% … 9 RES, used by no other
 * buff) and `CBuff` keeps, per group, the buff of the highest `PriorityLevel`
 * (an equal one doesn't replace it) — a level that rises with the value
 * (4★ 1, 5★ 2, 6★ +0..+10 3..13), so the strongest Talisman of the team
 * applies. A member's sheet in team context therefore takes, per stat,
 * max(the other members' best, its own Talisman's): the team buffs top up
 * what its own Talisman brings, in CalcFinalStat's buff buckets (`BuffValue` /
 * `BuffValueRate`, where its own Talisman main lands too).
 * ───────────────────────────────────────────────────────────────────────── */

/** A Talisman main stat another member of the team brings (`teamTalismanBuffs`
 *  in `lib/teams/teams.ts`), as the parser resolved it at that Talisman's
 *  enhance level. */
export type TeamBuff = Pick<RolledStat, "stat" | "value" | "percent" | "fromBuff">;

/** What the team buffs add on top of the member's own Talisman (`talisman`,
 *  null without one): per buff, its value minus the own Talisman's main on the
 *  same stat key when that leaves something (`max(team, own)` on the sheet),
 *  nothing otherwise. */
export function teamBuffTopUp(buffs: readonly TeamBuff[], talisman: Pick<GearPiece, "main"> | null): TeamBuff[] {
  const out: TeamBuff[] = [];
  for (const b of buffs) {
    let own = 0;
    for (const m of talisman?.main ?? []) {
      if (!m.combatOnly && (m.source ?? "option") === "option" && m.stat === b.stat) own = Math.max(own, m.value);
    }
    if (b.value > own) out.push({ ...b, value: b.value - own });
  }
  return out;
}

/** The team buffs' additions over Talisman `talisman` (`teamBuffTopUp`). */
export function teamBuffBucketAdds(buffs: readonly TeamBuff[], talisman: Pick<GearPiece, "main"> | null): BucketAdds {
  return collectAdds((add) => { for (const s of teamBuffTopUp(buffs, talisman)) forEachMainAdd(s, add); });
}

/** `computeFinalStats` of `pieces` in team context: plus the team buffs over
 *  the pieces' Talisman (`teamBuffTopUp`), then, with `lostHpFraction`, the
 *  lost-HP sets at that HP fraction (`lostHpSetBuffs`) — the additions and
 *  order of the solver's combo sheet. The Optimizer's Current column. Without
 *  either, `computeFinalStats` itself. */
export function computeFinalStatsInTeam(
  baseline: FinalStatsBaseline,
  scaling: ScalingMap,
  pieces: GearPiece[],
  game: GameData | null,
  buffs: readonly TeamBuff[],
  lostHpFraction: LostHpFraction = null,
): FinalStats {
  if (buffs.length === 0 && lostHpFraction == null) return computeFinalStats(baseline, scaling, pieces, game);
  const b = aggregateGearBuckets(pieces, game);
  const add = recordAdd(b);
  for (const s of teamBuffTopUp(buffs, pieces.find((p) => p.slot === "ooparts") ?? null)) forEachMainAdd(s, add);
  if (lostHpFraction != null) for (const s of lostHpSetBuffs(pieces, game?.sets ?? null, lostHpFraction)) forEachMainAdd(s, add);
  return finalStatsFromBuckets(baseline, scaling, b);
}

/** Emit the pre-aggregated gem override delta as bucket additions. */
function forEachGemOverrideAdd(gemOverride: GemOverride, add: BucketAdd): void {
  for (const k in gemOverride.flat) add(CAT_FLAT, k, gemOverride.flat[k] ?? 0);
  for (const k in gemOverride.pct) add(CAT_PCT, k, gemOverride.pct[k] ?? 0);
}

/** Emit the active set bonuses as bucket additions. */
function forEachSetBonusAdd(setBonuses: SetBonusList, add: BucketAdd): void {
  for (const sb of setBonuses) {
    const isRate = sb.ap === "OAT_RATE";
    const statKey = setBonusStatKey(sb.st, isRate);
    if (!statKey) continue;
    const pctLike = isRate || PERCENT_STATS.has(statKey);
    add(pctLike ? CAT_PCT : CAT_FLAT, statKey, pctLike ? sb.v / 10 : sb.v);
  }
}

/** The `BucketAdd` that folds into record buckets, IN PLACE. */
function recordAdd(b: GearBuckets): BucketAdd {
  const recs = [b.flat, b.pct, b.buffPct, b.buffFlat];
  return (cat, key, value) => {
    const target = recs[cat]!;
    target[key] = (target[key] ?? 0) + value;
  };
}

/** Fold one piece's mains + subs into the buckets, IN PLACE. */
function addPieceToBuckets(p: GearPiece, b: GearBuckets, gemOverrideActive: boolean): void {
  forEachPieceAdd(p, gemOverrideActive, recordAdd(b));
}

/** Add the pre-aggregated gem override delta to the buckets, IN PLACE. */
function addGemOverride(gemOverride: GemOverride, b: GearBuckets): void {
  forEachGemOverrideAdd(gemOverride, recordAdd(b));
}

/** Add the active set bonuses to the buckets, IN PLACE. */
function addSetBonuses(setBonuses: SetBonusList, b: GearBuckets): void {
  forEachSetBonusAdd(setBonuses, recordAdd(b));
}

/** Aggregate gear pieces (mains, subs, set bonuses) into flat/pct/buffPct/buffFlat
 *  buckets keyed by engine stat key. The split mirrors the in-game
 *  CalcFinalStat input separation.
 *
 *  Talisman/EE handling: the in-game SubOptionList for these slots IS the
 *  gem slot list (5 OAT_RATE/OAT_ADD entries via OptionIDs 15001-15054).
 *  The parser puts those into `piece.subs` at their fixed gem value (the
 *  line's `Level` ignored — `parseGearPiece`), so without any override the
 *  current gems contribute to the buckets automatically, exactly as the gem
 *  pool values them.
 *  When `gemOverride` is supplied, Talisman/EE subs are SKIPPED and the
 *  pre-aggregated deltas are added in their place. */
export function aggregateGearBuckets(
  pieces: GearPiece[],
  game: GameData | null,
  gemOverride?: GemOverride,
  /** Pre-computed set bonuses (`computeSetBonuses` output) to skip the
   *  per-call recompute. Set bonuses depend only on the armor pieces'
   *  `armorSetId`, so the solver hoists this out of its talisman loop (the
   *  talisman never carries a set). Omitted → computed internally, identical
   *  result (the BuildsScreen / non-solver path stays unchanged). */
  precomputedSetBonuses?: SetBonusList,
): GearBuckets {
  const b: GearBuckets = { flat: {}, pct: {}, buffPct: {}, buffFlat: {} };
  // Skip current-gems-as-subs on Talisman/EE when an override is supplied; the
  // override's deltas land after the per-piece loop. Non-override paths read
  // `p.subs` normally (parser pushes socketed gems into `subs`).
  for (const p of pieces) addPieceToBuckets(p, b, !!gemOverride);
  if (gemOverride) addGemOverride(gemOverride, b);
  addSetBonuses(precomputedSetBonuses ?? computeSetBonuses(pieces, game?.sets ?? null), b);
  return b;
}

/** Aggregate ONLY the invariant prefix pieces (weapon..accessory — everything
 *  the solver's talisman loop holds fixed). These are never gem slots, so no
 *  override handling is needed. Summed once per accessory iteration; the
 *  talisman loop clones the result and tops up with the talisman + EE.
 *
 *  Returned buckets are owned by the caller — `computeFinalStatsFromPrefix`
 *  clones them per combo so this prefix can be reused across the talisman loop. */
export function aggregatePrefixBuckets(prefix: GearPiece[]): GearBuckets {
  const b: GearBuckets = { flat: {}, pct: {}, buffPct: {}, buffFlat: {} };
  for (const p of prefix) addPieceToBuckets(p, b, false);
  return b;
}

const SET_BONUS_KEY_RATE: Record<string, string> = {
  ST_ATK: "atkPct", ST_DEF: "defPct", ST_HP: "hpPct",
  ST_SPEED: "spd", ST_CRITICAL_RATE: "critRate", ST_CRITICAL_DMG_RATE: "critDmg",
  ST_DMG_BOOST: "dmgUp", ST_DMG_REDUCE_RATE: "dmgReduce",
  ST_BUFF_CHANCE: "eff", ST_BUFF_RESIST: "effRes", ST_PIERCE_POWER_RATE: "pen",
  ST_E_CRI_DMG_REDUCE: "critDmgReduce",
};
const SET_BONUS_KEY_ADD: Record<string, string> = {
  ST_ATK: "atk", ST_DEF: "def", ST_HP: "hp",
  ST_SPEED: "spd", ST_CRITICAL_RATE: "critRate", ST_CRITICAL_DMG_RATE: "critDmg",
  ST_DMG_BOOST: "dmgUp", ST_DMG_REDUCE_RATE: "dmgReduce",
  ST_BUFF_CHANCE: "eff", ST_BUFF_RESIST: "effRes", ST_PIERCE_POWER_RATE: "pen",
  ST_E_CRI_DMG_REDUCE: "critDmgReduce",
};
export function setBonusStatKey(st: string, isRate: boolean): string | null {
  return (isRate ? SET_BONUS_KEY_RATE : SET_BONUS_KEY_ADD)[st] ?? null;
}

/** Compose the full stat sheet for a hero with their equipped gear. The
 *  `baseline` should be the composer's `noGearStats` (additive baseline);
 *  `scaling` carries the per-axis CalcFinalStat ingredients for ATK/DEF/HP
 *  and EFF/RES, and the speed before its buff rate (`scaling.spd`).
 *
 *  `gemOverride` (optional) tells `aggregateGearBuckets` to use a custom
 *  gem allocation on Talisman/EE pieces instead of their currently
 *  socketed gems — the solver's per-build hot path. */
export function computeFinalStats(
  baseline: FinalStatsBaseline,
  scaling: ScalingMap,
  pieces: GearPiece[],
  game: GameData | null,
  gemOverride?: GemOverride,
  /** Hoisted set-bonus list (see `aggregateGearBuckets`) — the solver passes
   *  it so the per-talisman compose doesn't rebuild it. */
  precomputedSetBonuses?: SetBonusList,
): FinalStats {
  return finalStatsFromBuckets(baseline, scaling, aggregateGearBuckets(pieces, game, gemOverride, precomputedSetBonuses));
}

/** `computeFinalStats` of `pieces` plus ONE extra roll, routed like a substat
 *  (percent → the % bucket, else flat). The reforge projection probes the CP
 *  of one more tick of each sub with it (`reforgeTickWeights`). */
export function computeFinalStatsPlusRoll(
  baseline: FinalStatsBaseline,
  scaling: ScalingMap,
  pieces: GearPiece[],
  game: GameData | null,
  roll: { stat: string; value: number; percent: boolean },
): FinalStats {
  const b = aggregateGearBuckets(pieces, game);
  const target = roll.percent ? b.pct : b.flat;
  target[roll.stat] = (target[roll.stat] ?? 0) + roll.value;
  return finalStatsFromBuckets(baseline, scaling, b);
}

/** Solver hot-path variant of `computeFinalStats`. Instead of re-summing all
 *  6 (+EE) invariant pieces on every talisman, it starts from a `prefix`
 *  (weapon..accessory, aggregated once per accessory iteration via
 *  `aggregatePrefixBuckets`), clones it, and tops up with only the varying
 *  talisman + the EE + gem override + set bonuses.
 *
 *  Order is preserved EXACTLY vs the full-array path: the prefix folds pieces
 *  0..5, then this adds talisman (index 6), then EE (index 7), then the gem
 *  override, then the set bonuses — the same sequence `computeFinalStats` walks
 *  for the `[weapon,helmet,armor,gloves,boots,accessory,talisman,ee]` array.
 *  Because float addition is left-associative and the cloned prefix is the same
 *  running partial sum, the result is BIT-IDENTICAL (the in-game `Math.trunc`
 *  is unforgiving of ULP drift, so this is load-bearing — see the equivalence
 *  test). `setBonuses` is required here (the solver always hoists it).
 *
 *  The EE is re-folded per talisman rather than baked into the prefix because
 *  it sits AFTER the talisman in slot order — pre-summing it would reorder the
 *  additions and break bit-identity. It's a single cheap piece. */
export function computeFinalStatsFromPrefix(
  baseline: FinalStatsBaseline,
  scaling: ScalingMap,
  prefix: GearBuckets,
  talisman: GearPiece | null,
  ee: GearPiece | null,
  gemOverride: GemOverride | undefined,
  setBonuses: SetBonusList,
): FinalStats {
  const b: GearBuckets = { flat: { ...prefix.flat }, pct: { ...prefix.pct }, buffPct: { ...prefix.buffPct }, buffFlat: { ...prefix.buffFlat } };
  if (talisman) addPieceToBuckets(talisman, b, !!gemOverride);
  if (ee) addPieceToBuckets(ee, b, !!gemOverride);
  if (gemOverride) addGemOverride(gemOverride, b);
  addSetBonuses(setBonuses, b);
  return finalStatsFromBuckets(baseline, scaling, b);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Typed buckets — the solver hot path's form of `GearBuckets`
 *
 * One `Float64Array` holds the four buckets at fixed indices (category × stat),
 * so a clone is a `.set`, an absent stat reads 0 instead of `?? 0` on a missing
 * key, and the objects never change shape. Every contribution (a piece, a gem
 * delta, the set bonuses) is resolved ONCE into (index, value) pairs
 * (`BucketAdds`) by the same visitors the record path folds, so the additions
 * land in the same order on the same running sums: the sheet is bit-identical
 * to `computeFinalStatsFromPrefix` (the in-game `Math.trunc` is unforgiving of
 * ULP drift — see the equivalence test). Only the stats `finalStatsFromBuckets`
 * reads have a slot; any other key is dropped, it never reaches the sheet.
 * ───────────────────────────────────────────────────────────────────────── */

/** The stat keys with a slot in each category of a `BucketArray`. */
const BUCKET_STATS = [
  "atk", "def", "hp", "spd", "critRate", "critDmg", "eff", "effRes",
  "dmgUp", "dmgReduce", "pen", "critDmgReduce", "atkPct", "defPct", "hpPct", "spdRate",
] as const;
const NS = BUCKET_STATS.length;
const STAT_SLOT = new Map<string, number>(BUCKET_STATS.map((k, i) => [k, i]));
const slot = (cat: number, key: (typeof BUCKET_STATS)[number]): number => cat * NS + STAT_SLOT.get(key)!;

/** Length of a `BucketArray` (4 categories × `BUCKET_STATS`). */
export const BUCKET_ARRAY_LENGTH = 4 * NS;

/** The four `GearBuckets` in one typed array, at fixed indices. */
export type BucketArray = Float64Array;

/** A contribution resolved once into the bucket additions it makes, in fold
 *  order: `arr[idx[i]] += val[i]`. */
export interface BucketAdds {
  readonly idx: Int32Array;
  readonly val: Float64Array;
}

function collectAdds(visit: (add: BucketAdd) => void): BucketAdds {
  const idx: number[] = [];
  const val: number[] = [];
  visit((cat, key, value) => {
    const s = STAT_SLOT.get(key);
    if (s === undefined) return;
    idx.push(cat * NS + s);
    val.push(value);
  });
  return { idx: Int32Array.from(idx), val: Float64Array.from(val) };
}

/** One piece's additions (see `forEachPieceAdd`). */
export function pieceBucketAdds(p: GearPiece, gemOverrideActive: boolean): BucketAdds {
  return collectAdds((add) => forEachPieceAdd(p, gemOverrideActive, add));
}

/** A gem override delta's additions. */
export function gemOverrideBucketAdds(gemOverride: GemOverride): BucketAdds {
  return collectAdds((add) => forEachGemOverrideAdd(gemOverride, add));
}

/** The active set bonuses' additions (`computeSetBonuses` output). */
export function setBonusBucketAdds(setBonuses: SetBonusList): BucketAdds {
  return collectAdds((add) => forEachSetBonusAdd(setBonuses, add));
}

/** Apply `adds` to `arr`, IN PLACE, in their order. */
export function applyBucketAdds(arr: BucketArray, adds: BucketAdds): void {
  const { idx, val } = adds;
  for (let i = 0; i < idx.length; i++) arr[idx[i]!]! += val[i]!;
}

/** The typed form of record buckets (a missing key reads 0, as `?? 0` does). */
export function bucketArrayOf(b: GearBuckets): BucketArray {
  const arr = new Float64Array(BUCKET_ARRAY_LENGTH);
  const recs = [b.flat, b.pct, b.buffPct, b.buffFlat];
  for (let c = 0; c < 4; c++) {
    const rec = recs[c]!;
    for (let i = 0; i < NS; i++) arr[c * NS + i] = rec[BUCKET_STATS[i]!] ?? 0;
  }
  return arr;
}

const F_ATK = slot(CAT_FLAT, "atk"), F_DEF = slot(CAT_FLAT, "def"), F_HP = slot(CAT_FLAT, "hp"), F_SPD = slot(CAT_FLAT, "spd");
const F_EFF = slot(CAT_FLAT, "eff"), F_RES = slot(CAT_FLAT, "effRes"), F_DMGUP = slot(CAT_FLAT, "dmgUp");
const F_DMGRED = slot(CAT_FLAT, "dmgReduce"), F_PEN = slot(CAT_FLAT, "pen"), F_CDR = slot(CAT_FLAT, "critDmgReduce");
const P_ATK = slot(CAT_PCT, "atkPct"), P_DEF = slot(CAT_PCT, "defPct"), P_HP = slot(CAT_PCT, "hpPct"), P_SPD = slot(CAT_PCT, "spd");
const P_CHC = slot(CAT_PCT, "critRate"), P_CHD = slot(CAT_PCT, "critDmg"), P_EFF = slot(CAT_PCT, "eff"), P_RES = slot(CAT_PCT, "effRes");
const P_DMGUP = slot(CAT_PCT, "dmgUp"), P_DMGRED = slot(CAT_PCT, "dmgReduce"), P_PEN = slot(CAT_PCT, "pen"), P_CDR = slot(CAT_PCT, "critDmgReduce");
const BP_ATK = slot(CAT_BUFF_PCT, "atkPct"), BP_DEF = slot(CAT_BUFF_PCT, "defPct"), BP_HP = slot(CAT_BUFF_PCT, "hpPct");
const BP_SPDRATE = slot(CAT_BUFF_PCT, "spdRate"), BP_CHC = slot(CAT_BUFF_PCT, "critRate"), BP_CHD = slot(CAT_BUFF_PCT, "critDmg");
const BP_EFF = slot(CAT_BUFF_PCT, "eff"), BP_RES = slot(CAT_BUFF_PCT, "effRes"), BP_DMGUP = slot(CAT_BUFF_PCT, "dmgUp");
const BP_DMGRED = slot(CAT_BUFF_PCT, "dmgReduce"), BP_PEN = slot(CAT_BUFF_PCT, "pen"), BP_CDR = slot(CAT_BUFF_PCT, "critDmgReduce");
const BF_ATK = slot(CAT_BUFF_FLAT, "atk"), BF_DEF = slot(CAT_BUFF_FLAT, "def"), BF_HP = slot(CAT_BUFF_FLAT, "hp");
const BF_SPD = slot(CAT_BUFF_FLAT, "spd"), BF_EFF = slot(CAT_BUFF_FLAT, "eff"), BF_RES = slot(CAT_BUFF_FLAT, "effRes");

/** The sheet's CHC before its [0, 100] bound (`FinalStats.critRateUncapped`)
 *  — additive, so the solver reads it on the buckets without composing the
 *  whole sheet. The one expression `finalStatsFromBucketArray` uses too. */
export function critRateUncappedOf(baseline: FinalStatsBaseline, b: BucketArray): number {
  return round1(baseline.chc + b[P_CHC]! + b[BP_CHC]!);
}

/** Plug the aggregated gear buckets into the per-axis CalcFinalStat formula.
 *  Shared by both the full-array and incremental compose paths so the final
 *  arithmetic is defined once (`finalStatsFromBucketArray`). */
function finalStatsFromBuckets(baseline: FinalStatsBaseline, scaling: ScalingMap, b: GearBuckets): FinalStats {
  return finalStatsFromBucketArray(baseline, scaling, bucketArrayOf(b));
}

/** `finalStatsFromBuckets` on typed buckets — the formula itself. */
export function finalStatsFromBucketArray(baseline: FinalStatsBaseline, scaling: ScalingMap, b: BucketArray): FinalStats {
  // Speed: the no-gear speed before its buff rate, plus gear, then the rate
  // ONCE on that total (`applySpdRate`, same rule as the no-gear composer).
  // The rate is the hero's (`scaling.spd.buffPct`, core passive) plus the
  // gear's (`buffPct.spdRate`, unique passives), summed before the truncation.
  // The gear's own speed rate (Speed set) multiplies `rateBase` only — base +
  // evo + IOT_STAT geas, the client's sum_flat — not the OAT_ADD buffs
  // (Skill_8 +10 SPD) that `value` also carries.
  const spdBase = scaling.spd?.value ?? baseline.spd;
  const spdRateBase = scaling.spd?.rateBase ?? spdBase;
  const spdTotal = spdBase + b[F_SPD]! + b[BF_SPD]! + Math.floor(spdRateBase * b[P_SPD]! / 100);
  // CHC bounded to [0, 100] like the client's sheet; the raw sum rides along.
  const critRateUncapped = critRateUncappedOf(baseline, b);
  return {
    atk: composeMultStat(scaling.atk, b[F_ATK]!, b[P_ATK]!, b[BP_ATK]!, b[BF_ATK]!),
    def: composeMultStat(scaling.def, b[F_DEF]!, b[P_DEF]!, b[BP_DEF]!, b[BF_DEF]!),
    hp:  composeMultStat(scaling.hp,  b[F_HP]!,  b[P_HP]!,  b[BP_HP]!,  b[BF_HP]!),
    spd: applySpdRate(spdTotal, (scaling.spd?.buffPct ?? 0) + b[BP_SPDRATE]!),
    critRate: Math.min(100, Math.max(0, critRateUncapped)),
    critRateUncapped,
    critDmg:  round1(baseline.chd + b[P_CHD]! + b[BP_CHD]!),
    eff: composeMultStat(scaling.eff, b[F_EFF]!, b[P_EFF]!, b[BP_EFF]!, b[BF_EFF]!),
    effRes: composeMultStat(scaling.res, b[F_RES]!, b[P_RES]!, b[BP_RES]!, b[BF_RES]!),
    dmgUp: round1(baseline.dmgInc + b[P_DMGUP]! + b[F_DMGUP]! + b[BP_DMGUP]!),
    dmgReduce: round1(baseline.dmgRed + b[P_DMGRED]! + b[F_DMGRED]! + b[BP_DMGRED]!),
    pen:    round1(baseline.pen    + b[P_PEN]! + b[F_PEN]! + b[BP_PEN]!),
    critDmgReduce: round1(b[P_CDR]! + b[F_CDR]! + b[BP_CDR]!),
  };
}
