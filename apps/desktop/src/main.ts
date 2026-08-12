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
import { BUNDLED_DERIVED, CACHE_ROOT, DERIVED, IMG_CACHE_DIR, REPO_SHA_STATE } from "./paths.js";
import { getCurrentRef, readShaState, setCurrentRef } from "./repo-source.js";
import { prefetchImages } from "./img-cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const IS_DEV = !app.isPackaged;
const DEV_URL = process.env.GEAR_SOLVER_DEV_URL ?? "http://localhost:5173";

let httpServer: Server | null = null;

/** Warm the disk image cache with the equipment-icon subset the freshly-synced
 *  derived data references (item art + unique-option / set badges + gem
 *  sprites). Runs at most once per derived-data hash (guarded by a marker
 *  file), in the background, and is fully best-effort. Character art is
 *  intentionally left on-demand. */
async function warmImageCache(): Promise<void> {
  let hash: string | null = null;
  const rels = new Set<string>();
  try {
    hash = (JSON.parse(readFileSync(join(DERIVED, "version.json"), "utf-8")) as { hash?: string }).hash ?? null;
    const equipment = JSON.parse(readFileSync(join(DERIVED, "equipment.json"), "utf-8")) as
      Record<string, { image?: string | null; effectIcon?: string | null; armorSetIcon?: string | null }>;
    for (const e of Object.values(equipment)) {
      if (e.image) rels.add(`equipment/${e.image}.webp`);
      if (e.effectIcon) rels.add(`equipment/${e.effectIcon}.webp`);
      if (e.armorSetIcon) rels.add(`equipment/${e.armorSetIcon}.webp`);
    }
    const gems = JSON.parse(readFileSync(join(DERIVED, "gems.json"), "utf-8")) as
      Record<string, { type?: string; level?: number }>;
    for (const g of Object.values(gems)) {
      if (g.type && g.level) rels.add(`items/TI_GEM_${g.type}_${g.level}.webp`);
    }
  } catch { return; } // no derived yet — on-demand fetching still works
  if (!hash || rels.size === 0) return;
  const marker = join(CACHE_ROOT, "prefetch.json");
  try {
    if (existsSync(marker) && (JSON.parse(readFileSync(marker, "utf-8")) as { hash?: string }).hash === hash) return;
  } catch { /* corrupt marker → re-prefetch */ }
  const n = await prefetchImages(IMG_CACHE_DIR, [...rels], 6);
  try { writeFileSync(marker, JSON.stringify({ hash, count: n, of: rels.size })); } catch { /* best-effort */ }
  dlog("server", `image prefetch: ${n}/${rels.size} cached @ data ${hash}`);
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
    // Seed the data-SHA display from the last sync before serving anything.
    setCurrentRef(readShaState(REPO_SHA_STATE)?.sha ?? "main");
    // Refresh game data: checkout copy (dev) or SHA-gated CDN download (prod).
    // Awaited before the window so the renderer loads fresh derived; never fatal.
    const r = await syncGameData({ derivedDir: DERIVED, shaStateFile: REPO_SHA_STATE, force: false })
      .catch((err: unknown) => { dwarn("server", "data sync failed:", err instanceof Error ? err.message : String(err)); return null; });
    if (r) dlog("server", `data sync: ${r.status} — ${r.message}`);
    // Re-pin to the SHA we just synced so Settings → Data shows the snapshot.
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
// mitmdump.exe survives the Electron process — the provisioned exe under
// userData stays locked, blocking a later version re-provision), then close
// the embedded HTTP server. The first
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
