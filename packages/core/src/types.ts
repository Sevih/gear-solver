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
  | "hitAp" | "killAp"      // chain-point gain
  // Set-bonus only stats (not rollable as gear subs):
  | "lifesteal"             // ST_VAMPIRIC — Lifesteal Set
  | "counter"               // ST_COUNTER_RATE — Counterattack Set
  | "enterAp";              // ST_ENTER_AP — Bursting Set (starting AP)

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
  /** True when the option resolved through an IOT_BUFF entry (BT_STAT_PREMIUM
   *  via BuffsTable). Talisman / EE mains take this path. In CalcFinalStat
   *  these contributions feed `BuffValueRate` (outermost amplifier) instead
   *  of `ItemOptionValueRate` (sum_rate compound), because `SetItemOptionsValue`
   *  filters by IOT_STAT only — IOT_BUFF mains are aggregated via
   *  `SetBuffPremiumValue` in the in-game pipeline. */
  fromBuff?: boolean;
  /** Provenance tag — only set on `main[]` entries. Lets the adapter
   *  distinguish display buckets without coupling to push order:
   *    - "option"     → from `item.OptionList` (regular main slot, IOT_STAT
   *                     or IOT_BUFF — talisman/EE IOT_BUFF mains land here)
   *    - "singularity"→ Singularity-ascension roll (per-item-state extra)
   *    - "eePassive"  → EE level-gated permanent stat passive
   *  Substats don't carry this — they always come from the substat pool. */
  source?: "option" | "singularity" | "eePassive";
  /** True when the contribution is gated by an in-game combat condition
   *  (`BuffConditionType` ≠ `NONE`, e.g. `TARGET_HAS_BUFF` /
   *  `TARGET_ELEMENT`) or has a finite turn duration / `SKILL_START` trigger.
   *  Such effects are real rolled stats on the gear (and the player should
   *  SEE them in the inventory panel), but they don't show on the character
   *  stat sheet — stat aggregators (composer / score) skip these so we
   *  don't compound a combat-only DMG boost into the displayed ATK/HP/etc. */
  combatOnly?: boolean;
  /** Optional in-game narrative label (e.g. "DMG Increase to target") for
   *  buff-shaped rolls — currently set for Singularity options resolved at
   *  parse time. Lets the UI render the game's wording instead of a synthesized
   *  short stat label. Undefined when the source has no narrative (raw
   *  IOT_STAT main rolls / substats). */
  name?: string | null;
  /** Optional rich-text description with `<color=#hex>…</color>` tags
   *  preserved — same source as `name` but the longer per-option narrative
   *  (e.g. "<color=#b266ff>S</color> DMG dealt within … <color=#0D99DA>138%</color>").
   *  UI renders via `GameText`. */
  desc?: string | null;
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
  /** Talisman / EE gem slots — raw OptionIDs from `SubOptionList`, length
   *  always 5 (one per slot), `0` = empty. The 5th slot is gated behind
   *  enhance level ≥ 5 in-game (parse.ts doesn't enforce this — the UI
   *  greys it out based on `enhanceLevel`). Undefined on other gear
   *  slots (their `subs` carry rolled stats instead of gem references). */
  gemSlots?: number[];
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
  /** Non-zero when the char was created by fusing a lower-star instance. Drives
   *  the +5000 BP bonus in CalcBattlePower. */
  fusionCharId: number;
}

/** Saved equipment preset (PresetList from /user/item). Name is decoded from
 *  the base64-encoded wire format; `itemUids` keeps the raw 8-slot order from
 *  the game so consumers can match against equipped gear without re-sorting. */
export interface Preset {
  num: number;
  name: string;
  itemUids: string[];
}

export interface Inventory {
  gear: GearPiece[];
  characters: Character[];
  presets: Preset[];
}
