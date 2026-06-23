import { memo, useCallback, useMemo, useState } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { resolveOption } from "@gear-solver/core";
import { cx } from "../design/cx.js";
import { jsonWithSets, usePersistedState } from "../hooks/usePersistedState.js";
import { CharFace, EquipmentIcon, SlotIcon, StatIcon } from "../design/EquipmentIcon.js";
import {
  RARITY, SINGULARITY_GRADIENT_H, SLOTS, STAT,
  type DesignRarity, type SlotId,
} from "../design/tokens.js";
import { toUiPiece, type UiPiece } from "../design/adapter.js";
import { GameText } from "../design/GameText.js";
import { HoverHint } from "../design/HoverHint.js";

// ── tiny atoms ──────────────────────────────────────────────────────────
function Search({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx={6} cy={6} r={4} />
      <path d="M9 9 L12 12" strokeLinecap="round" />
    </svg>
  );
}
// ── filter state ────────────────────────────────────────────────────────
interface FilterState {
  slots: Set<SlotId>;
  rarities: Set<DesignRarity>;
  stars: Set<number>;
  brk: Set<number>;
  enhMin: number;
  enhMax: number;
  showEquipped: boolean;
  showFree: boolean;
  showLocked: boolean;
  singularityOnly: boolean;
  query: string;
}

function emptyFilters(): FilterState {
  return {
    slots: new Set(),
    rarities: new Set(),
    stars: new Set(),
    brk: new Set(),
    enhMin: 0,
    enhMax: 15,
    showEquipped: true,
    showFree: true,
    showLocked: true,
    singularityOnly: false,
    query: "",
  };
}

// Persistence codec for the inventory filter shape — wraps the four Set<>-typed
// fields so they survive a JSON round-trip via localStorage.
const FILTER_CODEC = jsonWithSets<FilterState>(["slots", "rarities", "stars", "brk"]);

function matchesFilters(p: UiPiece, f: FilterState): boolean {
  if (f.singularityOnly && !p.singularity) return false;
  if (f.slots.size > 0 && (!p.slot || !f.slots.has(p.slot))) return false;
  if (f.rarities.size > 0 && !f.rarities.has(p.rarity)) return false;
  if (f.stars.size > 0 && !f.stars.has(p.stars)) return false;
  if (f.brk.size > 0 && !f.brk.has(p.bt)) return false;
  if (p.enhance < f.enhMin || p.enhance > f.enhMax) return false;
  const isEquipped = p.status === "equipped";
  if (isEquipped && !f.showEquipped) return false;
  if (!isEquipped && !f.showFree) return false;
  if (p.locked && !f.showLocked) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${p.name} ${p.slot ?? ""} ${p.rarity} ${p.main.map((m) => m.label).join(" ")} ${p.subs.map((s) => s.stat).join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ── filter pieces ───────────────────────────────────────────────────────
function FilterGroup({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-t border-white/5 px-3 py-2.5 first:border-t-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function FPill({
  children, active, color, className, onClick,
}: { children: React.ReactNode; active?: boolean; color?: string; className?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors",
        active ? "text-zinc-100" : "border-white/[0.07] bg-black/25 text-zinc-400 hover:bg-white/5",
        className,
      )}
      style={active ? { borderColor: (color ?? "#22d3ee") + "66", background: (color ?? "#22d3ee") + "1f", color: color ?? "#a5f3fc" } : undefined}
    >
      {children}
    </button>
  );
}

function Checkbox({
  label, sub, checked, tone = "cyan", onChange,
}: { label: string; sub?: string; checked: boolean; tone?: "cyan" | "emerald" | "violet"; onChange: () => void }) {
  const toneClass = tone === "emerald" ? "border-emerald-400/60 bg-emerald-500/30"
                    : tone === "violet" ? "border-violet-400/60 bg-violet-500/30"
                    : "border-cyan-400/60 bg-cyan-500/30";
  return (
    <button
      onClick={onChange}
      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-white/3"
    >
      <span
        className={cx(
          "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
          checked ? toneClass : "border-white/15 bg-black/40",
        )}
      >
        {checked && (
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2 5 L4 7 L8 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <div className="text-[11.5px] text-zinc-300">{label}</div>
        {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
      </span>
    </button>
  );
}

/** How many filter dimensions are currently non-default — surfaced as a
 *  badge on the collapsed strip so the user knows whether collapsing hid
 *  anything load-bearing. */
function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.slots.size > 0) n++;
  if (f.rarities.size > 0) n++;
  if (f.stars.size > 0) n++;
  if (f.brk.size > 0) n++;
  if (f.enhMin !== 0 || f.enhMax !== 15) n++;
  if (!f.showEquipped || !f.showFree || !f.showLocked) n++;
  if (f.singularityOnly) n++;
  if (f.query.trim() !== "") n++;
  return n;
}

function FilterPanel({
  f, setF, collapsed, onToggle,
}: { f: FilterState; setF: (next: FilterState) => void; collapsed: boolean; onToggle: () => void }) {
  const toggle = <T,>(s: Set<T>, v: T): Set<T> => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };
  if (collapsed) {
    const active = activeFilterCount(f);
    return (
      <aside className="flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-white/[0.07] bg-[oklch(0.19_0.016_270/0.7)] py-3 backdrop-blur-sm">
        <button
          onClick={onToggle}
          title="Expand filters"
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/6 hover:text-zinc-100"
        >
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3 L5 7 L9 11" />
          </svg>
        </button>
        <div className="vertical-text text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400" style={{ writingMode: "vertical-rl" }}>
          Filters{active > 0 ? ` · ${active}` : ""}
        </div>
      </aside>
    );
  }
  return (
    <aside className="w-60 shrink-0 overflow-hidden rounded-xl border border-white/[0.07] bg-[oklch(0.19_0.016_270/0.7)] backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/6 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            title="Collapse filters"
            className="grid h-5 w-5 place-items-center rounded text-zinc-500 hover:bg-white/6 hover:text-zinc-200"
          >
            <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3 L9 7 L5 11" />
            </svg>
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Filters</span>
        </div>
        <button onClick={() => setF(emptyFilters())} className="text-[10.5px] text-cyan-300 hover:text-cyan-200">Reset</button>
      </div>

      <div className="px-3 py-2.5">
        <div className="flex h-7 items-center gap-2 rounded-md border border-white/[0.07] bg-black/30 px-2">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={f.query}
            onChange={(e) => setF({ ...f, query: e.target.value })}
            placeholder="Search item, set, stat…"
            className="flex-1 bg-transparent text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
      </div>

      <FilterGroup label="Slot">
        <div className="flex flex-wrap gap-1">
          {SLOTS.map((s) => (
            <FPill key={s.id} active={f.slots.has(s.id)} onClick={() => setF({ ...f, slots: toggle(f.slots, s.id) })}>
              <SlotIcon slot={s.id} size={14} />
              {s.short}
            </FPill>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Rarity">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(RARITY) as DesignRarity[]).map((k) => (
            <FPill
              key={k}
              active={f.rarities.has(k)}
              color={RARITY[k].fg}
              onClick={() => setF({ ...f, rarities: toggle(f.rarities, k) })}
            >
              {RARITY[k].label}
            </FPill>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Stars">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <FPill
              key={n}
              active={f.stars.has(n)}
              color="#facc15"
              className="w-7 justify-center px-0"
              onClick={() => setF({ ...f, stars: toggle(f.stars, n) })}
            >
              {n}
            </FPill>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Enhance" right={<span className="font-mono text-[10px] text-cyan-300">+{f.enhMin} – +{f.enhMax}</span>}>
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} max={15} value={f.enhMin}
            onChange={(e) => setF({ ...f, enhMin: Math.max(0, Math.min(15, Number(e.target.value))) })}
            className="h-6 w-12 rounded border border-white/[0.07] bg-black/30 px-1 text-center font-mono text-[11px] text-zinc-200 outline-none"
          />
          <span className="text-zinc-600">–</span>
          <input
            type="number" min={0} max={15} value={f.enhMax}
            onChange={(e) => setF({ ...f, enhMax: Math.max(0, Math.min(15, Number(e.target.value))) })}
            className="h-6 w-12 rounded border border-white/[0.07] bg-black/30 px-1 text-center font-mono text-[11px] text-zinc-200 outline-none"
          />
        </div>
      </FilterGroup>

      <FilterGroup label="Breakthrough">
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map((n) => (
            <FPill
              key={n}
              active={f.brk.has(n)}
              color="#fde68a"
              className="px-2"
              onClick={() => setF({ ...f, brk: toggle(f.brk, n) })}
            >
              T{n}
            </FPill>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Status">
        <div className="space-y-0.5">
          <Checkbox label="Equipped" checked={f.showEquipped} tone="emerald" onChange={() => setF({ ...f, showEquipped: !f.showEquipped })} />
          <Checkbox label="Free" checked={f.showFree} onChange={() => setF({ ...f, showFree: !f.showFree })} />
          <Checkbox label="Locked" checked={f.showLocked} tone="violet" onChange={() => setF({ ...f, showLocked: !f.showLocked })} />
        </div>
      </FilterGroup>

      <FilterGroup label="Singularity">
        <Checkbox label="Ascended only" sub="Show only Singularity pieces" checked={f.singularityOnly} tone="violet" onChange={() => setF({ ...f, singularityOnly: !f.singularityOnly })} />
      </FilterGroup>
    </aside>
  );
}

/** Common props for the grid card — parent passes the resolved
 *  `equippedChar` (looked up once via the `charsByUid` Map in the screen)
 *  + a stable `onSelect(id)` callback so `memo` actually skips renders
 *  when scrolling / filtering / selecting a different row. */
interface GearItemProps {
  piece: UiPiece;
  equippedChar: Character | null;
  active: boolean;
  onSelect: (id: string) => void;
}

/** Icon-only grid tile — clicking it surfaces the full detail in the left
 *  ItemDetail panel. Keeping the tile down to ~96px lets us pack ~10 columns
 *  on a 1480px window instead of ~6 with the old name+stats card.
 *  Overlays:
 *    - top-left:  "E" badge when equipped (white-on-black, replaces the
 *                 character portrait — too noisy at this density).
 *    - bottom-left, above the EquipmentIcon's own T<n> tier badge: the
 *                 in-game CT_Slot_Lock sprite, sourced from outerpedia-v2's
 *                 datamine and served at /img/ui/inven/CT_Slot_Lock.png.
 *  Selection is conveyed by a soft cyan halo (ring + outer glow) rather
 *  than a hard border so the focus reads as ambient light, not a frame. */
const GearTile = memo(function GearTile({ piece, equippedChar, active, onSelect }: GearItemProps) {
  const onClick = useCallback(() => onSelect(piece.id), [onSelect, piece.id]);
  return (
    <button
      onClick={onClick}
      title={piece.name}
      className={cx(
        "group relative grid place-items-center rounded-lg border-2 p-0 transition-all",
        // Selection halo: thicker (2px) cyan stroke hugging the tile edge,
        // plus a two-layer glow - a tight bright inner bloom for "shine"
        // and a wider soft aura around it. Lateral whitespace between
        // ring and art is removed by sizing the icon to fit the grid
        // column (see size below).
        active
          ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_8px_0_rgba(34,211,238,0.9),0_0_22px_4px_rgba(34,211,238,0.5)]"
          : "border-white/5 bg-white/[0.012] hover:border-white/15 hover:bg-white/3",
      )}
      // CSS-native virtualization - skip layout/paint for off-screen tiles.
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 96px" }}
    >
      {/* Icon size tuned to grid column min (96px) minus the 4px border so
          the cyan stroke sits right on the icon's visual edge with no
          leftover lateral whitespace. */}
      <EquipmentIcon piece={piece.iconPiece} size={92} />
      {/* "E" sits well inside the icon's top-left art area (not on the tile
          frame) so it reads as an overlay on the gear, not a tile chrome. */}
      {equippedChar && (
        <span
          title={`Equipped on ${equippedChar.name ?? `#${equippedChar.charId}`}`}
          className="absolute left-2.75 top-1 grid h-4 w-4 place-items-center bg-black/85 font-mono text-[9px] font-bold text-white"
        >
          E
        </span>
      )}
      {/* Lock sits noticeably above the EquipmentIcon's own T<n> tier badge
          (the tier text in an 84px icon lives near bottom 20-34px). Bumped
          to bottom-12 + h-5 to read as a clear "locked" stamp rather than a
          tiny corner indicator. */}
      {piece.locked && (
        <img
          src="/img/ui/inven/CT_Slot_Lock.png"
          alt="Locked"
          className="pointer-events-none absolute left-2.5 bottom-10.5 h-4.5 w-4.5"
        />
      )}
    </button>
  );
});

// ── sort header ─────────────────────────────────────────────────────────
type SortKey = "stars" | "enhance" | "bt" | "name";

function SortHeader({
  sort, dir, total, shown, onSort, limit, onLimitChange,
}: {
  sort: SortKey; dir: "asc" | "desc"; total: number; shown: number;
  onSort: (k: SortKey) => void; limit: number; onLimitChange: (n: number) => void;
}) {
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => onSort(k)}
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] transition-colors",
        sort === k ? "text-cyan-200" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      {label}
      {sort === k && <span className="text-[9px]">{dir === "desc" ? "▼" : "▲"}</span>}
    </button>
  );
  return (
    <div className="flex items-center justify-between border-b border-white/6 px-1 pb-2">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Sort by
        <Th k="stars" label="★" />
        <Th k="enhance" label="Enhance" />
        <Th k="bt" label="Brk" />
        <Th k="name" label="Name" />
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
        <span className="font-mono">{total} pieces · {shown} shown</span>
        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="rounded border border-white/[0.07] bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 outline-none"
        >
          {[50, 100, 200, 500].map((n) => <option key={n} value={n}>Limit {n}</option>)}
          <option value={1_000_000}>All</option>
        </select>
      </div>
    </div>
  );
}

// ── detail ──────────────────────────────────────────────────────────────
/** Long-form label for a stat — falls back to the engine key uppercased
 *  when STAT doesn't know the type (talisman / EE mains that didn't make
 *  it into the table get a readable placeholder). */
function statLong(key: string): string {
  return STAT[key]?.longLabel ?? key.toUpperCase();
}

/** "Quality" score for an item — sum of every substat's total ticks
 *  (initial roll + reforge procs), benchmarked against the cap for the
 *  item's CURRENT investment state (not the theoretical max it could
 *  ever reach):
 *
 *    - Base cap is 14 (initial-roll spread cap = 4+4+3+3 across 4 subs).
 *    - Each reforge proc the user has actually spent raises the cap by
 *      1 tick (a reforged sub can land anywhere from +1 to whatever the
 *      pool allows; reflecting CONSUMED reforges keeps the score honest
 *      for fresh items vs heavily-invested ones).
 *
 *  So:
 *    - A pristine 6★ with no reforges → cap 14 (1/1/1/3 ≈ 6 → 42% Poor).
 *    - A non-ascended 6★ fully reforged (6 procs) → cap 20.
 *    - An ascended 6★ fully reforged (6 + 3 = 9 procs) → cap 23.
 *
 *  Tier (poor / decent / good / excellent / perfect) drives the bar
 *  color so the user gets a glance read. */
type QualityTier = "poor" | "decent" | "good" | "excellent" | "perfect";
function computeQuality(piece: UiPiece): {
  current: number; max: number; pct: number; tier: QualityTier;
} | null {
  // Talisman + Exclusive Equipment don't use rolled substats (talisman has
  // IOT_BUFF mains, EE has fixed conditional stats + gem-style slots that
  // can be swapped in/out). The "Quality" score is only meaningful for the
  // gear slots with rollable + reforgable subs.
  if (piece.slot === "talisman" || piece.slot === "exclusive") return null;
  if (piece.subs.length === 0 || piece.stars <= 0) return null;
  const current = piece.subs.reduce((sum, s) => sum + s.lv, 0);
  // `reforge.n` is the count of reforge attempts the user has spent.
  // Each one bumps the achievable tick pool by 1.
  const max = 14 + piece.reforge.n;
  const pct = Math.min(100, Math.round((current / max) * 100));
  const tier: QualityTier =
    pct >= 100 ? "perfect" :
    pct >= 85  ? "excellent" :
    pct >= 70  ? "good" :
    pct >= 50  ? "decent" : "poor";
  return { current, max, pct, tier };
}

const QUALITY_TONE: Record<QualityTier, { text: string; bar: string; label: string }> = {
  poor:      { text: "text-zinc-400",   bar: "#52525b", label: "Poor" },
  decent:    { text: "text-sky-300",    bar: "#7dd3fc", label: "Decent" },
  good:      { text: "text-emerald-300",bar: "#6ee7b7", label: "Good" },
  excellent: { text: "text-violet-300", bar: "#c4b5fd", label: "Excellent" },
  perfect:   { text: "text-amber-300",  bar: "#fbbf24", label: "Perfect" },
};

/** Render a single substat row in the detail panel - matches the mockup
 *  layout: "LV {n}  [icon]  {long label}              {value}".
 *  When the sub has received any reforge proc the label expands to
 *  "LV {n} (base + {reforges})" so the user sees the breakdown. When the
 *  sub has reached its star-tier max (e.g. Lv 6 on a 6-star piece — all
 *  possible reforge procs landed here) the whole row tints gold. */
function SubstatRow({ s, stars }: { s: UiPiece["subs"][number]; stars: number }) {
  const isMax = stars > 0 && s.lv >= stars;
  const sign = s.value.startsWith("-") ? "" : "+";
  return (
    <div
      className={cx(
        "flex items-center gap-2 font-mono text-[12px] tabular-nums",
        isMax ? "text-amber-300" : "text-zinc-300",
      )}
    >
      <span className={cx("shrink-0", isMax ? "text-amber-300" : "text-zinc-400")}>
        LV {s.lv}
        {s.reforges > 0 && (
          <span className={cx("ml-1", isMax ? "text-amber-400/80" : "text-zinc-500")}>
            ({s.lv - s.reforges} + {s.reforges})
          </span>
        )}
      </span>
      <StatIcon stat={s.stat} size={16} className="shrink-0" />
      <span className="flex-1">{statLong(s.stat)}</span>
      <span className={cx("font-semibold", isMax ? "text-amber-200" : "text-zinc-100")}>
        {sign}{s.value}
      </span>
    </div>
  );
}

/** Pull the set-effect entry that matches the piece's star tier. Set bonuses
 *  scale with star level in Outerplane — a 5-star piece grants the level-5
 *  p2/p4 effect, a 6-star piece the level-6 one. */
function pickSetLevel(game: GameData, setId: string, stars: number) {
  const def = game.sets?.[setId];
  if (!def) return null;
  const wrap = (level: SetLevelEntry) => ({ name: def.name ?? null, desc: def.desc ?? null, level });
  // Find exact match first; fall back to the highest available level
  // (some sets only emit up to a certain tier).
  const exact = def.levels.find((l) => l.level === stars);
  if (exact) return wrap(exact);
  const sorted = [...def.levels].sort((a, b) => b.level - a.level);
  return sorted[0] ? wrap(sorted[0]) : null;
}
type SetLevelEntry = NonNullable<GameData["sets"][string]>["levels"][number];

/** Talisman / EE gem panel — vertical list of the 5 slot positions, one
 *  row each, laid out as:  [icon] Lv N · stat label · value
 *  Empty slot → muted placeholder (lock icon for the 5th slot when locked). */
function GemPanel({ slots }: { slots: NonNullable<UiPiece["gemSlots"]> }) {
  return (
    <div className="space-y-1">
      {slots.map((s, i) => {
        if (s.gem) {
          const sign = s.gem.value < 0 ? "-" : "+";
          const valueLabel = `${sign}${Math.abs(s.gem.value)}${s.gem.percent ? "%" : ""}`;
          return (
            <div
              key={i}
              className="flex items-center gap-2 font-mono text-[12px] tabular-nums"
              title={`Gem Lv ${s.gem.level} · ${statLong(s.gem.stat)} ${valueLabel}`}
            >
              <img
                src={`/img/items/TI_GEM_${s.gem.type}_${s.gem.level}.webp`}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
              />
              <span className="shrink-0 text-zinc-400">Lv {s.gem.level}</span>
              <span className="flex-1 text-zinc-300">{statLong(s.gem.stat)}</span>
              <span className="shrink-0 text-zinc-100">{valueLabel}</span>
            </div>
          );
        }
        return (
          <div
            key={i}
            className="flex items-center gap-2 text-[12px] text-zinc-600"
            title={s.unlocked ? "Empty gem slot" : "Locked — unlocks at enhance +5"}
          >
            <div className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-dashed border-white/10 bg-white/2">
              {!s.unlocked && (
                <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.4}>
                  <rect x="3" y="6" width="8" height="6" rx="1" />
                  <path d="M5 6 V4.5 a2 2 0 0 1 4 0 V6" />
                </svg>
              )}
            </div>
            <span className="flex-1 italic">
              {s.unlocked ? "Empty" : "Locked"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Resolve a {st, ap, v} stat triple to a display row (icon + long label +
 *  signed value). Used for set p2/p4 effects + Singularity option entries. */
function ResolvedEffectRow({ st, ap, v }: { st: string; ap: string; v: number }) {
  const resolved = resolveOption({ st, ap, v }, 1);
  if (!resolved) return null;
  const sign = resolved.value < 0 ? "" : "+";
  const value = resolved.percent ? `${sign}${resolved.value}%` : `${sign}${resolved.value}`;
  return (
    <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
      <StatIcon stat={resolved.stat} size={16} className="shrink-0" />
      <span className="flex-1 text-zinc-300">{statLong(resolved.stat)}</span>
      <span className="text-emerald-200">{value}</span>
    </div>
  );
}

/** Left-side detail panel — visible at all times. Renders an empty
 *  placeholder when nothing is selected so the layout stays stable (the
 *  grid in the middle doesn't reflow when the user clicks a piece). The
 *  populated state shows the full main / sub / equipped char / set / brk
 *  breakdown that used to live in the right-side `GearDrawer`. */
function ItemDetail({
  piece, equippedChar, game,
}: { piece: UiPiece | null; equippedChar: Character | null; game: GameData | null }) {
  if (!piece) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-md border border-white/6 bg-black/30 text-zinc-500">
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M5 7 H9 M7 5 V9" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-3 text-[12px] font-medium text-zinc-300">No item selected</div>
        <div className="mt-1 text-[11px] leading-snug text-zinc-500">Click a tile in the grid to inspect its main / substats / equipped character.</div>
      </aside>
    );
  }

  const slot = piece.slot ? SLOTS.find((s) => s.id === piece.slot) : null;
  const rarity = RARITY[piece.rarity];
  // 2-pc / 4-pc set bonuses ONLY exist on armor pieces (helmet/armor/gloves/
  // boots) — they carry the set ID in `armorSetId`. Weapons + accessories
  // expose a `setId` too but it's the UniqueOptionID (the per-item passive's
  // group, e.g. "5" on a weapon ≠ Effectiveness Set), NOT a 2-pc/4-pc group.
  // Don't fall back to `setId` here — it falsely matched armor-set IDs whose
  // numeric range collided with UniqueOptionIDs.
  const setEntry = game && piece.armorSetId ? pickSetLevel(game, piece.armorSetId, piece.stars) : null;
  // Class info line: "<Rarity> <Slot>[ <Class> Exclusive]".
  const classLine = piece.classLimit ? `${slot?.label ?? "Item"}    ${piece.classLimit} Exclusive` : slot?.label ?? "Item";

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">

        {/* ── header row: lock + name (singularity gradient if ascended) ── */}
        <div className="flex items-center gap-1.5">
          {piece.locked && (
            <img
              src="/img/ui/inven/CT_Slot_Lock.png"
              alt="Locked"
              title="Locked in-game"
              className="h-4 w-4 shrink-0"
            />
          )}
          <span
            className="truncate font-display text-[15px] font-semibold"
            style={piece.singularity
              ? { background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
              : { color: rarity?.fg ?? "#f4f4f5" }
            }
          >
            {piece.name}{piece.singularity ? " - [Singularity]" : ""}
          </span>
        </div>

        {/* ── icon + rarity/class line + equipped char ── */}
        <div className="flex items-start gap-3">
          <EquipmentIcon piece={piece.iconPiece} size={80} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col text-[11px] leading-tight">
              <span style={{ color: rarity?.fg ?? "#e4e4e7" }} className="font-semibold">
                {rarity?.label ?? piece.rarity}
              </span>
              <span className="text-zinc-400">{classLine}</span>
            </div>
          </div>
          {equippedChar && (
            <CharFace
              charId={equippedChar.charId}
              name={equippedChar.name ?? `#${equippedChar.charId}`}
              size={36}
            />
          )}
        </div>

        {/* ── main stats ── */}
        {/* Prefer the in-game narrative label (e.g. "DMG Increase vs Water"
            for EE conditional mains) over the synthesized short label when
            the build pipeline resolved one — falls back to statLong for
            regular gear mains where no narrative exists. */}
        {piece.main.length > 0 && (
          <div className="space-y-1.5">
            {piece.main.map((m, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[13px] tabular-nums">
                <StatIcon stat={m.stat} size={18} className="shrink-0" />
                <span className="flex-1 text-zinc-200">{m.name ?? statLong(m.stat)}</span>
                <span className="font-semibold text-zinc-50">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── substats (gear) or gems (talisman / EE) ── */}
        {piece.gemSlots ? (
          <GemPanel slots={piece.gemSlots} />
        ) : piece.subs.length > 0 ? (
          <div className="space-y-1">
            {piece.subs.map((s, i) => <SubstatRow key={i} s={s} stars={piece.stars} />)}
          </div>
        ) : null}

        {/* ── quality score (sum of substat ticks / state-aware cap) ── */}
        {(() => {
          const q = computeQuality(piece);
          if (!q) return null;
          const tone = QUALITY_TONE[q.tier];
          return (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <HoverHint
                  className="font-semibold uppercase tracking-wider text-zinc-400"
                  name="Quality"
                  text="Sum of every substat tick (initial roll + reforge procs) vs the cap for the item's CURRENT investment: base 14 (4+4+3+3) plus 1 per reforge already spent. Singularity adds up to 3 extra reforges. So a pristine 6★ caps at 14; fully reforged 20; ascended + fully reforged 23."
                />
                <span className="font-mono tabular-nums">
                  <span className={cx("font-bold", tone.text)}>{q.current}</span>
                  <span className="text-zinc-500"> / {q.max}</span>
                  <span className={cx("ml-2", tone.text)}>{tone.label}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${q.pct}%`, background: tone.bar }}
                />
              </div>
            </div>
          );
        })()}

        {/* ── multi-tier passive (talisman / EE) ── */}
        {/* The +10 entry can be one of two patterns:
              - ADDITIONAL (`isAdd=true`):  a SECOND effect that stacks on top
                of the base.
              - UPGRADE    (`isAdd=false` at unlockLevel > 1): REPLACES the
                base (same conceptual effect, stronger value).
            Visibility rule (talismans + EE both):
              - When NOT YET unlocked (lv < unlockLevel) — ALWAYS show both
                rows regardless of pattern, with the +10 row greyed out. The
                player needs to know what's coming, even for upgrade-style
                items.
              - When unlocked (lv ≥ unlockLevel) — additional keeps both
                visible (they stack); upgrade hides the base (it's been
                superseded by the +10 row, in-game tooltip behaves the same). */}
        {piece.multiTierPassive && (() => {
          const tiers = piece.multiTierPassive.tiers;
          const upgrade = tiers.find((t, i) => i > 0 && !t.isAdd);
          const visible = tiers.filter((t, i) => {
            if (!upgrade) return true;
            // Only hide the base, and only once the upgrade is actually live.
            if (i === 0 && upgrade.active) return false;
            return true;
          });
          return (
            <div className="pt-1">
              <div className="mb-2 flex items-center gap-2">
                {piece.effectIcon && (
                  <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                )}
                <span className="font-mono text-[12px] font-semibold text-zinc-100">
                  {piece.multiTierPassive!.name ?? "Passive"}
                </span>
              </div>
              <div className="space-y-2">
                {visible.map((t, i) => {
                  const eyebrow = t.unlockLevel <= 1
                    ? "Base"
                    : `+${t.unlockLevel} · ${t.isAdd ? "additional" : "upgraded"}`;
                  return (
                    <div
                      key={i}
                      className={cx(
                        "rounded-md border border-white/6 bg-black/25 px-3 py-2 transition-opacity",
                        !t.active && "opacity-40",
                      )}
                    >
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                        {eyebrow}
                      </div>
                      <GameText text={t.desc} className="text-[11px] leading-snug text-zinc-300" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── unique-option passive (weapons / accessories) ── */}
        {/* The "Destruction" / "Aurora" / … effect that scales per breakthrough
            tier. Resolved at build time via TextSkill + BuffTemplet — `text`
            already has the per-tier values substituted. */}
        {piece.passive && (
          <div className="pt-1">
            <div className="mb-2 flex items-center gap-2">
              {piece.effectIcon && (
                <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
              )}
              <span className="font-mono text-[12px] font-semibold text-zinc-100">
                {piece.passive.name ?? "Passive"}
              </span>
              <span className="ml-auto rounded-sm border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                T{piece.bt}
              </span>
            </div>
            <p className="rounded-md border border-white/6 bg-black/25 px-3 py-2 text-[11px] leading-snug text-zinc-300">
              <GameText text={piece.passive.text} />
            </p>
          </div>
        )}

        {/* ── set effect (armor 4-piece or matching set group) ── */}
        {setEntry && (
          <div className="pt-1">
            <div className="mb-2 flex items-center gap-2">
              {piece.setIcon
                ? <img src={`/img/ui/effect/${piece.setIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                : piece.effectIcon
                  ? <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                  : null}
              <span className="font-mono text-[12px] font-semibold text-zinc-100">
                Lv. {setEntry.level.level} {setEntry.name ?? "Set"}
              </span>
            </div>
            {setEntry.desc && (
              <p className="mb-2 text-[11px] leading-snug text-zinc-400">
                <GameText text={setEntry.desc} />
              </p>
            )}
            <div className="space-y-1 rounded-md border border-white/6 bg-black/25 px-3 py-2">
              {setEntry.level.p2 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 shrink-0 font-mono text-zinc-500">2-pc</span>
                  <ResolvedEffectRow st={setEntry.level.p2.st} ap={setEntry.level.p2.ap} v={setEntry.level.p2.v} />
                </div>
              )}
              {setEntry.level.p4 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 shrink-0 font-mono text-zinc-500">4-pc</span>
                  <ResolvedEffectRow st={setEntry.level.p4.st} ap={setEntry.level.p4.ap} v={setEntry.level.p4.v} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Singularity active effect (ascended pieces only) ── */}
        {/* Two rendering layers, in preference order:
            1. `desc` — full in-game sentence (with grade-color + value
               already baked in) rendered through GameText. No standalone
               "S" badge — the grade letter is already in the desc.
            2. `name` + resolved value — used only when desc is missing
               (e.g. TextSkill unavailable at build time). */}
        {piece.singularity && piece.effects.length > 0 && (
          <div className="pt-1">
            <div className="mb-2 text-[11px] font-semibold text-amber-200">
              Active Effect at +15 Enhancement
            </div>
            <div className="space-y-1.5 text-[11px] leading-snug text-zinc-300">
              {piece.effects.map((e, i) => {
                if (e.desc) return <GameText key={i} text={e.desc} className="block wrap-break-word" />;
                const sign = e.value.startsWith("-") ? "" : "+";
                const label = e.name ?? statLong(e.stat);
                return (
                  <div key={i} className="flex items-start gap-2 wrap-break-word">
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="shrink-0 text-zinc-100">{sign}{e.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── screen ──────────────────────────────────────────────────────────────
export interface InventoryScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
}

export function InventoryScreen({ inventory, game }: InventoryScreenProps) {
  // Persist filters / sort / view so the page survives a reload (or tab swap).
  // `selectedId` stays ephemeral — re-opening the drawer to a random item after
  // a reload would be more annoying than useful.
  const [f, setF] = usePersistedState<FilterState>("gs.inv.filters", emptyFilters, FILTER_CODEC);
  const [sort, setSort] = usePersistedState<SortKey>("gs.inv.sort", "enhance");
  const [dir, setDir] = usePersistedState<"asc" | "desc">("gs.inv.dir", "desc");
  const [limit, setLimit] = usePersistedState("gs.inv.limit", 100);
  const [filtersCollapsed, setFiltersCollapsed] = usePersistedState<boolean>("gs.inv.filtersCollapsed", false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ui = useMemo<UiPiece[]>(() => (inventory ? inventory.gear.map((g) => toUiPiece(g, game)) : []), [inventory, game]);

  // Index characters by uid once — every gear row resolves its `equippedBy`
  // against this map (was a linear `.find` per row × 100+ rows × every
  // selection/filter change).
  const charsByUid = useMemo(() => {
    const m = new Map<string, Character>();
    for (const c of inventory?.characters ?? []) m.set(c.uid, c);
    return m;
  }, [inventory]);

  const filtered = useMemo(() => ui.filter((p) => matchesFilters(p, f)), [ui, f]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "stars": cmp = a.stars - b.stars; break;
        case "enhance": cmp = a.enhance - b.enhance; break;
        case "bt": cmp = a.bt - b.bt; break;
        case "name": cmp = a.name.localeCompare(b.name); break;
      }
      // tiebreak: ascended first (purple > gold), then rarity weight
      if (cmp === 0) cmp = Number(a.singularity) - Number(b.singularity);
      return dir === "desc" ? -cmp : cmp;
    });
    return out;
  }, [filtered, sort, dir]);

  const view = sorted.slice(0, limit);
  const selected = selectedId ? sorted.find((p) => p.id === selectedId) ?? null : null;

  // Stable click handler — toggles the selection so a second click clears
  // the detail panel. Stays referentially stable across renders so memoized
  // `GearTile`s skip re-renders when other tiles change.
  const onSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(k); setDir("desc"); }
  }

  if (!inventory || ui.length === 0) {
    return <InventoryEmpty />;
  }

  // 3-column layout: [ItemDetail (always shown, empty placeholder if no
  // selection)] | [tiles grid + sort header] | [collapsible FilterPanel].
  // The page-level title + subtitle were removed in favor of the tab badge
  // up top — see `counts` in App.tsx.
  return (
    <div className="flex h-full min-h-0 flex-1 gap-3 px-4 py-3">
      <ItemDetail
        piece={selected}
        equippedChar={selected?.equippedBy ? charsByUid.get(selected.equippedBy) ?? null : null}
        game={game}
      />
      <div className="min-w-0 flex-1 flex-col flex">
        <SortHeader
          sort={sort} dir={dir} total={ui.length} shown={view.length}
          onSort={toggleSort} limit={limit} onLimitChange={setLimit}
        />
        <div
          className="mt-2 grid gap-1 overflow-y-auto pr-1 grid-cols-[repeat(auto-fill,minmax(96px,1fr))]"
          style={{ maxHeight: "calc(100vh - 180px)" }}
        >
          {view.length === 0
            ? <div className="col-span-full rounded-lg border border-white/5 bg-white/[0.012] px-6 py-12 text-center text-[13px] text-zinc-500">No piece matches the current filters.</div>
            : view.map((p) => {
              const equippedChar = p.equippedBy ? charsByUid.get(p.equippedBy) ?? null : null;
              return (
                <GearTile
                  key={p.id}
                  piece={p}
                  equippedChar={equippedChar}
                  active={p.id === selectedId}
                  onSelect={onSelect}
                />
              );
            })}
        </div>
      </div>
      <FilterPanel
        f={f}
        setF={setF}
        collapsed={filtersCollapsed}
        onToggle={() => setFiltersCollapsed(!filtersCollapsed)}
      />
    </div>
  );
}

function InventoryEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div
        className="grid h-16 w-16 place-items-center rounded-2xl"
        style={{ background: "linear-gradient(135deg, #16EBF1, #9D51FF 60%, #E02BCD)", boxShadow: "0 0 32px rgba(157,81,255,0.45)" }}
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7 V17 L12 21 L20 17 V7 L12 3 Z M4 7 L12 11 L20 7 M12 11 V21" />
        </svg>
      </div>
      <h2 className="font-display text-[18px] font-semibold text-zinc-100">No capture yet</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-zinc-500">
        Run the capture pipeline to import your gear and heroes from the Outerplane client. The Arm capture button up top arms mitmproxy and waits for the game to send <span className="font-mono text-zinc-400">/user/item</span>.
      </p>
    </div>
  );
}
