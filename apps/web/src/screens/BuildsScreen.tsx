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

/** Compose final ATK/DEF/HP given the no-gear ingredients + gear contributions.
 *
 *  Reverse-engineered against in-game stat sheets (M.S.Ame lv105 LB1 full
 *  gear, D.Astei lv100 EE-only, Sterope HP gem-only). Two clean rules:
 *
 *    1. gearFlat → LINEAR add at the very end. Never compounded with
 *       transcend, regardless of which slot the flat came from (weapon main
 *       ATK flat, armor main DEF flat, sub flats — all behave the same).
 *
 *    2. gearPct → additive Model D layer on top of the no-gear compound:
 *       `gearPct/100 × (baseMax + flat) × (1 + pctBonus/100)`
 *       Does NOT compound with transcend. Works for weapon main % (e.g.
 *       weapon's chosen ATK% choice), substats (gems on every slot), and
 *       non-weapon main % (helmet HP%, boots HP%, …) — all summed together.
 *
 *  Formula:
 *    compound = ((1+transcend/100)(1+pctBonus/100) − 1) × 100   (no gear)
 *    onBase   = codex + compound       (on baseMax)
 *    onFlat   = compound               (on flat)
 *    gearExt  = gearPct/100 × (baseMax+flat) × (1+pctBonus/100)
 *    final    = floor(baseMax×(1+onBase/100) + flat×(1+onFlat/100) + gearExt) + gearFlat
 *
 *  Validated within ±2 on M.S.Ame ATK/HP/DEF, D.Astei ATK, Sterope HP +3/6/9%
 *  gem variants, and M.S.Ame DEF armor-only (linear flat add). */
function composeMultStat(sc: StatScaling, gearFlat: number, gearPct: number): number {
  // Game truncation, 4-term split:
  //   1. inner compound (base × (1+onBase/100) + flat × (1+onFlat/100))
  //   2. geasBuff term — IOT_BUFF rate-based geas on (base+flat), transcend-amplified
  //   3. gearPct extra — gear %, compounded with BOTH pctBonus AND geasBuffPct
  //   4. gearFlat extra — raw gear flat, ALSO amplified by (1+geasBuffPct/100)
  //      (NOT by transcend — that overshoots by 2×; geasBuff conceptually acts
  //      on "current ATK" including the flat gear additions).
  // Validated:
  //   - Mr.Skadi 2000114 lv110: ATK 2127 / DEF 2170 / HP 11851 (exact)
  //   - Aer 2000055 EE-only: ATK 2273 (needed geasBuffPct on gearPctExtra)
  //   - Gnosis Dahlia 2000090 lv120: ATK ≈9593 (needed gearFlat × (1+geasBuffPct/100);
  //     without it we were -338 short on a 2260-flat / 15% geasBuff setup)
  const compound = ((1 + sc.transcendPct / 100) * (1 + sc.pctBonus / 100) - 1) * 100;
  const onBase = sc.codexPct + compound;
  const onFlat = compound;
  const term1 = sc.baseMax * (1 + onBase / 100);
  const term2 = sc.flat * (1 + onFlat / 100);
  const geasBuffTerm = (sc.baseMax + sc.flat) * (sc.geasBuffPct / 100) * (1 + sc.transcendPct / 100);
  const gearPctExtra = (gearPct / 100) * (sc.baseMax + sc.flat) * (1 + sc.pctBonus / 100) * (1 + sc.geasBuffPct / 100);
  const gearFlatExtra = gearFlat * (1 + sc.geasBuffPct / 100);
  // Inner compound: term1 and term2 are floored INDEPENDENTLY (single-floor on
  // the sum overshoots by +1 when their fractions sum to > 1 — e.g. Gnosis
  // Dahlia DEF: 0.2 + 0.9 = 1.1). Extras use round (not floor) since the game
  // empirically rounds them — without rounding, Mr.Skadi HP would land 1 short
  // on a gearPctExtra of 500.556 → round 501 vs floor 500.
  return Math.floor(term1) + Math.floor(term2)
       + Math.round(geasBuffTerm)
       + Math.round(gearPctExtra)
       + Math.round(gearFlatExtra);
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

/** Aggregate gear pieces (mains, subs, set bonuses) into flat/pct buckets keyed
 *  by engine stat key. Shared between `computeFinalStats` and `buildStatsDump`
 *  so the debug copy stays 1:1 with what the engine actually consumed. */
const PERCENT_STATS = new Set(["critRate", "critDmg", "dmgUp", "dmgReduce", "pen"]);
function aggregateGearBuckets(pieces: GearPiece[], game: GameData | null): {
  flat: Record<string, number>; pct: Record<string, number>;
} {
  const flat: Record<string, number> = {};
  const pct: Record<string, number> = {};
  for (const p of pieces) {
    // EE main stats are combat-only buffs — gems still apply, main is skipped.
    const stats = p.slot === "exclusive" ? p.subs : [...p.main, ...p.subs];
    for (const s of stats) {
      const bucket = s.percent ? pct : flat;
      bucket[s.stat] = (bucket[s.stat] ?? 0) + s.value;
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
  return { flat, pct };
}

function computeFinalStats(
  baseline: NoGearStats,
  scaling: { atk: StatScaling; def: StatScaling; hp: StatScaling },
  pieces: GearPiece[],
  game: GameData | null,
): FinalStats {
  const { flat, pct } = aggregateGearBuckets(pieces, game);
  return {
    atk: composeMultStat(scaling.atk, flat.atk ?? 0, pct.atkPct ?? 0),
    def: composeMultStat(scaling.def, flat.def ?? 0, pct.defPct ?? 0),
    hp:  composeMultStat(scaling.hp,  flat.hp  ?? 0, pct.hpPct  ?? 0),
    // SPD set bonus arrives as `pct.spd` (a %-of-baseline multiplier — Speed
    // Set 2pc gives +13% SPD which lands as floor(baseline_spd × 0.13) on
    // top of the flat sub adds). Verified against M.S.Ame: 158 × 0.13 = 20.
    spd: baseline.spd + (flat.spd ?? 0) + Math.floor(baseline.spd * (pct.spd ?? 0) / 100),
    crc: round1(baseline.chc + (pct.critRate ?? 0)),
    chd: round1(baseline.chd + (pct.critDmg  ?? 0)),
    // EFF/RES — gear delivers both flat (accessory main) and percent (substats /
    // talisman mains) buckets; both are points on the same integer scale.
    eff: baseline.eff + (pct.eff    ?? 0) + (flat.eff    ?? 0),
    res: baseline.res + (pct.effRes ?? 0) + (flat.effRes ?? 0),
    dmgUp: round1(baseline.dmgInc + (pct.dmgUp ?? 0) + (flat.dmgUp ?? 0)),
    dmgRed: round1(baseline.dmgRed + (pct.dmgReduce ?? 0) + (flat.dmgReduce ?? 0)),
    pen:    round1(baseline.pen    + (pct.pen ?? 0) + (flat.pen ?? 0)),
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
  const { flat, pct } = aggregateGearBuckets(pieces, game);
  const lines: string[] = [];
  lines.push(`${displayName} (id=${charId}, lv${level})`);
  for (const k of ["atk", "def", "hp"] as const) {
    const sc = scaling[k];
    const pctKey = k === "atk" ? "atkPct" : k === "def" ? "defPct" : "hpPct";
    lines.push(
      `[${k}] baseMax=${sc.baseMax} flat=${sc.flat} pctBonus=${sc.pctBonus} ` +
      `geasBuffPct=${sc.geasBuffPct} codex=${sc.codexPct} transcend=${sc.transcendPct} | ` +
      `gearFlat=${flat[k] ?? 0} gearPct=${pct[pctKey] ?? 0}`
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

interface RosterFilters {
  query: string;
  elements: Set<string>;
  classes: Set<string>;
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
      {(f.query || f.elements.size || f.classes.size) ? (
        <button
          onClick={() => setF({ query: "", elements: new Set(), classes: new Set() })}
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
  const [filters, setFilters] = usePersistedState<RosterFilters>(
    "gs.builds.filters",
    () => ({ query: "", elements: new Set(), classes: new Set() }),
    ROSTER_FILTER_CODEC,
  );

  // Regression-guard locks: per-(char, stat) snapshot once validated against
  // in-game. Storage shape is { [charUid]: { [statKey]: number } }. Persisted
  // SERVER-SIDE at data/stat-locks.json (via the vite dev API) so the file is
  // committable and the maintainer can see lock evolution via git history.
  const [lockedStats, setLockedStatsRaw] = useState<Record<string, Partial<FinalStats>>>({});
  // Initial fetch from the dev endpoint. If the endpoint is missing (prod
  // build, etc.) we just stay at {} — no locks shown.
  useEffect(() => {
    fetch("/api/stat-locks")
      .then((r) => r.ok ? r.json() : {})
      .then((data) => setLockedStatsRaw(data ?? {}))
      .catch(() => { /* leave empty */ });
  }, []);
  // Wrapped setter that also POSTs to the dev endpoint. Fire-and-forget; if it
  // fails the file isn't updated but the UI still reflects the change locally.
  const setLockedStats = (next: Record<string, Partial<FinalStats>>) => {
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
        return {
          char: c,
          equipped,
          count: equipped.size,
          stats,
          baseline: composed?.intrinsicStats ?? null,
          scaling: composed?.scaling ?? null,
          rawPieces: rawByChar.get(c.uid) ?? [],
          level,
        };
      })
      .sort((a, b) => (b.count - a.count) || (b.char.stars - a.char.stars));
  }, [inventory, game, filters, userGeasLevels, userCodexLevel]);

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
        {roster.map(({ char, equipped, stats, baseline, scaling, rawPieces, level }) => {
          const meta = game?.characters[String(char.charId)];
          const displayName = meta?.nickname ? `${meta.nickname} ${char.name ?? ""}`.trim() : (char.name ?? `#${char.charId}`);
          const locked = lockedStats[char.uid] ?? null;
          const lockedKeys = locked ? Object.keys(locked) as (keyof FinalStats)[] : [];
          const hasAnyLock = lockedKeys.length > 0;
          // Drift detection — any LOCKED stat whose current value drifted from
          // its snapshot. Drives the card-level lock button tint (amber when
          // all locks match, rose when any locked stat drifted).
          const hasDrift = stats && hasAnyLock
            ? lockedKeys.some((k) => round1(stats[k] - (locked![k] ?? 0)) !== 0)
            : false;
          const toggleStatLock = (key: keyof FinalStats) => {
            if (!stats) return;
            const next = { ...lockedStats };
            const cur = { ...(next[char.uid] ?? {}) };
            if (cur[key] != null) delete cur[key];
            else cur[key] = stats[key];
            if (Object.keys(cur).length === 0) delete next[char.uid];
            else next[char.uid] = cur;
            setLockedStats(next);
          };
          return (
            <div
              key={char.uid}
              className="relative rounded-xl border border-white/[0.07] bg-bg-elev-2 p-3 backdrop-blur-sm shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_24px_60px_-30px_rgb(0_0_0/0.7)]"
            >
              <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
                {stats && hasDrift && (
                  <button
                    type="button"
                    title="Accept current values for all drifted stats (refresh their locks)"
                    onClick={() => {
                      const next = { ...lockedStats };
                      const cur = { ...(next[char.uid] ?? {}) };
                      for (const k of lockedKeys) cur[k] = stats[k];
                      next[char.uid] = cur;
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
                        // Lock every visible stat (skip hideIfZero rows that are currently 0).
                        const snap: Partial<FinalStats> = {};
                        for (const row of FINAL_ROWS) {
                          if (row.hideIfZero && !stats[row.key]) continue;
                          snap[row.key] = stats[row.key];
                        }
                        setLockedStats({ ...lockedStats, [char.uid]: snap });
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
                      catch { /* clipboard denied — paste from console as fallback */ console.log(dump); }
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
              <div className="flex items-start gap-3">
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
