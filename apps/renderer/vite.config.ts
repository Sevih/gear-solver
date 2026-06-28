import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import {
  detectEmulators, pickEmulator, pickPort, preflight,
  resolveCaptureTarget, targetScriptArgs, loadManualDevice, saveManualDevice,
} from "../desktop/src/emulator-detect.js";
import { proxyReco } from "../desktop/src/reco-proxy.js";
import { syncGameData } from "../desktop/src/data-sync.js";
import { serveImg } from "../desktop/src/img-cache.js";
import { getCurrentRef, resolveLatestSha, setCurrentRef, readShaState } from "../desktop/src/repo-source.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DERIVED = join(root, "data", "derived");
const GAME_DIR = join(root, "data", "game");
const STAT_LOCKS = join(root, "data", "stat-locks.json");
const CAPTURE_DIR = join(root, "tools", "capture");
const CAPTURED = join(CAPTURE_DIR, "out");
const CAPTURE_PS1 = join(CAPTURE_DIR, "capture.ps1");
const DISARM_PS1 = join(CAPTURE_DIR, "disarm.ps1");
// Persistent cache for assets/data synced from the outerpedia repo (gitignored).
const CACHE_DIR = join(root, ".cache", "outerpedia");
const REPO_SHA_STATE = join(CACHE_DIR, "repo-sha.json");
// Manual capture-device override — same dev path paths.ts computes (REPO/.cache)
// so the override is shared between `npm run dev` and a dev Electron run.
const MANUAL_DEVICE = join(root, ".cache", "manual-device.json");

// Outerpedia-v2 checkout — serves the public/images/* assets at /img/ so
// equipment art, class icons, effect badges and character portraits render
// without copying gigabytes into gear-solver. `OUTERPEDIA_PATH` env wins;
// otherwise autodetected at the two known checkouts (kept parallel with the
// `findOuterpedia()` helper in data/build.mjs). `normalize` keeps the
// separator consistent with what path.join produces downstream — otherwise
// the file.startsWith(dir) traversal check fails on Windows when one side
// has forward slashes and the other backslashes.
function findOuterpediaImages(): string | null {
  const env = process.env.OUTERPEDIA_PATH;
  const candidates = [
    env ? `${env.replace(/\\/g, "/")}/public/images` : null,
    "C:/Users/Sevih/Documents/Projet perso/outerpedia-v2/public/images",
    "C:/Users/Sevih/Documents/dev/outerpedia/public/images",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (existsSync(p)) return normalize(p);
  return null;
}
const OUTERPEDIA_IMAGES = findOuterpediaImages();

/** Spawn a PowerShell script and stream stdout+stderr as plain text. */
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
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (c: string) => res.write(c));
  child.stderr.on("data", (c: string) => res.write(c));
  child.on("error", (err) => { res.write(`\n[spawn error] ${err.message}\n__EXIT__:1\n`); res.end(); });
  // Listen on 'exit' (fires when the process terminates) rather than 'close'
  // (waits for stdio streams to close too). capture.ps1 starts mitmdump in the
  // background via Start-Process; on Windows the grandchild silently inherits
  // pipe handles, so 'close' would only fire once mitmdump itself dies — but
  // mitmdump stays armed until disarm.ps1 runs, which would deadlock the UI.
  let ended = false;
  child.on("exit", (code) => {
    if (ended) return;
    ended = true;
    res.write(`\n__EXIT__:${code ?? 1}\n`);
    res.end();
  });

  res.on("close", () => { if (!child.killed && child.exitCode == null) child.kill(); });
}

/** Resolve the args the dev-mode middleware hands capture.ps1 / disarm.ps1.
 *  Mirrors the Electron prod server's behavior so swapping between
 *  `npm run dev` and a packaged build is transparent. Detects the running
 *  emulator and overrides the script's `-Adb` / `-Device` defaults so
 *  MuMu / Nox work without the user editing capture.ps1's hardcoded
 *  LDPlayer paths. */
async function detectArgs(): Promise<string[]> {
  // No bundled adb in dev — generic probe relies on a brand's adb being on disk.
  const target = await resolveCaptureTarget(loadManualDevice(MANUAL_DEVICE), null);
  return targetScriptArgs(target);
}

function captureStatus(res: ServerResponse): void {
  const itemPath = join(CAPTURED, "user_item.json");
  const sentinel = join(CAPTURED, ".captured");
  const pidFile = join(CAPTURED, ".mitm.pid");
  const userItem = existsSync(itemPath) ? statSync(itemPath) : null;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    armed: existsSync(pidFile),
    captured: existsSync(sentinel),
    userItemMtime: userItem ? userItem.mtimeMs : null,
  }));
}

/** Serve derived game data and captured account JSON live from the repo dirs,
 *  plus dev-only capture-control endpoints (POST /api/capture/run|disarm,
 *  GET /api/capture/status) that spawn the PowerShell pipeline. */
function localData(): Plugin {
  const mounts: Record<string, string> = { "/gamedata/": DERIVED, "/captured/": CAPTURED };
  return {
    name: "gear-solver-local-data",
    configureServer(server) {
      // Pin /img/* fetches to the repo's latest SHA (once, at startup) so the
      // CDN URLs are cacheable. Dev usually serves from the local checkout
      // anyway; on failure getCurrentRef() stays "main". Fire-and-forget.
      void resolveLatestSha().then((sha) => setCurrentRef(sha ?? readShaState(REPO_SHA_STATE)?.sha ?? "main"));
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = (req.url ?? "").split("?")[0]!;

        // /img/* — local checkout → disk cache → GitHub CDN → webp → 302.
        // Shared with the Electron prod server (server.ts) so dev/prod match.
        if (url.startsWith("/img/")) {
          void serveImg(req, res, url.slice("/img/".length), {
            cacheDir: CACHE_DIR,
            localCheckoutDir: OUTERPEDIA_IMAGES,
            getRef: getCurrentRef,
          }).catch(() => { if (!res.headersSent) { res.statusCode = 500; res.end("image error"); } });
          return;
        }

        if (url === "/api/capture/run" && req.method === "POST") {
          detectArgs().then((args) => streamPs(res, CAPTURE_PS1, args))
            .catch((err: Error) => { res.write(`\n[detect error] ${err.message}\n__EXIT__:1\n`); res.end(); });
          return;
        }
        if (url === "/api/capture/disarm" && req.method === "POST") {
          detectArgs().then((args) => streamPs(res, DISARM_PS1, args))
            .catch((err: Error) => { res.write(`\n[detect error] ${err.message}\n__EXIT__:1\n`); res.end(); });
          return;
        }
        if (url === "/api/capture/status" && req.method === "GET") return captureStatus(res);
        // Auto-update — there's no electron-updater in dev (no packaged app),
        // so mirror the prod `/api/update/*` shape with a static "up to date"
        // payload. Lets the Home tab's update card render faithfully under
        // `npm run dev`; check/install are inert no-ops.
        if (url === "/api/update/status" && req.method === "GET") {
          const ref = getCurrentRef();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            state: "uptodate", version: null, progress: 0, error: null,
            appVersion: desktopPkg.version,
            dataSha: ref && ref !== "main" ? ref.slice(0, 7) : null,
          }));
          return;
        }
        if ((url === "/api/update/check" || url === "/api/update/install") && req.method === "POST") {
          res.statusCode = 204;
          return res.end();
        }
        // Manual "Sync game data" — pull raw tables from the outerpedia repo + rebuild.
        if (url === "/api/data/sync" && req.method === "POST") {
          syncGameData({ repoRoot: root, gameDir: GAME_DIR, syncDir: null, derivedDir: DERIVED, shaStateFile: REPO_SHA_STATE, force: true })
            .then((r) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(r)); })
            .catch((err: Error) => { res.statusCode = 500; res.end(JSON.stringify({ status: "error", message: err.message })); });
          return;
        }
        // Build-reco proxy → outerpedia API (Get Preset). Same route as the
        // Electron prod server so the renderer's fetchReco works in both.
        if (url.startsWith("/api/reco/") && req.method === "GET") {
          void proxyReco(url.slice("/api/reco/".length), res);
          return;
        }
        if (url === "/api/capture/wipe" && req.method === "POST") {
          res.setHeader("Content-Type", "application/json");
          if (existsSync(join(CAPTURED, ".mitm.pid"))) {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: "pipeline armed — disarm first" }));
            return;
          }
          let removed = 0;
          try {
            for (const f of readdirSync(CAPTURED)) {
              if (f.endsWith(".json") || f === ".captured" || f === "seen-paths.log" || f.endsWith(".flows")) {
                rmSync(join(CAPTURED, f), { force: true });
                removed++;
              }
            }
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (err as Error).message }));
            return;
          }
          res.end(JSON.stringify({ removed }));
          return;
        }
        // Emulator detection — same endpoint as the Electron prod server so the
        // renderer's `useEmulator()` hook works identically across dev/prod.
        if (url === "/api/emulators" && req.method === "GET") {
          detectEmulators().then((list) => {
            const chosen = pickEmulator(list);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ detected: list, chosen, chosenPort: chosen ? pickPort(chosen) : null }));
          }).catch((err: Error) => { res.statusCode = 500; res.end(`detect failed: ${err.message}`); });
          return;
        }
        if (url === "/api/preflight" && req.method === "GET") {
          preflight(loadManualDevice(MANUAL_DEVICE), null).then((result) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          }).catch((err: Error) => { res.statusCode = 500; res.end(`preflight failed: ${err.message}`); });
          return;
        }
        // Manual capture-device override — mirrors the Electron server.
        if (url === "/api/capture/manual-device" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(loadManualDevice(MANUAL_DEVICE)));
          return;
        }
        if (url === "/api/capture/manual-device" && req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            try {
              const b = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as { adbPath?: unknown; device?: unknown; clear?: unknown };
              if (b.clear === true) { saveManualDevice(MANUAL_DEVICE, null); res.statusCode = 204; res.end(); return; }
              const adbPath = typeof b.adbPath === "string" ? b.adbPath.trim() : "";
              const device = typeof b.device === "string" ? b.device.trim() : "";
              if (!adbPath || !device) { res.statusCode = 400; res.end(JSON.stringify({ error: "adbPath and device are required" })); return; }
              saveManualDevice(MANUAL_DEVICE, { adbPath, device });
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ adbPath, device }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: (err as Error).message }));
            }
          });
          return;
        }
        // Stat regression locks — persisted at data/stat-locks.json (committable
        // so the maintainer can see the lock evolution via git history, vs
        // localStorage which lives only in the user's browser).
        if (url === "/api/stat-locks" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(existsSync(STAT_LOCKS) ? readFileSync(STAT_LOCKS, "utf-8") : "{}");
          return;
        }
        if (url === "/api/stat-locks" && req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
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

        // Captured user_item write-back (equip / unequip edits) — mirrors the
        // Electron prod server. The renderer applies the core equip helpers and
        // POSTs the full rewritten snapshot; we validate + write it. Refused
        // while armed so a capture can't clobber the edit (mirrors wipe).
        if (url === "/api/captured/user-item" && req.method === "POST") {
          res.setHeader("Content-Type", "application/json");
          if (existsSync(join(CAPTURED, ".mitm.pid"))) {
            res.statusCode = 409;
            return res.end(JSON.stringify({ error: "pipeline armed — disarm first" }));
          }
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            try {
              const body = Buffer.concat(chunks).toString("utf-8");
              const parsed = JSON.parse(body) as { ItemList?: unknown };
              if (!Array.isArray(parsed.ItemList)) throw new Error("missing ItemList[]");
              writeFileSync(join(CAPTURED, "user_item.json"), body, "utf-8");
              res.statusCode = 204;
              res.end();
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: (err as Error).message }));
            }
          });
          return;
        }

        for (const [prefix, dir] of Object.entries(mounts)) {
          if (!url.startsWith(prefix)) continue;
          const rel = decodeURIComponent(url.slice(prefix.length));
          const file = normalize(join(dir, rel));
          if (!file.startsWith(dir)) {
            res.statusCode = 404;
            return res.end("not found");
          }
          if (!existsSync(file)) {
            // A missing captured file is a normal state (e.g. the user never
            // hit `/archive/info`, so user_archive.json was never written) —
            // the renderer treats null as "absent". Serve 200 null instead of
            // 404 so it doesn't show up as a red console error.
            if (prefix === "/captured/" && extname(file).toLowerCase() === ".json") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              return res.end("null");
            }
            res.statusCode = 404;
            return res.end("not found");
          }
          const ext = extname(file).toLowerCase();
          const ct = ext === ".json" ? "application/json"
            : ext === ".webp" ? "image/webp"
            : ext === ".png" ? "image/png"
            : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
            : ext === ".svg" ? "image/svg+xml"
            : "application/octet-stream";
          res.setHeader("Content-Type", ct);
          // Aggressive cache via `mtime` ETag so the browser short-circuits
          // every gamedata/captured fetch after the first load. Re-running
          // `data/build.mjs` or a fresh capture bumps mtime → ETag misses
          // → fresh body. Images already had a static max-age.
          if (prefix === "/img/") {
            res.setHeader("Cache-Control", "public, max-age=86400");
          } else {
            const st = statSync(file);
            const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
            if (req.headers["if-none-match"] === etag) {
              res.statusCode = 304;
              return res.end();
            }
            res.setHeader("ETag", etag);
            res.setHeader("Cache-Control", "no-cache"); // revalidate via ETag, don't skip
          }
          return createReadStream(file).pipe(res);
        }
        next();
      });
    },
  };
}

// The desktop package owns the shipped version (NSIS installer + auto-update
// both read it from apps/desktop/package.json), so inline its value here at
// build time and expose it to the renderer via `import.meta.env.VITE_APP_VERSION`.
// Bumping the version in just one place — apps/desktop/package.json — keeps the
// header pill, the installer filename, and the electron-updater feed in sync.
const desktopPkg = JSON.parse(readFileSync(fileURLToPath(new URL("../desktop/package.json", import.meta.url)), "utf-8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss(), localData()],
  // `strictPort` so a leftover Vite (zombie holding 5173 from a previous run)
  // makes the new dev server FAIL LOUDLY instead of silently sliding to 5174 —
  // Electron hard-loads localhost:5173 (main.ts DEV_URL), so a silent port shift
  // would connect it to the stale server and serve old code after a "restart".
  server: { port: 5173, strictPort: true },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(desktopPkg.version),
  },
  resolve: {
    alias: {
      "@gear-solver/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
