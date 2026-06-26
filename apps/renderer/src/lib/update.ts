/**
 * Client for the auto-update endpoints (`/api/update/*`) served by the
 * Electron main process (apps/desktop/src/updater.ts) — and mirrored as a
 * static "up to date" payload by the Vite dev middleware so the Home tab
 * renders the update card identically under `npm run dev`.
 *
 * The Home tab polls `getUpdateStatus()` on an interval and renders the inline
 * update card. `checkForUpdate()` backs the "Check again" / "Retry" buttons;
 * `installUpdate()` backs "Install new version" (the main process then quits
 * and applies the downloaded build).
 */

/** Update lifecycle phase — matches the design's state machine. */
export type UpdatePhase = "uptodate" | "checking" | "downloading" | "downloaded" | "error";

export interface UpdateStatus {
  state: UpdatePhase;
  /** The NEW available version, null when up to date. */
  version: string | null;
  /** Download progress 0..100 while `state === "downloading"`. */
  progress: number;
  error: string | null;
  /** Running app version (e.g. "0.5.0"). */
  appVersion: string;
  /** Short game-data SHA, or null when unresolved ("main"). */
  dataSha: string | null;
}

export async function getUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const r = await fetch("/api/update/status");
    if (!r.ok) return null;
    return (await r.json()) as UpdateStatus;
  } catch {
    return null;
  }
}

/** Re-trigger a check (also re-arms the auto-download). Fire-and-forget — the
 *  next status poll reflects the new phase. */
export async function checkForUpdate(): Promise<void> {
  try { await fetch("/api/update/check", { method: "POST" }); } catch { /* offline — poll surfaces it */ }
}

/** Apply the downloaded update — the main process quits and relaunches, so
 *  this request typically never resolves (the app is torn down mid-flight). */
export async function installUpdate(): Promise<void> {
  try { await fetch("/api/update/install", { method: "POST" }); } catch { /* app is quitting */ }
}
