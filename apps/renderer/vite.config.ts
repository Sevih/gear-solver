import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { detectEmulators, pickEmulator, pickPort, preflight } from "../desktop/src/emulator-detect.js";
import { proxyReco } from "../desktop/src/reco-proxy.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DERIVED = join(root, "data", "derived");
const STAT_LOCKS = join(root, "data", "stat-locks.json");
const CAPTURE_DIR = join(root, "tools", "capture");
const CAPTURED = join(CAPTURE_DIR, "out");
const CAPTURE_PS1 = join(CAPTURE_DIR, "capture.ps1");
const DISARM_PS1 = join(CAPTURE_DIR, "disarm.ps1");

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
  const detected = await detectEmulators();
  const chosen = pickEmulator(detected);
  const args: string[] = [];
  if (chosen) {
    args.push("-Adb", chosen.adbPath);
    const port = pickPort(chosen);
    if (port) args.push("-Device", `127.0.0.1:${port}`);
  }
  return args;
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
  if (OUTERPEDIA_IMAGES) mounts["/img/"] = OUTERPEDIA_IMAGES;
  return {
    name: "gear-solver-local-data",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = (req.url ?? "").split("?")[0]!;

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
          preflight().then((result) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          }).catch((err: Error) => { res.statusCode = 500; res.end(`preflight failed: ${err.message}`); });
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

        for (const [prefix, dir] of Object.entries(mounts)) {
          if (!url.startsWith(prefix)) continue;
          const rel = decodeURIComponent(url.slice(prefix.length));
          const file = normalize(join(dir, rel));
          if (!file.startsWith(dir) || !existsSync(file)) {
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
  server: { port: 5173 },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(desktopPkg.version),
  },
  resolve: {
    alias: {
      "@gear-solver/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
