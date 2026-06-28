/**
 * Worklist persistence — a cross-hero "to-do" queue of gear changes the user
 * wants to apply. Optimize hero A, B, C → each chosen build pushes its per-slot
 * DIFF (changed slots only) here; the Worklist tab renders them as checkable
 * lines so the user can work through them in-game and tick each off.
 *
 * Backed by `localStorage` under one blob (`gs.worklist`) — same shape rationale
 * as `savedBuilds.ts` (one write per mutation, one read on mount).
 *
 * Design notes (cf. docs/todo.md § Workflow):
 *  - We store only the INTENT (hero + target piece per changed slot + the name
 *    it replaced at capture time). Conflict ("two entries want the same piece")
 *    and "already applied" are derived LIVE from the current inventory by the
 *    screen — the stored entry never goes out of sync with reality, it just gets
 *    re-interpreted against the latest snapshot.
 *  - `done` is the user's manual "I did this in-game" tick (cosmetic progress).
 *    Applying locally (`equipPieces`) is the separate, authoritative path that
 *    rewrites the snapshot so the rest of the app reflects the new loadout.
 */
import type { SolveMode } from "../solver/types.js";
import type { Inventory } from "@gear-solver/core";

/** One changed slot in a queued build — the unit the user ticks off. */
export interface WorklistChange {
  /** Engine slot name (weapon/helmet/…/ooparts/exclusive). */
  slot: string;
  /** Piece to equip (the build's pick for this slot). */
  toUid: string;
  toName: string;
  /** Target piece's main stat (non-combat) — surfaced on talisman lines where
   *  the main is variable and the name alone doesn't identify the piece in-game.
   *  Null when no main resolves; absent on entries saved before this field. */
  toMain?: { stat: string; value: number; percent: boolean } | null;
  /** Piece this replaces in the hero's loadout at capture time — null when the
   *  slot was empty. Display-only; the live "before" is re-derived on render. */
  fromUid: string | null;
  fromName: string | null;
  /** Manual "did it in-game" tick. Persisted, independent of the live
   *  "is the target piece now on the hero" detection. */
  done: boolean;
}

/** A queued build's diff — one per "Add to worklist" press. */
export interface WorklistEntry {
  id: string;
  heroUid: string;
  /** Snapshot of the hero's display name / charId so the card renders without
   *  re-resolving against game data (and still reads right if the hero later
   *  leaves the roster). */
  heroName: string;
  charId: number;
  /** Solve mode the build came from — labels the card. */
  mode: SolveMode;
  /** Build CP + slot-change count, snapshotted for the header. */
  cp: number | null;
  upg: number;
  /** Changed slots only (unchanged slots aren't actionable). */
  changes: WorklistChange[];
  createdAt: number;
}

export const WORKLIST_KEY = "gs.worklist";
const KEY = WORKLIST_KEY;

export function loadWorklist(): WorklistEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Shallow shape guard — drop anything missing the essentials rather than
    // crashing the screen on a stale schema.
    return parsed.filter(
      (e): e is WorklistEntry =>
        !!e && typeof e === "object" && typeof (e as WorklistEntry).heroUid === "string" && Array.isArray((e as WorklistEntry).changes),
    );
  } catch {
    return [];
  }
}

export function persistWorklist(list: WorklistEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota / serialization error — skip; the next mutation retries.
  }
}

/** Append an entry (newest first). */
export function addWorklistEntry(list: WorklistEntry[], entry: WorklistEntry): WorklistEntry[] {
  return [entry, ...list];
}

export function removeWorklistEntry(list: WorklistEntry[], id: string): WorklistEntry[] {
  return list.filter((e) => e.id !== id);
}

/** Toggle one change's manual `done` flag (immutably). */
export function toggleWorklistChange(list: WorklistEntry[], id: string, slot: string, done: boolean): WorklistEntry[] {
  return list.map((e) =>
    e.id !== id ? e : { ...e, changes: e.changes.map((c) => (c.slot === slot ? { ...c, done } : c)) },
  );
}

/** Map heroUid → set of currently-equipped piece uids. The "is this change
 *  already applied?" oracle the screen and badge both derive from. */
export function equippedByHero(inventory: Inventory | null): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  if (!inventory) return m;
  for (const g of inventory.gear) {
    if (!g.equippedBy) continue;
    let s = m.get(g.equippedBy);
    if (!s) { s = new Set(); m.set(g.equippedBy, s); }
    s.add(g.uid);
  }
  return m;
}

/** Prune changes that are now DONE for real — the target piece is equipped on
 *  the hero in the current snapshot (the user did the swap in-game and it shows
 *  up after a recapture, or "Apply locally" rewrote it). Entries left with no
 *  changes are dropped entirely. Returns `changed=false` (and the same list ref)
 *  when nothing applied, so the caller can skip a needless write/re-render.
 *
 *  Only "applied" is pruned — a `stale` target (piece gone from inventory) is
 *  kept visible so the user notices, not silently swallowed. */
export function reconcileWorklist(
  list: WorklistEntry[],
  inventory: Inventory | null,
): { next: WorklistEntry[]; changed: boolean } {
  if (!inventory) return { next: list, changed: false };
  const equipped = equippedByHero(inventory);
  let changed = false;
  const next: WorklistEntry[] = [];
  for (const e of list) {
    const onHero = equipped.get(e.heroUid);
    const kept = e.changes.filter((c) => !(onHero?.has(c.toUid) ?? false));
    if (kept.length === 0) { changed = true; continue; }          // fully applied → drop entry
    if (kept.length !== e.changes.length) { changed = true; next.push({ ...e, changes: kept }); }
    else next.push(e);
  }
  return changed ? { next, changed } : { next: list, changed: false };
}

/** Total changes still NOT applied (target piece not yet on the hero) across
 *  the whole worklist — the Worklist tab's badge count. Null when no inventory
 *  is loaded (can't tell what's applied yet). */
export function remainingChangeCount(list: WorklistEntry[], inventory: Inventory | null): number | null {
  if (!inventory) return null;
  const equipped = equippedByHero(inventory);
  let n = 0;
  for (const e of list) {
    const onHero = equipped.get(e.heroUid);
    for (const c of e.changes) if (!onHero?.has(c.toUid)) n++;
  }
  return n;
}
