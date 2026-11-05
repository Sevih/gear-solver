/**
 * +15 passives — the Singularity option a piece rolls at +15
 * (`SingularityOptionID`), read as a FAMILY (the option's `name` in
 * `game.singularityOptions`, 15 of them) and a GRADE (the `C` … `S+` letter its
 * `desc` opens with). Pure: shared by the Optimizer's passive picks (the engine
 * reads `GearPiece.main`) and Gear's Filter modal (`UiPiece.effects`). A piece
 * that isn't +15 has no passive; nothing here projects one.
 */
import type { GameData, GearPiece } from "@gear-solver/core";
import type { UiPiece } from "../design/adapter.js";
import { singularityGrade, singularityShortLabel } from "../design/gearCardText.js";

/** Grades from worst to best — every family rolls all five. */
export const SINGULARITY_GRADES = ["C", "B", "A", "S", "S+"] as const;
export type SingularityGrade = (typeof SINGULARITY_GRADES)[number];

export function isSingularityGrade(v: unknown): v is SingularityGrade {
  return typeof v === "string" && (SINGULARITY_GRADES as readonly string[]).includes(v);
}

/** Whether `grade` is `min` or better. */
export function gradeAtLeast(grade: SingularityGrade, min: SingularityGrade): boolean {
  return SINGULARITY_GRADES.indexOf(grade) >= SINGULARITY_GRADES.indexOf(min);
}

export interface Passive {
  /** The option's `name`, trimmed (the table spells one family with a trailing
   *  space: "DMG Increase to target "). */
  family: string;
  /** Null when the `desc` doesn't open on a grade letter. */
  grade: SingularityGrade | null;
}

/** A Singularity option (or a piece's `singularity` main entry) as a passive;
 *  null without a name. */
export function passiveOf(e: { name?: string | null; desc?: string | null }): Passive | null {
  const family = e.name?.trim();
  if (!family) return null;
  const g = singularityGrade(e.desc ?? null)?.grade.toUpperCase();
  return { family, grade: isSingularityGrade(g) ? g : null };
}

/** The passive of an engine piece — its `source === "singularity"` main. */
export function passiveOfGearPiece(piece: Pick<GearPiece, "main">): Passive | null {
  const entry = piece.main.find((m) => m.source === "singularity");
  return entry ? passiveOf(entry) : null;
}

/** The passive of a UI piece — its Singularity effect. */
export function passiveOfUiPiece(p: Pick<UiPiece, "effects">): Passive | null {
  for (const e of p.effects) {
    const passive = passiveOf(e);
    if (passive) return passive;
  }
  return null;
}

/** A requested +15 passive counted on the sheet — the piece's `singularity`
 *  main entry when its family is `required` in the piece's group. */
export interface CountedPassive {
  /** `dmgUp` (weapon, accessory, most families) or `dmgReduce` (armor). */
  stat: string;
  value: number;
  family: string;
  grade: SingularityGrade | null;
}

/** Passive picks as the reducer or a solve request holds them, read for their
 *  state only. */
export type PassivePickStates = Record<string, Record<string, { state: string; minGrade?: string }> | undefined>;

/** The required families of a group (`passivePicks[group]`), or null without
 *  any. Shared by the engine (pool step) and the results table (marker). */
export function requiredFamiliesOf(
  picks: PassivePickStates | null | undefined,
  group: PassiveGroup | null,
): Set<string> | null {
  if (!group) return null;
  const out = new Set<string>();
  for (const [family, p] of Object.entries(picks?.[group] ?? {})) if (p?.state === "required") out.add(family);
  return out.size > 0 ? out : null;
}

/** The piece's conditional passive (`combatOnly`) when its family is one of
 *  `required`; null otherwise — no passive, a family not required, or an
 *  unconditional one (already on the sheet). */
export function countedPassiveOf(piece: Pick<GearPiece, "main">, required: ReadonlySet<string> | null): CountedPassive | null {
  if (!required) return null;
  const entry = piece.main.find((m) => m.source === "singularity");
  if (!entry || !entry.combatOnly) return null;
  const passive = passiveOf(entry);
  if (!passive || !required.has(passive.family)) return null;
  return { stat: entry.stat, value: entry.value, family: passive.family, grade: passive.grade };
}

/** The piece with its requested passive counted: a CLONE whose `singularity`
 *  main entry is `combatOnly: false`, so `composeBuild` folds it into the
 *  sheet (`fromBuff` → `dmgUp` / `dmgReduce`). The same reference when nothing
 *  is counted (`countedPassiveOf`) — the inventory is shared, never mutated. */
export function withRequestedPassiveCounted(piece: GearPiece, required: ReadonlySet<string> | null): GearPiece {
  if (!countedPassiveOf(piece, required)) return piece;
  return { ...piece, main: piece.main.map((m) => (m.source === "singularity" ? { ...m, combatOnly: false } : m)) };
}

/** The requested passives a build's pieces carry (`countedPassiveOf` per
 *  piece, in piece order) — what the engine counted on its sheet, for the
 *  results table's "+15" marker. */
export function countedPassivesOfBuild(
  pieces: ReadonlyArray<GearPiece | undefined>,
  picks: PassivePickStates | null | undefined,
): CountedPassive[] {
  const out: CountedPassive[] = [];
  if (!picks) return out;
  for (const piece of pieces) {
    if (!piece) continue;
    const counted = countedPassiveOf(piece, requiredFamiliesOf(picks, passiveGroupOf(piece.slot)));
    if (counted) out.push(counted);
  }
  return out;
}

/** "+45% DS DMG+ (A) · +40% vs Fire DMG+ (B)" — the marker's tooltip. */
export function countedPassivesTitle(list: ReadonlyArray<CountedPassive>): string {
  return list.map((c) => `+${Math.round(c.value * 10) / 10}% ${passiveLabel(c.family)}${c.grade ? ` (${c.grade})` : ""}`).join(" · ");
}

export type PassiveGroup = "weapon" | "accessory" | "armor";
export const PASSIVE_GROUPS: readonly PassiveGroup[] = ["weapon", "accessory", "armor"];

/** The Optimizer group a slot's passive is filtered in (engine or design slot
 *  names): the four armor pieces together; talisman and EE carry none. */
export function passiveGroupOf(slot: string | null | undefined): PassiveGroup | null {
  if (slot === "weapon") return "weapon";
  if (slot === "accessory") return "accessory";
  if (slot === "helmet" || slot === "armor" || slot === "gloves" || slot === "boots") return "armor";
  return null;
}

/** Short label of a family ("DS DMG+", "vs Fire DMG+"…), else its name. */
export function passiveLabel(family: string): string {
  return singularityShortLabel(family) ?? family;
}

/** The families in table order (first id of each), for a stable chip order. */
export function passiveFamilyOrder(game: Pick<GameData, "singularityOptions"> | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const ids = Object.keys(game?.singularityOptions ?? {}).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const family = game!.singularityOptions[id]?.name?.trim();
    if (family && !seen.has(family)) { seen.add(family); out.push(family); }
  }
  return out;
}

/** The colors the table paints each grade letter in (`<color=#…>` of the
 *  desc) — the fallback when no table is loaded. */
const GRADE_COLOR_FALLBACK: Record<SingularityGrade, string> = {
  C: "#27D054", B: "#0EA8F5", A: "#F5340E", S: "#b266ff", "S+": "#ff00ff",
};

/** The color a piece's card shows a grade letter in: that of the first option
 *  of the table carrying this grade (`singularityGrade(desc).color`), else the
 *  table's usual color. */
export function singularityGradeColor(grade: SingularityGrade, game: Pick<GameData, "singularityOptions"> | null | undefined): string {
  const ids = Object.keys(game?.singularityOptions ?? {}).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const g = singularityGrade(game!.singularityOptions[id]?.desc ?? null);
    if (g?.color && g.grade.toUpperCase() === grade) return g.color;
  }
  return GRADE_COLOR_FALLBACK[grade];
}
