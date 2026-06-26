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

/** Number of armor slots that carry an `armorSetId` (helmet, armor, gloves,
 *  boots). Weapon / accessory / talisman / EE never belong to a set, so a set
 *  requirement can only consume these four. A plan whose conds sum to this many
 *  pieces leaves NO free armor slot; fewer leaves room for filler pieces. */
export const ARMOR_SLOTS = 4;

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

/** Total armor pieces a plan consumes — Σ of its conds' counts. `=== ARMOR_SLOTS`
 *  means the plan fills every armor slot (no room for filler); `< ARMOR_SLOTS`
 *  leaves free slots a filler piece can occupy; `> ARMOR_SLOTS` is infeasible
 *  (more pieces required than slots exist). */
export function planSlots(plan: SetPlan): number {
  let n = 0;
  for (const c of plan) n += c.count;
  return n;
}

/**
 * Whitelist of armor `setId`s admissible in the candidate pool given the set
 * plans — pieces whose `armorSetId` isn't in it (and null-set pieces) can be
 * dropped before the cartesian loop. Returns `null` when no pruning applies
 * (any piece may appear), so the caller keeps the pool intact.
 *
 * `formableSets` = sets reachable as a 2pc from the pool (present in ≥2 distinct
 * armor slots); only consulted when broken sets are disallowed, to decide which
 * sets may legally fill a free slot.
 *
 * Cases (OR over plans — a piece survives if ANY plan admits it):
 *  - No plan + broken allowed → `null` (nothing constrains the pool).
 *  - No plan + broken disallowed → only formable sets (every piece must pair).
 *  - A partial plan (free slots) + broken allowed → `null` (a filler can be
 *    anything, so no set is prunable).
 *  - Full plan (`planSlots === ARMOR_SLOTS`) → only its own conds' sets.
 *  - Partial plan + broken disallowed → its conds' sets PLUS every formable set
 *    (free slots must themselves complete a set).
 *  - Infeasible plan (`planSlots > ARMOR_SLOTS`) admits nothing → skipped.
 */
export function armorSetWhitelist(
  setPlans: SetPlan[],
  allowBrokenSets: boolean,
  formableSets: ReadonlySet<string>,
): Set<string> | null {
  if (setPlans.length === 0) {
    return allowBrokenSets ? null : new Set(formableSets);
  }
  // A partial plan with broken sets allowed accepts any filler → can't prune.
  if (allowBrokenSets && setPlans.some((p) => planSlots(p) < ARMOR_SLOTS)) {
    return null;
  }
  const allowed = new Set<string>();
  for (const plan of setPlans) {
    const slots = planSlots(plan);
    if (slots > ARMOR_SLOTS) continue; // infeasible plan admits nothing
    for (const c of plan) allowed.add(c.setId);
    // Free slots survive only here when broken sets are disallowed (the
    // allowBrokenSets+partial case already returned null above), and they
    // must be completable → admit every formable set.
    if (slots < ARMOR_SLOTS && !allowBrokenSets) {
      for (const s of formableSets) allowed.add(s);
    }
  }
  return allowed;
}

/** Leaf check for the "no broken sets" mode: every set present in the final
 *  4-armor loadout must contribute a bonus (count ≥ 2), and all four armor
 *  pieces must carry a set (total counted === ARMOR_SLOTS → no null-set filler).
 *  Valid shapes are therefore a single 4pc or two 2pc. Only meaningful at the
 *  boots leaf, where `setCount` holds the complete tally. */
export function allSetsComplete(setCount: Map<string, number>): boolean {
  let total = 0;
  for (const n of setCount.values()) {
    if (n < 2) return false;
    total += n;
  }
  return total === ARMOR_SLOTS;
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
