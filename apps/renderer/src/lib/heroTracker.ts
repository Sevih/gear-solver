/**
 * Hero-tracker export — turns the captured roster into the `outerpedia:hero-tracker`
 * interchange document consumed by the planner (which chiffres *what a hero still
 * needs*, so it wants progression only: no gear, no stats, no inventory).
 *
 * Contract (v1), one entry per OWNED hero keyed by its BASE game id — never the
 * core-fusion id, which lives under `core_fusion`:
 *
 *   { format, version, heroes: { "2000043": {
 *       owned, level, skills:{s1,s2,s3,chain_passive}, affinity,
 *       transcend_star, ee, core_fusion?: { level, ee } } } }
 *
 * Every field is clamped to the range the game itself allows, so a corrupt or
 * partial capture can't inject an out-of-domain value into the importer.
 */
import { expToLevel, trustExpToLevel, type GameData, type Inventory } from "@gear-solver/core";

export const HERO_TRACKER_FORMAT = "outerpedia:hero-tracker";
export const HERO_TRACKER_VERSION = 1;

/** In-game floors/ceilings (see the field table in docs/data-schema.md). */
const LEVEL_MIN = 5;      // recruitment level
const LEVEL_MAX = 120;    // fully limit-broken
const SKILL_MIN = 1;
const SKILL_MAX = 5;
const AFFINITY_MIN = 1;
const AFFINITY_MAX = 100;
const TRANSCEND_MAX = 9;  // internal star (CharacterTranscendentTemplet), 9 = 6★
const EE_MAX = 10;
const FUSION_MIN = 1;     // owning the fused variant means tier 1 is already paid
const FUSION_MAX = 5;

export interface HeroTrackerEntry {
  owned: true;
  level: number;
  skills: { s1: number; s2: number; s3: number; chain_passive: number };
  affinity: number;
  transcend_star: number;
  /** EE enhance level 0..10 — 0 also means "no EE owned". */
  ee: number;
  /** Present only when the core-fusion variant is owned. */
  core_fusion?: { level: number; ee: number };
}

export interface HeroTrackerDoc {
  format: typeof HERO_TRACKER_FORMAT;
  version: typeof HERO_TRACKER_VERSION;
  heroes: Record<string, HeroTrackerEntry>;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Highest enhance level owned per EE item id. An EE's `itemId` IS its
 * character id (base `20xxxxx`, core-fusion `27xxxxx`), so this doubles as the
 * hero→EE index without going through equip slots — an EE sitting unequipped
 * in the bag still counts, which is what the tracker means by "owned".
 * Duplicates keep the best copy.
 */
function eeLevelsByItemId(inventory: Inventory): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of inventory.gear) {
    if (g.slot !== "exclusive") continue;
    const cur = out.get(g.itemId);
    const lv = clamp(g.enhanceLevel, 0, EE_MAX);
    if (cur === undefined || lv > cur) out.set(g.itemId, lv);
  }
  return out;
}

/**
 * Build the export document. `game` supplies the XP/trust curves and the
 * per-hero base rarity (the transcend floor). Heroes the game data doesn't
 * know are still exported — the importer reports unknown ids rather than
 * silently dropping account state.
 */
export function buildHeroTrackerExport(inventory: Inventory, game: GameData): HeroTrackerDoc {
  const ees = eeLevelsByItemId(inventory);
  const heroes: Record<string, HeroTrackerEntry> = {};

  for (const c of inventory.characters) {
    // `transcend_star` starts at the hero's base rarity (an untranscended 3★
    // reads 3, not 0) — clamp against it so a zeroed capture field can't
    // export a value the tracker would read as "below base rarity".
    const baseStar = game.characters[String(c.charId)]?.star ?? 1;
    const entry: HeroTrackerEntry = {
      owned: true,
      level: clamp(expToLevel(game.expCharacter, c.exp), LEVEL_MIN, LEVEL_MAX),
      skills: {
        s1: clamp(c.skills.first, SKILL_MIN, SKILL_MAX),
        s2: clamp(c.skills.second, SKILL_MIN, SKILL_MAX),
        s3: clamp(c.skills.ultimate, SKILL_MIN, SKILL_MAX),
        chain_passive: clamp(c.skills.chainPassive, SKILL_MIN, SKILL_MAX),
      },
      affinity: clamp(trustExpToLevel(game.trustCharacter, c.trustExp), AFFINITY_MIN, AFFINITY_MAX),
      transcend_star: clamp(c.stars, clamp(baseStar, 1, TRANSCEND_MAX), TRANSCEND_MAX),
      ee: ees.get(c.charId) ?? 0,
    };
    if (c.fusionCharId) {
      entry.core_fusion = {
        level: clamp(c.fusionLevel || FUSION_MIN, FUSION_MIN, FUSION_MAX),
        ee: ees.get(c.fusionCharId) ?? 0,
      };
    }
    // A duplicate CharID can't happen in-game (one instance per hero), but if a
    // merged capture ever produced one, keep the more-progressed entry.
    const prev = heroes[String(c.charId)];
    if (!prev || entry.level > prev.level) heroes[String(c.charId)] = entry;
  }

  return { format: HERO_TRACKER_FORMAT, version: HERO_TRACKER_VERSION, heroes };
}
