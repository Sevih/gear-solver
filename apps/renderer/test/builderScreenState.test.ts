// Builder state around the results (screens/builder/BuilderScreen.tsx +
// useSolverSession.ts): the selection kept by reference across the client
// Filter and its ✕, a saved build restored during a solve, and the solve
// started after the reco fetch reading the filters of that moment. Vitest runs
// in the `node` environment (no DOM), so `react` is mocked with a minimal hooks
// runtime (state / reducer / memo / ref / effect slots, layout effects before
// passive ones, like a React commit); the screen is called as a plain function
// and only the props it hands to its panels are read. The orchestrator is a
// fake that records each solve and replays the real cancel contract (flush
// now, drop later output).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import type { SolveBuild } from "../src/lib/solver/types.js";
import type { SavedBuild } from "../src/lib/storage/savedBuilds.js";

const runtime = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[]; set?: (next: unknown) => void };
  const instances = new Map<string, Slot[]>();
  let slots: Slot[] = [];
  let cursor = 0;
  let layout: Array<() => void> = [];
  let passive: Array<() => void> = [];
  let dirty = false;
  const changed = (prev: unknown[] | undefined, next: unknown[] | undefined) =>
    !prev || !next || prev.length !== next.length || prev.some((v, i) => !Object.is(v, next[i]));
  const slot = (): Slot => (slots[cursor++] ??= {});
  const effect = (queue: () => Array<() => void>) => (fn: () => void, deps?: unknown[]) => {
    const s = slot();
    if (changed(s.deps, deps)) { s.deps = deps; queue().push(fn); }
  };
  const stateSlot = (initial: () => unknown, reduce: (prev: unknown, action: unknown) => unknown) => {
    const s = slot();
    if (!s.set) {
      s.value = initial();
      s.set = (action) => {
        const v = reduce(s.value, action);
        if (!Object.is(v, s.value)) { s.value = v; dirty = true; }
      };
    }
    return [s.value, s.set];
  };
  return {
    reset() { instances.clear(); },
    /** Render, run the layout then the passive effects, re-render while state
     *  changed. */
    render<T>(component: () => T, key = "screen"): T {
      if (!instances.has(key)) instances.set(key, []);
      for (let pass = 0; pass < 20; pass++) {
        slots = instances.get(key)!;
        cursor = 0;
        layout = [];
        passive = [];
        dirty = false;
        const out = component();
        for (const fn of layout) fn();
        for (const fn of passive) fn();
        if (!dirty) return out;
      }
      throw new Error("render loop");
    },
    hooks: {
      useState(initial: unknown) {
        return stateSlot(
          () => (typeof initial === "function" ? (initial as () => unknown)() : initial),
          (prev, next) => (typeof next === "function" ? (next as (p: unknown) => unknown)(prev) : next),
        );
      },
      useReducer(reducer: (s: unknown, a: unknown) => unknown, arg: unknown, init?: (a: unknown) => unknown) {
        return stateSlot(() => (init ? init(arg) : arg), reducer);
      },
      useMemo(factory: () => unknown, deps?: unknown[]) {
        const s = slot();
        if (changed(s.deps, deps)) { s.value = factory(); s.deps = deps; }
        return s.value;
      },
      useCallback(fn: unknown, deps?: unknown[]) {
        const s = slot();
        if (changed(s.deps, deps)) { s.value = fn; s.deps = deps; }
        return s.value;
      },
      useRef(initial: unknown) {
        const s = slot();
        s.value ??= { current: initial };
        return s.value;
      },
      useEffect: effect(() => passive),
      useLayoutEffect: effect(() => layout),
    },
  };
});

/** The fake orchestrator of the screen — each `solve` recorded; `cancel` and
 *  `finish` follow the real contract: a cancel flushes what finished (nothing
 *  here) through `onResult` at once, and output of a cancelled or superseded
 *  run never reaches `onResult`. */
const orch = vi.hoisted(() => {
  type Cb = { onResult: (builds: unknown[], ms: number, debug?: unknown, tick?: unknown, cause?: unknown) => void };
  const state = { cb: null as Cb | null, active: false, solves: [] as Array<Record<string, unknown>> };
  class FakeOrchestrator {
    constructor(cb: Cb) { state.cb = cb; }
    solve(args: Record<string, unknown>) { state.solves.push(args); state.active = true; }
    cancel() { if (!state.active) return; state.active = false; state.cb!.onResult([], 5, undefined, null, null); }
    estimate() {}
    dispose() {}
  }
  return {
    state,
    FakeOrchestrator,
    /** The running solve completes with `builds` (dropped when none runs). */
    finish(builds: unknown[]) { if (!state.active) return; state.active = false; state.cb!.onResult(builds, 10, undefined, null, null); },
    reset() { state.cb = null; state.active = false; state.solves = []; },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...runtime.hooks }));
vi.mock("../src/lib/solver/orchestrator.js", () => ({ SolverOrchestrator: orch.FakeOrchestrator, resolveWorkerCount: () => 1 }));

const { BuilderScreen } = await import("../src/screens/builder/BuilderScreen.js");
const { BuilderToolbar } = await import("../src/screens/builder/BuilderToolbar.js");
const { ResultsTable } = await import("../src/screens/builder/ResultsTable.js");
const { BottomGearBand } = await import("../src/screens/builder/BottomGearBand.js");
const { RightSidebar } = await import("../src/screens/builder/RightSidebar.js");

const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => void m.set(k, String(v)),
  removeItem: (k: string) => void m.delete(k),
  clear: () => m.clear(),
  key: () => null,
  get length() { return m.size; },
}) as Storage;
const local = new Map<string, string>();
beforeEach(() => {
  runtime.reset();
  orch.reset();
  local.clear();
  (globalThis as { localStorage?: Storage }).localStorage = stub(local);
});
afterEach(() => { vi.unstubAllGlobals(); });

const hero = {
  uid: "h1", charId: 1, fusionCharId: 0, name: "Hero", stars: 5, exp: 0, levelMaxStep: 0, fusionLevel: 0,
  skills: { first: 1, second: 1, ultimate: 1, chainPassive: 1 },
} as unknown as Character;
const inventory = { gear: [], characters: [hero], presets: [] } as unknown as Inventory;
const game = { characters: {}, equipment: {}, sets: {} } as unknown as GameData;

/** A result whose ATK is `atk` (the band the client Filter reads). */
const build = (atk: number): SolveBuild => ({
  pieceUids: [], gemAllocation: { talisman: [], ee: [] },
  finalStats: { atk } as unknown as SolveBuild["finalStats"], ratings: {} as SolveBuild["ratings"],
  score: atk, cp: atk, upg: 0,
});

/** Every element of the tree, depth first. */
function* walk(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as ReactElement<{ children?: unknown }>;
  yield el;
  yield* walk(el.props.children);
}
const find = <P>(tree: unknown, type: unknown) => {
  for (const el of walk(tree)) if (el.type === type) return el.props as P;
  throw new Error("element not found");
};
type ToolbarProps = Parameters<typeof BuilderToolbar>[0];
type TableProps = Parameters<typeof ResultsTable>[0];
type BandProps = Parameters<typeof BottomGearBand>[0];
type SidebarProps = Parameters<typeof RightSidebar>[0];

const screen = () => BuilderScreen({
  inventory, game, userGeasLevels: null, userCodexLevel: null, heroPriority: {}, heroFilters: {},
  onHeroFiltersChange: () => {}, initialHeroUid: "h1",
});
const render = () => runtime.render(screen);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Builder — selection kept by reference across the client Filter", () => {
  // 20 results, ATK 2000 down to 1050: ATK ≤ 1450 keeps #12..#20.
  const results = Array.from({ length: 20 }, (_, i) => build(2000 - 50 * i));

  function filtered() {
    let tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    orch.finish(results);
    tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setStatFilter", stat: "atk", bound: "max", value: 1450 });
    tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onFilter();
    return render();
  }

  it("the 3rd filtered row stays selected once ✕ brings every result back", () => {
    let tree = filtered();
    let table = find<TableProps>(tree, ResultsTable);
    expect(table.builds).toHaveLength(9);
    table.onSelect(2);
    tree = render();
    const picked = results[13]!;
    expect(find<TableProps>(tree, ResultsTable).selectedIdx).toBe(2);
    expect(find<BandProps>(tree, BottomGearBand).build).toBe(picked);
    find<ToolbarProps>(tree, BuilderToolbar).onClearFilter();
    tree = render();
    table = find<TableProps>(tree, ResultsTable);
    expect(table.builds).toBe(results);
    expect(table.selectedIdx).toBe(13);
    expect(find<BandProps>(tree, BottomGearBand).build).toBe(picked);
  });

  it("the Compare pin keeps its build too", () => {
    let tree = filtered();
    find<TableProps>(tree, ResultsTable).onTogglePin!(1);
    tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onClearFilter();
    tree = render();
    expect(find<TableProps>(tree, ResultsTable).pinned).toBe(results[12]);
  });

  it("Filter re-anchors the selection on the top filtered row", () => {
    const tree = filtered();
    expect(find<TableProps>(tree, ResultsTable).selectedIdx).toBe(0);
    expect(find<BandProps>(tree, BottomGearBand).build).toBe(results[11]);
  });
});

describe("Builder — Restore during a solve", () => {
  it("cancels the solve: the restored build stays, selected, and the late results are dropped", () => {
    const saved: SavedBuild = {
      id: "s1", name: "Kept", heroUid: "h1", mode: "score", build: build(1234),
      reforge: { reforgeMode: "disable", priority: { atk: 1 } }, createdAt: 0,
    };
    let tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    tree = render();
    expect(find<TableProps>(tree, ResultsTable).solving).toBe(true);
    find<SidebarProps>(tree, RightSidebar).onRestoreBuild(saved);
    tree = render();
    expect(find<TableProps>(tree, ResultsTable).builds).toEqual([saved.build]);
    orch.finish([build(9999), build(9000)]);
    tree = render();
    const table = find<TableProps>(tree, ResultsTable);
    expect(table.solving).toBe(false);
    expect(table.builds).toEqual([saved.build]);
    expect(table.selectedIdx).toBe(0);
    expect(table.reforge.priority).toEqual({ atk: 1 });
    expect(find<BandProps>(tree, BottomGearBand).build).toBe(saved.build);
  });
});

describe("Builder — SOLVE after the reco fetch reads the filters of that moment", () => {
  /** SOLVE in Score without a priority: the reco is fetched first; the fetch
   *  answers `status` only when `release` is called. */
  function solveWithPendingReco(status: number, body: unknown = {}) {
    let release!: () => void;
    const answered = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await answered;
      return { status, ok: status === 200, json: async () => body } as Response;
    }));
    const tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("score");
    return { tree: render(), release };
  }

  it("no reco (CP fallback): a band set during the fetch is in the solve", async () => {
    const { tree, release } = solveWithPendingReco(404);
    expect(orch.state.solves).toHaveLength(0);
    find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setStatFilter", stat: "atk", bound: "min", value: 1500 });
    render();
    release();
    await flush();
    expect(orch.state.solves).toHaveLength(1);
    const req = orch.state.solves[0]!;
    expect(req.mode).toBe("cp");
    expect((req.filters as { statFilters: Record<string, unknown> }).statFilters).toEqual({ atk: { min: 1500 } });
  });

  it("a priority set by hand during the fetch: Score solves with it", async () => {
    const { tree, release } = solveWithPendingReco(404);
    find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setPriority", stat: "atk", value: 3 });
    render();
    release();
    await flush();
    expect(orch.state.solves).toHaveLength(1);
    const req = orch.state.solves[0]!;
    expect(req.mode).toBe("score");
    expect((req.filters as { priority: Record<string, number> }).priority.atk).toBe(3);
  });
});

describe("Builder — a cell's Min ≥ / Max ≤ re-solves once per gesture", () => {
  const rowUids = ["weapon3", "helmet1", "armor0", "gloves2", "boots4", "accessory1", "ooparts2"];
  const results = [build(2000), { ...build(1800), pieceUids: rowUids }, build(1600)];
  type Req = { mode: string; pinPieceUids?: string[]; filters: { statFilters: Record<string, unknown>; ratingFilters: Record<string, unknown> } };
  const solves = () => orch.state.solves as unknown as Req[];

  function solvedOnce(mode: "score" | "cp") {
    let tree = render();
    // SOLVE in Score with a priority (without one, it fetches the reco first).
    if (mode === "score") {
      find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setPriority", stat: "atk", value: 1 });
      tree = render();
    }
    find<ToolbarProps>(tree, BuilderToolbar).onSolve(mode);
    orch.finish(results);
    tree = render();
    expect(solves()).toHaveLength(1);
    return tree;
  }

  it("in the last solve's mode, with the band and the row's pieces pinned (that solve only)", () => {
    let tree = solvedOnce("cp");
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "min", 1800, rowUids);
    render();
    expect(solves()).toHaveLength(2);
    expect(solves()[1]!.mode).toBe("cp");
    expect(solves()[1]!.filters.statFilters).toEqual({ atk: { min: 1800 } });
    expect(solves()[1]!.pinPieceUids).toEqual(rowUids);
    // A rating / CP bound goes through the same path.
    orch.finish(results);
    tree = render();
    find<TableProps>(tree, ResultsTable).onThreshold!("rating", "cp", "max", 1800, rowUids);
    render();
    expect(solves()).toHaveLength(3);
    expect(solves()[2]!.filters.ratingFilters).toEqual({ cp: { max: 1800 } });
    expect(solves()[2]!.filters.statFilters).toEqual({ atk: { min: 1800 } });
  });

  it("the same bound twice re-solves twice; a later filter edit or SOLVE starts no extra solve and pins nothing", () => {
    let tree = solvedOnce("score");
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "max", 1800, rowUids);
    render();
    orch.finish(results);
    tree = render();
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "max", 1800, rowUids);
    render();
    expect(solves()).toHaveLength(3);
    expect(solves().map((s) => s.mode)).toEqual(["score", "score", "score"]);
    orch.finish(results);
    tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setStatFilter", stat: "spd", bound: "min", value: 120 });
    tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).dispatch({ type: "setTopPct", value: 40 });
    tree = render();
    expect(solves()).toHaveLength(3);
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    render();
    expect(solves()).toHaveLength(4);
    expect(solves()[3]!.pinPieceUids).toBeUndefined();
  });

  it("before any solve: SOLVE (Score)", () => {
    const tree = render();
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "min", 1800, rowUids);
    render();
    expect(solves()).toHaveLength(1);
    expect(solves()[0]!.mode).toBe("score");
  });

  it("a gesture during a solve supersedes it with one solve", () => {
    let tree = solvedOnce("cp");
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "min", 1700, rowUids);
    tree = render();
    expect(find<TableProps>(tree, ResultsTable).solving).toBe(true);
    find<TableProps>(tree, ResultsTable).onThreshold!("stat", "atk", "min", 1800, rowUids);
    render();
    expect(solves()).toHaveLength(3);
    expect(solves()[2]!.filters.statFilters).toEqual({ atk: { min: 1800 } });
  });
});
