/**
 * Domain model — the clean, engine-facing representation the solver and UI use.
 * Parsed from the wire types (raw.ts) via parse.ts.
 */

/** Canonical stat keys used throughout the engine. */
export type StatType =
  | "atk" | "atkPct"
  | "hp" | "hpPct"
  | "def" | "defPct"
  | "critRate" | "critDmg"
  | "spd"
  | "eff" | "effRes"
  | "pen"
  // TODO: confirm full set vs Outerplane stat list (resilience, heal, acc, eva...)
  ;

/** Equipment slots. TODO: confirm exact slot set + how SlotList encodes them. */
export type GearSlot =
  | "weapon"
  | "helmet"
  | "armor"
  | "gloves"
  | "boots"
  | "accessory";

export type Rarity = "normal" | "superior" | "epic" | "legendary";

/** A single rolled stat (main or sub) with its resolved numeric value. */
export interface RolledStat {
  stat: StatType;
  /** Resolved value (e.g. 61.8 for 61.8%). */
  value: number;
  /** For substats: total ticks. Undefined for main stat. */
  ticks?: number;
  /** For substats: reforge (orange) ticks = total - initial. */
  reforgeTicks?: number;
}

/** A gear piece in domain form. */
export interface GearPiece {
  uid: string;
  itemId: number;
  slot: GearSlot | null;
  set: string | null;
  rarity: Rarity | null;
  /** "+0".."+15" enhancement level once known; null until resolved. */
  enhance: number | null;
  /** Breakthrough tier T0–T4. */
  breakthrough: number;
  reforgeCount: number;
  singularityLevel: number;
  locked: boolean;
  /** Equipped character uid, null when free. */
  equippedBy: string | null;
  main: RolledStat | null;
  subs: RolledStat[];
  /** Original wire id for traceability. */
  itemUid: string;
}

export interface Character {
  uid: string;
  charId: number;
  stars: number;
  locked: boolean;
}

export interface Inventory {
  gear: GearPiece[];
  characters: Character[];
}
