/**
 * Resolve all the on-disk paths the Electron main process needs, in a way that
 * works both unpacked (dev / `npm run desktop:dev` from inside the monorepo)
 * and packaged (NSIS installer drop on a user's machine).
 *
 * Layout assumptions:
 *  - Dev: the compiled main lives at `apps/desktop/dist/main.js`; all repo
 *    artefacts (data/derived, tools/capture-steam, apps/renderer/dist, the
 *    outerpedia image checkout) live at known offsets relative to the repo root.
 *  - Prod: `electron-builder` copies the bundled trees under
 *    `process.resourcesPath` (see the `extraResources` mapping in this
 *    package's package.json). Anything that needs to be written at runtime
 *    (capture out/, stat locks, …) is stored under
 *    `app.getPath("userData")` so the install dir stays read-only.
 */
import { app } from "electron";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { findOuterpediaCheckout } from "./outerpedia-checkout.js";

const here = dirname(fileURLToPath(import.meta.url));

export const IS_DEV = !app.isPackaged;

/** Monorepo root (../../.. from apps/desktop/dist/main.js). Only meaningful in
 *  dev — in prod the equivalent trees live under `process.resourcesPath`. */
export const REPO_ROOT = normalize(join(here, "..", "..", ".."));

/** Root of the bundled resources tree. Prod uses `resourcesPath`; dev maps
 *  every consumer back to the matching repo directory. */
const RES = IS_DEV ? REPO_ROOT : process.resourcesPath;

/**
 * Persistent cache root for assets + game data synced from the outerpedia repo.
 *  - dev : `<repo>/.cache/outerpedia` (gitignored — the repo trees take over)
 *  - prod: `<userData>/outerpedia-cache` (install dir stays read-only)
 * Everything synced from GitHub at launch lands here so the app updates with
 * game patches without shipping a new build.
 */
export const CACHE_ROOT = IS_DEV ? join(REPO_ROOT, ".cache", "outerpedia") : join(app.getPath("userData"), "outerpedia-cache");

/** Image cache root — `img-cache.ts` writes assets under `<dir>/images/...`. */
export const IMG_CACHE_DIR = CACHE_ROOT;

/** Persisted last-synced repo commit SHA (the data-sync gate + image pin). */
export const REPO_SHA_STATE = join(CACHE_ROOT, "repo-sha.json");

/** Derived game data — `data/derived/*.json` consumed by the renderer. Dev uses
 *  the committed repo tree; prod uses the writable cache (re-downloaded on each
 *  repo update, seeded from BUNDLED_DERIVED on first launch). */
export const DERIVED = IS_DEV ? join(REPO_ROOT, "data", "derived") : join(CACHE_ROOT, "derived");

/** Read-only derived tree shipped in the installer (extraResources). Used only
 *  in prod as the first-launch seed for the writable DERIVED cache. */
export const BUNDLED_DERIVED = join(RES, "data", "derived");

/** Captured account JSON — `user_item.json` etc., written by the Steam
 *  capture plugin (and read back by the renderer). Dev keeps it in the
 *  gitignored repo cache; prod under userData so it survives upgrades and the
 *  install dir stays read-only. */
export const CAPTURE_OUT = IS_DEV
  ? join(REPO_ROOT, ".cache", "capture-out")
  : join(app.getPath("userData"), "capture-out");

/** Built renderer (apps/renderer/dist) — served by the embedded HTTP server in
 *  prod; ignored in dev where Vite serves the same files with HMR. */
export const RENDERER_DIST = IS_DEV ? join(REPO_ROOT, "apps", "renderer", "dist") : join(RES, "renderer", "dist");

/** Steam capture plugin (tools/capture-steam) — the BepInEx DLL the app copies
 *  into the game folder on "Install plugin". Dev reads the local `dotnet build`
 *  output; prod the tree bundled by scripts/fetch-binaries.mjs (extraResources). */
export const STEAM_PLUGIN_DLL = IS_DEV
  ? join(REPO_ROOT, "tools", "capture-steam", "dist", "GearSolverCapture.dll")
  : join(RES, "capture-steam", "GearSolverCapture.dll");

/** Scratch dir for runtime downloads that aren't worth keeping (the BepInEx
 *  zip). Dev uses the gitignored cache, prod userData. */
export const SCRATCH_DIR = IS_DEV ? join(REPO_ROOT, ".cache", "scratch") : join(app.getPath("userData"), "scratch");

/** Bundled UI sprites served under `/img/*` before any network source — the
 *  few `ui/inven/*` sprites the R2 bucket doesn't carry. They live in
 *  `apps/renderer/public/img/` (dev) which Vite copies into `dist/img/` (prod). */
export const BUNDLED_IMG = IS_DEV
  ? join(REPO_ROOT, "apps", "renderer", "public", "img")
  : join(RENDERER_DIST, "img");

/** Outerpedia checkout's staged image tree (`.assets-staging/images`, the
 *  same files the site's R2 bucket serves) — only used in dev as a zero-network
 *  fast path for `/img/*`. Prod goes disk-cache → R2. Checkout lookup:
 *  `OUTERPEDIA_PATH` env → `.env.local` → sibling `../outerpedia`. */
const IMAGES_STAGING = join(".assets-staging", "images");
export function findOuterpediaImagesDev(): string | null {
  const root = findOuterpediaCheckout(REPO_ROOT, IMAGES_STAGING);
  return root ? join(root, IMAGES_STAGING) : null;
}

/** Stat-locks JSON — committable baseline that the renderer reads/writes via
 *  /api/stat-locks. Dev uses the repo path so git history works; prod stores
 *  the user's edits under userData so the install dir stays read-only. */
export const STAT_LOCKS = IS_DEV
  ? join(REPO_ROOT, "data", "stat-locks.json")
  : join(app.getPath("userData"), "stat-locks.json");
