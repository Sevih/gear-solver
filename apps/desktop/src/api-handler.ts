/**
 * The renderer's backend API, shared by the Electron prod server (server.ts)
 * and the Vite dev middleware (apps/renderer/vite.config.ts). Both used to
 * carry their own ~430-line copy, and the copies drifted: the dev mirror
 * judged the capture pipeline "armed" by the mere presence of `.mitm.pid`
 * (a crashed mitmdump wedged it armed forever) and killed only powershell.exe
 * on a client disconnect, orphaning the mitmdump it had started.
 *
 * Routes served here:
 *  - `/gamedata/*`  → derived game data (ETag revalidation)
 *  - `/captured/*`  → captured account JSON (a missing `.json` is `200 null`)
 *  - `/img/*`       → bundled sprites / local checkout / disk cache / R2
 *  - `/api/capture/{run,disarm,status,wipe,manual-device}`, `/api/preflight`,
 *    `/api/emulators` → emulator source (PowerShell pipeline)
 *  - `/api/steam/{status,install,uninstall,launch}` → Steam source
 *  - `/api/data/sync`, `/api/reco/:id`, `/api/stat-locks`,
 *    `/api/captured/user-item`, `/api/update/*`
 *
 * What differs between dev and prod is injected (`ApiConfig`): the paths,
 * the capture-script arguments, the mitmdump provisioning step and the
 * auto-updater. Electron-free on purpose — nothing here imports `electron`
 * or paths.ts — so Vite can load it.
 */
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
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import {
  detectEmulators, pickEmulator, pickPort, preflight,
  loadManualDevice, saveManualDevice,
  type ManualDevice,
} from "./emulator-detect.js";
import { dlog, dwarn } from "./log.js";
import { installSteamPlugin, launchGame, steamStatus, uninstallSteamPlugin } from "./steam-capture.js";
import { proxyReco } from "./reco-proxy.js";
import { syncGameData } from "./data-sync.js";
import { serveImg, type ImgCacheOptions } from "./img-cache.js";

export interface ApiConfig {
  /** tools/capture — PowerShell entrypoints (capture.ps1 / disarm.ps1). */
  captureDir: string;
  /** Captured account JSON + `.mitm.pid` + the Steam plugin heartbeat. */
  captureOut: string;
  /** Derived game data served under /gamedata/ and refreshed by /api/data/sync. */
  derivedDir: string;
  /** Persisted last-synced outerpedia SHA (data-sync gate). */
  repoShaState: string;
  statLocks: string;
  manualDevice: string;
  steamPluginDll: string;
  scratchDir: string;
  /** adb handed to the onboarding preflight (prod: the bundled one; dev: none). */
  bundledAdb: string | null;
  img: ImgCacheOptions;
  /** Arguments for capture.ps1 / disarm.ps1 (detected emulator, bundled binaries). */
  captureScriptArgs: () => Promise<string[]>;
  /** Runs before capture.ps1 — prod provisions mitmdump, streaming progress. */
  prepareCapture?: (log: (line: string) => void) => Promise<void>;
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

/** Serve `/<prefix>/...` from a base dir, with path-traversal guard. */
function tryMount(req: IncomingMessage, res: ServerResponse, url: string, prefix: string, dir: string, cacheMode: "etag" | "long"): boolean {
  if (!url.startsWith(prefix)) return false;
  const rel = decodeURIComponent(url.slice(prefix.length));
  const file = normalize(join(dir, rel));
  if (!file.startsWith(dir)) { res.statusCode = 403; res.end("forbidden"); return true; }
  serveStatic(req, res, file, cacheMode);
  return true;
}

/** Flip a response into unbuffered plain-text streaming mode (the capture
 *  console protocol). Idempotent — the mitmdump provisioning step may have
 *  already streamed progress lines through the same response before streamPs
 *  takes over. */
function beginStream(res: ServerResponse): void {
  if (res.headersSent) return;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

/** Spawn a PowerShell script and stream its stdout/stderr verbatim. The
 *  client (apps/renderer/src/capture.ts) consumes lines and looks for the
 *  `__EXIT__:<code>` sentinel that we emit when the child exits. We listen
 *  on 'exit' rather than 'close' because capture.ps1 grandchildren mitmdump
 *  via Start-Process — inherited pipe handles would otherwise keep 'close'
 *  pending until mitmdump itself dies, deadlocking the UI. */
function streamPs(res: ServerResponse, cwd: string, script: string, extraArgs: string[] = []): void {
  if (!existsSync(script)) {
    res.statusCode = 404;
    res.end(`script not found: ${script}\n__EXIT__:127\n`);
    return;
  }
  beginStream(res);

  const child = spawn(
    "powershell.exe",
    ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NonInteractive", "-File", script, ...extraArgs],
    { cwd, windowsHide: true },
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
export function isArmed(captureOut: string): boolean {
  const pidFile = join(captureOut, ".mitm.pid");
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

/** DNS-rebinding / CSRF guard for the mutating endpoints. A page served from
 *  another origin but pointed at 127.0.0.1 still carries its own hostname in
 *  the `Host` (and `Origin`) header, so requiring a loopback host blocks it
 *  from POSTing to `/api/capture/*` or `/api/stat-locks`. Same-origin
 *  requests from our own renderer always pass. */
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
 *  console protocol (same `__EXIT__:<code>` sentinel as streamPs, so the
 *  renderer's streamCapture() consumes both). */
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

/** `readBody` + JSON.parse; a parse error answers 400 and never calls `ok`. */
function readJsonBody(req: IncomingMessage, res: ServerResponse, maxBytes: number, ok: (body: unknown) => void): void {
  readBody(req, res, maxBytes, (raw) => {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
    ok(body);
  });
}

/** Build the request handler. It returns false for a URL it doesn't own (the
 *  renderer's own files), so the caller can fall through. */
export function createApiHandler(cfg: ApiConfig): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { captureDir, captureOut } = cfg;

  /** GET /api/capture/status — the armed/captured chip in the header. */
  function captureStatus(res: ServerResponse): void {
    const itemPath = join(captureOut, "user_item.json");
    const sentinel = join(captureOut, ".captured");
    const userItem = existsSync(itemPath) ? statSync(itemPath) : null;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      armed: isArmed(captureOut),
      captured: existsSync(sentinel),
      userItemMtime: userItem ? userItem.mtimeMs : null,
    }));
  }

  return (req, res) => {
    const url = (req.url ?? "/").split("?")[0]!;

    // Reject cross-origin mutations up front (every state-changing endpoint is
    // a POST). GET asset/data routes stay open — they expose nothing sensitive.
    if (req.method === "POST" && !isLocalRequest(req)) {
      res.statusCode = 403;
      res.end("forbidden: non-local origin");
      return true;
    }

    // --- capture pipeline endpoints ---
    // captureScriptArgs is async (emulator detection probes TCP ports), so we
    // resolve before spawning. On failure we surface a synthetic error stream
    // that the renderer already knows how to display.
    if (url === "/api/capture/run" && req.method === "POST") {
      // Prod, first run on a machine: pull mitmdump (checksum-verified) before
      // arming — progress lines share the capture console (mitm-provision.ts).
      const prepare = cfg.prepareCapture ?? (async () => {});
      prepare((line) => { beginStream(res); res.write(`${line}\n`); })
        .then(() => cfg.captureScriptArgs())
        .then((args) => streamPs(res, captureDir, join(captureDir, "capture.ps1"), args))
        .catch((err: Error) => { beginStream(res); res.write(`\n[setup error] ${err.message}\n__EXIT__:1\n`); res.end(); });
      return true;
    }
    if (url === "/api/capture/disarm" && req.method === "POST") {
      cfg.captureScriptArgs().then((args) => streamPs(res, captureDir, join(captureDir, "disarm.ps1"), args))
        .catch((err: Error) => { beginStream(res); res.write(`\n[detect error] ${err.message}\n__EXIT__:1\n`); res.end(); });
      return true;
    }
    if (url === "/api/capture/status" && req.method === "GET") {
      captureStatus(res);
      return true;
    }
    // Manual "Sync game data" — pull the solver artifacts from the outerpedia repo.
    if (url === "/api/data/sync" && req.method === "POST") {
      dlog("server", "manual data sync requested");
      syncGameData({ derivedDir: cfg.derivedDir, shaStateFile: cfg.repoShaState, force: true })
        .then((r) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(r)); })
        .catch((err: Error) => { res.statusCode = 500; res.end(JSON.stringify({ status: "error", message: err.message })); });
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
    // Settings → Data → "Wipe captured data". Deletes the user_*.json /
    // item_customInfo.json snapshots so the renderer reverts to its empty
    // state. We refuse while the pipeline is still armed — otherwise the
    // next /user/* fetch would silently re-write what we just nuked.
    if (url === "/api/capture/wipe" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      if (isArmed(captureOut)) {
        dlog("capture", "wipe refused — pipeline still armed (409)");
        res.statusCode = 409;
        res.end(JSON.stringify({ error: "pipeline armed — disarm first" }));
        return true;
      }
      let removed = 0;
      try {
        for (const f of readdirSync(captureOut)) {
          if (f.endsWith(".json") || f === ".captured" || f === "seen-paths.log" || f.endsWith(".flows")) {
            rmSync(join(captureOut, f), { force: true });
            removed++;
          }
        }
      } catch (err) {
        dwarn("capture", "wipe failed:", (err as Error).message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: (err as Error).message }));
        return true;
      }
      dlog("capture", `wiped ${removed} captured file(s)`);
      res.end(JSON.stringify({ removed }));
      return true;
    }
    // --- Steam source: BepInEx plugin in the Steam client (steam-capture.ts) ---
    if (url === "/api/steam/status" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(steamStatus(captureOut, cfg.steamPluginDll)));
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
        try {
          // An empty body means "plugin only" (the renderer may POST none).
          const removeBepinex = raw ? Boolean((JSON.parse(raw) as { removeBepinex?: unknown } | null)?.removeBepinex) : false;
          const lines: string[] = [];
          const status = uninstallSteamPlugin({ captureOut, bundledDll: cfg.steamPluginDll, log: (l) => lines.push(l), removeBepinex });
          res.end(JSON.stringify({ status, lines }));
        } catch (err) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return true;
    }
    if (url === "/api/steam/launch" && req.method === "POST") {
      launchGame();
      res.statusCode = 204;
      res.end();
      return true;
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
      return true;
    }
    // --- onboarding preflight — sequence of checks (emulator installed,
    // running, ADB connecting, root toggle ON) driven by the wizard UI. ---
    if (url === "/api/preflight" && req.method === "GET") {
      preflight(loadManualDevice(cfg.manualDevice), cfg.bundledAdb).then((result) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      }).catch((err: Error) => {
        res.statusCode = 500;
        res.end(`preflight failed: ${err.message}`);
      });
      return true;
    }
    // --- manual capture-device override (Settings → Setup → Manual device).
    // GET returns the persisted {adbPath, device} or null; POST persists it
    // ({clear:true} wipes it). Lets any rooted emulator we lack a brand profile
    // for be driven by hand. ---
    if (url === "/api/capture/manual-device" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(loadManualDevice(cfg.manualDevice)));
      return true;
    }
    if (url === "/api/capture/manual-device" && req.method === "POST") {
      readJsonBody(req, res, 100_000, (body) => {
        const b = (body ?? {}) as { adbPath?: unknown; device?: unknown; clear?: unknown };
        if (b.clear === true) { saveManualDevice(cfg.manualDevice, null); res.statusCode = 204; res.end(); return; }
        const adbPath = typeof b.adbPath === "string" ? b.adbPath.trim() : "";
        const device = typeof b.device === "string" ? b.device.trim() : "";
        if (!adbPath || !device) { res.statusCode = 400; res.end(JSON.stringify({ error: "adbPath and device are required" })); return; }
        const md: ManualDevice = { adbPath, device };
        saveManualDevice(cfg.manualDevice, md);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(md));
      });
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
          mkdirSync(dirname(cfg.statLocks), { recursive: true });
          writeFileSync(cfg.statLocks, body, "utf-8");
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
    // Refused while armed so the next /user/item capture can't clobber the edit
    // (mirrors /api/capture/wipe).
    if (url === "/api/captured/user-item" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      if (isArmed(captureOut)) {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: "pipeline armed — disarm first" }));
        return true;
      }
      // ~32 MB — a large account's user_item.json
      readBody(req, res, 32_000_000, (body) => {
        try {
          const parsed = JSON.parse(body) as { ItemList?: unknown };
          if (!Array.isArray(parsed.ItemList)) throw new Error("missing ItemList[]");
          writeFileSync(join(captureOut, "user_item.json"), body, "utf-8");
          dlog("capture", `user_item.json rewritten (${parsed.ItemList.length} items)`);
          res.statusCode = 204;
          res.end();
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
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
      const rel = decodeURIComponent(url.slice("/captured/".length));
      const file = normalize(join(captureOut, rel));
      if (file.startsWith(captureOut) && !existsSync(file)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end("null");
        return true;
      }
    }
    if (tryMount(req, res, url, "/captured/", captureOut, "etag")) return true;

    return false;
  };
}
