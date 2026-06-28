/**
 * Equip / Unequip client — moves gear by rewriting the captured snapshot.
 *
 * The transform itself lives in `@gear-solver/core` (`equipItem`/`unequipItem`,
 * pure + tested); here we just run it against the loaded game data (needed to
 * resolve a piece's slot) and persist the result by POSTing the FULL rewritten
 * `user_item.json` back to the local server, which writes it to disk
 * (`tools/capture/out/user_item.json`). The caller re-imports the inventory
 * afterwards (e.g. `refreshInventory` in App.tsx) to pick the edit up.
 *
 * Wired to the Builder via "Equip build" (applies a solved build's pieces to
 * the selected hero in one atomic snapshot rewrite — see `equipPieces`).
 */
import { equipItem, unequipItem, type GameData, type RawUserItem } from "@gear-solver/core";

/** Read the current captured snapshot (served live by the dev middleware /
 *  prod server). Null when no capture is present or the shape is unexpected. */
async function fetchRawUserItem(): Promise<RawUserItem | null> {
  try {
    const r = await fetch("/captured/user_item.json");
    if (!r.ok) return null;
    const j = (await r.json()) as RawUserItem | null;
    return j && Array.isArray(j.ItemList) ? j : null;
  } catch {
    return null;
  }
}

/** Persist a rewritten snapshot. Returns false on a network error or a server
 *  refusal (e.g. 409 while the capture pipeline is armed). */
async function writeUserItem(raw: RawUserItem): Promise<boolean> {
  try {
    const r = await fetch("/api/captured/user-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Equip `itemUid` onto `charUid`, displacing whatever piece held that
 *  character's same slot. Pass `charUid === "0"` (or use `unequipPiece`) to
 *  clear. Returns true once the captured snapshot has been rewritten; the
 *  caller should re-import the inventory. */
export async function equipPiece(game: GameData, itemUid: string, charUid: string): Promise<boolean> {
  const raw = await fetchRawUserItem();
  if (!raw) return false;
  return writeUserItem(equipItem(raw, game, itemUid, charUid));
}

/** Equip several pieces onto `charUid` in ONE snapshot rewrite — fetch once,
 *  fold `equipItem` over each uid, write once (atomic; no per-piece round-trip).
 *  Used by the Builder's "Equip build" to apply a whole solved build. Pieces
 *  currently on another hero are moved (stolen); same-slot duplicates within the
 *  list resolve in order. Empty/unknown uids are skipped (no-op clones).
 *  Returns true once persisted; the caller should re-import the inventory. */
export async function equipPieces(game: GameData, itemUids: string[], charUid: string): Promise<boolean> {
  const raw = await fetchRawUserItem();
  if (!raw) return false;
  let next = raw;
  for (const uid of itemUids) if (uid) next = equipItem(next, game, uid, charUid);
  return writeUserItem(next);
}

/** Unequip `itemUid` (set its owner to "0"). No game data needed — the slot is
 *  irrelevant when clearing. */
export async function unequipPiece(itemUid: string): Promise<boolean> {
  const raw = await fetchRawUserItem();
  if (!raw) return false;
  return writeUserItem(unequipItem(raw, itemUid));
}
