/**
 * Inventory item detail — the inspect panel of the selected piece.
 */
import type { Character, GameData } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import type { UiPiece } from "../../design/adapter.js";
// Quality-tier UI tone + detail helpers live in design/GearDetail (shared with
// the Builds tab's hover tooltip so both render the same inspect panel).
import { GearDetailBody } from "../../design/GearDetail.js";

// ── detail ──────────────────────────────────────────────────────────────

/** Left-side detail panel — visible at all times. Renders an empty
 *  placeholder when nothing is selected so the layout stays stable (the
 *  grid in the middle doesn't reflow when the user clicks a piece). The
 *  populated state shows the full main / sub / equipped char / set / brk
 *  breakdown that used to live in the right-side `GearDrawer`. */
export function ItemDetail({
  piece, equippedChar, game, excluded, onToggleExclude,
}: { piece: UiPiece | null; equippedChar: Character | null; game: GameData | null; excluded?: boolean; onToggleExclude?: (uid: string) => void }) {
  if (!piece) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-md border border-white/6 bg-black/30 text-white/70">
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M5 7 H9 M7 5 V9" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-3 text-[12px] font-medium text-white">No item selected</div>
        <div className="mt-1 text-[11px] leading-snug text-white/70">Click a tile in the grid to inspect its main / substats / equipped character.</div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <GearDetailBody piece={piece} game={game} equippedChar={equippedChar} />
      </div>
      {onToggleExclude && (
        <div className="shrink-0 border-t border-white/8 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onToggleExclude(piece.id)}
            title="Globally exclude this piece from every solve (e.g. trash rolls). Also via right-click on the tile."
            className={cx(
              "flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
              excluded
                ? "border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                : "border-white/10 bg-white/3 text-white/80 hover:bg-white/6",
            )}
          >
            {excluded ? "⊘ Excluded from solver — include" : "Exclude from solver"}
          </button>
        </div>
      )}
    </aside>
  );
}
