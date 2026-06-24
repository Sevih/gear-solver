/**
 * Solver worker — runs phases 1→6 of the build search on its own slice of
 * the partitioned cartesian. Spawned via `new SolverWorker()` (Vite's
 * `?worker` import) by the SolverOrchestrator on the main thread.
 *
 * Imports kept React-free so the worker bundle stays light — the engine
 * pulls only `@gear-solver/core` + the pure compose/ratings/CP libs.
 */
import type { SolveRequest, WorkerInput, WorkerOutput } from "../lib/solver/types.js";
import { finalizeBuilds, prepareContext, solveChunk } from "../lib/solver/engine.js";

interface WorkerCtx {
  onmessage: ((e: MessageEvent<WorkerInput>) => void) | null;
  postMessage(data: WorkerOutput): void;
}
const ctx = self as unknown as WorkerCtx;

let cancelled = false;

// MessageChannel-based yield — cheapest macrotask round-trip available in
// a Web Worker. Each `yieldToEvents()` call queues a `postMessage` on
// port2; the worker's event loop drains any pending tasks (notably any
// queued `cancel` from the main thread) before firing port1.onmessage,
// which resolves the pending Promise. Total round-trip is well under 1ms.
//
// Why not setTimeout(0)? Browsers throttle setTimeout to ~4ms minimum in
// workers (and even longer when backgrounded). For 10M permutations / 4096
// ticks = 2440 yields, that's 9.6s of pure throttle — unusable. MessageChannel
// has no throttle, giving ~250ms total overhead for the same.
const yieldChannel = new MessageChannel();
let pendingYieldResolve: (() => void) | null = null;
yieldChannel.port1.onmessage = () => {
  const r = pendingYieldResolve;
  pendingYieldResolve = null;
  r?.();
};
function yieldToEvents(): Promise<void> {
  return new Promise((resolve) => {
    pendingYieldResolve = resolve;
    yieldChannel.port2.postMessage(null);
  });
}

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type === "solve") {
    cancelled = false;
    void runSolve(msg);
  }
};

async function runSolve(req: SolveRequest): Promise<void> {
  try {
    const solveCtx = prepareContext(req);

    // Emit pool sizes immediately so the footer fills in even when the
    // cartesian takes seconds to first tick.
    post({ type: "progress", permutations: 0, searched: 0, poolSizes: solveCtx.poolSizes });

    let lastTick = perfNow();
    const tickIntervalMs = 100;

    const { builds: rawBuilds, permutations, searched } = await solveChunk(
      solveCtx,
      req.chunkIndex,
      req.chunkCount,
      req.topK,
      {
        shouldContinue: () => !cancelled,
        onTick: (p, s) => {
          const now = perfNow();
          if (now - lastTick < tickIntervalMs) return;
          lastTick = now;
          post({ type: "progress", permutations: p, searched: s });
        },
        yieldToEvents,
        tickEvery: 4096,
      },
    );

    // On cancel: still send our partial heap. `finalizeBuilds` is fine to
    // call on partial data — it just fills CP / applies CP filter on what
    // we have. The orchestrator merges into the global top-N, so cancelled
    // workers contribute whatever they got to before bailing instead of
    // being wasted (the previous "return empty on cancel" silently dropped
    // work that had already been done).
    const finalBuilds = finalizeBuilds(solveCtx, rawBuilds, req.mode);
    post({ type: "result", builds: finalBuilds, permutations, searched });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
