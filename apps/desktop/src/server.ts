/**
 * In-process HTTP server that hosts everything the renderer needs:
 *  - Built `apps/renderer/dist/*` at `/`
 *  - `/gamedata/*`  → DERIVED game data (data/derived in dev, bundled tree in prod)
 *  - `/captured/*`  → captured account JSON (.cache/capture-out in dev, userData in prod)
 *  - `/img/*`       → bundled sprites / disk cache / img.outerpedia.com (R2)
 *  - `/api/capture/{status,wipe}` → capture folder state / wipe
 *  - `/api/steam/{status,install,uninstall,launch}` → Steam source (BepInEx plugin)
 *  - `/api/stat-locks` GET/POST → stat regression locks
 *  - `/api/data/sync` POST, `/api/data/startup-sync` GET → game-data sync
 *
 * Everything but the renderer's own files is the shared API handler
 * (api-handler.ts) — the Vite dev middleware (apps/renderer/vite.config.ts)
 * mounts the same handler, so `npm run desktop:dev` and a packaged build
 * behave identically. ETag-based revalidation on data files keeps the
 * renderer fast after the first hit; images use a 1-day max-age.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLED_IMG,
  CAPTURE_OUT,
  DERIVED,
  IMG_CACHE_DIR,
  REPO_ROOT,
  REPO_SHA_STATE,
  IS_DEV,
  STAT_LOCKS,
  RENDERER_DIST,
  SCRATCH_DIR,
  STEAM_PLUGIN_DLL,
  findOuterpediaImagesDev,
} from "./paths.js";
import { createApiHandler, serveStatic } from "./api-handler.js";
import { resolveInside } from "./safe-path.js";
import { dlog, dwarn } from "./log.js";
import { getStatus as getUpdateStatus, triggerCheck as triggerUpdateCheck, installUpdate } from "./updater.js";

/**
 * Content-Security-Policy for the renderer document. The prod build ships only
 * external module scripts (no inline/eval — that's a dev-only Vite thing), so
 * `script-src 'self'` is safe and silences Electron's insecure-CSP warning for
 * good. The few cross-origin holes are exactly the renderer's real needs:
 *   - style-src/font-src → Google Fonts (Geist + Geist Mono, loaded from
 *     index.html). 'unsafe-inline' on styles covers React's `style={{…}}` attrs.
 *   - img-src is same-origin only: every image goes through the `/img/*`
 *     route (bundled/cache/R2 proxying happens server-side, img-cache.ts).
 *     data:/blob: cover canvas/capture-derived images.
 * Everything else (game data, captured JSON, reco/update APIs, the solver
 * worker) is same-origin and falls under 'self'.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

/** The shared API (api-handler.ts) wired to the packaged paths and
 *  electron-updater. */
const api = createApiHandler({
  captureOut: CAPTURE_OUT,
  derivedDir: DERIVED,
  repoShaState: REPO_SHA_STATE,
  repoRoot: IS_DEV ? REPO_ROOT : null,
  statLocks: STAT_LOCKS,
  steamPluginDll: STEAM_PLUGIN_DLL,
  scratchDir: SCRATCH_DIR,
  img: {
    cacheDir: IMG_CACHE_DIR,
    bundledDir: BUNDLED_IMG,
    localCheckoutDir: IS_DEV ? findOuterpediaImagesDev() : null,
  },
  update: { status: getUpdateStatus, check: triggerUpdateCheck, install: installUpdate },
});

/** Request entry point. A synchronous throw in a route must not escape to
 *  Node's `uncaughtException` (Electron shows a crash dialog and the request
 *  hangs forever): answer 500 instead. */
export function handle(req: IncomingMessage, res: ServerResponse): void {
  try {
    route(req, res);
  } catch (err) {
    dwarn("server", "request failed:", err instanceof Error ? err.message : String(err));
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
}

function route(req: IncomingMessage, res: ServerResponse): void {
  if (api(req, res)) return;
  const url = (req.url ?? "/").split("?")[0]!;

  // --- renderer (built Vite dist) ---
  // SPA fallback: any unknown path serves index.html so client-side state
  // (currently tab name in usePersistedState) survives a hard reload.
  // Lock down the renderer document (the only thing CSP governs) on both the
  // direct and the fallback index.html serves.
  const headersFor = (file: string): Record<string, string> => (file.endsWith(".html") ? { "Content-Security-Policy": CSP } : {});
  const stripped = url === "/" ? "/index.html" : url;
  const file = resolveInside(RENDERER_DIST, stripped);
  if (file && existsSync(file) && statSync(file).isFile()) {
    serveStatic(req, res, file, "etag", headersFor(file));
    return;
  }
  const index = join(RENDERER_DIST, "index.html");
  serveStatic(req, res, index, "etag", headersFor(index));
}

/** Preferred fixed port for the embedded HTTP server. We bind here so the
 *  renderer's URL (`http://127.0.0.1:<PREFERRED_PORT>/`) is stable across
 *  launches — otherwise localStorage (used for `gs.onboarding.done`,
 *  `gs.tab`, …) is scoped to a fresh origin every time and the user sees
 *  the wizard pop on every launch. Falls back to an ephemeral port if the
 *  preferred one is taken (e.g. another app squatted it). */
const PREFERRED_PORT = 17891;

/** Start the HTTP server on a stable 127.0.0.1 port (PREFERRED_PORT, or
 *  ephemeral fallback). Resolve with the chosen port so the caller can
 *  `loadURL("http://127.0.0.1:<port>/")`. */
export function startServer(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    mkdirSync(CAPTURE_OUT, { recursive: true });
    const server = createServer(handle);
    const tryListen = (port: number, isFallback: boolean) => {
      server.removeAllListeners("error");
      const onError = (err: NodeJS.ErrnoException) => {
        if (!isFallback && err.code === "EADDRINUSE") {
          dlog("server", `port ${port} in use — falling back to an ephemeral port`);
          tryListen(0, true);
        } else {
          dwarn("server", "listen failed:", err.message);
          reject(err);
        }
      };
      server.on("error", onError);
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          dlog("server", `listening on 127.0.0.1:${addr.port}${isFallback ? " (fallback)" : ""}`);
          resolve({ port: addr.port, server });
        } else reject(new Error("failed to bind"));
      });
    };
    tryListen(PREFERRED_PORT, false);
  });
}
