/**
 * In-process HTTP server that hosts everything the renderer needs:
 *  - Built `apps/renderer/dist/*` at `/`
 *  - `/gamedata/*`  → DERIVED game data (data/derived in dev, bundled tree in prod)
 *  - `/captured/*`  → captured account JSON (tools/capture/out in dev, userData in prod)
 *  - `/img/*`       → either the local outerpedia-v2 checkout (dev) or a 302 to
 *                     `https://outerpedia.com/images/*` (prod)
 *  - `/api/capture/{run,disarm,status}` → wraps the PowerShell pipeline
 *  - `/api/stat-locks` GET/POST → stat regression locks
 *
 * Mirrors the Vite-middleware behavior (apps/renderer/vite.config.ts) so the
 * renderer code is identical across `npm run desktop:dev` (Vite) and a
 * packaged build (this server). ETag-based revalidation on data files keeps
 * the renderer fast after the first hit; images use a 1-day max-age.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import {
  BUNDLED_ADB,
  BUNDLED_MITMDUMP,
  BUNDLED_PROD_CERT_DIR,
  CAPTURE_DIR,
  CAPTURE_OUT,
  DERIVED,
  GAME_DIR,
  SYNC_DIR,
  IMG_CACHE_DIR,
  REPO_SHA_STATE,
  REPO_ROOT,
  IS_DEV,
  STAT_LOCKS,
  RENDERER_DIST,
  findOuterpediaImagesDev,
} from "./paths.js";
import { detectEmulators, pickEmulator, pickPort, preflight } from "./emulator-detect.js";
import { dlog, dwarn } from "./log.js";
import { proxyReco } from "./reco-proxy.js";
import { syncGameData } from "./data-sync.js";
import { serveImg } from "./img-cache.js";
import { getCurrentRef } from "./repo-source.js";
import { getStatus as getUpdateStatus, triggerCheck as triggerUpdateCheck, installUpdate } from "./updater.js";

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
 *  for cheap 304s. */
function serveStatic(req: IncomingMessage, res: ServerResponse, file: string, cacheMode: "etag" | "long"): void {
  if (!existsSync(file)) { res.statusCode = 404; res.end("not found"); return; }
  res.setHeader("Content-Type", mime(file));
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

/** Serve `/<prefix>/...` from a base dir, with path-traversal guard. */
function tryMount(req: IncomingMessage, res: ServerResponse, url: string, prefix: string, dir: string, cacheMode: "etag" | "long"): boolean {
  if (!url.startsWith(prefix)) return false;
  const rel = decodeURIComponent(url.slice(prefix.length));
  const file = normalize(join(dir, rel));
  if (!file.startsWith(dir)) { res.statusCode = 403; res.end("forbidden"); return true; }
  serveStatic(req, res, file, cacheMode);
  return true;
}

/** Spawn a PowerShell script and stream its stdout/stderr verbatim. The
 *  client (apps/renderer/src/capture.ts) consumes lines and looks for the
 *  `__EXIT__:<code>` sentinel that we emit when the child exits. We listen
 *  on 'exit' rather than 'close' because capture.ps1 grandchildren mitmdump
 *  via Start-Process — inherited pipe handles would otherwise keep 'close'
 *  pending until mitmdump itself dies, deadlocking the UI. */
function streamPs(res: ServerResponse, script: string, extraArgs: string[] = []): void {
  if (!existsSync(script)) {
    res.statusCode = 404;
    res.end(`script not found: ${script}\n__EXIT__:127\n`);
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const child = spawn(
    "powershell.exe",
    ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NonInteractive", "-File", script, ...extraArgs],
    { cwd: CAPTURE_DIR, windowsHide: true },
  );
  dlog("capture", `spawn ${script} pid=${child.pid ?? "?"}`, extraArgs);
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (c: string) => res.write(c));
  child.stderr.on("data", (c: string) => res.write(c));
  child.on("error", (err) => {
    dwarn("capture", `spawn error on ${script}:`, err.message);
    res.write(`\n[spawn error] ${err.message}\n__EXIT__:1\n`); res.end();
  });

  let ended = false;
  child.on("exit", (code) => {
    if (ended) return;
    ended = true;
    dlog("capture", `${script} exited code=${code ?? 1}`);
    res.write(`\n__EXIT__:${code ?? 1}\n`);
    res.end();
  });

  // On an abrupt client disconnect while the script is still running, kill the
  // whole process TREE — `child.kill()` only signals powershell.exe, leaving
  // the mitmdump it launched via Start-Process orphaned. `taskkill /T` walks
  // the PID tree. (In the normal armed flow the child has already exited by
  // the time 'close' fires, so this is a no-op and mitmdump survives as
  // intended.) Falls back to child.kill() if taskkill is unavailable.
  res.on("close", () => {
    if (child.killed || child.exitCode != null) return;
    if (child.pid == null) { child.kill(); return; }
    dlog("capture", `client disconnect mid-run — killing process tree pid=${child.pid}`);
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch (err) {
      dwarn("capture", "taskkill /T failed, falling back to child.kill():", (err as Error).message);
      child.kill();
    }
  });
}

/** True iff the capture pipeline is genuinely armed: the `.mitm.pid` file
 *  exists AND the recorded mitmdump process is still alive. If mitmdump
 *  crashed outside a clean disarm the pid file lingers — left unchecked,
 *  `armed` would stick at true forever (and `/wipe` would refuse with 409).
 *  A dead pid is treated as not-armed and the stale file is cleaned up.
 *  (`.mitm.pid` holds the bare process id, written by capture.ps1 via
 *  `$proc.Id | Out-File`.) */
function isArmed(): boolean {
  const pidFile = join(CAPTURE_OUT, ".mitm.pid");
  if (!existsSync(pidFile)) return false;
  let pid = NaN;
  try { pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10); } catch { return true; }
  if (!Number.isFinite(pid) || pid <= 0) return true; // unparseable — assume armed (conservative)
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, never actually signals
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true; // alive, just not ours
    // ESRCH → process gone. Drop the stale pid file so we don't wedge here.
    dlog("capture", `stale .mitm.pid (pid ${pid} gone) — cleaning up`);
    try { rmSync(pidFile, { force: true }); } catch { /* best-effort */ }
    return false;
  }
}

/** GET /api/capture/status — mirrored from the Vite middleware. Used by the
 *  renderer to render the armed/captured chip in the header. */
function captureStatus(res: ServerResponse): void {
  const itemPath = join(CAPTURE_OUT, "user_item.json");
  const sentinel = join(CAPTURE_OUT, ".captured");
  const userItem = existsSync(itemPath) ? statSync(itemPath) : null;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    armed: isArmed(),
    captured: existsSync(sentinel),
    userItemMtime: userItem ? userItem.mtimeMs : null,
  }));
}

/** Resolve the args we hand capture.ps1 / disarm.ps1 so the bundled
 *  binaries are picked up in prod. In dev we pass nothing — the scripts
 *  fall back to their built-in defaults pointing at the LDPlayer-installed
 *  adb + the system mitmproxy + the dev's personal ~/.mitmproxy/ CA.
 *
 *  When an emulator is detected as running, we override `-Adb` with that
 *  emulator's bundled ADB (different protocol versions across LDPlayer /
 *  MuMu / Nox would otherwise mismatch our bundled standard one) and
 *  `-Device 127.0.0.1:<port>` so the script targets the right instance. */
async function captureScriptArgs(): Promise<string[]> {
  const detected = await detectEmulators();
  const chosen = pickEmulator(detected);
  const deviceArgs: string[] = [];
  let adbOverride: string | null = null;
  if (chosen) {
    const port = pickPort(chosen);
    if (port) deviceArgs.push("-Device", `127.0.0.1:${port}`);
    adbOverride = chosen.adbPath;
  }
  if (IS_DEV) return [...deviceArgs, ...(adbOverride ? ["-Adb", adbOverride] : [])];
  return [
    "-Adb", adbOverride ?? BUNDLED_ADB,
    "-Mitmdump", BUNDLED_MITMDUMP,
    "-Out", CAPTURE_OUT,
    // -MitmConfDir tells mitmdump where to load the matching CA from; -CertDir
    // tells capture.ps1 where to find the Android-hash cert file to push.
    // We point both at the same dir — the prod-cert tree generated by
    // fetch-binaries.mjs holds both files side by side.
    "-MitmConfDir", BUNDLED_PROD_CERT_DIR,
    "-CertDir", BUNDLED_PROD_CERT_DIR,
    ...deviceArgs,
  ];
}

/** DNS-rebinding / CSRF guard for the mutating endpoints. A page served from
 *  another origin but pointed at 127.0.0.1 still carries its own hostname in
 *  the `Host` (and `Origin`) header, so requiring a loopback host blocks it
 *  from POSTing to `/api/capture/*` or `/api/stat-locks`. Same-origin
 *  requests from our own renderer always pass. */
function isLocalRequest(req: IncomingMessage): boolean {
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

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = (req.url ?? "/").split("?")[0]!;

  // Reject cross-origin mutations up front (every state-changing endpoint is
  // a POST). GET asset/data routes stay open — they expose nothing sensitive.
  if (req.method === "POST" && !isLocalRequest(req)) {
    res.statusCode = 403;
    res.end("forbidden: non-local origin");
    return;
  }

  // --- capture pipeline endpoints ---
  // captureScriptArgs is async (emulator detection probes TCP ports), so we
  // resolve before spawning. On detection failure (very unlikely — the probe
  // doesn't throw) we surface a synthetic error stream that the renderer
  // already knows how to display.
  if (url === "/api/capture/run" && req.method === "POST") {
    captureScriptArgs().then((args) => streamPs(res, join(CAPTURE_DIR, "capture.ps1"), args))
      .catch((err: Error) => { res.write(`\n[detect error] ${err.message}\n__EXIT__:1\n`); res.end(); });
    return;
  }
  if (url === "/api/capture/disarm" && req.method === "POST") {
    captureScriptArgs().then((args) => streamPs(res, join(CAPTURE_DIR, "disarm.ps1"), args))
      .catch((err: Error) => { res.write(`\n[detect error] ${err.message}\n__EXIT__:1\n`); res.end(); });
    return;
  }
  if (url === "/api/capture/status" && req.method === "GET") {
    return captureStatus(res);
  }
  // Manual "Sync game data" — pull raw tables from the outerpedia repo + rebuild.
  if (url === "/api/data/sync" && req.method === "POST") {
    dlog("server", "manual data sync requested");
    syncGameData({ repoRoot: IS_DEV ? REPO_ROOT : process.resourcesPath, gameDir: GAME_DIR, syncDir: SYNC_DIR, derivedDir: DERIVED, shaStateFile: REPO_SHA_STATE, force: true })
      .then((r) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(r)); })
      .catch((err: Error) => { res.statusCode = 500; res.end(JSON.stringify({ status: "error", message: err.message })); });
    return;
  }
  // --- auto-update — drives the Home tab's inline update card. status is
  // polled; check/install are user actions (Check again / Retry / Install). ---
  if (url === "/api/update/status" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(getUpdateStatus()));
    return;
  }
  if (url === "/api/update/check" && req.method === "POST") {
    triggerUpdateCheck();
    res.statusCode = 204;
    res.end();
    return;
  }
  if (url === "/api/update/install" && req.method === "POST") {
    // 409 when nothing is downloaded yet (button shouldn't be reachable then,
    // but guard against a stale client racing the state).
    res.statusCode = installUpdate() ? 204 : 409;
    res.end();
    return;
  }
  // Build-reco proxy → outerpedia API (Get Preset). GET only, numeric id.
  if (url.startsWith("/api/reco/") && req.method === "GET") {
    const id = url.slice("/api/reco/".length);
    dlog("server", `proxying reco ${id}`);
    void proxyReco(id, res);
    return;
  }
  // Settings → Data → "Wipe captured data". Deletes the user_*.json /
  // item_customInfo.json snapshots so the renderer reverts to its empty
  // state. We refuse while the pipeline is still armed — otherwise the
  // next /user/* fetch would silently re-write what we just nuked.
  if (url === "/api/capture/wipe" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json");
    if (isArmed()) {
      dlog("capture", "wipe refused — pipeline still armed (409)");
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "pipeline armed — disarm first" }));
      return;
    }
    let removed = 0;
    try {
      for (const f of readdirSync(CAPTURE_OUT)) {
        if (f.endsWith(".json") || f === ".captured" || f === "seen-paths.log" || f.endsWith(".flows")) {
          rmSync(join(CAPTURE_OUT, f), { force: true });
          removed++;
        }
      }
    } catch (err) {
      dwarn("capture", "wipe failed:", (err as Error).message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
    dlog("capture", `wiped ${removed} captured file(s)`);
    res.end(JSON.stringify({ removed }));
    return;
  }
  // --- emulator detection — surfaced in the header so the user knows which
  // instance / port we'll target before they click Arm capture. ---
  if (url === "/api/emulators" && req.method === "GET") {
    detectEmulators().then((list) => {
      const chosen = pickEmulator(list);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ detected: list, chosen, chosenPort: chosen ? pickPort(chosen) : null }));
    }).catch((err: Error) => {
      res.statusCode = 500;
      res.end(`detect failed: ${err.message}`);
    });
    return;
  }
  // --- onboarding preflight — sequence of checks (emulator installed,
  // running, ADB connecting, root toggle ON) driven by the wizard UI. ---
  if (url === "/api/preflight" && req.method === "GET") {
    preflight().then((result) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    }).catch((err: Error) => {
      res.statusCode = 500;
      res.end(`preflight failed: ${err.message}`);
    });
    return;
  }

  // --- stat-locks read/write ---
  if (url === "/api/stat-locks" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(existsSync(STAT_LOCKS) ? readFileSync(STAT_LOCKS, "utf-8") : "{}");
    return;
  }
  if (url === "/api/stat-locks" && req.method === "POST") {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    const MAX_BODY = 1_000_000; // ~1 MB — stat-locks snapshots are a few KB
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        res.statusCode = 413;
        res.end("payload too large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        JSON.parse(body); // validate
        mkdirSync(dirname(STAT_LOCKS), { recursive: true });
        writeFileSync(STAT_LOCKS, body, "utf-8");
        res.statusCode = 204;
        res.end();
      } catch (err) {
        res.statusCode = 400;
        res.end(`invalid body: ${(err as Error).message}`);
      }
    });
    return;
  }

  // --- /img/* — disk cache + GitHub CDN, shared with the Vite dev middleware.
  // serveImg resolves: dev local checkout → disk cache → CDN (jsDelivr/raw) +
  // cache → webp fallback → 302 outerpedia.com last resort. Pinned to the same
  // repo SHA the game data was built from so icons match the data snapshot. ---
  if (url.startsWith("/img/")) {
    void serveImg(req, res, url.slice("/img/".length), {
      cacheDir: IMG_CACHE_DIR,
      localCheckoutDir: IS_DEV ? findOuterpediaImagesDev() : null,
      getRef: getCurrentRef,
    }).catch((err: unknown) => {
      dwarn("server", "serveImg failed:", err instanceof Error ? err.message : String(err));
      if (!res.headersSent) { res.statusCode = 500; res.end("image error"); }
    });
    return;
  }

  // --- bundled data mounts ---
  if (tryMount(req, res, url, "/gamedata/", DERIVED, "etag")) return;
  // A missing captured JSON is a normal state (the user may never have hit an
  // optional endpoint like `/archive/info`); the renderer reads null as
  // "absent". Serve 200 null instead of letting tryMount 404 — otherwise it's
  // a red console error on every load.
  if (url.startsWith("/captured/") && url.endsWith(".json")) {
    const rel = decodeURIComponent(url.slice("/captured/".length).split("?")[0]!);
    const file = normalize(join(CAPTURE_OUT, rel));
    if (file.startsWith(CAPTURE_OUT) && !existsSync(file)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end("null");
      return;
    }
  }
  if (tryMount(req, res, url, "/captured/", CAPTURE_OUT, "etag")) return;

  // --- renderer (built Vite dist) ---
  // SPA fallback: any unknown path serves index.html so client-side state
  // (currently tab name in usePersistedState) survives a hard reload.
  const stripped = url === "/" ? "/index.html" : url;
  const file = normalize(join(RENDERER_DIST, stripped));
  if (file.startsWith(RENDERER_DIST) && existsSync(file) && statSync(file).isFile()) {
    serveStatic(req, res, file, "etag");
    return;
  }
  serveStatic(req, res, join(RENDERER_DIST, "index.html"), "etag");
}

/** Tear the capture pipeline down synchronously, if it's still armed. Used
 *  from main.ts on `before-quit` so the user doesn't have to remember to
 *  click Disarm before closing the window — otherwise `mitmdump.exe` and
 *  the device-side iptables redirect survive the Electron exit, and the
 *  next packaged build can't even delete its own bundled mitmdump (file in
 *  use), among other annoyances.
 *
 *  Returns true if a disarm was actually attempted (pipeline was armed).
 *  Uses `spawnSync` so the quit handler can await completion without
 *  needing to plumb a Promise through Electron's `before-quit` lifecycle. */
export async function disarmIfArmed(): Promise<boolean> {
  const pidFile = join(CAPTURE_OUT, ".mitm.pid");
  if (!existsSync(pidFile)) return false;
  dlog("capture", "armed at quit — running disarm.ps1");
  const args = await captureScriptArgs();
  // Async spawn (not spawnSync) so the caller's `await` yields to the event
  // loop instead of freezing it — `before-quit` runs this and a blocking
  // 15 s spawnSync would lock the UI thread for the whole teardown.
  await new Promise<void>((resolve) => {
    const child = spawn("powershell.exe", [
      "-ExecutionPolicy", "Bypass", "-NoLogo", "-NonInteractive",
      "-File", join(CAPTURE_DIR, "disarm.ps1"), ...args,
    ], { cwd: CAPTURE_DIR, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      dwarn("capture", "disarm.ps1 exceeded 15s — killing it");
      try { child.kill(); } catch { /* already gone */ }
      resolve();
    }, 15_000);
    child.on("exit", () => { clearTimeout(timer); resolve(); });
    child.on("error", () => { clearTimeout(timer); resolve(); });
  });
  return true;
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
