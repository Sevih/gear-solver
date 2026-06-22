import { useEffect, useMemo, useState } from "react";
import type { GameData, GearPiece, Inventory, NoGearStats, StatScaling, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, expToLevel } from "@gear-solver/core";
import { cx } from "../design/cx.js";
import { jsonWithSets, usePersistedState } from "../hooks/usePersistedState.js";
import { CyanButton, GsLabel } from "../design/Shell.js";
import { CharacterPortrait, SlotMini, StatIcon } from "../design/EquipmentIcon.js";
import { Pill } from "../design/Chips.js";
import { TOKENS, toDesignSlot, toDesignRarity, type SlotId } from "../design/tokens.js";
import { toIconPiece, toUiPiece } from "../design/adapter.js";

/** In-game equipment layout for the build card: weapon row pairs with EE +
 *  armor pieces, second row gathers accessory/talisman + the body extremities. */
const BUILD_SLOT_ORDER: SlotId[] = [
  "weapon", "exclusive", "helmet", "armor",
  "accessory", "talisman", "gloves", "boots",
];

/** Final stat readout displayed on the build card — character no-gear baseline
 *  composed with gear contributions. ATK / DEF / HP go through the compound
 *  formula (transcend × pctBonuses stack multiplicatively); the rest are pure
 *  additive sums of the no-gear baseline and the gear contribution. */
export interface FinalStats {
  atk: number; hp: number; def: number; spd: number;
  crc: number; chd: number; eff: number; res: number;
  dmgUp: number; dmgRed: number; pen: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Plug gear flat + gear % into the in-game CalcFinalStat formula. Mirrors
 *  CFormula::CalcFinalStat from libil2cpp.so 1.4.9 (RVA 0x2C59E48):
 *    sum_flat = baseValue + evoValue + awakValue
 *    sum_rate = awakRate + transcendRate + gearRate                 (per-mille)
 *    part1    = floor(sum_flat × (1000 + sum_rate) / 1000)
 *    combined = part1 + gearFlat
 *    part2    = floor(combined × (1000 + buffRate) / 1000)
 *    codex    = floor(baseValue × archiveRate / 1000)
 *    final    = max(0, part2 + codex)
 *  All `*Pct` inputs in StatScaling are DISPLAY units (10 = 10%); we ×10 to
 *  reach per-mille for the in-game arithmetic. Truncation matches the ARM64
 *  signed-magic-divide (asr-then-add) — Math.trunc reproduces it for both
 *  positive and negative intermediates. */
function composeMultStat(sc: StatScaling, gearFlat: number, gearPct: number, gearBuffPct: number): number {
  const sumFlat = sc.baseValue + sc.evoValue + sc.awakValue;
  const sumRate = sc.awakPct * 10 + sc.transcendPct * 10 + gearPct * 10;
  const part1 = Math.trunc(sumFlat * (1000 + sumRate) / 1000);
  const combined = part1 + gearFlat;
  const part2 = Math.trunc(combined * (1000 + (sc.buffPct + gearBuffPct) * 10) / 1000);
  const codex = Math.trunc(sc.baseValue * sc.codexPct / 100);
  return Math.max(0, part2 + codex);
}

/** Compute the in-game Combat Power (BP / BattlePower) for a fully composed
 *  character. Reverse-engineered from CalcBattlePower in libil2cpp.so (1.4.9
 *  build), validated 0-diff on 5 chars covering LB0/1/2/3.
 *
 *  Stat conventions (critical):
 *   - CRC is CAPPED at 100% before entering the formula
 *   - CRC/CHD/PEN/DMGup/DMGRed/ECDR are × 10 raw internally — these inputs
 *     here are the DISPLAYED (percent) values, multiplied to raw inside.
 *   - EFF/RES use the displayed integer directly.
 *
 *  See memory/game_combat_power_formula.md for the full derivation. */
function calcBattlePower(args: {
  stats: FinalStats;
  showUIStar: number;
  starPlus: number;
  skills: { first: number; second: number; ultimate: number; chainPassive: number };
  ee: GearPiece | null;
  ooparts: GearPiece | null;
  fused: boolean;
}): number {
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
  const crcF  = (crcRaw + 1000) / 1000;
  const penF  = (penRaw * 1.5 + 1000) / 1000;
  const spdF  = 1 + s.spd / 50;
  const effF  = 1.7 * s.eff / (s.eff + 130);
  const hdF   = 44000 / (s.hp + s.def + 44000);
  const defF  = hdF * 0.15 + 1.05;
  const resR  = 1 + 0.25 * s.res / (s.res + 200);
  const defR  = 1 + 0.25 * (ecdrRaw + dmgredRaw) / ((ecdrRaw + dmgredRaw) + 200);
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

/** Aggregate active 2pc / 4pc armor-set bonuses into one list of stat options.
 *  Pieces are grouped by `armorSetId` (1..21 for helmet/armor/gloves/boots).
 *  - 2+ pieces → grant the `p2` bonus.
 *  - 4 pieces  → ALSO grant the `p4` bonus (cumulative on top of p2).
 *  - Lv 2 row applies when every contributing piece is at bt 4 (unique-tier
 *    set), else Lv 1 (lower-tier — only 4pc unlocks a bonus there).
 *  Combat-only sets (Counterattack, Lifesteal, Bursting, Revenge, Immunity,
 *  Weakness, Augmentation, …) carry their effects as buffs/dmg, not
 *  BT_STAT_PREMIUM — their entries in `sets` are `ST_NONE` and are skipped. */
function computeSetBonuses(
  pieces: GearPiece[],
  sets: GameData["sets"] | null,
): Array<{ st: string; ap: string; v: number }> {
  if (!sets) return [];
  type Bucket = { count: number; bt4Count: number };
  const counts = new Map<string, Bucket>();
  for (const p of pieces) {
    if (!p.armorSetId) continue;
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
    const useLv2 = b.bt4Count >= b.count;
    const lvRow = def.levels.find((l) => l.level === (useLv2 ? 2 : 1));
    if (!lvRow) continue;
    if (lvRow.p2 && lvRow.p2.st !== "ST_NONE" && lvRow.p2.v != null) {
      out.push({ st: lvRow.p2.st, ap: lvRow.p2.ap, v: lvRow.p2.v });
    }
    if (b.count >= 4 && lvRow.p4 && lvRow.p4.st !== "ST_NONE" && lvRow.p4.v != null) {
      out.push({ st: lvRow.p4.st, ap: lvRow.p4.ap, v: lvRow.p4.v });
    }
  }
  return out;
}

/** Aggregate gear pieces (mains, subs, set bonuses) into flat/pct/buffPct buckets
 *  keyed by engine stat key. Shared between `computeFinalStats` and `buildStatsDump`
 *  so the debug copy stays 1:1 with what the engine actually consumed.
 *
 *  Three-way split mirrors the in-game CalcFinalStat input separation:
 *  - `flat` / `pct` (IOT_STAT-typed contributions) → `ItemOptionValue` / Rate via
 *    `SetItemOptionsValue` (sum_rate compound layer).
 *  - `buffPct` (IOT_BUFF mains — talisman / EE) → `BuffValueRate` via
 *    `SetBuffPremiumValue` (outermost amplifier alongside Skill_22 / Skill_8). */
const PERCENT_STATS = new Set(["critRate", "critDmg", "dmgUp", "dmgReduce", "pen"]);
function aggregateGearBuckets(pieces: GearPiece[], game: GameData | null): {
  flat: Record<string, number>; pct: Record<string, number>; buffPct: Record<string, number>;
} {
  const flat: Record<string, number> = {};
  const pct: Record<string, number> = {};
  const buffPct: Record<string, number> = {};
  for (const p of pieces) {
    // EE main stats are dmgUp buffs — combat-only, skipped from any sheet stat.
    // Subs always count. For non-EE pieces, mains count — but IOT_BUFF mains
    // (talisman main, ooparts) route to `buffPct` instead of `pct`.
    const includeMain = p.slot !== "exclusive";
    if (includeMain) {
      for (const s of p.main) {
        const target = s.fromBuff ? buffPct : (s.percent ? pct : flat);
        target[s.stat] = (target[s.stat] ?? 0) + s.value;
      }
    }
    for (const s of p.subs) {
      const target = s.percent ? pct : flat;
      target[s.stat] = (target[s.stat] ?? 0) + s.value;
    }
  }
  for (const b of computeSetBonuses(pieces, game?.sets ?? null)) {
    const isRate = b.ap === "OAT_RATE";
    const statKey = setBonusStatKey(b.st, isRate);
    if (!statKey) continue;
    const value = (isRate || PERCENT_STATS.has(statKey)) ? b.v / 10 : b.v;
    const bucket = (isRate || PERCENT_STATS.has(statKey)) ? pct : flat;
    bucket[statKey] = (bucket[statKey] ?? 0) + value;
  }
  return { flat, pct, buffPct };
}

function computeFinalStats(
  baseline: NoGearStats,
  scaling: { atk: StatScaling; def: StatScaling; hp: StatScaling },
  pieces: GearPiece[],
  game: GameData | null,
): FinalStats {
  const { flat, pct, buffPct } = aggregateGearBuckets(pieces, game);
  return {
    atk: composeMultStat(scaling.atk, flat.atk ?? 0, pct.atkPct ?? 0, buffPct.atkPct ?? 0),
    def: composeMultStat(scaling.def, flat.def ?? 0, pct.defPct ?? 0, buffPct.defPct ?? 0),
    hp:  composeMultStat(scaling.hp,  flat.hp  ?? 0, pct.hpPct  ?? 0, buffPct.hpPct  ?? 0),
    // SPD set bonus arrives as `pct.spd` (a %-of-baseline multiplier — Speed
    // Set 2pc gives +13% SPD which lands as floor(baseline_spd × 0.13) on
    // top of the flat sub adds). Verified against M.S.Ame: 158 × 0.13 = 20.
    spd: baseline.spd + (flat.spd ?? 0) + (buffPct.spd ?? 0) + Math.floor(baseline.spd * (pct.spd ?? 0) / 100),
    // Non-compound stats: ooparts / EE mains route through `buffPct` (they
    // resolve via IOT_BUFF → BT_STAT_PREMIUM, OAT_ADD-typed for the integer
    // scale ones — CRC/CHD/EFF/RES — and they land in the per-stat BuffValue
    // bucket alongside class-passive / Skill_8 contributions). Since sum_rate
    // and BR are typically zero for these axes, CalcFinalStat reduces to the
    // simple additive sum we already had, plus the buff bucket.
    crc: round1(baseline.chc + (pct.critRate ?? 0) + (buffPct.critRate ?? 0)),
    chd: round1(baseline.chd + (pct.critDmg  ?? 0) + (buffPct.critDmg  ?? 0)),
    // EFF/RES — gear delivers both flat (accessory main) and percent (substats /
    // talisman mains) buckets; both are points on the same integer scale.
    eff: baseline.eff + (pct.eff    ?? 0) + (flat.eff    ?? 0) + (buffPct.eff    ?? 0),
    res: baseline.res + (pct.effRes ?? 0) + (flat.effRes ?? 0) + (buffPct.effRes ?? 0),
    dmgUp: round1(baseline.dmgInc + (pct.dmgUp ?? 0) + (flat.dmgUp ?? 0) + (buffPct.dmgUp ?? 0)),
    dmgRed: round1(baseline.dmgRed + (pct.dmgReduce ?? 0) + (flat.dmgReduce ?? 0) + (buffPct.dmgReduce ?? 0)),
    pen:    round1(baseline.pen    + (pct.pen ?? 0) + (flat.pen ?? 0) + (buffPct.pen ?? 0)),
  };
}

/** Map an ST_xxx stat type + OAT_RATE flag to the engine bucket key. Mirrors
 *  the GAME_STAT table in core/stats.ts; kept local to avoid pulling it into
 *  the design layer. */
function setBonusStatKey(st: string, isRate: boolean): string | null {
  switch (st) {
    case "ST_ATK":               return isRate ? "atkPct" : "atk";
    case "ST_DEF":               return isRate ? "defPct" : "def";
    case "ST_HP":                return isRate ? "hpPct"  : "hp";
    case "ST_SPEED":             return "spd";
    case "ST_CRITICAL_RATE":     return "critRate";
    case "ST_CRITICAL_DMG_RATE": return "critDmg";
    case "ST_DMG_BOOST":         return "dmgUp";
    case "ST_DMG_REDUCE_RATE":   return "dmgReduce";
    case "ST_BUFF_CHANCE":       return "eff";
    case "ST_BUFF_RESIST":       return "effRes";
    case "ST_PIERCE_POWER_RATE": return "pen";
    default:                     return null;
  }
}

/** Format a complete stat-debug dump for one character: every input to the
 *  compose pipeline (scaling per ATK/DEF/HP) plus every equipped piece with
 *  main/subs/bt/asc. Copied to the clipboard by the card's debug button so
 *  we can paste it back to the dev when chasing an off-by-N discrepancy
 *  against the in-game character sheet. */
function buildStatsDump(
  displayName: string,
  charId: number | string,
  level: number,
  scaling: { atk: StatScaling; def: StatScaling; hp: StatScaling },
  pieces: GearPiece[],
  game: GameData | null,
): string {
  const { flat, pct, buffPct } = aggregateGearBuckets(pieces, game);
  const lines: string[] = [];
  lines.push(`${displayName} (id=${charId}, lv${level})`);
  for (const k of ["atk", "def", "hp"] as const) {
    const sc = scaling[k];
    const pctKey = k === "atk" ? "atkPct" : k === "def" ? "defPct" : "hpPct";
    lines.push(
      `[${k}] base=${sc.baseValue} evo=${sc.evoValue} awak=${sc.awakValue} ` +
      `awakPct=${sc.awakPct} transcend=${sc.transcendPct} codex=${sc.codexPct} buff=${sc.buffPct} | ` +
      `gearFlat=${flat[k] ?? 0} gearPct=${pct[pctKey] ?? 0} gearBuffPct=${buffPct[pctKey] ?? 0}`
    );
  }
  lines.push("pieces:");
  for (const p of pieces) {
    const main = p.main.map((m) => `${m.stat}=${m.value}${m.percent ? "%" : ""}`).join(",");
    const subs = p.subs.map((s) => `${s.stat}=${s.value}${s.percent ? "%" : ""}`).join(",");
    lines.push(
      `  ${p.slot} setId=${p.armorSetId ?? "-"} bt=${p.breakthrough}${p.ascended ? " ASC" : ""}` +
      ` main=[${main}] subs=[${subs}]`
    );
  }
  return lines.join("\n");
}

/** Visual row spec: (finalStats key) → (no-gear baseline key + stat icon key +
 *  percent display + base-bearing). `baselineKey` is the matching field on
 *  NoGearStats; the delta `final - baseline` is the gear contribution shown
 *  in parens beside the total. Stats with no base (dmgUp/pen) are hidden
 *  when both total and gear are zero. */
const FINAL_ROWS: Array<{
  key: keyof FinalStats;
  baselineKey: keyof NoGearStats;
  iconKey: string;
  percent: boolean;
  hideIfZero?: boolean;
}> = [
  { key: "atk", baselineKey: "atk", iconKey: "atk", percent: false },
  { key: "def", baselineKey: "def", iconKey: "def", percent: false },
  { key: "hp",  baselineKey: "hp",  iconKey: "hp",  percent: false },
  { key: "spd", baselineKey: "spd", iconKey: "spd", percent: false },
  { key: "crc", baselineKey: "chc", iconKey: "critRate", percent: true },
  { key: "chd", baselineKey: "chd", iconKey: "critDmg",  percent: true },
  // EFF / RES — in-game character sheet displays them as integers (Effectiveness 203,
  // Resilience 191), not percentages. Gear contributions on EFF/RES (substat 5%,
  // accessory main 21) are points on the same integer scale, summed plainly.
  { key: "eff", baselineKey: "eff", iconKey: "eff",    percent: false },
  { key: "res", baselineKey: "res", iconKey: "effRes", percent: false },
  { key: "dmgUp",  baselineKey: "dmgInc", iconKey: "dmgUp",     percent: true, hideIfZero: true },
  { key: "dmgRed", baselineKey: "dmgRed", iconKey: "dmgReduce", percent: true, hideIfZero: true },
  { key: "pen",    baselineKey: "pen",    iconKey: "pen",       percent: true, hideIfZero: true },
];

function StatBlock({ stats, baseline, locked, onToggleLock }: {
  stats: FinalStats;
  baseline: NoGearStats;
  /** Per-stat lock map: a key present in this object means that stat is locked
   *  to the value stored under it. Missing keys = unlocked. Drift triggers a
   *  red value + Δ badge so a regression on any single stat is visible. */
  locked?: Partial<FinalStats> | null;
  /** Click handler on a stat row — toggles the lock state for that stat key
   *  (lock to current `stats[key]` if unlocked, remove key if locked). */
  onToggleLock?: (key: keyof FinalStats) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px] tabular-nums">
      {FINAL_ROWS.map((row) => {
        const v = stats[row.key];
        const delta = round1(v - baseline[row.baselineKey]);
        if (row.hideIfZero && !v && !delta) return null;
        const unit = row.percent ? "%" : "";
        const lockedV = locked?.[row.key];
        const drift = lockedV != null ? round1(v - lockedV) : 0;
        const isLocked = lockedV != null;
        const isDrift = isLocked && drift !== 0;
        const valColor = isDrift ? "text-rose-400" : isLocked ? "text-amber-300" : "text-zinc-50";
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onToggleLock?.(row.key)}
            title={isLocked
              ? (isDrift ? `Drift from locked ${lockedV}${unit} — click to UNLOCK` : `Locked ✓ at ${lockedV}${unit} — click to UNLOCK`)
              : "Click to lock this stat as the regression baseline"}
            className="group flex items-center gap-1 rounded px-1 py-0.5 -mx-1 text-left hover:bg-white/4"
          >
            <StatIcon stat={row.iconKey} size={14} />
            <span className={valColor}>{v}{unit}</span>
            {delta !== 0 && (
              <span className="text-[10.5px]" style={{ color: TOKENS.gold }}>
                ({delta > 0 ? "+" : ""}{delta}{unit})
              </span>
            )}
            {isDrift && (
              <span className="text-[10.5px] text-rose-400">
                Δ{drift > 0 ? "+" : ""}{drift}
              </span>
            )}
            {isLocked && !isDrift && (
              <svg viewBox="0 0 14 14" className="h-2.5 w-2.5 text-amber-300/70" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <rect x={3.5} y={7} width={7} height={5} rx={0.8} />
                <path d="M5 7 V5 a2 2 0 0 1 4 0 V7" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Roster filter bar — name search + element + class multi-toggles. Element
 *  and class pills use the raw CET_xxx / CCT_xxx enums we already get from
 *  the captured CharacterTemplet rows, so we don't need a localized label map. */
const ELEMENT_CHOICES: Array<{ id: string; label: string; color: string }> = [
  { id: "CET_FIRE",  label: "Fire",  color: "#fb923c" },
  { id: "CET_WATER", label: "Water", color: "#38bdf8" },
  { id: "CET_EARTH", label: "Earth", color: "#a3e635" },
  { id: "CET_LIGHT", label: "Light", color: "#fde68a" },
  { id: "CET_DARK",  label: "Dark",  color: "#c084fc" },
];
const CLASS_CHOICES: Array<{ id: string; label: string }> = [
  { id: "CCT_ATTACKER", label: "Striker" },
  { id: "CCT_DEFENDER", label: "Defender" },
  { id: "CCT_RANGER",   label: "Ranger" },
  { id: "CCT_MAGE",     label: "Mage" },
  { id: "CCT_PRIEST",   label: "Healer" },
];

type LockMode = "all" | "locked" | "drift";
interface RosterFilters {
  query: string;
  elements: Set<string>;
  classes: Set<string>;
  /** Regression-lock filter — "all" (default), "locked" (only chars with at
   *  least one locked stat), "drift" (only chars with a drifted locked stat). */
  locks: LockMode;
}

// Persist the roster filters across reloads — the two Set<>-typed fields need
// the jsonWithSets codec to survive a JSON round-trip via localStorage.
const ROSTER_FILTER_CODEC = jsonWithSets<RosterFilters>(["elements", "classes"]);

function FilterBar({ f, setF }: { f: RosterFilters; setF: (next: RosterFilters) => void }) {
  const toggle = (s: Set<string>, v: string): Set<string> => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-6 pt-2 text-[11.5px]">
      <span className="font-mono uppercase tracking-wider text-zinc-500">Filter</span>
      <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.07] bg-black/30 px-2">
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <circle cx={6} cy={6} r={4} />
          <path d="M9 9 L12 12" strokeLinecap="round" />
        </svg>
        <input
          value={f.query}
          onChange={(e) => setF({ ...f, query: e.target.value })}
          placeholder="Search hero…"
          className="w-32 bg-transparent text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
        />
      </div>
      <div className="flex gap-1">
        {ELEMENT_CHOICES.map((el) => {
          const active = f.elements.has(el.id);
          return (
            <button
              key={el.id}
              onClick={() => setF({ ...f, elements: toggle(f.elements, el.id) })}
              title={el.label}
              className={cx(
                "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/[0.07] bg-black/25 opacity-55 hover:opacity-100",
              )}
            >
              <img
                src={`/img/ui/elem/CM_Element_${el.label}.webp`}
                alt={el.label}
                className="h-4 w-4 object-contain"
                loading="lazy"
                draggable={false}
              />
            </button>
          );
        })}
      </div>
      <div className="flex gap-1">
        {CLASS_CHOICES.map((cl) => {
          const active = f.classes.has(cl.id);
          return (
            <button
              key={cl.id}
              onClick={() => setF({ ...f, classes: toggle(f.classes, cl.id) })}
              title={cl.label}
              className={cx(
                "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/[0.07] bg-black/25 opacity-55 hover:opacity-100",
              )}
            >
              <img
                src={`/img/ui/class/CM_Class_${cl.label}.webp`}
                alt={cl.label}
                className="h-4 w-4 object-contain"
                loading="lazy"
                draggable={false}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          const next: LockMode = f.locks === "all" ? "locked" : f.locks === "locked" ? "drift" : "all";
          setF({ ...f, locks: next });
        }}
        title={f.locks === "all"
          ? "Show all heroes (click to filter to LOCKED only)"
          : f.locks === "locked"
            ? "Showing heroes with locked stats — click to filter to DRIFT only"
            : "Showing heroes with a DRIFTED locked stat — click to reset"}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-md border bg-black/30 px-2 text-[11px]",
          f.locks === "drift" ? "border-rose-400/50 text-rose-300"
            : f.locks === "locked" ? "border-amber-400/40 text-amber-300"
            : "border-white/[0.07] text-zinc-400 hover:text-zinc-200",
        )}
      >
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
          {f.locks === "all" ? (
            <><rect x={3} y={6.5} width={8} height={6} rx={1} /><path d="M5 6.5 V4 a2 2 0 0 1 4 0" /></>
          ) : (
            <><rect x={3} y={6.5} width={8} height={6} rx={1} /><path d="M5 6.5 V4 a2 2 0 0 1 4 0 V6.5" /></>
          )}
        </svg>
        <span>{f.locks === "all" ? "All" : f.locks === "locked" ? "Locked" : "Drift"}</span>
      </button>
      {(f.query || f.elements.size || f.classes.size || f.locks !== "all") ? (
        <button
          onClick={() => setF({ query: "", elements: new Set(), classes: new Set(), locks: "all" })}
          className="ml-1 text-[11px] text-cyan-300 hover:text-cyan-200"
        >Reset</button>
      ) : null}
    </div>
  );
}

interface BuildsScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Account-wide Geas node levels (NodeID → unlock level) from the captured
   *  `/gift/info` payload. Null falls back to per-node max in the composer. */
  userGeasLevels: UserGeasLevels | null;
  /** Resolved codex level 0..11 from the captured `/archive/info` reward
   *  count. Null falls back to the composer's default (currently max). */
  userCodexLevel: number | null;
}

export function BuildsScreen({ inventory, game, userGeasLevels, userCodexLevel }: BuildsScreenProps) {
  // Roster filter state — name search + element/class multi-toggles. Empty
  // sets mean "no filter on this axis".
  const [filtersRaw, setFilters] = usePersistedState<RosterFilters>(
    "gs.builds.filters",
    () => ({ query: "", elements: new Set(), classes: new Set(), locks: "all" }),
    ROSTER_FILTER_CODEC,
  );
  // Defaultify `locks` for users with a pre-migration entry in localStorage
  // (no `locks` field on the stored object). Memoized so the identity stays
  // stable across renders and we don't re-trigger the roster useMemo.
  const filters = useMemo<RosterFilters>(
    () => ({ ...filtersRaw, locks: filtersRaw.locks ?? "all" }),
    [filtersRaw],
  );

  // Regression-guard locks: per-(char, stat) snapshot once validated against
  // in-game. Storage shape: { [charUid]: { name, charId, level, stats } }.
  // The name/charId/level fields are human-readable identifiers so the file
  // is debuggable at a glance — the char UID alone is opaque. Persisted
  // SERVER-SIDE at data/stat-locks.json (via the vite dev API).
  interface LockEntry { name: string; charId: number; level: number; stats: Partial<FinalStats>; }
  const [lockedStats, setLockedStatsRaw] = useState<Record<string, LockEntry>>({});
  useEffect(() => {
    fetch("/api/stat-locks")
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, LockEntry | Partial<FinalStats>>) => {
        // Back-compat: legacy entries were just the stats blob. Wrap them so
        // downstream code only ever sees the enriched shape.
        const migrated: Record<string, LockEntry> = {};
        for (const [uid, v] of Object.entries(data ?? {})) {
          if (v && typeof v === "object" && "stats" in v) migrated[uid] = v as LockEntry;
          else migrated[uid] = { name: "?", charId: 0, level: 0, stats: v as Partial<FinalStats> };
        }
        setLockedStatsRaw(migrated);
      })
      .catch(() => { /* leave empty */ });
  }, []);
  const setLockedStats = (next: Record<string, LockEntry>) => {
    setLockedStatsRaw(next);
    fetch("/api/stat-locks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next, null, 2),
    }).catch(() => { /* dev-only; ignore */ });
  };

  const roster = useMemo(() => {
    if (!inventory) return [];
    // Index gear by character UID, keeping both the raw GearPiece list (for
    // stat aggregation) and the slot-keyed UiPiece map (for the slot grid).
    const rawByChar = new Map<string, GearPiece[]>();
    const gearByChar = new Map<string, Map<SlotId, ReturnType<typeof toUiPiece>>>();
    for (const g of inventory.gear) {
      if (!g.equippedBy) continue;
      const slot = toDesignSlot(g.slot);
      if (!slot) continue;
      let m = gearByChar.get(g.equippedBy);
      if (!m) { m = new Map(); gearByChar.set(g.equippedBy, m); }
      m.set(slot, toUiPiece(g, game));
      let raws = rawByChar.get(g.equippedBy);
      if (!raws) { raws = []; rawByChar.set(g.equippedBy, raws); }
      raws.push(g);
    }
    const q = filters.query.trim().toLowerCase();
    return inventory.characters
      .filter((c) => {
        const meta = game?.characters[String(c.charId)];
        if (filters.elements.size > 0 && (!meta?.element || !filters.elements.has(meta.element))) return false;
        if (filters.classes.size > 0 && (!meta?.cls || !filters.classes.has(meta.cls))) return false;
        if (q) {
          // Include the in-game NickName prefix (e.g. "Gnosis", "Mystic Sage")
          // so searching "gnosis" matches Gnosis Dahlia / Gnosis Viella.
          const hay = `${meta?.nickname ?? ""} ${c.name ?? ""} ${c.charId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((c) => {
        const equipped = gearByChar.get(c.uid) ?? new Map();
        const meta = game?.characters[String(c.charId)];
        // Resolve captured level and LB modifier. The CharacterMaxLevelTemplet
        // row is keyed by `${BasicStar}|${LevelMaxStep}` — when the user hasn't
        // broken the lv 100 cap (LevelMaxStep === 0) there's no modifier.
        const level = game?.expCharacter ? expToLevel(game.expCharacter, c.exp) : 100;
        const lbKey = meta?.star != null && c.levelMaxStep > 0 ? `${meta.star}|${c.levelMaxStep}` : null;
        const levelMaxModifier = lbKey ? (game?.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
        const composed = (meta?.ingredients && game?.codexCurve)
          ? composeCharStats(meta.ingredients, game.codexCurve, {
              transStar: c.stars,
              level,
              levelMaxModifier,
              levelMaxStep: c.levelMaxStep,
              userGeasLevels,
              ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
            })
          : null;
        const stats = composed
          ? computeFinalStats(composed.noGearStats, composed.scaling, rawByChar.get(c.uid) ?? [], game)
          : null;
        // The yellow "(+X)" delta on the build card matches the in-game
        // character sheet convention: white = raw additive sources (base +
        // evo + geas for ATK/DEF/HP; full baseline for non-compound stats),
        // yellow = everything the compound formula and gear pile on top
        // (codex + transcend + class % + skill_8 % + gear flat + gear pct +
        // set bonuses). See `intrinsicStats` in compose-stats.ts.
        // In-game BP (CalcBattlePower). Needs star UI metadata from the
        // captured TransStar row + equipped EE/Talisman from the raw gear list.
        const transRow = meta?.ingredients?.transcendByStar?.[String(c.stars)] ?? null;
        const raws = rawByChar.get(c.uid) ?? [];
        const ee = raws.find((p) => p.slot === "exclusive") ?? null;
        const ooparts = raws.find((p) => p.slot === "ooparts") ?? null;
        const bp = stats && transRow
          ? calcBattlePower({
              stats,
              showUIStar: transRow.showUIStar ?? 0,
              starPlus: transRow.starPlus ?? 0,
              skills: c.skills,
              ee,
              ooparts,
              fused: c.fusionCharId !== 0,
            })
          : null;
        return {
          char: c,
          equipped,
          count: equipped.size,
          stats,
          baseline: composed?.intrinsicStats ?? null,
          scaling: composed?.scaling ?? null,
          rawPieces: rawByChar.get(c.uid) ?? [],
          level,
          bp,
        };
      })
      .filter(({ char, stats }) => {
        if (filters.locks === "all") return true;
        const entry = lockedStats[char.uid];
        const lockedSnap = entry?.stats;
        const lockedKs = lockedSnap ? Object.keys(lockedSnap) as (keyof FinalStats)[] : [];
        if (filters.locks === "locked") return lockedKs.length > 0;
        // "drift": at least one locked stat whose live value drifted
        if (!stats || lockedKs.length === 0) return false;
        return lockedKs.some((k) => round1(stats[k] - (lockedSnap![k] ?? 0)) !== 0);
      })
      .sort((a, b) => (b.count - a.count) || (b.char.stars - a.char.stars));
  }, [inventory, game, filters, userGeasLevels, userCodexLevel, lockedStats]);

  if (!inventory) {
    return <Empty title="No capture yet" subtitle="Arm capture and import your roster to see equipped builds here." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-6 pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-zinc-50">Builds</h1>
          <span className="text-[13px] text-zinc-500">Your roster with currently equipped gear. Click Optimize to send to Builder.</span>
        </div>
        <Pill tone="emerald">{roster.length} heroes</Pill>
      </div>

      <FilterBar f={filters} setF={setFilters} />

      <div className="grid auto-rows-min gap-3 overflow-y-auto px-6 pb-6 pt-3 md:grid-cols-2 lg:grid-cols-3" style={{ maxHeight: "calc(100vh - 130px)" }}>
        {roster.map(({ char, equipped, stats, baseline, scaling, rawPieces, level, bp }) => {
          const meta = game?.characters[String(char.charId)];
          const displayName = meta?.nickname ? `${meta.nickname} ${char.name ?? ""}`.trim() : (char.name ?? `#${char.charId}`);
          const lockEntry = lockedStats[char.uid] ?? null;
          const locked = lockEntry?.stats ?? null;
          const lockedKeys = locked ? Object.keys(locked) as (keyof FinalStats)[] : [];
          const hasAnyLock = lockedKeys.length > 0;
          const hasDrift = stats && hasAnyLock
            ? lockedKeys.some((k) => round1(stats[k] - (locked![k] ?? 0)) !== 0)
            : false;
          // Build the enriched entry — when updating an existing lock, keep its
          // identifying meta if the current displayName/charId/level match.
          const makeEntry = (s: Partial<FinalStats>): LockEntry => ({
            name: displayName, charId: char.charId, level, stats: s,
          });
          const toggleStatLock = (key: keyof FinalStats) => {
            if (!stats) return;
            const next = { ...lockedStats };
            const curStats = { ...(next[char.uid]?.stats ?? {}) };
            if (curStats[key] != null) delete curStats[key];
            else curStats[key] = stats[key];
            if (Object.keys(curStats).length === 0) delete next[char.uid];
            else next[char.uid] = makeEntry(curStats);
            setLockedStats(next);
          };
          return (
            <div
              key={char.uid}
              className="relative rounded-xl border border-white/[0.07] bg-bg-elev-2 p-3 backdrop-blur-sm shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_24px_60px_-30px_rgb(0_0_0/0.7)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1.5">
                  <CharacterPortrait
                    charId={char.charId}
                    name={displayName}
                    cls={meta?.cls}
                    element={meta?.element}
                    level={game?.expCharacter ? expToLevel(game.expCharacter, char.exp) : null}
                    transStar={char.stars}
                    basicStar={meta?.star ?? null}
                    size={80}
                  />
                  <div className="flex gap-1">
                    {stats && hasDrift && (
                      <button
                        type="button"
                        title="Accept current values for all drifted stats (refresh their locks)"
                        onClick={() => {
                          const next = { ...lockedStats };
                          const cur = { ...(next[char.uid]?.stats ?? {}) };
                          for (const k of lockedKeys) cur[k] = stats[k];
                          next[char.uid] = makeEntry(cur);
                          setLockedStats(next);
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md border border-emerald-400/40 bg-black/40 text-emerald-300 hover:bg-black/60"
                      >
                        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
                          <path d="M3 7 L6 10 L11 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                    {stats && (
                      <button
                        type="button"
                        title={hasAnyLock
                          ? (hasDrift ? `Drift on ${lockedKeys.filter(k => round1(stats[k] - (locked![k] ?? 0)) !== 0).length}/${lockedKeys.length} locked — click to UNLOCK ALL`
                                      : `Locked ${lockedKeys.length} stat${lockedKeys.length === 1 ? "" : "s"} ✓ — click to UNLOCK ALL`)
                          : "Lock ALL stats as the regression baseline (click a single stat to lock just that one)"}
                        onClick={() => {
                          if (hasAnyLock) {
                            const next = { ...lockedStats };
                            delete next[char.uid];
                            setLockedStats(next);
                          } else {
                            const snap: Partial<FinalStats> = {};
                            for (const row of FINAL_ROWS) {
                              if (row.hideIfZero && !stats[row.key]) continue;
                              snap[row.key] = stats[row.key];
                            }
                            setLockedStats({ ...lockedStats, [char.uid]: makeEntry(snap) });
                          }
                        }}
                        className={cx(
                          "grid h-6 w-6 place-items-center rounded-md border bg-black/40 hover:bg-black/60",
                          hasAnyLock
                            ? (hasDrift ? "border-rose-400/50 text-rose-300" : "border-amber-400/40 text-amber-300")
                            : "border-white/[0.07] text-zinc-400 hover:text-zinc-200",
                        )}
                      >
                        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
                          {hasAnyLock ? (
                            <>
                              <rect x={3} y={6.5} width={8} height={6} rx={1} />
                              <path d="M5 6.5 V4 a2 2 0 0 1 4 0 V6.5" />
                            </>
                          ) : (
                            <>
                              <rect x={3} y={6.5} width={8} height={6} rx={1} />
                              <path d="M5 6.5 V4 a2 2 0 0 1 4 0" />
                            </>
                          )}
                        </svg>
                      </button>
                    )}
                    {scaling && (
                      <button
                        type="button"
                        title="Copy stat-debug dump to clipboard"
                        onClick={async () => {
                          const dump = buildStatsDump(displayName, char.charId, level, scaling, rawPieces, game);
                          try { await navigator.clipboard.writeText(dump); }
                          catch { console.log(dump); }
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md border border-white/[0.07] bg-black/40 text-zinc-400 hover:bg-black/60 hover:text-zinc-200"
                      >
                        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
                          <rect x={3} y={3} width={8} height={9} rx={1.2} />
                          <path d="M5 3 V2 a1 1 0 0 1 1-1 h2 a1 1 0 0 1 1 1 V3" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {bp != null && (
                    <div
                      className="mt-0.5 rounded-md border border-cyan-400/30 bg-cyan-500/6 px-2 py-0.5 font-mono text-[11px] tabular-nums text-cyan-200"
                      title={`Combat Power: ${bp.toLocaleString()}`}
                    >
                      <span className="text-[9.5px] uppercase tracking-wider text-cyan-400/80">CP</span>{" "}
                      {bp.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {stats && baseline && <StatBlock stats={stats} baseline={baseline} locked={locked} onToggleLock={toggleStatLock} />}
                </div>
              </div>

              <div className="mt-3">
                <GsLabel>Gear equipped</GsLabel>
                <div className="mt-1.5 grid grid-cols-4 gap-2">
                  {BUILD_SLOT_ORDER.map((id) => {
                    const p = equipped.get(id);
                    return (
                      <SlotMini key={id} slot={id} piece={p ? toIconPiece(p) : null} size={64} />
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end">
                <CyanButton size="sm">Optimize →</CyanButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h2 className="font-display text-[18px] font-semibold text-zinc-100">{title}</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-zinc-500">{subtitle}</p>
    </div>
  );
}
// Keep `toDesignRarity` import live in case of future use without polluting unused warns.
void toDesignRarity;
