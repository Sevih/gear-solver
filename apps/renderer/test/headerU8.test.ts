/**
 * One header (U8): the capture pill's single vocabulary (`captureBadge`), the
 * pending-update badge (`updateBadge`), the one data-version format
 * (`dataVersionLabel`), and — rendered server-side — the header with one
 * capture pill and the update badge only when there is something to install,
 * Home › System health without install / launch / reload buttons, and Home's
 * empty state without a button of its own.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { captureBadge, type SteamStatus } from "../src/steam.js";
import { updateBadge, type UpdateStatus } from "../src/lib/update.js";
import { dataVersionLabel } from "../src/lib/dataVersion.js";
import { GsHeader, type HeaderUpdate } from "../src/design/Shell.js";
import { SystemHealthCard } from "../src/screens/home/SystemHealthCard.js";
import { EmptyDashboard } from "../src/screens/home/EmptyDashboard.js";

const noop = () => {};
const DIR = "C:/Steam/steamapps/common/OUTERPLANE";

function steam(over: Partial<SteamStatus> = {}, plugin: Partial<SteamStatus["plugin"]> = {}): SteamStatus {
  return {
    installed: true, gameDir: DIR, buildId: "123",
    reference: { version: "1.4.18", buildId: "123", dumpedAt: "2026-10-30" },
    buildDiffers: false,
    bepinex: { present: true, version: "5.4.23" },
    plugin: { present: true, upToDate: true, outDir: "x", outDirOk: true, ...plugin },
    bundleAvailable: true, gameRunning: false, heartbeat: null, live: false, ready: true,
    launchOptionsOk: null,
    ...over,
  };
}

const update = (over: Partial<UpdateStatus>): UpdateStatus => ({
  state: "uptodate", version: null, progress: 0, error: null, appVersion: "1.28.0", dataSha: null, ...over,
});

describe("captureBadge", () => {
  it("names every state with one vocabulary", () => {
    const cases: Array<[SteamStatus | null, string, string]> = [
      [null, "Checking…", "idle"],
      [steam({ installed: false, gameDir: null, ready: false }), "Steam not found", "idle"],
      [steam({ ready: false }, { present: false, upToDate: false }), "Plugin needed", "warn"],
      [steam({ ready: false }, { upToDate: false }), "Plugin update available", "warn"],
      [steam({ ready: false }, { outDirOk: false }), "Plugin needed", "warn"],
      [steam(), "Game closed", "idle"],
      [steam({ gameRunning: true }), "Waiting for game", "warn"],
      [steam({ gameRunning: true, live: true }), "Live", "live"],
    ];
    for (const [s, label, tone] of cases) {
      const b = captureBadge(s);
      expect([b.label, b.tone]).toEqual([label, tone]);
      expect(b.label).not.toMatch(/Steam ·/);
    }
  });

  it("puts the game folder and the plugin version in the title", () => {
    expect(captureBadge(steam()).title).toContain(DIR);
    expect(captureBadge(steam({ ready: false }, { upToDate: false })).title).toContain(DIR);
    const live = steam({
      gameRunning: true, live: true,
      heartbeat: { version: "0.10.0", pid: 1, startedAt: "", pathHook: true, captures: 3, lastPath: null, lastCaptureAt: null, outDir: "x" },
    });
    expect(captureBadge(live).title).toContain("v0.10.0");
    expect(captureBadge(live).title).toContain(DIR);
  });
});

describe("updateBadge", () => {
  it("shows vX ready / vX available, nothing when up to date or checking", () => {
    expect(updateBadge(update({ state: "downloaded", version: "1.29.0" }))).toEqual({ label: "v1.29.0 ready", tone: "ready" });
    expect(updateBadge(update({ state: "downloading", version: "1.29.0" }))).toEqual({ label: "v1.29.0 available", tone: "pending" });
    expect(updateBadge(update({ state: "manual", version: "1.29.0", error: "AppImage" }))).toEqual({ label: "v1.29.0 available", tone: "manual" });
    expect(updateBadge(update({ state: "uptodate" }))).toBeNull();
    expect(updateBadge(update({ state: "checking" }))).toBeNull();
    expect(updateBadge(update({ state: "error", error: "offline" }))).toBeNull();
    expect(updateBadge(update({ state: "manual", error: "AppImage" }))).toBeNull();
    expect(updateBadge(null)).toBeNull();
  });
});

describe("dataVersionLabel", () => {
  it("game version, content hash and build date", () => {
    const builtAt = "2026-10-30T08:28:46.894Z";
    expect(dataVersionLabel({ resVersion: "1.11.503", hash: "49a39d2e9dd6", builtAt }))
      .toBe(`game 1.11.503 · 49a39d2e9dd6 · built ${new Date(builtAt).toLocaleString()}`);
  });
  it("omits the game version on an older stamp, em-dash without one", () => {
    const builtAt = "2026-01-01T00:00:00.000Z";
    expect(dataVersionLabel({ hash: "h1", builtAt })).toBe(`h1 · built ${new Date(builtAt).toLocaleString()}`);
    expect(dataVersionLabel(null)).toBe("—");
  });
});

function header(status: SteamStatus | null, upd: HeaderUpdate | null = null) {
  return renderToStaticMarkup(createElement(GsHeader, {
    active: "Home", onTabChange: noop, onSetup: noop, version: "1.28.0", gameVersion: "1.11.503",
    counts: { Home: null, Heroes: null, Optimizer: null, Presets: null, Worklist: null, Gear: null },
    capture: { steam: { status, onInstall: noop, onLaunch: noop }, onReload: noop },
    update: upd, onOpenUpdate: noop,
  }));
}

describe("GsHeader", () => {
  it("shows one capture pill, no Steam · badge", () => {
    const html = header(steam({ ready: false }, { present: false, upToDate: false }));
    expect(html).not.toContain("Steam ·");
    expect(html.match(/Plugin needed/g)).toHaveLength(1);
    expect(html).toContain("Install plugin");
    expect(html).toContain("v1.28.0");
    expect(html).toContain("game 1.11.503");
  });

  it("shows the update badge only when one is given", () => {
    const ready = header(steam(), updateBadge(update({ state: "downloaded", version: "1.29.0" })));
    expect(ready).toContain("v1.29.0 ready");
    expect(ready).toContain("Open Settings › Data &amp; updates");
    expect(header(steam(), updateBadge(update({ state: "manual", version: "1.29.0" })))).toContain("v1.29.0 available");
    const none = header(steam(), updateBadge(update({ state: "uptodate" })));
    expect(none).not.toMatch(/v\d[\d.]* (ready|available)/);
    expect(none).not.toContain("Open Settings › Data &amp; updates");
  });
});

describe("Home › System health", () => {
  const render = (s: SteamStatus | null) => renderToStaticMarkup(createElement(SystemHealthCard, { steam: s, busy: false, onSyncData: noop, onOpenSetup: noop }));

  it("says the state in the pill's words and links to Setup instead of acting", () => {
    for (const s of [steam({ ready: false }, { present: false, upToDate: false }), steam(), steam({ gameRunning: true, live: true })]) {
      const html = render(s);
      expect(html).toContain(captureBadge(s).label);
      expect(html).toContain("Open Setup");
      expect(html).toContain("Sync game data");
      expect(html).not.toMatch(/Install plugin|Update plugin|Launch game|>Reload</);
    }
  });
});

describe("Home empty state", () => {
  it("points to the header button and Setup, no button of its own", () => {
    const html = renderToStaticMarkup(createElement(EmptyDashboard, { steam: steam({ ready: false }, { present: false, upToDate: false }), onOpenSetup: noop }));
    expect(html).toContain("top right");
    expect(html).toContain("Settings › Setup");
    expect(html).not.toMatch(/Install plugin|Launch game|Install the capture plugin|Launch OUTERPLANE/);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
