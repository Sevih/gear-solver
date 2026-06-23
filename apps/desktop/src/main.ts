/**
 * Electron main process — gear-solver desktop shell.
 *
 * Dev (`npm run desktop:dev`):
 *   The Vite dev server on :5173 already hosts the renderer + `/api/capture/*`
 *   middleware, so we just point the window at it and get free HMR.
 *
 * Prod (packaged build):
 *   Vite is no longer running, so we boot an in-process HTTP server
 *   (see server.ts) that mirrors every endpoint the renderer expects —
 *   `/api/capture/*`, `/gamedata/*`, `/captured/*`, `/img/*` (redirected to
 *   outerpedia.com), plus serving the built `apps/web/dist`. The window is
 *   then loaded against that local server's ephemeral 127.0.0.1 port.
 */
import { app, BrowserWindow, dialog } from "electron";
import electronUpdaterPkg from "electron-updater";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disarmIfArmed, startServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// electron-updater ships a CommonJS bundle; the ESM-friendly default
// export gives us the `autoUpdater` singleton we want.
const { autoUpdater } = electronUpdaterPkg;

const IS_DEV = !app.isPackaged;
const DEV_URL = process.env.GEAR_SOLVER_DEV_URL ?? "http://localhost:5173";

let httpServer: Server | null = null;

/** Auto-update flow — checks GitHub releases for `Sevih/gear-solver` on
 *  startup, prompts the user when a newer version is available, downloads
 *  in the background, then offers to restart. Disabled in dev (no installed
 *  app to update) and silently a no-op when offline / GH down. */
function setupAutoUpdate(): void {
  if (IS_DEV) return;
  autoUpdater.autoDownload = false; // we trigger download after user consent
  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox({
      type: "info",
      title: "Update available",
      message: `Outerpedia Gear Solver ${info.version} is available. Download now?`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then((r) => { if (r.response === 0) void autoUpdater.downloadUpdate(); });
  });
  autoUpdater.on("update-downloaded", (info) => {
    dialog.showMessageBox({
      type: "info",
      title: "Update ready",
      message: `Version ${info.version} downloaded. Restart now to install?`,
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on("error", (err) => {
    // Don't block app launch on update check failures (offline, GH down, …).
    console.warn("auto-update error:", err.message);
  });
  // Fire-and-forget — promise rejection already handled by the 'error' event.
  void autoUpdater.checkForUpdates();
}

async function createWindow(): Promise<void> {
  // In dev `electron.exe` runs unbranded — pass the bundled icon explicitly so
  // the window title bar + taskbar entry at least show the right artwork
  // (electron.exe itself stays default; only the packaged build can swap that).
  // In prod the .exe metadata already carries the icon via electron-builder.
  const iconPath = join(__dirname, "..", "build", "icon.ico");
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (IS_DEV) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const { port, server } = await startServer();
    httpServer = server;
    await win.loadURL(`http://127.0.0.1:${port}/`);
  }
}

// Single-instance lock — second launch focuses the existing window and
// exits, so two instances never race for the fixed HTTP port (and the user
// never wonders why "the new launch is empty"). The first instance owns
// the lock; the second falls through to app.quit() immediately.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    await createWindow();
    setupAutoUpdate();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

// On quit: first disarm the capture pipeline if it's still armed (otherwise
// mitmdump.exe survives the Electron process and we can't even rebuild — the
// bundled exe stays locked), then close the embedded HTTP server. The first
// before-quit pass calls preventDefault to keep the app alive long enough to
// finish disarm; once that's done we set `cleaningUp` and re-fire app.quit()
// which lets the second pass through.
let cleaningUp = false;
app.on("before-quit", (event) => {
  if (cleaningUp) return;
  event.preventDefault();
  cleaningUp = true;
  disarmIfArmed()
    .catch(() => {})
    .finally(() => {
      if (httpServer) { httpServer.close(); httpServer = null; }
      app.quit();
    });
});
