/**
 * Client for `GET /api/data/startup-sync`. The packaged app opens its window
 * before the launch-time game-data sync finishes (apps/desktop/src/startup.ts);
 * this waits for that sync so App can re-import when it brought new data.
 */

export interface StartupSyncResult {
  status: "synced" | "fresh" | "offline" | "unavailable" | "error";
  message: string;
}

interface StartupSyncState {
  phase: "pending" | "done";
  result: StartupSyncResult | null;
}

export interface WaitOptions {
  intervalMs?: number;
  /** Give up after this many polls (the sync's own timeouts are ~30 s). */
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Poll until the startup sync settled; its result, or null when there is
 *  none to act on (no endpoint, sync failed, gave up). Never throws. */
export async function waitForStartupSync(opts: WaitOptions = {}): Promise<StartupSyncResult | null> {
  const { intervalMs = 1000, maxPolls = 90, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let i = 0; i < maxPolls; i++) {
    try {
      const r = await fetch("/api/data/startup-sync");
      if (!r.ok) return null;
      const s = (await r.json()) as StartupSyncState;
      if (s.phase !== "pending") return s.result ?? null;
    } catch {
      return null;
    }
    await sleep(intervalMs);
  }
  return null;
}
