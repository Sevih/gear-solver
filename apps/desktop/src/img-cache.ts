/**
 * `/img/*` resolver — the single image handler shared by the Electron prod
 * server (server.ts) and the Vite dev middleware (vite.config.ts), so both
 * behave identically.
 *
 * Resolution cascade (first hit wins):
 *   1. dev local checkout (optional fast path, zero network) — when present
 *   2. persistent disk cache (steady state after first fetch)
 *   3. GitHub CDN fetch (jsDelivr → raw.githubusercontent) + cache to disk
 *   4. `.png`/`.jpg` miss → retry as `.webp` (webp-preferred source)
 *   5. last resort → 302 to outerpedia.com so an un-mirrored asset still loads
 *
 * Electron-free (paths passed in) so Vite can import it without electron.
 */
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fetchRepoFile } from "./repo-source.js";

/** Public outerpedia.com image base for the last-resort 302. */
const OUTERPEDIA_IMAGE_BASE = process.env.OUTERPEDIA_IMAGE_BASE ?? "https://outerpedia.com/images";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
function mime(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

// URL-path chars an encoded image path ever uses. Anything else (CR/LF, `:`,
// `..\`) is rejected before it can hit the filesystem or a Location header.
const SAFE_PATH = /^[\w./%-]*$/;

let tmpCounter = 0;

export interface ImgCacheOptions {
  /** Persistent cache root. Images are written under `<cacheDir>/images/...`. */
  cacheDir: string;
  /** Optional dev local checkout (outerpedia `public/images`) — wins if set. */
  localCheckoutDir?: string | null;
  /** Returns the repo ref (commit SHA, or "main") to pin CDN fetches to. */
  getRef: () => string;
}

/** Stream a file from disk with a long cache header + an error guard so an
 *  EBUSY / vanished-file mid-read can't crash the server process. */
function streamFile(res: ServerResponse, file: string): void {
  res.setHeader("Content-Type", mime(file));
  res.setHeader("Cache-Control", "public, max-age=86400");
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/** Resolve a path under `base`, rejecting traversal. Returns null if it would
 *  escape `base`. */
function safeJoin(base: string, rel: string): string | null {
  const file = normalize(join(base, rel));
  return file.startsWith(base) ? file : null;
}

/** Write bytes atomically (tmp + rename) so a concurrent reader never sees a
 *  half-written file (common on Windows). */
function writeAtomic(file: string, buf: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
}

/** Serve a freshly-fetched buffer and mirror it into the cache under `cacheRel`. */
function serveAndCache(res: ServerResponse, cacheImagesDir: string, cacheRel: string, buf: Buffer, contentType: string): void {
  const cacheFile = safeJoin(cacheImagesDir, cacheRel);
  if (cacheFile) {
    try { writeAtomic(cacheFile, buf); } catch { /* cache write best-effort */ }
  }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(buf);
}

/**
 * Background warm-up: download a set of image paths (relative to
 * `public/images`, e.g. `ui/inven/CT_Slot_Lock.webp`) into the disk cache,
 * skipping ones already cached. Bounded concurrency, abortable, best-effort
 * (individual failures are ignored). Returns the count newly cached.
 *
 * Used to pre-warm the small high-traffic UI/equipment subset once per repo
 * update so the grid doesn't flicker on first render — character art stays
 * on-demand.
 */
export async function prefetchImages(cacheDir: string, ref: string, imageRels: string[], concurrency = 6, signal?: AbortSignal): Promise<number> {
  const cacheImagesDir = join(cacheDir, "images");
  let cached = 0;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < imageRels.length) {
      if (signal?.aborted) return;
      const rel = imageRels[i++]!;
      const dest = safeJoin(cacheImagesDir, rel);
      if (!dest || existsSync(dest)) continue;
      try {
        const got = await fetchRepoFile(ref, `public/images/${rel}`);
        if (got.status === 200 && got.buf) { writeAtomic(dest, got.buf); cached++; }
      } catch { /* best-effort */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, imageRels.length) }, worker));
  return cached;
}

/**
 * Handle a `/img/*` request. `urlPath` is the part AFTER `/img/` (caller strips
 * the prefix). Always writes a response — returns true so the caller can return.
 */
export async function serveImg(_req: IncomingMessage, res: ServerResponse, urlPath: string, opts: ImgCacheOptions): Promise<boolean> {
  // 1. Path-safety on the raw (still-encoded) path — guards both the filesystem
  //    joins below and the 302 Location header.
  if (!SAFE_PATH.test(urlPath)) {
    res.statusCode = 400;
    res.end("bad image path");
    return true;
  }
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { res.statusCode = 400; res.end("bad image path"); return true; }

  const cacheImagesDir = join(opts.cacheDir, "images");

  // 2. dev local checkout
  if (opts.localCheckoutDir) {
    const f = safeJoin(opts.localCheckoutDir, rel);
    if (f && existsSync(f) && statSync(f).isFile()) { streamFile(res, f); return true; }
  }

  // 3. disk cache
  const cached = safeJoin(cacheImagesDir, rel);
  if (cached && existsSync(cached) && statSync(cached).isFile()) { streamFile(res, cached); return true; }

  // 4. CDN fetch (+ cache)
  const ref = opts.getRef();
  const got = await fetchRepoFile(ref, `public/images/${rel}`);
  if (got.status === 200 && got.buf) {
    serveAndCache(res, cacheImagesDir, rel, got.buf, mime(rel));
    return true;
  }

  // 5. webp fallback for png/jpg misses (the repo prefers webp)
  const ext = extname(rel).toLowerCase();
  if (got.status === 404 && (ext === ".png" || ext === ".jpg" || ext === ".jpeg")) {
    const webpRel = rel.slice(0, -ext.length) + ".webp";
    const webp = await fetchRepoFile(ref, `public/images/${webpRel}`);
    if (webp.status === 200 && webp.buf) {
      // Serve the webp bytes under the originally-requested URL; cache them
      // under the webp name (so a later direct .webp request also hits).
      serveAndCache(res, cacheImagesDir, webpRel, webp.buf, "image/webp");
      return true;
    }
  }

  // 6. last resort — 302 to outerpedia.com (keeps un-mirrored assets loading).
  res.statusCode = 302;
  res.setHeader("Location", `${OUTERPEDIA_IMAGE_BASE}/${urlPath}`);
  res.end();
  return true;
}
