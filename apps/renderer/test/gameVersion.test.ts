import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
// The module keeps a 10 min cache: a fresh copy per test.
beforeEach(() => vi.resetModules());

async function load() {
  return (await import("../src/game-version.js")).getGameVersion;
}

describe("game version — source", () => {
  it("reads the live version through the local server, never GitHub (CSP connect-src 'self')", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resVersion: "1.11.404", at: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const getGameVersion = await load();
    expect(await getGameVersion()).toBe("1.11.404");
    expect(fetchMock).toHaveBeenCalledWith("/api/game-version", expect.anything());
    // Cached: a second read doesn't ask the server again.
    expect(await getGameVersion()).toBe("1.11.404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives null on a non-ok reply, a null version or a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await (await load())()).toBeNull();
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ resVersion: null, at: null }))));
    expect(await (await load())()).toBeNull();
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await (await load())()).toBeNull();
  });
});
