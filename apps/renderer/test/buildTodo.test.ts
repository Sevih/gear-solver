/// <reference types="node" />
// Results table "to do" column: per build, the gear pieces (talisman and EE
// apart) still to enhance, reforge or ascend to reach the solve's projection
// (`pieceReforgePlan` in its reforge mode, real `enhance.json` rules); the
// column hides under `disable`. The header is rendered server-side.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameRulesOf, type GameData, type GearPiece } from "@gear-solver/core";
import { buildTodoOf, buildTodoTitle } from "../src/screens/builder/buildTodo.js";
import { ResultsTable, ResultRow, computeColumnRanges } from "../src/screens/builder/ResultsTable.js";
import type { SolveBuild } from "../src/lib/solver/types.js";
import type { ReforgeContext } from "../src/lib/solver/reforge.js";

const RULES = gameRulesOf({
  enhance: JSON.parse(readFileSync(new URL("../../../data/derived/enhance.json", import.meta.url), "utf8")),
} as GameData);

const piece = (uid: string, slot: string, over: Partial<GearPiece>): GearPiece => ({
  uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
  breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy: null, main: [], subs: [], gemSlots: [], ...over,
} as unknown as GearPiece);

const maxed = piece("maxed", "weapon", { enhanceLevel: 15, reforgeCount: 9, ascended: true, singularityLevel: 5 });
const raw = piece("raw", "helmet", { enhanceLevel: 10, reforgeCount: 6 });
const talisman = piece("tal", "ooparts", { enhanceLevel: 0 });

describe("buildTodoOf", () => {
  it("+15 R9 ascended in +15R9 → nothing to do", () => {
    const todo = buildTodoOf([maxed], "ascended", RULES)!;
    expect(todo.pieces).toBe(0);
    expect(buildTodoTitle(todo)).toBe("Reached as is — nothing to enhance, reforge or ascend");
  });

  it("+10 R6 6★ unique in +15R9 → enhance, 3 reforges, ascend; talisman not counted", () => {
    const todo = buildTodoOf([maxed, raw, talisman, undefined], "ascended", RULES)!;
    expect(todo).toEqual({ pieces: 1, enhance: 1, enhanceFrom: 10, enhanceTo: 15, reforges: 3, ascend: 1 });
    expect(buildTodoTitle(todo)).toBe("1 piece — 1 to enhance (+10 → +15), 3 reforges, 1 to ascend");
  });

  it("+10R9: no enhance past +10, the 3 reforges and the ascension they need", () => {
    const todo = buildTodoOf([raw], "ascended10", RULES)!;
    expect(todo).toEqual({ pieces: 1, enhance: 0, enhanceFrom: null, enhanceTo: null, reforges: 3, ascend: 1 });
    expect(buildTodoTitle(todo)).toBe("1 piece — 3 reforges, 1 to ascend");
  });

  it("+10R9 on a piece already ascended at +10 R6 → the 3 reforges, no ascension", () => {
    const ascended = piece("asc", "armor", { enhanceLevel: 10, reforgeCount: 6, ascended: true });
    const todo = buildTodoOf([ascended], "ascended10", RULES)!;
    expect(todo).toEqual({ pieces: 1, enhance: 0, enhanceFrom: null, enhanceTo: null, reforges: 3, ascend: 0 });
    expect(buildTodoTitle(todo)).toBe("1 piece — 3 reforges");
  });

  it("+10R9 on pieces that can't ascend (6★ rare, 5★ unique) → nothing to ascend", () => {
    const epic6 = piece("epic6", "gloves", { rarity: "rare", enhanceLevel: 10, reforgeCount: 6 });
    const five = piece("five", "accessory", { star: 5, enhanceLevel: 10, reforgeCount: 0 });
    const todo = buildTodoOf([epic6, five], "ascended10", RULES)!;
    expect(todo).toEqual({ pieces: 1, enhance: 0, enhanceFrom: null, enhanceTo: null, reforges: 5, ascend: 0 });
  });

  it("a piece that can't ascend stops at its own +10 ceiling", () => {
    const epic = piece("epic", "boots", { rarity: "rare", enhanceLevel: 10, reforgeCount: 6 });
    expect(buildTodoOf([epic], "ascended", RULES)!.pieces).toBe(0);
  });

  it("disable → no column (null)", () => {
    expect(buildTodoOf([raw], "disable", RULES)).toBeNull();
  });
});

describe("results table — \"to do\" column", () => {
  // `usePersistedState` (column prefs) reads Web Storage: an empty one.
  const empty = { getItem: () => null, setItem: () => {} };
  afterEach(() => vi.unstubAllGlobals());
  const build = {
    pieceUids: ["maxed", "raw"], gemAllocation: { talisman: [], ee: [] }, score: 0, cp: null, upg: 0,
    finalStats: {}, ratings: {},
  } as unknown as SolveBuild;
  const table = (reforgeMode: ReforgeContext["reforgeMode"]) => (vi.stubGlobal("localStorage", empty), renderToStaticMarkup(createElement(ResultsTable, {
    builds: [build], selectedIdx: null, onSelect: () => {}, solving: false, error: null, emptyReason: null,
    brokenSetsEmpty: false, filteredOut: false, statFilters: {}, rows: 10, onRowsChange: () => {},
    pieceByUid: new Map([["maxed", maxed], ["raw", raw]]), heroUid: null, armorSets: [], game: null, heatmap: false,
    dmgSkill: null, reforge: { reforgeMode, priority: {} },
  })));

  it("a sortable header after swaps in a reforge mode, hidden under disable", () => {
    const on = table("ascended");
    expect(on).toContain('title="Pieces to enhance, reforge or ascend to reach the build (talisman and EE not counted)"');
    expect(on.indexOf(">swaps<")).toBeLessThan(on.indexOf(">to do<"));
    expect(table("disable")).not.toContain(">to do<");
  });

  it("the cell shows the count, its title the detail", () => {
    const todo = buildTodoOf([maxed, raw], "ascended", RULES)!;
    const html = renderToStaticMarkup(createElement("table", null, createElement("tbody", null,
      createElement(ResultRow, {
        build, upg: 0, ranges: computeColumnRanges([build], []), statCols: [], ratingCols: [],
        showScore: false, showUpg: true, showTodo: true, todo, showWpn: false, showAcc: false,
        effects: undefined, setTags: undefined, index: 0, onSelect: () => {},
      }))));
    expect(html).toContain('title="1 piece — 1 to enhance (+10 → +15), 3 reforges, 1 to ascend">1</td>');
  });
});
