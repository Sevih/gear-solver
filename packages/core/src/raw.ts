/**
 * Wire types — the JSON shapes returned by the Outerplane game server
 * (glb-game...:38001) after XOR-decoding the {"msg":"<hex>"} envelope.
 * These mirror the captured payloads 1:1; do not "clean them up" here, the
 * cleanup happens in parse.ts when mapping to the domain model in types.ts.
 *
 * Source: tools/capture (see docs/data-schema.md).
 */

/** One substat line on a gear piece. */
export interface RawSubOption {
  /** Stat type id, observed 160001–160013. See stats.ts OPTION_STATS. */
  OptionID: number;
  /** Procs ABOVE the initial rolled tick — total ticks = Level + 1 (in-game
   *  shows `LV (Level + 1)`). See parse.ts for the validated derivation. */
  Level: number;
  /** Initial (yellow) ticks at roll time. Reforge ticks = Level - BaseLevel. */
  BaseLevel: number;
}

/** One entry of /user/item -> ItemList. Covers gear and stackable items alike. */
export interface RawItem {
  ItemUID: string;
  /** Equipped character UID, "0" when unequipped. */
  CharUID: string;
  /** Equipment/template id -> Outerpedia equipment DB (set, slot, rarity, base main stat). */
  ItemID: number;
  Exp: number;
  /** Breakthrough tier T0–T4. */
  BreakLimitLevel: number;
  Quantity: number;
  SmeltingCount: number;
  IsLock: number;
  InvenType: number;
  SelectSubOptionNum: number;
  SingularityOptionID: number;
  SingularityStep: number;
  SingularityLevel: number;
  /** Main stat option id(s). */
  OptionList: number[];
  SubOptionList: RawSubOption[];
}

/** One saved equipment preset (PresetList entry in /user/item). `Name` is
 *  base64-encoded UTF-8; `ItemUIDList` is always length 8 covering every gear
 *  slot incl. the EE (Exclusive), in the order Weapon, Accessory, Helmet,
 *  Armor, Gloves, Boots, EE, Talisman. */
export interface RawPreset {
  PresetType: number;
  Num: number;
  Name: string;
  ItemUIDList: number[];
  Favorites: number;
}

export interface RawUserItem {
  ItemList: RawItem[];
  PresetList?: RawPreset[];
  PresetOrderList?: unknown[];
  ItemConvertOptionInfo?: unknown;
}

/** One entry of /user/character -> CharList. */
export interface RawCharacter {
  CharUID: string;
  CharID: number;
  CostumeID: number;
  Exp: number;
  TransStar: number;
  Quantity: number;
  TrustExp: number;
  ResetTrustLevel: number;
  First: number;
  Second: number;
  Ultimate: number;
  ChainPassive: number;
  LevelMaxStep: number;
  IsLock: number;
  [k: string]: unknown;
}

export interface RawUserCharacter {
  CharList: RawCharacter[];
  /** Equipment slot assignments per character. Shape TBD — datamine. */
  SlotList?: unknown[];
  CharPieceList?: unknown[];
  DeckList?: unknown[];
  [k: string]: unknown;
}
