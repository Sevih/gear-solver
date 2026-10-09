/**
 * Client for `POST /api/data/sync` (Vite middleware in dev, the Electron
 * server in prod) — the ONE path behind every "Sync game data" button (Home
 * quick action and Settings → Data). The caller re-imports on "synced"; no
 * window reload, which would kill a solve running in the Builder.
 */

export type DataSyncStatus = "synced" | "fresh" | "offline" | "unavailable" | "error";

export interface DataSyncResult {
  status: DataSyncStatus;
  message: string;
}

const STATUSES: ReadonlySet<string> = new Set<DataSyncStatus>(["synced", "fresh", "offline", "unavailable", "error"]);

/** Ask the backend to sync. Never throws: an HTTP error, a non-JSON body or
 *  a network failure all come back as `status: "error"`. */
export async function requestDataSync(): Promise<DataSyncResult> {
  let r: Response;
  try {
    r = await fetch("/api/data/sync", { method: "POST" });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const j = (await r.json().catch(() => null)) as { status?: unknown; message?: unknown } | null;
  const message = typeof j?.message === "string" ? j.message : null;
  if (!r.ok) return { status: "error", message: message ?? `HTTP ${r.status}` };
  if (!j || typeof j.status !== "string" || !STATUSES.has(j.status)) {
    return { status: "error", message: "unexpected response from the sync endpoint" };
  }
  return { status: j.status as DataSyncStatus, message: message ?? "" };
}

/** One-line user-facing summary of a sync result. */
export function describeDataSync(r: DataSyncResult): string {
  switch (r.status) {
    case "synced": return `Game data synced — ${r.message}.`;
    case "fresh": return "Game data is already up to date.";
    case "offline": return `Game data: ${r.message}.`;
    case "unavailable": return `Game data sync unavailable — ${r.message}.`;
    case "error": return `Game data sync failed — ${r.message}.`;
  }
}
