import { describe, expect, it, vi } from "vitest";
import type { CaptureStatus } from "../src/capture.js";
import type { SteamStatus } from "../src/steam.js";
import { createSnapshotFollower, type SnapshotFollowerDeps } from "../src/lib/snapshotFollower.js";

/** Deferred promise — lets a test decide which request answers first. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const live = { live: true, gameRunning: true } as SteamStatus;
const status = (mtime: number | null): CaptureStatus => ({ armed: false, captured: mtime != null, userItemMtime: mtime });

function harness(capture: () => Promise<CaptureStatus | null>, steam: () => Promise<SteamStatus | null> = async () => live) {
  const refresh = vi.fn(async (_label: string) => {});
  const deps: SnapshotFollowerDeps = {
    getCaptureStatus: capture,
    getSteamStatus: steam,
    refresh,
    onCaptureStatus: () => {},
    onSteamStatus: () => {},
  };
  return { follower: createSnapshotFollower(deps), refresh };
}

describe("snapshot follower — one import at launch", () => {
  it("the first Steam tick answering before init does not re-import", async () => {
    // init's status request is slow; the tick's is immediate.
    const slow = deferred<CaptureStatus | null>();
    let calls = 0;
    const { follower, refresh } = harness(() => (calls++ === 0 ? slow.promise : Promise.resolve(status(1000))));
    const init = follower.init();
    await follower.tick();          // App fires the first tick right away
    slow.resolve(status(1000));
    await init;
    await follower.tick();          // next 5 s tick, same snapshot
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import"]);
  });

  it("re-imports once when the plugin rewrites the snapshot", async () => {
    let mtime = 1000;
    const { follower, refresh } = harness(async () => status(mtime));
    await follower.init();
    await follower.tick();
    mtime = 2000;
    await follower.tick();
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import", "Steam capture"]);
  });

  it("imports the first snapshot written after a launch with none", async () => {
    let mtime: number | null = null;
    const { follower, refresh } = harness(async () => status(mtime));
    await follower.init();
    await follower.tick();
    mtime = 3000;
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import", "Steam capture"]);
  });

  it("a tick slower than the interval is not overlapped by the next one", async () => {
    let mtime = 1000;
    const slowSteam = deferred<SteamStatus | null>();
    let steamCalls = 0;
    const { follower, refresh } = harness(
      async () => status(mtime),
      () => (steamCalls++ === 0 ? slowSteam.promise : Promise.resolve(live)),
    );
    await follower.init();
    mtime = 2000;
    const first = follower.tick();
    await follower.tick();          // the interval fires while the first still waits
    slowSteam.resolve(live);
    await first;
    expect(steamCalls).toBe(1);
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import", "Steam capture"]);
  });
});
