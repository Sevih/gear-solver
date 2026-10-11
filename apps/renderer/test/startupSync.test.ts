import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForStartupSync } from "../src/lib/startupSync.js";

afterEach(() => { vi.unstubAllGlobals(); });
const noSleep = async () => {};

describe("waitForStartupSync", () => {
  it("polls while pending and returns the settled result", async () => {
    const states = [
      { phase: "pending", result: null },
      { phase: "pending", result: null },
      { phase: "done", result: { status: "synced", message: "synced 19 tables @ abc1234" } },
    ];
    const f = vi.fn(async () => Response.json(states.shift()));
    vi.stubGlobal("fetch", f);
    expect(await waitForStartupSync({ sleep: noSleep })).toEqual({ status: "synced", message: "synced 19 tables @ abc1234" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("returns null without the endpoint (older backend)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    expect(await waitForStartupSync({ sleep: noSleep })).toBeNull();
  });

  it("gives up after maxPolls", async () => {
    const f = vi.fn(async () => Response.json({ phase: "pending", result: null }));
    vi.stubGlobal("fetch", f);
    expect(await waitForStartupSync({ sleep: noSleep, maxPolls: 4 })).toBeNull();
    expect(f).toHaveBeenCalledTimes(4);
  });
});
