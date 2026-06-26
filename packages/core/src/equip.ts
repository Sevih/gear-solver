/**
 * Equip / Unequip — local edits to a captured `/user/item` snapshot.
 *
 * The app never talks back to the game, so "moving gear around" means
 * rewriting the captured JSON: a piece's owner is its `RawItem.CharUID`
 * (`"0"` = unequipped, mirroring the wire convention in parse.ts). These pure
 * helpers produce a NEW `RawUserItem` with the right `CharUID`s flipped; the
 * caller persists it (writes `tools/capture/out/user_item.json`) and re-imports.
 *
 * Wiring the disk write-back + a Builder/Builds trigger is a separate task
 * (see docs/todo.md "Equip / Unequip — branchement"); this module is just the
 * transformation methods, fully testable in isolation.
 */
import type { GameData } from "./gamedata.js";
import type { RawItem, RawUserItem } from "./raw.js";

/** Unequipped sentinel — the game stores a free piece's `CharUID` as "0". */
const UNEQUIPPED = "0";

/** Resolve an item's gear slot via the equipment table. `null` for a
 *  stackable / unknown template (not a wearable piece). */
function slotOfItem(item: RawItem, game: GameData): string | null {
  return game.equipment[item.ItemID]?.slot ?? null;
}

/**
 * Equip `itemUid` onto `charUid`, returning a NEW `RawUserItem` (the input is
 * never mutated). The piece previously occupying that character's SAME slot is
 * displaced to unequipped — the game holds at most one piece per (char, slot).
 *
 * No-op (returns a shallow-rebuilt clone) when the item isn't found, its slot
 * can't be resolved (not a gear template), or it's already on `charUid`.
 * `charUid === "0"` means "equip on nobody" → delegates to `unequipItem`.
 */
export function equipItem(
  raw: RawUserItem,
  game: GameData,
  itemUid: string,
  charUid: string,
): RawUserItem {
  if (charUid === UNEQUIPPED) return unequipItem(raw, itemUid);

  const target = raw.ItemList.find((it) => it.ItemUID === itemUid);
  // Unknown item, non-gear template, or already equipped on this char → no-op.
  if (!target || target.CharUID === charUid) return cloneItems(raw);
  const slot = slotOfItem(target, game);
  if (slot == null) return cloneItems(raw);

  const ItemList = raw.ItemList.map((it) => {
    if (it.ItemUID === itemUid) return { ...it, CharUID: charUid };
    // Displace whoever already holds this char's same slot.
    if (it.CharUID === charUid && slotOfItem(it, game) === slot) {
      return { ...it, CharUID: UNEQUIPPED };
    }
    return it;
  });
  return { ...raw, ItemList };
}

/**
 * Unequip `itemUid` (set its `CharUID` to "0"), returning a NEW `RawUserItem`.
 * No-op clone when the item isn't found or is already free.
 */
export function unequipItem(raw: RawUserItem, itemUid: string): RawUserItem {
  const target = raw.ItemList.find((it) => it.ItemUID === itemUid);
  if (!target || target.CharUID === UNEQUIPPED) return cloneItems(raw);

  const ItemList = raw.ItemList.map((it) =>
    it.ItemUID === itemUid ? { ...it, CharUID: UNEQUIPPED } : it,
  );
  return { ...raw, ItemList };
}

/** Rebuild the wrapper with a fresh `ItemList` array (same element refs) so a
 *  no-op still returns a distinct object — callers can treat the result as
 *  immutable without special-casing "unchanged". */
function cloneItems(raw: RawUserItem): RawUserItem {
  return { ...raw, ItemList: raw.ItemList.slice() };
}
