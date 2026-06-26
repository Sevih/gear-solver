/**
 * Solver contract — the message shapes exchanged between the BuilderScreen
 * (main thread) and the worker pool. Pure types, no runtime code.
 */
import type { GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import type { FinalStats } from "../composeBuild.js";
import type { PrecomputedSolveContext, ReforgeMode } from "./engine.js";
import type { CheapRatings } from "./ratings.js";

/** Sort objective for the solver:
 *  - `"score"` (SOLVE)    — Σ priority × normalized stat
 *  - `"cp"`    (SOLVE CP) — in-game CalcBattlePower
 */
export type SolveMode = "score" | "cp";

/** One set requirement inside a plan: the build must equip at least `count`
 *  pieces of `setId`. */
export interface SetCond {
  setId: string;
  count: number;
}

/** A single AND-clause: every cond must hold simultaneously (e.g. a fixed
 *  2pc + a 2pc from a pool → `[{A,2},{B,2}]`). */
export type SetPlan = SetCond[];

/** Effect chip state — same encoding as the Builder's reducer. */
export type EffectConstraint = "required" | "excluded";

/** Snapshot of every Builder filter the worker needs. The orchestrator
 *  serializes the SolverFilters reducer state into this shape (Sets become
 *  arrays for postMessage compatibility). */
export interface SolveFilters {
  options: {
    onlyMaxed: boolean;
    /** Reforge-mode preview: "disable" (gear as captured) | "classic"
     *  (+10 / 6 ticks) | "ascended" (+15 / 9 ticks). Replaces the old
     *  `useReforged` boolean. */
    reforgeMode: ReforgeMode;
    includeEquippedOnOthers: boolean;
    keepCurrent: boolean;
  };
  /** Hero UIDs whose currently-equipped gear is locked out of the pool. */
  excludedHeroes: string[];
  /** Per-final-stat min/max bands (engine stat keys: atk, def, hp, …). */
  statFilters: Record<string, { min?: number; max?: number }>;
  /** Per-rating min/max bands (hps, ehp, ehps, dmg, dmgs, mcd, mcds, dmgh, cp, score, upg). */
  ratingFilters: Record<string, { min?: number; max?: number }>;
  /** Priority weights driving Score + the Top-% per-slot prune. */
  priority: Record<string, number>;
  /** Per-slot pool retention pct after priority scoring (5..100). */
  topPct: number;
  /** Per-slot OR-list of acceptable main stat engine keys. Empty inner = any. */
  mainPicks: Record<string, Record<string, boolean>>;
  /** Set requirements as an OR-list of AND-plans: the build is valid iff AT
   *  LEAST ONE plan is fully satisfied. Empty = no set requirement. The UI /
   *  preset translator expands its authoring shortcuts (4pc-among-N, 2pc+2pc,
   *  fixed-2pc + mix) into this explicit form; the engine stays dumb. */
  setPlans: SetPlan[];
  /** Set ids hard-filtered out of the pool — orthogonal to `setPlans`. */
  excludedSets: string[];
  weaponEffectPicks: Record<string, EffectConstraint>;
  accessoryEffectPicks: Record<string, EffectConstraint>;
  /** Minimum gear quality tier to admit into the pool (rollable-sub slots
   *  only; Talisman / EE have no quality and are always kept). Null = no
   *  quality gate. One of "poor" | "decent" | "good" | "excellent" |
   *  "perfect" — pieces below it are dropped before the cartesian loop. */
  minQuality: string | null;
}

/** Solve request — main thread → worker. Each worker in the pool gets one
 *  of these, differing only in `chunkIndex` (its partition of the first slot). */
export interface SolveRequest {
  type: "solve";
  /** Monotonic id per solve round (assigned by the orchestrator). The worker
   *  echoes it on every output so the orchestrator can drop stale messages
   *  from a superseded run. The worker also uses it internally to detect
   *  that its own coroutine has been replaced by a newer `solve`/`cancel`
   *  and bail out instead of posting. */
  solveId: number;
  mode: SolveMode;
  heroUid: string;
  inventory: Inventory;
  game: GameData;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  /** Captured per-character skill levels. `chainPassive` is the auto-leveled
   *  Skill_5 row (not user-controllable) but it contributes additively to
   *  CP via the `skillSum` term, so feeding 0 would under-report CP for any
   *  character with chainPassive > 0. */
  userSkills: { first: number; second: number; ultimate: number; chainPassive: number };
  filters: SolveFilters;
  /** Top-K builds the worker keeps in its local heap before sending up
   *  to the orchestrator for merge. Larger K = better recall but more bytes. */
  topK: number;
  /** This worker's slice of the partitioned first slot. */
  chunkIndex: number;
  /** Total workers in the pool (== chunkCount). */
  chunkCount: number;
  /** Shared precompute (per-slot filtered pools, baseline, scoredGems, …)
   *  built once by the orchestrator on the main thread and broadcast to
   *  every worker. Absent → worker falls back to running `precomputeContext`
   *  itself (compat for non-orchestrator callers). */
  precomputed?: PrecomputedSolveContext;
}

/** Bumps the worker's generation counter — any in-flight `runSolve` whose
 *  captured generation no longer matches bails out instead of posting. */
export interface CancelMessage {
  type: "cancel";
}

export type WorkerInput = SolveRequest | CancelMessage;

/** One ranked build returned by the solver. UIDs only — main thread looks
 *  up the full piece data from its inventory map for the table + bottom band. */
export interface SolveBuild {
  /** 8 piece UIDs in slot order: weapon, helmet, armor, gloves, boots,
   *  accessory, exclusive, ooparts. Order matches `RESULT_GEAR_SLOTS` minus
   *  the design renaming (engine slot names). */
  pieceUids: string[];
  /** Gem allocation the build was scored with — OptionIDs in slot order
   *  (length up to 5 each), 0 = empty. Surfaced so the UI can show the
   *  user "to reach this build, socket these gems here". */
  gemAllocation: { talisman: number[]; ee: number[] };
  finalStats: FinalStats;
  ratings: CheapRatings;
  /** SOLVE-mode score (Σ priority × normalized stat). */
  score: number;
  /** In-game Combat Power. Computed for the top-N only in SOLVE mode (lazy),
   *  always in SOLVE CP mode (since it's the sort key). Null when skipped. */
  cp: number | null;
  /** Number of slots whose `pieceUid` differs from what's currently equipped
   *  on the target hero — "how many physical swaps to reach this build".
   *  0 = the build IS the current loadout (only the gem reallocation might
   *  differ). Filled in by `finalizeBuilds` on the top-N. */
  upg: number;
}

/** Per-slot pool stats for the footer. Sent once at the start of each solve
 *  (after pre-filter, before the cartesian loop). */
export type PoolSizes = Record<string, { hit: number; of: number }>;

/** Streaming progress — workers send this every ~100ms. Counters are
 *  CUMULATIVE per worker (not deltas) so the orchestrator can drop stale
 *  messages without double-counting. */
export interface SolveProgress {
  type: "progress";
  /** Echoed from the originating `SolveRequest` for stale-message filtering. */
  solveId: number;
  /** Cumulative permutations explored by this worker so far. */
  permutations: number;
  /** Cumulative permutations that survived all filters and got scored. */
  searched: number;
  /** Only set on the first progress message; pool sizes computed in
   *  worker's phase 2 (after per-slot pre-filter). */
  poolSizes?: PoolSizes;
}

/** Final result message — fires once per worker when its chunk completes. */
export interface SolveResult {
  type: "result";
  solveId: number;
  builds: SolveBuild[];
  permutations: number;
  searched: number;
}

export interface SolveError {
  type: "error";
  solveId: number;
  message: string;
}

export type WorkerOutput = SolveProgress | SolveResult | SolveError;
