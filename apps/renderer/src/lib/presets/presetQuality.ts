/**
 * Preset quality and +15 grades — the three summary lines under a preset
 * card's pieces (`PresetPieces`).
 *
 * Quality: the six rollable pieces' `gearPieceQuality` (`lib/quality.ts`, the
 * one rule) summed against a FIXED cap, 6 × 23 (each piece ascended + fully
 * reforged), so two presets compare on the same scale; the cap for the
 * current investment (sum of the pieces' own `max`) is kept alongside.
 *
 * Rolls: the Singularity (+15) roll of each piece, by SLOT — weapon and
 * accessory roll DMG Increase options (offensive), the four armor pieces
 * Reduced DMG Taken ones (defensive) — graded by `singularityGrade`.
 *
 * Tile main: the main stat shown under a piece's tile (`presetTileMain`).
 *
 * Pure: no React, no storage.
 */
import { DEFAULT_RULES, type GearPiece, type GearSlot } from "@gear-solver/core";
import type { UiMainStat } from "../../design/adapter.js";
import { singularityGrade } from "../../design/ResultGearDetail.js";
import { gearPieceQuality } from "../quality.js";
import type { PresetPiece } from "./presetRows.js";

/** Cap of one piece, ascended + fully reforged: base 14 + a 6★ piece's
 *  reforges + the Singularity bonus (`maxReforgesOf`) = 23. */
const PIECE_QUALITY_MAX = 14 + DEFAULT_RULES.reforge.countByStar[6]! + DEFAULT_RULES.reforge.ascendedBonus;

export const OFFENSIVE_SLOTS: readonly GearSlot[] = ["weapon", "accessory"];
export const DEFENSIVE_SLOTS: readonly GearSlot[] = ["helmet", "armor", "gloves", "boots"];
const QUALITY_SLOTS: readonly GearSlot[] = [...OFFENSIVE_SLOTS, ...DEFENSIVE_SLOTS];

export const PRESET_QUALITY_MAX = QUALITY_SLOTS.length * PIECE_QUALITY_MAX;

export interface PresetQuality {
  /** Sum of the six pieces' rolled ticks (missing piece / empty slot = 0). */
  current: number;
  /** `PRESET_QUALITY_MAX` (138). */
  max: number;
  /** Sum of the scored pieces' `max` — the cap for the current investment. */
  investedMax: number;
  /** Pieces with a quality score. */
  counted: number;
}

function pieceBySlot(pieces: readonly PresetPiece[]): Map<GearSlot, GearPiece> {
  const out = new Map<GearSlot, GearPiece>();
  for (const p of pieces) if (p.slot && p.piece && !out.has(p.slot)) out.set(p.slot, p.piece);
  return out;
}

export function presetQuality(pieces: readonly PresetPiece[]): PresetQuality {
  const bySlot = pieceBySlot(pieces);
  let current = 0;
  let investedMax = 0;
  let counted = 0;
  for (const slot of QUALITY_SLOTS) {
    const piece = bySlot.get(slot);
    const q = piece ? gearPieceQuality(piece) : null;
    if (!q) continue;
    current += q.current;
    investedMax += q.max;
    counted++;
  }
  return { current, max: PRESET_QUALITY_MAX, investedMax, counted };
}

/** One slot's +15 roll; all null when the slot is empty or the piece isn't
 *  ascended (no `singularity` main). */
export interface PresetRoll {
  slot: GearSlot;
  grade: string | null;
  color: string | null;
  /** The option's in-game name, for the tooltip. */
  name: string | null;
}

function rollOf(slot: GearSlot, piece: GearPiece | undefined): PresetRoll {
  const entry = piece?.main.find((m) => m.source === "singularity");
  const g = entry ? singularityGrade(entry.desc ?? null) : null;
  return { slot, grade: g?.grade ?? null, color: g?.color ?? null, name: entry?.name ?? null };
}

export function presetRolls(pieces: readonly PresetPiece[]): { offensive: PresetRoll[]; defensive: PresetRoll[] } {
  const bySlot = pieceBySlot(pieces);
  return {
    offensive: OFFENSIVE_SLOTS.map((s) => rollOf(s, bySlot.get(s))),
    defensive: DEFENSIVE_SLOTS.map((s) => rollOf(s, bySlot.get(s))),
  };
}

/** The main stat worth showing under a preset tile, by slot: on a weapon the
 *  first main that isn't the flat ATK every weapon carries (null when there's
 *  none); on an accessory or a talisman their first main; nothing on the four
 *  armor pieces or the EE (their mains tell nothing). */
export function presetTileMain(slot: GearSlot, mains: readonly UiMainStat[]): UiMainStat | null {
  if (slot === "weapon") return mains.find((m) => !(m.stat === "atk" && !m.percent)) ?? null;
  if (slot === "accessory" || slot === "ooparts") return mains[0] ?? null;
  return null;
}
