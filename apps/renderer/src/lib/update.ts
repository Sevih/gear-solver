/**
 * Client for the auto-update endpoints (`/api/update/*`) served by the
 * Electron main process (apps/desktop/src/updater.ts) — and mirrored as a
 * static "up to date" payload by the Vite dev middleware so Settings › Data &
 * updates renders the update card identically under `npm run dev`.
 *
 * App polls `getUpdateStatus()` on an interval (hooks/useAppUpdate.ts, whatever
 * the tab): the header shows `updateBadge()` (a click opens Settings › Data &
 * updates) and that pane renders the update card. `checkForUpdate()` backs
 * the "Check again" / "Retry" buttons; `installUpdate()` backs "Install new
 * version" (the main process then quits and applies the downloaded build).
 */

/** Update lifecycle phase — matches the design's state machine, plus "manual"
 *  (an AppImage that can't replace itself: `error` says why). */
export type UpdatePhase = "uptodate" | "checking" | "downloading" | "downloaded" | "error" | "manual";

export interface UpdateStatus {
  state: UpdatePhase;
  /** The NEW available version, null when up to date. */
  version: string | null;
  /** Download progress 0..100 while `state === "downloading"`. */
  progress: number;
  /** Failed check message ("error"), or why the update is by hand ("manual"). */
  error: string | null;
  /** Running app version (e.g. "0.5.0"). */
  appVersion: string;
  /** Short SHA of the outerpedia commit the data came from, or null when
   *  unresolved ("main"). Not shown: Settings › Data & updates says the data version. */
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

/** Header badge for a pending update: "vX ready" once downloaded, "vX
 *  available" while it downloads or when it must be installed by hand. Null
 *  when up to date, checking, offline, or with no known new version. */
export function updateBadge(s: UpdateStatus | null): { label: string; tone: "ready" | "pending" | "manual" } | null {
  if (!s?.version) return null;
  if (s.state === "downloaded") return { label: `v${s.version} ready`, tone: "ready" };
  if (s.state === "downloading") return { label: `v${s.version} available`, tone: "pending" };
  if (s.state === "manual") return { label: `v${s.version} available`, tone: "manual" };
  return null;
}
