// SolverOrchestrator — what reaches the Builder when a solve fails or comes
// back empty: a failed worker drops the other workers' builds (never shown as
// the whole search), and an empty search that "Allow broken sets" off emptied
// is named. The worker pool is a fake; the precompute is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameData, Inventory } from "@gear-solver/core";
import type { SolveBuild, SolveEmptyCause, SolveFilters, WorkerOutput } from "../src/lib/solver/types.js";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerOutput>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: Array<{ type: string; solveId?: number }> = [];
  constructor() { FakeWorker.all.push(this); }
  postMessage(msg: { type: string; solveId?: number }): void { this.sent.push(msg); }
  terminate(): void {}
  /** Solve id of the last `solve` this worker received. */
  get solveId(): number { return this.sent.filter((m) => m.type === "solve").at(-1)!.solveId!; }
  emit(ev: WorkerOutput): void { this.onmessage?.({ data: ev } as MessageEvent<WorkerOutput>); }
}

vi.mock("../src/workers/solver.worker.ts?worker", () => ({ default: FakeWorker }));
vi.mock("../src/lib/solver/engine.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/solver/engine.js")>()),
  precomputeContext: () => ({ poolSizes: { weapon: { hit: 4, of: 4 } }, reforgeTickWeights: null }),
}));

const { SolverOrchestrator } = await import("../src/lib/solver/orchestrator.js");

const FILTERS = {
  options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: false },
  excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 60, mainPicks: {},
  setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
} as SolveFilters;

const build = (uid: string): SolveBuild => ({
  pieceUids: [uid, "t"], gemAllocation: { talisman: [], ee: [] },
  finalStats: { atk: 0, def: 0, hp: 0, spd: 0, critRate: 0, critDmg: 0, eff: 0, effRes: 0, dmgUp: 0, dmgReduce: 0, pen: 0, critDmgReduce: 0 },
  ratings: { hps: 0, ehp: 0, ehps: 0, dmg: 0, dmgs: 0, mcd: 0, mcds: 0, dmgh: 0 },
  score: 1, cp: null, upg: 0,
});

function start() {
  const onResult = vi.fn<(builds: SolveBuild[], ms: number, d: unknown, w: unknown, cause: SolveEmptyCause | null) => void>();
  const onError = vi.fn<(msg: string) => void>();
  const orch = new SolverOrchestrator({ onProgress: () => {}, onResult, onError });
  orch.solve({
    mode: "score", heroUid: "H", game: {} as GameData, inventory: { gear: [], characters: [], presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {},
    userSkills: { first: 1, second: 1, ultimate: 1, chainPassive: 1 }, filters: FILTERS,
  });
  const [w0, w1] = FakeWorker.all;
  return { orch, onResult, onError, w0: w0!, w1: w1! };
}

const result = (w: FakeWorker, builds: SolveBuild[], permutations: number, brokenSetsRejected = 0): WorkerOutput =>
  ({ type: "result", solveId: w.solveId, builds, permutations, searched: builds.length, brokenSetsRejected });

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal("navigator", { hardwareConcurrency: 3 }); // → 2 workers
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());

describe("SolverOrchestrator — a failed worker", () => {
  it("an `error` message: onError, and no partial result from the worker that finished", () => {
    const { onResult, onError, w0, w1 } = start();
    w0.emit(result(w0, [build("a")], 10));
    w1.emit({ type: "error", solveId: w1.solveId, message: "boom" });
    expect(onError).toHaveBeenCalledWith("boom");
    expect(onResult).not.toHaveBeenCalled();
    // Every worker is told to stop, and a late result is stale.
    expect(w0.sent.at(-1)?.type).toBe("cancel");
    w1.emit(result(w1, [build("b")], 10));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("a crash (onerror): same — the error, no partial table", () => {
    const { onResult, onError, w0, w1 } = start();
    w0.emit(result(w0, [build("a")], 10));
    w1.onerror?.({ message: "out of memory" } as ErrorEvent);
    expect(onError).toHaveBeenCalledWith("worker 1: out of memory");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("a user cancel still flushes what finished (that path is unchanged)", () => {
    const { orch, onResult, w0 } = start();
    w0.emit(result(w0, [build("a")], 10));
    orch.cancel();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]![0].map((b) => b.pieceUids[0])).toEqual(["a"]);
    expect(onResult.mock.calls[0]![4]).toBeNull();
  });
});

describe("SolverOrchestrator — empty cause", () => {
  it("no combo reached, armor loadouts rejected by broken sets → \"brokenSets\"", () => {
    const { onResult, w0, w1 } = start();
    w0.emit(result(w0, [], 0, 3));
    w1.emit(result(w1, [], 0, 0));
    expect(onResult.mock.calls[0]![0]).toEqual([]);
    expect(onResult.mock.calls[0]![4]).toBe("brokenSets");
  });

  it("combos were searched (the filters emptied it) → no cause", () => {
    const { onResult, w0, w1 } = start();
    w0.emit(result(w0, [], 5, 3));
    w1.emit(result(w1, [], 0, 0));
    expect(onResult.mock.calls[0]![4]).toBeNull();
  });
});
