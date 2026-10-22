/**
 * Worklist persistence — a cross-hero "to-do" queue of gear changes the user
 * wants to apply. Optimize hero A, B, C → each chosen build pushes its per-slot
 * DIFF (changed slots only, plus the gems to socket) here, one entry per hero;
 * the Worklist tab renders them as checkable lines so the user can work
 * through them in-game and tick each off.
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
export interface WorklistPieceChange {
  /** Absent on piece lines (and on every line stored before gem lines). */
  kind?: undefined;
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

/** A gem, snapshotted from `game.gems` when the line was queued. */
export interface WorklistGem {
  /** Gem OptionID (`SubOptionList` / `gemSlots` value). */
  id: number;
  /** Display name — "Lv 3 Attack%". */
  name: string;
  /** Resolved stat the gem grants; null when the stat isn't known. */
  stat: { stat: string; value: number; percent: boolean } | null;
}

/** One gem to socket on a Talisman / EE of the build — listed like a piece,
 *  but never applied by the app (the local snapshot doesn't model a socket
 *  write): the user sockets it in-game and the line clears itself. */
export interface WorklistGemChange {
  kind: "gem";
  /** Engine slot of the gem-bearing piece (ooparts/exclusive). */
  slot: string;
  /** Socket position on the piece, 0-4. */
  gemIndex: number;
  /** The gem-bearing piece — the build's pick for `slot`. */
  toUid: string;
  toName: string;
  toGem: WorklistGem;
  /** Gem socketed there on that piece at capture time — null when empty. */
  fromGem: WorklistGem | null;
  done: boolean;
}

export type WorklistChange = WorklistPieceChange | WorklistGemChange;

/** Stable key of a line within its entry — a slot holds one piece line and up
 *  to five gem lines. */
export function changeKey(c: WorklistChange): string {
  return c.kind === "gem" ? `${c.slot}:gem${c.gemIndex}` : c.slot;
}

export type WorklistMode = SolveMode | "preset";

/** A queued build's diff — one per hero: a new "Add to worklist" for the same
 *  hero replaces it (`upsertWorklistEntry`). */
export interface WorklistEntry {
  id: string;
  heroUid: string;
  /** Snapshot of the hero's display name / charId so the card renders without
   *  re-resolving against game data (and still reads right if the hero later
   *  leaves the roster). */
  heroName: string;
  charId: number;
  /** Solve mode the build came from — labels the card. "preset" = queued from
   *  the Presets tab (an in-game preset's outfit, no solve). */
  mode: WorklistMode;
  /** Build CP + slot-change count (pieces only), snapshotted for the header. */
  cp: number | null;
  upg: number;
  /** Changed slots only (unchanged slots aren't actionable), plus the gems to
   *  socket on the build's Talisman / EE. */
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
    // crashing the screen on a stale schema. A list stored before the
    // one-entry-per-hero rule may hold two entries of one hero: keep the
    // first (the list is newest-first), as `upsertWorklistEntry` would have.
    const heroes = new Set<string>();
    return parsed.filter((e): e is WorklistEntry => {
      if (!e || typeof e !== "object" || typeof (e as WorklistEntry).heroUid !== "string" || !Array.isArray((e as WorklistEntry).changes)) return false;
      if (heroes.has((e as WorklistEntry).heroUid)) return false;
      heroes.add((e as WorklistEntry).heroUid);
      return true;
    });
  } catch {
    return [];
  }
}

/** Queue `entry`, replacing the entry of the same hero if there is one — a
 *  build is a whole outfit, so the new one supersedes the old one entirely
 *  (its ticks included). The new entry goes first (the list is newest-first);
 *  the other entries keep their order. */
export function upsertWorklistEntry(list: WorklistEntry[], entry: WorklistEntry): WorklistEntry[] {
  return [entry, ...list.filter((e) => e.heroUid !== entry.heroUid)];
}

export function persistWorklist(list: WorklistEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota / serialization error — skip; the next mutation retries.
  }
}

/** heroUid → set of currently-equipped piece uids. */
export type EquippedByHero = Map<string, Set<string>>;

/** Map heroUid → set of currently-equipped piece uids. The "is this change
 *  already applied?" oracle the screen and badge both derive from. The App
 *  builds it once per inventory and hands it to the helpers below; their
 *  `equipped` parameter falls back to building it when omitted. */
export function equippedByHero(inventory: Inventory | null): EquippedByHero {
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

/** pieceUid → socketed gem OptionIDs, for the gem-bearing pieces (Talisman /
 *  EE) — the gem lines' "applied" oracle. */
export type GemSlotsByUid = Map<string, readonly number[]>;

export function gemSlotsByUid(inventory: Inventory | null): GemSlotsByUid {
  const m: GemSlotsByUid = new Map();
  if (inventory) for (const g of inventory.gear) if (g.gemSlots) m.set(g.uid, g.gemSlots);
  return m;
}

/** A line is applied once its piece is on the hero — and, for a gem line, once
 *  that piece holds the gem in that socket. */
export function isChangeApplied(
  c: WorklistChange,
  onHero: ReadonlySet<string> | null | undefined,
  gems: GemSlotsByUid,
): boolean {
  if (!(onHero?.has(c.toUid) ?? false)) return false;
  return c.kind !== "gem" || gems.get(c.toUid)?.[c.gemIndex] === c.toGem.id;
}

/** Lines dropped by one `reconcileWorklist` pass, per hero — what the app
 *  tells the user when the list changed by itself. */
export interface ReconciledHero {
  heroUid: string;
  heroName: string;
  /** Lines now applied (and so removed). */
  applied: number;
}

/** The toast for one `reconcileWorklist` pass — "Worklist: 2 changes applied
 *  — Hero A, Hero B". Null when the pass removed nothing. */
export function appliedNotice(applied: readonly ReconciledHero[]): string | null {
  const n = applied.reduce((sum, h) => sum + h.applied, 0);
  if (n === 0) return null;
  const heroes = [...new Set(applied.map((h) => h.heroName))].join(", ");
  return `Worklist: ${n} change${n === 1 ? "" : "s"} applied — ${heroes}`;
}

/** Prune changes that are now DONE for real — the target piece is equipped on
 *  the hero in the current snapshot (the user did the swap in-game and it shows
 *  up after a recapture, or "Apply locally" rewrote it). Entries left with no
 *  changes are dropped entirely. Returns `changed=false` (and the same list ref)
 *  when nothing applied, so the caller can skip a needless write/re-render.
 *
 *  Only "applied" is pruned — a `stale` target (piece gone from inventory) is
 *  kept visible so the user notices, not silently swallowed. `applied` lists,
 *  per hero, how many lines this pass removed (empty when nothing changed). */
export function reconcileWorklist(
  list: WorklistEntry[],
  inventory: Inventory | null,
  equipped: EquippedByHero = equippedByHero(inventory),
): { next: WorklistEntry[]; changed: boolean; applied: ReconciledHero[] } {
  if (!inventory) return { next: list, changed: false, applied: [] };
  const gems = gemSlotsByUid(inventory);
  const applied: ReconciledHero[] = [];
  const next: WorklistEntry[] = [];
  for (const e of list) {
    const onHero = equipped.get(e.heroUid);
    const kept = e.changes.filter((c) => !isChangeApplied(c, onHero, gems));
    if (kept.length !== e.changes.length) {
      applied.push({ heroUid: e.heroUid, heroName: e.heroName, applied: e.changes.length - kept.length });
    }
    if (kept.length === 0) continue;                              // fully applied → drop entry
    next.push(kept.length !== e.changes.length ? { ...e, changes: kept } : e);
  }
  return applied.length > 0 ? { next, changed: true, applied } : { next: list, changed: false, applied };
}

/** Map pieceUid → heroUid of the worklist entry claiming it, for changes NOT
 *  yet applied (once applied, the real `equippedBy` covers it). Fed to the
 *  solver so a piece already promised to hero A behaves as if EQUIPPED on A
 *  when solving hero B — the "Equipped items" scope then applies naturally:
 *  `lower` lets a higher-ranked hero override a lower-ranked hero's claim
 *  (same rule as stealing equipped gear) and never touches an equal/higher
 *  one; `none` keeps all claimed pieces out; `all` ignores claims like it
 *  ignores equipment. Newest entry wins a double-claim (list is newest-first);
 *  claims on pieces gone from the inventory are harmless (never matched).
 *  Gem lines reserve nothing (their piece line, if any, does). */
export function worklistClaims(
  list: WorklistEntry[],
  inventory: Inventory | null,
  equipped: EquippedByHero = equippedByHero(inventory),
): Record<string, string> {
  const claims: Record<string, string> = {};
  for (const e of list) {
    const onHero = equipped.get(e.heroUid);
    for (const c of e.changes) {
      if (c.kind === "gem" || onHero?.has(c.toUid)) continue;
      if (!(c.toUid in claims)) claims[c.toUid] = e.heroUid;
    }
  }
  return claims;
}

/** Total changes still NOT applied (target piece not yet on the hero, gem not
 *  yet in its socket) across the whole worklist — the Worklist tab's badge
 *  count. Null when no inventory is loaded (can't tell what's applied yet). */
export function remainingChangeCount(
  list: WorklistEntry[],
  inventory: Inventory | null,
  equipped: EquippedByHero = equippedByHero(inventory),
): number | null {
  if (!inventory) return null;
  const gems = gemSlotsByUid(inventory);
  let n = 0;
  for (const e of list) {
    const onHero = equipped.get(e.heroUid);
    for (const c of e.changes) if (!isChangeApplied(c, onHero, gems)) n++;
  }
  return n;
}
