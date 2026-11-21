/**
 * Why a solve came back without a build — what the Optimizer's empty results
 * table says (`screens/builder/ResultsTable.tsx`), and what a team member's
 * line says after "Build team" (`lib/teams/teamSolver.ts`).
 *
 * Pure.
 */
import { SLOT_BY } from "../../design/tokens.js";
import type { PoolSizes, SolveEmptyCause } from "./types.js";

/** The slots whose pool the filters emptied — "Weapon: 0 pieces after filters
 *  (3 dropped: main stat excluded)" — joined by " · "; null when none is. The
 *  EE slot is skipped: a hero without one reports `exclusive: 0` and solves
 *  without it. */
export function deadSlotsReason(ps: PoolSizes | null | undefined): string | null {
  if (!ps) return null;
  const dead = Object.keys(ps).filter((s) => s !== "exclusive" && (ps[s]?.hit ?? 0) === 0);
  if (dead.length === 0) return null;
  return dead.map((s) => {
    const excluded = ps[s]?.mainExcluded ?? 0;
    const passive = ps[s]?.passiveExcluded ?? 0;
    const causes = [
      ...(excluded > 0 ? [`${excluded} dropped: main stat excluded`] : []),
      ...(passive > 0 ? [`${passive} dropped: +15 passive filter`] : []),
    ];
    const cause = causes.length > 0 ? ` (${causes.join(", ")})` : "";
    return `${SLOT_BY[s]?.label ?? s}: 0 pieces after filters${cause}`;
  }).join(" · ");
}

/** One line for a completed solve without a build: an emptied slot first,
 *  then the broken-sets rule, else the stat / rating bands. */
export function emptySolveReason(ps: PoolSizes | null | undefined, cause: SolveEmptyCause | null): string {
  const dead = deadSlotsReason(ps);
  if (dead) return `A slot has no pieces left after filtering — ${dead}`;
  if (cause === "brokenSets") return "No armor combination completes its sets with “Allow broken sets” off";
  return "No build passes the filters";
}
