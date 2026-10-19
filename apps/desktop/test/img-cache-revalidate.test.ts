import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withServer } from "./http-harness.js";
import { resetImgMissCache, serveImg, settleImgRevalidations } from "../src/img-cache.js";

const DAY = 24 * 60 * 60 * 1000;
const REL = "characters/hero.webp";

let cacheDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
const handle = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) =>
  void serveImg(req, res, (req.url ?? "/").slice("/img/".length), { cacheDir });
const imgFile = () => join(cacheDir, "images", REL);
const tagFile = () => join(cacheDir, "image-etags", `${REL}.etag`);

/** Seed the disk cache with `body`, `ageDays` old, with an optional ETag. */
function seed(body: string, ageDays: number, etag?: string): number {
  mkdirSync(dirname(imgFile()), { recursive: true });
  writeFileSync(imgFile(), body);
  const t = (Date.now() - ageDays * DAY) / 1000;
  utimesSync(imgFile(), t, t);
  if (etag) { mkdirSync(dirname(tagFile()), { recursive: true }); writeFileSync(tagFile(), etag); }
  return statSync(imgFile()).mtimeMs;
}
const sentHeaders = (i = 0) => (fetchMock.mock.calls[i]![1] as { headers?: Record<string, string> }).headers ?? {};

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "gs-imgreval-"));
  resetImgMissCache();
  fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("serveImg — disk cache revalidation", () => {
  it("serves a fresh cached image without asking R2", async () => {
    seed("cached", 1);
    await withServer(handle, async (call) => {
      expect((await call(`/img/${REL}`)).body).toBe("cached");
    });
    await settleImgRevalidations();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stale + 304: serves the cache, sends If-None-Match, refreshes the mtime", async () => {
    const before = seed("cached", 8, '"abc"');
    // The cached file is streamed (opened asynchronously) while the revalidation
    // runs: hold R2's answer until the body is in, so the touch can't race it.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => { await gate; return new Response(null, { status: 304 }); });
    await withServer(handle, async (call) => {
      expect((await call(`/img/${REL}`)).body).toBe("cached");
    });
    release();
    await settleImgRevalidations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders()).toEqual({ "If-None-Match": '"abc"' });
    expect(readFileSync(imgFile(), "utf-8")).toBe("cached");
    expect(statSync(imgFile()).mtimeMs).toBeGreaterThan(before + 7 * DAY);
  });

  it("stale without an ETag: falls back to If-Modified-Since on the mtime", async () => {
    const before = seed("cached", 8);
    await withServer(handle, async (call) => { await call(`/img/${REL}`); });
    await settleImgRevalidations();
    expect(sentHeaders()).toEqual({ "If-Modified-Since": new Date(before).toUTCString() });
  });

  it("stale + 200: serves the old bytes now, rewrites the cache and its ETag atomically", async () => {
    seed("cached", 8, '"old"');
    // The cached file is streamed (opened asynchronously) while the revalidation
    // runs: an instant 200 could rename "fresh" over it first — hold R2 until the body is in.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => { await gate; return new Response("fresh", { status: 200, headers: { etag: '"new"' } }); });
    await withServer(handle, async (call) => {
      expect((await call(`/img/${REL}`)).body).toBe("cached");
    });
    release();
    await settleImgRevalidations();
    expect(readFileSync(imgFile(), "utf-8")).toBe("fresh");
    expect(readFileSync(tagFile(), "utf-8")).toBe('"new"');
    expect(readdirSync(dirname(imgFile())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    // Fresh again → the next request doesn't revalidate.
    await withServer(handle, async (call) => {
      expect((await call(`/img/${REL}`)).body).toBe("fresh");
    });
    await settleImgRevalidations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stale + network down: serves the cache and leaves it untouched", async () => {
    const before = seed("cached", 8, '"abc"');
    fetchMock.mockImplementation(async () => { throw new TypeError("offline"); });
    await withServer(handle, async (call) => {
      const r = await call(`/img/${REL}`);
      expect(r.status).toBe(200);
      expect(r.body).toBe("cached");
    });
    await settleImgRevalidations();
    expect(readFileSync(imgFile(), "utf-8")).toBe("cached");
    expect(statSync(imgFile()).mtimeMs).toBe(before);
  });

  it("never runs two revalidations of the same image at once", async () => {
    seed("cached", 8);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => { await gate; return new Response(null, { status: 304 }); });
    await withServer(handle, async (call) => {
      await Promise.all([call(`/img/${REL}`), call(`/img/${REL}`), call(`/img/${REL}`)]);
    });
    release();
    await settleImgRevalidations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the ETag of a first fetch outside images/, so /img/* can't serve it", async () => {
    fetchMock.mockImplementation(async () => new Response("bytes", { status: 200, headers: { etag: '"v1"' } }));
    await withServer(handle, async (call) => {
      expect((await call(`/img/${REL}`)).body).toBe("bytes");
    });
    expect(readFileSync(tagFile(), "utf-8")).toBe('"v1"');
    expect(existsSync(join(cacheDir, "images", `${REL}.etag`))).toBe(false);
  });
});
