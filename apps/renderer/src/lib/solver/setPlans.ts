/**
 * Set-plan helpers — the generalized OR-of-AND set model.
 *
 *   setPlans: SetPlan[]   // OR : the build is valid iff AT LEAST ONE plan holds
 *   SetPlan = SetCond[]   // AND : every cond ({setId, count}) holds at once
 *
 * The engine consumes the already-expanded form: authoring shortcuts (4pc
 * among N, 2pc+2pc, fixed-2pc + mix) are compiled into explicit plans by the
 * UI / preset translator, so the hot path only ever evaluates plain plans.
 *
 * All functions are pure (no engine deps) so they unit-test in isolation and
 * are reusable by the Get-Preset translator.
 */
import type { SetPlan } from "./types.js";

/** The Builder's per-set chip encoding (its reducer state). `off` is the
 *  implicit default for a set with no chip. */
export type SetChipState = "off" | "req-2pc" | "req-4pc" | "excluded";

/**
 * Expand the Builder's 4-state per-set chips into the engine's `setPlans` +
 * `excludedSets`. The legacy semantics AND every required set, which maps to a
 * SINGLE plan holding every required cond → exact behavior parity with the old
 * `req-2pc`/`req-4pc` model. `excluded` is orthogonal (a flat pool filter).
 */
export function setPicksToPlans(
  picks: Record<string, SetChipState>,
): { setPlans: SetPlan[]; excludedSets: string[] } {
  const conds: SetPlan = [];
  const excludedSets: string[] = [];
  for (const [setId, state] of Object.entries(picks)) {
    if (state === "req-2pc") conds.push({ setId, count: 2 });
    else if (state === "req-4pc") conds.push({ setId, count: 4 });
    else if (state === "excluded") excludedSets.push(setId);
  }
  // No required sets → no plan (empty = "anything goes"). One+ required sets →
  // a single AND-plan, preserving the old all-must-hold behavior.
  return { setPlans: conds.length > 0 ? [conds] : [], excludedSets };
}

/** Union of every setId referenced by any plan — the pieces whose membership
 *  must survive the top-% prune (else a low-priority required piece is dropped
 *  and the constraint can never be met). */
export function planSetIds(setPlans: SetPlan[]): Set<string> {
  const ids = new Set<string>();
  for (const plan of setPlans) for (const c of plan) ids.add(c.setId);
  return ids;
}

/** A plan is feasible at the current depth when the pieces still missing for
 *  it fit in the slots left to fill: Σ max(0, count − have) ≤ remainingSlots. */
export function planFeasible(plan: SetPlan, setCount: Map<string, number>, remainingSlots: number): boolean {
  let need = 0;
  for (const { setId, count } of plan) {
    need += Math.max(0, count - (setCount.get(setId) ?? 0));
    if (need > remainingSlots) return false; // early-out, can't recover
  }
  return true;
}

/**
 * OR over plans: feasible if ANY plan is still reachable with `remainingSlots`
 * armor slots left. Empty `setPlans` = no requirement → always feasible.
 *
 * At `remainingSlots === 0` this doubles as leaf validation: a plan is
 * "feasible with 0 slots left" iff it's already fully satisfied (need === 0),
 * so the boots-depth `setsFeasible(…, 0)` call is exactly the build-valid test.
 */
export function setsFeasible(setPlans: SetPlan[], setCount: Map<string, number>, remainingSlots: number): boolean {
  if (setPlans.length === 0) return true;
  for (const plan of setPlans) {
    if (planFeasible(plan, setCount, remainingSlots)) return true;
  }
  return false;
}
