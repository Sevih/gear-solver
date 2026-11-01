// The settings registry (`lib/settings.ts`): one declaration per persisted
// setting of Settings › Solver, › Display and › Advanced (plus the Presets
// screen's loss threshold), read by React (`useSetting`) and outside it
// (`readSetting` — orchestrator, `lib/log.ts`). The Resets of Settings ›
// Solver and › Display go through it; the Solver pane only holds the settings
// that apply on the next solve, Display the ones applied at once; Settings
// reopens on the last pane (`gs.settings.pane`), on Setup until onboarding is
// done. The panes and the modal are rendered server-side.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SETTINGS, SOLVER_PANE_SETTINGS, clampSetting, parseSetting, readSetting, resetSettings, settingDefault,
  type SettingName,
} from "../src/lib/settings.js";
import { debugEnabled } from "../src/lib/log.js";
import { resetSolverSettings, SolverPane, type SolverSettings } from "../src/design/settings/SolverPane.js";
import { DisplayPane, type DisplaySettings } from "../src/design/settings/DisplayPane.js";
import { SettingsModal } from "../src/design/settings/SettingsModal.js";

const NAMES = Object.keys(SETTINGS) as SettingName[];

/** A getItem-only localStorage over `store`; `throws` simulates a locked-down
 *  context. */
function stubStorage(store: Record<string, string>, throws = false) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (throws) throw new Error("denied");
      return k in store ? store[k] : null;
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("registry", () => {
  it("gives every setting a unique gs.* key, a default, a label and a help text", () => {
    const keys = NAMES.map((n) => SETTINGS[n].key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of NAMES) {
      expect(SETTINGS[n].key).toMatch(/^gs\./);
      expect(SETTINGS[n]).toHaveProperty("default");
      expect(SETTINGS[n].default).not.toBeUndefined();
      expect(SETTINGS[n].label).not.toBe("");
      expect(SETTINGS[n].help).not.toBe("");
    }
  });

  it("keeps the current keys and defaults", () => {
    expect(SETTINGS.workerCount.key).toBe("gs.solver.workerCount");
    expect(settingDefault("workerCount")).toBeNull();
    expect(settingDefault("topN")).toBe(1000);
    expect(settingDefault("topK")).toBe(1000);
    expect(settingDefault("heatmap")).toBe(true);
    expect(settingDefault("compactCards")).toBe(false);
    expect(SETTINGS.resultRows.key).toBe("gs.builder.resultRows");
    expect(settingDefault("resultRows")).toBe(12);
    expect(SETTINGS.presetLossWarn.key).toBe("gs.solver.presetLossWarn");
    expect(settingDefault("presetLossWarn")).toBe(15);
    expect(settingDefault("debugSolver")).toBe(false);
    expect(settingDefault("debugStatLocks")).toBe(false);
    expect(SETTINGS.settingsPane.key).toBe("gs.settings.pane");
    expect(settingDefault("settingsPane")).toBe("setup");
  });

  it("flags only the solver settings as applying on the next solve", () => {
    const next = NAMES.filter((n) => SETTINGS[n].appliesNextSolve);
    expect(next).toEqual(["workerCount", "topN", "topK"]);
    for (const n of ["heatmap", "compactCards", "resultRows", "presetLossWarn"] as const) expect(SETTINGS[n].appliesNextSolve).toBe(false);
  });
});

describe("clampSetting", () => {
  it("holds a number in its bounds and rounds it to the step", () => {
    expect(clampSetting("topN", 0)).toBe(10);
    expect(clampSetting("topN", 9999)).toBe(5000);
    expect(clampSetting("topN", 1149)).toBe(1100);
    expect(clampSetting("topN", 1150)).toBe(1200);
    expect(clampSetting("topK", 40)).toBe(100);
    expect(clampSetting("presetLossWarn", 17)).toBe(15);
    expect(clampSetting("presetLossWarn", 3)).toBe(5);
    expect(clampSetting("presetLossWarn", 60)).toBe(50);
    expect(clampSetting("resultRows", 40)).toBe(15);
    expect(clampSetting("resultRows", 2)).toBe(5);
  });

  it("bounds the worker count by the cores and the ceiling, null staying auto", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    expect(clampSetting("workerCount", 20)).toBe(8);
    expect(clampSetting("workerCount", 0)).toBe(1);
    expect(clampSetting("workerCount", null)).toBeNull();
    vi.stubGlobal("navigator", { hardwareConcurrency: 128 });
    expect(clampSetting("workerCount", 100)).toBe(64);
  });

  it("brings an unknown pane back to Setup, passes booleans through", () => {
    expect(clampSetting("settingsPane", "nope" as never)).toBe("setup");
    expect(clampSetting("settingsPane", "data")).toBe("data");
    expect(clampSetting("settingsPane", "debug" as never)).toBe("advanced");
    expect(clampSetting("heatmap", false)).toBe(false);
  });
});

describe("readSetting", () => {
  it("returns the default when nothing is stored", () => {
    stubStorage({});
    for (const n of NAMES) expect(readSetting(n)).toEqual(settingDefault(n));
  });

  it("returns the default on an invalid value", () => {
    stubStorage({
      "gs.solver.workerCount": "abc",
      "gs.solver.topN": '"lots"',
      "gs.builder.heatmap": "maybe",
      "gs.builder.compactCards": "{}",
      "gs.debug.solver": "2",
      "gs.settings.pane": '"nope"',
    });
    expect(readSetting("workerCount")).toBeNull();
    expect(readSetting("topN")).toBe(1000);
    expect(readSetting("heatmap")).toBe(true);
    expect(readSetting("compactCards")).toBe(false);
    expect(readSetting("debugSolver")).toBe(false);
    expect(readSetting("settingsPane")).toBe("setup");
  });

  it("returns the stored value otherwise", () => {
    stubStorage({
      "gs.solver.workerCount": "6",
      "gs.solver.topN": "300",
      "gs.solver.topK": "2000",
      "gs.builder.heatmap": "false",
      "gs.builder.compactCards": "true",
      "gs.solver.presetLossWarn": "25",
      "gs.debug.solver": "true",
      "gs.debug.statLocks": "1",
      "gs.settings.pane": '"display"',
    });
    expect(readSetting("workerCount")).toBe(6);
    expect(readSetting("topN")).toBe(300);
    expect(readSetting("topK")).toBe(2000);
    expect(readSetting("heatmap")).toBe(false);
    expect(readSetting("compactCards")).toBe(true);
    expect(readSetting("presetLossWarn")).toBe(25);
    expect(readSetting("debugSolver")).toBe(true);
    expect(readSetting("debugStatLocks")).toBe(true); // a hand-set "1" counts as on
    expect(readSetting("settingsPane")).toBe("display");
  });

  it("falls back to the default when localStorage throws", () => {
    stubStorage({ "gs.debug.solver": "true" }, true);
    expect(readSetting("debugSolver")).toBe(false);
  });

  it("is what lib/log.ts reads for its debug flags", () => {
    stubStorage({ "gs.debug.solver": "true" });
    expect(debugEnabled("solver")).toBe(true);
    expect(debugEnabled("statLocks")).toBe(false);
  });

  it("parses with the same rule as the React reader (useSetting)", () => {
    expect(parseSetting("workerCount", "null")).toBeNull();
    expect(parseSetting("topK", "not json")).toBe(1000);
  });
});

/** SolverSettings whose setters record what they were given. */
function recordingSolver(): { solver: SolverSettings; calls: Record<string, unknown> } {
  const calls: Record<string, unknown> = {};
  const rec = (name: string) => (v: unknown) => { calls[name] = v; };
  const solver = {
    workerCount: 4, setWorkerCount: rec("workerCount"),
    topN: 200, setTopN: rec("topN"),
    topK: 300, setTopK: rec("topK"),
  } as SolverSettings;
  return { solver, calls };
}

/** DisplaySettings whose setters record what they were given. */
function recordingDisplay(): { display: DisplaySettings; calls: Record<string, unknown> } {
  const calls: Record<string, unknown> = {};
  const rec = (name: string) => (v: unknown) => { calls[name] = v; };
  const display = {
    heatmap: false, setHeatmap: rec("heatmap"),
    compactCards: true, setCompactCards: rec("compactCards"),
    resultRows: 8, setResultRows: rec("resultRows"),
  } as DisplaySettings;
  return { display, calls };
}

describe("Reset solver settings to defaults", () => {
  it("resetSettings puts every listed setting back to its default", () => {
    const calls: Record<string, unknown> = {};
    resetSettings(SOLVER_PANE_SETTINGS, (name, value) => { calls[name] = value; });
    expect(calls).toEqual({ workerCount: null, topN: 1000, topK: 1000 });
  });

  it("the pane's reset (resetSolverSettings) calls every setter of the pane", () => {
    const { solver, calls } = recordingSolver();
    resetSolverSettings(solver);
    expect(calls).toEqual({ workerCount: null, topN: 1000, topK: 1000 });
  });
});

describe("SolverPane — « applies next solve » over the solver settings, nothing else", () => {
  const html = (showAdvanced: boolean) => renderToStaticMarkup(createElement(SolverPane, {
    solver: recordingSolver().solver, showAdvanced, onToggleAdvanced: () => {},
  }));

  it("puts worker threads, result count and per-worker depth under the strip, no Display group", () => {
    const h = html(true);
    const strip = h.indexOf("applies next solve");
    expect(strip).toBeGreaterThan(-1);
    expect(h.match(/applies next solve/g)).toHaveLength(1);
    for (const n of ["workerCount", "topN", "topK"] as const) expect(h.indexOf(SETTINGS[n].label)).toBeGreaterThan(strip);
    expect(h).not.toContain(">Display<");
    for (const n of ["heatmap", "compactCards", "resultRows", "presetLossWarn"] as const) expect(h).not.toContain(SETTINGS[n].label);
  });

  it("shows the registry texts and ranges", () => {
    const h = html(true);
    expect(h).toContain("Range 10–5000.");
    expect(h).toContain("Range 100–5000.");
    expect(h).toContain('<b class="font-semibold text-amber-300">Too low silently drops good builds</b>');
  });
});

describe("DisplayPane — the settings applied at once", () => {
  const h = renderToStaticMarkup(createElement(DisplayPane, { display: recordingDisplay().display }));

  it("holds the heatmap, compact cards and result rows, none of the solver settings", () => {
    expect(h).toContain(">Display<");
    for (const n of ["heatmap", "compactCards", "resultRows"] as const) expect(h).toContain(SETTINGS[n].label);
    for (const n of ["workerCount", "topN", "topK", "presetLossWarn"] as const) expect(h).not.toContain(SETTINGS[n].label);
    expect(h).not.toContain("applies next solve");
    expect(h).toContain("Range 5–15.");
  });
});

describe("SettingsModal — reopens on the last pane, Setup until onboarding is done", () => {
  const modal = (onboardingDone: boolean) => renderToStaticMarkup(createElement(SettingsModal, {
    open: true, onClose: () => {}, onboardingDone, onResetOnboarding: () => {},
    onSyncData: async () => ({}) as never, onStatus: () => {}, status: "",
    debugStatLocks: false, onToggleDebugStatLocks: () => {}, debugSolver: false, onToggleDebugSolver: () => {},
    solver: recordingSolver().solver, display: recordingDisplay().display,
    update: { state: "uptodate", version: null, progress: 0, error: null, appVersion: "1.28.0", dataSha: null },
    onCheckUpdate: () => {}, onInstallUpdate: () => {}, steam: null, onRefreshSteam: async () => null,
    onSteamInstall: () => {}, onSteamLaunch: () => {}, steamBusy: false, log: [], onClearLog: () => {},
  }));

  it("opens on the stored pane once onboarding is done (Debug now under Advanced)", () => {
    stubStorage({ "gs.settings.pane": '"debug"' });
    expect(modal(true)).toContain(SETTINGS.debugSolver.label);
  });

  it("opens on Setup on a first install, whatever was stored", () => {
    stubStorage({ "gs.settings.pane": '"debug"' });
    const h = modal(false);
    expect(h).not.toContain(SETTINGS.debugSolver.label);
    expect(h).toContain("Setup checks re-run on each open.");
  });
});
