/**
 * Results table "to do" column — how many of a build's six gear pieces still
 * have to be enhanced, reforged or ascended to reach the state the solve
 * projected them to (`pieceReforgePlan` in the solve's reforge mode). Talisman
 * and EE are not counted: the projection never touches them. Pure.
 */
import type { GameRules, GearPiece } from "@gear-solver/core";
import { maxReforgesOf, pieceReforgePlan, type ReforgeMode } from "../../lib/solver/engine.js";

const GEAR_SLOTS = new Set(["weapon", "helmet", "armor", "gloves", "boots", "accessory"]);

export interface BuildTodo {
  /** Pieces with at least one thing left to do. 0 = the build is reached as is. */
  pieces: number;
  /** Pieces below their enhance ceiling. */
  enhance: number;
  /** Lowest current enhance among them, and the highest ceiling — the title's
   *  "(+10 → +15)". Null without any piece to enhance. */
  enhanceFrom: number | null;
  enhanceTo: number | null;
  /** Reforges left, summed over the pieces (budget − done). */
  reforges: number;
  /** Pieces whose plan in the mode goes through ascension (see `buildTodoOf`)
   *  that aren't ascended yet. */
  ascend: number;
}

/** The "to do" of a build's pieces in a reforge mode; null under `disable`
 *  (no projection, nothing to reach — the column hides). */
export function buildTodoOf(pieces: ReadonlyArray<GearPiece | undefined>, mode: ReforgeMode, rules: GameRules): BuildTodo | null {
  if (mode === "disable") return null;
  const todo: BuildTodo = { pieces: 0, enhance: 0, enhanceFrom: null, enhanceTo: null, reforges: 0, ascend: 0 };
  for (const piece of pieces) {
    if (!piece || !GEAR_SLOTS.has(piece.slot ?? "")) continue;
    const { ceiling, budget } = pieceReforgePlan(piece, mode, rules);
    let any = false;
    if (piece.enhanceLevel < ceiling.enhanceLevel) {
      any = true;
      todo.enhance++;
      todo.enhanceFrom = Math.min(todo.enhanceFrom ?? piece.enhanceLevel, piece.enhanceLevel);
      todo.enhanceTo = Math.max(todo.enhanceTo ?? ceiling.enhanceLevel, ceiling.enhanceLevel);
    }
    if (piece.reforgeCount < budget) {
      any = true;
      todo.reforges += budget - piece.reforgeCount;
    }
    // The plan ascends when its ceiling does (+15R9) or when its budget takes the
    // ascension bonus (+10R9: the ceiling keeps `ascended: false`, a main-stat
    // formula flag, but reforges past the non-ascended count need ascension).
    if (!piece.ascended && (ceiling.ascended || budget > maxReforgesOf(piece, false, rules))) {
      any = true;
      todo.ascend++;
    }
    if (any) todo.pieces++;
  }
  return todo;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The cell's tooltip: "3 pieces — 2 to enhance (+10 → +15), 5 reforges, 1 to ascend". */
export function buildTodoTitle(todo: BuildTodo): string {
  if (todo.pieces === 0) return "Reached as is — nothing to enhance, reforge or ascend";
  const parts: string[] = [];
  if (todo.enhance > 0) parts.push(`${todo.enhance} to enhance (+${todo.enhanceFrom} → +${todo.enhanceTo})`);
  if (todo.reforges > 0) parts.push(plural(todo.reforges, "reforge"));
  if (todo.ascend > 0) parts.push(`${todo.ascend} to ascend`);
  return `${plural(todo.pieces, "piece")} — ${parts.join(", ")}`;
}
