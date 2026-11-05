// Optimizer toolbar rows: row 1 carries the hero, Score | CP, Solve and
// Filter on the left and the nine filter popovers on one line on the right
// (the group wraps onto its own line in a narrow window), row 2 the Options
// popover first, then Reforge, Maxed only, Transistone potential and "reset
// filters". Rendered server-side.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { INITIAL_FILTERS, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { BuilderToolbar } from "../src/screens/builder/BuilderToolbar.js";

const noop = () => {};
const POPOVERS = ["Stat filters", "Ratings", "Priority", "Mains", "Sets", "Weapons", "Accessories", "Talismans", "+15 passives"];
const POPOVER_GROUP = '<div class="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1.5">';
const ROW2 = '<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">';

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
  it("row 1: Score | CP, Solve, Filter, then the nine popovers on one line on the right", () => {
    const [row1] = rows();
    expect(row1).toContain('<div class="flex flex-wrap items-center gap-2">');
    expect(row1).toContain(POPOVER_GROUP);
    expect(popovers(row1)).toEqual(POPOVERS);
    // One group, no nested line: every trigger is a direct popover of the group.
    expect(row1.slice(row1.indexOf(POPOVER_GROUP) + POPOVER_GROUP.length)).not.toContain('<div class="flex items-center gap-2">');
    expect(row1.indexOf(">Filter<")).toBeLessThan(row1.indexOf(">Stat filters<"));
    expect(buttons(row1).slice(0, 4)).toEqual(["Score", "CP", "Solve", "Filter"]);
    // Compact triggers: h-6 at 10.5px (Score | CP, Solve and Filter keep h-9).
    for (const m of row1.matchAll(/<button[^>]*aria-expanded="[^"]*"[^>]*>/g)) expect(m[0]).toContain("h-6 ");
  });

  it("the ✕ of an active filter sits between Filter and the popovers", () => {
    const [row1] = rows(true);
    expect(row1.indexOf(">Filter<")).toBeLessThan(row1.indexOf(">✕<"));
    expect(row1.indexOf(">✕<")).toBeLessThan(row1.indexOf(">Stat filters<"));
  });

  it("row 2: Options first, then Reforge, Maxed only, Transistone potential, reset filters", () => {
    const [, row2] = rows();
    expect(popovers(row2)).toEqual(["Options"]);
    for (const m of row2.matchAll(/<button[^>]*aria-expanded="[^"]*"[^>]*>/g)) expect(m[0]).toContain("h-6 ");
    const order = [">Options<", ">Reforge<", "Maxed only", "Transistone potential", ">reset filters<"].map((t) => row2.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
