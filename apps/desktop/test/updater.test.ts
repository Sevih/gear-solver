import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { electronUpdaterMock } from "./electron-mock.js";

// On Linux the updater only runs from an AppImage in a writable folder (else
// the card goes "manual", see updater-appimage.test.ts): stand for one.
process.env["APPIMAGE"] = join(tmpdir(), "Gear.AppImage");

// updater.ts reads `app.getVersion()` in getStatus(); the check rejects the
// way electron-updater does on a failed launch check (offline, GitHub down).
vi.mock("electron", () => ({ app: { getVersion: () => "0.0.0" } }));
vi.mock("electron-updater", () => electronUpdaterMock(() => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"))));

describe("setupAutoUpdate — failed launch check", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  afterEach(() => { process.off("unhandledRejection", onUnhandled); });

  it("catches the rejected checkForUpdates and reports the error state", async () => {
    process.on("unhandledRejection", onUnhandled);
    const { setupAutoUpdate, getStatus } = await import("../src/updater.js");
    setupAutoUpdate(false);
    // Let the rejection settle and Node's unhandled-rejection pass run.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(unhandled).toEqual([]);
    const status = getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toBe("net::ERR_INTERNET_DISCONNECTED");
  });
});
