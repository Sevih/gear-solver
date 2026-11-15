import { describe, expect, it, vi } from "vitest";
import type { CaptureStatus } from "../src/capture.js";
import type { SteamStatus } from "../src/steam.js";
import { createSnapshotFollower, keepIfSame, type SnapshotFollowerDeps } from "../src/lib/snapshotFollower.js";

/** Deferred promise — lets a test decide which request answers first. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const live = { live: true, gameRunning: true } as SteamStatus;
const status = (mtime: number | null, others: Partial<CaptureStatus["mtimes"]> = {}): CaptureStatus => ({
  captured: mtime != null,
  userItemMtime: mtime,
  mtimes: { user_item: mtime, user_character: null, user_gift: null, user_archive: null, ...others },
});

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

  it("re-imports when user_character alone changes", async () => {
    let char = 500;
    const { follower, refresh } = harness(async () => status(1000, { user_character: char, user_gift: 700 }));
    await follower.init();
    await follower.tick();
    char = 900;                     // hero level-up, no new inventory
    await follower.tick();
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import", "Steam capture"]);
  });

  it("does not re-import when nothing changes", async () => {
    const { follower, refresh } = harness(async () => status(1000, { user_character: 500, user_gift: 700, user_archive: 800 }));
    await follower.init();
    await follower.tick();
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import"]);
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

describe("snapshot follower — explicit imports", () => {
  it("an import after a write by the app (reseed first) is not followed by an identical re-import", async () => {
    let mtime = 1000;
    const { follower, refresh } = harness(async () => status(mtime));
    await follower.init();
    mtime = 2000;                   // the desktop rewrote user_item.json (Equip, Apply…)
    await follower.reseed();        // App's refreshInventory, before its own import
    await follower.tick();
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import"]);
  });

  it("a write after the reseed is still followed on the next tick", async () => {
    let mtime = 1000;
    const { follower, refresh } = harness(async () => status(mtime));
    await follower.init();
    await follower.reseed();
    mtime = 3000;                   // the plugin writes after the explicit import
    await follower.tick();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["Auto-import", "Steam capture"]);
  });

  it("the reseed reports the fresh capture status", async () => {
    const seen: (CaptureStatus | null)[] = [];
    const deps: SnapshotFollowerDeps = {
      getCaptureStatus: async () => status(4000),
      getSteamStatus: async () => live,
      refresh: async () => {},
      onCaptureStatus: (cs) => seen.push(cs),
      onSteamStatus: () => {},
    };
    await createSnapshotFollower(deps).reseed();
    expect(seen).toEqual([status(4000)]);
  });
});

describe("keepIfSame — a polled status without a re-render", () => {
  it("an equal status keeps the previous reference, a different one replaces it", () => {
    const a = { live: true, heartbeat: { captures: 3 } };
    expect(keepIfSame(a, { live: true, heartbeat: { captures: 3 } })).toBe(a);
    const b = { live: true, heartbeat: { captures: 4 } };
    expect(keepIfSame(a, b)).toBe(b);
    expect(keepIfSame<typeof a | null>(null, a)).toBe(a);
    expect(keepIfSame<typeof a | null>(a, null)).toBeNull();
  });

  it("through a React-style updater, an unchanged poll leaves the state untouched", () => {
    let state: SteamStatus | null = null;
    let renders = 0;
    const setState = (f: (prev: SteamStatus | null) => SteamStatus | null) => {
      const next = f(state);
      if (next !== state) { state = next; renders++; }
    };
    for (let i = 0; i < 5; i++) setState((prev) => keepIfSame(prev, { ...live }));
    expect(renders).toBe(1);
    setState((prev) => keepIfSame(prev, { ...live, live: false }));
    expect(renders).toBe(2);
  });
});
