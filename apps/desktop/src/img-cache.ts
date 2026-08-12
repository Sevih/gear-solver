/**
 * `/img/*` resolver — the single image handler shared by the Electron prod
 * server (server.ts) and the Vite dev middleware (vite.config.ts), so both
 * behave identically.
 *
 * Images come from the public R2 bucket `img.outerpedia.com` (the same asset
 * source the outerpedia site uses) — NOT from the git repo. R2 paths mirror
 * the site's `/images/<rel>` layout.
 *
 * Resolution cascade (first hit wins):
 *   1. bundled sprites (apps/renderer/public/img — the few `ui/inven/*` UI
 *      sprites the R2 manifest doesn't carry)
 *   2. dev local checkout (outerpedia `.assets-staging/images`) — zero network
 *   3. persistent disk cache (steady state after first fetch)
 *   4. R2 fetch + cache to disk
 *   5. `.png`/`.jpg` miss → retry as `.webp` (webp-preferred source)
 *
 * Namespace alias: the renderer requests unique-option / set icons under
 * `ui/effect/<TI_Icon_*>` (the V2 layout); the R2 bucket stores them under
 * `equipment/`. Rewritten once at entry so every layer (checkout, cache, R2)
 * sees the canonical path.
 *
 * Electron-free (paths passed in) so Vite can import it without electron.
 */
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";

/** Public R2 image base (the outerpedia site's asset bucket). */
const OUTERPEDIA_IMAGE_BASE = process.env.OUTERPEDIA_IMAGE_BASE ?? "https://img.outerpedia.com/images";

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
// `..\`) is rejected before it can hit the filesystem.
const SAFE_PATH = /^[\w./%-]*$/;

let tmpCounter = 0;

export interface ImgCacheOptions {
  /** Persistent cache root. Images are written under `<cacheDir>/images/...`. */
  cacheDir: string;
  /** Bundled sprite root (renderer `public/img` in dev, `dist/img` in prod) —
   *  first in the cascade; carries the `ui/inven/*` sprites absent from R2. */
  bundledDir?: string | null;
  /** Optional dev local checkout (outerpedia `.assets-staging/images`) — wins
   *  over cache + network when present. */
  localCheckoutDir?: string | null;
}

/** Fetch one image from the R2 bucket. 200 → bytes, anything else → null. */
async function fetchR2(rel: string, timeoutMs = 10_000): Promise<{ status: number; buf: Buffer | null }> {
  try {
    const r = await fetch(`${OUTERPEDIA_IMAGE_BASE}/${rel}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { status: r.status, buf: null };
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } catch {
    return { status: 0, buf: null };
  }
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

/** V2 → R2 namespace alias (see module docstring). */
function canonicalRel(rel: string): string {
  return rel.startsWith("ui/effect/") ? `equipment/${rel.slice("ui/effect/".length)}` : rel;
}

/**
 * Background warm-up: download a set of image paths (relative to the R2
 * `/images` base, e.g. `equipment/TI_Equipment_Weapon_06.webp`) into the disk
 * cache, skipping ones already cached. Bounded concurrency, abortable,
 * best-effort (individual failures are ignored). Returns the count newly
 * cached.
 *
 * Used to pre-warm the equipment-icon subset referenced by the freshly-synced
 * derived data so the grid doesn't flicker on first render — character art
 * stays on-demand.
 */
export async function prefetchImages(cacheDir: string, imageRels: string[], concurrency = 6, signal?: AbortSignal): Promise<number> {
  const cacheImagesDir = join(cacheDir, "images");
  let cached = 0;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < imageRels.length) {
      if (signal?.aborted) return;
      const rel = canonicalRel(imageRels[i++]!);
      const dest = safeJoin(cacheImagesDir, rel);
      if (!dest || existsSync(dest)) continue;
      try {
        const got = await fetchR2(rel);
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
  // Path-safety on the raw (still-encoded) path — guards the filesystem joins.
  if (!SAFE_PATH.test(urlPath)) {
    res.statusCode = 400;
    res.end("bad image path");
    return true;
  }
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { res.statusCode = 400; res.end("bad image path"); return true; }
  rel = canonicalRel(rel);

  const cacheImagesDir = join(opts.cacheDir, "images");

  // 1. bundled sprites (probe under the ORIGINAL path too — `ui/inven/*` is
  //    bundled as-requested, and canonicalRel never rewrites that namespace)
  if (opts.bundledDir) {
    const f = safeJoin(opts.bundledDir, rel);
    if (f && existsSync(f) && statSync(f).isFile()) { streamFile(res, f); return true; }
  }

  // 2. dev local checkout
  if (opts.localCheckoutDir) {
    const f = safeJoin(opts.localCheckoutDir, rel);
    if (f && existsSync(f) && statSync(f).isFile()) { streamFile(res, f); return true; }
  }

  // 3. disk cache
  const cached = safeJoin(cacheImagesDir, rel);
  if (cached && existsSync(cached) && statSync(cached).isFile()) { streamFile(res, cached); return true; }

  // 4. R2 fetch (+ cache)
  const got = await fetchR2(rel);
  if (got.status === 200 && got.buf) {
    serveAndCache(res, cacheImagesDir, rel, got.buf, mime(rel));
    return true;
  }

  // 5. webp fallback for png/jpg misses (the bucket prefers webp)
  const ext = extname(rel).toLowerCase();
  if (got.status === 404 && (ext === ".png" || ext === ".jpg" || ext === ".jpeg")) {
    const webpRel = rel.slice(0, -ext.length) + ".webp";
    const webp = await fetchR2(webpRel);
    if (webp.status === 200 && webp.buf) {
      // Serve the webp bytes under the originally-requested URL; cache them
      // under the webp name (so a later direct .webp request also hits).
      serveAndCache(res, cacheImagesDir, webpRel, webp.buf, "image/webp");
      return true;
    }
  }

  res.statusCode = got.status === 0 ? 502 : 404;
  res.end("image unavailable");
  return true;
}
