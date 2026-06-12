/**
 * Map captured wire payloads (raw.ts) + static game data (gamedata.ts) into the
 * domain model (types.ts). Stat values are fully resolved here.
 */
import type { RawItem, RawUserItem, RawUserCharacter } from "./raw.js";
import type { Character, GearPiece, Inventory, RolledStat, Rarity, GearSlot } from "./types.js";
import type { GameData } from "./gamedata.js";
import { resolveStat } from "./stats.js";

/** True when a RawItem is an equippable gear piece. */
export function isGear(item: RawItem, game?: GameData): boolean {
  if (game) return Boolean(game.equipment[String(item.ItemID)]);
  return Array.isArray(item.SubOptionList) && item.SubOptionList.length > 0;
}

function toRolled(optionId: number, ticks: number, game: GameData | undefined): RolledStat | null {
  if (!game) return null;
  const r = resolveStat(optionId, ticks, game.options);
  if (!r) return null;
  return { stat: r.stat, value: r.value, percent: r.percent };
}

export function parseGearPiece(item: RawItem, game?: GameData): GearPiece {
  const meta = game?.equipment[String(item.ItemID)];

  const subs: RolledStat[] = [];
  for (const s of item.SubOptionList) {
    if (s.OptionID === 0) continue;
    const r = toRolled(s.OptionID, s.Level, game);
    if (r) subs.push({ ...r, ticks: s.Level, reforgeTicks: s.Level - s.BaseLevel });
    else subs.push({ stat: "atk", value: 0, percent: false, ticks: s.Level, reforgeTicks: s.Level - s.BaseLevel });
  }

  const main: RolledStat[] = [];
  for (const oid of item.OptionList) {
    if (!oid) continue;
    const r = toRolled(oid, 1, game); // base (+0) value; enhancement scaling TODO
    if (r) main.push(r);
  }

  return {
    uid: item.ItemUID,
    itemId: item.ItemID,
    slot: (meta?.slot as GearSlot) ?? null,
    setId: meta?.setId ?? null,
    rarity: (meta?.grade as Rarity) ?? null,
    name: meta?.name ?? null,
    classLimit: meta?.classLimit ?? null,
    breakthrough: item.BreakLimitLevel,
    reforgeCount: item.SmeltingCount,
    singularityLevel: item.SingularityLevel,
    locked: item.IsLock === 1,
    equippedBy: item.CharUID === "0" ? null : item.CharUID,
    main,
    subs,
  };
}

export function parseInventory(
  userItem: RawUserItem,
  userCharacter?: RawUserCharacter,
  game?: GameData,
): Inventory {
  const gear = userItem.ItemList.filter((i) => isGear(i, game)).map((i) => parseGearPiece(i, game));
  const characters: Character[] = (userCharacter?.CharList ?? []).map((c) => ({
    uid: c.CharUID,
    charId: c.CharID,
    name: game?.characters[String(c.CharID)]?.name ?? null,
    stars: c.TransStar,
    locked: c.IsLock === 1,
  }));
  return { gear, characters };
}
