/**
 * Combination solver — skeleton.
 *
 * Approach (mirrors Fribbels): brute-force the cartesian product of candidate
 * pieces per slot, accumulate stats incrementally, prune early with min/max
 * filters and required sets, keep the top-N by score. Heavy runs belong in a
 * Web Worker (apps/web wires that up). WASM/flattened-array hot loop is a later
 * optimization once the search space proves large.
 */
import type { GearPiece, GearSlot, StatType } from "./types.js";

export interface StatConstraint {
  stat: StatType;
  min?: number;
  max?: number;
}

export interface SolveRequest {
  /** Candidate pieces grouped by slot (already filtered by the caller if desired). */
  candidates: Record<GearSlot, GearPiece[]>;
  /** Hard min/max constraints on the resulting build's totals. */
  constraints: StatConstraint[];
  /** Required set bonuses, e.g. { "Speed": 4, "Critical": 2 }. */
  requiredSets?: Record<string, number>;
  /** Weights for the score function (per stat). */
  weights: Partial<Record<StatType, number>>;
  /** Max results to return. */
  limit?: number;
}

export interface BuildResult {
  pieces: GearPiece[];
  totals: Partial<Record<StatType, number>>;
  score: number;
}

export interface SolveResult {
  builds: BuildResult[];
  /** Combinations actually evaluated (post-prefilter). */
  evaluated: number;
  /** Combinations skipped by pruning. */
  pruned: number;
}

const SLOT_ORDER: GearSlot[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory"];

/**
 * TODO: implement the pruned cartesian search. Signature and shapes are final;
 * the body is a stub that returns an empty result so the package type-checks.
 */
export function solve(_req: SolveRequest): SolveResult {
  void SLOT_ORDER;
  return { builds: [], evaluated: 0, pruned: 0 };
}
