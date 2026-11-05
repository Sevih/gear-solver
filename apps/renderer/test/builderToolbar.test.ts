// Optimizer toolbar rows: row 1 carries the hero, Score | CP, Solve and
// Filter on the left and the ten filter popovers on the right, in two
// right-aligned lines of five (the block wraps onto its own line in a narrow
// window), row 2 Reforge, Maxed only, Transistone potential and "reset
// filters" — no popover. Rendered server-side.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { INITIAL_FILTERS, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { BuilderToolbar } from "../src/screens/builder/BuilderToolbar.js";

const noop = () => {};
const POPOVERS = ["Options", "Stat filters", "Ratings", "Priority", "Mains", "Sets", "Weapons", "Accessories", "Talismans", "+15 passives"];
const ROW2 = '<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">';
const POPOVER_BLOCK = '<div class="ml-auto flex flex-col items-end gap-1.5">';
const POPOVER_LINE = '<div class="flex items-center gap-2">';

function rows(filterActive = false, filters: SolverFilters = INITIAL_FILTERS): [string, string] {
  const html = renderToStaticMarkup(createElement(BuilderToolbar, {
    heroes: [], game: null, selectedUid: null, onSelect: noop, dmgSkill: null,
    armorSets: [], weaponEffects: [], accessoryEffects: [], talismanEffects: [], mainStatCatalogs: {},
    filters, dispatch: noop,
    solving: false, canSolve: true, solveMode: "score", setSolveMode: noop, onSolve: noop, onCancelSolve: noop,
    recoLoading: false, priorityBanner: null, onLoadReco: noop, onUseCp: noop,
    canFilter: true, filterActive, onFilter: noop, onClearFilter: noop,
  }));
  const i = html.indexOf(ROW2);
  expect(i).toBeGreaterThan(-1);
  return [html.slice(0, i), html.slice(i)];
}

/** Labels of the popover triggers, in order. */
const popovers = (html: string) => [...html.matchAll(/<button[^>]*aria-expanded="[^"]*"[^>]*>([^<]*)/g)].map((m) => m[1]);
/** Text of each plain button, in order. */
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("Optimizer toolbar — rows", () => {
  it("row 1: Score | CP, Solve, Filter, then the ten popovers in a right-aligned block on the right", () => {
    const [row1] = rows();
    expect(row1).toContain('<div class="flex flex-wrap items-center gap-2">');
    expect(row1).toContain(POPOVER_BLOCK);
    expect(popovers(row1)).toEqual(POPOVERS);
    expect(row1.indexOf(">Filter<")).toBeLessThan(row1.indexOf(">Options<"));
    expect(buttons(row1).slice(0, 4)).toEqual(["Score", "CP", "Solve", "Filter"]);
  });

  it("the popovers sit on two lines of five, in toolbar order; row 2 stays Reforge, Maxed only, Transistone potential, reset filters", () => {
    const [row1, row2] = rows();
    const [line1 = "", line2 = "", ...rest] = row1.slice(row1.indexOf(POPOVER_BLOCK)).split(POPOVER_LINE).slice(1);
    expect(rest).toEqual([]);
    expect(line2).not.toBe("");
    expect(popovers(line1)).toEqual(POPOVERS.slice(0, 5));
    expect(popovers(line2)).toEqual(POPOVERS.slice(5));
    // Compact triggers: h-6 at 10.5px (Score | CP, Solve and Filter keep h-9).
    for (const m of row1.matchAll(/<button[^>]*aria-expanded="[^"]*"[^>]*>/g)) expect(m[0]).toContain("h-6 ");
    expect(popovers(row2)).toEqual([]);
    const order = [">Reforge<", "Maxed only", "Transistone potential", ">reset filters<"].map((t) => row2.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the ✕ of an active filter sits between Filter and the popovers", () => {
    const [row1] = rows(true);
    expect(row1.indexOf(">Filter<")).toBeLessThan(row1.indexOf(">✕<"));
    expect(row1.indexOf(">✕<")).toBeLessThan(row1.indexOf(">Options<"));
  });

  it("row 2: Reforge, Maxed only, Transistone potential, reset filters — no popover", () => {
    const [, row2] = rows();
    expect(popovers(row2)).toEqual([]);
    expect(row2).toContain(">Reforge<");
    expect(row2.indexOf("Maxed only")).toBeLessThan(row2.indexOf("Transistone potential"));
    expect(buttons(row2).at(-1)).toBe("reset filters");
  });
});

describe("Optimizer toolbar — Weapons, Accessories, Talismans and +15 passives counts", () => {
  /** The badge right after a trigger's label, null without one. */
  const badge = (html: string, label: string) =>
    html.match(new RegExp(`>${label.replace(/[+]/g, "\\+")}(?:<span[^>]*>(\\d+)</span>)?`))?.[1] ?? null;

  it("each button counts the picks of its own group; +15 passives those of every group", () => {
    const filters: SolverFilters = {
      ...INITIAL_FILTERS,
      weaponEffectPicks: { "1001": "required" },
      accessoryEffectPicks: { "2001": "excluded", "2002": "required" },
      talismanEffectPicks: { "3001": "preferred", "3002": "required", "3003": "excluded" },
      passivePicks: {
        weapon: { "Increased DMG within Dimensional Singularity": { state: "required", minGrade: "A" } },
        accessory: {},
        armor: { "Reduced DMG Taken vs Fire": { state: "excluded", minGrade: "C" }, "Reduced DMG Taken from targets": { state: "required", minGrade: "C" } },
      },
    };
    const [row1] = rows(false, filters);
    expect(badge(row1, "Weapons")).toBe("1");
    expect(badge(row1, "Accessories")).toBe("2");
    expect(badge(row1, "Talismans")).toBe("3");
    expect(badge(row1, "+15 passives")).toBe("3");
    const [empty] = rows();
    for (const label of ["Weapons", "Accessories", "Talismans", "+15 passives"]) expect(badge(empty, label)).toBeNull();
  });
});
