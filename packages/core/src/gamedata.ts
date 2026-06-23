/**
 * Shapes of the distilled game-data tables (data/derived/*.json, produced by
 * data/build.mjs). The app loads these and hands them to the parser.
 */

/** ItemOptionTemplet entry. Discriminated by shape:
 *  - IOT_STAT: `{ st, ap, v }` — directly carries the stat encoding.
 *  - IOT_BUFF: `{ buffId }`    — defers to BuffsTable, indexed by enhancement level.
 *    Talisman (ooparts) main stats live here; EE mains too (not yet wired). */
export interface StatOption {
  st: string; // ST_ATK, ST_CRITICAL_RATE, ...
  ap: string; // OAT_ADD | OAT_RATE
  v: number;  // raw per-tick value
}
export interface BuffOption {
  buffId: string;
}
export type OptionDef = StatOption | BuffOption;
export type OptionsTable = Record<string, OptionDef>;

/** Per-buff entry — extends a StatOption with the combat-only flag for
 *  EE conditional mains (e.g. `BID_CEQUIP_MAIN_DMG_WATER`: DMG +X% vs
 *  Water targets only). The flag flows into `RolledStat.combatOnly` so
 *  the stat aggregators skip them; UI still surfaces them as main
 *  stats. Unset / false = unconditional contribution.
 *
 *  `name` is the in-game label resolved at build time from TextSystem
 *  (e.g. "DMG Increase vs Water", "Gains AP when hit"). Forwarded to
 *  `RolledStat.name` so the UI renders the wording the player sees
 *  in-game instead of the synthesized short stat label. */
export interface BuffLevelEntry extends StatOption {
  combatOnly?: boolean;
  name?: string;
}
/** Per-buff stat table: BuffID → [stat entry at enhance level 0..N]. Used
 *  to resolve IOT_BUFF main stats on talismans + EE. */
export type BuffsTable = Record<string, BuffLevelEntry[]>;

export interface EquipmentDef {
  slot: string;
  grade: string | null;
  star: number | null;
  classLimit: string | null;
  setId: string | null;
  /** Armor 4-piece set ID (1..21). Helmet/armor/gloves/boots carry this in
   *  `SetOptionID` — distinct from `setId` which holds the unique-option set
   *  for weapons/accessories. The displayed badge is `armorSetIcon` below
   *  (the setId-to-icon mapping is non-linear). */
  armorSetId: string | null;
  name: string | null;
  mainGroup: string | null;
  subGroup: string | null;
  /** Item art filename without extension, served at /img/equipment/<image>.webp. */
  image: string | null;
  /** Unique-option icon filename (curated from outerpedia-v2), served at /img/ui/effect/<effectIcon>.webp. */
  effectIcon: string | null;
  /** Armor 4-piece set icon filename — resolved at build time from the
   *  curated outerpedia-v2 sets.json mapping (the setId-to-icon order is
   *  non-linear). Served at /img/ui/effect/<armorSetIcon>.webp. Null on
   *  non-armor pieces. */
  armorSetIcon: string | null;
  /** Class restriction display name (Striker/Mage/Ranger/Defender/Healer). null when unrestricted. */
  class: string | null;
}
export type EquipmentTable = Record<string, EquipmentDef>;

/** Main-stat enhancement scaling tables (mirrors outerpedia-v2 item-stats-detail). */
export interface EnhanceData {
  enhanceFactor: number;        // +0.04 per enhance level (stored as 0.4, applied as factor*lv where lv = 0..10/10)
  tierFactor: number;           // +0.05 per breakthrough tier
  maxEnhanceLevel: number;      // 10
  singularity: { activation: number; steps: number[] };  // ascended (lv 11..15) extras
  /** `${slot}|${grade}|${star}` → cumulative Exp threshold at levels 0..maxEnhanceLevel. */
  expCurves: Record<string, number[]>;
}

export interface SetEffect {
  st: string;
  ap: string;
  v: number;
}
export interface SetLevel {
  level: number;
  /** Engine-facing resolved stat (kept for solver scoring). Null when the
   *  set has no stat at this tier — e.g. Revenge has no 2-pc effect. */
  p2: SetEffect | null;
  p4: SetEffect | null;
  /** UI-facing localized prose pulled from outerpedia-v2's curated
   *  `data/equipment/sets.json` — canonical wording per tier (e.g.
   *  "Attack +30%", "Increases damage dealt against targets inflicted with
   *  Break by 35%"). Null when no curated string exists. */
  p2_desc: string | null;
  p4_desc: string | null;
}
export interface SetDef {
  name: string | null;
  /** Narrative description from the game's locale (TextItem) - text like
   *  "Increases Attack. Requires at least 2 pieces to activate.". Null if
   *  the build pipeline didn't see a DescID for this set. */
  desc: string | null;
  levels: SetLevel[];
}
export type SetsTable = Record<string, SetDef>;

/** Per-item base unique-option passive — the "Destruction" / "Aurora" /
 *  etc. effect on a weapon or accessory. Resolved from `ItemTemplet
 *  .UniqueOptionID` → `ItemSpecialOptionTemplet[uoID]` (gives the
 *  DescID + BuffID) → `TextSkill[DescID]` (the localized template with
 *  `[Value]`, `[Rate]`, `[Turn]` placeholders) and `BuffTemplet[BuffID]`
 *  rows (one row per Level, Level = breakthrough tier + 1).
 *
 *  `name` is the canonical effect title ("Destruction"). `textByTier[bt]`
 *  is the fully resolved English description for breakthrough tier `bt`
 *  (0..4). The build pipeline fills the placeholders at build time so
 *  the UI consumes plain text — no per-render templating needed. */
export interface EquipmentPassive {
  name: string | null;
  /** Index 0 = T0 (BuffTemplet Level 1) … index 4 = T4 (Level 5).
   *  Length matches the BuffTemplet level count (5 for the standard
   *  weapon / accessory unique options). */
  textByTier: string[];
}
/** Keyed by `ItemID` (the equipment item's ID) — every weapon and
 *  accessory has a row (most other slots don't carry a unique-option
 *  passive). Missing key means the build pipeline saw no resolvable
 *  passive (no UniqueOptionID, no DescID, no BuffID, …). */
export type EquipmentPassivesTable = Record<string, EquipmentPassive>;

/** Talisman / EE passive — fundamentally different from equipment
 *  passives: instead of one passive that scales across breakthrough
 *  tiers (T0..T4), talismans and EE expose a SHORT LIST of tiers
 *  (typically 1 base + 1 optional `+10 unlock` upgrade). Each tier:
 *    - `unlockLevel`: enhance level needed to activate (1 = always
 *      active when equipped; 10 = unlocks at +10).
 *    - `isAdd`: when true, the tier ADDS to the base (both effects
 *      active together when unlocked). When false, it UPGRADES the
 *      base (same effect, stronger value — the base is hidden once
 *      the upgrade activates).
 *    - `desc`: fully resolved English description with
 *      `<color=#hex>…</color>` tags + substituted `[Value]/[Rate]/…`
 *      placeholders. UI renders via GameText.
 *  Source: `ItemTemplet.UniqueOptionID` is comma-separated (`base[, lv10]`);
 *  each fragment resolves to an ItemSpecialOptionTemplet row whose
 *  Level / IsAdd populate this tier's metadata. */
export interface MultiTierPassiveTier {
  unlockLevel: number;
  isAdd: boolean;
  desc: string;
}
export interface MultiTierPassive {
  name: string | null;
  tiers: MultiTierPassiveTier[];
}
/** Keyed by `ItemID` — present for talisman / exclusive-equipment items
 *  where UniqueOptionID resolves to one or more multi-tier rows. */
export type MultiTierPassivesTable = Record<string, MultiTierPassive>;

/** Talisman / EE gem — one of the 5 swappable stones the player slots in
 *  the substat positions. The in-game encoding (`OptionID` in the captured
 *  SubOptionList) packs all 9 stats × 6 levels into 54 consecutive IDs
 *  starting at 15001 (15001..15009 = lv1 ATK/DEF/HP/CRC/CHD/EFF/RES/DMG+/DMG-
 *  in that exact order; 15010..15018 = lv2; … 15046..15054 = lv6).
 *
 *  Extends `StatOption` so `resolveOption` consumes it directly to produce
 *  the displayed value. `type` is the image filename fragment served at
 *  `/img/items/TI_GEM_<type>_<level>.webp` (ATK / Def / Heal / CriRate /
 *  CriDmgRate / BuffChance / BuffResist / DMG_INCREASE / DMG_REDUCE).
 *  `level` is the gem tier 1..6. */
export interface GemDef extends StatOption {
  type: string;
  level: number;
}
/** Keyed by the gem's OptionID (15001..15054). */
export type GemsTable = Record<string, GemDef>;

/** Singularity Equip unique options — every BuffID that an ascended (+15)
 *  piece can roll, regardless of whether the contribution applies to the
 *  character stat sheet. Two families today:
 *   - Unconditional (`combatOnly: false`): `BT_STAT_PREMIUM` with no
 *     condition — DMG_BOOST / DMG_REDUCE_RATE that always apply, routed
 *     via `SetBuffPremiumValue` → `BuffValueRate` per CalcFinalStat.
 *   - Combat-only (`combatOnly: true`): conditional / turn-duration buffs
 *     (`TARGET_HAS_BUFF`, `TARGET_ELEMENT`, `SKILL_START`, …) that don't
 *     show on the character sheet but DO appear as the rolled effect on
 *     the gear — collected here so the inventory UI can display them.
 *
 *  Math-side aggregators (`composeCharStats`, `score.sumTotals`,
 *  `aggregateGearBuckets`) MUST skip `combatOnly: true` entries; the engine
 *  forwards the flag through `RolledStat.combatOnly` from `parse.ts`.
 *
 *  Shape extends `StatOption` so `resolveOption` consumes it directly.
 *  `name` carries the in-game narrative label (e.g. "DMG Increase to
 *  target") resolved at build time via TextSkill[NameID]; null when
 *  TextSkill isn't available. */
export interface SingularityOption extends StatOption {
  name: string | null;
  /** Rich in-game description from TextSkill[DescID] — keeps the original
   *  `<color=#hex>…</color>` tags (e.g. the grade letter wrap and the
   *  per-mille value already baked into the string). UI renders these via
   *  the `GameText` component. Null when the checkout is missing. */
  desc: string | null;
  combatOnly: boolean;
}
export type SingularityOptionsTable = Record<string, SingularityOption>;

/** EE level-gated permanent passive — `StatOption` plus an enhance-level
 *  unlock threshold. Two observed thresholds: `1` (always-on once equipped —
 *  e.g. some healers' +100% EFF) and `10` (unlocks at +10 — e.g. Caren's
 *  `BID_CEQUIP_2000089_ADD` +20% DEF). Combat-only base effects (`BT_STAT`,
 *  `SKILL_START`, `TurnDuration ≥ 0`) are filtered out at build time. */
export interface EePassiveDef extends StatOption {
  /** EE enhance level needed to activate. `1` means always on when equipped. */
  levelThreshold: number;
}
/** Keyed by the EE's GroupID, which matches the item's `ItemID` (and the first
 *  fragment of its `UniqueOptionID`) per the observed EE data shape. */
export type EePassivesTable = Record<string, EePassiveDef[]>;

/** A 16-field stat delta — every contribution to a character's no-gear sheet
 *  flows through this shape. `*Pct` are %-multipliers on the relevant base
 *  stat (folded into the compound formula by `composeCharStats`). EFF/RES are
 *  integer points matching the in-game display.
 *
 *  `effRate` / `resRate` carry **OAT_RATE** buff contributions on EFF/RES in
 *  display % units (50 = +50%). They route through the in-game
 *  `BuffValueRate` channel — multiplicative on `combined` per `CalcFinalStat`
 *  — so they CANNOT be pre-baked to a flat `eff` add without diverging
 *  whenever `combined` ≠ `baseForRate.eff`. Example: Notia core
 *  `core_passive_buff_chance` +50% EFF on baseline 170 → in-game 255, baked
 *  approximation gives 240 (off by 15). */
export interface StatBlock {
  atk: number; def: number; hp: number; spd: number;
  chc: number; chd: number; pen: number;
  dmgInc: number; dmgRed: number;
  eff: number; res: number;
  effRate: number; resRate: number;
  atkPct: number; defPct: number; hpPct: number;
}

/** Codex (Hero Archive) %-multiplier curve indexed by codex level (0..11).
 *  Lv 0 = no codex, Lv 11 = max. Account-wide — same for every char. */
export type CodexCurve = Array<{ atkPct: number; defPct: number; hpPct: number }>;

/** A per-stat lv 1 / lv 100 anchor pair. Min and max are extracted from
 *  CharacterTemplet *_Min / *_Max — the composer interpolates linearly to
 *  the captured level (and scales past lv 100 with the LB modifier). */
export interface StatBracket { min: number; max: number }

/** Raw ingredients extracted per character — the web layer composes them
 *  with the captured user progression (level, TransStar, …). All systems
 *  (codex / Geas / Skill_8) are always-on per the in-game stat sheet. */
export interface CharacterIngredients {
  /** lv 1 / lv 100 anchors for every base stat. Stats where min == max
   *  (typically SPD / CHC / CHD / EFF for most chars) don't grow with level. */
  base: {
    atk: StatBracket; def: StatBracket; hp: StatBracket; spd: StatBracket;
    chc: StatBracket; chd: StatBracket; eff: StatBracket; res: StatBracket;
  };
  /** Per-EvolutionLevel cumulative stat row. The key matches `TransStar` in
   *  the in-game tree — at TransStar N the character has unlocked every row
   *  with EvolutionLevel ≤ N. */
  evoByLevel: Record<string, StatBlock>;
  /** Per-TransStar transcend %-bonuses + the Skill_8 level + UI star fields.
   *  `showUIStar` / `starPlus` are sourced from CharacterTranscendentTemplet
   *  and feed the CalcBattlePower formula (star_bonus = showUIStar×500 +
   *  starPlus×120). Keys are TransStar (2..9 / 3..9 depending on BasicStar). */
  transcendByStar: Record<string, {
    atkPct: number; defPct: number; hpPct: number;
    skillLevel: number;
    showUIStar: number;
    starPlus: number;
  }>;
  /** Skill_22 always-on class passive stats (already at max level). */
  classPassive: StatBlock;
  /** Skill_8 transcendent-skill stats keyed by SkillLevel. Always applied —
   *  matches the in-game character sheet (e.g. D.Luna's CRC 21 / CHD 230 /
   *  PEN 30 only reproduce with the Skill_8 lv4 contributions included). */
  skill8ByLevel: Record<string, StatBlock>;
  /** User-leveled skill passives. S1 / S2 / S3 map to the captured
   *  `First` / `Second` / `Ultimate` skill levels. Each entry is the
   *  cumulative buff at that SkillLevel (buff progression follows the
   *  floor convention: at SkillLv L we use the highest BuffLevel ≤ L —
   *  Ame S2 Lv5 = BuffLv4 = +25% CHC since no BuffLv5 exists). Empty
   *  object when the skill has no permanent self-stat passive. */
  s1ByLevel: Record<string, StatBlock>;
  s2ByLevel: Record<string, StatBlock>;
  s3ByLevel: Record<string, StatBlock>;
  /** Core Fusion passive (Skill_23, only present on `27xxxxx` char IDs).
   *  Always at max SkillLevel since the user has no slider for it. Null
   *  for non-core chars or when the Skill_23 buffs are combat-only. */
  corePassive: StatBlock | null;
  /** Geas — per-node table of awakening contributions that apply to this
   *  char (element/class/subclass scope). Outer key = NodeID matching the
   *  GiftID in the captured `/gift/info` GiftList. Each entry carries:
   *   - `source`: "stat" when the underlying rows are IOT_STAT (direct stat
   *     adds, in-game shown in the WHITE portion of each stat), or "buff"
   *     when they're IOT_BUFF (BT_STAT_PREMIUM buffs, in-game bundled into
   *     the YELLOW investment delta).
   *   - `levels`: per-level cumulative StatBlock (not delta — at level N the
   *     value IS the total bonus, not adds-to-prior).
   *  When no capture is available the runtime composer falls back to the
   *  per-node max level. */
  geasByNode: Record<string, { source: "stat" | "buff"; levels: Record<string, StatBlock> }>;
}

/** Per-node Geas levels owned by the user account — mirrors `GiftList` from
 *  the captured `/gift/info` payload (`GiftID` == `NodeID`). Account-wide,
 *  shared by every character; the per-char applicability is already baked
 *  into each `geasByNode`. */
export type UserGeasLevels = Record<string, number>;

export interface CharacterDef {
  name: string | null;
  /** In-game display prefix for limited/alt-class variants (e.g. "Gnosis"
   *  for Gnosis Dahlia, "Mystic Sage" for M.S.Ame, "Midnight Rush" for
   *  Mr.Skadi). Resolved from CharacterTemplet.NickNameID, gated by
   *  CharacterExtraTemplet.ShowNickName=True. Null when the char doesn't
   *  display a prefix in-game (e.g. Aer's nickname "Slacker Surfer Knight"
   *  exists in TextCharacter but ShowNickName is false). */
  nickname: string | null;
  cls: string | null;
  element: string | null;
  star: number | null;
  recommendSetId: string | null;
  /** Null only if calc-stats couldn't find a row (defensive fallback). */
  ingredients: CharacterIngredients | null;
}
export type CharactersTable = Record<string, CharacterDef>;

/** Cumulative XP threshold to reach each level (ExpCharacterTemplet). Index = level;
 *  slot 0 is unused. Cap is element 120 (game max level). */
export type ExpCharacterCurve = number[];

/** CharacterMaxLevelTemplet keyed by `${BasicStar}|${Step}`. Step 0 is implicit
 *  (no break, MaxLevel=100). `statModifierAfter100` feeds the per-level growth
 *  formula for stats unlocked above level 100. */
export interface LevelBreakRow {
  requireLevel: number;
  maxLevel: number;
  statModifierAfter100: number;
}
export type CharLevelMaxTable = Record<string, LevelBreakRow>;

/** Sorted (ascending by `requiredCount`) thresholds from `ArchiveBonusTemplet`.
 *  Maps a user's total `ArchiveCharacterRewardInfo` reward count to a codex
 *  level 1..11 (the row from `CharacterArchiveStatTemplet`). Account-wide. */
export type ArchiveBonusCurve = Array<{ requiredCount: number; level: number }>;

/** Cumulative `TrustExp` needed to reach each Trust level. Index = Trust level
 *  (slot 0 unused, caps at index 100); value = the `TrustExp` threshold. The
 *  in-game Trust system caps at level 100 (850 000 TrustExp). */
export type TrustExpCurve = number[];

/** Per-tier Trust buff — flat add to ATK / DEF / HP. `TrustBuffTemplet` emits
 *  these in declared order (5×ATK, 5×DEF, 5×HP); the game rule for which tier
 *  unlocks at which Trust level is "every 20 levels = +1 tier" (max 5 at Lv
 *  100). Currently NOT applied anywhere: in-game Trust is invisible on the
 *  character sheet AND not folded into the displayed sheet ATK, so the
 *  no-gear / displayed-combat composer ignores it. Wire it only if Outerplane
 *  ever exposes Trust on the character sheet. */
export interface TrustBuffEntry {
  tier: number;
  buffId: string;
  stat: string;
  apply: string;
  value: number;
}
export type TrustBuffTable = TrustBuffEntry[];

/** Resolve a captured `TrustExp` to a Trust level using the per-level
 *  cumulative TrustExp curve. Same pattern as `expToLevel`: returns the
 *  highest level whose threshold is ≤ exp; clamps to 1..(curve.length-1). */
export function trustExpToLevel(curve: TrustExpCurve, trustExp: number): number {
  let lv = 1;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]! <= trustExp) lv = i;
    else break;
  }
  return lv;
}

/** Resolve the user's account-wide codex level from the captured
 *  `/archive/info` total reward count. Returns 0 when below the first
 *  threshold (no codex bonus unlocked yet). */
export function resolveCodexLevel(curve: ArchiveBonusCurve, totalRewardCount: number): number {
  let level = 0;
  for (const row of curve) {
    if (row.requiredCount > totalRewardCount) break;
    level = row.level;
  }
  return level;
}

/** Everything the parser/solver may need from static game data. */
export interface GameData {
  options: OptionsTable;
  equipment: EquipmentTable;
  sets: SetsTable;
  equipmentPassives: EquipmentPassivesTable;
  multiTierPassives: MultiTierPassivesTable;
  gems: GemsTable;
  singularityOptions: SingularityOptionsTable;
  eePassives: EePassivesTable;
  characters: CharactersTable;
  enhance: EnhanceData;
  buffs: BuffsTable;
  expCharacter: ExpCharacterCurve;
  charLevelMax: CharLevelMaxTable;
  codexCurve: CodexCurve;
  archiveBonus: ArchiveBonusCurve;
  trustCharacter: TrustExpCurve;
  trustBuffs: TrustBuffTable;
}

/** Resolve a character's cumulative XP to a level using the ExpCharacterTemplet
 *  curve. Returns `lv1` for any sub-threshold XP and clamps to the max level. */
export function expToLevel(curve: ExpCharacterCurve, exp: number): number {
  let lv = 1;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]! <= exp) lv = i;
    else break;
  }
  return lv;
}
