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
 *   3. persistent disk cache (steady state after first fetch). An entry older
 *      than REVALIDATE_AFTER_MS is still served at once, then revalidated in
 *      the background by a conditional request (`If-None-Match` on the ETag
 *      kept under `<cacheDir>/image-etags/`, else `If-Modified-Since` on the
 *      file's mtime): 304 → mtime refreshed, 200 → rewritten, anything else
 *      (network error included) → left as is
 *   4. R2 fetch + cache to disk
 *   5. `.png`/`.jpg` miss → retry as `.webp` (webp-preferred source)
 *   6. a bucket 404 is remembered for MISS_TTL_MS (negative cache) and
 *      answered with a short `Cache-Control`, so an image absent from R2 is
 *      not refetched on every render
 *
 * Namespace alias: the renderer requests unique-option / set icons under
 * `ui/effect/<TI_Icon_*>` (the V2 layout); the R2 bucket stores them under
 * `equipment/`. Rewritten once at entry so every layer (checkout, cache, R2)
 * sees the canonical path.
 *
 * Electron-free (paths passed in) so Vite can import it without electron.
 */
import { createReadStream, existsSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { resolveInside } from "./safe-path.js";

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

/** How long a bucket 404 is remembered before the image is asked for again —
 *  also the `max-age` of the 404 itself, so the renderer doesn't re-request it
 *  on every render either. Network failures (502) are never remembered. */
const MISS_TTL_MS = 10 * 60 * 1000;
/** canonical rel → epoch ms until which it is a known miss. */
const misses = new Map<string, number>();

/** Forget every remembered miss (tests). */
export function resetImgMissCache(): void {
  misses.clear();
}

function knownMiss(rel: string): boolean {
  const until = misses.get(rel);
  if (until == null) return false;
  if (until > Date.now()) return true;
  misses.delete(rel);
  return false;
}

/** Age past which a disk-cached image is revalidated against R2 (it is still
 *  served from the cache first — the revalidation runs in the background). */
const REVALIDATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** cache file → its in-flight revalidation: never more than one per image. */
const revalidating = new Map<string, Promise<void>>();

/** Wait for every background revalidation in flight (tests). */
export async function settleImgRevalidations(): Promise<void> {
  await Promise.all([...revalidating.values()]);
}

function sendMiss(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Cache-Control", `public, max-age=${MISS_TTL_MS / 1000}`);
  res.end("image unavailable");
}

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

interface R2Reply { status: number; buf: Buffer | null; etag: string | null }

/** Fetch one image from the R2 bucket. 200 → bytes (+ its ETag), anything else
 *  → null; a network error is status 0. `headers` carries the conditional
 *  headers of a revalidation. */
async function fetchR2(rel: string, headers?: Record<string, string>, timeoutMs = 10_000): Promise<R2Reply> {
  try {
    const r = await fetch(`${OUTERPEDIA_IMAGE_BASE}/${rel}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { status: r.status, buf: null, etag: null };
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), etag: r.headers.get("etag") };
  } catch {
    return { status: 0, buf: null, etag: null };
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
  return resolveInside(base, rel);
}

/** Where the ETag of a cached image is kept — outside `images/`, so `/img/*`
 *  can never serve it. */
function etagFile(cacheDir: string, rel: string): string | null {
  return safeJoin(join(cacheDir, "image-etags"), `${rel}.etag`);
}

/** Mirror fetched bytes into the disk cache under `rel` (atomic writes), with
 *  their ETag next to it — or none, so a stale tag can't outlive its bytes.
 *  Best-effort: returns whether the image itself was written. */
function cacheImage(cacheDir: string, rel: string, buf: Buffer, etag: string | null): boolean {
  const file = safeJoin(join(cacheDir, "images"), rel);
  if (!file) return false;
  try { writeAtomic(file, buf); } catch { return false; }
  const tag = etagFile(cacheDir, rel);
  try {
    if (tag && etag) writeAtomic(tag, etag);
    else if (tag) rmSync(tag, { force: true });
  } catch { /* no tag → If-Modified-Since */ }
  return true;
}

/** Serve a freshly-fetched image and mirror it into the cache under `cacheRel`. */
function serveAndCache(res: ServerResponse, cacheDir: string, cacheRel: string, got: R2Reply & { buf: Buffer }, contentType: string): void {
  cacheImage(cacheDir, cacheRel, got.buf, got.etag);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(got.buf);
}

/** Background conditional re-fetch of a stale cached image (see the module
 *  docstring). Joins the revalidation already in flight for `file`, if any. */
function revalidate(cacheDir: string, rel: string, file: string, mtimeMs: number): Promise<void> {
  const inFlight = revalidating.get(file);
  if (inFlight) return inFlight;
  const run = (async () => {
    let etag: string | null = null;
    const tag = etagFile(cacheDir, rel);
    try { if (tag && existsSync(tag)) etag = readFileSync(tag, "utf-8").trim() || null; } catch { /* → date */ }
    const got = await fetchR2(rel, etag ? { "If-None-Match": etag } : { "If-Modified-Since": new Date(mtimeMs).toUTCString() });
    if (got.status === 304) {
      try { const now = new Date(); utimesSync(file, now, now); } catch { /* best-effort */ }
    } else if (got.status === 200 && got.buf) {
      cacheImage(cacheDir, rel, got.buf, got.etag);
    }
  })().finally(() => revalidating.delete(file));
  revalidating.set(file, run);
  return run;
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
        if (got.status === 200 && got.buf && cacheImage(cacheDir, rel, got.buf, got.etag)) cached++;
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

  // 3. disk cache — served at once; a stale entry is revalidated behind it
  const cached = safeJoin(cacheImagesDir, rel);
  if (cached && existsSync(cached)) {
    const st = statSync(cached);
    if (st.isFile()) {
      streamFile(res, cached);
      if (Date.now() - st.mtimeMs > REVALIDATE_AFTER_MS) void revalidate(opts.cacheDir, rel, cached, st.mtimeMs);
      return true;
    }
  }

  // 4. R2 fetch (+ cache) — unless the bucket 404'd this path recently
  if (knownMiss(rel)) { sendMiss(res); return true; }
  const got = await fetchR2(rel);
  if (got.status === 200 && got.buf) {
    serveAndCache(res, opts.cacheDir, rel, { ...got, buf: got.buf }, mime(rel));
    return true;
  }

  // 5. webp fallback for png/jpg misses (the bucket prefers webp)
  const ext = extname(rel).toLowerCase();
  // A miss is only remembered when every source said 404 (not a timeout).
  let definitiveMiss = got.status === 404;
  if (got.status === 404 && (ext === ".png" || ext === ".jpg" || ext === ".jpeg")) {
    const webpRel = rel.slice(0, -ext.length) + ".webp";
    const webp = await fetchR2(webpRel);
    definitiveMiss = webp.status === 404;
    if (webp.status === 200 && webp.buf) {
      // Serve the webp bytes under the originally-requested URL; cache them
      // under the webp name (so a later direct .webp request also hits).
      serveAndCache(res, opts.cacheDir, webpRel, { ...webp, buf: webp.buf }, "image/webp");
      return true;
    }
  }

  if (definitiveMiss) {
    misses.set(rel, Date.now() + MISS_TTL_MS);
    sendMiss(res);
    return true;
  }
  res.statusCode = got.status === 0 ? 502 : 404;
  res.end("image unavailable");
  return true;
}
