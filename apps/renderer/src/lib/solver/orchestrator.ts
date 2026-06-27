/**
 * Solver orchestrator — owns the pool of Web Workers, partitions the
 * first-slot pool across them, fans out the SolveRequest, merges per-worker
 * top-K heaps into the final ranked list, and streams aggregate progress
 * (P / S counters) back to the BuilderScreen.
 *
 * Workers are kept alive between solves (init cost = transferring the
 * inventory + game-data graph isn't trivial). A new solve() supersedes any
 * in-flight one via cancel() first.
 */
import type { GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import SolverWorker from "../../workers/solver.worker.ts?worker";
import { debug, debugEnabled } from "../log.js";
import type { HeroPriority } from "../storage/heroPriority.js";
import { precomputeContext } from "./engine.js";
import type {
  EquippedScope,
  PoolSizes,
  SolveBuild,
  SolveFilters,
  SolveMode,
  SolveRequest,
  SolveRequestMsg,
  WorkerOutput,
} from "./types.js";

/** One-solve diagnostic snapshot — populated only when `gs.debug.solver` is on,
 *  surfaced to the UI via `onResult` so the footer's "Copy Debug Info" button can
 *  copy it as JSON. Splits the wall-clock into `precomputeMs` (main-thread pool
 *  build) vs `searchMs` (worker cartesian) so a slow solve is attributable at a
 *  glance instead of guessed at from a single total. */
export interface SolveDebugInfo {
  hero: string;
  mode: SolveMode;
  /** Top-% slider value — drives the CP combo budget / priority prune. */
  topPct: number;
  /** Whether an explicit per-stat priority was set (gates the prune branch:
   *  Score mode WITHOUT a priority skips the auto-prune → full cartesian). */
  hasPriority: boolean;
  equippedScope: EquippedScope;
  workers: number;
  /** Workers actually dispatched (≤ pool, capped by the partition pool size). */
  chunks: number;
  /** Largest partitionable pool — the parallelism ceiling for this solve. */
  maxPoolHit: number;
  poolSizes: PoolSizes;
  /** Main-thread precompute time (compose + per-slot prune + gem scoring). */
  precomputeMs: number;
  /** Worker cartesian time (fan-out → all workers merged). */
  searchMs: number;
  /** Full wall-clock incl. init broadcast + precompute + search. */
  totalMs: number;
  permutations: number;
  searched: number;
  merged: number;
  returned: number;
  topCp: number | null;
  topScore: number | null;
  /** CP of the currently-equipped build (CP mode only) — compare to topCp. */
  curCp: number | null;
  /** Combo-budget keep-counts per slot (weapon, helmet, armor, gloves, boots,
   *  accessory, ooparts), or null at topPct=100. Proves the budget prune ran and
   *  shows whether each slot was trimmed vs its pre-prune pool. */
  keeps: number[] | null;
  perWorker: Array<{ w: number; perm: number; searched: number }>;
}

/** localStorage key for a manual worker-count override (the future Settings
 *  panel writes here; read once at pool creation). */
const WORKER_COUNT_KEY = "gs.solver.workerCount";

/** Hard ceiling so a pathological override or an absurd core count can't spawn
 *  thousands of workers. */
const WORKER_COUNT_CEILING = 64;

/** Resolve how many solver workers to spawn. Default = `hardwareConcurrency - 1`
 *  (use every logical core but one, kept free for the main thread / UI). A valid
 *  manual override wins (clamped to [1, ceiling]).
 *
 *  `override` lets a React caller pass the live setting value directly (for a
 *  reactive read-out) instead of going through localStorage: pass `undefined`
 *  (default) to read the persisted `gs.solver.workerCount`, a number to force a
 *  manual count, or `null` to force the auto default. The non-React orchestrator
 *  always uses the localStorage path. */
export function resolveWorkerCount(override?: number | null): number {
  const hwc = navigator.hardwareConcurrency || 4;
  const ov = override !== undefined ? override : readWorkerCountOverride();
  if (ov != null && Number.isFinite(ov) && ov >= 1) return Math.min(ov, WORKER_COUNT_CEILING);
  return Math.max(1, Math.min(WORKER_COUNT_CEILING, hwc - 1));
}

/** Read the persisted manual worker-count override, or null when unset/auto. */
function readWorkerCountOverride(): number | null {
  try {
    const raw = localStorage.getItem(WORKER_COUNT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    // localStorage can throw in locked-down contexts — fall back to the default.
    return null;
  }
}

export interface OrchestratorCallbacks {
  onProgress(p: { permutations: number; searched: number; poolSizes?: PoolSizes }): void;
  /** `durationMs` = FULL wall-clock from solve() entry to this flush (whole
   *  milliseconds, incl. precompute), so the footer ⏱ reflects what the user
   *  actually waited — not just the worker search. `debug` is the per-solve
   *  diagnostic snapshot, present only when `gs.debug.solver` is on. */
  onResult(builds: SolveBuild[], durationMs: number, debug?: SolveDebugInfo): void;
  onError(message: string): void;
}

export interface SolveArgs {
  mode: SolveMode;
  heroUid: string;
  inventory: Inventory;
  game: GameData;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  /** Account-global hero priority ranks (for the "≤ lower priority" scope). */
  heroPriority: HeroPriority;
  userSkills: { first: number; second: number; ultimate: number; chainPassive: number };
  filters: SolveFilters;
  /** Per-worker local top-K (orchestrator merges → returns top-N). Default 1000. */
  topK?: number;
  /** Final ranked list size returned to the UI. Default 1000. */
  topN?: number;
}

export class SolverOrchestrator {
  private workers: Worker[] = [];
  private cb: OrchestratorCallbacks;
  /** Per-worker latest cumulative counters. Avoids double-counting when a
   *  progress message and the final result both carry overlapping totals. */
  private stats: Array<{ permutations: number; searched: number }> = [];
  private buf: SolveBuild[] = [];
  private workersDone = 0;
  /** Number of workers actually dispatched this solve. Can be < the pool size
   *  when the partitioned pool has fewer items than workers — posting to more
   *  workers than there are items just hands the surplus empty slices. The
   *  flush gate compares against THIS, not `workers.length`, or it would wait
   *  forever for results from workers that were never sent a chunk. */
  private activeChunks = 0;
  private active = false;
  private mode: SolveMode = "score";
  private topN = 1000;
  /** Pool sizes — captured from the first worker's first progress event
   *  (every worker computes the same per-slot pre-filter result). */
  private poolSizes: PoolSizes | undefined;
  /** Monotonically incremented per `solve()`. Echoed by workers on every
   *  output; messages tagged with a stale solveId are dropped. Without this,
   *  a stale `result` from a superseded run would slip into the new `buf`
   *  and trip `flush()` prematurely with mixed builds + half-zero stats. */
  private solveId = 0;
  /** Identity of the game / inventory currently cached in the worker pool via
   *  `init`. When a solve arrives with a different reference (first solve, or a
   *  re-capture swapped the inventory), we re-broadcast `init` before fanning
   *  out — otherwise the big constant graphs would ride along every solve. */
  private initedGame: GameData | null = null;
  private initedInventory: Inventory | null = null;
  /** Wall-clock (performance.now) at solve() entry — paired with flush() so the
   *  footer ⏱ shows the FULL solve time (incl. precompute), not just search. */
  private startedAt = 0;
  /** Wall-clock at fan-out (post-precompute) — flush() subtracts it for the
   *  worker-only `searchMs` split in the debug snapshot. */
  private fanoutAt = 0;
  /** Per-solve diagnostic, built across solve()/flush(); null unless debug on. */
  private debugInfo: SolveDebugInfo | null = null;

  constructor(cb: OrchestratorCallbacks) {
    this.cb = cb;
  }

  /** Lazily spin up the pool. Sized by `resolveWorkerCount()` — defaults to
   *  (hardwareConcurrency - 1) so the search uses every core but one (left for
   *  the main thread / UI), overridable via `gs.solver.workerCount`. The old
   *  hard cap of 8 left high-core machines mostly idle (8 workers / 32 threads
   *  = 25% CPU); the per-solve postMessage/clone overhead is amortized over a
   *  multi-second solve, so scaling with the machine is the right default. */
  private ensurePool(): void {
    if (this.workers.length > 0) return;
    // Fresh workers hold no cached data — force an `init` re-broadcast on the
    // upcoming solve (the identity check below would otherwise skip it if the
    // game/inventory refs happen to match a previous pool's).
    this.initedGame = null;
    this.initedInventory = null;
    const n = resolveWorkerCount();
    debug("solver", "pool", { workers: n, hardwareConcurrency: navigator.hardwareConcurrency });
    for (let i = 0; i < n; i++) {
      const w = new SolverWorker();
      const idx = i;
      w.onmessage = (e: MessageEvent<WorkerOutput>) => this.handle(idx, e.data);
      w.onerror = (e: ErrorEvent) => this.cb.onError(`worker ${idx}: ${e.message}`);
      this.workers.push(w);
    }
  }

  /** Kick off a new solve. Supersedes any in-flight run by bumping the
   *  `solveId` — any output still in flight from the previous run will fail
   *  the id check in `handle()` and be dropped. */
  solve(args: SolveArgs): void {
    if (this.active) this.cancelInternal();
    this.ensurePool();
    // One-shot `init`: ship the constant game + inventory to every worker only
    // when they changed (first solve, or a re-capture swapped the inventory).
    // After this, each solve's fan-out carries only the lean per-solve payload
    // (filters + precompute), not the heavy graphs — the big win for high
    // worker counts where N clones of `game` would otherwise dominate fan-out.
    if (this.initedGame !== args.game || this.initedInventory !== args.inventory) {
      for (const w of this.workers) {
        w.postMessage({ type: "init", game: args.game, inventory: args.inventory });
      }
      this.initedGame = args.game;
      this.initedInventory = args.inventory;
    }
    this.solveId++;
    this.active = true;
    // Start the clock at entry so ⏱ counts precompute too (the main-thread pool
    // build can be a real chunk of the wait on a big inventory).
    this.startedAt = performance.now();
    this.mode = args.mode;
    this.topN = args.topN ?? 1000;
    this.buf = [];
    this.workersDone = 0;
    this.poolSizes = undefined;
    this.stats = this.workers.map(() => ({ permutations: 0, searched: 0 }));
    const topK = args.topK ?? 1000;
    // Build the precompute ONCE on the main thread — broadcast to every
    // worker via `precomputed`. Without this, each worker repeats the same
    // composeCharStats + per-slot filter + simulateReforges + combo-budget prune +
    // buildGemPool work (8× CPU on a 7-worker pool). The orchestrator pays
    // one structured-clone cost when postMessage'ing the bundle to each
    // worker; the engine work skipped is much heavier than the clone.
    //
    // `leanSeed` is the per-solve wire payload sans the constant game +
    // inventory (cached worker-side via `init`) and sans the chunk fields
    // (filled per-worker in the fan-out). The main-thread `precomputeContext`
    // still needs the full request, so we splice game/inventory back in just
    // for that call — `chunkCount` there is a placeholder it ignores.
    const leanSeed: Omit<SolveRequestMsg, "chunkIndex" | "chunkCount" | "precomputed"> = {
      type: "solve",
      solveId: this.solveId,
      mode: args.mode,
      heroUid: args.heroUid,
      userGeasLevels: args.userGeasLevels,
      userCodexLevel: args.userCodexLevel,
      heroPriority: args.heroPriority,
      userSkills: args.userSkills,
      filters: args.filters,
      topK,
    };
    let precomputed;
    const preStart = performance.now();
    try {
      const seedReq: SolveRequest = {
        ...leanSeed,
        game: args.game,
        inventory: args.inventory,
        chunkIndex: 0,
        chunkCount: this.workers.length,
      };
      precomputed = precomputeContext(seedReq);
    } catch (err) {
      this.active = false;
      this.cb.onError(err instanceof Error ? err.message : String(err));
      return;
    }
    const precomputeMs = Math.round(performance.now() - preStart);
    // Surface pool sizes to the UI immediately — no need to wait for the
    // first worker progress event (saves the perceptible "blank footer"
    // window at solve start).
    this.poolSizes = precomputed.poolSizes;
    this.cb.onProgress({ permutations: 0, searched: 0, poolSizes: this.poolSizes });
    // Cap the worker count to the partitioned pool size. `solveChunk` splits
    // the largest pool (pickPartitionSlot), so a pool of N items can keep at
    // most N workers busy — any extra worker gets an empty slice and burns a
    // postMessage + precompute clone for zero work. The largest pool size is
    // the max hit across the partitionable slots (EE is never partitioned).
    const ps = precomputed.poolSizes;
    const maxPoolHit = Math.max(
      ps.weapon?.hit ?? 0, ps.helmet?.hit ?? 0, ps.armor?.hit ?? 0,
      ps.gloves?.hit ?? 0, ps.boots?.hit ?? 0, ps.accessory?.hit ?? 0,
      ps.talisman?.hit ?? 0, // engine keys the ooparts pool as "talisman"
    );
    const chunkCount = Math.max(1, Math.min(this.workers.length, maxPoolHit));
    this.activeChunks = chunkCount;
    this.fanoutAt = performance.now();
    // Seed the per-solve diagnostic with the fan-out-time facts (the rest is
    // filled in flush()). Only built when debug is on so a normal solve pays
    // nothing. `hasPriority` mirrors the engine's prune gate so the snapshot
    // makes the "Score + no priority = full cartesian" case obvious.
    this.debugInfo = debugEnabled("solver")
      ? {
          hero: args.heroUid, mode: args.mode,
          topPct: args.filters.topPct,
          hasPriority: Object.values(args.filters.priority).some((v) => v !== 0),
          equippedScope: args.filters.options.equippedScope ?? "all",
          workers: this.workers.length, chunks: chunkCount, maxPoolHit,
          poolSizes: this.poolSizes, precomputeMs,
          curCp: precomputed.debugCurCp ?? null,
          keeps: precomputed.debugKeeps ?? null,
          searchMs: 0, totalMs: 0, permutations: 0, searched: 0,
          merged: 0, returned: 0, topCp: null, topScore: null, perWorker: [],
        }
      : null;
    debug("solver", "fan-out", {
      hero: args.heroUid, mode: args.mode, solveId: this.solveId,
      pool: this.workers.length, chunks: chunkCount, maxPoolHit,
      topK, topN: this.topN, precomputeMs, poolSizes: this.poolSizes,
    });
    for (let i = 0; i < chunkCount; i++) {
      const w = this.workers[i];
      if (!w) continue;
      const msg: SolveRequestMsg = { ...leanSeed, chunkIndex: i, chunkCount, precomputed };
      w.postMessage(msg);
    }
  }

  /** User-initiated cancel — release the UI immediately and bail every
   *  worker. The earlier design relied on workers posting their partial
   *  top-K back via the standard `result` message, but with generation
   *  tracking a cancelled worker bails WITHOUT posting (its `result` would
   *  carry a now-stale solveId anyway) — so `workersDone` never reached
   *  `workers.length` and `flush()` never fired. The UI stayed in the
   *  "Solving…" state forever, with SOLVE buttons disabled.
   *
   *  Fix: tell the workers to bail (free their CPU), bump `solveId` to
   *  drop any in-flight output from the cancelled run, then immediately
   *  flush whatever finished workers already merged into `this.buf`
   *  (typically empty — most cancels happen mid-loop — but non-empty if a
   *  fast worker finished while a slow one was still searching). */
  cancel(): void {
    if (!this.active) return;
    for (const w of this.workers) w.postMessage({ type: "cancel" });
    this.solveId++; // any future output from these workers is now stale
    this.flush();
  }

  /** Hard supersede (new solve clobbers an in-flight one). Drops the buf
   *  and stats so the next solve starts clean even if the cancelled
   *  workers' result messages arrive after we re-`solve()`. */
  private cancelInternal(): void {
    for (const w of this.workers) w.postMessage({ type: "cancel" });
    this.active = false;
  }

  /** Tear down all workers — called when the BuilderScreen unmounts. */
  dispose(): void {
    this.cancelInternal();
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  private handle(workerIdx: number, ev: WorkerOutput): void {
    // Drop stale outputs from a superseded run. Without this, an old
    // `result` arriving after we've kicked off a new solve would corrupt
    // the new buf (mixed builds, partial workersDone, premature flush).
    if (!this.active || ev.solveId !== this.solveId) return;
    if (ev.type === "progress") {
      this.stats[workerIdx] = { permutations: ev.permutations, searched: ev.searched };
      if (ev.poolSizes && !this.poolSizes) this.poolSizes = ev.poolSizes;
      this.cb.onProgress({
        permutations: this.totalPerm(),
        searched: this.totalSearched(),
        poolSizes: this.poolSizes,
      });
    } else if (ev.type === "result") {
      this.stats[workerIdx] = { permutations: ev.permutations, searched: ev.searched };
      this.buf.push(...ev.builds);
      this.workersDone++;
      if (this.workersDone === this.activeChunks) this.flush();
    } else if (ev.type === "error") {
      this.cb.onError(ev.message);
      this.cancel();
    }
  }

  private totalPerm(): number {
    let n = 0;
    for (const s of this.stats) n += s.permutations;
    return n;
  }

  private totalSearched(): number {
    let n = 0;
    for (const s of this.stats) n += s.searched;
    return n;
  }

  /** Sort the merged buf by the active mode's key and surface top-N. */
  private flush(): void {
    const cmp = this.mode === "cp"
      ? (a: SolveBuild, b: SolveBuild) => (b.cp ?? 0) - (a.cp ?? 0)
      : (a: SolveBuild, b: SolveBuild) => b.score - a.score;
    this.buf.sort(cmp);
    const merged = this.buf.length;
    const out = this.buf.slice(0, this.topN);
    const now = performance.now();
    const totalMs = Math.round(now - this.startedAt);
    if (this.debugInfo) {
      this.debugInfo.searchMs = Math.round(now - this.fanoutAt);
      this.debugInfo.totalMs = totalMs;
      this.debugInfo.permutations = this.totalPerm();
      this.debugInfo.searched = this.totalSearched();
      this.debugInfo.merged = merged;
      this.debugInfo.returned = out.length;
      this.debugInfo.topCp = this.mode === "cp" ? (out[0]?.cp ?? null) : null;
      this.debugInfo.topScore = this.mode === "score" ? (out[0]?.score ?? null) : null;
      this.debugInfo.perWorker = this.stats.map((s, i) => ({ w: i, perm: s.permutations, searched: s.searched }));
      debug("solver", "done", this.debugInfo);
    }
    this.cb.onResult(out, totalMs, this.debugInfo ?? undefined);
    this.active = false;
  }
}
