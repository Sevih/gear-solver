/**
 * The outerpedia reco as the Builder's default priority — what SOLVE does when
 * the hero has no substat weight: in Score mode it takes the weights of the
 * hero's reco (first build only, nothing else of it), and without a usable
 * reco it solves by Combat Power for that run instead of ranking at random.
 *
 * Pure: the screen fetches the reco (`fetchRecoForHero`) and dispatches.
 */
import type { SolveMode } from "../solver/types.js";
import { effectivePriority, type Priority } from "../heroPriority/weights.js";
import { translateRecoBuild, type StructuredCharacterReco } from "./translateReco.js";

/** The priority of the reco's first build (the one Load reco applies when the
 *  reco has a single build), or null without a reco, without a build, or when
 *  that build carries no weight. Only `SubstatPrio` is read: the effect keys
 *  aren't resolved (no game data needed). */
export function recoPriorityOf(reco: StructuredCharacterReco | null | undefined): Priority | null {
  const first = reco ? Object.values(reco.builds ?? {})[0] : undefined;
  if (!first) return null;
  return effectivePriority(translateRecoBuild(first, () => null).patch.priority);
}

/** What SOLVE runs:
 *  - `"cp"` — CP mode, picked by the user;
 *  - `"score"` — Score mode with the hero's own priority;
 *  - `"score-with-reco"` — Score mode without a priority: the reco's weights
 *    are set as the hero's priority, then Score runs with them;
 *  - `"cp-fallback"` — Score mode, no priority and no reco weights: this run
 *    goes by Combat Power (the chosen mode doesn't change). */
export type SolveDecision = "cp" | "score" | "score-with-reco" | "cp-fallback";

export function solveDecision({ mode, hasPriority, recoPriority }: {
  mode: SolveMode;
  hasPriority: boolean;
  /** The reco's weights (`recoPriorityOf`), null when there are none. */
  recoPriority: Priority | null;
}): SolveDecision {
  if (mode === "cp") return "cp";
  if (hasPriority) return "score";
  return recoPriority ? "score-with-reco" : "cp-fallback";
}

/** Same weights, a missing stat counting as 0 — whether the hero's priority is
 *  still the one taken from the reco. */
export function samePriority(a: Priority, b: Priority): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}
