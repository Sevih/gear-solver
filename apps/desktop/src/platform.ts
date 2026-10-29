/**
 * Everything the Steam capture flow needs from the OS, behind one interface:
 * where Steam lives, whether the game runs, how to launch it, how to unzip
 * BepInEx, and how a native path reads from inside the game.
 *
 *  - `win32` — the native client: registry → Steam root, `tasklist.exe`,
 *    `cmd.exe /c start steam://…`, PowerShell's Expand-Archive.
 *  - `linux` — native Steam running the Windows build under Proton: the game is
 *    a Wine process (`OUTERPLANE.exe` in its command line), the plugin sees the
 *    filesystem through Wine's `Z:` drive, and BepInEx's `winhttp.dll` proxy
 *    loads only with the `WINEDLLOVERRIDES="winhttp=n,b" %command%` launch option.
 *
 * `platform()` picks the implementation from `process.platform`; tests inject
 * one with `setPlatform` (`linuxPlatform({ home, procDir })` over fake folders).
 * Pure Node — no Electron import — like steam-capture.ts.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
import gameClient from "./game-client.json" with { type: "json" };

export interface Platform {
  readonly name: "win32" | "linux";
  /** Steam's install path as the OS reports it (Windows registry), if any. */
  registrySteamPath?(): Promise<string | null>;
  /** Candidate Steam roots, in order of preference. */
  steamRoots(): string[];
  /** Pids of the running game (empty when not running). */
  gamePids(exe: string): Promise<number[]>;
  /** The plugin heartbeat was written by one of the running game `pids`. */
  ownsHeartbeat(heartbeat: { pid: number; startedAt: string }, pids: number[]): boolean;
  /** Ask Steam to launch the game. Fire-and-forget. */
  launchGame(appId: string): void;
  /** Expand a `.zip` into `dest`; throws a readable error on failure. */
  expandZip(zipPath: string, dest: string): void;
  /** A native path as the plugin reads it (inside Wine under Proton). */
  toPluginPath(p: string): string;
  /** The inverse of `toPluginPath`. */
  fromPluginPath(p: string): string;
  /** The game needs the Proton launch option for BepInEx to load. */
  readonly protonLaunchOptions: boolean;
}

/** Run a helper exe asynchronously and resolve with its stdout ("" on any
 *  failure — missing exe, timeout, non-zero exit). Never blocks the main
 *  process, which also serves the renderer's HTTP. */
function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolveRun) => {
    execFile(file, args, { windowsHide: true, encoding: "utf-8", timeout }, (_err, stdout) => resolveRun(stdout || ""));
  });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export function win32Platform(): Platform {
  return {
    name: "win32",
    /** HKCU `SteamPath`, set by the Steam client itself. */
    async registrySteamPath() {
      const stdout = await run("reg.exe", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], 3000);
      const m = /SteamPath\s+REG_SZ\s+(.+)$/im.exec(stdout);
      return m?.[1]?.trim() || null;
    },
    steamRoots: () => gameClient.steam.roots.windows.map((r) => normalize(r)),
    /** `tasklist` pids for the exe. */
    async gamePids(exe) {
      const stdout = await run("tasklist.exe", ["/FI", `IMAGENAME eq ${exe}`, "/FO", "CSV", "/NH"], 4000);
      const pids: number[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^"[^"]+","(\d+)"/.exec(line.trim());
        if (m) pids.push(Number(m[1]));
      }
      return pids;
    },
    ownsHeartbeat: (heartbeat, pids) => pids.includes(heartbeat.pid),
    /** `steam://rungameid/<appid>` through the shell. */
    launchGame(appId) {
      const child = spawn("cmd.exe", ["/c", "start", "", `steam://rungameid/${appId}`], { windowsHide: true, detached: true, stdio: "ignore" });
      child.unref();
    },
    /** Through PowerShell (no zip lib in the Electron main bundle). The path
     *  MUST end in `.zip` — Expand-Archive refuses any other extension outright. */
    expandZip(zipPath, dest) {
      const r = spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference='Stop'; Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${dest}"`,
      ], { windowsHide: true, encoding: "utf-8" });
      if (r.status !== 0) {
        const detail = (r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`;
        throw new Error(`extracting ${zipPath} failed: ${detail}`);
      }
    },
    toPluginPath: (p) => p,
    fromPluginPath: (p) => p,
    protonLaunchOptions: false,
  };
}

// ---------------------------------------------------------------------------
// Linux (native Steam, game under Proton)
// ---------------------------------------------------------------------------

/** Linux reports process start times in clock ticks since boot; USER_HZ is
 *  100 on every mainstream kernel build. */
const CLOCK_TICKS_PER_S = 100;
/** Slack on the start-time comparison: `btime` is whole seconds. */
const START_SLACK_MS = 2000;

/** Start time (epoch ms) of `pid`, from `<proc>/<pid>/stat` field 22 and the
 *  boot time in `<proc>/stat`. Null when unreadable. */
function processStartMs(procDir: string, pid: number): number | null {
  try {
    const btime = /^btime\s+(\d+)$/m.exec(readFileSync(join(procDir, "stat"), "utf-8"))?.[1];
    const stat = readFileSync(join(procDir, String(pid), "stat"), "utf-8");
    // `comm` (field 2) may hold spaces and parentheses: split after the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[19]);
    if (!btime || !Number.isFinite(ticks)) return null;
    return Number(btime) * 1000 + (ticks / CLOCK_TICKS_PER_S) * 1000;
  } catch {
    return null;
  }
}

export function linuxPlatform(opts: { home?: string; procDir?: string } = {}): Platform {
  const home = () => opts.home ?? process.env.HOME ?? homedir();
  const procDir = opts.procDir ?? "/proc";
  return {
    name: "linux",
    /** The reference's Linux roots (native, `~/.steam` links, Flatpak), relative to HOME. */
    steamRoots: () => gameClient.steam.roots.linux.map((r) => join(home(), r)),
    /** Scan every `<proc>/<pid>/cmdline`: under Proton the game is a Wine process whose
     *  command line carries the exe (so do Proton's launcher processes). */
    async gamePids(exe) {
      const want = exe.toLowerCase();
      let entries: string[];
      try { entries = await readdir(procDir); } catch { return []; }
      const hits = await Promise.all(entries.filter((e) => /^\d+$/.test(e)).map(async (e) => {
        try {
          const args = (await readFile(join(procDir, e, "cmdline"), "utf-8")).split("\0");
          return args.some((a) => a.split(/[\\/]/).pop()!.toLowerCase() === want) ? Number(e) : null;
        } catch {
          return null; // process gone meanwhile, or not ours to read
        }
      }));
      return hits.filter((p): p is number => p != null);
    },
    /** The plugin's pid is Wine's own process id, never a Linux one: the
     *  heartbeat belongs to the running game when it was written after one of
     *  its processes started (a previous session's heartbeat is older). */
    ownsHeartbeat(heartbeat, pids) {
      const at = Date.parse(heartbeat.startedAt);
      if (!Number.isFinite(at)) return false;
      return pids.some((pid) => {
        const start = processStartMs(procDir, pid);
        return start != null && at >= start - START_SLACK_MS;
      });
    },
    /** `xdg-open steam://rungameid/<appid>`, detached. */
    launchGame(appId) {
      const child = spawn("xdg-open", [`steam://rungameid/${appId}`], { detached: true, stdio: "ignore" });
      child.on("error", () => { /* no xdg-open: nothing to launch with */ });
      child.unref();
    },
    expandZip(zipPath, dest) {
      const r = spawnSync("unzip", ["-o", "-q", zipPath, "-d", dest], { encoding: "utf-8" });
      if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        throw new Error("unzip is not installed — install it with your package manager (e.g. `sudo dnf install unzip`), then retry.");
      }
      if (r.status !== 0) {
        const detail = (r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`;
        throw new Error(`extracting ${zipPath} failed: ${detail}`);
      }
    },
    /** `/home/x/…` → `Z:\home\x\…` (Wine maps `Z:` to `/`). */
    toPluginPath: (p) => (p.startsWith("/") ? `Z:${p.replace(/\//g, "\\")}` : p),
    /** `Z:\home\x\…` → `/home/x/…`; any other drive is left as is. */
    fromPluginPath: (p) => (/^[zZ]:[\\/]/.test(p) ? p.slice(2).replace(/\\/g, "/") : p),
    protonLaunchOptions: true,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** The implementation for an OS: Linux gets the Proton one, anything else the Windows one. */
export function platformFor(os: NodeJS.Platform): Platform {
  return os === "linux" ? linuxPlatform() : win32Platform();
}

let current: Platform | null = null;

/** The platform in use (`process.platform` unless a test injected one). */
export function platform(): Platform {
  return (current ??= platformFor(process.platform));
}

/** Inject a platform (tests); `null` goes back to `process.platform`. */
export function setPlatform(p: Platform | null): void {
  current = p;
}
