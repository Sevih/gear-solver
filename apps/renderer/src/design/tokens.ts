/**
 * Design tokens for gear-solver UI — ported from
 * outerpedia/project/gs-data.jsx (Claude Design handoff bundle).
 *
 * Visual identity:
 * - Space Grotesk (UI) + JetBrains Mono (numbers/data).
 * - Violet (#9D51FF) for the brand mark, cyan (#22d3ee) reserved for the
 *   primary solve/optimise action, gold (#fbbf24) for stat values, amber for
 *   star rows, Singularity vertical gradient cyan → violet → magenta.
 * - Item rarity uses the Outerplane gear vocabulary (normal/superior/epic/
 *   legendary) — we adapt our core `Rarity` type (normal/magic/rare/unique).
 */

export type DesignRarity = "normal" | "superior" | "epic" | "legendary";
export type SlotId =
  | "weapon" | "helmet" | "armor" | "gloves" | "boots"
  | "accessory" | "talisman" | "exclusive";

export interface RarityTokens { label: string; short: string; fg: string; bd: string; bg: string }
export const RARITY: Record<DesignRarity, RarityTokens> = {
  normal:    { label: "Normal",    short: "N", fg: "#e5e7eb", bd: "rgba(229,231,235,0.30)", bg: "rgba(229,231,235,0.06)" },
  superior:  { label: "Superior",  short: "M", fg: "#4ade80", bd: "rgba(74,222,128,0.38)",  bg: "rgba(74,222,128,0.08)" },
  epic:      { label: "Epic",      short: "R", fg: "#93c5fd", bd: "rgba(147,197,253,0.42)", bg: "rgba(147,197,253,0.08)" },
  legendary: { label: "Legendary", short: "U", fg: "#f87171", bd: "rgba(248,113,113,0.42)", bg: "rgba(248,113,113,0.08)" },
};

export const SINGULARITY_GRADIENT_V = "linear-gradient(180deg, #16EBF1 0%, #9D51FF 50%, #E02BCD 100%)";
export const SINGULARITY_GRADIENT_H = "linear-gradient(90deg, #16EBF1 0%, #9D51FF 50%, #E02BCD 100%)";

export const TOKENS = {
  gold: "#fbbf24",
  cyan: "#22d3ee",
  buff: "#38bdf8",
  debuff: "#f87171",
  starGold: "#facc15",
} as const;

export type StatKind = "off" | "def" | "util";
export interface StatTokens {
  /** Short label (3-5 chars) used in dense UI (substat chips, sort headers). */
  label: string;
  /** Long label used in the item-detail panel - matches the in-game wording
   *  (sourced manually from TextSystem - the build pipeline could one day
   *  derive these from the game's locale tables, but the set of stat types
   *  is small enough to maintain by hand). */
  longLabel: string;
  kind: StatKind;
  color: string;
  icon: string | null;
}

/** Maps engine StatType → display labels + kind + color + APK icon filename.
 *  Icons live in outerpedia-v2's /images/ui/effect/ folder (served at /img/ui/effect/).
 *  `null` when no game-side icon exists for the stat. */
export const STAT: Record<string, StatTokens> = {
  atk:       { label: "ATK",   longLabel: "Attack",            kind: "off",  color: "#fbbf24", icon: "CM_Stat_Icon_ATK" },
  atkPct:    { label: "ATK%",  longLabel: "Attack",            kind: "off",  color: "#fbbf24", icon: "CM_Stat_Icon_ATK" },
  hp:        { label: "HP",    longLabel: "HP",                kind: "def",  color: "#a3e635", icon: "CM_Stat_Icon_HP" },
  hpPct:     { label: "HP%",   longLabel: "HP",                kind: "def",  color: "#a3e635", icon: "CM_Stat_Icon_HP" },
  def:       { label: "DEF",   longLabel: "Defense",           kind: "def",  color: "#93c5fd", icon: "CM_Stat_Icon_DEF" },
  defPct:    { label: "DEF%",  longLabel: "Defense",           kind: "def",  color: "#93c5fd", icon: "CM_Stat_Icon_DEF" },
  spd:       { label: "SPD",   longLabel: "Speed",             kind: "util", color: "#22d3ee", icon: "CM_Stat_Icon_SPEED" },
  critRate:  { label: "CRC",   longLabel: "Crit Chance",       kind: "off",  color: "#fbbf24", icon: "CM_Stat_Icon_CRITICAL" },
  critDmg:   { label: "C.DMG", longLabel: "Crit DMG",          kind: "off",  color: "#fbbf24", icon: "CM_Stat_Icon_CRITICAL_DMG" },
  eff:       { label: "EFF",   longLabel: "Effectiveness",     kind: "util", color: "#38bdf8", icon: "CM_Stat_Icon_CHANCE" },
  effRes:    { label: "RES",   longLabel: "Effect Resistance", kind: "util", color: "#38bdf8", icon: "CM_Stat_Icon_RESIST" },
  dmgUp:     { label: "DMG+",  longLabel: "DMG Increase",      kind: "off",  color: "#fb923c", icon: "CM_Stat_Icon_DMG_INCREASE" },
  dmgReduce: { label: "DMG-",  longLabel: "DMG Reduction",     kind: "def",  color: "#93c5fd", icon: "CM_Stat_Icon_ENEMY_DMG_REDUCE" },
  pen:       { label: "PEN",   longLabel: "Penetration",       kind: "off",  color: "#fbbf24", icon: "CM_Stat_Icon_PIERCE_POWER" },
  critDmgReduce: { label: "CDMG RED%", longLabel: "Crit DMG Reduction", kind: "def", color: "#93c5fd", icon: "CM_Stat_Icon_ENEMY_CRITICAL_DMG_REDUCE" },
  hitAp:     { label: "HitAP", longLabel: "Hit AP",            kind: "util", color: "#22d3ee", icon: null },
  killAp:    { label: "KillAP",longLabel: "Kill AP",           kind: "util", color: "#22d3ee", icon: null },
  // Set-bonus only stats — no in-game stat icon exists, fall back to the
  // short label via StatIcon's text path.
  lifesteal: { label: "LIFE",  longLabel: "Lifesteal",         kind: "util", color: "#fb7185", icon: null },
  counter:   { label: "CTR",   longLabel: "Counterattack",     kind: "util", color: "#fca5a5", icon: null },
  enterAp:   { label: "AP+",   longLabel: "Starting AP",       kind: "util", color: "#22d3ee", icon: null },
};

export interface SlotMeta {
  id: SlotId;
  label: string;
  short: string;
  /** In-game inventory tab icon filename — served at /img/ui/inven/<icon>.png.
   *  Naming gotchas: boots ↔ "Shoes", talisman ↔ "Oopart". */
  icon: string;
}
// Display order: weapon → accessory → armor pieces (top-down: helmet, armor,
// gloves, boots) → special gear (EE, then talisman). Mirrors the in-game
// inventory tab ordering players are used to.
export const SLOTS: SlotMeta[] = [
  { id: "weapon",    label: "Weapon",    short: "WPN", icon: "CM_Inven_Tab_Weapon" },
  { id: "accessory", label: "Accessory", short: "ACC", icon: "CM_Inven_Tab_Accessory" },
  { id: "helmet",    label: "Helmet",    short: "HLM", icon: "CM_Inven_Tab_Helmet" },
  { id: "armor",     label: "Armor",     short: "ARM", icon: "CM_Inven_Tab_Armor" },
  { id: "gloves",    label: "Gloves",    short: "GLV", icon: "CM_Inven_Tab_Gloves" },
  { id: "boots",     label: "Boots",     short: "BTS", icon: "CM_Inven_Tab_Shoes" },
  { id: "exclusive", label: "Exclusive", short: "EE",  icon: "CM_Inven_Tab_Exclusive" },
  { id: "talisman",  label: "Talisman",  short: "TAL", icon: "CM_Inven_Tab_Oopart" },
];
export const SLOT_BY: Record<string, SlotMeta> = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

/** Engine rarity → design rarity. The core types use the in-game vocabulary
 *  (normal/magic/rare/unique); the design adopts the localised one. */
export function toDesignRarity(r: string | null | undefined): DesignRarity {
  switch (r) {
    case "magic": return "superior";
    case "rare": return "epic";
    case "unique": return "legendary";
    default: return "normal";
  }
}

/** Engine slot ("ooparts" / "shoes" / …) → design slot ID. */
export function toDesignSlot(s: string | null | undefined): SlotId | null {
  if (!s) return null;
  if (s === "ooparts") return "talisman";
  if (s === "shoes") return "boots";
  // weapon | helmet | armor | gloves | boots | accessory | talisman | exclusive
  return s as SlotId;
}

/** Optional helper to choose the chip tone given a stat color kind. */
export function statColor(kind: StatKind | undefined): string {
  return kind === "off" ? "rgba(252,211,77,0.92)"
       : kind === "def" ? "rgba(147,197,253,0.85)"
       : "rgba(103,232,249,0.85)";
}
