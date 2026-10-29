/**
 * Inventory grid virtualization — the tile window follows the scroll
 * container's height. Same geometry as `VirtualGearGrid` (tile size, gap,
 * overscan, column math), driven without a DOM: the container's rect and
 * scroll offset are fed by hand.
 */
import { describe, expect, it } from "vitest";
import { Virtualizer } from "@tanstack/react-virtual";
import { GRID_OVERSCAN, TILE_GAP, TILE_SIZE, gridColumns } from "../src/screens/inventory/VirtualGearGrid.js";

const PIECES = 1500;
const WIDTH = 1000; // grid column of a ~1480px window, beside the 320px detail panel

/** Tiles mounted for a container `height` px tall scrolled to `offset`. */
function mountedTiles(height: number, offset = 0): number {
  const cols = gridColumns(WIDTH);
  const rows = Math.ceil(PIECES / cols);
  const v = new Virtualizer<Element, Element>({
    count: rows,
    getScrollElement: () => ({}) as Element, // never touched: rect and offset come from the observers below
    estimateSize: () => TILE_SIZE + TILE_GAP,
    overscan: GRID_OVERSCAN,
    scrollToFn: () => {},
    observeElementRect: (_i, cb) => { cb({ width: WIDTH, height }); return () => {}; },
    observeElementOffset: (_i, cb) => { cb(offset, false); return () => {}; },
  });
  v._willUpdate();
  return v.getVirtualItems().reduce((n, r) => n + Math.min(cols, PIECES - r.index * cols), 0);
}

describe("inventory grid window", () => {
  const cols = gridColumns(WIDTH);
  const rowH = TILE_SIZE + TILE_GAP;

  it("packs 10 columns at 1000px", () => {
    expect(cols).toBe(10);
  });

  it("mounts every tile when the container grows to the whole list (unbounded height)", () => {
    const fullHeight = Math.ceil(PIECES / cols) * rowH;
    expect(mountedTiles(fullHeight)).toBe(PIECES);
  });

  it("mounts about one window of tiles when the container height is bounded", () => {
    // 720px window (the app's minimum) minus header and status bar → ~600px of grid.
    const height = 600;
    const visibleRows = Math.ceil(height / rowH);
    const n = mountedTiles(height);
    expect(n).toBeLessThanOrEqual((visibleRows + GRID_OVERSCAN) * cols);
    expect(n).toBeLessThan(PIECES / 10);
  });

  it("keeps the window size flat while scrolling deep into the list", () => {
    const height = 900;
    const top = mountedTiles(height, 0);
    const deep = mountedTiles(height, 100 * rowH);
    expect(deep).toBeLessThanOrEqual((Math.ceil(height / rowH) + 2 * GRID_OVERSCAN) * cols);
    expect(deep).toBeGreaterThanOrEqual(top);
  });
});
