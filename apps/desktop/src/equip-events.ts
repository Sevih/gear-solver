/**
 * In-game gear moves → captured snapshot. The game only sends `/user/item`
 * (the full inventory) at the lobby; a piece moved in the hero screen comes
 * back as an `item/equip` or `item/equipAll` response instead. The Steam
 * plugin appends those to `equip-events.ndjson` (one line per response,
 * `{ seq, at, path, res }`) and truncates the file whenever a fresh
 * `/user/item` lands. This module folds the journal into `user_item.json` so
 * the renderer's follower re-imports on the mtime change, as after a lobby.
 *
 * The fold only rewrites `RawItem.CharUID` by uid — no game data needed: the
 * responses already say which piece leaves and which one joins
 * (CWebRES_ItemEquip / CWebRES_ItemEquipAll in the game client). Each event
 * sets absolute owners, so replaying the whole journal onto a snapshot that
 * already holds part of it lands on the same state: the follower replays it
 * all whenever something changed instead of tracking a partial offset.
 *
 * Electron-free (Vite's dev middleware loads it through api-handler.ts).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { dlog, dwarn } from "./log.js";

export const EQUIP_JOURNAL = "equip-events.ndjson";
/** Where the follower remembers what it already folded, so an app restart
 *  doesn't rewrite the snapshot for nothing. */
export const EQUIP_JOURNAL_STATE = ".equip-events.applied";

/** Unequipped sentinel — same wire convention as core's equip.ts. */
const UNEQUIPPED = "0";

export interface EquipEvent {
  seq: number;
  at?: string;
  path: string;
  res: unknown;
}

/** The slice of `RawUserItem` the fold touches; other keys are carried over. */
interface FoldableUserItem {
  ItemList: Array<{ ItemUID: string; CharUID: string }>;
}

/** A game uid (`long`) as the snapshot spells it. The server sends them as
 *  JSON strings (`"6124885095"`); a number is accepted only while exact
 *  (≤ 2^53), anything else is unusable. "0" stays "0" (= none). */
function uid(v: unknown): string | null {
  if (typeof v === "string") return /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : null;
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  return null;
}

/** Parse the journal text: complete lines only (the plugin may be mid-append
 *  on the last one), malformed lines dropped, file order kept. */
export function parseEquipJournal(text: string): EquipEvent[] {
  const end = text.lastIndexOf("\n");
  if (end < 0) return [];
  const out: EquipEvent[] = [];
  for (const line of text.slice(0, end).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<EquipEvent> | null;
      if (e && typeof e.seq === "number" && typeof e.path === "string") out.push(e as EquipEvent);
    } catch { /* torn or foreign line */ }
  }
  return out;
}

/** The owner changes one event asks for, in the game's own order. */
function movesOf(e: EquipEvent): Array<[item: unknown, owner: unknown]> {
  const r = e.res as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return [];
  const char = r.CharUID;
  if (e.path === "/item/equip") {
    // ToEquipUID 0 = take ToInvenUID off; ToInvenUID 0 = plain equip; both =
    // slot swap. A piece taken from another hero (UnEquipCharUID) is
    // ToEquipUID itself, so its new owner covers it.
    return [[r.ToInvenUID, UNEQUIPPED], [r.ToEquipUID, char]];
  }
  if (e.path === "/item/equipAll") {
    // CItemInventory.UpdateEquipItems: UnEquipList first, then ToInvenList
    // off the hero, then ToEquipList onto it.
    const list = (v: unknown) => (Array.isArray(v) ? v : []);
    return [
      ...list(r.UnEquipList).map((u): [unknown, unknown] => [(u as { ItemUID?: unknown } | null)?.ItemUID, UNEQUIPPED]),
      ...list(r.ToInvenList).map((u): [unknown, unknown] => [u, UNEQUIPPED]),
      ...list(r.ToEquipList).map((u): [unknown, unknown] => [u, char]),
    ];
  }
  return [];
}

/** Apply `events` to a snapshot's `ItemList`, by uid. Returns a NEW object
 *  (other keys shallow-copied), how many pieces actually changed owner, and how
 *  many uids were skipped — absent from the inventory (a piece obtained after
 *  this snapshot: not invented) or unreadable. Never throws on event data. */
export function foldEquipEvents<T extends FoldableUserItem>(
  raw: T, events: readonly EquipEvent[],
): { next: T; applied: number; skipped: number } {
  const owner = new Map(raw.ItemList.map((it) => [it.ItemUID, it.CharUID]));
  const changed = new Set<string>();
  let skipped = 0;
  for (const e of events) {
    for (const [itemRaw, ownerRaw] of movesOf(e)) {
      const item = uid(itemRaw);
      if (item === UNEQUIPPED) continue; // "no piece" slot of the response
      const to = uid(ownerRaw);
      if (item === null || to === null || !owner.has(item)) { skipped++; continue; }
      owner.set(item, to);
      changed.add(item);
    }
  }
  let applied = 0;
  const ItemList = raw.ItemList.map((it) => {
    const to = owner.get(it.ItemUID)!;
    if (!changed.has(it.ItemUID) || to === it.CharUID) return it;
    applied++;
    return { ...it, CharUID: to };
  });
  return { next: { ...raw, ItemList }, applied, skipped };
}

/** What the follower last folded: the journal's first/last `seq` and the
 *  snapshot mtime it left behind. Any difference means "replay". */
interface JournalMark { first: number; last: number; mtime: number | null }

const NO_MARK: JournalMark = { first: 0, last: 0, mtime: null };

/** Keeps `user_item.json` in step with the plugin's journal. `sync()` is cheap
 *  when nothing moved (one stat + one small read); it replays the whole journal
 *  when it holds a new line, when it was truncated/restarted (its first `seq`
 *  changed — a new `/user/item`, or a new game session), or when the snapshot
 *  was replaced underneath (a lobby `/user/item`). `noteSnapshotWritten()` is
 *  for the app's own write-back, so it isn't mistaken for a new capture. */
export function createEquipJournalFollower(captureOut: string) {
  const journal = join(captureOut, EQUIP_JOURNAL);
  const stateFile = join(captureOut, EQUIP_JOURNAL_STATE);
  const snapshot = join(captureOut, "user_item.json");
  let mark: JournalMark | null = null;

  const mtimeOf = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : null);
  const load = (): JournalMark => {
    if (mark) return mark;
    try {
      const j = JSON.parse(readFileSync(stateFile, "utf-8")) as Partial<JournalMark>;
      mark = { first: Number(j.first) || 0, last: Number(j.last) || 0, mtime: typeof j.mtime === "number" ? j.mtime : null };
    } catch { mark = { ...NO_MARK }; }
    return mark;
  };
  const save = (m: JournalMark) => {
    mark = m;
    try { writeAtomic(stateFile, JSON.stringify(m)); } catch (err) { dwarn("capture", "equip journal state:", (err as Error).message); }
  };
  const same = (a: JournalMark, b: JournalMark) => a.first === b.first && a.last === b.last && a.mtime === b.mtime;

  return {
    /** Fold pending in-game moves into the snapshot. Returns how many pieces
     *  changed owner (0 when nothing was written). */
    sync(): number {
      if (!existsSync(journal)) return 0;
      const prev = load();
      // Journal first, snapshot second: the plugin truncates the journal
      // before it rewrites the snapshot, so this order never pairs a fresh
      // journal with a stale base.
      const events = parseEquipJournal(readFileSync(journal, "utf-8"));
      const mtime = mtimeOf(snapshot);
      if (events.length === 0) {
        // Emptied by a new /user/item: start from zero.
        const now = { first: 0, last: 0, mtime };
        if (!same(prev, now)) save(now);
        return 0;
      }
      const now = { first: events[0]!.seq, last: events[events.length - 1]!.seq, mtime };
      if (same(prev, now) || mtime === null) return 0;
      let raw: FoldableUserItem;
      try {
        raw = JSON.parse(readFileSync(snapshot, "utf-8")) as FoldableUserItem;
        if (!Array.isArray(raw?.ItemList)) throw new Error("missing ItemList[]");
      } catch (err) {
        dwarn("capture", "equip journal: unreadable user_item.json:", (err as Error).message);
        return 0;
      }
      const { next, applied, skipped } = foldEquipEvents(raw, events);
      if (applied > 0) writeAtomic(snapshot, JSON.stringify(next));
      save({ ...now, mtime: mtimeOf(snapshot) });
      dlog("capture", `equip journal #${now.first}-#${now.last}: ${applied} piece(s) moved, ${skipped} skipped`);
      return applied;
    },
    /** The app just rewrote `user_item.json` itself: take its mtime as the new
     *  base so the next `sync()` doesn't replay the journal over the edit. */
    noteSnapshotWritten(): void {
      const m = load();
      save({ ...m, mtime: mtimeOf(snapshot) });
    },
  };
}
