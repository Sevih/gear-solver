// The Optimizer in team context (G139, screens/builder/BuilderScreen.tsx +
// useSolverSession.ts): a member's "Optimize →" loads the member's filters
// (never the hero's own), writes each edit back to the member only, solves
// under the team's piece rule — equipped scope forced to "all", no preset holds
// nor Worklist claims nor hero ranks, the member's exclusion passed, and the
// earlier members' Talisman mains (G143) out of the solve and in the banner, the
// other members' Talisman mains (G144) in the solve's stats and the banner — greys the
// scope out, retains a result for the member, and leaves the context when the
// hero is switched. Outside a team the solve is unchanged. Same harness as
// builderScreenState.test.ts: `react` mocked with a minimal hooks runtime, the
// orchestrator a fake that records each solve.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import type { SolveBuild } from "../src/lib/solver/types.js";
import type { SolverFilters } from "../src/lib/solver/builderFilters.js";
import type { TeamContext } from "../src/lib/teams/teamContext.js";

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
    finish(builds: unknown[]) { if (!state.active) return; state.active = false; state.cb!.onResult(builds, 10, undefined, null, null); },
    reset() { state.cb = null; state.active = false; state.solves = []; },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...runtime.hooks }));
vi.mock("../src/lib/solver/orchestrator.js", () => ({ SolverOrchestrator: orch.FakeOrchestrator, resolveWorkerCount: () => 1 }));

const { BuilderScreen } = await import("../src/screens/builder/BuilderScreen.js");
const { BuilderToolbar } = await import("../src/screens/builder/BuilderToolbar.js");
const { ResultsTable } = await import("../src/screens/builder/ResultsTable.js");
const { filterDefaults } = await import("../src/lib/solver/builderFilters.js");

beforeEach(() => {
  runtime.reset();
  orch.reset();
  const m = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  } as Storage;
});

const hero = (uid: string) => ({
  uid, charId: 1, fusionCharId: 0, name: uid, stars: 5, exp: 0, levelMaxStep: 0, fusionLevel: 0,
  skills: { first: 1, second: 1, ultimate: 1, chainPassive: 1 },
}) as unknown as Character;
const inventory = { gear: [], characters: [hero("h1"), hero("h2")], presets: [] } as unknown as Inventory;
const game = { characters: {}, equipment: {}, sets: {} } as unknown as GameData;
const result = (cp: number): SolveBuild => ({
  pieceUids: ["w1", "", "", "", "", "", "", ""], gemAllocation: { talisman: [], ee: [] },
  finalStats: {} as SolveBuild["finalStats"], ratings: {} as SolveBuild["ratings"], score: cp, cp, upg: 0,
});

/** The member's filters (Top% 77, scope "lower") and the hero's own (Top% 40). */
const memberFilters: SolverFilters = { ...filterDefaults("classic", false), topPct: 77 };
const heroOwn: SolverFilters = { ...filterDefaults("classic", false), topPct: 40 };
const teamCtx: TeamContext = {
  teamId: "t1", teamName: "GR PCU Ep1", heroUid: "h1", position: 2, size: 4,
  filters: memberFilters, exclusion: new Set(["w0", "junk"]), gemReserved: new Set(), talismanMains: new Map(), talismanBuffs: [],
};
const holds = { holders: { p9: [1] }, rank: { 1: 1 }, locked: [1] } as unknown as NonNullable<Parameters<typeof BuilderScreen>[0]["presetHolds"]>;

type Props = Parameters<typeof BuilderScreen>[0];
function harness(team: TeamContext | null) {
  const calls = { heroFilters: 0, teamFilters: [] as Array<[string, string, SolverFilters]>, leave: 0, used: [] as unknown[] };
  const props: Props = {
    inventory, game, userGeasLevels: null, userCodexLevel: null,
    heroPriority: { h1: 2, h2: 1 },
    heroFilters: { h1: heroOwn },
    onHeroFiltersChange: () => { calls.heroFilters++; },
    excludedPieceUids: new Set(["junk"]),
    worklistClaims: { p1: "h2" },
    presetHolds: holds,
    initialHeroUid: "h1",
    team,
    onTeamFiltersChange: (teamId, heroUid, f) => { calls.teamFilters.push([teamId, heroUid, f]); },
    onUseForTeam: (teamId, heroUid, b) => { calls.used.push({ teamId, heroUid, ...b }); },
    onLeaveTeam: () => { calls.leave++; props.team = null; },
  };
  const render = () => runtime.render(() => BuilderScreen(props));
  return { props, calls, render };
}

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
/** The tree's text (its string and number children, in order). */
const textOf = (tree: unknown): string => {
  const out: string[] = [];
  const visit = (n: unknown) => {
    if (typeof n === "string" || typeof n === "number") out.push(String(n));
    else if (Array.isArray(n)) n.forEach(visit);
    else if (n && typeof n === "object" && "props" in n) visit((n as ReactElement<{ children?: unknown }>).props.children);
  };
  visit(tree);
  return out.join("");
};
type ToolbarProps = Parameters<typeof BuilderToolbar>[0];
type TableProps = Parameters<typeof ResultsTable>[0];

describe("Optimizer in team context", () => {
  it("solves with equipped scope all, no preset holds nor Worklist claims nor ranks, the member's exclusion", () => {
    const { render } = harness(teamCtx);
    const tree = render();
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    const req = orch.state.solves[0]!;
    const filters = req.filters as { options: { equippedScope: string }; topPct: number };
    expect(filters.options.equippedScope).toBe("all");
    expect(filters.topPct).toBe(77);
    expect(req.presetHolds).toBeUndefined();
    expect(req.worklistClaims).toBeUndefined();
    expect(req.heroPriority).toEqual({});
    expect(req.targetPresetNum).toBeNull();
    expect(req.excludedPieceUids).toEqual(["w0", "junk"]);
  });

  it("the earlier members' Talisman mains (G143): out of the solve, named in the banner, not in the member's filters", () => {
    const { render, calls } = harness({ ...teamCtx, talismanMains: new Map([["atkPct", "h2"]]) });
    const tree = render();
    expect(textOf(tree)).toContain("Talisman main stat taken by h2: ATK%");
    const toolbar = find<ToolbarProps>(tree, BuilderToolbar);
    expect(toolbar.filters.mainExcludes).toEqual({});
    toolbar.onSolve("cp");
    const req = orch.state.solves[0]!;
    expect(req.reservedTalismanMains).toEqual(["atkPct"]);
    expect(req.filters).toMatchObject({ mainExcludes: {} });
    expect(calls.teamFilters).toHaveLength(0);
    // None reserved: no line, no field.
    const plain = harness(teamCtx);
    const t2 = plain.render();
    expect(textOf(t2)).not.toContain("Talisman main stat taken");
    find<ToolbarProps>(t2, BuilderToolbar).onSolve("cp");
    expect(orch.state.solves.at(-1)).not.toHaveProperty("reservedTalismanMains");
  });

  it("the other members' Talisman mains (G144): in the solve, named in the banner, not in the member's filters", () => {
    const { render, calls } = harness({ ...teamCtx, talismanBuffs: [{ stat: "atkPct", value: 15, percent: true, fromBuff: true, heroUid: "h2" }] });
    const tree = render();
    expect(textOf(tree)).toContain("Team talismans: ATK% +15% (h2)");
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    const req = orch.state.solves[0]!;
    expect(req.teamTalismanBuffs).toEqual([{ stat: "atkPct", value: 15, percent: true, fromBuff: true }]);
    expect(calls.teamFilters).toHaveLength(0);
    // None: no line, no field.
    const plain = harness(teamCtx);
    const t2 = plain.render();
    expect(textOf(t2)).not.toContain("Team talismans");
    find<ToolbarProps>(t2, BuilderToolbar).onSolve("cp");
    expect(orch.state.solves.at(-1)).not.toHaveProperty("teamTalismanBuffs");
  });

  it("outside a team the solve keeps the hero's filters and every account rule", () => {
    const { render } = harness(null);
    find<ToolbarProps>(render(), BuilderToolbar).onSolve("cp");
    const req = orch.state.solves[0]!;
    const filters = req.filters as { options: { equippedScope: string }; topPct: number };
    expect(filters.options.equippedScope).toBe("lower");
    expect(filters.topPct).toBe(40);
    expect(req.presetHolds).toBe(holds);
    expect(req.worklistClaims).toEqual({ p1: "h2" });
    expect(req.heroPriority).toEqual({ h1: 2, h2: 1 });
    expect(req.excludedPieceUids).toEqual(["junk"]);
  });

  it("loads the member's filters, writes an edit to the member only, greys the scope out", () => {
    const { render, calls } = harness(teamCtx);
    const toolbar = find<ToolbarProps>(render(), BuilderToolbar);
    expect(toolbar.filters.topPct).toBe(77);
    expect(toolbar.scopeLock).toMatch(/pinned to All/);
    toolbar.dispatch({ type: "setTopPct", value: 90 });
    render();
    expect(calls.teamFilters).toHaveLength(1);
    expect(calls.teamFilters[0]!.slice(0, 2)).toEqual(["t1", "h1"]);
    expect(calls.teamFilters[0]![2].topPct).toBe(90);
    expect(calls.heroFilters).toBe(0);
  });

  it("Use for team retains the result (pieces, mode, CP) for the member", () => {
    const { render, calls } = harness(teamCtx);
    find<ToolbarProps>(render(), BuilderToolbar).onSolve("cp");
    orch.finish([result(5000), result(4000)]);
    const table = find<TableProps>(render(), ResultsTable);
    table.onUseForTeam!(1);
    expect(calls.used).toEqual([expect.objectContaining({ teamId: "t1", heroUid: "h1", pieceUids: result(4000).pieceUids, mode: "cp", cp: 4000 })]);
  });

  it("reports its solving state to App (the gate of the Teams tab's Build team, G140)", () => {
    const { props, render } = harness(null);
    const seen: boolean[] = [];
    props.onSolvingChange = (solving) => seen.push(solving);
    const tree = render();
    expect(seen).toEqual([false]);
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    render();
    orch.finish([result(5000)]);
    render();
    expect(seen).toEqual([false, true, false]);
  });

  it("no Use for team outside a team", () => {
    const { render } = harness(null);
    expect(find<TableProps>(render(), ResultsTable).onUseForTeam).toBeUndefined();
    expect(find<ToolbarProps>(render(), BuilderToolbar).scopeLock).toBeNull();
  });

  it("switching heroes leaves the context: the hero's own filters, the account rules back", () => {
    const { render, calls } = harness(teamCtx);
    find<ToolbarProps>(render(), BuilderToolbar).onSelect("h2");
    render();
    expect(calls.leave).toBe(1);
    find<ToolbarProps>(render(), BuilderToolbar).onSelect("h1");
    const tree = render();
    // h1 again, outside the team: their own filters.
    expect(find<ToolbarProps>(tree, BuilderToolbar).filters.topPct).toBe(40);
    find<ToolbarProps>(tree, BuilderToolbar).onSolve("cp");
    expect((orch.state.solves.at(-1)!.filters as { options: { equippedScope: string } }).options.equippedScope).toBe("lower");
  });

  it("the team context leaving on the same hero brings the hero's own filters back", () => {
    const { render, props } = harness(teamCtx);
    expect(find<ToolbarProps>(render(), BuilderToolbar).filters.topPct).toBe(77);
    props.team = null;
    expect(find<ToolbarProps>(render(), BuilderToolbar).filters.topPct).toBe(40);
  });
});
