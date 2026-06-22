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

/** Per-buff stat table: BuffID → [stat entry at enhance level 0..N]. Used to resolve
 *  IOT_BUFF main stats on talismans. */
export type BuffsTable = Record<string, StatOption[]>;

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
  p2: SetEffect | null;
  p4: SetEffect | null;
}
export interface SetDef {
  name: string | null;
  levels: SetLevel[];
}
export type SetsTable = Record<string, SetDef>;

/** A 14-field stat delta — every contribution to a character's no-gear sheet
 *  flows through this shape. `*Pct` are %-multipliers on the relevant base
 *  stat (folded into the compound formula by `composeCharStats`). EFF/RES are
 *  integer points matching the in-game display. */
export interface StatBlock {
  atk: number; def: number; hp: number; spd: number;
  chc: number; chd: number; pen: number;
  dmgInc: number; dmgRed: number;
  eff: number; res: number;
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
