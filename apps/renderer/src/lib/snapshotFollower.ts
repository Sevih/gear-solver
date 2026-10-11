/**
 * Startup import + Steam snapshot following, as ONE state machine.
 *
 * Before, App ran the initial auto-import, an initial `getCaptureStatus()`
 * (to seed the last-seen user_item.json mtime) and the Steam poll's first
 * tick in parallel. When the tick's status answered first, the mtime was
 * still unseeded and the tick re-imported — a second full import at launch.
 * A tick slower than the 5 s interval could also overlap the next one.
 *
 * Here `init()` is the only startup path (status → seed mtime → import),
 * ticks do nothing until it finished, and a tick never overlaps another.
 */
import type { CaptureStatus } from "../capture.js";
import type { SteamStatus } from "../steam.js";

export interface SnapshotFollowerDeps {
  getCaptureStatus: () => Promise<CaptureStatus | null>;
  getSteamStatus: () => Promise<SteamStatus | null>;
  /** Full re-import (game data + captured account). */
  refresh: (label: string) => Promise<void>;
  onCaptureStatus: (cs: CaptureStatus | null) => void;
  onSteamStatus: (st: SteamStatus | null) => void;
}

export interface SnapshotFollower {
  /** Startup: read the capture status, seed the mtime, import once.
   *  Repeated calls return the first run. */
  init(): Promise<void>;
  /** One Steam poll: refresh the plugin status and re-import if the plugin
   *  rewrote user_item.json. No-op before init() completes or while another
   *  tick runs. `isAlive` lets the caller drop results after unmount. */
  tick(isAlive?: () => boolean): Promise<void>;
}

export function createSnapshotFollower(deps: SnapshotFollowerDeps): SnapshotFollower {
  // undefined = not seeded yet (init pending); null = no snapshot on disk.
  let lastMtime: number | null | undefined;
  let ticking = false;
  let started: Promise<void> | null = null;

  return {
    init() {
      // Idempotent: StrictMode runs mount effects twice in dev.
      started ??= (async () => {
        const cs = await deps.getCaptureStatus();
        deps.onCaptureStatus(cs);
        lastMtime = cs?.userItemMtime ?? null;
        await deps.refresh("Auto-import");
      })();
      return started;
    },

    async tick(isAlive = () => true) {
      if (lastMtime === undefined || ticking) return;
      ticking = true;
      try {
        const st = await deps.getSteamStatus();
        if (!isAlive()) return;
        deps.onSteamStatus(st);
        if (!st?.live && !st?.gameRunning) return;
        const cs = await deps.getCaptureStatus();
        if (!isAlive()) return;
        deps.onCaptureStatus(cs);
        const m = cs?.userItemMtime ?? null;
        if (m != null && m !== lastMtime) {
          lastMtime = m;
          await deps.refresh("Steam capture");
        }
      } finally {
        ticking = false;
      }
    },
  };
}
