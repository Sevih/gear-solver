/**
 * Which pieces the in-game presets hold, and which of them a solve may take.
 *
 * The rule (on the model of the hero ranks, `heroPriority`): a piece held by a
 * preset P (uid in `P.itemUids`, EE and empty slots left out as in
 * `presetSignature`) leaves the pool when
 *  (a) P is locked and P is not the preset being optimized, or
 *  (b) a preset Q is being optimized and P is not STRICTLY lower priority than
 *      Q (`isLowerPriority` on the preset ranks, P ≠ Q).
 * Without a target preset (a hero solve from Builds, Home, the Worklist or a
 * hero picked by hand) only (a) applies. A piece held by several presets: the
 * most restrictive wins — locked by one is enough, else the best-ranked holder
 * other than Q counts. Stacks with the other pool rules (`equippedScope`, hero
 * ranks, `excludedPieceUids`, `worklistClaims`), which are unchanged.
 *
 * Pure: the table is plain JSON (it rides in the solve request to the workers).
 */
import { comparePresets, type Inventory, type Preset } from "@gear-solver/core";
import { isLowerPriority, rankOrder } from "../storage/rankPriority.js";
import type { PresetRank } from "../storage/presetPriority.js";
import { isEmptyUid } from "./presetRows.js";

export interface PresetHolds {
  /** pieceUid → nums of the presets holding it (EE and empty slots left out). */
  holders: Record<string, number[]>;
  /** Preset ranks (`gs.presets.rank`, key = num as a string). */
  rank: PresetRank;
  /** Locked preset nums (`gs.presets.locked`). */
  locked: number[];
}

/** The holds table of an inventory's presets, with their ranks and locks. */
export function presetHolds(inventory: Pick<Inventory, "gear" | "presets">, rank: PresetRank, locked: readonly number[]): PresetHolds {
  const slotByUid = new Map(inventory.gear.map((g) => [g.uid, g.slot] as const));
  const holders: Record<string, number[]> = {};
  for (const p of inventory.presets) {
    for (const uid of p.itemUids) {
      if (isEmptyUid(uid) || slotByUid.get(uid) === "exclusive") continue;
      const list = (holders[uid] ??= []);
      if (!list.includes(p.num)) list.push(p.num);
    }
  }
  return { holders, rank, locked: [...locked] };
}

/** True when preset `holder` keeps its pieces away from a solve aimed at
 *  `targetNum` (null = no target preset). */
function blocks(holds: PresetHolds, locked: ReadonlySet<number>, holder: number, targetNum: number | null): boolean {
  if (holder === targetNum) return false;
  if (locked.has(holder)) return true;
  return targetNum != null && !isLowerPriority(holds.rank, String(holder), String(targetNum));
}

/** Piece uids a solve aimed at `targetNum` (null = no target preset) may not
 *  take — built once per solve, checked in `allow()` and the gem pool. */
export function presetBlockedUids(holds: PresetHolds | undefined, targetNum: number | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!holds) return out;
  const target = targetNum ?? null;
  const locked = new Set(holds.locked);
  for (const [uid, nums] of Object.entries(holds.holders)) {
    if (nums.some((n) => blocks(holds, locked, n, target))) out.add(uid);
  }
  return out;
}

/** The presets other than `targetNum` holding `uid`, best-ranked first — what
 *  the Builder's result cards name ("from preset ‹name›"). */
export function presetHoldersOf(holds: PresetHolds | undefined, uid: string, targetNum: number | null | undefined): number[] {
  const nums = holds?.holders[uid] ?? [];
  return nums
    .filter((n) => n !== targetNum)
    .sort((a, b) => rankOrder(holds!.rank, String(a)) - rankOrder(holds!.rank, String(b)) || a - b);
}

/** Preset keys (num as a string) in the in-game order (`comparePresets`) — the
 *  default rank order of the presets never offered one (`fillUnrankedByOrder`). */
export function presetGameOrder(presets: readonly Preset[]): string[] {
  return [...presets].sort(comparePresets).map((p) => String(p.num));
}
