/**
 * The renderer's backend API, shared by the Electron prod server (server.ts)
 * and the Vite dev middleware (apps/renderer/vite.config.ts). Both used to
 * carry their own copy, and the copies drifted — one handler keeps dev and
 * packaged builds identical.
 *
 * Routes served here:
 *  - `/gamedata/*`  → derived game data (ETag revalidation)
 *  - `/captured/*`  → captured account JSON (a missing `.json` is `200 null`)
 *  - `/img/*`       → bundled sprites / local checkout / disk cache / R2
 *  - `/api/capture/{status,wipe}` → capture folder state / wipe
 *  - `/api/steam/{status,install,uninstall,launch}` → Steam capture plugin
 *  - `/api/data/sync`, `/api/data/startup-sync`, `/api/reco/:id`, `/api/stat-locks`,
 *    `/api/captured/user-item`, `/api/update/*` — any other `/api/*` is a JSON 404
 *
 * What differs between dev and prod is injected (`ApiConfig`): the paths
 * and the auto-updater. Electron-free on purpose — nothing here imports `electron`
 * or paths.ts — so Vite can load it.
 */
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { dlog, dwarn } from "./log.js";
import { installSteamPlugin, launchGame, steamPluginLive, steamStatus, uninstallSteamPlugin } from "./steam-capture.js";
import { proxyReco } from "./reco-proxy.js";
import { syncGameData } from "./data-sync.js";
import { getStartupSyncState } from "./startup.js";
import { serveImg, type ImgCacheOptions } from "./img-cache.js";
import { resolveInside } from "./safe-path.js";

export interface ApiConfig {
  /** Captured account JSON + the Steam plugin heartbeat. */
  captureOut: string;
  /** Derived game data served under /gamedata/ and refreshed by /api/data/sync. */
  derivedDir: string;
  /** Persisted last-synced outerpedia SHA (data-sync gate). */
  repoShaState: string;
  /** Dev: the repo root, so data sync can find the outerpedia checkout through
   *  `.env.local` / a sibling dir (outerpedia-checkout.ts). Prod: null. */
  repoRoot: string | null;
  statLocks: string;
  steamPluginDll: string;
  scratchDir: string;
  img: ImgCacheOptions;
  /** `/api/update/*` — electron-updater in prod, a static "up to date" in dev. */
  update: {
    status: () => unknown;
    check: () => void;
    /** False when nothing is downloaded yet (→ 409). */
    install: () => boolean;
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function mime(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Stream a static file with an ETag built from size+mtime; honor If-None-Match
 *  for cheap 304s. `headers` are added before the body (server.ts sets the
 *  renderer document's CSP through it). */
export function serveStatic(
  req: IncomingMessage, res: ServerResponse, file: string, cacheMode: "etag" | "long",
  headers: Record<string, string> = {},
): void {
  if (!existsSync(file)) { res.statusCode = 404; res.end("not found"); return; }
  res.setHeader("Content-Type", mime(file));
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (cacheMode === "long") {
    res.setHeader("Cache-Control", "public, max-age=86400");
  } else {
    const st = statSync(file);
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
  }
  // Guard the stream: an EBUSY / file-vanished mid-read (common on Windows
  // when another process touches the file) would otherwise emit an
  // unhandled 'error' on the stream and crash the whole server process.
  const stream = createReadStream(file);
  stream.on("error", (err) => {
    // Surface the swallowed read failure (EBUSY / vanished file) — without
    // this the client just gets a bare 500 and the cause is invisible.
    dwarn("server", `stream error on ${file}:`, (err as Error).message);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/** `decodeURIComponent` that returns null instead of throwing `URIError` on a
 *  malformed escape (`%E0%A4%A`) — same 400 contract as img-cache.ts. */
function safeDecode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

/** Serve `/<prefix>/...` from a base dir, with path-traversal guard. */
function tryMount(req: IncomingMessage, res: ServerResponse, url: string, prefix: string, dir: string, cacheMode: "etag" | "long"): boolean {
  if (!url.startsWith(prefix)) return false;
  const rel = safeDecode(url.slice(prefix.length));
  if (rel === null) { res.statusCode = 400; res.end("bad path"); return true; }
  const file = resolveInside(dir, rel);
  if (!file) { res.statusCode = 403; res.end("forbidden"); return true; }
  serveStatic(req, res, file, cacheMode);
  return true;
}

/** Flip a response into unbuffered plain-text streaming mode (the capture
 *  console protocol). Idempotent. */
function beginStream(res: ServerResponse): void {
  if (res.headersSent) return;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

/** DNS-rebinding / CSRF guard for the mutating endpoints and the account
 *  reads. A page served from another origin but pointed at 127.0.0.1 still
 *  carries its own hostname in the `Host` (and `Origin`) header, so requiring
 *  a loopback host blocks it from POSTing to `/api/capture/*` or reading
 *  `/captured/user_item.json`. Same-origin requests from our own renderer
 *  always pass. */
export function isLocalRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const h = new URL(origin).hostname;
      if (h !== "127.0.0.1" && h !== "localhost") return false;
    } catch { return false; }
  }
  return true;
}

/** Run an async task while streaming its progress lines through the capture
 *  console protocol: one line per log call, then a `__EXIT__:<code>` sentinel
 *  the renderer's streamCapture() looks for. */
function streamTask(res: ServerResponse, task: (log: (line: string) => void) => Promise<void>): void {
  beginStream(res);
  const log = (line: string) => res.write(line + "\n");
  task(log).then(
    () => { res.write("\n__EXIT__:0\n"); res.end(); },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      dwarn("capture", "task failed:", msg);
      res.write(`x  ${msg}\n__EXIT__:1\n`); res.end();
    },
  );
}

/** Buffer a request body (capped) and hand the caller the raw text. On
 *  overflow it answers 413 itself and never calls `ok`. */
function readBody(req: IncomingMessage, res: ServerResponse, maxBytes: number, ok: (body: string) => void): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on("data", (c: Buffer) => {
    if (aborted) return;
    size += c.length;
    if (size > maxBytes) { aborted = true; res.statusCode = 413; res.end(JSON.stringify({ error: "payload too large" })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (aborted) return;
    ok(Buffer.concat(chunks).toString("utf-8"));
  });
}

/** Captured snapshots the renderer's `autoImport` reads (apps/renderer/src/data.ts). */
const IMPORTED_SNAPSHOTS = ["user_item", "user_character", "user_gift", "user_archive"] as const;

/** Build the request handler. It returns false for a URL it doesn't own (the
 *  renderer's own files), so the caller can fall through. */
export function createApiHandler(cfg: ApiConfig): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { captureOut } = cfg;

  /** GET /api/capture/status — whether a snapshot exists, and the mtime of
   *  every file the renderer's import reads (the Steam follower re-imports
   *  when any of them changes: a hero or geas level can land without a new
   *  inventory). `userItemMtime` stays for the Home "last capture" line. */
  function captureStatus(res: ServerResponse): void {
    const sentinel = join(captureOut, ".captured");
    const mtimes: Record<string, number | null> = {};
    for (const name of IMPORTED_SNAPSHOTS) {
      const file = join(captureOut, `${name}.json`);
      mtimes[name] = existsSync(file) ? statSync(file).mtimeMs : null;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      captured: existsSync(sentinel),
      userItemMtime: mtimes.user_item ?? null,
      mtimes,
    }));
  }

  return (req, res) => {
    const url = (req.url ?? "/").split("?")[0]!;

    // Reject non-local Hosts up front on every mutation (all state-changing
    // endpoints are POSTs) AND on every read of account data: `/captured/*` is
    // the player's snapshot and `/api/*` GETs expose capture/Steam state —
    // a DNS-rebinding page could otherwise read them. Static renderer files,
    // `/gamedata/*` and `/img/*` are public and stay open.
    if ((req.method === "POST" || url.startsWith("/captured/") || url.startsWith("/api/")) && !isLocalRequest(req)) {
      res.statusCode = 403;
      res.end("forbidden: non-local origin");
      return true;
    }

    if (url === "/api/capture/status" && req.method === "GET") {
      captureStatus(res);
      return true;
    }
    // Manual "Sync game data" — pull the solver artifacts from the outerpedia repo.
    if (url === "/api/data/sync" && req.method === "POST") {
      dlog("server", "manual data sync requested");
      syncGameData({ derivedDir: cfg.derivedDir, shaStateFile: cfg.repoShaState, force: true, repoRoot: cfg.repoRoot })
        .then((r) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(r)); })
        .catch((err: Error) => { res.statusCode = 500; res.end(JSON.stringify({ status: "error", message: err.message })); });
      return true;
    }
    // Launch-time background sync (startup.ts) — the renderer polls this until
    // "done" and re-imports when the result is "synced". Dev never runs one:
    // the state stays at its `done` / null default.
    if (url === "/api/data/startup-sync" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(getStartupSyncState()));
      return true;
    }
    // --- auto-update — drives the Home tab's inline update card. status is
    // polled; check/install are user actions (Check again / Retry / Install). ---
    if (url === "/api/update/status" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(cfg.update.status()));
      return true;
    }
    if (url === "/api/update/check" && req.method === "POST") {
      cfg.update.check();
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (url === "/api/update/install" && req.method === "POST") {
      // 409 when nothing is downloaded yet (button shouldn't be reachable then,
      // but guard against a stale client racing the state).
      res.statusCode = cfg.update.install() ? 204 : 409;
      res.end();
      return true;
    }
    // Build-reco proxy → outerpedia API (Get Preset). GET only, numeric id.
    if (url.startsWith("/api/reco/") && req.method === "GET") {
      const id = url.slice("/api/reco/".length);
      dlog("server", `proxying reco ${id}`);
      void proxyReco(id, res);
      return true;
    }
    // Settings → Data → "Wipe captured data". Empties the whole capture folder
    // (snapshots, sentinel, seen-paths.log, `_unknown/`, the Steam plugin
    // heartbeat) so the renderer reverts to its empty state. The folder itself
    // stays: the Steam plugin writes into it. Refused while the plugin is loaded
    // in a running game (same guard as the user_item write-back): it would
    // rewrite the folder behind the wipe, heartbeat included.
    if (url === "/api/capture/wipe" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      void steamPluginLive(captureOut).catch(() => false).then((isLive) => {
        if (isLive) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: "Steam capture plugin live — close the game first" }));
          return;
        }
        let removed = 0;
        try {
          for (const f of readdirSync(captureOut)) {
            rmSync(join(captureOut, f), { recursive: true, force: true });
            removed++;
          }
        } catch (err) {
          dwarn("capture", "wipe failed:", (err as Error).message);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as Error).message }));
          return;
        }
        dlog("capture", `wiped ${removed} capture folder entr(ies)`);
        res.end(JSON.stringify({ removed }));
      });
      return true;
    }
    // --- Steam source: BepInEx plugin in the Steam client (steam-capture.ts) ---
    if (url === "/api/steam/status" && req.method === "GET") {
      steamStatus(captureOut, cfg.steamPluginDll).then((st) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(st));
      }).catch((err: Error) => {
        res.statusCode = 500;
        res.end(`steam status failed: ${err.message}`);
      });
      return true;
    }
    if (url === "/api/steam/install" && req.method === "POST") {
      streamTask(res, async (log) => {
        await installSteamPlugin({ captureOut, bundledDll: cfg.steamPluginDll, scratchDir: cfg.scratchDir, log });
      });
      return true;
    }
    if (url === "/api/steam/uninstall" && req.method === "POST") {
      readBody(req, res, 10_000, (raw) => {
        res.setHeader("Content-Type", "application/json");
        let removeBepinex: boolean;
        try {
          // An empty body means "plugin only" (the renderer may POST none).
          removeBepinex = raw ? Boolean((JSON.parse(raw) as { removeBepinex?: unknown } | null)?.removeBepinex) : false;
        } catch (err) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: (err as Error).message }));
          return;
        }
        const lines: string[] = [];
        uninstallSteamPlugin({ captureOut, bundledDll: cfg.steamPluginDll, log: (l) => lines.push(l), removeBepinex })
          .then((status) => res.end(JSON.stringify({ status, lines })))
          .catch((err: Error) => {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: err.message }));
          });
      });
      return true;
    }
    if (url === "/api/steam/launch" && req.method === "POST") {
      launchGame();
      res.statusCode = 204;
      res.end();
      return true;
    }

    // --- stat-locks read/write ---
    if (url === "/api/stat-locks" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(existsSync(cfg.statLocks) ? readFileSync(cfg.statLocks, "utf-8") : "{}");
      return true;
    }
    if (url === "/api/stat-locks" && req.method === "POST") {
      // ~1 MB — stat-locks snapshots are a few KB
      readBody(req, res, 1_000_000, (body) => {
        try {
          JSON.parse(body); // validate
          writeAtomic(cfg.statLocks, body);
          res.statusCode = 204;
          res.end();
        } catch (err) {
          res.statusCode = 400;
          res.end(`invalid body: ${(err as Error).message}`);
        }
      });
      return true;
    }

    // --- captured user_item write-back (equip / unequip edits) ---
    // The renderer applies the core equipItem/unequipItem helpers against the
    // loaded game data and POSTs the FULL rewritten user_item.json here; the
    // server just validates + writes it (it has no game data to resolve slots).
    // Refused while the Steam plugin is loaded in a running game, so its next
    // /user/item snapshot (it rewrites user_item.json at the next lobby) can't
    // clobber the edit.
    if (url === "/api/captured/user-item" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      // The plugin probe is async (tasklist): start it now, decide once the body is in.
      const live = steamPluginLive(captureOut).catch(() => false);
      // ~32 MB — a large account's user_item.json
      readBody(req, res, 32_000_000, (body) => void live.then((isLive) => {
        if (isLive) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: "Steam capture plugin live — close the game first" }));
          return;
        }
        try {
          const parsed = JSON.parse(body) as { ItemList?: unknown };
          if (!Array.isArray(parsed.ItemList)) throw new Error("missing ItemList[]");
          writeAtomic(join(captureOut, "user_item.json"), body);
          dlog("capture", `user_item.json rewritten (${parsed.ItemList.length} items)`);
          res.statusCode = 204;
          res.end();
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      }));
      return true;
    }

    // --- /img/* — bundled sprites → local checkout → disk cache → R2 bucket.
    // See img-cache.ts for the full cascade + the ui/effect→equipment alias. ---
    if (url.startsWith("/img/")) {
      void serveImg(req, res, url.slice("/img/".length), cfg.img).catch((err: unknown) => {
        dwarn("server", "serveImg failed:", err instanceof Error ? err.message : String(err));
        if (!res.headersSent) { res.statusCode = 500; res.end("image error"); }
      });
      return true;
    }

    // --- data mounts ---
    if (tryMount(req, res, url, "/gamedata/", cfg.derivedDir, "etag")) return true;
    // A missing captured JSON is a normal state (the user may never have hit an
    // optional endpoint like `/archive/info`); the renderer reads null as
    // "absent". Serve 200 null instead of letting tryMount 404 — otherwise it's
    // a red console error on every load.
    if (url.startsWith("/captured/") && url.endsWith(".json")) {
      const rel = safeDecode(url.slice("/captured/".length));
      if (rel === null) { res.statusCode = 400; res.end("bad path"); return true; }
      const file = resolveInside(captureOut, rel);
      if (file && !existsSync(file)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end("null");
        return true;
      }
    }
    if (tryMount(req, res, url, "/captured/", captureOut, "etag")) return true;

    // Any other `/api/*` is a typo or a removed route: answer it here, or the
    // caller's SPA fallback (server.ts in prod, Vite in dev) would serve
    // index.html with a 200 and the caller would get HTML instead of an error.
    if (url.startsWith("/api/")) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "unknown endpoint" }));
      return true;
    }

    return false;
  };
}
