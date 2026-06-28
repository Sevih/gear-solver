/**
 * Worklist application planner — turns the queued per-hero diffs into an
 * ORDERED, validated transaction so the user (or one atomic snapshot rewrite)
 * can apply them all without stepping on themselves.
 *
 * Three things the flat list can't tell you on its own:
 *  - **Contention** — a piece is a single physical copy, so if two entries
 *    (distinct heroes) both target the same uid, only one can win. Ordering
 *    can't fix this; the user must drop/retarget one. Surfaced, never silently
 *    resolved.
 *  - **Order** — entry B may want a piece that entry A is about to FREE (A
 *    swaps it off its hero). Doing A first means the piece is sitting in the bag
 *    when B claims it — the sane sequence for the manual in-game workflow. We
 *    emit a free-before-use topological order.
 *  - **Cycles** — A needs a piece B frees AND B needs a piece A frees. No valid
 *    sequential human order exists; the atomic apply still resolves it (steal
 *    semantics), so we flag these "do together" rather than block.
 *
 * Pure + inventory-driven (same live-truth philosophy as the screen): re-run it
 * whenever the snapshot changes. `equipItem`'s steal semantics make the atomic
 * fold order-independent for the FINAL state, so `assignments` is correct in any
 * order — `order` exists for the human and for a tidy, dependency-respecting
 * fold, not for correctness.
 */
import type { Inventory } from "@gear-solver/core";
import type { WorklistChange, WorklistEntry } from "../storage/worklist.js";

/** One piece→hero move to feed the atomic apply. */
export interface WorklistAssignment {
  uid: string;
  heroUid: string;
  entryId: string;
  slot: string;
}

export interface WorklistPlan {
  /** Entry ids in free-before-use order. Cyclic entries keep their original
   *  relative order (no valid topological position). */
  order: string[];
  /** 1-based apply position per entry id — only populated when ordering is
   *  non-trivial (`hasDeps`); empty otherwise so the UI shows no noise. */
  position: Map<string, number>;
  /** True when at least one cross-entry dependency exists (so `position` and
   *  the "suggested order" affordance are worth showing). */
  hasDeps: boolean;
  /** uid → entry ids (≥2 distinct heroes) competing for one physical copy.
   *  Unsolvable by ordering. */
  contended: Map<string, string[]>;
  /** Entry ids caught in a dependency cycle — apply atomically, no human order. */
  cyclic: Set<string>;
  /** Flat moves to apply, ordered to match `order`. Excludes applied/stale
   *  changes (target already on the hero, or gone from the inventory). */
  assignments: WorklistAssignment[];
  /** Distinct heroes with at least one actionable change. */
  heroes: number;
  /** Safe to Apply-all — no contention (cycles are still applicable atomically). */
  applicable: boolean;
}

const EMPTY: WorklistPlan = {
  order: [], position: new Map(), hasDeps: false, contended: new Map(),
  cyclic: new Set(), assignments: [], heroes: 0, applicable: false,
};

/** Build the transaction plan from the worklist + the current snapshot. */
export function planWorklist(list: WorklistEntry[], inventory: Inventory | null): WorklistPlan {
  if (!inventory || list.length === 0) return EMPTY;

  // Current snapshot oracles: who owns what, and what still exists.
  const ownerOf = new Map<string, string>();   // pieceUid → heroUid (equipped only)
  const invUids = new Set<string>();
  for (const g of inventory.gear) {
    invUids.add(g.uid);
    if (g.equippedBy) ownerOf.set(g.uid, g.equippedBy);
  }

  // Actionable changes per entry: target piece exists AND isn't already on the
  // hero. (A change whose target is gone — stale — or already worn is a no-op.)
  const liveByEntry = new Map<string, WorklistChange[]>();
  for (const e of list) {
    const live = e.changes.filter(
      (c) => invUids.has(c.toUid) && ownerOf.get(c.toUid) !== e.heroUid,
    );
    if (live.length > 0) liveByEntry.set(e.id, live);
  }
  if (liveByEntry.size === 0) return EMPTY;

  const entries = list.filter((e) => liveByEntry.has(e.id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const heroes = new Set(entries.map((e) => e.heroUid)).size;

  // --- Contention: a uid targeted by ≥2 distinct heroes. ---
  const wantHeroes = new Map<string, Set<string>>();  // uid → heroUids wanting it
  const wantEntries = new Map<string, Set<string>>(); // uid → entryIds wanting it
  for (const e of entries) {
    for (const c of liveByEntry.get(e.id)!) {
      mapSet(wantHeroes, c.toUid).add(e.heroUid);
      mapSet(wantEntries, c.toUid).add(e.id);
    }
  }
  const contended = new Map<string, string[]>();
  for (const [uid, hs] of wantHeroes) if (hs.size > 1) contended.set(uid, [...wantEntries.get(uid)!]);

  // --- Dependency edges: A→B when A frees a piece B needs. ---
  // A "frees" uid X if some live change in A swaps X off A's hero (fromUid===X)
  // and X currently sits on A's hero. B "needs" X if B targets X (toUid===X).
  // Index, per hero, the freed uids → the entry that frees them.
  const freesByUid = new Map<string, string>(); // freed pieceUid → freeing entryId
  for (const e of entries) {
    for (const c of liveByEntry.get(e.id)!) {
      if (c.fromUid && ownerOf.get(c.fromUid) === e.heroUid) freesByUid.set(c.fromUid, e.id);
    }
  }
  const adj = new Map<string, Set<string>>();   // A → {B…}
  const indeg = new Map<string, number>(entries.map((e) => [e.id, 0]));
  let hasDeps = false;
  for (const b of entries) {
    for (const c of liveByEntry.get(b.id)!) {
      const a = freesByUid.get(c.toUid);        // who frees the piece B wants?
      if (!a || a === b.id) continue;
      const set = mapSet(adj, a);
      if (!set.has(b.id)) {
        set.add(b.id);
        indeg.set(b.id, (indeg.get(b.id) ?? 0) + 1);
        hasDeps = true;
      }
    }
  }

  // --- Kahn topological sort; leftovers are cyclic. Ties broken by the entry's
  //     position in the original list (stable, predictable). ---
  const rank = new Map(entries.map((e, i) => [e.id, i]));
  const ready = entries.filter((e) => (indeg.get(e.id) ?? 0) === 0).map((e) => e.id);
  const order: string[] = [];
  const emitted = new Set<string>();
  while (ready.length > 0) {
    ready.sort((x, y) => rank.get(x)! - rank.get(y)!);
    const n = ready.shift()!;
    order.push(n);
    emitted.add(n);
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  const cyclic = new Set<string>();
  for (const e of entries) if (!emitted.has(e.id)) { order.push(e.id); cyclic.add(e.id); }

  // 1-based positions, only when ordering carries information.
  const position = new Map<string, number>();
  if (hasDeps) order.forEach((id, i) => position.set(id, i + 1));

  // Flatten to assignments in apply order.
  const assignments: WorklistAssignment[] = [];
  for (const id of order) {
    const e = byId.get(id)!;
    for (const c of liveByEntry.get(id)!) {
      assignments.push({ uid: c.toUid, heroUid: e.heroUid, entryId: id, slot: c.slot });
    }
  }

  return {
    order, position, hasDeps, contended, cyclic, assignments, heroes,
    applicable: contended.size === 0,
  };
}

function mapSet<K, V>(m: Map<K, Set<V>>, k: K): Set<V> {
  let s = m.get(k);
  if (!s) { s = new Set<V>(); m.set(k, s); }
  return s;
}
