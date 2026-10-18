import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDataVersion } from "../src/data.js";

const serve = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
afterEach(() => { vi.unstubAllGlobals(); });

describe("loadDataVersion", () => {
  it("reads resVersion next to hash and builtAt", async () => {
    serve({ schema: 1, resVersion: "1.11.408", hash: "79508390003b", builtAt: "2026-10-17T19:21:07.133Z" });
    expect(await loadDataVersion()).toEqual({ resVersion: "1.11.408", hash: "79508390003b", builtAt: "2026-10-17T19:21:07.133Z" });
  });

  it("a cache without resVersion still loads", async () => {
    serve({ hash: "h1", builtAt: "2026-01-01" });
    expect(await loadDataVersion()).toEqual({ hash: "h1", builtAt: "2026-01-01" });
  });

  it("a stamp without hash is null", async () => {
    serve({ resVersion: "1.11.408", builtAt: "2026-01-01" });
    expect(await loadDataVersion()).toBeNull();
  });
});
