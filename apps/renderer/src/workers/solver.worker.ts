/**
 * Solver worker — runs phases 1→6 of the build search on its own slice of
 * the partitioned cartesian. Spawned via `new SolverWorker()` (Vite's
 * `?worker` import) by the SolverOrchestrator on the main thread.
 *
 * Imports kept React-free so the worker bundle stays light — the engine
 * pulls only `@gear-solver/core` + the pure compose/ratings/CP libs.
 *
 * GENERATION TRACKING — correctness invariant:
 *
 *   Re-submitting a solve while one is in flight (user clicks SOLVE again,
 *   or toggles SOLVE → SOLVE CP) used to corrupt the orchestrator's buf:
 *   the old `runSolve` coroutine was suspended on `await yieldToEvents()`
 *   and the new request reset a shared `cancelled` flag → old coroutine
 *   would resume and post a stale result tagged to the new run.
 *
 *   Now: every `solve` / `cancel` bumps `currentGen`. Each `runSolve` captures
 *   its own generation at start and bails (without posting) if it ever
 *   sees `currentGen` advance. The yield MessageChannel is created PER-RUN
 *   so the old run's pending resolver is never overwritten by the new run.
 *
 * MessageChannel-based yield — cheapest macrotask round-trip available in
 * a Web Worker. Each `yieldToEvents()` call queues a `postMessage` on
 * port2; the worker's event loop drains any pending tasks (notably any
 * queued `cancel`/`solve` from the main thread) before firing
 * port1.onmessage, which resolves the pending Promise. Total round-trip
 * is well under 1ms. (Why not setTimeout(0)? Workers throttle setTimeout
 * to ~4ms minimum, giving ~9.6s of pure throttle for 10M permutations.)
 */
import type { SolveRequest, WorkerInput, WorkerOutput } from "../lib/solver/types.js";
import { finalizeBuilds, prepareContext, solveChunk } from "../lib/solver/engine.js";

interface WorkerCtx {
  onmessage: ((e: MessageEvent<WorkerInput>) => void) | null;
  postMessage(data: WorkerOutput): void;
}
const ctx = self as unknown as WorkerCtx;

/** Monotonically incremented on every `solve` / `cancel`. Any `runSolve`
 *  whose captured generation no longer matches must bail without posting. */
let currentGen = 0;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    currentGen++;
    return;
  }
  if (msg.type === "solve") {
    currentGen++;
    void runSolve(msg, currentGen);
  }
};

async function runSolve(req: SolveRequest, myGen: number): Promise<void> {
  // Per-run MessageChannel — replaces a previous module-scoped
  // `pendingYieldResolve` that two concurrent runs would clobber, leaving
  // one of them stuck on an unresolved promise (memory leak + the chain
  // race the orchestrator could not recover from).
  const yieldChannel = new MessageChannel();
  let pendingResolve: (() => void) | null = null;
  yieldChannel.port1.onmessage = () => {
    const r = pendingResolve;
    pendingResolve = null;
    r?.();
  };
  const yieldToEvents = (): Promise<void> => new Promise<void>((resolve) => {
    pendingResolve = resolve;
    yieldChannel.port2.postMessage(null);
  });
  const isStale = (): boolean => myGen !== currentGen;

  try {
    const solveCtx = prepareContext(req);
    if (isStale()) return;

    // Pool sizes piggy-back on the first progress message so the footer
    // fills in immediately even when the cartesian takes seconds to first tick.
    post({ type: "progress", solveId: req.solveId, permutations: 0, searched: 0, poolSizes: solveCtx.poolSizes });

    let lastTick = perfNow();
    const tickIntervalMs = 100;

    const { builds: rawBuilds, permutations, searched } = await solveChunk(
      solveCtx,
      req.chunkIndex,
      req.chunkCount,
      req.topK,
      {
        shouldContinue: () => !isStale(),
        onTick: (p, s) => {
          if (isStale()) return;
          const now = perfNow();
          if (now - lastTick < tickIntervalMs) return;
          lastTick = now;
          post({ type: "progress", solveId: req.solveId, permutations: p, searched: s });
        },
        yieldToEvents,
        tickEvery: 4096,
      },
    );

    if (isStale()) return;
    // `finalizeBuilds` is fine to call on partial data — it just fills CP /
    // applies CP filter on what we have. If we got cancelled mid-loop, we
    // still post what survived (the orchestrator will drop it via solveId
    // mismatch if the cancel was a supersede, or merge it as the partial
    // top-N if it was a user cancel between solves).
    const finalBuilds = finalizeBuilds(solveCtx, rawBuilds, req.mode);
    post({ type: "result", solveId: req.solveId, builds: finalBuilds, permutations, searched });
  } catch (err) {
    if (isStale()) return;
    post({ type: "error", solveId: req.solveId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    // Release the channel ports. With no live references the GC would
    // collect them anyway, but `close()` is a defensive signal that any
    // queued port message will be dropped immediately.
    yieldChannel.port1.close();
    yieldChannel.port2.close();
  }
}

function post(ev: WorkerOutput): void {
  ctx.postMessage(ev);
}

/** `performance.now()` — always available in Electron's Chromium worker
 *  scope. The DOM lib's `performance` global isn't visible here (we don't
 *  pull `WebWorker` lib to avoid clashing with `DOM`), so we type-cast
 *  `self` once for access. */
function perfNow(): number {
  return (self as unknown as { performance: { now(): number } }).performance.now();
}

export {};
