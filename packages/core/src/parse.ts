/**
 * Map captured wire payloads (raw.ts) into the domain model (types.ts).
 *
 * What's solid now: identity fields, breakthrough/reforge/singularity, equip
 * state, substat ticks. What's pending: stat resolution (stats.ts) and the
 * slot/set/rarity/main-stat lookup, which come from the Outerpedia equipment
 * DB keyed by ItemID (to be wired via a provided lookup table).
 */
import type { RawItem, RawUserItem, RawUserCharacter } from "./raw.js";
import type { Character, GearPiece, Inventory, RolledStat } from "./types.js";
import { resolveSubStat } from "./stats.js";

/** Equipment static data, keyed by ItemID — supplied from the Outerpedia DB. */
export interface EquipmentMeta {
  slot: GearPiece["slot"];
  set: string | null;
  rarity: GearPiece["rarity"];
}
export type EquipmentLookup = (itemId: number) => EquipmentMeta | undefined;

const NO_META: EquipmentLookup = () => undefined;

/** True when a RawItem is an equippable gear piece (has rolled substats). */
export function isGear(item: RawItem): boolean {
  return Array.isArray(item.SubOptionList) && item.SubOptionList.length > 0;
}

export function parseGearPiece(item: RawItem, lookup: EquipmentLookup = NO_META): GearPiece {
  const meta = lookup(item.ItemID);
  const subs: RolledStat[] = item.SubOptionList
    .filter((s) => s.OptionID !== 0)
    .map((s) => {
      const r = resolveSubStat(s.OptionID, s.Level);
      const sub: RolledStat = {
        stat: r.stat ?? ("atk" as RolledStat["stat"]), // placeholder until stats map filled
        value: r.value,
        ticks: s.Level,
        reforgeTicks: s.Level - s.BaseLevel,
      };
      return sub;
    });

  return {
    uid: item.ItemUID,
    itemUid: item.ItemUID,
    itemId: item.ItemID,
    slot: meta?.slot ?? null,
    set: meta?.set ?? null,
    rarity: meta?.rarity ?? null,
    enhance: null, // TODO: derive from Exp/level once formula known
    breakthrough: item.BreakLimitLevel,
    reforgeCount: item.SmeltingCount,
    singularityLevel: item.SingularityLevel,
    locked: item.IsLock === 1,
    equippedBy: item.CharUID === "0" ? null : item.CharUID,
    main: null, // TODO: resolve from OptionList once encoding decoded
    subs,
  };
}

export function parseInventory(
  userItem: RawUserItem,
  userCharacter?: RawUserCharacter,
  lookup: EquipmentLookup = NO_META,
): Inventory {
  const gear = userItem.ItemList.filter(isGear).map((i) => parseGearPiece(i, lookup));
  const characters: Character[] = (userCharacter?.CharList ?? []).map((c) => ({
    uid: c.CharUID,
    charId: c.CharID,
    stars: c.TransStar,
    locked: c.IsLock === 1,
  }));
  return { gear, characters };
}
