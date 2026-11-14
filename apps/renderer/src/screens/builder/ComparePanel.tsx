/**
 * Builder "Compare" panel — the result pinned in the table (left) next to the
 * selected one, or the hero's current loadout (right): every solver stat, the
 * table's ratings, the score and the CP with the Δ, then the eight slots as two
 * rows of tiles each, the slots whose piece differs highlighted and the
 * identical ones dimmed. Logic in `compareBuilds`.
 */
import { useMemo, type ReactNode } from "react";
import type { GameData, GearPiece } from "@gear-solver/core";
import { SlotMini, StatIcon } from "../../design/EquipmentIcon.js";
import { GAME_GEAR_GRID, toEngineSlot, SLOT_BY } from "../../design/tokens.js";
import { toUiPiece } from "../../design/adapter.js";
import { cx } from "../../design/cx.js";
import { compareBuilds, type AxisCompare, type CompareSide, type SlotCompare } from "../../lib/solver/compareBuilds.js";
import { SOLVER_STATS, TABLE_RATINGS } from "./statColumns.js";
import { critCellParts } from "./critCell.js";

/** One side as the panel labels it. */
export interface ComparePanelSide {
  title: string;
  side: CompareSide;
  /** Slots that change vs the hero's current loadout (`diffBuildVsLoadout`,
   *  live) — 0 for the loadout itself. */
  swaps: number;
}

export function ComparePanel({
  pinned, other, vsLoadout, canPickSelected, pieceByUid, game, compact = false, onToggleVsLoadout, onClose,
}: {
  pinned: ComparePanelSide;
  /** The selected build, or the current loadout (`vsLoadout`, or no row
   *  selected). */
  other: ComparePanelSide;
  /** The right side is the hero's current loadout. */
  vsLoadout: boolean;
  /** A row other than the pinned one is selected — the "vs loadout" toggle
   *  can switch back to it. */
  canPickSelected: boolean;
  pieceByUid: ReadonlyMap<string, GearPiece>;
  game: GameData | null;
  /** Compact tiles (Settings › Display › Compact result cards). */
  compact?: boolean;
  onToggleVsLoadout: () => void;
  /** Close the panel — unpins the build. */
  onClose: () => void;
}) {
  const cmp = useMemo(() => compareBuilds(pinned.side, other.side, pieceByUid), [pinned.side, other.side, pieceByUid]);
  const bySlot = useMemo(() => new Map(cmp.slots.map((s) => [s.slot, s])), [cmp.slots]);
  const tile = compact ? 36 : 48;
  // The loadout's swaps are 0: the line then reads the pinned build's.
  const swaps = vsLoadout ? pinned.swaps : other.swaps;
  const same = cmp.differing === 0 && !vsLoadout && pinned.side === other.side;
  const ratingLabel = new Map(TABLE_RATINGS.map((r) => [r.key, r.label]));
  const statMeta = new Map(SOLVER_STATS.map((s) => [s.key, s]));
  const rows: { cmp: AxisCompare; icon: ReactNode; unit: string; title: string }[] = [
    ...(cmp.cp.a != null || cmp.cp.b != null ? [{ cmp: cmp.cp, icon: <AxisLabel>CP</AxisLabel>, unit: "", title: "Combat Power" }] : []),
    { cmp: cmp.score, icon: <AxisLabel className="text-amber-300">Score</AxisLabel>, unit: "", title: "Aggregate priority-weighted score" },
    ...cmp.stats.map((c) => {
      const s = statMeta.get(c.key)!;
      return { cmp: c, icon: <StatIcon stat={s.iconKey} size={12} title={null} />, unit: s.unit, title: s.label };
    }),
    ...cmp.ratings.map((c) => ({ cmp: c, icon: <AxisLabel>{ratingLabel.get(c.key) ?? c.key}</AxisLabel>, unit: "", title: ratingLabel.get(c.key) ?? c.key })),
  ];
  return (
    <section className="shrink-0 rounded-lg border border-cyan-400/20 bg-bg-elev-2 p-2" aria-label="Compare builds">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Compare</span>
          <span className="text-[10.5px] tabular-nums text-white/55" data-compare-summary>
            {cmp.differing} piece{cmp.differing === 1 ? "" : "s"} differ, {swaps} swap{swaps === 1 ? "" : "s"} vs loadout
          </span>
          {same && <span className="text-[10.5px] italic text-white/45">Select another row to compare.</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-pressed={vsLoadout}
            onClick={onToggleVsLoadout}
            disabled={vsLoadout && !canPickSelected}
            title={vsLoadout
              ? (canPickSelected ? "Compare with the selected row instead" : "Select another row to compare with it")
              : "Compare with the hero's current loadout (gear as captured)"}
            className={cx(
              "inline-flex h-6 items-center rounded-md border px-2 text-[10.5px] font-medium transition-colors",
              vsLoadout ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200" : "border-white/8 bg-white/3 text-white/80 hover:bg-white/6",
              vsLoadout && !canPickSelected && "cursor-not-allowed opacity-60",
            )}
          >
            vs loadout
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close the comparison (unpins the build)"
            aria-label="Close the comparison"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/8 bg-white/3 text-[12px] text-white/70 hover:bg-white/6"
          >
            ×
          </button>
        </div>
      </header>
      <div className="mt-1.5 flex flex-wrap items-start gap-3">
        <TileColumn title={`📌 ${pinned.title}`} swaps={pinned.swaps} side="a" bySlot={bySlot} game={game} size={tile} />
        <div
          className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-4 gap-y-0.5 font-mono text-[10.5px] tabular-nums"
          data-compare-stats
        >
          {rows.map((r) => <AxisRow key={r.cmp.key} {...r} pinnedStats={pinned.side} otherStats={other.side} />)}
        </div>
        <TileColumn title={other.title} swaps={other.swaps} side="b" bySlot={bySlot} game={game} size={tile} />
      </div>
    </section>
  );
}

function AxisLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("text-[9px] uppercase tracking-wider text-zinc-400", className)}>{children}</span>;
}

/** Display rounding of the results table: integer at |v| ≥ 100, else 0.1. */
function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

/** A side's value; crit past the sheet's 100 prints "100%⁺N" like the table. */
function Value({ v, unit, crit }: { v: number | null; unit: string; crit?: CompareSide["finalStats"] }) {
  if (v == null) return <>—</>;
  if (crit) {
    const { shown, over } = critCellParts(crit);
    if (over > 0) return <>{`${round(shown)}${unit}`}<sup className="ml-px text-[7.5px] leading-none text-amber-300">+{over}</sup></>;
  }
  return <>{`${round(v)}${unit}`}</>;
}

function AxisRow({ cmp, icon, unit, title, pinnedStats, otherStats }: {
  cmp: AxisCompare;
  icon: ReactNode;
  unit: string;
  title: string;
  pinnedStats: CompareSide;
  otherStats: CompareSide;
}) {
  const d = cmp.delta != null ? round(cmp.delta) : null;
  const tone = d == null || d === 0 ? "text-white/40" : d > 0 ? "text-emerald-300" : "text-rose-300";
  const crit = cmp.key === "critRate";
  return (
    <div className="grid grid-cols-[3.25rem_1fr_1fr_3.5rem] items-center gap-1.5" title={title}>
      <span className="flex items-center">{icon}</span>
      <span className="text-right text-white"><Value v={cmp.a} unit={unit} crit={crit ? pinnedStats.finalStats : undefined} /></span>
      <span className="text-right text-white"><Value v={cmp.b} unit={unit} crit={crit ? otherStats.finalStats : undefined} /></span>
      <span className={cx("text-right text-[9.5px]", tone)} data-delta>
        {d == null ? "" : d === 0 ? "=" : `${d > 0 ? "+" : ""}${d}${unit}`}
      </span>
    </div>
  );
}

/** One side's eight slots in the game's equipment grid (two rows of four). */
function TileColumn({ title, swaps, side, bySlot, game, size }: {
  title: string;
  swaps: number;
  side: "a" | "b";
  bySlot: ReadonlyMap<string, SlotCompare>;
  game: GameData | null;
  size: number;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1" data-compare-side={side}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10.5px] font-semibold text-white/80">{title}</span>
        <span className="text-[9.5px] tabular-nums text-white/45">{swaps} swap{swaps === 1 ? "" : "s"}</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {GAME_GEAR_GRID.map((slot) => {
          const s = bySlot.get(toEngineSlot(slot));
          const piece = s ? s[side] : null;
          const differs = s?.differs ?? false;
          const label = SLOT_BY[slot]?.label ?? slot;
          return (
            <div
              key={slot}
              data-slot={slot}
              data-differs={differs ? "true" : undefined}
              title={`${label}: ${piece?.name ?? "empty"}${differs ? " — differs" : ""}`}
              className={cx("rounded", differs ? "ring-1 ring-amber-300/80" : "opacity-40")}
            >
              <SlotMini slot={slot} piece={piece && game ? toUiPiece(piece, game).iconPiece : null} size={size} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
