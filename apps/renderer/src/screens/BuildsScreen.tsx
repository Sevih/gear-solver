import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Character, GameData, GearPiece, Inventory, NoGearStats, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, expToLevel } from "@gear-solver/core";
import { aggregateGearBuckets, computeFinalStats, round1, type FinalStats, type ScalingMap } from "../lib/composeBuild.js";
import { calcBattlePower } from "../lib/solver/cp.js";
import { cx } from "../design/cx.js";
import { jsonWithSets, usePersistedState } from "../hooks/usePersistedState.js";
import { CyanButton } from "../design/Shell.js";
import { CharacterPortrait, SlotMini, StatIcon } from "../design/EquipmentIcon.js";
import { Pill } from "../design/Chips.js";
import { TOKENS, toDesignSlot, type SlotId } from "../design/tokens.js";
import { toUiPiece } from "../design/adapter.js";

/** In-game equipment layout for the build card: weapon row pairs with EE +
 *  armor pieces, second row gathers accessory/talisman + the body extremities. */
const BUILD_SLOT_ORDER: SlotId[] = [
  "weapon", "exclusive", "helmet", "armor",
  "accessory", "talisman", "gloves", "boots",
];

/** Local alias re-exported for parts of BuildsScreen that previously read
 *  `FinalStats` from this module. The single source of truth now lives in
 *  `../lib/composeBuild.ts`. */
export type { FinalStats } from "../lib/composeBuild.js";

/** Per-stat-axis dump spec — pairs the engine stat key with its `*Pct` /
 *  flat bucket name in the aggregated gear maps. EFF/RES use unsuffixed
 *  flat/pct keys (gear EFF subs land in `flat.eff` / `pct.eff`) which
 *  differs from ATK/DEF/HP (suffixed `*Pct`). */
type ScalingAxis = "atk" | "def" | "hp" | "eff" | "res";
const DUMP_AXES: ReadonlyArray<{ key: ScalingAxis; flatKey: string; pctKey: string }> = [
  { key: "atk", flatKey: "atk", pctKey: "atkPct" },
  { key: "def", flatKey: "def", pctKey: "defPct" },
  { key: "hp",  flatKey: "hp",  pctKey: "hpPct" },
  { key: "eff", flatKey: "eff", pctKey: "eff" },
  { key: "res", flatKey: "effRes", pctKey: "effRes" },
];

/** Format a complete stat-debug dump for one character: every input to the
 *  compose pipeline (per-axis scaling = base/evo/awak + the four amplifier
 *  rates) plus every equipped piece with main/subs/bt/asc. Copied to the
 *  clipboard by the card's debug button so we can paste it back when
 *  chasing an off-by-N discrepancy against the in-game character sheet. */
function buildStatsDump(
  displayName: string,
  charId: number | string,
  level: number,
  scaling: ScalingMap,
  pieces: GearPiece[],
  game: GameData | null,
): string {
  const { flat, pct, buffPct } = aggregateGearBuckets(pieces, game);
  const lines: string[] = [];
  lines.push(`${displayName} (id=${charId}, lv${level})`);
  for (const { key, flatKey, pctKey } of DUMP_AXES) {
    const sc = scaling[key];
    lines.push(
      `[${key}] base=${sc.baseValue} evo=${sc.evoValue} awak=${sc.awakValue} ` +
      `awakPct=${sc.awakPct} transcend=${sc.transcendPct} codex=${sc.codexPct} ` +
      `buff=${sc.buffPct} buffVal=${sc.buffValue} | ` +
      `gearFlat=${flat[flatKey] ?? 0} gearPct=${pct[pctKey] ?? 0} gearBuffPct=${buffPct[pctKey] ?? 0}`
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
interface StatRowConfig {
  key: keyof FinalStats;
  /** Matching field on NoGearStats — omitted for stats with no character
   *  baseline (e.g. `critDmgRed` is gear-only). Treated as 0 in that case. */
  baselineKey?: keyof NoGearStats;
  iconKey: string;
  percent: boolean;
}

/** Stat readout, column-major: each entry is one visual column rendered in
 *  order. Bottom of a column is left blank when shorter than the others.
 *  Order chosen to keep visually-grouped stats together (offense / crit /
 *  utility / debuff). */
const STAT_COLUMNS: ReadonlyArray<ReadonlyArray<StatRowConfig>> = [
  [
    { key: "atk", baselineKey: "atk", iconKey: "atk", percent: false },
    { key: "def", baselineKey: "def", iconKey: "def", percent: false },
    { key: "hp",  baselineKey: "hp",  iconKey: "hp",  percent: false },
    { key: "spd", baselineKey: "spd", iconKey: "spd", percent: false },
  ],
  [
    { key: "crc",        baselineKey: "chc", iconKey: "critRate",     percent: true },
    { key: "chd",        baselineKey: "chd", iconKey: "critDmg",      percent: true },
    { key: "critDmgRed",                     iconKey: "critDmgReduce", percent: true },
  ],
  [
    { key: "pen",    baselineKey: "pen",    iconKey: "pen",       percent: true },
    { key: "dmgUp",  baselineKey: "dmgInc", iconKey: "dmgUp",     percent: true },
    { key: "dmgRed", baselineKey: "dmgRed", iconKey: "dmgReduce", percent: true },
  ],
  // EFF / RES — in-game character sheet displays them as integers (Effectiveness
  // 203, Resilience 191), not percentages. Gear contributions on EFF/RES are
  // points on the same integer scale, summed plainly.
  [
    { key: "eff", baselineKey: "eff", iconKey: "eff",    percent: false },
    { key: "res", baselineKey: "res", iconKey: "effRes", percent: false },
  ],
];

/** Flattened row list — used everywhere a single iterable is needed (locks,
 *  iteration outside the rendering path). Keep in sync with STAT_COLUMNS. */
const FINAL_ROWS: ReadonlyArray<StatRowConfig> = STAT_COLUMNS.flat();

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
    <div className="grid grid-cols-4 gap-x-3 font-mono text-[12px] tabular-nums">
      {STAT_COLUMNS.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {col.map((row) => (
            <StatCell key={row.key} row={row} stats={stats} baseline={baseline} locked={locked} onToggleLock={onToggleLock} />
          ))}
        </div>
      ))}
    </div>
  );
}

function StatCell({ row, stats, baseline, locked, onToggleLock }: {
  row: StatRowConfig;
  stats: FinalStats;
  baseline: NoGearStats;
  locked?: Partial<FinalStats> | null;
  onToggleLock?: (key: keyof FinalStats) => void;
}) {
  const v = stats[row.key];
  // `baselineKey` is optional for gear-only stats (e.g. critDmgRed) — fall
  // back to 0 so the +delta display still makes sense.
  const base = row.baselineKey != null ? baseline[row.baselineKey] : 0;
  const delta = round1(v - base);
  const unit = row.percent ? "%" : "";
  const lockedV = locked?.[row.key];
  const drift = lockedV != null ? round1(v - lockedV) : 0;
  const isLocked = lockedV != null;
  const isDrift = isLocked && drift !== 0;
  const valColor = isDrift ? "text-rose-400" : isLocked ? "text-amber-300" : "text-white";
  const interactive = !!onToggleLock;
  // Read-only mode (no onToggleLock) renders a plain div so the cursor /
  // hover affordance doesn't lie about being interactive.
  const Wrapper = interactive ? "button" : "div";
  const wrapperProps = interactive
    ? {
        type: "button" as const,
        onClick: () => onToggleLock(row.key),
        title: isLocked
          ? (isDrift ? `Drift from locked ${lockedV}${unit} — click to UNLOCK` : `Locked ✓ at ${lockedV}${unit} — click to UNLOCK`)
          : "Click to lock this stat as the regression baseline",
      }
    : {};
  return (
    <Wrapper
      {...wrapperProps}
      className={cx(
        "group flex items-center gap-1 rounded px-1 py-0.5 -mx-1 text-left",
        interactive && "hover:bg-white/4",
      )}
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
    </Wrapper>
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

function FilterBar({ f, setF, debug, trailing }: { f: RosterFilters; setF: (next: RosterFilters) => void; debug: boolean; trailing?: ReactNode }) {
  const toggle = (s: Set<string>, v: string): Set<string> => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-6 pt-4 text-[11.5px]">
      <span className="font-mono uppercase tracking-wider text-zinc-500">Filter</span>
      <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/7 bg-black/30 px-2">
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
              type="button"
              onClick={() => setF({ ...f, elements: toggle(f.elements, el.id) })}
              title={el.label}
              className={cx(
                "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/7 bg-black/25 opacity-55 hover:opacity-100",
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
              type="button"
              onClick={() => setF({ ...f, classes: toggle(f.classes, cl.id) })}
              title={cl.label}
              className={cx(
                "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/7 bg-black/25 opacity-55 hover:opacity-100",
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
      {debug && (
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
              : "border-white/7 text-zinc-400 hover:text-zinc-200",
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
      )}
      {(f.query || f.elements.size || f.classes.size || (debug && f.locks !== "all")) ? (
        <button
          type="button"
          onClick={() => setF({ query: "", elements: new Set(), classes: new Set(), locks: "all" })}
          className="ml-1 text-[11px] text-cyan-300 hover:text-cyan-200"
        >Reset</button>
      ) : null}
      {trailing && <div className="ml-auto">{trailing}</div>}
    </div>
  );
}

/** Effective in-game CharID — the fused variant when Core Fusion is active,
 *  otherwise the base. Used for portrait / base-stat / skill-id lookups. */
function effectiveCharId(c: { charId: number; fusionCharId: number }): number {
  return c.fusionCharId !== 0 ? c.fusionCharId : c.charId;
}

/** Resolve the right `CharacterDef` for a captured Character — fused
 *  variant's meta when active (its `FaceIconID` / BasicStar / ingredients
 *  differ from the base), base meta otherwise. */
function metaOf(c: { charId: number; fusionCharId: number }, game: GameData | null) {
  return game?.characters[String(effectiveCharId(c))] ?? null;
}

/** On-card display name. `Core Fusion ${baseName}` when fused — the in-game
 *  NickName for fusion variants is flavor text, not the variant identifier.
 *  Otherwise prefixes the meta nickname for Mystic Sage / Gnosis / etc. */
function displayNameOf(c: Character, meta: { nickname: string | null } | null): string {
  const base = meta?.nickname ? `${meta.nickname} ${c.name ?? ""}`.trim() : (c.name ?? `#${c.charId}`);
  return c.fusionCharId !== 0 ? `Core Fusion ${base}` : base;
}

/** Per-(char, stat) lock snapshot — persisted at `data/stat-locks.json` via
 *  the vite dev API so regressions on validated stats stay visible across
 *  reloads. `name`/`charId`/`level` are debug context for the json file. */
interface LockEntry { name: string; charId: number; level: number; stats: Partial<FinalStats>; }

/** Stable functional-updater type — `BuildCard`s call this through `useCallback`
 *  closures that only depend on `setLocks` (referentially stable). */
type LocksMap = Record<string, LockEntry>;
type SetLocks = (next: LocksMap | ((prev: LocksMap) => LocksMap)) => void;

/** Custom hook bundling the locked-stats state + persistence. Migrates the
 *  pre-rich legacy shape (a bare `Partial<FinalStats>` keyed by uid) to the
 *  enriched `LockEntry` on first load. `setLocks` accepts either a value or a
 *  React-style functional updater and stays stable across renders so the
 *  memoized cards never need to break their handler closures.
 *
 *  Writes are **debounced** (300ms trailing) so a burst of toggles — e.g.
 *  locking ATK/DEF/HP in quick succession — collapses to one POST. The
 *  latest snapshot wins; if the user navigates away mid-flight the
 *  beforeunload flush below covers the in-flight pending write. */
const PERSIST_DEBOUNCE_MS = 300;
function useStatLocks(enabled: boolean): readonly [LocksMap, SetLocks] {
  const [locks, setLocksRaw] = useState<LocksMap>({});
  const pendingRef = useRef<{ snapshot: LocksMap | null; timer: ReturnType<typeof setTimeout> | null }>({ snapshot: null, timer: null });

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.timer != null) { clearTimeout(pending.timer); pending.timer = null; }
    if (pending.snapshot == null) return;
    const body = JSON.stringify(pending.snapshot, null, 2);
    pending.snapshot = null;
    fetch("/api/stat-locks", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      .catch(() => { /* dev-only; ignore */ });
  }, []);

  useEffect(() => {
    // Stat-lock tooling is debug-only — skip the mount fetch + beforeunload
    // listener entirely when it's off (normal usage), so the Builds tab makes
    // no /api/stat-locks request and registers no global handler.
    if (!enabled) return;
    fetch("/api/stat-locks")
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, LockEntry | Partial<FinalStats>>) => {
        const migrated: LocksMap = {};
        for (const [uid, v] of Object.entries(data ?? {})) {
          if (v && typeof v === "object" && "stats" in v) migrated[uid] = v as LockEntry;
          else migrated[uid] = { name: "?", charId: 0, level: 0, stats: v as Partial<FinalStats> };
        }
        setLocksRaw(migrated);
      })
      .catch(() => { /* leave empty */ });
    // Flush pending writes if the user reloads / closes mid-debounce so the
    // server-side json never drifts behind the in-memory state.
    const onUnload = () => flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flush();
    };
  }, [flush, enabled]);

  const setLocks = useCallback<SetLocks>((nextOrFn) => {
    setLocksRaw((prev) => {
      const next = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
      const pending = pendingRef.current;
      pending.snapshot = next;
      if (pending.timer != null) clearTimeout(pending.timer);
      pending.timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
      return next;
    });
  }, [flush]);

  return [locks, setLocks] as const;
}

/** Composed entry per character — heavy compose pipeline result plus the
 *  derived meta/portrait/name needed by every card. Built once per
 *  (inventory, game, geas, codex) tuple in `composedRoster`; the cheap
 *  filter/sort pass in `filteredRoster` just narrows this list, so lock
 *  toggles don't re-trigger the compose. */
interface ComposedEntry {
  char: Character;
  equipped: Map<SlotId, ReturnType<typeof toUiPiece>>;
  count: number;
  stats: FinalStats | null;
  baseline: NoGearStats | null;
  scaling: ScalingMap | null;
  rawPieces: GearPiece[];
  level: number;
  bp: number | null;
  /** Fused variant's meta when active, base meta otherwise. */
  meta: NonNullable<ReturnType<typeof metaOf>> | null;
  /** ID used for portrait/face icon (fused or base). */
  displayCharId: number;
  /** "Core Fusion X" / "Nickname X" / "X" — final string for the card title. */
  displayName: string;
  /** Decoded preset name when this hero's equipped gear (all slots EXCEPT
   *  the EE / exclusive piece) matches a saved preset 1:1. Null otherwise.
   *  EE is excluded because the in-game preset editor lets you swap EE
   *  independently — same preset, different EE is still the same preset. */
  presetName: string | null;
}

/** One auto-generated suggestion / observation about a hero's current build.
 *  `tone` drives the badge color (warn = orange, info = neutral, tip = cyan).
 *  Computed deterministically in `computeAdvice` from the composed entry —
 *  add new rules there. */
export interface AdviceItem {
  tone: "warn" | "info" | "tip";
  text: string;
}

/** Slots whose presence is required before any advice is meaningful. EE and
 *  Talisman are intentionally excluded — they're optional bolt-ons and don't
 *  participate in any of the rules. */
const ADVICE_REQUIRED_SLOTS: ReadonlyArray<SlotId> = [
  "weapon", "accessory", "helmet", "armor", "gloves", "boots",
];

/** Display labels for the main-gear slots used in advice messages. */
const ADVICE_SLOT_LABEL: Record<string, string> = {
  weapon: "Weapon", accessory: "Accessory", helmet: "Helmet",
  armor: "Armor", gloves: "Gloves", boots: "Boots",
};

/** Auto-detect notable conditions on a build. Pure + deterministic in
 *  (`entry`, `game`) — no IO, no Date. Rules are intentionally conservative:
 *  only high-confidence, data-driven observations (nothing that would require
 *  guessing intent, e.g. "off-stat main" on the variable slots).
 *
 *  Rules:
 *   1. Missing main-gear pieces — flag the empty slots on a partially-equipped
 *      hero. Fully-unequipped heroes are already labeled "No gear" on the
 *      card, so they stay silent. When pieces are missing we stop there: the
 *      armor layout isn't settled yet, so set advice would be noise.
 *   2. Lone set piece — a single piece of an armor set grants no bonus (no
 *      1pc tier exists in-game), so it's a wasted slot.
 *   3. 3/4 of a 4pc-capable set — the 4th piece completes the 4pc bonus.
 *
 *  Set tiers are read from `game.sets` (the T4 `level === 2` row, same
 *  derivation as the Builder's set catalog) — no assumed set sizes. */
function computeAdvice(entry: ComposedEntry, game: GameData | null): AdviceItem[] {
  const { equipped, rawPieces } = entry;
  // No gear at all → the card's "No gear" label covers it; stay silent.
  if (equipped.size === 0) return [];

  const out: AdviceItem[] = [];

  // Rule 1 — missing main-gear pieces.
  const missing = ADVICE_REQUIRED_SLOTS.filter((s) => !equipped.has(s));
  if (missing.length > 0) {
    out.push({ tone: "warn", text: `Missing: ${missing.map((s) => ADVICE_SLOT_LABEL[s] ?? s).join(", ")}` });
    return out; // armor layout incomplete — defer set rules
  }

  // Rules 2 + 3 — armor-set composition. Each equipped slot holds at most one
  // piece, so the per-set count equals the distinct-slot count the in-game
  // 2pc/4pc gate uses.
  if (game?.sets) {
    const countBySet = new Map<string, number>();
    for (const p of rawPieces) {
      if (!p.armorSetId) continue;
      countBySet.set(p.armorSetId, (countBySet.get(p.armorSetId) ?? 0) + 1);
    }
    for (const [setId, n] of countBySet) {
      const def = game.sets[setId];
      const name = def?.name ?? `Set ${setId}`;
      const t4 = def?.levels.find((l) => l.level === 2);
      const has4pc = !!(t4?.p4 && t4.p4.st !== "ST_NONE" && t4.p4.v != null);
      if (n === 1) {
        out.push({ tone: "warn", text: `${name}: 1 piece — no set bonus active` });
      } else if (n === 3 && has4pc) {
        out.push({ tone: "tip", text: `${name}: 3/4 — one more piece completes 4pc` });
      }
    }
  }

  return out;
}

/** Build a sorted, comma-joined UID key for a set of gear pieces, EE pieces
 *  excluded. Same routine on both sides (preset vs hero) guarantees the
 *  comparison is order-independent and EE-agnostic. */
function presetSignature(uids: Iterable<string>, slotByUid: Map<string, GearPiece["slot"]>): string {
  const out: string[] = [];
  for (const u of uids) {
    if (slotByUid.get(u) === "exclusive") continue;
    out.push(u);
  }
  return out.sort().join(",");
}

interface BuildCardProps {
  entry: ComposedEntry;
  /** Just this char's lock row — slicing in the parent means cards whose
   *  lock didn't change keep a stable `lockEntry` reference and skip the
   *  re-render via `memo`. */
  lockEntry: LockEntry | null;
  /** Stable setter from `useStatLocks`. The card always uses the functional
   *  form so it never has to read `locks` from props. */
  setLocks: SetLocks;
  game: GameData | null;
  /** When false, hide the stat-lock buttons + drift indicators + copy-dump
   *  button (debug-only tooling). */
  debug: boolean;
  /** Persisted free-form note for this char (empty string when none). */
  note: string;
  /** Stable per-char updater for the note text. Empty `value` clears the
   *  entry instead of storing "". */
  onChangeNote: (uid: string, value: string) => void;
  /** Jump to the Builder tab with this card's hero preselected. */
  onOptimize: (heroUid: string) => void;
}

const NOTE_MAX = 200;

/** Free-form per-hero note. Capped at NOTE_MAX chars — the textarea hard-stops
 *  via maxLength but we also show a small counter that goes amber past 90%.
 *  Width tracks content via `field-sizing-content` (clamped via min/max-w) so
 *  empty notes don't reserve a fat column. The character counter is only
 *  shown while focused so it doesn't artificially bloat the column width. */
function NoteField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const remaining = NOTE_MAX - value.length;
  const tight = remaining <= NOTE_MAX * 0.1;
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={NOTE_MAX}
        placeholder="Notes…"
        className="field-sizing-content min-w-20 max-w-60 resize-none rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none"
      />
      {focused && (
        <div className={cx("text-right font-mono text-[9.5px]", tight ? "text-amber-300" : "text-white/40")}>
          {value.length}/{NOTE_MAX}
        </div>
      )}
    </div>
  );
}

/** Vertical list of auto-detected build observations. Width follows content —
 *  no fixed reservation, so empty advice collapses to nothing. */
function AdviceList({ items }: { items: AdviceItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex max-w-48 flex-col gap-0.5">
      {items.map((a, i) => {
        const cls =
          a.tone === "warn" ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : a.tone === "tip" ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
          : "border-white/10 bg-white/4 text-white";
        return (
          <div key={i} className={cx("rounded-md border px-1.5 py-0.5 text-[10.5px] leading-tight", cls)}>
            {a.text}
          </div>
        );
      })}
    </div>
  );
}

/** Per-character build card. Memoized — re-renders only when its `entry` or
 *  its own `lockEntry` slice changes (composedRoster ref stays stable across
 *  lock toggles, so unaffected cards skip the render entirely). All handlers
 *  use the functional updater form of `setLocks` so they never depend on
 *  the current `locks` map and stay referentially stable. */
const BuildCard = memo(function BuildCard({ entry, lockEntry, setLocks, game, debug, note, onChangeNote, onOptimize }: BuildCardProps) {
  const { char, equipped, stats, baseline, scaling, rawPieces, level, bp, meta, displayCharId, displayName, presetName } = entry;
  // Auto-detected observations — recomputed only when the entry identity
  // changes (composedRoster ref stays stable across filter/lock toggles).
  const advice = useMemo(() => computeAdvice(entry, game), [entry, game]);
  // Lock plumbing is debug-only — collapse everything to a no-lock state when
  // the debug toggle is off so the StatBlock renders plain values without
  // amber/rose tints or Δ badges.
  const locked = debug ? (lockEntry?.stats ?? null) : null;
  const lockedKeys = locked ? Object.keys(locked) as (keyof FinalStats)[] : [];
  const hasAnyLock = lockedKeys.length > 0;
  const hasDrift = stats && hasAnyLock
    ? lockedKeys.some((k) => round1(stats[k] - (locked![k] ?? 0)) !== 0)
    : false;
  const driftCount = stats && hasAnyLock
    ? lockedKeys.filter((k) => round1(stats[k] - (locked![k] ?? 0)) !== 0).length
    : 0;
  const uid = char.uid;

  /** Build the enriched `LockEntry` from a `Partial<FinalStats>` snapshot. */
  const wrapEntry = useCallback((s: Partial<FinalStats>): LockEntry => ({
    name: displayName, charId: char.charId, level, stats: s,
  }), [displayName, char.charId, level]);

  const toggleStatLock = useCallback((key: keyof FinalStats) => {
    if (!stats) return;
    setLocks((prev) => {
      const next = { ...prev };
      const curStats = { ...(next[uid]?.stats ?? {}) };
      if (curStats[key] != null) delete curStats[key];
      else curStats[key] = stats[key];
      if (Object.keys(curStats).length === 0) delete next[uid];
      else next[uid] = wrapEntry(curStats);
      return next;
    });
  }, [setLocks, uid, stats, wrapEntry]);

  const acceptDrift = useCallback(() => {
    if (!stats) return;
    setLocks((prev) => {
      const next = { ...prev };
      const cur = { ...(next[uid]?.stats ?? {}) };
      for (const k of lockedKeys) cur[k] = stats[k];
      next[uid] = wrapEntry(cur);
      return next;
    });
  }, [setLocks, uid, stats, lockedKeys, wrapEntry]);

  const toggleAllLocks = useCallback(() => {
    if (!stats) return;
    setLocks((prev) => {
      if (hasAnyLock) {
        const next = { ...prev };
        delete next[uid];
        return next;
      }
      const snap: Partial<FinalStats> = {};
      for (const row of FINAL_ROWS) {
        snap[row.key] = stats[row.key];
      }
      return { ...prev, [uid]: wrapEntry(snap) };
    });
  }, [setLocks, uid, stats, hasAnyLock, wrapEntry]);

  const copyDump = useCallback(async () => {
    if (!scaling) return;
    const dump = buildStatsDump(displayName, char.charId, level, scaling, rawPieces, game);
    try { await navigator.clipboard.writeText(dump); }
    catch { console.log(dump); }
  }, [scaling, displayName, char.charId, level, rawPieces, game]);

  return (
    <div
      className="relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/7 bg-bg-elev-2 px-3 py-2.5 backdrop-blur-sm"
      // Each row is much shorter than the old card — keep CSS-native
      // virtualization but match the smaller intrinsic height so the browser
      // can skip layout/paint for offscreen rows without over-reserving space.
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 96px" }}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <CharacterPortrait
          charId={displayCharId}
          name={displayName}
          cls={meta?.cls}
          element={meta?.element}
          level={level}
          transStar={char.stars}
          basicStar={meta?.star ?? null}
          size={72}
        />
        {bp != null && (
          <div
            className="rounded-md border border-cyan-400/30 bg-cyan-500/6 px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-cyan-200"
            title={`Combat Power: ${bp.toLocaleString()}`}
          >
            <span className="text-[8.5px] uppercase tracking-wider text-cyan-400/80">CP</span>{" "}
            {bp.toLocaleString()}
          </div>
        )}
        {presetName && (
          <div
            className="max-w-22 truncate rounded-md border border-white/12 bg-white/4 px-1.5 py-0.5 text-center text-[10px] text-white"
            title={`Saved preset: ${presetName}`}
          >
            {presetName}
          </div>
        )}
      </div>

      <div className="relative shrink-0">
        <div className={cx("grid grid-cols-4 grid-rows-2 gap-1.5", equipped.size === 0 && "opacity-40")}>
          {BUILD_SLOT_ORDER.map((id) => {
            const p = equipped.get(id);
            return <SlotMini key={id} slot={id} piece={p?.iconPiece ?? null} size={55} />;
          })}
        </div>
        {equipped.size === 0 && (
          // Roster lists every hero, so unequipped ones show an empty grid —
          // label it instead of leaving a silent blank.
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rounded-md border border-white/12 bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
              No gear
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {stats && baseline && <StatBlock stats={stats} baseline={baseline} locked={locked} onToggleLock={debug ? toggleStatLock : undefined} />}
      </div>

      <div className="shrink-0">
        <NoteField value={note} onChange={(v) => onChangeNote(char.uid, v)} />
      </div>

      <div className="shrink-0">
        <AdviceList items={advice} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {debug && stats && hasDrift && (
          <button
            type="button"
            title="Accept current values for all drifted stats (refresh their locks)"
            onClick={acceptDrift}
            className="grid h-6 w-6 place-items-center rounded-md border border-emerald-400/40 bg-black/40 text-emerald-300 hover:bg-black/60"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M3 7 L6 10 L11 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {debug && stats && (
          <button
            type="button"
            title={hasAnyLock
              ? (hasDrift ? `Drift on ${driftCount}/${lockedKeys.length} locked — click to UNLOCK ALL`
                          : `Locked ${lockedKeys.length} stat${lockedKeys.length === 1 ? "" : "s"} ✓ — click to UNLOCK ALL`)
              : "Lock ALL stats as the regression baseline (click a single stat to lock just that one)"}
            onClick={toggleAllLocks}
            className={cx(
              "grid h-6 w-6 place-items-center rounded-md border bg-black/40 hover:bg-black/60",
              hasAnyLock
                ? (hasDrift ? "border-rose-400/50 text-rose-300" : "border-amber-400/40 text-amber-300")
                : "border-white/7 text-white hover:text-white",
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
        {debug && scaling && (
          <button
            type="button"
            title="Copy stat-debug dump to clipboard"
            onClick={copyDump}
            className="grid h-6 w-6 place-items-center rounded-md border border-white/7 bg-black/40 text-white hover:bg-black/60"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
              <rect x={3} y={3} width={8} height={9} rx={1.2} />
              <path d="M5 3 V2 a1 1 0 0 1 1-1 h2 a1 1 0 0 1 1 1 V3" />
            </svg>
          </button>
        )}
        <CyanButton size="sm" onClick={() => onOptimize(char.uid)}>Optimize →</CyanButton>
      </div>
    </div>
  );
});

interface BuildsScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Account-wide Geas node levels (NodeID → unlock level) from the captured
   *  `/gift/info` payload. Null falls back to per-node max in the composer. */
  userGeasLevels: UserGeasLevels | null;
  /** Resolved codex level 0..11 from the captured `/archive/info` reward
   *  count. Null falls back to the composer's default (currently max). */
  userCodexLevel: number | null;
  /** When true, surface the stat-lock / drift / copy-dump UI used for
   *  stat-formula regression work. Default off — Settings → Debug. */
  debug: boolean;
  /** Jump to the Builder tab with this hero preselected — wired to each
   *  card's "Optimize →" button. */
  onOptimize: (heroUid: string) => void;
}

export function BuildsScreen({ inventory, game, userGeasLevels, userCodexLevel, debug, onOptimize }: BuildsScreenProps) {
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

  const [lockedStats, setLockedStats] = useStatLocks(debug);
  // Per-character notes (UID → free-form text, max 200 chars). Persisted in
  // localStorage; survives reloads and re-captures. Initial shape is an empty
  // object — characters without an entry render an empty textarea.
  const [notes, setNotes] = usePersistedState<Record<string, string>>("gs.builds.notes", () => ({}));
  const setNote = useCallback((uid: string, value: string) => {
    setNotes((prev) => {
      // Treat an empty string as "no note" — drop the entry so localStorage
      // doesn't accumulate dead keys for chars whose notes were cleared.
      if (!value) {
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      }
      if (prev[uid] === value) return prev;
      return { ...prev, [uid]: value };
    });
  }, [setNotes]);

  // STEP A — heavy compose pass: runs only when inventory / game / geas /
  // codex change. Lock toggles & filter typing do NOT recompute this.
  const composedRoster = useMemo<ComposedEntry[]>(() => {
    if (!inventory) return [];
    // Index gear by character UID, keeping both the raw GearPiece list (for
    // stat aggregation) and the slot-keyed UiPiece map (for the slot grid).
    const rawByChar = new Map<string, GearPiece[]>();
    const gearByChar = new Map<string, Map<SlotId, ReturnType<typeof toUiPiece>>>();
    const slotByUid = new Map<string, GearPiece["slot"]>();
    for (const g of inventory.gear) {
      slotByUid.set(g.uid, g.slot);
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
    // Index presets by their EE-excluded UID signature so each hero can be
    // matched in O(1) instead of scanning the preset list per char.
    const presetByKey = new Map<string, string>();
    for (const p of inventory.presets) {
      const key = presetSignature(p.itemUids, slotByUid);
      if (key) presetByKey.set(key, p.name);
    }
    return inventory.characters.map((c): ComposedEntry => {
      const meta = metaOf(c, game);
      const displayCharId = effectiveCharId(c);
      const displayName = displayNameOf(c, meta);
      const equipped = gearByChar.get(c.uid) ?? new Map();
      const raws = rawByChar.get(c.uid) ?? [];
      // CharacterMaxLevelTemplet row is keyed by `${BasicStar}|${LevelMaxStep}`
      // — only present once the user has broken the lv 100 cap.
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
            userSkillLevels: { first: c.skills.first, second: c.skills.second, ultimate: c.skills.ultimate },
            ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
          })
        : null;
      const stats = composed
        ? computeFinalStats(composed.noGearStats, composed.scaling, raws, game)
        : null;
      // In-game BP (CalcBattlePower) — needs star UI metadata from the captured
      // TransStar row + equipped EE/Talisman from the raw gear list.
      const transRow = meta?.ingredients?.transcendByStar?.[String(c.stars)] ?? null;
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
      const heroKey = presetSignature(raws.map((p) => p.uid), slotByUid);
      const presetName = heroKey ? presetByKey.get(heroKey) ?? null : null;
      return {
        char: c, equipped, count: equipped.size, stats,
        baseline: composed?.intrinsicStats ?? null,
        scaling: composed?.scaling ?? null,
        rawPieces: raws, level, bp,
        meta, displayCharId, displayName, presetName,
      };
    });
  }, [inventory, game, userGeasLevels, userCodexLevel]);

  // Lock state only affects the roster when a lock-based filter is active.
  // Gate it out of the memo deps when `locks === "all"` (or debug is off) so a
  // lock toggle doesn't pointlessly re-filter + re-sort the whole roster to an
  // identical result. When a lock filter IS active, this is `lockedStats`, so
  // the memo still recomputes on every toggle as needed.
  const locksDep = (debug && filters.locks !== "all") ? lockedStats : null;
  // Cheap filter/sort pass — runs on every filter or lock-state change but
  // never re-touches the compose pipeline above.
  const roster = useMemo<ComposedEntry[]>(() => {
    if (composedRoster.length === 0) return [];
    const q = filters.query.trim().toLowerCase();
    return composedRoster
      .filter((entry) => {
        const { char, meta, stats } = entry;
        if (filters.elements.size > 0 && (!meta?.element || !filters.elements.has(meta.element))) return false;
        if (filters.classes.size > 0 && (!meta?.cls || !filters.classes.has(meta.cls))) return false;
        if (q) {
          // Searching "core" or "fusion" matches fused chars via the literal prefix.
          const fusionTag = char.fusionCharId !== 0 ? "core fusion" : "";
          const hay = `${fusionTag} ${meta?.nickname ?? ""} ${char.name ?? ""} ${char.charId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (!debug || filters.locks === "all") return true;
        const lockedSnap = lockedStats[char.uid]?.stats;
        const lockedKs = lockedSnap ? Object.keys(lockedSnap) as (keyof FinalStats)[] : [];
        if (filters.locks === "locked") return lockedKs.length > 0;
        // "drift": at least one locked stat whose live value drifted
        if (!stats || lockedKs.length === 0) return false;
        return lockedKs.some((k) => round1(stats[k] - (lockedSnap![k] ?? 0)) !== 0);
      })
      .sort((a, b) => {
        // CP desc as primary. Heroes with no resolved BP (game data missing
        // for their charId, missing TransStar row, …) sink to the bottom.
        const ap = a.bp ?? -Infinity;
        const bp_ = b.bp ?? -Infinity;
        if (bp_ !== ap) return bp_ - ap;
        return (b.count - a.count) || (b.char.stars - a.char.stars);
      });
    // `lockedStats` is read in the filter but intentionally gated via `locksDep`
    // so an "all"-filter lock toggle doesn't recompute — see locksDep above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composedRoster, filters, locksDep, debug]);

  // Heroes in the current (filtered) view with at least one piece equipped —
  // matches the tab badge's semantics (App counts distinct equipped chars).
  // Surfacing both reconciles the two numbers: the badge is "equipped", the
  // roster lists everyone, so the pill spells out "N equipped · M total".
  const equippedCount = useMemo(() => roster.reduce((n, e) => n + (e.count > 0 ? 1 : 0), 0), [roster]);

  if (!inventory) {
    return <Empty title="No capture yet" subtitle="Arm capture and import your roster to see equipped builds here." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        f={filters}
        setF={setFilters}
        debug={debug}
        trailing={
          <Pill tone="emerald">
            <span title="Heroes with at least one piece equipped (matches the tab badge) · total heroes shown">
              {equippedCount} equipped · {roster.length} total
            </span>
          </Pill>
        }
      />

      {/* flex-1 min-h-0 instead of a magic `calc(100vh - 130px)` — the parent
          is already a full-height flex column, so the scroll area fills the
          space left by the FilterBar and stays correct when the status bar
          (dynamic) appears/disappears. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6 pt-3">
        {roster.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            {inventory.characters.length === 0 ? (
              <>
                <span className="font-display text-[14px] font-semibold text-white">No characters captured yet</span>
                <span className="max-w-sm text-[12px] text-white/50">Your gear imported, but no roster. Play to the lobby and reload so the character list is captured too.</span>
              </>
            ) : (
              <span className="text-[12px] italic text-white/40">No hero matches the current filters.</span>
            )}
          </div>
        ) : (
          roster.map((entry) => (
            <BuildCard
              key={entry.char.uid}
              entry={entry}
              lockEntry={lockedStats[entry.char.uid] ?? null}
              setLocks={setLockedStats}
              game={game}
              debug={debug}
              note={notes[entry.char.uid] ?? ""}
              onChangeNote={setNote}
              onOptimize={onOptimize}
            />
          ))
        )}
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
