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
  /** Armor 4-piece set id (1..21) for helmet/armor/gloves/boots — resolves
   *  to the 2pc/4pc bonus in GameData.sets. Null on non-armor pieces. */
  armorSetId: string | null;
  rarity: Rarity | null;
  /** Base star tier from ItemTemplet.BasicStar (1..6). Determines the stars row below
   *  the icon in-game and gates progression caps (max enhance Exp, breakthrough, …). */
  star: number | null;
  name: string | null;
  classLimit: string | null;
  breakthrough: number;
  reforgeCount: number;
  /** Effective enhancement level applied to main stats (0..10 normal, 10..15 once ascended). */
  enhanceLevel: number;
  /** Singularity ascension step count (0..5). Display as `+${10+singularityLevel}` when ascended. */
  singularityLevel: number;
  /** True once Singularity has been activated in-game (SingularityStep > 0). */
  ascended: boolean;
  locked: boolean;
  equippedBy: string | null;
  main: RolledStat[];
  subs: RolledStat[];
}

export interface Character {
  uid: string;
  charId: number;
  name: string | null;
  /** Captured TransStar (0..9) — the real per-char transcend, NOT max-assumed. */
  stars: number;
  locked: boolean;
  /** Cumulative character XP — resolves to a level via ExpCharacterTemplet. */
  exp: number;
  /** Limit-break step (0..3) — gates levels above 100 via CharacterMaxLevelTemplet
   *  (step 1 → lv105, step 2 → lv110, step 3 → lv120 for BasicStar 3). */
  levelMaxStep: number;
  /** Trust (affection) XP — high values unlock Trust-level stat bonuses. */
  trustExp: number;
  /** Per-skill user-leveled values (skills 1..4 in CharacterTemplet). The
   *  transcend passive Skill_8 isn't user-leveled — its level is derived
   *  from TransStar via CharacterTranscendentTemplet. */
  skills: { first: number; second: number; ultimate: number; chainPassive: number };
}

export interface Inventory {
  gear: GearPiece[];
  characters: Character[];
}
