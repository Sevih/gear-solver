/**
 * Steam capture source — detection, install and status of the BepInEx plugin
 * that hooks the OUTERPLANE Steam client (tools/capture-steam/).
 *
 * The flow, from the desktop app's point of view:
 *  1. `findOuterplane()` locates the Steam install (registry or known roots →
 *     libraryfolders.vdf → appmanifest_4247320.acf) so the user never types a path.
 *  2. `installSteamPlugin()` drops BepInEx (checksum-verified download from the
 *     official GitHub release, skipped if the game already has one) and our
 *     `GearSolverCapture.dll` into the game folder, then writes the plugin's
 *     config so it points at THIS app's capture folder (CAPTURE_OUT).
 *  3. `steamStatus()` is what the renderer polls (every 5 s — async, with the
 *     Steam root and DLL hashes cached): game installed, BepInEx
 *     present, plugin present + up to date + pointed at the right folder, game
 *     running, and the plugin's heartbeat file (written by the plugin itself)
 *     to tell "live" from "installed but not loaded".
 *
 * Everything OS-specific (Steam roots, process list, launching, unzip, the
 * plugin's view of paths under Proton) goes through `platform()` (platform.ts).
 *
 * Pure Node (fs + child_process) — no Electron deps so the Vite dev middleware
 * can import it too for parity between dev and packaged builds.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import { downloadVerified } from "./download.js";
import { platform } from "./platform.js";
// Committed copy of outerpedia's `data/curated/game-client.json` (the shared
// reference for the Steam client), refreshed by `npm run data:sync`. Bundled at
// build time — never downloaded at runtime, so each release keeps the BepInEx
// version and checksum it was tested with.
import gameClient from "./game-client.json" with { type: "json" };

export const OUTERPLANE_APPID = String(gameClient.steam.appId);
export const GAME_EXE = gameClient.steam.exe;

/** BepInEx 5 (Mono) release we provision when the game has none. Pinned
 *  version + SHA-256 of the official `BepInEx_win_x64_<ver>.zip` asset. */
export const BEPINEX_VERSION = gameClient.bepinex.version;
export const BEPINEX_SHA256 = gameClient.bepinex.sha256;
const BEPINEX_URL = gameClient.bepinex.url;

/** The client outerpedia last read (app version, Steam build, dump date),
 *  shown next to the installed build. */
export const REFERENCE_CLIENT: SteamReferenceClient = {
  version: gameClient.client.version,
  buildId: gameClient.client.buildId,
  dumpedAt: gameClient.client.dumpedAt,
};

/** Plugin identity — must match tools/capture-steam/src/Plugin.cs. BepInEx
 *  names the config file after the GUID. */
export const PLUGIN_GUID = "outerpedia.gearsolver.capture";
export const PLUGIN_DLL = "GearSolverCapture.dll";
const PLUGIN_DIR_NAME = "GearSolverCapture";

// ---------------------------------------------------------------------------
// Steam / game discovery
// ---------------------------------------------------------------------------

/** Steam's install root: HKCU `SteamPath` on Windows (set by the Steam client
 *  itself), then the reference's usual roots for the OS (`steam.roots.windows`,
 *  or `steam.roots.linux` under HOME) — the first that has `steamapps`. Null
 *  when Steam isn't installed. */
export async function findSteamRoot(): Promise<string | null> {
  const os = platform();
  try {
    const reg = os.registrySteamPath ? await os.registrySteamPath() : null;
    if (reg) {
      // The registry value is lower-cased; realpath restores the on-disk
      // casing so the path reads well in the UI.
      const p = realpathSync.native(normalize(reg));
      if (existsSync(join(p, "steamapps"))) return p;
    }
  } catch { /* unreadable path — fall through */ }
  for (const p of os.steamRoots()) {
    if (existsSync(join(p, "steamapps"))) return p;
  }
  return null;
}

/** Steam root cache: the registry lookup is a process spawn, and the root
 *  doesn't move while the app runs. A miss is retried after STEAM_ROOT_MISS_TTL_MS
 *  (Steam may get installed meanwhile). */
const STEAM_ROOT_MISS_TTL_MS = 60_000;
let steamRootCache: { root: string | null; at: number } | null = null;
async function cachedSteamRoot(): Promise<string | null> {
  const c = steamRootCache;
  if (c && (c.root != null ? existsSync(join(c.root, "steamapps")) : Date.now() - c.at < STEAM_ROOT_MISS_TTL_MS)) return c.root;
  const root = await findSteamRoot();
  steamRootCache = { root, at: Date.now() };
  return root;
}

/** Forget the cached Steam root, DLL hashes and launch options (tests). */
export function resetSteamCaches(): void {
  steamRootCache = null;
  hashCache.clear();
  launchOptionsCache.clear();
}

/** Every Steam library folder (the root itself + `libraryfolders.vdf` entries). */
function steamLibraries(root: string): string[] {
  const libs = new Set<string>([root]);
  const vdf = join(root, "steamapps", "libraryfolders.vdf");
  if (existsSync(vdf)) {
    const txt = readFileSync(vdf, "utf-8");
    for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) {
      libs.add(normalize(m[1]!.replace(/\\\\/g, "\\")));
    }
  }
  return [...libs];
}

export interface SteamGame {
  /** `<library>/steamapps/common/OUTERPLANE` */
  gameDir: string;
  /** Steam build id from the app manifest (changes on every game update). */
  buildId: string | null;
}

/** Locate the OUTERPLANE Steam install. Requires the app manifest AND the
 *  Unity Managed dir (a half-uninstalled game leaves an empty folder behind).
 *  The Steam root is cached; the manifest itself is re-read each call (small
 *  file, and its build id changes on every game update). */
export async function findOuterplane(): Promise<SteamGame | null> {
  const root = await cachedSteamRoot();
  if (!root) return null;
  for (const lib of steamLibraries(root)) {
    const manifest = join(lib, "steamapps", `appmanifest_${OUTERPLANE_APPID}.acf`);
    if (!existsSync(manifest)) continue;
    const txt = readFileSync(manifest, "utf-8");
    const installdir = /"installdir"\s+"([^"]+)"/.exec(txt)?.[1] ?? "OUTERPLANE";
    const gameDir = join(lib, "steamapps", "common", installdir);
    if (!existsSync(join(gameDir, "OUTERPLANE_Data", "Managed"))) continue;
    return { gameDir, buildId: /"buildid"\s+"(\d+)"/.exec(txt)?.[1] ?? null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface SteamPluginHeartbeat {
  version: string;
  pid: number;
  startedAt: string;
  pathHook: boolean;
  captures: number;
  lastPath: string | null;
  lastCaptureAt: string | null;
  outDir: string;
}

export interface SteamReferenceClient {
  version: string;
  buildId: string;
  dumpedAt: string;
}

export interface SteamStatus {
  /** OUTERPLANE found in a Steam library. */
  installed: boolean;
  gameDir: string | null;
  buildId: string | null;
  /** The client outerpedia last read (`game-client.json` `client`). */
  reference: SteamReferenceClient;
  /** The installed build is known and differs from the reference's. */
  buildDiffers: boolean;
  bepinex: { present: boolean; version: string | null };
  plugin: {
    present: boolean;
    /** Installed DLL is byte-identical to the one this app ships. */
    upToDate: boolean;
    /** OutDir the installed config points at (null = unset → plugin default). */
    outDir: string | null;
    /** OutDir matches this app's capture folder. */
    outDirOk: boolean;
  };
  /** The bundled plugin DLL exists on this side (false = dev without a build). */
  bundleAvailable: boolean;
  /** OUTERPLANE.exe is running. */
  gameRunning: boolean;
  /** Heartbeat written by the plugin into the capture folder (null = never
   *  loaded / folder mismatch). Its pid must match a running game to count. */
  heartbeat: SteamPluginHeartbeat | null;
  /** Game running AND the plugin's heartbeat belongs to that process. */
  live: boolean;
  /** Everything is in place: installed + plugin present/up to date/pointed at us. */
  ready: boolean;
  /** Proton only: the game's Steam launch options carry the `WINEDLLOVERRIDES`
   *  BepInEx needs (`localconfig.vdf`). Null on Windows or when unreadable. */
  launchOptionsOk: boolean | null;
}

function readBepinexVersion(gameDir: string): string | null {
  // changelog.txt's first line reads "N commits since v5.4.23.4" for a patch
  // build, or the version dir names in cache/ — the BepInEx.dll assembly version
  // isn't readable without a PE parser. LogOutput.log carries "BepInEx 5.4.23.5"
  // once the game ran at least once; prefer that.
  try {
    const log = join(gameDir, "BepInEx", "LogOutput.log");
    if (existsSync(log)) {
      const head = readFileSync(log, "utf-8").slice(0, 400);
      const m = /BepInEx (\d+\.\d+\.\d+(?:\.\d+)?)/.exec(head);
      if (m) return m[1]!;
    }
  } catch { /* unreadable — fall through */ }
  return null;
}

function sha256File(p: string): string | null {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; }
}

/** path → hash, valid while the file's size + mtime are unchanged. The
 *  bundled DLL never changes during a run, the installed one only on
 *  install/update — so the 5 s status poll stops re-hashing both. */
const hashCache = new Map<string, { size: number; mtimeMs: number; hash: string | null }>();
function cachedSha256(p: string): string | null {
  let st;
  try { st = statSync(p); } catch { hashCache.delete(p); return null; }
  const c = hashCache.get(p);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.hash;
  const hash = sha256File(p);
  hashCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, hash });
  return hash;
}

/** Pids of the running OUTERPLANE.exe (empty when not running). */
export async function gamePids(): Promise<number[]> {
  return platform().gamePids(GAME_EXE);
}

function pluginPaths(gameDir: string) {
  return {
    dll: join(gameDir, "BepInEx", "plugins", PLUGIN_DIR_NAME, PLUGIN_DLL),
    cfg: join(gameDir, "BepInEx", "config", `${PLUGIN_GUID}.cfg`),
    core: join(gameDir, "BepInEx", "core", "BepInEx.dll"),
    winhttp: join(gameDir, "winhttp.dll"),
  };
}

function readConfiguredOutDir(cfg: string): string | null {
  try {
    if (!existsSync(cfg)) return null;
    const m = /^\s*OutDir\s*=\s*(.*)$/m.exec(readFileSync(cfg, "utf-8"));
    const v = m?.[1]?.trim() ?? "";
    return v.length ? v : null;
  } catch {
    return null;
  }
}

/** Minimal reader for Valve's text KeyValues (`.vdf`): quoted keys and
 *  values, `{ }` blocks, `//` comments, `\"` / `\\` escapes. Keys are kept as
 *  written; look them up with `vdfChild` (Steam treats them case-insensitively). */
type Vdf = { [key: string]: string | Vdf };
function parseVdf(txt: string): Vdf {
  const root: Vdf = {};
  const stack: Vdf[] = [root];
  let pendingKey: string | null = null;
  let i = 0;
  while (i < txt.length) {
    const c = txt[i]!;
    if (c === "/" && txt[i + 1] === "/") { const nl = txt.indexOf("\n", i); i = nl < 0 ? txt.length : nl + 1; continue; }
    if (c === "{") {
      const block: Vdf = {};
      if (pendingKey != null) stack[stack.length - 1]![pendingKey] = block;
      stack.push(block);
      pendingKey = null;
      i++;
      continue;
    }
    if (c === "}") { if (stack.length > 1) stack.pop(); pendingKey = null; i++; continue; }
    if (c === '"') {
      let out = "";
      i++;
      while (i < txt.length && txt[i] !== '"') {
        if (txt[i] === "\\" && i + 1 < txt.length) { const n = txt[i + 1]!; out += n === "n" ? "\n" : n === "t" ? "\t" : n; i += 2; }
        else out += txt[i++];
      }
      i++;
      if (pendingKey == null) pendingKey = out;
      else { stack[stack.length - 1]![pendingKey] = out; pendingKey = null; }
      continue;
    }
    i++;
  }
  return root;
}

function vdfChild(node: string | Vdf | undefined, key: string): string | Vdf | undefined {
  if (node == null || typeof node === "string") return undefined;
  const k = Object.keys(node).find((n) => n.toLowerCase() === key.toLowerCase());
  return k == null ? undefined : node[k];
}

/** `localconfig.vdf` → does the game's LaunchOptions carry the Proton
 *  override (`WINEDLLOVERRIDES="winhttp=n,b" %command%`, so the game loads
 *  BepInEx's winhttp.dll proxy instead of Wine's builtin one)? Cached on size + mtime: the file is large and the status polls
 *  every 5 s. Null when unreadable. */
const launchOptionsCache = new Map<string, { size: number; mtimeMs: number; ok: boolean | null }>();
function localConfigLaunchOptionsOk(file: string): boolean | null {
  let st;
  try { st = statSync(file); } catch { launchOptionsCache.delete(file); return null; }
  const c = launchOptionsCache.get(file);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.ok;
  let ok: boolean | null;
  try {
    const vdf = parseVdf(readFileSync(file, "utf-8"));
    const app = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps", OUTERPLANE_APPID]
      .reduce<string | Vdf | undefined>((node, key) => vdfChild(node, key), vdf);
    const opts = vdfChild(app, "LaunchOptions");
    ok = typeof opts === "string" && opts.includes("WINEDLLOVERRIDES") && opts.includes("winhttp=n,b");
  } catch {
    ok = null;
  }
  launchOptionsCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, ok });
  return ok;
}

/** The Proton launch option across every Steam account of `steamRoot`
 *  (`userdata/<id>/config/localconfig.vdf`): true if one of them has it,
 *  false if none does, null when no file is readable. */
export function protonLaunchOptionsOk(steamRoot: string): boolean | null {
  const userdata = join(steamRoot, "userdata");
  let ids: string[];
  try { ids = readdirSync(userdata); } catch { return null; }
  let seen = false;
  for (const id of ids) {
    const ok = localConfigLaunchOptionsOk(join(userdata, id, "config", "localconfig.vdf"));
    if (ok) return true;
    if (ok === false) seen = true;
  }
  return seen ? false : null;
}

function sameDir(a: string | null, b: string): boolean {
  if (!a) return false;
  try { return resolve(a).toLowerCase() === resolve(b).toLowerCase(); } catch { return false; }
}

export function readHeartbeat(captureOut: string): SteamPluginHeartbeat | null {
  try {
    const p = join(captureOut, ".steam-plugin.json");
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, "utf-8")) as Partial<SteamPluginHeartbeat>;
    if (typeof j.pid !== "number" || typeof j.version !== "string") return null;
    return {
      version: j.version,
      pid: j.pid,
      startedAt: typeof j.startedAt === "string" ? j.startedAt : "",
      pathHook: Boolean(j.pathHook),
      captures: typeof j.captures === "number" ? j.captures : 0,
      lastPath: typeof j.lastPath === "string" ? j.lastPath : null,
      lastCaptureAt: typeof j.lastCaptureAt === "string" ? j.lastCaptureAt : null,
      outDir: typeof j.outDir === "string" ? j.outDir : "",
    };
  } catch {
    return null;
  }
}

/** The plugin is loaded in a running game: OUTERPLANE runs AND the heartbeat
 *  in `captureOut` belongs to that process. The cheap subset of
 *  `steamStatus().live` (no registry lookup, no DLL hashing) for request-path
 *  checks such as the user_item write-back guard. */
export async function steamPluginLive(captureOut: string): Promise<boolean> {
  const heartbeat = readHeartbeat(captureOut);
  if (!heartbeat) return false;
  return platform().ownsHeartbeat(heartbeat, await gamePids());
}

/** Full status snapshot. `bundledDll` = the plugin DLL this app ships (used
 *  for the up-to-date check); `captureOut` = where the plugin must write. */
export async function steamStatus(captureOut: string, bundledDll: string): Promise<SteamStatus> {
  const [game, pids] = await Promise.all([findOuterplane(), gamePids()]);
  const heartbeat = readHeartbeat(captureOut);
  const live = pids.length > 0 && heartbeat != null && platform().ownsHeartbeat(heartbeat, pids);
  const bundleAvailable = existsSync(bundledDll);
  if (!game) {
    return {
      installed: false, gameDir: null, buildId: null,
      reference: REFERENCE_CLIENT, buildDiffers: false,
      bepinex: { present: false, version: null },
      plugin: { present: false, upToDate: false, outDir: null, outDirOk: false },
      bundleAvailable, gameRunning: pids.length > 0, heartbeat, live, ready: false,
      launchOptionsOk: null,
    };
  }
  const p = pluginPaths(game.gameDir);
  const bepPresent = existsSync(p.core) && existsSync(p.winhttp);
  const present = existsSync(p.dll);
  const upToDate = present && bundleAvailable && cachedSha256(p.dll) === cachedSha256(bundledDll);
  // The config holds the path as the plugin reads it (`Z:\…` under Proton).
  const configured = readConfiguredOutDir(p.cfg);
  const outDir = configured == null ? null : platform().fromPluginPath(configured);
  const outDirOk = sameDir(outDir, captureOut);
  const root = platform().protonLaunchOptions ? await cachedSteamRoot() : null;
  return {
    installed: true, gameDir: game.gameDir, buildId: game.buildId,
    reference: REFERENCE_CLIENT,
    buildDiffers: game.buildId != null && game.buildId !== REFERENCE_CLIENT.buildId,
    bepinex: { present: bepPresent, version: bepPresent ? readBepinexVersion(game.gameDir) : null },
    plugin: { present, upToDate, outDir, outDirOk },
    bundleAvailable,
    gameRunning: pids.length > 0,
    heartbeat, live,
    ready: bepPresent && present && upToDate && outDirOk,
    launchOptionsOk: root ? protonLaunchOptionsOk(root) : null,
  };
}

// ---------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------

/** Write (or update in place) the plugin's BepInEx config so `OutDir` points
 *  at `captureOut`. BepInEx's format is plain `Key = Value` under `[Section]`;
 *  when the plugin runs it re-saves the file with its descriptions, keeping
 *  the values. Other keys the user may have edited are preserved. */
function writePluginConfig(cfg: string, captureOut: string): void {
  mkdirSync(dirname(cfg), { recursive: true });
  let txt = existsSync(cfg) ? readFileSync(cfg, "utf-8") : "";
  if (/^\s*OutDir\s*=/m.test(txt)) {
    txt = txt.replace(/^(\s*OutDir\s*=\s*).*$/m, `$1${captureOut}`);
  } else if (/^\[Capture\]/m.test(txt)) {
    txt = txt.replace(/^\[Capture\]\s*$/m, `[Capture]\n\nOutDir = ${captureOut}`);
  } else {
    txt = `## Settings file was created by the Outerpedia Gear Solver app\n## Plugin GUID: ${PLUGIN_GUID}\n\n[Capture]\n\n## Folder where the decoded snapshots are written (set by the Gear Solver app).\n# Setting type: String\nOutDir = ${captureOut}\n`;
  }
  writeAtomic(cfg, txt);
}

export interface InstallOpts {
  /** Where the plugin must write its snapshots (this app's CAPTURE_OUT). */
  captureOut: string;
  /** The plugin DLL this app ships (tools/capture-steam/dist in dev, bundled resource in prod). */
  bundledDll: string;
  /** Scratch dir for the BepInEx download (userData in prod, .cache in dev). */
  scratchDir: string;
  log: (line: string) => void;
}

/** Ensure BepInEx + the capture plugin are in the game folder and configured.
 *  Idempotent: re-running updates the DLL and the OutDir. Throws on failure
 *  (missing game, download error, copy refused).
 *
 *  Running game: a plugin that is NOT loaded yet can be dropped in while the
 *  game runs (it loads on the next launch) — that's the common first-install
 *  case and we don't force a restart before it. We refuse only when the file
 *  we'd overwrite is locked: BepInEx's winhttp.dll is mapped by the running
 *  process, and our DLL is locked once its heartbeat says it's loaded. */
export async function installSteamPlugin(opts: InstallOpts): Promise<SteamStatus> {
  const { captureOut, bundledDll, scratchDir, log } = opts;
  const game = await findOuterplane();
  if (!game) throw new Error("OUTERPLANE (Steam) not found — install it from Steam first, then retry.");
  log(`>  Game: ${game.gameDir}`);
  if (!existsSync(bundledDll)) {
    throw new Error(`plugin DLL missing: ${bundledDll} — in dev run \`npm run capture-steam:build\` (needs the .NET SDK).`);
  }
  const pids = await gamePids();
  const running = pids.length > 0;
  const hb = readHeartbeat(captureOut);
  const pluginLoaded = running && hb != null && platform().ownsHeartbeat(hb, pids);
  if (pluginLoaded) {
    throw new Error("OUTERPLANE is running with the plugin loaded — close the game, then retry (the plugin file is locked while loaded).");
  }

  const p = pluginPaths(game.gameDir);

  // --- 1. BepInEx runtime -------------------------------------------------
  if (existsSync(p.core) && existsSync(p.winhttp)) {
    log(`v  BepInEx already present${readBepinexVersion(game.gameDir) ? ` (${readBepinexVersion(game.gameDir)})` : ""}.`);
  } else if (running) {
    throw new Error("OUTERPLANE is running and has no BepInEx yet — close the game, then retry (the loader hooks winhttp.dll, which is locked while the game runs).");
  } else {
    log(`>  Downloading BepInEx ${BEPINEX_VERSION} (win x64, ~0.6 MB, one-time)...`);
    mkdirSync(scratchDir, { recursive: true });
    const zip = join(scratchDir, "bepinex.zip");
    const stage = join(scratchDir, "bepinex-stage");
    await downloadVerified(BEPINEX_URL, zip, BEPINEX_SHA256, log, "BepInEx download");
    log(">  Checksum OK - extracting into the game folder...");
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    platform().expandZip(zip, stage);
    if (!existsSync(join(stage, "winhttp.dll")) || !existsSync(join(stage, "BepInEx", "core", "BepInEx.dll"))) {
      throw new Error("BepInEx zip layout unexpected (winhttp.dll / BepInEx/core missing)");
    }
    // Copy the whole tree over the game dir (winhttp.dll + doorstop_config.ini
    // at the root, BepInEx/core underneath). Steam's folder ACL lets the user
    // write here without elevation — the same way Steam itself installs.
    cpSync(stage, game.gameDir, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
    rmSync(zip, { force: true });
    log(`v  BepInEx ${BEPINEX_VERSION} installed.`);
  }

  // --- 2. Plugin DLL -------------------------------------------------------
  mkdirSync(dirname(p.dll), { recursive: true });
  const before = existsSync(p.dll) ? sha256File(p.dll) : null;
  cpSync(bundledDll, p.dll, { force: true });
  const after = sha256File(p.dll);
  log(before == null ? `v  Plugin installed: ${p.dll}` : before === after ? "v  Plugin already up to date." : "v  Plugin updated.");

  // --- 3. Config → OutDir ---------------------------------------------------
  mkdirSync(captureOut, { recursive: true });
  const pluginOut = platform().toPluginPath(captureOut);
  writePluginConfig(p.cfg, pluginOut);
  log(`v  Plugin config → OutDir = ${pluginOut}`);
  log(running
    ? ">  OUTERPLANE is running: restart it to load the plugin, then play to the lobby — snapshots land automatically."
    : ">  Launch OUTERPLANE from Steam and play to the lobby — snapshots land automatically.");

  return steamStatus(captureOut, bundledDll);
}

/** Remove the plugin DLL + its config. BepInEx itself is left in place (other
 *  plugins may rely on it); pass `removeBepinex` to strip it too — only the
 *  files the official zip ships, nothing the user added. */
export async function uninstallSteamPlugin(opts: { captureOut: string; bundledDll: string; log: (line: string) => void; removeBepinex?: boolean }): Promise<SteamStatus> {
  const game = await findOuterplane();
  if (!game) throw new Error("OUTERPLANE (Steam) not found.");
  if ((await gamePids()).length > 0) throw new Error("OUTERPLANE is running — close the game first.");
  const p = pluginPaths(game.gameDir);
  rmSync(dirname(p.dll), { recursive: true, force: true });
  rmSync(p.cfg, { force: true });
  opts.log("v  Plugin removed.");
  if (opts.removeBepinex) {
    const pluginsDir = join(game.gameDir, "BepInEx", "plugins");
    const others = existsSync(pluginsDir) ? readdirSync(pluginsDir).filter((f) => statSync(join(pluginsDir, f)).isDirectory() || f.endsWith(".dll")) : [];
    if (others.length > 0) {
      opts.log(`!  BepInEx kept: other plugins are installed (${others.join(", ")}).`);
    } else {
      for (const f of ["winhttp.dll", "doorstop_config.ini", ".doorstop_version", "changelog.txt"]) rmSync(join(game.gameDir, f), { force: true });
      rmSync(join(game.gameDir, "BepInEx"), { recursive: true, force: true });
      opts.log("v  BepInEx removed.");
    }
  }
  return steamStatus(opts.captureOut, opts.bundledDll);
}

/** Ask Steam to launch the game (`steam://rungameid/<appid>` through the
 *  shell). Fire-and-forget; Steam handles login / updates itself. */
export function launchGame(): void {
  platform().launchGame(OUTERPLANE_APPID);
}
