/**
 * Pure helpers of the piece card (`GearCard.tsx`) — labels, quality tone and
 * help, set level, and the compact card's short texts — written once for the
 * card and its readers (Inventory filter, preset quality).
 */
import { pieceSetLevel, type GameData } from "@gear-solver/core";
import type { UiEffect, UiPiece } from "./adapter.js";
import { STAT } from "./tokens.js";
import { QUALITY_COLOR, type QualityTier } from "../lib/quality.js";

/** Per-tier UI tone (text class + bar color + label). `bar` pulls from the
 *  shared `QUALITY_COLOR` so the Inventory filter and the quality bar agree. */
export const QUALITY_TONE: Record<QualityTier, { text: string; bar: string; label: string }> = {
  poor:      { text: "text-white",      bar: QUALITY_COLOR.poor,      label: "Poor" },
  decent:    { text: "text-sky-300",    bar: QUALITY_COLOR.decent,    label: "Decent" },
  good:      { text: "text-emerald-300",bar: QUALITY_COLOR.good,      label: "Good" },
  excellent: { text: "text-violet-300", bar: QUALITY_COLOR.excellent, label: "Excellent" },
  perfect:   { text: "text-amber-300",  bar: QUALITY_COLOR.perfect,   label: "Perfect" },
};

/** Help text of the card's quality score (hover on "Quality", or the compact
 *  line's `title`). */
export const QUALITY_HELP = "Sum of every substat tick (initial roll + reforge procs) vs the cap for the item's CURRENT investment: base 14 (4+4+3+3) plus 1 per reforge already spent. Singularity adds up to 3 extra reforges. So a pristine 6★ caps at 14; fully reforged 20; ascended + fully reforged 23.";

/** Long stat label, disambiguating percent variants (atk vs atkPct), with a
 *  readable placeholder when STAT doesn't know the key (talisman/EE mains). */
export function statLong(key: string): string {
  const meta = STAT[key];
  if (!meta) return key.toUpperCase();
  if (key.endsWith("Pct")) return `${meta.longLabel}%`;
  return meta.longLabel;
}

type SetLevelEntry = NonNullable<GameData["sets"][string]>["levels"][number];

/** Pick which tier of a set's effect strings to display: the piece's set level
 *  from the contract (`pieceSetLevel` — its fallback included), else the
 *  highest level the set has. */
export function pickSetLevel(game: GameData, setId: string, bt: number) {
  const def = game.sets?.[setId];
  if (!def) return null;
  const wrap = (level: SetLevelEntry) => ({ name: def.name ?? null, desc: def.desc ?? null, level });
  const targetLevel = pieceSetLevel(def, bt);
  const exact = def.levels.find((l) => l.level === targetLevel);
  if (exact) return wrap(exact);
  const sorted = [...def.levels].sort((a, b) => b.level - a.level);
  return sorted[0] ? wrap(sorted[0]) : null;
}

/** Header name on a compact card: "EE" for the exclusive, the set name for an
 *  armor piece (its own name when the set is unknown), the item name
 *  otherwise. Never carries the "- [Singularity]" suffix — the gradient alone
 *  marks an ascended piece. */
export function compactName(piece: Pick<UiPiece, "name" | "slot" | "armorSetId">, game: GameData | null): string {
  if (piece.slot === "exclusive") return "EE";
  if (piece.slot === "helmet" || piece.slot === "armor" || piece.slot === "gloves" || piece.slot === "boots") {
    const setName = piece.armorSetId ? game?.sets?.[piece.armorSetId]?.name : null;
    return setName ?? piece.name;
  }
  return piece.name;
}

/** In-game text on one line (line breaks → spaces), for a truncated row. */
function oneLine(text: string): string {
  return text.replace(/\\n|\r\n|\n/g, " ");
}

/** The same text without its color tags — the row's `title`. */
function plainLine(text: string): string {
  return oneLine(text).replace(/<\/?color[^>]*>/g, "");
}

/** Short label of a Singularity option (the +15 bonus), from its name — the
 *  only place the condition lives: "DS DMG+", "vs Fire DMG-", "DMG+"… Null
 *  for any name outside the known patterns. */
const SINGULARITY_LABELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^DMG Increase to target$/i, () => "DMG+"],
  [/^Reduced DMG Taken from targets$/i, () => "DMG-"],
  [/^DMG Increase vs (Fire|Water|Earth|Light|Dark)$/i, (m) => `vs ${m[1]} DMG+`],
  [/^Reduced DMG Taken vs (Fire|Water|Earth|Light|Dark)$/i, (m) => `vs ${m[1]} DMG-`],
  [/^Increased DMG within Dimensional Singularity$/i, () => "DS DMG+"],
  [/^Reduced DMG taken within Dimensional Singularity$/i, () => "DS DMG-"],
  [/^Ultimate Skill DMG increases within Dimensional Singularity$/i, () => "DS Ult DMG+"],
];

export function singularityShortLabel(name: string | null): string | null {
  const n = name?.trim();
  if (!n) return null;
  for (const [re, label] of SINGULARITY_LABELS) {
    const m = n.match(re);
    if (m) return label(m);
  }
  return null;
}

/** Grade letter a Singularity option's `desc` opens with (`C` … `S+`) and the
 *  color of its `<color=#…>` tag; null when the desc doesn't start that way. */
export function singularityGrade(desc: string | null): { grade: string; color: string | null } | null {
  const m = desc?.trimStart().match(/^<color=(#[0-9a-f]{3,8})>\s*(S\+|S|A|B|C)\s*<\/color>/i);
  return m ? { grade: m[2]!, color: m[1]! } : null;
}

/** A Singularity effect on a compact card: a stat + value effect becomes its
 *  icon + signed value, a known +15 bonus its grade + icon + short label +
 *  signed value, any other description-only one its name (or the first 24
 *  characters of the untagged text). `title` keeps the full wording. */
export type CompactEffect =
  | { kind: "stat"; stat: string; value: string; title: string }
  | { kind: "short"; grade: { grade: string; color: string | null } | null; label: string; stat: string; value: string; title: string }
  | { kind: "text"; text: string; title: string };

export function compactEffect(e: Pick<UiEffect, "stat" | "value" | "name" | "desc">): CompactEffect {
  const label = singularityShortLabel(e.name);
  if (label) {
    const value = `${e.value.startsWith("-") ? "" : "+"}${e.value}`;
    const title = e.desc ? plainLine(e.desc).trim() : `${label} ${value}`;
    return { kind: "short", grade: singularityGrade(e.desc), label, stat: e.stat, value, title };
  }
  if (e.desc) {
    const plain = plainLine(e.desc).trim();
    const text = e.name ?? (plain.length > 24 ? `${plain.slice(0, 24).trimEnd()}…` : plain);
    return { kind: "text", text, title: plain };
  }
  const value = `${e.value.startsWith("-") ? "" : "+"}${e.value}`;
  return { kind: "stat", stat: e.stat, value, title: `${e.name ?? statLong(e.stat)} ${value}` };
}

/** Value tone of a compact substat cell: cyan when projected reforge ticks
 *  enter the line, violet when Transistone ticks do (cyan wins if both),
 *  amber at the 6-tick cap, white otherwise. */
export function compactSubTone(lv: number, added: number, transistone: number): "cyan" | "violet" | "amber" | "white" {
  if (added > 0) return "cyan";
  if (transistone > 0) return "violet";
  return lv >= 6 ? "amber" : "white";
}

/** `title` of a compact substat cell — everything the cell no longer shows:
 *  "LV 5 (4 + 1) · Attack% · T+1" (base + reforges [+ projected], Transistone). */
export function compactSubTitle(s: Pick<UiPiece["subs"][number], "lv" | "reforges" | "stat">, added = 0, transistone = 0): string {
  const base = s.lv - s.reforges;
  const extrapole = Math.max(0, added);
  const actuelle = s.reforges - extrapole;
  const split = s.reforges > 0 ? ` (${base} + ${actuelle}${extrapole > 0 ? ` + ${extrapole}` : ""})` : "";
  return `LV ${s.lv}${split} · ${statLong(s.stat)}${transistone > 0 ? ` · T+${transistone}` : ""}`;
}

/** Multi-tier passive tiers a card shows: every tier, minus the base one once
 *  its upgrade (a later non-additive tier) is unlocked. */
export function visiblePassiveTiers<T extends { isAdd: boolean; active: boolean }>(tiers: T[]): T[] {
  const upgrade = tiers.find((t, i) => i > 0 && !t.isAdd);
  return tiers.filter((_t, i) => !(upgrade && i === 0 && upgrade.active));
}

/** A compact card's multi-tier passive, moved to the name's `title`: the
 *  visible tiers, active first, untagged, joined by " · ". */
export function compactPassiveTitle(tiers: { isAdd: boolean; active: boolean; desc: string }[]): string {
  const visible = visiblePassiveTiers(tiers);
  return [...visible.filter((t) => t.active), ...visible.filter((t) => !t.active)]
    .map((t) => plainLine(t.desc).trim())
    .join(" · ");
}
