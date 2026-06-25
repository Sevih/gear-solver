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
import { precomputeContext } from "./engine.js";
import type {
  PoolSizes,
  SolveBuild,
  SolveFilters,
  SolveMode,
  SolveRequest,
  WorkerOutput,
} from "./types.js";

export interface OrchestratorCallbacks {
  onProgress(p: { permutations: number; searched: number; poolSizes?: PoolSizes }): void;
  onResult(builds: SolveBuild[]): void;
  onError(message: string): void;
}

export interface SolveArgs {
  mode: SolveMode;
  heroUid: string;
  inventory: Inventory;
  game: GameData;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
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

  constructor(cb: OrchestratorCallbacks) {
    this.cb = cb;
  }

  /** Lazily spin up the pool. Sized to (hardwareConcurrency - 1) clamped
   *  to [1, 8] — past 8 workers the partition overhead and bytes pushed
   *  through postMessage outweigh the parallel speedup for typical solves. */
  private ensurePool(): void {
    if (this.workers.length > 0) return;
    const n = Math.max(1, Math.min(8, navigator.hardwareConcurrency - 1));
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
    this.solveId++;
    this.active = true;
    this.mode = args.mode;
    this.topN = args.topN ?? 1000;
    this.buf = [];
    this.workersDone = 0;
    this.poolSizes = undefined;
    this.stats = this.workers.map(() => ({ permutations: 0, searched: 0 }));
    const topK = args.topK ?? 1000;
    const chunkCount = this.workers.length;
    // Build the precompute ONCE on the main thread — broadcast to every
    // worker via `precomputed`. Without this, each worker repeats the same
    // composeCharStats + per-slot filter + simulateReforges + topPctPrune +
    // buildGemPool work (8× CPU on a 7-worker pool). The orchestrator pays
    // one structured-clone cost when postMessage'ing the bundle to each
    // worker; the engine work skipped is much heavier than the clone.
    //
    // `seedReq` mirrors the per-worker SolveRequest except for chunk fields
    // (precomputeContext ignores those — they only matter inside solveChunk).
    const seedReq: SolveRequest = {
      type: "solve",
      solveId: this.solveId,
      mode: args.mode,
      heroUid: args.heroUid,
      inventory: args.inventory,
      game: args.game,
      userGeasLevels: args.userGeasLevels,
      userCodexLevel: args.userCodexLevel,
      userSkills: args.userSkills,
      filters: args.filters,
      topK,
      chunkIndex: 0,
      chunkCount,
    };
    let precomputed;
    try {
      precomputed = precomputeContext(seedReq);
    } catch (err) {
      this.active = false;
      this.cb.onError(err instanceof Error ? err.message : String(err));
      return;
    }
    // Surface pool sizes to the UI immediately — no need to wait for the
    // first worker progress event (saves the perceptible "blank footer"
    // window at solve start).
    this.poolSizes = precomputed.poolSizes;
    this.cb.onProgress({ permutations: 0, searched: 0, poolSizes: this.poolSizes });
    for (let i = 0; i < chunkCount; i++) {
      const w = this.workers[i];
      if (!w) continue;
      const req: SolveRequest = { ...seedReq, chunkIndex: i, precomputed };
      w.postMessage(req);
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
      if (this.workersDone === this.workers.length) this.flush();
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
    this.cb.onResult(this.buf.slice(0, this.topN));
    this.active = false;
  }
}
