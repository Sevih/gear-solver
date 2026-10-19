/**
 * Build vs current loadout — the ONE "slot changed" rule shared by the
 * Builder's Equip button (moving / stolen counts), "+ Worklist" (the queued
 * per-slot changes) and the bottom gear band (piece per slot).
 *
 * The rule is the engine's `upg` (`finalizeBuilds`): a slot changes when its
 * proposed piece is not currently equipped on the hero — physical `equippedBy`,
 * not Worklist reservations (a piece the Worklist reserved for this hero still
 * has to be put on). So `changed` count === `build.upg` for a build solved
 * against the same inventory.
 */
import type { GearPiece, GearSlot } from "@gear-solver/core";

export interface SlotDiff {
  /** Engine slot of the proposed piece. */
  slot: GearSlot;
  /** Piece the build puts in this slot. */
  proposed: GearPiece;
  /** Piece the hero currently wears in this slot, if any. */
  worn: GearPiece | null;
  /** The proposed piece is not on the hero today — the engine's `upg` rule. */
  changed: boolean;
}

/** One entry per build piece found in `pieceByUid` (a uid missing from the
 *  current inventory — e.g. a saved build after the piece was sold — or a
 *  piece without a slot is skipped), in the build's `pieceUids` order. */
export function diffBuildVsLoadout(
  pieceUids: readonly string[],
  heroUid: string,
  pieceByUid: ReadonlyMap<string, GearPiece>,
): SlotDiff[] {
  // Worn side indexed once from the build's own lookup — the hero's equipped
  // pieces are in `pieceByUid` like every other piece.
  const worn = new Map<GearSlot, GearPiece>();
  for (const g of pieceByUid.values()) {
    if (g.equippedBy === heroUid && g.slot) worn.set(g.slot, g);
  }
  const out: SlotDiff[] = [];
  for (const uid of pieceUids) {
    const proposed = pieceByUid.get(uid);
    if (!proposed?.slot) continue;
    out.push({
      slot: proposed.slot,
      proposed,
      worn: worn.get(proposed.slot) ?? null,
      changed: proposed.equippedBy !== heroUid,
    });
  }
  return out;
}
