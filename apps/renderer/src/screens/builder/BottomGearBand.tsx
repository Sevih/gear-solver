/**
 * Builder bottom gear band — one card per slot of the selected build.
 */
import { useMemo } from "react";
import type { Character, GameData, GearPiece } from "@gear-solver/core";
import type { SlotId } from "../../design/tokens.js";
import { toUiPiece } from "../../design/adapter.js";
import { ResultItemDetail } from "../../design/ResultGearDetail.js";
import { projectPieceForReforge } from "../../lib/solver/engine.js";
import type { SolveBuild } from "../../lib/solver/types.js";
import type { SlotDiff } from "../../lib/buildDiff.js";
import type { ReforgeContext } from "./reforge.js";

/** Slots shown in the bottom card band — all 8 pieces, in the same order
 *  the in-game build screen displays them. EE and Talisman are full
 *  citizens of the solver scope (their mains contribute via the IOT_BUFF
 *  channel and the filter chips below count them). */
const RESULT_GEAR_SLOTS: SlotId[] = [
  "weapon", "exclusive", "helmet", "armor",
  "accessory", "talisman", "gloves", "boots",
];

/* ─────────────────────────────────────────────────────────────────────────
 * Bottom gear band — one card per main slot for the selected result
 * ───────────────────────────────────────────────────────────────────────── */
export function BottomGearBand({
  build, diff, game, reforge, charsByUid, excludedPieceUids, onToggleExclude,
}: {
  build: SolveBuild | null;
  /** The build's per-slot diff vs the hero's loadout (`diffBuildVsLoadout`) —
   *  the piece each card shows. */
  diff: SlotDiff[];
  game: GameData | null;
  /** Reforge context the displayed build was solved with — when the mode is
   *  not "disable", each card re-runs the deterministic `projectPieceForReforge`
   *  so its main/substats match the build's projected `finalStats` instead of
   *  the pieces' current rolls (the engine scored the projected clones). */
  reforge: ReforgeContext;
  /** Roster indexed by uid — resolves each piece's `equippedBy` to a character. */
  charsByUid: Map<string, Character>;
  /** Global exclusion set + toggle — drives the inventory-style card's exclude
   *  footer so a trash roll can be excluded right from the results. */
  excludedPieceUids?: Set<string>;
  onToggleExclude?: (uid: string) => void;
}) {
  // Map engine slot → display piece for the selected build (the shared diff
  // already resolved each uid to its piece and slot) and, when a reforge mode
  // is active, swap in the projected clone.
  // `projectPieceForReforge` self-filters (returns the original for Talisman/EE,
  // "disable" mode, or when there's nothing left to project), so identity
  // inequality is a reliable "was projected" signal.
  const pieceBySlot = useMemo(() => {
    const map = new Map<string, { piece: GearPiece; equippedBy: string | null; addedTicks: number[] }>();
    for (const { slot, proposed: original } of diff) {
      const piece = game ? projectPieceForReforge(original, game, reforge.reforgeMode, reforge.priority, reforge.tickWeights ?? undefined) : original;
      const reforged = piece !== original;
      // Per-sub reforge procs the projection added (delta of total ticks vs the
      // captured piece) — `simulateReforges` clones subs 1:1 in order, so index
      // alignment holds. Surfaces "which sub got how many extra ticks" on the
      // card instead of just a silently-higher value.
      const addedTicks = reforged && piece.subs.length === original.subs.length
        ? piece.subs.map((s, i) => (s.ticks ?? 0) - (original.subs[i]?.ticks ?? 0))
        : [];
      map.set(slot, { piece, equippedBy: original.equippedBy, addedTicks });
    }
    return map;
  }, [diff, game, reforge]);

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {RESULT_GEAR_SLOTS.map((slot) => {
        // RESULT_GEAR_SLOTS uses design names — convert "talisman" back to
        // the engine "ooparts" lookup key.
        const engineSlot = slot === "talisman" ? "ooparts" : slot;
        const entry = pieceBySlot.get(engineSlot) ?? null;
        const piece = entry?.piece ?? null;
        // Only Talisman / EE carry gems — surface the build's recommended
        // gem allocation there so the displayed stats (computed WITH those
        // gems in SOLVE CP) are reachable, not silently mismatched against
        // the piece's currently-socketed gems.
        const recommendedGems = slot === "talisman"
          ? build?.gemAllocation?.talisman
          : slot === "exclusive"
            ? build?.gemAllocation?.ee
            : undefined;
        const equippedBy = entry?.equippedBy ?? null;
        // The character currently wearing the piece (any owner) — mirrors the
        // Inventory card's header portrait. Excluded = this piece is in the
        // global "never use" set, for the card's exclude-footer state.
        const equippedChar = equippedBy ? (charsByUid.get(equippedBy) ?? null) : null;
        const excluded = piece ? (excludedPieceUids?.has(piece.uid) ?? false) : false;
        // Talisman / EE: show the SOLVER'S gem allocation (what the displayed
        // stats assume in SOLVE CP), not the captured piece's sockets — override
        // the gem-bearing piece's slots so the inventory-style GemPanel renders
        // the recommendation. (The alloc is slot-aligned, 0 = empty.)
        const pieceForCard = piece && recommendedGems && recommendedGems.some((id) => id > 0)
          ? { ...piece, gemSlots: recommendedGems }
          : piece;
        return <GearCard key={slot} slot={slot} piece={pieceForCard} game={game} equippedChar={equippedChar} excluded={excluded} onToggleExclude={onToggleExclude} addedTicks={entry?.addedTicks} />;
      })}
    </div>
  );
}

/** A SOLVE-results gear card. Renders the FULL duplicated Inventory inspect
 *  panel (`ResultItemDetail`: same container, scroll wrapper, equipped-char
 *  portrait, exclude footer, empty state) so the results look pixel-identical to
 *  the Inventory tab's left card. The piece (already reforge-projected upstream
 *  in `BottomGearBand`) goes through the same `toUiPiece` adapter. */
function GearCard({ piece, game, equippedChar, excluded, onToggleExclude, addedTicks }: {
  slot: SlotId;
  piece: GearPiece | null;
  game: GameData | null;
  /** Character currently wearing the piece (any owner) — header portrait. */
  equippedChar?: Character | null;
  /** This piece is in the global exclusion set — exclude-footer state. */
  excluded?: boolean;
  /** Toggle the piece's exclusion (App-owned). Gates the exclude footer. */
  onToggleExclude?: (uid: string) => void;
  /** Per-sub reforge procs the projection added — tick markers on the subs. */
  addedTicks?: number[];
}) {
  // Adapt the (reforge-projected) engine piece through the same adapter the
  // Inventory tab uses, then render the duplicated inspect panel verbatim.
  const ui = piece && game ? toUiPiece(piece, game) : null;
  return (
    <ResultItemDetail
      piece={ui}
      equippedChar={equippedChar ?? null}
      game={game}
      excluded={excluded}
      onToggleExclude={onToggleExclude}
      addedTicks={addedTicks}
    />
  );
}
