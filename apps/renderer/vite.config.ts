import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, normalize } from "node:path";
import { resolveCaptureTarget, targetScriptArgs, loadManualDevice } from "../desktop/src/emulator-detect.js";
import { createApiHandler } from "../desktop/src/api-handler.js";
import { getCurrentRef, resolveLatestSha, setCurrentRef, readShaState } from "../desktop/src/repo-source.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const DERIVED = join(root, "data", "derived");
const STAT_LOCKS = join(root, "data", "stat-locks.json");
const CAPTURE_DIR = join(root, "tools", "capture");
const CAPTURED = join(CAPTURE_DIR, "out");
// Persistent cache for assets/data synced from the outerpedia repo (gitignored).
const CACHE_DIR = join(root, ".cache", "outerpedia");
const REPO_SHA_STATE = join(CACHE_DIR, "repo-sha.json");
// Manual capture-device override — same dev path paths.ts computes (REPO/.cache)
// so the override is shared between `npm run dev` and a dev Electron run.
const MANUAL_DEVICE = join(root, ".cache", "manual-device.json");
// Steam capture source — the BepInEx plugin built by `npm run capture-steam:build`
// (tools/capture-steam/dist) and a scratch dir for the one-time BepInEx download.
const STEAM_PLUGIN_DLL = join(root, "tools", "capture-steam", "dist", "GearSolverCapture.dll");
const SCRATCH_DIR = join(root, ".cache", "scratch");

// Outerpedia checkout's staged image tree (`.assets-staging/images` — the same
// files the site's R2 bucket serves) mounted at /img/ so equipment art, class
// icons, effect badges and character portraits render without copying
// gigabytes into gear-solver. `OUTERPEDIA_PATH` env wins. `normalize` keeps
// the separator consistent with what path.join produces downstream — otherwise
// the file.startsWith(dir) traversal check fails on Windows when one side
// has forward slashes and the other backslashes.
function findOuterpediaImages(): string | null {
  const env = process.env.OUTERPEDIA_PATH;
  const candidates = [
    env ? `${env.replace(/\\/g, "/")}/.assets-staging/images` : null,
    // Both dev machines' checkout locations — first one that exists wins.
    "C:/Users/Sevih/Documents/Projet perso/outerpedia/.assets-staging/images",
    "C:/Users/Sevih/Documents/dev/outerpedia-v3/.assets-staging/images",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (existsSync(p)) return normalize(p);
  return null;
}
const OUTERPEDIA_IMAGES = findOuterpediaImages();
// Bundled UI sprites (the `ui/inven/*` set absent from R2) — same public/img
// tree Vite serves statically, but /img/* is intercepted by serveImg below, so
// it must know where to find them.
const BUNDLED_IMG = join(root, "apps", "renderer", "public", "img");

/** Resolve the args the dev-mode middleware hands capture.ps1 / disarm.ps1.
 *  Detects the running emulator and overrides the script's `-Adb` /
 *  `-Device` defaults so MuMu / Nox work without the user editing
 *  capture.ps1's hardcoded LDPlayer paths. */
async function detectArgs(): Promise<string[]> {
  // No bundled adb in dev — generic probe relies on a brand's adb being on disk.
  const target = await resolveCaptureTarget(loadManualDevice(MANUAL_DEVICE), null);
  return targetScriptArgs(target);
}

/** Mount the shared backend API (apps/desktop/src/api-handler.ts — the very
 *  handler the Electron prod server runs) on the dev server, wired to the repo
 *  dirs: derived game data, captured account JSON, the PowerShell capture
 *  pipeline, the Steam source, images, stat-locks. Only the auto-updater
 *  differs: there is no packaged app in dev, so it reports a static "up to
 *  date" payload and check/install are no-ops. */
function localData(): Plugin {
  const api = createApiHandler({
    captureDir: CAPTURE_DIR,
    captureOut: CAPTURED,
    derivedDir: DERIVED,
    repoShaState: REPO_SHA_STATE,
    statLocks: STAT_LOCKS,
    manualDevice: MANUAL_DEVICE,
    steamPluginDll: STEAM_PLUGIN_DLL,
    scratchDir: SCRATCH_DIR,
    bundledAdb: null,
    img: { cacheDir: CACHE_DIR, bundledDir: BUNDLED_IMG, localCheckoutDir: OUTERPEDIA_IMAGES },
    captureScriptArgs: detectArgs,
    update: {
      status: () => {
        const ref = getCurrentRef();
        return {
          state: "uptodate", version: null, progress: 0, error: null,
          appVersion: desktopPkg.version,
          dataSha: ref && ref !== "main" ? ref.slice(0, 7) : null,
        };
      },
      check: () => {},
      install: () => true,
    },
  });
  return {
    name: "gear-solver-local-data",
    configureServer(server) {
      // Pin /img/* fetches to the repo's latest SHA (once, at startup) so the
      // CDN URLs are cacheable. Dev usually serves from the local checkout
      // anyway; on failure getCurrentRef() stays "main". Fire-and-forget.
      void resolveLatestSha().then((sha) => setCurrentRef(sha ?? readShaState(REPO_SHA_STATE)?.sha ?? "main"));
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        if (!api(req, res)) next();
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
