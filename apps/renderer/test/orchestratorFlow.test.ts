// SolverOrchestrator — the solve lifecycle as the Builder sees it: one
// `onResult` once every dispatched worker answered, stale output from a
// superseded run dropped by `solveId`, `cancel`, a worker crash, and the
// pre-solve estimate (latest request only, null when the precompute failed).
// The worker pool is a fake driven by the test; the precompute is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameData, Inventory } from "@gear-solver/core";
import type { PoolSizes, SolveBuild, SolveEmptyCause, SolveFilters, WorkerOutput } from "../src/lib/solver/types.js";

type Sent = { type: string; solveId?: number; estimateId?: number; chunkIndex?: number; chunkCount?: number };

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerOutput>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: Sent[] = [];
  constructor() { FakeWorker.all.push(this); }
  postMessage(msg: Sent): void { this.sent.push(msg); }
  terminate(): void {}
  /** Messages of one type, in arrival order. */
  of(type: string): Sent[] { return this.sent.filter((m) => m.type === type); }
  emit(ev: WorkerOutput): void { this.onmessage?.({ data: ev } as MessageEvent<WorkerOutput>); }
}

/** Largest pool the stubbed precompute reports — caps the dispatched chunks. */
const stub = vi.hoisted(() => ({ poolHit: 4 }));

vi.mock("../src/workers/solver.worker.ts?worker", () => ({ default: FakeWorker }));
vi.mock("../src/lib/solver/engine.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/solver/engine.js")>()),
  precomputeContext: () => ({ poolSizes: { weapon: { hit: stub.poolHit, of: stub.poolHit } }, reforgeTickWeights: null }),
}));

const { SolverOrchestrator } = await import("../src/lib/solver/orchestrator.js");
type Orchestrator = InstanceType<typeof SolverOrchestrator>;

const FILTERS = {
  options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 60, mainPicks: {},
  setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
} as SolveFilters;

const GAME = {} as GameData;
const INVENTORY = { gear: [], characters: [], presets: [] } as unknown as Inventory;
const ARGS = {
  mode: "score" as const, heroUid: "H", game: GAME, inventory: INVENTORY,
  userGeasLevels: null, userCodexLevel: null, heroPriority: {},
  userSkills: { first: 1, second: 1, ultimate: 1, chainPassive: 1 }, filters: FILTERS,
};

const build = (uid: string): SolveBuild => ({
  pieceUids: [uid, "t"], gemAllocation: { talisman: [], ee: [] },
  finalStats: { atk: 0, def: 0, hp: 0, spd: 0, critRate: 0, critDmg: 0, eff: 0, effRes: 0, dmgUp: 0, dmgReduce: 0, pen: 0, critDmgReduce: 0 },
  ratings: { hps: 0, ehp: 0, ehps: 0, dmg: 0, dmgs: 0, mcd: 0, mcds: 0, dmgh: 0 },
  score: 1, cp: null, upg: 0,
});

/** A `result` for solve `solveId` (the live one by default: the worker's last `solve`). */
const result = (w: FakeWorker, builds: SolveBuild[], solveId = w.of("solve").at(-1)!.solveId!): WorkerOutput =>
  ({ type: "result", solveId, builds, permutations: builds.length, searched: builds.length, brokenSetsRejected: 0 });

function setup() {
  const onResult = vi.fn<(builds: SolveBuild[], ms: number, d: unknown, w: unknown, cause: SolveEmptyCause | null) => void>();
  const onError = vi.fn<(msg: string) => void>();
  const onProgress = vi.fn<(p: { permutations: number; searched: number; poolSizes?: PoolSizes }) => void>();
  const orch: Orchestrator = new SolverOrchestrator({ onProgress, onResult, onError });
  return { orch, onResult, onError, onProgress };
}

/** Uids of the builds of the n-th `onResult`. */
const uidsOf = (onResult: ReturnType<typeof setup>["onResult"], call = 0) =>
  onResult.mock.calls[call]![0].map((b) => b.pieceUids[0]).sort();

beforeEach(() => {
  FakeWorker.all = [];
  stub.poolHit = 4;
  vi.stubGlobal("navigator", { hardwareConcurrency: 3 }); // → 2 workers
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());

describe("SolverOrchestrator — one result per solve", () => {
  it("every dispatched worker answers → one onResult with the merged builds, nothing after", () => {
    const { orch, onResult, onError } = setup();
    orch.solve(ARGS);
    const [w0, w1] = FakeWorker.all as [FakeWorker, FakeWorker];
    expect(w0.of("solve")[0]).toMatchObject({ chunkIndex: 0, chunkCount: 2 });
    expect(w1.of("solve")[0]).toMatchObject({ chunkIndex: 1, chunkCount: 2 });

    w0.emit(result(w0, [build("a")]));
    expect(onResult).not.toHaveBeenCalled();
    w1.emit(result(w1, [build("b")]));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(uidsOf(onResult)).toEqual(["a", "b"]);

    // A duplicate result once the solve is done reaches nothing.
    w1.emit(result(w1, [build("c")]));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fewer chunks than workers: the flush waits for the dispatched ones only", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 5 }); // → 4 workers
    stub.poolHit = 2; // → 2 chunks
    const { orch, onResult } = setup();
    orch.solve(ARGS);
    const ws = FakeWorker.all;
    expect(ws).toHaveLength(4);
    expect(ws.map((w) => w.of("solve").length)).toEqual([1, 1, 0, 0]);

    ws[0]!.emit(result(ws[0]!, [build("a")]));
    ws[1]!.emit(result(ws[1]!, [build("b")]));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(uidsOf(onResult)).toEqual(["a", "b"]);
  });
});

describe("SolverOrchestrator — a new solve supersedes the running one", () => {
  it("the old run emits nothing: its late results and progress are dropped by solveId", () => {
    const { orch, onResult, onProgress } = setup();
    orch.solve(ARGS);
    const [w0, w1] = FakeWorker.all as [FakeWorker, FakeWorker];
    const oldId = w0.of("solve")[0]!.solveId!;
    w0.emit(result(w0, [build("old-a")]));

    orch.solve(ARGS);
    // The old run is told to stop before the new one is fanned out, and the
    // pool is reused (no second init: same game + inventory).
    expect(w0.sent.map((m) => m.type)).toEqual(["init", "solve", "cancel", "solve"]);
    expect(w1.sent.map((m) => m.type)).toEqual(["init", "solve", "cancel", "solve"]);
    const newId = w0.of("solve")[1]!.solveId!;
    expect(newId).toBeGreaterThan(oldId);

    // Without the solveId gate, this would complete the OLD solve (2/2).
    w1.emit(result(w1, [build("old-b")], oldId));
    w1.emit({ type: "progress", solveId: oldId, permutations: 999, searched: 999 });
    expect(onResult).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([p]) => p.permutations === 999)).toBe(false);

    w0.emit(result(w0, [build("new-a")]));
    w1.emit(result(w1, [build("new-b")]));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(uidsOf(onResult)).toEqual(["new-a", "new-b"]);
  });
});

describe("SolverOrchestrator — cancel", () => {
  it("flushes what finished at once, stops every worker, and drops what arrives later", () => {
    const { orch, onResult } = setup();
    orch.solve(ARGS);
    const [w0, w1] = FakeWorker.all as [FakeWorker, FakeWorker];
    w0.emit(result(w0, [build("a")]));

    orch.cancel();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(uidsOf(onResult)).toEqual(["a"]);
    expect(onResult.mock.calls[0]![4]).toBeNull(); // no empty cause on a cancel
    expect(w0.sent.at(-1)?.type).toBe("cancel");
    expect(w1.sent.at(-1)?.type).toBe("cancel");

    w1.emit(result(w1, [build("b")]));
    orch.cancel(); // idle → no-op
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(w0.of("cancel")).toHaveLength(1);
  });
});

describe("SolverOrchestrator — a worker crash (onerror)", () => {
  it("during a solve: onError, every worker cancelled, nothing after", () => {
    const { orch, onResult, onError } = setup();
    orch.solve(ARGS);
    const [w0, w1] = FakeWorker.all as [FakeWorker, FakeWorker];
    const id = w0.of("solve")[0]!.solveId!;

    w0.onerror?.({ message: "script error" } as ErrorEvent);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("worker 0: script error");
    expect(w0.sent.at(-1)?.type).toBe("cancel");
    expect(w1.sent.at(-1)?.type).toBe("cancel");

    // The live worker's result and a second crash reach nothing.
    w1.emit(result(w1, [build("b")], id));
    w1.onerror?.({ message: "late" } as ErrorEvent);
    orch.cancel();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("when idle (after a finished solve): ignored", () => {
    const { orch, onResult, onError } = setup();
    orch.solve(ARGS);
    const [w0, w1] = FakeWorker.all as [FakeWorker, FakeWorker];
    w0.emit(result(w0, [build("a")]));
    w1.emit(result(w1, [build("b")]));
    w0.onerror?.({ message: "late" } as ErrorEvent);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("SolverOrchestrator — pre-solve estimate", () => {
  const POOLS: PoolSizes = { weapon: { hit: 7, of: 9 } };
  const estimateOf = (w: FakeWorker, i: number) => w.of("estimate")[i]!.estimateId!;

  it("only the latest request is answered: a stale response is dropped", () => {
    const { orch } = setup();
    const cb1 = vi.fn(), cb2 = vi.fn();
    orch.estimate(ARGS, cb1);
    orch.estimate(ARGS, cb2);
    // A dedicated worker, inited once, outside the solve pool.
    expect(FakeWorker.all).toHaveLength(1);
    const ew = FakeWorker.all[0]!;
    expect(ew.sent.map((m) => m.type)).toEqual(["init", "estimate", "estimate"]);

    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 0), poolSizes: { weapon: { hit: 1, of: 1 } } });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 1), poolSizes: POOLS });
    expect(cb2).toHaveBeenCalledWith(POOLS);
    // Delivered once: a repeat of the same response is dropped too.
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 1), poolSizes: POOLS });
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled();
  });

  it("a failed precompute reaches the callback as null", () => {
    const { orch, onError } = setup();
    const cb = vi.fn();
    orch.estimate(ARGS, cb);
    const ew = FakeWorker.all[0]!;
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 0), poolSizes: null });
    expect(cb).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
  });

  it("an estimate worker crash drops the pending request, never an error banner", () => {
    const { orch, onError } = setup();
    const cb = vi.fn();
    orch.estimate(ARGS, cb);
    const ew = FakeWorker.all[0]!;
    ew.onerror?.({ message: "boom" } as ErrorEvent);
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 0), poolSizes: POOLS });
    expect(cb).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    // The next request still goes through.
    const next = vi.fn();
    orch.estimate(ARGS, next);
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 1), poolSizes: POOLS });
    expect(next).toHaveBeenCalledWith(POOLS);
  });

  it("a solve supersedes the pending estimate, and no estimate runs during a solve", () => {
    const { orch } = setup();
    const cb = vi.fn();
    orch.estimate(ARGS, cb);
    const ew = FakeWorker.all[0]!;
    orch.solve(ARGS);
    ew.emit({ type: "estimate", estimateId: estimateOf(ew, 0), poolSizes: POOLS });
    expect(cb).not.toHaveBeenCalled();

    const during = vi.fn();
    orch.estimate(ARGS, during);
    expect(ew.of("estimate")).toHaveLength(1);
    expect(during).not.toHaveBeenCalled();
  });
});
