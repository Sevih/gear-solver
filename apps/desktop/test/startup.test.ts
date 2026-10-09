import { describe, expect, it, vi } from "vitest";
import type { SyncResult } from "../src/data-sync.js";
import { getStartupSyncState, runStartup } from "../src/startup.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const synced: SyncResult = { status: "synced", message: "synced 19 tables @ abc1234", copied: 19 };

describe("runStartup", () => {
  it("prod opens the window while the network sync is still pending", async () => {
    const sync = deferred<SyncResult>();
    const order: string[] = [];
    const { synced: done } = await runStartup({
      isDev: false,
      sync: () => sync.promise,
      afterSync: () => order.push("afterSync"),
      createWindow: async () => { order.push("window"); },
      afterWindow: () => order.push("afterWindow"),
    });
    expect(order).toEqual(["window", "afterWindow"]);
    expect(getStartupSyncState()).toEqual({ phase: "pending", result: null });
    sync.resolve(synced);
    await done;
    expect(order).toEqual(["window", "afterWindow", "afterSync"]);
    expect(getStartupSyncState()).toEqual({ phase: "done", result: synced });
  });

  it("a failed sync still settles the state (no result) and never blocks the window", async () => {
    const afterSync = vi.fn();
    const { synced: done } = await runStartup({
      isDev: false,
      sync: () => Promise.reject(new Error("ENOTFOUND api.github.com")),
      afterSync,
      createWindow: async () => {},
      afterWindow: () => {},
    });
    await done;
    expect(afterSync).toHaveBeenCalledWith(null);
    expect(getStartupSyncState()).toEqual({ phase: "done", result: null });
  });

  it("dev keeps sync-then-window (local checkout copy, Vite serves the renderer)", async () => {
    const order: string[] = [];
    await runStartup({
      isDev: true,
      sync: async () => { order.push("sync"); return synced; },
      afterSync: () => order.push("afterSync"),
      createWindow: async () => { order.push("window"); },
      afterWindow: () => order.push("afterWindow"),
    });
    expect(order).toEqual(["sync", "afterSync", "window", "afterWindow"]);
  });
});
