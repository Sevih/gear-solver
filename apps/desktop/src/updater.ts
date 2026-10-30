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
import { accessSync, constants } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { app } from "electron";
import electronUpdaterPkg from "electron-updater";
import { dlog, dwarn } from "./log.js";
import { getCurrentRef } from "./repo-source.js";

// electron-updater ships CommonJS; the default export carries the singleton.
const { autoUpdater } = electronUpdaterPkg;

/** Lifecycle the Home update card renders. Mirrors the design's state machine:
 *  uptodate · checking · downloading (with %) · downloaded (→ Install) · error,
 *  plus manual: this build can't replace itself (Linux, see
 *  appImageUpdateBlocker) — the card says why, and names a newer version if
 *  the check found one. */
export type UpdatePhase = "uptodate" | "checking" | "downloading" | "downloaded" | "error" | "manual";

interface UpdateState {
  phase: UpdatePhase;
  /** The NEW available version (e.g. "0.6.0"). Null when up to date. */
  version: string | null;
  /** Download progress 0..100 while `phase === "downloading"`. */
  progress: number;
  /** Last error message (offline / GH down) when `phase === "error"`, or why
   *  the update has to be done by hand when `phase === "manual"`. */
  error: string | null;
}

const state: UpdateState = { phase: "uptodate", version: null, progress: 0, error: null };

// Guards: only wire listeners once, and only allow check/install when the
// updater is actually live (packaged build). In dev we leave `configured`
// false so the manual triggers are inert and the card shows a static state.
let configured = false;
// Set when this build can't install an update itself (see
// appImageUpdateBlocker): the state then stays "manual" whatever the updater says.
let blocker: string | null = null;

/** Why electron-updater couldn't replace this build, or null when it can.
 *  Only the AppImage has a precondition: its updater swaps the file named by
 *  the APPIMAGE env (set by the AppImage runtime) — it unlinks it then moves
 *  the new one next to it, so the folder must be writable. Without APPIMAGE
 *  (an extracted AppImage, `electron .`) the check is skipped without any
 *  event; on a read-only folder the install fails after a full download.
 *  Both would leave the card on a silent "Up to date" or a misleading
 *  "Offline?" — this names the cause instead. `canWrite` is injected for tests. */
export function appImageUpdateBlocker(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  canWrite: (dir: string) => boolean = (dir) => { try { accessSync(dir, constants.W_OK); return true; } catch { return false; } },
): string | null {
  if (platform !== "linux") return null;
  const file = env["APPIMAGE"];
  if (!file || !isAbsolute(file)) return "Not started from the AppImage file — download new versions from GitHub";
  if (!canWrite(dirname(file))) return "AppImage folder is read-only — move the file to a writable folder";
  return null;
}

/** Wire electron-updater → `state`. Auto-downloads on launch; never prompts.
 *  No-op in dev (there's no installed app to update) — the card then renders a
 *  benign "up to date" using the dev version. */
export function setupAutoUpdate(isDev: boolean): void {
  if (isDev || configured) return;
  configured = true;
  blocker = appImageUpdateBlocker(process.platform, process.env);
  if (blocker) {
    // Still check, so the card can name a newer version, but don't download
    // a file that couldn't be installed.
    state.phase = "manual"; state.error = blocker;
    dwarn("server", `auto-update disabled: ${blocker} (APPIMAGE=${process.env["APPIMAGE"] ?? "unset"})`);
  }
  autoUpdater.autoDownload = !blocker; // fetch in the background, no native dialog
  autoUpdater.autoInstallOnAppQuit = false; // install is user-driven (Home button)

  autoUpdater.on("checking-for-update", () => { if (blocker) return; state.phase = "checking"; state.error = null; });
  autoUpdater.on("update-available", (info) => {
    if (blocker) { state.version = info.version; dlog("server", `update available: ${info.version} — manual install`); return; }
    // With autoDownload on, the fetch starts immediately — go straight to the
    // downloading phase so the card shows progress rather than a dead beat.
    state.phase = "downloading"; state.version = info.version; state.progress = 0;
    dlog("server", `update available: ${info.version} — downloading`);
  });
  autoUpdater.on("update-not-available", () => { if (blocker) { state.version = null; return; } state.phase = "uptodate"; state.version = null; state.progress = 0; });
  autoUpdater.on("download-progress", (p) => { state.phase = "downloading"; state.progress = Math.min(100, Math.round(p.percent)); });
  autoUpdater.on("update-downloaded", (info) => {
    state.phase = "downloaded"; state.version = info.version; state.progress = 100;
    dlog("server", `update downloaded: ${info.version} — ready to install`);
  });
  autoUpdater.on("error", (err) => {
    dwarn("server", "auto-update error:", err.message);
    if (blocker) return; // the manual card already says what to do
    // Never block launch on a failed check (offline, GH down). Surface it as a
    // calm "offline?" card the user can retry.
    state.phase = "error"; state.error = err.message;
  });

  // electron-updater emits 'error' AND rejects the promise on a failed check;
  // the rejection is caught here so it never surfaces as an unhandled one.
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    dwarn("server", "auto-update check failed:", message);
    if (blocker) return;
    state.phase = "error";
    state.error = message;
  });
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
  if (!blocker) {
    state.phase = "checking";
    state.error = null;
  }
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    if (blocker) return;
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
