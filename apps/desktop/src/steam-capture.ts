/**
 * Steam capture source — detection, install and status of the BepInEx plugin
 * that hooks the OUTERPLANE Steam client (tools/capture-steam/).
 *
 * The flow, from the desktop app's point of view:
 *  1. `findOuterplane()` locates the Steam install (registry → libraryfolders.vdf
 *     → appmanifest_4247320.acf) so the user never types a path.
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
 * Pure Node (fs + child_process) — no Electron deps so the Vite dev middleware
 * can import it too for parity between dev and packaged builds.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { downloadVerified, expandZip } from "./download.js";

export const OUTERPLANE_APPID = "4247320";
export const GAME_EXE = "OUTERPLANE.exe";

/** BepInEx 5 (Mono) release we provision when the game has none. Pinned
 *  version + SHA-256 of the official `BepInEx_win_x64_<ver>.zip` asset. */
export const BEPINEX_VERSION = "5.4.23.5";
export const BEPINEX_SHA256 = "82f9878551030f54657792c0740d9d51a09500eeae1fba21106b0c441e6732c4";
const BEPINEX_URL = `https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x64_${BEPINEX_VERSION}.zip`;

/** Plugin identity — must match tools/capture-steam/src/Plugin.cs. BepInEx
 *  names the config file after the GUID. */
export const PLUGIN_GUID = "outerpedia.gearsolver.capture";
export const PLUGIN_DLL = "GearSolverCapture.dll";
const PLUGIN_DIR_NAME = "GearSolverCapture";

// ---------------------------------------------------------------------------
// Steam / game discovery
// ---------------------------------------------------------------------------

/** Run a helper exe asynchronously and resolve with its stdout ("" on any
 *  failure — missing exe, timeout, non-zero exit). Never blocks the main
 *  process, which also serves the renderer's HTTP. */
function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolveRun) => {
    execFile(file, args, { windowsHide: true, encoding: "utf-8", timeout }, (_err, stdout) => resolveRun(stdout || ""));
  });
}

/** Steam's install root: HKCU `SteamPath` (set by the Steam client itself),
 *  then the usual default. Null when Steam isn't installed. */
export async function findSteamRoot(): Promise<string | null> {
  try {
    const stdout = await run("reg.exe", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], 3000);
    const m = /SteamPath\s+REG_SZ\s+(.+)$/im.exec(stdout);
    if (m?.[1]) {
      // The registry value is lower-cased; realpath restores the on-disk
      // casing so the path reads well in the UI.
      const p = realpathSync.native(normalize(m[1].trim()));
      if (existsSync(join(p, "steamapps"))) return p;
    }
  } catch { /* unreadable path — fall through */ }
  for (const p of ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]) {
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

/** Forget the cached Steam root and DLL hashes (tests). */
export function resetSteamCaches(): void {
  steamRootCache = null;
  hashCache.clear();
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

export interface SteamStatus {
  /** OUTERPLANE found in a Steam library. */
  installed: boolean;
  gameDir: string | null;
  buildId: string | null;
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

/** `tasklist` pids for OUTERPLANE.exe (empty when not running). */
export async function gamePids(): Promise<number[]> {
  const stdout = await run("tasklist.exe", ["/FI", `IMAGENAME eq ${GAME_EXE}`, "/FO", "CSV", "/NH"], 4000);
  const pids: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^"[^"]+","(\d+)"/.exec(line.trim());
    if (m) pids.push(Number(m[1]));
  }
  return pids;
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

/** Full status snapshot. `bundledDll` = the plugin DLL this app ships (used
 *  for the up-to-date check); `captureOut` = where the plugin must write. */
export async function steamStatus(captureOut: string, bundledDll: string): Promise<SteamStatus> {
  const [game, pids] = await Promise.all([findOuterplane(), gamePids()]);
  const heartbeat = readHeartbeat(captureOut);
  const live = pids.length > 0 && heartbeat != null && pids.includes(heartbeat.pid);
  const bundleAvailable = existsSync(bundledDll);
  if (!game) {
    return {
      installed: false, gameDir: null, buildId: null,
      bepinex: { present: false, version: null },
      plugin: { present: false, upToDate: false, outDir: null, outDirOk: false },
      bundleAvailable, gameRunning: pids.length > 0, heartbeat, live, ready: false,
    };
  }
  const p = pluginPaths(game.gameDir);
  const bepPresent = existsSync(p.core) && existsSync(p.winhttp);
  const present = existsSync(p.dll);
  const upToDate = present && bundleAvailable && cachedSha256(p.dll) === cachedSha256(bundledDll);
  const outDir = readConfiguredOutDir(p.cfg);
  const outDirOk = sameDir(outDir, captureOut);
  return {
    installed: true, gameDir: game.gameDir, buildId: game.buildId,
    bepinex: { present: bepPresent, version: bepPresent ? readBepinexVersion(game.gameDir) : null },
    plugin: { present, upToDate, outDir, outDirOk },
    bundleAvailable,
    gameRunning: pids.length > 0,
    heartbeat, live,
    ready: bepPresent && present && upToDate && outDirOk,
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
  writeFileSync(cfg, txt, "utf-8");
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
  const pluginLoaded = running && hb != null && pids.includes(hb.pid);
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
    expandZip(zip, stage);
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
  writePluginConfig(p.cfg, captureOut);
  log(`v  Plugin config → OutDir = ${captureOut}`);
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
  const child = spawn("cmd.exe", ["/c", "start", "", `steam://rungameid/${OUTERPLANE_APPID}`], { windowsHide: true, detached: true, stdio: "ignore" });
  child.unref();
}
