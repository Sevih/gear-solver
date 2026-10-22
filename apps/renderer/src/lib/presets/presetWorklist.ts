/**
 * Worklist lines of a preset for one of its heroes — what the Presets tab's
 * "+ Worklist" queues: the preset's pieces the hero doesn't wear yet
 * (`diffBuildVsLoadout`, the Builder's rule), then the EE gems `bestEeGemsFor`
 * proposes (`worklistChangesFor`, Talisman untouched — its gems belong to the
 * preset). A piece the inventory no longer holds can't be queued: it is left
 * out and counted.
 *
 * Pure: the screen wraps the lines into a `WorklistEntry`.
 */
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { diffBuildVsLoadout } from "../buildDiff.js";
import { worklistChangesFor } from "../worklist/changes.js";
import type { WorklistChange } from "../storage/worklist.js";
import type { PresetRow } from "./presetRows.js";
import type { EeGems } from "./eeGems.js";

export interface PresetWorklist {
  changes: WorklistChange[];
  /** Piece lines — the `upg` of the entry. */
  upg: number;
  /** Preset pieces missing from the inventory, left out of `changes`. */
  missing: number;
}

export function presetWorklistFor(
  heroUid: string,
  row: PresetRow,
  eeGems: EeGems | null,
  inventory: Inventory,
  game: GameData | null,
): PresetWorklist {
  const pieceByUid = new Map<string, GearPiece>(inventory.gear.map((g) => [g.uid, g]));
  const uids = row.presentPieces.map((p) => p.uid);
  // The hero's EE joins the diff for its gem lines only — it is worn, so it
  // never makes a piece line.
  const ee = inventory.gear.find((g) => g.slot === "exclusive" && g.equippedBy === heroUid);
  if (ee && eeGems) uids.push(ee.uid);
  const changes = worklistChangesFor(
    diffBuildVsLoadout(uids, heroUid, pieceByUid),
    { talisman: [], ee: eeGems?.ee ?? [] },
    game,
  );
  return { changes, upg: changes.filter((c) => c.kind !== "gem").length, missing: row.missingCount };
}
