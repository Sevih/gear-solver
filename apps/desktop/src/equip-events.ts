/**
 * In-game gear changes → captured snapshot. The game only sends `/user/item`
 * (the full inventory) at the lobby; a piece moved in the hero screen comes
 * back as an `item/equip` or `item/equipAll` response instead, a gem
 * socketed / removed / rerolled or a substat change (reforge, Transistone) as
 * `item/gemInsert`, `item/gemRemove`, `item/gemChangeOption` or
 * `item/subOptionChange`, and an upgrade as `item/enchant`, `item/enchantReset`,
 * `item/breakLimit`, `item/smelting`, `item/smeltingReset`, `item/merge`,
 * `item/craft` or `item/dissolve`. The Steam plugin appends those to
 * `equip-events.ndjson` (one line per response, `{ seq, at, path, res }`) and
 * truncates the file whenever a fresh `/user/item` lands. This module folds the
 * journal into `user_item.json` so the renderer's follower re-imports on the
 * mtime change, as after a lobby.
 *
 * No game data needed: the equip responses say which piece leaves and which
 * one joins (CWebRES_ItemEquip / CWebRES_ItemEquipAll in the game client) and
 * only rewrite `RawItem.CharUID`; the others carry items in two shapes (see
 * `ITEM_FIELDS`). A whole updated item (`WSItemData`, the same fields as
 * `RawItem`) replaces the entry of the same uid — or joins the end of
 * `ItemList` when absent (the gem item `gemRemove` puts back, the pieces
 * `breakLimit` / `craft` create). A "simple" one (uid + `Quantity`: a material
 * stack consumed or given back) only sets that entry's `Quantity`, and 0
 * removes the entry, as `CItemInventory.UpdateItem` does in the client (a piece
 * eaten as fodder no longer exists). Each event sets absolute state, so
 * replaying the whole journal onto a snapshot that already holds part of it
 * lands on the same state: the follower replays it all whenever something
 * changed instead of tracking a partial offset.
 *
 * Not modelled: the gem stack `gemInsert` consumes. The client decrements it
 * from its own request (`ItemUIDGem`), the response doesn't say — so the gem
 * pool may count one gem too many until the next lobby. Likewise the client
 * removes the pieces `item/dissolve` dissolves from its own request uid list
 * and ignores the response's `ItemList`: it is folded as simple entries (0 =
 * removed), so a piece the server doesn't list there stays until the lobby.
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

/** One `ItemList` entry as the fold sees it: the uids it keys on, every other
 *  field carried over. */
type FoldableItem = { ItemUID: string; CharUID: string } & Record<string, unknown>;

/** The slice of `RawUserItem` the fold touches; other keys are carried over. */
interface FoldableUserItem {
  ItemList: FoldableItem[];
}

/** Responses that carry items, by path, and in which fields (one entry or a
 *  list of them). `upsert`: whole updated items (`WSItemData`) — the piece and
 *  the gem item of the gem responses, the improved piece, the pieces created.
 *  `simple`: only the uid and the stack's new `Quantity` count — the
 *  `WSItemSimpleData` / `WSItemNormalData` lists, and the `WSItemData` the
 *  client hands to `CItemInventory.UpdateItem`, which reads nothing else (the
 *  reset item, the merge source, the craft materials). After the CWebRES_Item*
 *  classes and their `OnApply`; no response puts one uid in both. */
const ITEM_FIELDS: ReadonlyMap<string, { upsert: readonly string[]; simple: readonly string[] }> = new Map([
  ["/item/gemInsert", { upsert: ["Item"], simple: [] }],
  ["/item/gemRemove", { upsert: ["Item", "ItemGem"], simple: [] }],
  ["/item/gemChangeOption", { upsert: ["Item", "ItemGem"], simple: [] }],
  ["/item/subOptionChange", { upsert: ["ItemData"], simple: [] }],
  ["/item/enchant", { upsert: ["Item"], simple: ["ItemList"] }],
  ["/item/enchantReset", { upsert: ["ResetItemData"], simple: ["UseItemData", "GetItemList"] }],
  ["/item/breakLimit", { upsert: ["Item", "ItemList"], simple: [] }],
  ["/item/smelting", { upsert: ["Item"], simple: ["srcItem"] }],
  ["/item/smeltingReset", { upsert: ["Item"], simple: ["srcItem"] }],
  ["/item/merge", { upsert: ["getItem"], simple: ["useItem"] }],
  ["/item/craft", { upsert: ["CraftItemList"], simple: ["AdditionItem", "MaterialItemList"] }],
  ["/item/dissolve", { upsert: [], simple: ["ItemList"] }],
]);

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

/** A `WSItemData` as the snapshot spells it: uids as strings (the wire sends
 *  `CharUID` 0 as a number), `IsLock` as a number (a bool on the client side),
 *  every other field as is. Null when a uid is unusable; a missing `CharUID`
 *  stays missing (the snapshot's owner is kept). */
function itemOf(v: unknown): ({ ItemUID: string } & Record<string, unknown>) | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const ItemUID = uid(r.ItemUID);
  if (ItemUID === null || ItemUID === UNEQUIPPED) return null;
  const out: Record<string, unknown> = { ...r, ItemUID };
  if (r.CharUID !== undefined) {
    const CharUID = uid(r.CharUID);
    if (CharUID === null) return null;
    out.CharUID = CharUID;
  }
  if (typeof r.IsLock === "boolean") out.IsLock = r.IsLock ? 1 : 0;
  return out as { ItemUID: string } & Record<string, unknown>;
}

/** A simple entry (`WSItemSimpleData` and kin): its uid and the stack's new
 *  `Quantity` (0 = gone). Null when either is unusable. */
function simpleOf(v: unknown): { ItemUID: string; Quantity: number } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const ItemUID = uid(r.ItemUID);
  const Quantity = r.Quantity;
  if (ItemUID === null || ItemUID === UNEQUIPPED) return null;
  if (typeof Quantity !== "number" || !Number.isSafeInteger(Quantity) || Quantity < 0) return null;
  return { ItemUID, Quantity };
}

/** The raw entries of one event's `upsert` or `simple` fields — empty for the
 *  equip family. */
function entriesOf(e: EquipEvent, kind: "upsert" | "simple"): unknown[] {
  const fields = ITEM_FIELDS.get(e.path);
  const r = e.res as Record<string, unknown> | null;
  if (!fields || !r || typeof r !== "object") return [];
  return fields[kind].flatMap((k) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : r[k] != null ? [r[k]] : []));
}

/** Apply `events` to a snapshot's `ItemList`, by uid, in journal order (the
 *  game's). Returns a NEW object (other keys shallow-copied), how many items
 *  actually changed (owner, gems, substats, level, quantity…), joined or left,
 *  and how many were skipped — a move or a simple entry whose uid is absent
 *  from the inventory (a piece obtained after this snapshot: not invented), an
 *  unreadable uid, or an item response with no usable entry. Never throws on
 *  event data. */
export function foldEquipEvents<T extends FoldableUserItem>(
  raw: T, events: readonly EquipEvent[],
): { next: T; applied: number; skipped: number } {
  const items = new Map(raw.ItemList.map((it) => [it.ItemUID, it]));
  const touched = new Set<string>();
  let skipped = 0;
  for (const e of events) {
    for (const [itemRaw, ownerRaw] of movesOf(e)) {
      const item = uid(itemRaw);
      if (item === UNEQUIPPED) continue; // "no piece" slot of the response
      const to = uid(ownerRaw);
      const it = item === null ? undefined : items.get(item);
      if (!it || to === null) { skipped++; continue; }
      if (it.CharUID !== to) items.set(item!, { ...it, CharUID: to });
      touched.add(item!);
    }
    if (!ITEM_FIELDS.has(e.path)) continue;
    const upserts = entriesOf(e, "upsert").map(itemOf);
    const simples = entriesOf(e, "simple").map(simpleOf);
    if (!upserts.some((it) => it !== null) && !simples.some((s) => s !== null)) { skipped++; continue; }
    for (const it of upserts) {
      if (!it) { skipped++; continue; }
      // Fields the response lacks (InvenType…) stay as the snapshot had them.
      items.set(it.ItemUID, { CharUID: UNEQUIPPED, ...items.get(it.ItemUID), ...it });
      touched.add(it.ItemUID);
    }
    for (const s of simples) {
      const it = s ? items.get(s.ItemUID) : undefined;
      if (!s || !it) { skipped++; continue; } // a stack this snapshot lacks: not invented
      if (s.Quantity === 0) items.delete(s.ItemUID);
      else if (it.Quantity !== s.Quantity) items.set(s.ItemUID, { ...it, Quantity: s.Quantity });
      touched.add(s.ItemUID);
    }
  }
  const before = new Map(raw.ItemList.map((it) => [it.ItemUID, it]));
  let applied = 0;
  for (const id of before.keys()) if (!items.has(id)) applied++; // consumed, dissolved
  const ItemList: FoldableItem[] = [];
  for (const [id, it] of items) {
    const was = before.get(id);
    if (!was || (touched.has(id) && JSON.stringify(it) !== JSON.stringify(was))) {
      applied++;
      ItemList.push(it);
    } else ItemList.push(was);
  }
  return { next: { ...raw, ItemList }, applied, skipped };
}

/** What the follower last folded: the journal's first/last `seq` and the
 *  snapshot mtime it left behind. Any difference means "replay". */
interface JournalMark { first: number; last: number; mtime: number | null }

const NO_MARK: JournalMark = { first: 0, last: 0, mtime: null };

/** Keeps `user_item.json` in step with the plugin's journal. `sync()` is cheap
 *  when nothing changed (one stat + one small read); it replays the whole journal
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
    /** Fold pending in-game changes into the snapshot. Returns how many
     *  items changed (0 when nothing was written). */
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
      dlog("capture", `equip journal #${now.first}-#${now.last}: ${applied} item(s) changed, ${skipped} skipped`);
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
