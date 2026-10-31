/**
 * Builder bottom gear band — one card per slot of the selected build.
 */
import { useMemo } from "react";
import type { Character, GameData, GearPiece } from "@gear-solver/core";
import { GAME_GEAR_GRID, toEngineSlot, type SlotId } from "../../design/tokens.js";
import { toUiPiece } from "../../design/adapter.js";
import { ResultItemDetail } from "../../design/ResultGearDetail.js";
import { projectPieceForReforge } from "../../lib/solver/engine.js";
import { rerollPotential } from "../../lib/solver/reroll.js";
import type { SolveBuild } from "../../lib/solver/types.js";
import type { SlotDiff } from "../../lib/buildDiff.js";
import type { ReforgeContext } from "./reforge.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Bottom gear band — one card per main slot for the selected result
 * ───────────────────────────────────────────────────────────────────────── */
export function BottomGearBand({
  build, diff, game, reforge, charsByUid, presetsOf, excludedPieceUids, onToggleExclude, compact = false,
}: {
  build: SolveBuild | null;
  /** The build's per-slot diff vs the hero's loadout (`diffBuildVsLoadout`) —
   *  the piece each card shows. */
  diff: SlotDiff[];
  game: GameData | null;
  /** Reforge context the displayed build was solved with — when the mode is
   *  not "disable" (or the Transistone potential is on), each card re-runs the deterministic `projectPieceForReforge`
   *  so its main/substats match the build's projected `finalStats` instead of
   *  the pieces' current rolls (the engine scored the projected clones). */
  reforge: ReforgeContext;
  /** Roster indexed by uid — resolves each piece's `equippedBy` to a character. */
  charsByUid: Map<string, Character>;
  /** In-game presets holding a piece, other than the one being optimized
   *  (names, best-ranked first) — "from preset ‹name›" on its card. */
  presetsOf?: (uid: string) => string[];
  /** Global exclusion set + toggle — drives the inventory-style card's exclude
   *  footer so a trash roll can be excluded right from the results. */
  excludedPieceUids?: Set<string>;
  onToggleExclude?: (uid: string) => void;
  /** Compact cards (Settings › Solver › Compact result cards). */
  compact?: boolean;
}) {
  // Map engine slot → display piece for the selected build (the shared diff
  // already resolved each uid to its piece and slot) and, when a reforge mode
  // is active, swap in the projected clone.
  // `projectPieceForReforge` self-filters (returns the original for Talisman/EE,
  // "disable" mode without the Transistone potential, or when there's nothing
  // left to project), so identity
  // inequality is a reliable "was projected" signal.
  const pieceBySlot = useMemo(() => {
    const map = new Map<string, { piece: GearPiece; equippedBy: string | null; addedTicks: number[]; transistoneTicks: number[] }>();
    for (const { slot, proposed: original } of diff) {
      const reroll = reforge.rerollPotential ?? false;
      const piece = game ? projectPieceForReforge(original, game, reforge.reforgeMode, reforge.priority, reforge.tickWeights ?? undefined, reroll) : original;
      const reforged = piece !== original;
      // Ticks the Transistone potential added (projected first, on the captured
      // piece — the same `rerollPotential` call the projection made).
      const pot = reforged && reroll ? rerollPotential(original, game, { priority: reforge.priority }) : null;
      const transistoneTicks = pot ? original.subs.map((_, i) => (i === pot.index ? pot.ticks : 0)) : [];
      // Per-sub reforge procs the projection added (delta of total ticks vs the
      // captured piece, minus the Transistone ticks) — `simulateReforges` clones
      // subs 1:1 in order, so index alignment holds. Surfaces "which sub got how
      // many extra ticks" on the card instead of just a silently-higher value.
      const addedTicks = reforged && piece.subs.length === original.subs.length
        ? piece.subs.map((s, i) => (s.ticks ?? 0) - (original.subs[i]?.ticks ?? 0) - (transistoneTicks[i] ?? 0))
        : [];
      map.set(slot, { piece, equippedBy: original.equippedBy, addedTicks, transistoneTicks });
    }
    return map;
  }, [diff, game, reforge]);

  // All 8 pieces (EE and Talisman are full citizens of the solver scope: their
  // mains contribute via the IOT_BUFF channel) on the game's equipment screen
  // grid, 4 × 2, once four w-80 cards fit beside the Builder's w-72 column:
  // 4 × 320 + 3 × 8 gaps + 288 + 8 gap + 16 padding = 1616 px. Compact cards
  // are w-56: 4 × 224 + 3 × 8 + 288 + 8 + 16 = 1232 px. Narrower, the same
  // order wraps.
  return (
    <div className={compact
      ? "flex shrink-0 flex-wrap gap-2 min-[1232px]:grid min-[1232px]:grid-cols-[repeat(4,max-content)]"
      : "flex shrink-0 flex-wrap gap-2 min-[1616px]:grid min-[1616px]:grid-cols-[repeat(4,max-content)]"}>
      {GAME_GEAR_GRID.map((slot) => {
        // The diff is keyed by engine slot ("ooparts" for the talisman).
        const engineSlot = toEngineSlot(slot);
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
        const fromPresets = piece ? presetsOf?.(piece.uid) : undefined;
        return <GearCard key={slot} slot={slot} piece={pieceForCard} game={game} equippedChar={equippedChar} fromPresets={fromPresets} excluded={excluded} onToggleExclude={onToggleExclude} addedTicks={entry?.addedTicks} transistoneTicks={entry?.transistoneTicks} compact={compact} />;
      })}
    </div>
  );
}

/** A SOLVE-results gear card. Renders the FULL duplicated Inventory inspect
 *  panel (`ResultItemDetail`: same container, scroll wrapper, equipped-char
 *  portrait, exclude footer, empty state) so the results look pixel-identical to
 *  the Inventory tab's left card. The piece (already reforge-projected upstream
 *  in `BottomGearBand`) goes through the same `toUiPiece` adapter. */
function GearCard({ piece, game, equippedChar, fromPresets, excluded, onToggleExclude, addedTicks, transistoneTicks, compact }: {
  slot: SlotId;
  piece: GearPiece | null;
  game: GameData | null;
  /** Character currently wearing the piece (any owner) — header portrait. */
  equippedChar?: Character | null;
  /** In-game presets the piece comes from — "from preset ‹name›". */
  fromPresets?: string[];
  /** This piece is in the global exclusion set — exclude-footer state. */
  excluded?: boolean;
  /** Toggle the piece's exclusion (App-owned). Gates the exclude footer. */
  onToggleExclude?: (uid: string) => void;
  /** Per-sub reforge procs the projection added — tick markers on the subs. */
  addedTicks?: number[];
  /** Per-sub ticks the Transistone potential added — their own marker. */
  transistoneTicks?: number[];
  /** Compact card (Settings › Solver › Compact result cards). */
  compact?: boolean;
}) {
  // Adapt the (reforge-projected) engine piece through the same adapter the
  // Inventory tab uses, then render the duplicated inspect panel verbatim.
  const ui = piece && game ? toUiPiece(piece, game) : null;
  return (
    <ResultItemDetail
      piece={ui}
      equippedChar={equippedChar ?? null}
      fromPresets={fromPresets}
      game={game}
      excluded={excluded}
      onToggleExclude={onToggleExclude}
      addedTicks={addedTicks}
      transistoneTicks={transistoneTicks}
      compact={compact}
    />
  );
}
