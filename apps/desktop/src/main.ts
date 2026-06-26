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
 *   `/api/capture/*`, `/gamedata/*`, `/captured/*`, `/img/*` (disk cache +
 *   GitHub CDN), plus serving the built `apps/renderer/dist`. The window is
 *   then loaded against that local server's ephemeral 127.0.0.1 port.
 */
import { app, BrowserWindow, dialog } from "electron";
import type { Server } from "node:http";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disarmIfArmed, startServer } from "./server.js";
import { setupAutoUpdate } from "./updater.js";
import { dlog, dwarn } from "./log.js";
import { syncGameData } from "./data-sync.js";
import { BUNDLED_DERIVED, CACHE_ROOT, DERIVED, GAME_DIR, IMG_CACHE_DIR, REPO_SHA_STATE, REPO_ROOT, SYNC_DIR } from "./paths.js";
import { getCurrentRef, listRepoTree, readShaState, setCurrentRef } from "./repo-source.js";
import { prefetchImages } from "./img-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const IS_DEV = !app.isPackaged;
const DEV_URL = process.env.GEAR_SOLVER_DEV_URL ?? "http://localhost:5173";

let httpServer: Server | null = null;

/** Warm the disk image cache with the high-traffic UI + equipment subset (webp
 *  only) for the current repo SHA. Runs at most once per SHA (guarded by a
 *  marker file), in the background, and is fully best-effort. Character art is
 *  intentionally left on-demand. */
async function warmImageCache(): Promise<void> {
  const ref = getCurrentRef();
  if (ref === "main") return; // SHA unresolved — on-demand fetching still works
  const marker = join(CACHE_ROOT, "prefetch.json");
  try {
    if (existsSync(marker) && (JSON.parse(readFileSync(marker, "utf-8")) as { sha?: string }).sha === ref) return;
  } catch { /* corrupt marker → re-prefetch */ }
  const tree = await listRepoTree(ref);
  if (!tree) return;
  const rels = tree
    .filter((p) => (p.startsWith("public/images/ui/") || p.startsWith("public/images/equipment/")) && p.endsWith(".webp"))
    .map((p) => p.slice("public/images/".length));
  if (!rels.length) return;
  const n = await prefetchImages(IMG_CACHE_DIR, ref, rels, 6);
  try { writeFileSync(marker, JSON.stringify({ sha: ref, count: n, of: rels.length })); } catch { /* best-effort */ }
  dlog("server", `image prefetch: ${n}/${rels.length} cached @ ${ref.slice(0, 7)}`);
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
    dlog("server", `app ready — ${IS_DEV ? "dev (Vite)" : "prod (embedded server)"}`);
    // Prod first-launch seed: copy the bundled derived tree into the writable
    // cache so the renderer has working data before any network round-trip.
    if (!IS_DEV && !existsSync(join(DERIVED, "characters.json")) && existsSync(BUNDLED_DERIVED)) {
      try { cpSync(BUNDLED_DERIVED, DERIVED, { recursive: true }); dlog("server", "seeded derived from bundle"); }
      catch (err) { dwarn("server", "derived seed failed:", err instanceof Error ? err.message : String(err)); }
    }
    // Pin image fetches to the last-synced SHA before serving anything.
    setCurrentRef(readShaState(REPO_SHA_STATE)?.sha ?? "main");
    // Refresh game data: checkout mode (dev) or SHA-gated CDN download (prod).
    // Awaited before the window so the renderer loads fresh derived; never fatal.
    const r = await syncGameData({
      repoRoot: IS_DEV ? REPO_ROOT : process.resourcesPath,
      gameDir: GAME_DIR, syncDir: SYNC_DIR, derivedDir: DERIVED,
      shaStateFile: REPO_SHA_STATE, force: false,
    }).catch((err: unknown) => { dwarn("server", "data sync failed:", err instanceof Error ? err.message : String(err)); return null; });
    if (r) dlog("server", `data sync: ${r.status} — ${r.message}`);
    // Re-pin to the SHA we just built from so icons match the data snapshot.
    setCurrentRef(readShaState(REPO_SHA_STATE)?.sha ?? getCurrentRef());
    await createWindow();
    setupAutoUpdate(IS_DEV);
    // Background: warm the small UI/equipment image subset once per repo update
    // (prod only — dev serves from the checkout). Non-blocking, best-effort.
    if (!IS_DEV) void warmImageCache();
  }).catch((err: unknown) => {
    // Without this, a failed startServer() bind or loadURL() rejects
    // unhandled and the user is left staring at a blank window with no clue.
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox("Outerpedia Gear Solver — startup failed", msg);
    app.quit();
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
  dlog("capture", "before-quit: disarming pipeline + closing server");
  // Safety net: never let a hung disarm wedge the quit. If teardown hasn't
  // finished within the cap, force-exit (disarm.ps1 is itself bounded at 15 s).
  const force = setTimeout(() => app.exit(0), 16_000);
  disarmIfArmed()
    .catch(() => {})
    .finally(() => {
      clearTimeout(force);
      if (httpServer) { httpServer.close(); httpServer = null; }
      app.quit();
    });
});
