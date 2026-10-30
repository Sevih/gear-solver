/**
 * Inventory gear grid — virtualized grid of gear tiles.
 */
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Character } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import { EquipmentIcon } from "../../design/EquipmentIcon.js";
import type { UiPiece } from "../../design/adapter.js";

/** Common props for the grid card — parent passes the resolved
 *  `equippedChar` (looked up once via the `charsByUid` Map in the screen)
 *  + a stable `onSelect(id)` callback so `memo` actually skips renders
 *  when scrolling / filtering / selecting a different row. */
interface GearItemProps {
  piece: UiPiece;
  equippedChar: Character | null;
  active: boolean;
  onSelect: (id: string) => void;
  /** Globally excluded from the solver (right-click toggles it). */
  excluded?: boolean;
  /** Stable handler (App-owned, useCallback) so the memo stays effective. */
  onToggleExclude?: (id: string) => void;
  /** In the Scrap value card's selection (Ctrl+click toggles it). */
  selected?: boolean;
  /** Stable handler (screen-owned, useCallback), same as `onToggleExclude`. */
  onToggleSelect?: (id: string) => void;
}

/** Icon-only grid tile — clicking it surfaces the full detail in the left
 *  ItemDetail panel. Keeping the tile down to ~96px lets us pack ~10 columns
 *  on a 1480px window instead of ~6 with the old name+stats card.
 *  Overlays:
 *    - top-left:  "E" badge when equipped (white-on-black, replaces the
 *                 character portrait — too noisy at this density).
 *    - bottom-left, above the EquipmentIcon's own T<n> tier badge: the
 *                 in-game CT_Slot_Lock sprite, served at
 *                 /img/ui/inven/CT_Slot_Lock.webp.
 *    - top-left corner: amber check when the piece is in the Scrap value
 *                 card's selection (coexists with the exclusion style).
 *  The displayed piece is conveyed by a soft cyan halo (ring + outer glow)
 *  rather than a hard border so the focus reads as ambient light, not a frame. */
const GearTile = memo(function GearTile({ piece, equippedChar, active, onSelect, excluded, onToggleExclude, selected, onToggleSelect }: GearItemProps) {
  // Ctrl+click toggles the selection without touching the panel; a plain
  // click goes to the screen, which decides (selection mode or not).
  const onClick = useCallback((e: MouseEvent) => {
    if (onToggleSelect && (e.ctrlKey || e.metaKey)) onToggleSelect(piece.id);
    else onSelect(piece.id);
  }, [onSelect, onToggleSelect, piece.id]);
  // Right-click toggles global solver exclusion — the discoverable surface is
  // the detail panel's button, this is the power-user shortcut.
  const onCtx = useCallback((e: MouseEvent) => {
    if (!onToggleExclude) return;
    e.preventDefault();
    onToggleExclude(piece.id);
  }, [onToggleExclude, piece.id]);
  return (
    <button
      onClick={onClick}
      onContextMenu={onCtx}
      title={[
        piece.name,
        selected && "selected (Ctrl+click to unselect)",
        excluded && "excluded from the solver (right-click to include)",
      ].filter(Boolean).join(" — ")}
      className={cx(
        "group relative grid place-items-center rounded-lg border-2 p-0 transition-all",
        // Selection halo: thicker (2px) cyan stroke hugging the tile edge,
        // plus a two-layer glow - a tight bright inner bloom for "shine"
        // and a wider soft aura around it. Lateral whitespace between
        // ring and art is removed by sizing the icon to fit the grid
        // column (see size below).
        active
          ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_8px_0_rgba(34,211,238,0.9),0_0_22px_4px_rgba(34,211,238,0.5)]"
          : excluded
            ? "border-rose-400/60 bg-rose-500/5"
            : "border-white/5 bg-white/[0.012] hover:border-white/15 hover:bg-white/3",
      )}
    >
      {/* Icon size tuned to grid column min (96px) minus the 4px border so
          the cyan stroke sits right on the icon's visual edge with no
          leftover lateral whitespace. Excluded pieces are dimmed. */}
      <EquipmentIcon piece={piece.iconPiece} size={92} className={excluded ? "opacity-40" : undefined} />
      {excluded && (
        <span
          title="Excluded from the solver (right-click to include)"
          className="pointer-events-none absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500/85 text-[10px] font-bold leading-none text-white"
        >
          ⊘
        </span>
      )}
      {selected && (
        <span
          title="Selected"
          className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 grid h-3.5 w-3.5 place-items-center rounded-br-md rounded-tl-md bg-amber-400 text-[9px] font-bold leading-none text-black"
        >
          ✓
        </span>
      )}
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
          src="/img/ui/inven/CT_Slot_Lock.webp"
          alt="Locked"
          className="pointer-events-none absolute left-2.5 bottom-10.5 h-4.5 w-4.5"
        />
      )}
    </button>
  );
});

// ── virtualized grid ────────────────────────────────────────────────────
/** Row-virtualized tile grid built on @tanstack/react-virtual. Columns are
 *  derived from the live container width (ResizeObserver) so the grid
 *  reflows when the side panels open/close or the window resizes. Only the
 *  visible rows + a small overscan window are mounted as React subtrees,
 *  which keeps DOM/JS footprint flat regardless of inventory size — the
 *  legacy non-virtualized grid mounted every GearTile up-front, which
 *  ballooned past 2k mounted components on heavy inventories. The window is
 *  the scroll container's height, so it needs a bounded parent (App's `main`
 *  has a fixed height): an auto-height container grows to the whole list and
 *  every row is "visible" again. */
export const TILE_SIZE = 96;
export const TILE_GAP = 4;
/** Rows mounted past each edge of the visible window. */
export const GRID_OVERSCAN = 4;
/** Column math: same packing logic as the old `repeat(auto-fill, minmax(96px, 1fr))`.
 *  Min 1 column so the math doesn't blow up before the first ResizeObserver
 *  callback fires (width=0 at first paint). */
export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width + TILE_GAP) / (TILE_SIZE + TILE_GAP)));
}
export function VirtualGearGrid({
  items, selectedId, onSelect, charsByUid, excludedPieces, onToggleExclude, selection, onToggleSelect,
}: {
  items: UiPiece[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  charsByUid: Map<string, Character>;
  excludedPieces?: Set<string>;
  onToggleExclude?: (id: string) => void;
  selection?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // ResizeObserver keeps `width` synced to the scroll container. We can't
  // rely on a one-shot measurement because layout shifts (filter modal
  // open/close, devtools dock toggle, …) all change available space.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cols = gridColumns(width);
  const rowCount = Math.ceil(items.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + TILE_GAP,
    overscan: GRID_OVERSCAN,
  });

  return (
    <div ref={parentRef} className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
      {items.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.012] px-6 py-12 text-center text-[13px] text-white">
          No piece matches the current filters.
        </div>
      ) : (
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vrow) => {
            const start = vrow.index * cols;
            const rowItems = items.slice(start, start + cols);
            return (
              <div
                key={vrow.key}
                style={{
                  position: "absolute",
                  top: vrow.start,
                  left: 0,
                  width: "100%",
                  height: vrow.size,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: `${TILE_GAP}px`,
                }}
              >
                {rowItems.map((p) => {
                  const ec = p.equippedBy ? charsByUid.get(p.equippedBy) ?? null : null;
                  return (
                    <GearTile
                      key={p.id}
                      piece={p}
                      equippedChar={ec}
                      active={p.id === selectedId}
                      onSelect={onSelect}
                      excluded={excludedPieces?.has(p.id) ?? false}
                      onToggleExclude={onToggleExclude}
                      selected={selection?.has(p.id) ?? false}
                      onToggleSelect={onToggleSelect}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
