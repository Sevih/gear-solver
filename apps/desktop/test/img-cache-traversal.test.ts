import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveImg } from "../src/img-cache.js";

/** Minimal ServerResponse recorder — serveImg only sets a status / headers
 *  and ends (or pipes a file stream into) the response. */
function fakeRes() {
  const chunks: Buffer[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  const res = {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    write(c: Buffer | string) { chunks.push(Buffer.from(c)); return true; },
    end(c?: Buffer | string) { if (c) chunks.push(Buffer.from(c)); resolveDone(); },
    on() { return this; }, once() { return this; }, emit() { return true; },
  };
  return { res: res as unknown as ServerResponse & typeof res, done, body: () => Buffer.concat(chunks).toString("utf-8") };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("serveImg — traversal into a sibling directory", () => {
  it("does not serve <bundled>2/secret through ../", async () => {
    const root = mkdtempSync(join(tmpdir(), "gs-img-"));
    const bundled = join(root, "img");
    mkdirSync(bundled);
    mkdirSync(join(root, "img2"));
    writeFileSync(join(root, "img2", "secret.webp"), "SECRET");
    // The R2 fallback must not be reached with a real network call.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const { res, done, body } = fakeRes();
    await serveImg({} as IncomingMessage, res, "../img2/secret.webp", { cacheDir: join(root, "cache"), bundledDir: bundled });
    await done;
    expect(body()).not.toContain("SECRET");
    expect(res.statusCode).toBe(404);
  });
});
