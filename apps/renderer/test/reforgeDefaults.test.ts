// Hero defaults of Settings › Solver: the reforge mode and Transistone
// potential a hero with no kept filters opens on in the Optimizer
// (`gs.solver.reforgeMode` / `gs.solver.rerollPotential`), a hero's own choice
// kept with its filters, the pane's Reset back to +10R6 / off, and the one
// migration of the legacy `useReforged` boolean (`legacyReforgeMode`).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SETTINGS, SOLVER_PANE_SETTINGS, clampSetting, parseSetting, resetSettings, settingDefault } from "../src/lib/settings.js";
import { legacyReforgeMode, REFORGE_MODES } from "../src/lib/solver/reforge.js";
import { filterDefaults, INITIAL_FILTERS, solverFiltersReducer, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { filtersForHero } from "../src/lib/storage/heroFilters.js";
import { SolverPane, type SolverSettings } from "../src/design/settings/SolverPane.js";

describe("registry", () => {
  it("declares both hero defaults under gs.solver.*, +10R6 and off out of the box", () => {
    expect(SETTINGS.reforgeMode.key).toBe("gs.solver.reforgeMode");
    expect(SETTINGS.rerollPotential.key).toBe("gs.solver.rerollPotential");
    expect(settingDefault("reforgeMode")).toBe("classic");
    expect(settingDefault("rerollPotential")).toBe(false);
    // The engine's modes, in the toolbar's order.
    expect(SETTINGS.reforgeMode.kind === "choice" && SETTINGS.reforgeMode.choices).toEqual(REFORGE_MODES.map((m) => m.value));
  });

  it("falls back to +10R6 outside the modes, reads a stored mode", () => {
    expect(clampSetting("reforgeMode", "nope" as never)).toBe("classic");
    expect(parseSetting("reforgeMode", '"ascended"')).toBe("ascended");
    expect(parseSetting("reforgeMode", '"nope"')).toBe("classic");
    expect(parseSetting("rerollPotential", "true")).toBe(true);
  });

  it("the Solver pane's Reset puts back five settings, the hero defaults included", () => {
    const calls: Record<string, unknown> = {};
    resetSettings(SOLVER_PANE_SETTINGS, (name, value) => { calls[name] = value; });
    expect(Object.keys(calls)).toHaveLength(5);
    expect(calls).toMatchObject({ reforgeMode: "classic", rerollPotential: false });
  });
});

describe("legacyReforgeMode — the one useReforged migration", () => {
  it("maps the legacy boolean, a stored mode winning", () => {
    expect(legacyReforgeMode({ useReforged: true })).toBe("classic");
    expect(legacyReforgeMode({ useReforged: false })).toBe("disable");
    expect(legacyReforgeMode({})).toBe("disable");
    expect(legacyReforgeMode({ reforgeMode: "ascended10", useReforged: true })).toBe("ascended10");
  });
});

describe("hero defaults vs kept filters", () => {
  const defaults = filterDefaults("ascended", true);

  it("filterDefaults only swaps the reforge mode and Transistone of INITIAL_FILTERS", () => {
    expect(defaults.options).toEqual({ ...INITIAL_FILTERS.options, reforgeMode: "ascended", rerollPotential: true });
    expect({ ...defaults, options: INITIAL_FILTERS.options }).toEqual(INITIAL_FILTERS);
    expect(INITIAL_FILTERS.options.reforgeMode).toBe("classic");
    expect(INITIAL_FILTERS.options.rerollPotential).toBe(false);
  });

  it("a hero with no kept filters opens on the defaults", () => {
    const f = filtersForHero({}, "H", defaults);
    expect(f.options.reforgeMode).toBe("ascended");
    expect(f.options.rerollPotential).toBe(true);
    // With a fallback priority too.
    const p = filtersForHero({}, "H", defaults, { atk: 2 });
    expect(p.options.reforgeMode).toBe("ascended");
    expect(p.priority).toEqual({ atk: 2 });
  });

  it("a hero with kept filters keeps their own choice", () => {
    const kept: SolverFilters = { ...INITIAL_FILTERS, options: { ...INITIAL_FILTERS.options, reforgeMode: "disable", rerollPotential: false } };
    const f = filtersForHero({ H: kept }, "H", defaults);
    expect(f.options.reforgeMode).toBe("disable");
    expect(f.options.rerollPotential).toBe(false);
  });

  it("reset filters goes back to the given defaults", () => {
    const dirty: SolverFilters = { ...INITIAL_FILTERS, topPct: 10 };
    expect(solverFiltersReducer(dirty, { type: "resetAll", to: defaults })).toBe(defaults);
  });
});

describe("SolverPane — Hero defaults", () => {
  const solver = {
    workerCount: null, setWorkerCount: () => {},
    topN: 1000, setTopN: () => {},
    topK: 1000, setTopK: () => {},
    reforgeMode: "classic", setReforgeMode: () => {},
    rerollPotential: false, setRerollPotential: () => {},
  } as SolverSettings;
  const h = renderToStaticMarkup(createElement(SolverPane, { solver, showAdvanced: false, onToggleAdvanced: () => {} }));

  it("shows the strip, the four modes and the Transistone switch", () => {
    const strip = h.indexOf("Hero defaults");
    expect(strip).toBeGreaterThan(-1);
    expect(h).toContain("for a hero&#x27;s first solve");
    for (const label of ["Off", "+10R6", "+10R9", "+15R9"]) expect(h.indexOf(`>${label}</button>`)).toBeGreaterThan(strip);
    expect(h).toContain(SETTINGS.reforgeMode.label);
    expect(h.indexOf("Transistone potential by default")).toBeGreaterThan(strip);
    expect(h).toContain('role="switch"');
  });
});
