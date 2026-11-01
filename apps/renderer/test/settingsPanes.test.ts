// The six Settings panes (U12): Setup, Data & updates, Solver, Display,
// Backup, Advanced in that order. A pane stored by an older install (Debug,
// Logs) reopens on Advanced; Solver holds only what applies on the next
// solve, Display what applies at once, Advanced the developer toggles, the
// onboarding reset and the journal, Data & updates the update center. Gear ›
// Overview (ex-Home) renders no update card. Rendered server-side.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SETTINGS, parseSetting, type SettingsPane } from "../src/lib/settings.js";
import type { UpdateStatus } from "../src/lib/update.js";
import type { Inventory } from "@gear-solver/core";
import { SettingsModal } from "../src/design/settings/SettingsModal.js";
import { resetSolverSettings, type SolverSettings } from "../src/design/settings/SolverPane.js";
import { resetDisplaySettings, type DisplaySettings } from "../src/design/settings/DisplayPane.js";
import { OverviewView } from "../src/screens/gear/OverviewView.js";

const noop = () => {};

/** A getItem-only Web Storage over `store`. */
function stubStorage(store: Record<string, string>) {
  const stub = { getItem: (k: string) => (k in store ? store[k] : null) };
  vi.stubGlobal("localStorage", stub);
  vi.stubGlobal("sessionStorage", stub);
}

afterEach(() => vi.unstubAllGlobals());

/** Setters that record what they were given. */
function recorder() {
  const calls: Record<string, unknown> = {};
  return { calls, rec: (name: string) => (v: unknown) => { calls[name] = v; } };
}

function solverSettings(rec: (name: string) => (v: unknown) => void): SolverSettings {
  return {
    workerCount: 4, setWorkerCount: rec("workerCount"),
    topN: 200, setTopN: rec("topN"),
    topK: 300, setTopK: rec("topK"),
  } as SolverSettings;
}

function displaySettings(rec: (name: string) => (v: unknown) => void): DisplaySettings {
  return {
    heatmap: false, setHeatmap: rec("heatmap"),
    compactCards: true, setCompactCards: rec("compactCards"),
    resultRows: 8, setResultRows: rec("resultRows"),
  } as DisplaySettings;
}

const UP_TO_DATE: UpdateStatus = { state: "uptodate", version: null, progress: 0, error: null, appVersion: "1.28.0", dataSha: null };

/** The modal, onboarding done, opened on `pane` (as stored). */
function modal(pane: SettingsPane): string {
  stubStorage({ "gs.settings.pane": JSON.stringify(pane) });
  const { rec } = recorder();
  return renderToStaticMarkup(createElement(SettingsModal, {
    open: true, onClose: noop, onboardingDone: true, onResetOnboarding: noop,
    onSyncData: async () => ({}) as never, onStatus: noop, status: "",
    debugStatLocks: false, onToggleDebugStatLocks: noop, debugSolver: false, onToggleDebugSolver: noop,
    solver: solverSettings(rec), display: displaySettings(rec),
    update: UP_TO_DATE, onCheckUpdate: noop, onInstallUpdate: noop,
    steam: null, onRefreshSteam: async () => null, onSteamInstall: noop, onSteamLaunch: noop, steamBusy: false,
    log: [], onClearLog: noop,
  }));
}

/** The pane's content (and footer), the rail left out. */
const content = (html: string) => html.slice(html.indexOf("</nav>"));
/** A label as the markup spells it. */
const esc = (text: string) => text.replaceAll("&", "&amp;");

describe("gs.settings.pane migration", () => {
  it("maps the old Debug and Logs panes to Advanced, keeps Data, unknown → Setup", () => {
    expect(parseSetting("settingsPane", '"debug"')).toBe("advanced");
    expect(parseSetting("settingsPane", '"logs"')).toBe("advanced");
    expect(parseSetting("settingsPane", '"data"')).toBe("data");
    expect(parseSetting("settingsPane", '"nope"')).toBe("setup");
  });
});

describe("SettingsModal — six panes", () => {
  it("lists the six panes in the rail, in order", () => {
    const h = modal("setup");
    const rail = h.slice(h.indexOf("<nav"), h.indexOf("</nav>"));
    const labels = [...rail.matchAll(/<span class="flex-1">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Setup", "Data &amp; updates", "Solver", "Display", "Backup", "Advanced"]);
  });

  it("Solver: worker threads and result count, no display setting nor the loss threshold", () => {
    const h = content(modal("solver"));
    expect(h).toContain(SETTINGS.workerCount.label);
    expect(h).toContain(SETTINGS.topN.label);
    expect(h).not.toContain(SETTINGS.heatmap.label);
    expect(h).not.toContain(SETTINGS.compactCards.label);
    expect(h).not.toContain(SETTINGS.presetLossWarn.label);
    expect(h).not.toContain(">Display<");
  });

  it("Display: the heatmap, compact cards and result rows", () => {
    const h = content(modal("display"));
    for (const n of ["heatmap", "compactCards", "resultRows"] as const) expect(h).toContain(SETTINGS[n].label);
  });

  it("Advanced: both debug toggles, the onboarding reset and the journal", () => {
    const h = content(modal("advanced"));
    expect(h).toContain(esc(SETTINGS.debugStatLocks.label));
    expect(h).toContain(SETTINGS.debugSolver.label);
    expect(h).toContain("Reset onboarding prompt");
    expect(h).toContain("Logs (0 lines)");
  });

  it("Data & updates: the update card and the game data version, no onboarding reset", () => {
    const h = content(modal("data"));
    expect(h).toContain("Game data version");
    expect(h).toContain("Up to date");
    expect(h).not.toContain("Reset onboarding prompt");
  });
});

describe("pane resets", () => {
  it("resetSolverSettings puts back the three solver settings only", () => {
    const { calls, rec } = recorder();
    resetSolverSettings(solverSettings(rec));
    expect(calls).toEqual({ workerCount: null, topN: 1000, topK: 1000 });
  });

  it("resetDisplaySettings puts back the three display settings only", () => {
    const { calls, rec } = recorder();
    resetDisplaySettings(displaySettings(rec));
    expect(calls).toEqual({ heatmap: true, compactCards: false, resultRows: 12 });
  });
});

describe("Gear › Overview", () => {
  it("renders no update card", () => {
    stubStorage({});
    const h = renderToStaticMarkup(createElement(OverviewView, {
      inventory: { gear: [], characters: [] } as unknown as Inventory, game: null, capStatus: null,
    }));
    expect(h).toContain("Gear quality distribution");
    expect(h).not.toContain("Up to date");
    expect(h).not.toContain("Checking for updates…");
  });
});
