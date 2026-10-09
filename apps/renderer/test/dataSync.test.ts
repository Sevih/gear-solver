import { afterEach, describe, expect, it, vi } from "vitest";
import { describeDataSync, requestDataSync } from "../src/lib/dataSync.js";

const stub = (impl: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));
afterEach(() => { vi.unstubAllGlobals(); });

describe("requestDataSync", () => {
  it("passes a successful sync through", async () => {
    stub(async () => Response.json({ status: "synced", message: "synced 19 tables @ abc1234", copied: 19 }));
    expect(await requestDataSync()).toEqual({ status: "synced", message: "synced 19 tables @ abc1234" });
  });

  it("an HTTP 500 without JSON is an error, not a success", async () => {
    stub(async () => new Response("Internal Server Error", { status: 500 }));
    const r = await requestDataSync();
    expect(r).toEqual({ status: "error", message: "HTTP 500" });
    expect(describeDataSync(r)).not.toMatch(/synced/i);
  });

  it("an HTTP 500 with the server's JSON keeps its message", async () => {
    stub(async () => Response.json({ status: "error", message: "EACCES" }, { status: 500 }));
    expect(await requestDataSync()).toEqual({ status: "error", message: "EACCES" });
  });

  it("a network failure is an error", async () => {
    stub(async () => { throw new TypeError("Failed to fetch"); });
    expect(await requestDataSync()).toEqual({ status: "error", message: "Failed to fetch" });
  });

  it("a 200 with an unexpected body is an error", async () => {
    stub(async () => new Response("<html>", { status: 200 }));
    expect((await requestDataSync()).status).toBe("error");
  });
});
