/**
 * Builder first result (U6), rendered server-side: the toolbar's Score | CP
 * control beside a single "Solve" button (and "Loading reco…" while SOLVE
 * fetches the reco), and the priority banner in its states — no priority
 * (Load reco / Set priority / Use CP), no reco (Set priority / Use CP), the
 * reco's priority (Edit / Clear) — shown with the popovers closed.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { INITIAL_FILTERS } from "../src/lib/solver/builderFilters.js";
import type { SolveMode } from "../src/lib/solver/types.js";
import { BuilderToolbar } from "../src/screens/builder/BuilderToolbar.js";
import { PriorityBanner, type PriorityBannerState } from "../src/screens/builder/PriorityBanner.js";

const noop = () => {};

function toolbar(over: { solveMode?: SolveMode; recoLoading?: boolean; priorityBanner?: PriorityBannerState | null; solving?: boolean } = {}) {
  return renderToStaticMarkup(createElement(BuilderToolbar, {
    heroes: [], game: null, selectedUid: null, onSelect: noop, dmgSkill: null,
    armorSets: [], weaponEffects: [], accessoryEffects: [], talismanEffects: [], mainStatCatalogs: {},
    filters: INITIAL_FILTERS, dispatch: noop,
    solving: over.solving ?? false, canSolve: true,
    solveMode: over.solveMode ?? "score", setSolveMode: noop, onSolve: noop, onCancelSolve: noop,
    recoLoading: over.recoLoading ?? false,
    priorityBanner: over.priorityBanner ?? null, onLoadReco: noop, onUseCp: noop,
    canFilter: false, filterActive: false, onFilter: noop, onClearFilter: noop,
  }));
}

function banner(state: PriorityBannerState, mode: SolveMode = "score") {
  return renderToStaticMarkup(createElement(PriorityBanner, {
    state, mode, onLoadReco: noop, onSetPriority: noop, onUseCp: noop, onClear: noop,
  }));
}

/** Text of each button, in order. */
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("toolbar — Score | CP and Solve", () => {
  it("a segmented Score | CP, then one Solve button; no mode menu", () => {
    const html = toolbar();
    expect(buttons(html).slice(0, 3)).toEqual(["Score", "CP", "Solve"]);
    expect(html).toContain('aria-label="Solve mode"');
    expect(html).not.toContain("Change solve mode");
    expect(html).not.toContain("Solve CP");
  });

  it("the current mode's segment is pressed; the button still reads Solve", () => {
    const html = toolbar({ solveMode: "cp" });
    expect(html).toMatch(/aria-pressed="false"[^>]*>Score</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>CP</);
    expect(buttons(html)[2]).toBe("Solve");
  });

  it("fetching the reco: Loading reco…, disabled", () => {
    const html = toolbar({ recoLoading: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Loading reco…<\/button>/);
  });

  it("solving: Cancel in place of Solve", () => {
    const html = toolbar({ solving: true });
    expect(buttons(html)).toContain("Cancel");
    expect(buttons(html)).not.toContain("Solve");
  });

  it("the banner sits under the hero row, popovers closed", () => {
    expect(toolbar()).not.toContain("No priority set");
    const html = toolbar({ priorityBanner: "none" });
    expect(html).toContain("No priority set — Solve will use the outerpedia reco&#x27;s weights");
    expect(html.indexOf("No priority set")).toBeGreaterThan(html.indexOf(">Solve<"));
    expect(html.indexOf("No priority set")).toBeLessThan(html.indexOf(">Reforge<"));
    expect(html).not.toContain("Substat priority");
  });
});

describe("priority banner", () => {
  it("no priority: the reco's weights, three actions", () => {
    const html = banner("none");
    expect(html).toContain("No priority set — Solve will use the outerpedia reco&#x27;s weights");
    expect(buttons(html)).toEqual(["Load reco", "Set priority", "Use CP"]);
  });

  it("no priority and no reco: Combat Power, Set priority / Use CP", () => {
    const html = banner("no-reco");
    expect(html).toContain("no outerpedia reco for this hero — Solve will use Combat Power");
    expect(buttons(html)).toEqual(["Set priority", "Use CP"]);
  });

  it("CP mode: no Use CP, says CP needs none", () => {
    const html = banner("none", "cp");
    expect(html).toContain("CP mode needs none");
    expect(buttons(html)).toEqual(["Load reco", "Set priority"]);
  });

  it("the reco's priority: an information line with Edit / Clear", () => {
    const html = banner("from-reco");
    expect(html).toContain("Priority from outerpedia reco");
    expect(html).not.toContain("No priority set");
    expect(buttons(html)).toEqual(["Edit", "Clear"]);
  });
});
