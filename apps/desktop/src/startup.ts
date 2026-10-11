/**
 * Launch sequence of the Electron main process, kept free of Electron so it
 * can be tested: main.ts passes the real steps in.
 *
 * Prod opens the window FIRST and syncs game data in the background: the
 * REPO-mode sync is network-bound (GitHub API + CDN, 5–10 s timeouts each),
 * so offline with a slow DNS the user used to stare at nothing for up to
 * ~30 s. The renderer polls `GET /api/data/startup-sync` and re-imports when
 * the sync brought new data. Dev keeps the old order: its sync is a local
 * checkout copy (no network), and Vite — not the embedded server — answers
 * the renderer there, so it couldn't be told about a late sync anyway.
 */
import type { SyncResult } from "./data-sync.js";

export type StartupSyncPhase = "pending" | "done";

export interface StartupSyncState {
  phase: StartupSyncPhase;
  /** Null while pending, or when the sync itself failed unexpectedly. */
  result: SyncResult | null;
}

let state: StartupSyncState = { phase: "done", result: null };

/** What `GET /api/data/startup-sync` serves. */
export function getStartupSyncState(): StartupSyncState {
  return state;
}

export interface StartupSteps {
  isDev: boolean;
  /** Game-data sync. May reject; a rejection counts as "done, no result". */
  sync: () => Promise<SyncResult>;
  /** Runs once the sync settled (re-pin the data SHA, warm the image cache…). */
  afterSync: (r: SyncResult | null) => void;
  /** Create + load the window (prod: also starts the embedded server). */
  createWindow: () => Promise<void>;
  /** Runs once the window is up (auto-update…). */
  afterWindow: () => void;
}

/** Resolves when the window is up. In prod the sync may still be running —
 *  the returned `synced` promise settles with it. */
export async function runStartup(steps: StartupSteps): Promise<{ synced: Promise<void> }> {
  state = { phase: "pending", result: null };
  const synced = steps.sync()
    .then((r) => r, () => null)
    .then((r) => {
      state = { phase: "done", result: r };
      steps.afterSync(r);
    });
  if (steps.isDev) await synced;
  await steps.createWindow();
  steps.afterWindow();
  return { synced };
}
