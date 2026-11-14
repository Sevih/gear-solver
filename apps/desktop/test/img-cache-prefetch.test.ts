import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchImages } from "../src/img-cache.js";

let cacheDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "gs-imgprefetch-"));
  fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const rels = ["equipment/a.webp", "equipment/b.webp", "items/c.webp"];

describe("prefetchImages — warm-up result", () => {
  it("counts the images it cached, none failed", async () => {
    expect(await prefetchImages(cacheDir, rels, 2)).toEqual({ cached: 3, failed: 0 });
    for (const r of rels) expect(existsSync(join(cacheDir, "images", r))).toBe(true);
  });

  it("skips an image already cached, without a request", async () => {
    mkdirSync(join(cacheDir, "images", "equipment"), { recursive: true });
    writeFileSync(join(cacheDir, "images", "equipment", "a.webp"), "x");
    expect(await prefetchImages(cacheDir, rels, 2)).toEqual({ cached: 2, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offline: every image failed, nothing cached", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    expect(await prefetchImages(cacheDir, rels, 2)).toEqual({ cached: 0, failed: 3 });
  });

  it("a bucket 404 is not a failure, a 5xx is", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new Response(null, { status: url.endsWith("/equipment/a.webp") ? 404 : url.endsWith("/items/c.webp") ? 503 : 200 }));
    expect(await prefetchImages(cacheDir, rels, 2)).toEqual({ cached: 1, failed: 1 });
  });
});
