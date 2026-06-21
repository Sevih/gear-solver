import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DERIVED = join(root, "data", "derived");
const STAT_LOCKS = join(root, "data", "stat-locks.json");
const CAPTURE_DIR = join(root, "tools", "capture");
const CAPTURED = join(CAPTURE_DIR, "out");
const CAPTURE_PS1 = join(CAPTURE_DIR, "capture.ps1");
const DISARM_PS1 = join(CAPTURE_DIR, "disarm.ps1");

// Outerpedia-v2 checkout — serves the public/images/* assets at /img/ so
// equipment art, class icons, effect badges and character portraits render
// without copying gigabytes into gear-solver. Autodetected like sync.ps1.
// `normalize` keeps the separator consistent with what path.join produces
// downstream — otherwise the file.startsWith(dir) traversal check fails on
// Windows when one side has forward slashes and the other backslashes.
function findOuterpediaImages(): string | null {
  for (const p of [
    "C:/Users/Sevih/Documents/Projet perso/outerpedia-v2/public/images",
    "C:/Users/Sevih/Documents/dev/outerpedia/public/images",
  ]) if (existsSync(p)) return normalize(p);
  return null;
}
const OUTERPEDIA_IMAGES = findOuterpediaImages();

/** Spawn a PowerShell script and stream stdout+stderr as plain text. */
function streamPs(res: ServerResponse, script: string): void {
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
    ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NonInteractive", "-File", script],
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

        if (url === "/api/capture/run" && req.method === "POST") return streamPs(res, CAPTURE_PS1);
        if (url === "/api/capture/disarm" && req.method === "POST") return streamPs(res, DISARM_PS1);
        if (url === "/api/capture/status" && req.method === "GET") return captureStatus(res);
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
          if (prefix === "/img/") res.setHeader("Cache-Control", "public, max-age=86400");
          return createReadStream(file).pipe(res);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localData()],
  server: { port: 5173 },
  resolve: {
    alias: {
      "@gear-solver/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
