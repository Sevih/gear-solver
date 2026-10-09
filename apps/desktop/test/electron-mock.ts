/**
 * Shared `electron` stand-in for main-process tests. paths.ts reads
 * `app.isPackaged` / `app.getPath("userData")` at import time, so the mock
 * must be registered (vi.mock) before the module under test is imported:
 *
 *   vi.mock("electron", () => electronMock(userDataDir));
 *
 * Packaged mode is used so every writable path lands under `userDataDir`
 * (a per-test temp dir) instead of the repo tree; the read-only bundled
 * trees (`process.resourcesPath`, unset outside Electron) go under
 * `<userDataDir>/resources`.
 */
export function electronMock(userDataDir: string) {
  (process as { resourcesPath?: string }).resourcesPath = `${userDataDir}/resources`;
  return {
    app: {
      isPackaged: true,
      getPath: () => userDataDir,
    },
  };
}

/** `electron-updater` stand-in — server.ts imports updater.ts, whose
 *  `autoUpdater` getter needs a real Electron app. Register alongside the
 *  electron mock in tests that import server.ts:
 *
 *   vi.mock("electron-updater", () => electronUpdaterMock());
 */
export function electronUpdaterMock() {
  const autoUpdater = { on() { return autoUpdater; }, checkForUpdates: async () => null, quitAndInstall() {} };
  return { default: { autoUpdater }, autoUpdater };
}
