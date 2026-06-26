/**
 * Shared stat-composition pipeline. Extracted from BuildsScreen so the
 * Builder screen (and any future consumer — solver, gear card hovers, …)
 * can compute a hero's gear-included stats without duplicating logic.
 *
 * Mirror of the in-game CFormula::CalcFinalStat from libil2cpp.so 1.4.9
 * (RVA 0x2C59E48). Validated 0-diff on a fleet of LB0/1/2/3 chars; see
 * `memory/game_stat_compose_formula.md` for the derivation.
 *
 * NOTE: keep this file pure — no React, no IO. The screens own the React
 * state + memoization; this lib is the deterministic engine.
 */
import type { GameData, GearPiece, StatScaling } from "@gear-solver/core";

export interface FinalStats {
  atk: number; hp: number; def: number; spd: number;
  crc: number; chd: number; eff: number; res: number;
  dmgUp: number; dmgRed: number; pen: number;
  /** Critical Damage Reduction — gear-only (no character baseline). Summed
   *  from `critDmgReduce` substats / mains, displayed as a percent. */
  critDmgRed: number;
}

export type ScalingAxis = "atk" | "def" | "hp" | "eff" | "res";
export type ScalingMap = Record<ScalingAxis, StatScaling>;

/** Minimal subset of NoGearStats needed by `computeFinalStats`. Re-typed
 *  here to keep this lib decoupled from the composer's heavier
 *  `NoGearStats` interface (only the additive baselines matter for the
 *  non-compound stats — SPD/CHC/CHD/PEN/DmgInc/DmgRed). */
export interface FinalStatsBaseline {
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

/** Plug gear flat + gear % into the in-game CalcFinalStat formula. */
export function composeMultStat(sc: StatScaling, gearFlat: number, gearPct: number, gearBuffPct: number): number {
  const sumFlat = sc.baseValue + sc.evoValue + sc.awakValue;
  const sumRate = sc.awakPct * 10 + sc.transcendPct * 10 + gearPct * 10;
  const part1 = Math.trunc(sumFlat * (1000 + sumRate) / 1000);
  const combined = part1 + gearFlat + sc.buffValue;
  const part2 = Math.trunc(combined * (1000 + (sc.buffPct + gearBuffPct) * 10) / 1000);
  const codex = Math.trunc(sc.baseValue * sc.codexPct / 100);
  return Math.max(0, part2 + codex);
}

/** Aggregate active 2pc / 4pc armor-set bonuses into one list of stat options.
 *  See `BuildsScreen` history for the full derivation — Combat-only sets
 *  (Counterattack, Lifesteal, Bursting, …) carry their effects as buffs and
 *  are stored as `ST_NONE` rows that get skipped here. */
export function computeSetBonuses(
  pieces: GearPiece[],
  sets: GameData["sets"] | null,
): Array<{ st: string; ap: string; v: number }> {
  if (!sets) return [];
  type Bucket = { count: number; bt4Count: number };
  const counts = new Map<string, Bucket>();
  for (const p of pieces) {
    // `p?.` tolerates a sparse `pieces` array — the solver hoists this call
    // out of its talisman loop, where the talisman slot may not be filled yet.
    if (!p?.armorSetId) continue;
    let b = counts.get(p.armorSetId);
    if (!b) { b = { count: 0, bt4Count: 0 }; counts.set(p.armorSetId, b); }
    b.count++;
    if (p.breakthrough >= 4) b.bt4Count++;
  }
  const out: Array<{ st: string; ap: string; v: number }> = [];
  for (const [setId, b] of counts) {
    if (b.count < 2) continue;
    const def = sets[setId];
    if (!def) continue;
    const targetLevel = b.bt4Count >= b.count ? 2 : 1;
    let lvRow = null;
    for (const l of def.levels) { if (l.level === targetLevel) { lvRow = l; break; } }
    if (!lvRow) continue;
    const { p2, p4 } = lvRow;
    if (p2 && p2.st !== "ST_NONE" && p2.v != null) out.push({ st: p2.st, ap: p2.ap, v: p2.v });
    if (b.count >= 4 && p4 && p4.st !== "ST_NONE" && p4.v != null) out.push({ st: p4.st, ap: p4.ap, v: p4.v });
  }
  return out;
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

/** Aggregate gear pieces (mains, subs, set bonuses) into flat/pct/buffPct
 *  buckets keyed by engine stat key. Three-way split mirrors the in-game
 *  CalcFinalStat input separation.
 *
 *  Talisman/EE handling: the in-game SubOptionList for these slots IS the
 *  gem slot list (5 OAT_RATE/OAT_ADD entries via OptionIDs 15001-15054).
 *  The parser puts those into `piece.subs` via the standard path, so without
 *  any override the current gems contribute to the buckets automatically.
 *  When `gemOverride` is supplied, Talisman/EE subs are SKIPPED and the
 *  pre-aggregated deltas are added in their place. */
/** Result of `computeSetBonuses` — the active 2pc/4pc bonus stat options. */
export type SetBonusList = ReadonlyArray<{ st: string; ap: string; v: number }>;

/** The three stat buckets fed to the in-game CalcFinalStat split. */
export interface GearBuckets {
  flat: Record<string, number>;
  pct: Record<string, number>;
  buffPct: Record<string, number>;
}

/** Fold one piece's mains + subs into the buckets, IN PLACE. Shared by the
 *  full-array aggregation and the solver's incremental path so both apply the
 *  exact same per-piece logic (and thus the same float summation when fed the
 *  same piece order). `gemOverrideActive` skips a gem-slot piece's subs (its
 *  socketed gems are replaced by the override delta). */
function addPieceToBuckets(p: GearPiece, b: GearBuckets, gemOverrideActive: boolean): void {
  for (const s of p.main) {
    if (s.combatOnly) continue;
    const target = s.fromBuff ? b.buffPct : (s.percent ? b.pct : b.flat);
    target[s.stat] = (target[s.stat] ?? 0) + s.value;
  }
  const isGemSlot = p.slot === "ooparts" || p.slot === "exclusive";
  if (!(isGemSlot && gemOverrideActive)) {
    for (const s of p.subs) {
      const target = s.percent ? b.pct : b.flat;
      target[s.stat] = (target[s.stat] ?? 0) + s.value;
    }
  }
}

/** Add the pre-aggregated gem override delta to the buckets, IN PLACE. */
function addGemOverride(gemOverride: GemOverride, b: GearBuckets): void {
  for (const k in gemOverride.flat) b.flat[k] = (b.flat[k] ?? 0) + (gemOverride.flat[k] ?? 0);
  for (const k in gemOverride.pct) b.pct[k] = (b.pct[k] ?? 0) + (gemOverride.pct[k] ?? 0);
}

/** Add the active set bonuses to the buckets, IN PLACE. */
function addSetBonuses(setBonuses: SetBonusList, b: GearBuckets): void {
  for (const sb of setBonuses) {
    const isRate = sb.ap === "OAT_RATE";
    const statKey = setBonusStatKey(sb.st, isRate);
    if (!statKey) continue;
    const value = (isRate || PERCENT_STATS.has(statKey)) ? sb.v / 10 : sb.v;
    const bucket = (isRate || PERCENT_STATS.has(statKey)) ? b.pct : b.flat;
    bucket[statKey] = (bucket[statKey] ?? 0) + value;
  }
}

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
  const b: GearBuckets = { flat: {}, pct: {}, buffPct: {} };
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
  const b: GearBuckets = { flat: {}, pct: {}, buffPct: {} };
  for (const p of prefix) addPieceToBuckets(p, b, false);
  return b;
}

const SET_BONUS_KEY_RATE: Record<string, string> = {
  ST_ATK: "atkPct", ST_DEF: "defPct", ST_HP: "hpPct",
  ST_SPEED: "spd", ST_CRITICAL_RATE: "critRate", ST_CRITICAL_DMG_RATE: "critDmg",
  ST_DMG_BOOST: "dmgUp", ST_DMG_REDUCE_RATE: "dmgReduce",
  ST_BUFF_CHANCE: "eff", ST_BUFF_RESIST: "effRes", ST_PIERCE_POWER_RATE: "pen",
};
const SET_BONUS_KEY_ADD: Record<string, string> = {
  ST_ATK: "atk", ST_DEF: "def", ST_HP: "hp",
  ST_SPEED: "spd", ST_CRITICAL_RATE: "critRate", ST_CRITICAL_DMG_RATE: "critDmg",
  ST_DMG_BOOST: "dmgUp", ST_DMG_REDUCE_RATE: "dmgReduce",
  ST_BUFF_CHANCE: "eff", ST_BUFF_RESIST: "effRes", ST_PIERCE_POWER_RATE: "pen",
};
export function setBonusStatKey(st: string, isRate: boolean): string | null {
  return (isRate ? SET_BONUS_KEY_RATE : SET_BONUS_KEY_ADD)[st] ?? null;
}

/** Compose the full stat sheet for a hero with their equipped gear. The
 *  `baseline` should be the composer's `noGearStats` (additive baseline);
 *  `scaling` carries the per-axis CalcFinalStat ingredients for ATK/DEF/HP
 *  and EFF/RES.
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
  const b: GearBuckets = { flat: { ...prefix.flat }, pct: { ...prefix.pct }, buffPct: { ...prefix.buffPct } };
  if (talisman) addPieceToBuckets(talisman, b, !!gemOverride);
  if (ee) addPieceToBuckets(ee, b, !!gemOverride);
  if (gemOverride) addGemOverride(gemOverride, b);
  addSetBonuses(setBonuses, b);
  return finalStatsFromBuckets(baseline, scaling, b);
}

/** Plug the aggregated gear buckets into the per-axis CalcFinalStat formula.
 *  Shared by both the full-array and incremental compose paths so the final
 *  arithmetic is defined once. */
function finalStatsFromBuckets(baseline: FinalStatsBaseline, scaling: ScalingMap, { flat, pct, buffPct }: GearBuckets): FinalStats {
  return {
    atk: composeMultStat(scaling.atk, flat.atk ?? 0, pct.atkPct ?? 0, buffPct.atkPct ?? 0),
    def: composeMultStat(scaling.def, flat.def ?? 0, pct.defPct ?? 0, buffPct.defPct ?? 0),
    hp:  composeMultStat(scaling.hp,  flat.hp  ?? 0, pct.hpPct  ?? 0, buffPct.hpPct  ?? 0),
    spd: baseline.spd + (flat.spd ?? 0) + (buffPct.spd ?? 0) + Math.floor(baseline.spd * (pct.spd ?? 0) / 100),
    crc: round1(baseline.chc + (pct.critRate ?? 0) + (buffPct.critRate ?? 0)),
    chd: round1(baseline.chd + (pct.critDmg  ?? 0) + (buffPct.critDmg  ?? 0)),
    eff: composeMultStat(scaling.eff, flat.eff    ?? 0, pct.eff    ?? 0, buffPct.eff    ?? 0),
    res: composeMultStat(scaling.res, flat.effRes ?? 0, pct.effRes ?? 0, buffPct.effRes ?? 0),
    dmgUp: round1(baseline.dmgInc + (pct.dmgUp ?? 0) + (flat.dmgUp ?? 0) + (buffPct.dmgUp ?? 0)),
    dmgRed: round1(baseline.dmgRed + (pct.dmgReduce ?? 0) + (flat.dmgReduce ?? 0) + (buffPct.dmgReduce ?? 0)),
    pen:    round1(baseline.pen    + (pct.pen ?? 0) + (flat.pen ?? 0) + (buffPct.pen ?? 0)),
    critDmgRed: round1((pct.critDmgReduce ?? 0) + (flat.critDmgReduce ?? 0) + (buffPct.critDmgReduce ?? 0)),
  };
}
