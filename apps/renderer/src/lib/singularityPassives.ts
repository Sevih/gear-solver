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
