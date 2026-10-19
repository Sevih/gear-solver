/**
 * Startup import + Steam snapshot following, as ONE state machine.
 *
 * Before, App ran the initial auto-import, an initial `getCaptureStatus()`
 * (to seed the last-seen user_item.json mtime) and the Steam poll's first
 * tick in parallel. When the tick's status answered first, the mtime was
 * still unseeded and the tick re-imported — a second full import at launch.
 * A tick slower than the 5 s interval could also overlap the next one.
 *
 * Here `init()` is the only startup path (status → seed mtimes → import),
 * ticks do nothing until it finished, and a tick never overlaps another.
 *
 * The follower watches the mtimes of every file the import reads
 * (user_item, user_character, user_gift, user_archive): a hero or geas level
 * gained without a new inventory must be picked up too.
 */
import type { CaptureStatus, ImportedSnapshot } from "../capture.js";
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
   *  rewrote any imported snapshot. No-op before init() completes or while another
   *  tick runs. `isAlive` lets the caller drop results after unmount. */
  tick(isAlive?: () => boolean): Promise<void>;
}

const WATCHED: readonly ImportedSnapshot[] = ["user_item", "user_character", "user_gift", "user_archive"];

/** One comparable key for the watched mtimes; null = no user_item.json on
 *  disk (the import has no inventory to load, nothing to follow yet). */
function snapshotKey(cs: CaptureStatus | null): string | null {
  if (cs?.userItemMtime == null) return null;
  return WATCHED.map((n) => cs.mtimes[n] ?? "-").join("|");
}

export function createSnapshotFollower(deps: SnapshotFollowerDeps): SnapshotFollower {
  // undefined = not seeded yet (init pending); null = no snapshot on disk.
  let lastKey: string | null | undefined;
  let ticking = false;
  let started: Promise<void> | null = null;

  return {
    init() {
      // Idempotent: StrictMode runs mount effects twice in dev.
      started ??= (async () => {
        const cs = await deps.getCaptureStatus();
        deps.onCaptureStatus(cs);
        lastKey = snapshotKey(cs);
        await deps.refresh("Auto-import");
      })();
      return started;
    },

    async tick(isAlive = () => true) {
      if (lastKey === undefined || ticking) return;
      ticking = true;
      try {
        const st = await deps.getSteamStatus();
        if (!isAlive()) return;
        deps.onSteamStatus(st);
        if (!st?.live && !st?.gameRunning) return;
        const cs = await deps.getCaptureStatus();
        if (!isAlive()) return;
        deps.onCaptureStatus(cs);
        const key = snapshotKey(cs);
        if (key != null && key !== lastKey) {
          lastKey = key;
          await deps.refresh("Steam capture");
        }
      } finally {
        ticking = false;
      }
    },
  };
}
