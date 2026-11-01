/**
 * Inventory item detail — the inspect panel of the selected piece.
 */
import type { Character, GameData } from "@gear-solver/core";
import type { UiPiece } from "../../design/adapter.js";
// The piece card is shared with the Builds / Presets tooltips and the
// Builder's result cards (design/GearCard).
import { GearCardPanel } from "../../design/GearCard.js";

// ── detail ──────────────────────────────────────────────────────────────

/** Left-side detail panel — visible at all times. Renders an empty
 *  placeholder when nothing is selected so the layout stays stable (the
 *  grid in the middle doesn't reflow when the user clicks a piece). The
 *  populated state shows the full main / sub / equipped char / set / brk
 *  breakdown that used to live in the right-side `GearDrawer`. */
export function ItemDetail({
  piece, equippedChar, game, excluded, onToggleExclude, onOptimizeWearer,
}: {
  piece: UiPiece | null;
  equippedChar: Character | null;
  game: GameData | null;
  excluded?: boolean;
  onToggleExclude?: (uid: string) => void;
  /** Open the Builder on the piece's wearer — the portrait in the card and
   *  "Optimize wearer →" next to "Never use" (greyed out on a free piece). */
  onOptimizeWearer?: (heroUid: string) => void;
}) {
  return (
    <GearCardPanel
      piece={piece}
      equippedChar={equippedChar}
      game={game}
      excluded={excluded}
      onToggleExclude={onToggleExclude}
      onOptimizeWearer={onOptimizeWearer}
      effects="card"
      emptyLabel="No item selected"
      emptyHint="Click a tile in the grid to inspect its main / substats / equipped character."
      excludeHint="Never use this piece in any solve (e.g. trash rolls). Also via right-click on the tile."
    />
  );
}
