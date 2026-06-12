/**
 * Domain model — the clean, engine-facing representation the solver and UI use.
 * Parsed from the wire types (raw.ts) + game data (gamedata.ts) via parse.ts.
 */

/** Canonical stat keys. Percent stats hold display values (e.g. 12 = 12%). */
export type StatType =
  | "atk" | "atkPct"
  | "hp" | "hpPct"
  | "def" | "defPct"
  | "critRate" | "critDmg"
  | "spd"
  | "eff" | "effRes"        // effectiveness (BUFF_CHANCE) / effect resist (BUFF_RESIST)
  | "dmgUp" | "dmgReduce"   // DMG_BOOST / DMG_REDUCE_RATE
  | "pen"                   // PIERCE_POWER_RATE
  | "critDmgReduce"         // E_CRI_DMG_REDUCE
  | "hitAp" | "killAp";     // chain-point gain

export type GearSlot =
  | "weapon" | "helmet" | "armor" | "gloves" | "boots"
  | "accessory" | "exclusive" | "ooparts";

/** Game grades: normal < magic < rare < unique. */
export type Rarity = "normal" | "magic" | "rare" | "unique";

/** A single rolled stat (main or sub) with its resolved numeric value. */
export interface RolledStat {
  stat: StatType;
  /** Resolved display value (e.g. 61.8 for 61.8%, or 240 for flat ATK). */
  value: number;
  percent: boolean;
  /** For substats: total ticks. Undefined for main. */
  ticks?: number;
  /** For substats: reforge (orange) ticks = total - initial. */
  reforgeTicks?: number;
}

export interface GearPiece {
  uid: string;
  itemId: number;
  slot: GearSlot | null;
  /** Set group id (from equipment.setId); resolve name/effects via GameData.sets. */
  setId: string | null;
  rarity: Rarity | null;
  name: string | null;
  classLimit: string | null;
  breakthrough: number;
  reforgeCount: number;
  singularityLevel: number;
  locked: boolean;
  equippedBy: string | null;
  main: RolledStat[];
  subs: RolledStat[];
}

export interface Character {
  uid: string;
  charId: number;
  name: string | null;
  stars: number;
  locked: boolean;
}

export interface Inventory {
  gear: GearPiece[];
  characters: Character[];
}
