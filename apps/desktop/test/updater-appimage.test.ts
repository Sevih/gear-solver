import { afterAll, describe, expect, it, vi } from "vitest";

// A mock that keeps the listeners, so the test can play electron-updater's
// events through updater.ts.
const listeners = new Map<string, (arg?: unknown) => void>();
const autoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on(event: string, fn: (arg?: unknown) => void) { listeners.set(event, fn); return autoUpdater; },
  checkForUpdates: async () => null,
  quitAndInstall() {},
};
vi.mock("electron", () => ({ app: { getVersion: () => "1.20.0" } }));
vi.mock("electron-updater", () => ({ default: { autoUpdater }, autoUpdater }));

const { appImageUpdateBlocker, getStatus, installUpdate, setupAutoUpdate } = await import("../src/updater.js");

describe("appImageUpdateBlocker", () => {
  const writable = () => true;
  const readOnly = () => false;

  it("never blocks outside Linux", () => {
    expect(appImageUpdateBlocker("win32", {}, readOnly)).toBeNull();
  });

  it("blocks when the app wasn't started from the AppImage (no APPIMAGE env)", () => {
    expect(appImageUpdateBlocker("linux", {}, writable)).toMatch(/Not started from the AppImage/);
    expect(appImageUpdateBlocker("linux", { APPIMAGE: "relative.AppImage" }, writable)).toMatch(/Not started from the AppImage/);
  });

  it("blocks when the AppImage's folder can't be written (the updater swaps the file there)", () => {
    const seen: string[] = [];
    const blocker = appImageUpdateBlocker("linux", { APPIMAGE: "/mnt/ro/Gear.AppImage" }, (dir) => { seen.push(dir); return false; });
    expect(blocker).toMatch(/read-only/);
    expect(seen).toEqual(["/mnt/ro"]);
  });

  it("lets a writable AppImage update itself", () => {
    expect(appImageUpdateBlocker("linux", { APPIMAGE: "/home/me/Applications/Gear.AppImage" }, writable)).toBeNull();
  });
});

describe("setupAutoUpdate on a non-updatable AppImage", () => {
  const platform = process.platform;
  const appimage = process.env["APPIMAGE"];
  Object.defineProperty(process, "platform", { value: "linux" });
  delete process.env["APPIMAGE"];
  afterAll(() => {
    Object.defineProperty(process, "platform", { value: platform });
    if (appimage !== undefined) process.env["APPIMAGE"] = appimage;
  });

  it("shows the reason instead of a silent 'up to date', and doesn't download", () => {
    setupAutoUpdate(false);
    expect(autoUpdater.autoDownload).toBe(false);
    expect(getStatus()).toMatchObject({ state: "manual", version: null, error: expect.stringMatching(/Not started from the AppImage/) });
  });

  it("names a newer version but stays manual through the updater's events", () => {
    listeners.get("checking-for-update")?.();
    listeners.get("update-available")?.({ version: "1.21.0" });
    listeners.get("error")?.(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(getStatus()).toMatchObject({ state: "manual", version: "1.21.0" });
    expect(installUpdate()).toBe(false);
    listeners.get("update-not-available")?.();
    expect(getStatus()).toMatchObject({ state: "manual", version: null });
  });
});
