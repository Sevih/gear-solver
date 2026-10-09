import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withServer } from "./http-harness.js";
import { resetImgMissCache, serveImg } from "../src/img-cache.js";

const cacheDir = mkdtempSync(join(tmpdir(), "gs-imgmiss-"));
const handle = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) =>
  void serveImg(req, res, (req.url ?? "/").slice("/img/".length), { cacheDir });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetImgMissCache();
  fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("serveImg — negative cache for bucket misses", () => {
  it("does not refetch an image the bucket just 404'd", async () => {
    await withServer(handle, async (call) => {
      expect((await call("/img/characters/missing.webp")).status).toBe(404);
      expect((await call("/img/characters/missing.webp")).status).toBe(404);
      expect((await call("/img/characters/missing.webp")).status).toBe(404);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("covers the .png → .webp fallback pair as one miss", async () => {
    await withServer(handle, async (call) => {
      await call("/img/ui/missing.png");
      await call("/img/ui/missing.png");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // png + webp, once
  });

  it("answers the 404 with a short Cache-Control", async () => {
    await withServer(handle, async (call) => {
      const r = await call("/img/characters/missing.webp");
      expect(r.headers["cache-control"]).toMatch(/max-age=\d+/);
    });
  });

  it("retries once the miss expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withServer(handle, async (call) => {
      await call("/img/characters/later.webp");
      vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      await call("/img/characters/later.webp");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not remember a network failure (502)", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("offline"); });
    await withServer(handle, async (call) => {
      expect((await call("/img/characters/x.webp")).status).toBe(502);
      expect((await call("/img/characters/x.webp")).status).toBe(502);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
