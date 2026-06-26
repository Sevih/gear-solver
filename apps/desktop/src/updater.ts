/**
 * Auto-update controller — single source of truth for the app-update state
 * the Home tab surfaces.
 *
 * Old flow: two blocking native dialogs ("Download?" then "Restart?") fired
 * mid-launch. New flow: on startup we silently check GitHub releases for
 * `Sevih/gear-solver`, auto-download any newer build in the background, and
 * expose the live state here. The renderer's Home tab polls `getStatus()`
 * (via `GET /api/update/status` in server.ts) and renders the inline update
 * card; the only user action is the "Install new version" button, which calls
 * `installUpdate()` (→ `quitAndInstall`). No native popups.
 *
 * State lives at module scope so both main.ts (which wires the listeners) and
 * server.ts (which serves the HTTP routes) read/drive the same object without
 * a circular import.
 */
import { app } from "electron";
import electronUpdaterPkg from "electron-updater";
import { dlog, dwarn } from "./log.js";
import { getCurrentRef } from "./repo-source.js";

// electron-updater ships CommonJS; the default export carries the singleton.
const { autoUpdater } = electronUpdaterPkg;

/** Lifecycle the Home update card renders. Mirrors the design's state machine:
 *  uptodate · checking · downloading (with %) · downloaded (→ Install) · error. */
export type UpdatePhase = "uptodate" | "checking" | "downloading" | "downloaded" | "error";

interface UpdateState {
  phase: UpdatePhase;
  /** The NEW available version (e.g. "0.6.0"). Null when up to date. */
  version: string | null;
  /** Download progress 0..100 while `phase === "downloading"`. */
  progress: number;
  /** Last error message (offline / GH down) when `phase === "error"`. */
  error: string | null;
}

const state: UpdateState = { phase: "uptodate", version: null, progress: 0, error: null };

// Guards: only wire listeners once, and only allow check/install when the
// updater is actually live (packaged build). In dev we leave `configured`
// false so the manual triggers are inert and the card shows a static state.
let configured = false;

/** Wire electron-updater → `state`. Auto-downloads on launch; never prompts.
 *  No-op in dev (there's no installed app to update) — the card then renders a
 *  benign "up to date" using the dev version. */
export function setupAutoUpdate(isDev: boolean): void {
  if (isDev || configured) return;
  configured = true;
  autoUpdater.autoDownload = true; // fetch in the background, no native dialog
  autoUpdater.autoInstallOnAppQuit = false; // install is user-driven (Home button)

  autoUpdater.on("checking-for-update", () => { state.phase = "checking"; state.error = null; });
  autoUpdater.on("update-available", (info) => {
    // With autoDownload on, the fetch starts immediately — go straight to the
    // downloading phase so the card shows progress rather than a dead beat.
    state.phase = "downloading"; state.version = info.version; state.progress = 0;
    dlog("server", `update available: ${info.version} — downloading`);
  });
  autoUpdater.on("update-not-available", () => { state.phase = "uptodate"; state.version = null; state.progress = 0; });
  autoUpdater.on("download-progress", (p) => { state.phase = "downloading"; state.progress = Math.min(100, Math.round(p.percent)); });
  autoUpdater.on("update-downloaded", (info) => {
    state.phase = "downloaded"; state.version = info.version; state.progress = 100;
    dlog("server", `update downloaded: ${info.version} — ready to install`);
  });
  autoUpdater.on("error", (err) => {
    // Never block launch on a failed check (offline, GH down). Surface it as a
    // calm "offline?" card the user can retry.
    state.phase = "error"; state.error = err.message;
    dwarn("server", "auto-update error:", err.message);
  });

  // Fire-and-forget — rejection is already handled by the 'error' event.
  void autoUpdater.checkForUpdates();
}

/** The full status payload the Home tab consumes. Always includes the running
 *  app version + the short game-data SHA so the user knows what they're on,
 *  regardless of update phase. */
export function getStatus() {
  const ref = getCurrentRef();
  return {
    state: state.phase,
    version: state.version,
    progress: state.progress,
    error: state.error,
    appVersion: app.getVersion(),
    dataSha: ref && ref !== "main" ? ref.slice(0, 7) : null,
  };
}

/** Manual "Check again" / "Retry" from the Home card. Inert in dev. */
export function triggerCheck(): void {
  if (!configured) return;
  state.phase = "checking";
  state.error = null;
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    state.phase = "error";
    state.error = err instanceof Error ? err.message : String(err);
  });
}

/** "Install new version" — quit and apply the downloaded update (relaunches).
 *  Returns false if nothing is downloaded yet so the route can 409. The actual
 *  quit is deferred a tick so the HTTP response flushes first. */
export function installUpdate(): boolean {
  if (state.phase !== "downloaded") return false;
  dlog("server", "installing update — quitAndInstall");
  // isSilent=false (show the installer), isForceRunAfter=true (relaunch after).
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
