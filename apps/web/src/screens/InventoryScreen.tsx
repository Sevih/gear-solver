import { memo, useCallback, useMemo, useState } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { cx } from "../design/cx.js";
import { jsonWithSets, usePersistedState } from "../hooks/usePersistedState.js";
import { CharFace, EquipmentIcon, SlotIcon, StarRow, StatIcon } from "../design/EquipmentIcon.js";
import { LockIcon, Pill, RarityPill, SubstatChip } from "../design/Chips.js";
import { CyanButton, GhostButton, GsLabel } from "../design/Shell.js";
import {
  RARITY, SINGULARITY_GRADIENT_H, SLOTS, STAT, TOKENS, statColor,
  type DesignRarity, type SlotId,
} from "../design/tokens.js";
import { toUiPiece, type UiPiece } from "../design/adapter.js";

// ── tiny atoms ──────────────────────────────────────────────────────────
function Search({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx={6} cy={6} r={4} />
      <path d="M9 9 L12 12" strokeLinecap="round" />
    </svg>
  );
}
function ChevronRight({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3 L8 6 L5 9" />
    </svg>
  );
}
function XIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
      <path d="M3 3 L9 9 M3 9 L9 3" />
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

function FilterPanel({ f, setF }: { f: FilterState; setF: (next: FilterState) => void }) {
  const toggle = <T,>(s: Set<T>, v: T): Set<T> => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };
  return (
    <aside className="w-60 shrink-0 overflow-hidden rounded-xl border border-white/[0.07] bg-[oklch(0.19_0.016_270/0.7)] backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/6 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Filters</span>
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

// ── gear row + main stat line ───────────────────────────────────────────
function MainStatLine({ mains }: { mains: UiPiece["main"] }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[13px] tabular-nums">
      {mains.map((m, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-zinc-600">/</span>}
          <StatIcon stat={m.stat} size={16} />
          <span style={{ color: TOKENS.gold }}>{m.value}</span>
        </span>
      ))}
    </span>
  );
}

/** Inline portrait chip — replaces the textual character name; the name lives
 *  in the tooltip. Pulls from /img/characters/faceicon/. */
function EquippedByChip({ charId, name }: { charId: number | string; name: string }) {
  return <CharFace charId={charId} name={name} size={80} />;
}

/** Row / card props share the same shape. Parent passes the resolved
 *  `equippedChar` (looked up once via the `charsByUid` Map in the screen)
 *  + a stable `onSelect(id)` callback so `memo` actually skips renders
 *  when scrolling / filtering / selecting a different row. */
interface GearItemProps {
  piece: UiPiece;
  equippedChar: Character | null;
  active: boolean;
  onSelect: (id: string) => void;
}

const GearRow = memo(function GearRow({ piece, equippedChar, active, onSelect }: GearItemProps) {
  const onClick = useCallback(() => onSelect(piece.id), [onSelect, piece.id]);
  return (
    <div
      onClick={onClick}
      className={cx(
        "group grid cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        active
          ? "border-cyan-400/30 bg-cyan-500/5"
          : "border-white/5 bg-white/[0.012] hover:border-white/10 hover:bg-white/3",
      )}
      // `content-visibility: auto` lets the browser skip layout+paint for
      // rows that aren't in the viewport (CSS-native virtualization, no JS
      // deps). `contain-intrinsic-size` reserves height so the scrollbar
      // stays stable — measured against the actual rendered row (80px icon
      // + ~25px padding).
      style={{
        gridTemplateColumns: "80px minmax(220px,1.3fr) minmax(220px,1.6fr) auto",
        contentVisibility: "auto",
        containIntrinsicSize: "0 105px",
      }}
    >
      <EquipmentIcon piece={piece.iconPiece} size={80} />

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold text-zinc-100">{piece.name}</span>
          {piece.locked && <LockIcon className="h-3.5 w-3.5 text-amber-300/80" />}
        </div>
        <div className="mt-2"><MainStatLine mains={piece.main} /></div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap gap-1">
          {piece.subs.map((s, i) => <SubstatChip key={i} stat={s.stat} value={s.value} lv={s.lv} />)}
        </div>
      </div>

      <div className="flex items-center gap-2 justify-self-end">
        {equippedChar
          ? <EquippedByChip charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} />
          : <span className="font-mono text-[11px] text-zinc-600">unequipped</span>}
        <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400" />
      </div>
    </div>
  );
});

/** Compact card variant of GearRow — same data, vertical layout, suitable for
 *  a responsive grid (auto-fill, min 220px). Used in the "compact" view mode. */
const GearCard = memo(function GearCard({ piece, equippedChar, active, onSelect }: GearItemProps) {
  const onClick = useCallback(() => onSelect(piece.id), [onSelect, piece.id]);
  return (
    <div
      onClick={onClick}
      className={cx(
        "group cursor-pointer rounded-lg border p-3 transition-colors",
        active
          ? "border-cyan-400/30 bg-cyan-500/5"
          : "border-white/5 bg-white/[0.012] hover:border-white/10 hover:bg-white/3",
      )}
      // CSS-native virtualization — see `GearRow` for the rationale. Card
      // intrinsic size is taller (80px icon + name + main + subs).
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 180px" }}
    >
      <div className="flex items-start gap-2">
        <EquipmentIcon piece={piece.iconPiece} size={80} />
        <div className="ml-auto">
          {equippedChar
            ? <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={56} />
            : null}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="truncate text-[13.5px] font-semibold text-zinc-100">{piece.name}</span>
        {piece.locked && <LockIcon className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />}
      </div>
      <div className="mt-1.5"><MainStatLine mains={piece.main} /></div>
      {piece.subs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {piece.subs.map((s, i) => <SubstatChip key={i} stat={s.stat} value={s.value} lv={s.lv} />)}
        </div>
      )}
    </div>
  );
});

// ── sort header ─────────────────────────────────────────────────────────
type SortKey = "stars" | "enhance" | "bt" | "name";
type ViewMode = "list" | "compact";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const Btn = ({ m, children, title }: { m: ViewMode; children: React.ReactNode; title: string }) => (
    <button
      onClick={() => onChange(m)}
      title={title}
      className={cx(
        "grid h-6 w-7 place-items-center transition-colors",
        mode === m ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-white/[0.07] bg-black/30">
      <Btn m="list" title="List view">
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
          <path d="M3 4 H11 M3 7 H11 M3 10 H11" />
        </svg>
      </Btn>
      <Btn m="compact" title="Compact card view">
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.2}>
          <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
          <rect x="7.5" y="2.5" width="4" height="4" rx="0.5" />
          <rect x="2.5" y="7.5" width="4" height="4" rx="0.5" />
          <rect x="7.5" y="7.5" width="4" height="4" rx="0.5" />
        </svg>
      </Btn>
    </div>
  );
}

function SortHeader({
  sort, dir, total, shown, onSort, limit, onLimitChange, viewMode, onViewModeChange,
}: {
  sort: SortKey; dir: "asc" | "desc"; total: number; shown: number;
  onSort: (k: SortKey) => void; limit: number; onLimitChange: (n: number) => void;
  viewMode: ViewMode; onViewModeChange: (m: ViewMode) => void;
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
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
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

// ── drawer ──────────────────────────────────────────────────────────────
function SubstatBar({ s }: { s: UiPiece["subs"][number] }) {
  const meta = STAT[s.stat] ?? { label: s.stat.toUpperCase(), kind: "util" as const, color: "#cbd5e1", icon: null };
  const color = meta.kind === "off" ? "#fbbf24" : meta.kind === "def" ? "#93c5fd" : "#38bdf8";
  const pct = Math.min(100, (s.lv / 6) * 100);
  return (
    <div className="flex items-center gap-2">
      <StatIcon stat={s.stat} size={18} className="w-4.5 shrink-0" />
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}80` }}
        />
      </div>
      <span className="w-16 text-right font-mono text-[13px] tabular-nums" style={{ color: statColor(meta.kind) }}>{s.value}</span>
      <span className="w-8 text-right font-mono text-[10.5px] text-zinc-600">lv{s.lv}</span>
    </div>
  );
}

function GearDrawer({
  piece, equippedChar, onClose,
}: { piece: UiPiece; equippedChar: Character | null; onClose: () => void }) {
  const slot = piece.slot ? SLOTS.find((s) => s.id === piece.slot) : null;
  return (
    <div className="flex h-full w-85 flex-col border-l border-white/8 bg-bg-elev-1 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.8)]">
      <header className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{slot?.label ?? "Item"} detail</span>
        <button onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md border border-white/6 bg-black/30 text-zinc-400 hover:text-zinc-200">
          <XIcon />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-start gap-3">
          <EquipmentIcon piece={piece.iconPiece} size={80} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[16px] font-semibold text-zinc-50">{piece.name}</span>
              {piece.locked && <LockIcon className="h-3.5 w-3.5 text-amber-300/80" />}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <RarityPill rarity={piece.rarity} />
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {piece.stars > 0 && (
                <StarRow count={piece.stars} reforge={piece.reforge.n} size={13} />
              )}
              {piece.singularity && (
                <span
                  className="font-mono text-[10px] uppercase tracking-wider"
                  style={{ background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
                >
                  Singularity
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/6 bg-black/25 px-3 py-2.5">
          <GsLabel>Main stat</GsLabel>
          <div className="mt-1 space-y-1.5">
            {piece.main.map((m, i) => (
              <div key={i} className="flex items-center justify-between">
                <StatIcon stat={m.stat} size={22} />
                <span className="font-mono text-[20px] font-semibold tabular-nums" style={{ color: TOKENS.gold }}>{m.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <span>Enhance +{piece.enhance}</span>
            <span>·</span>
            <span>Breakthrough T{piece.bt}</span>
            {piece.singularity && (
              <>
                <span>·</span>
                <span style={{ background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Ascended</span>
              </>
            )}
          </div>
        </div>

        {piece.subs.length > 0 && (
          <div className="rounded-lg border border-white/6 bg-black/25 px-3 py-2.5">
            <GsLabel>Substats</GsLabel>
            <div className="mt-2 space-y-2">
              {piece.subs.map((s, i) => <SubstatBar key={i} s={s} />)}
            </div>
          </div>
        )}

        {equippedChar && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-400/15 bg-emerald-500/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={64} />
              <div className="leading-tight">
                <div className="text-[10.5px] uppercase tracking-wider text-emerald-300/70">Equipped on</div>
                <div className="text-[13.5px] font-medium text-zinc-100">{equippedChar.name ?? `#${equippedChar.charId}`}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-white/6 px-4 py-3">
        <GhostButton className="flex-1"><LockIcon className="h-3 w-3" />{piece.locked ? "Unlock" : "Lock"}</GhostButton>
        <CyanButton size="sm" className="flex-1">Use in Builder</CyanButton>
      </footer>
    </div>
  );
}

// ── screen ──────────────────────────────────────────────────────────────
export interface InventoryScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  lastCapture: number | null;
}

export function InventoryScreen({ inventory, game, lastCapture }: InventoryScreenProps) {
  // Persist filters / sort / view so the page survives a reload (or tab swap).
  // `selectedId` stays ephemeral — re-opening the drawer to a random item after
  // a reload would be more annoying than useful.
  const [f, setF] = usePersistedState<FilterState>("gs.inv.filters", emptyFilters, FILTER_CODEC);
  const [sort, setSort] = usePersistedState<SortKey>("gs.inv.sort", "enhance");
  const [dir, setDir] = usePersistedState<"asc" | "desc">("gs.inv.dir", "desc");
  const [limit, setLimit] = usePersistedState("gs.inv.limit", 100);
  const [viewMode, setViewMode] = usePersistedState<ViewMode>("gs.inv.view", "list");
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

  // Stable click handler — toggles the selection so a second click closes
  // the drawer. Stays referentially stable across renders so memoized
  // `GearRow`/`GearCard` skip re-renders when other rows change.
  const onSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);
  const onCloseDrawer = useCallback(() => setSelectedId(null), []);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(k); setDir("desc"); }
  }

  if (!inventory || ui.length === 0) {
    return <InventoryEmpty />;
  }

  const captured = lastCapture ? new Date(lastCapture).toLocaleString(undefined, { day: "2-digit", month: "short" }) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-6 pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-zinc-50">Inventory</h1>
          <span className="text-[13px] text-zinc-500">Every captured piece, with resolved stats. Click a row for detail.</span>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="emerald">{ui.length} pieces</Pill>
          {captured && <Pill>last capture · {captured}</Pill>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6 pt-3">
        <FilterPanel f={f} setF={setF} />
        <div className="min-w-0 flex-1 flex-col flex">
          <SortHeader
            sort={sort} dir={dir} total={ui.length} shown={view.length}
            onSort={toggleSort} limit={limit} onLimitChange={setLimit}
            viewMode={viewMode} onViewModeChange={setViewMode}
          />
          <div
            className={cx(
              "mt-2 overflow-y-auto pr-1",
              viewMode === "list"
                ? "space-y-1.5"
                : "grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]",
            )}
            style={{ maxHeight: "calc(100vh - 240px)" }}
          >
            {view.length === 0
              ? <div className="col-span-full rounded-lg border border-white/5 bg-white/[0.012] px-6 py-12 text-center text-[13px] text-zinc-500">No piece matches the current filters.</div>
              : view.map((p) => {
                const equippedChar = p.equippedBy ? charsByUid.get(p.equippedBy) ?? null : null;
                const Item = viewMode === "list" ? GearRow : GearCard;
                return (
                  <Item
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

        {selected && (
          <div className="shrink-0">
            <GearDrawer
              piece={selected}
              equippedChar={selected.equippedBy ? charsByUid.get(selected.equippedBy) ?? null : null}
              onClose={onCloseDrawer}
            />
          </div>
        )}
      </div>
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
