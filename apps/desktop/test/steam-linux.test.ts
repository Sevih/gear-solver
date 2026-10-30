import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { linuxPlatform, setPlatform } from "../src/platform.js";
import { findSteamRoot, installSteamPlugin, protonLaunchOptionsOk, resetSteamCaches, steamStatus } from "../src/steam-capture.js";

// Linux / Proton: a fake HOME (Steam roots), a fake /proc (game processes)
// and a fake Steam library, injected through `linuxPlatform({ home, procDir })`.

const BOOT_S = Math.floor(Date.now() / 1000) - 1000;

/** A fake `/proc`: `btime` in `stat`, and one dir per process with its
 *  NUL-separated `cmdline` and a `stat` whose field 22 is the start tick. */
function fakeProc(procs: { pid: number; cmdline: string[]; startS?: number }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "gs-proc-"));
  writeFileSync(join(dir, "stat"), `cpu  1 2 3 4\nbtime ${BOOT_S}\nprocesses 42\n`);
  mkdirSync(join(dir, "self"));
  for (const p of procs) {
    mkdirSync(join(dir, String(p.pid)));
    writeFileSync(join(dir, String(p.pid), "cmdline"), p.cmdline.join("\0") + "\0");
    // Fields 3.. after the comm: state, then field 22 (index 19) = starttime.
    const fields = Array.from({ length: 50 }, () => "0");
    fields[0] = "S";
    fields[19] = String((p.startS ?? 0) * 100);
    writeFileSync(join(dir, String(p.pid), "stat"), `${p.pid} (wine64 (x)) ${fields.join(" ")}\n`);
  }
  return dir;
}

/** `steamapps` + an OUTERPLANE install with BepInEx and our plugin under `root`. */
function fakeSteam(root: string) {
  const game = join(root, "steamapps", "common", "OUTERPLANE");
  mkdirSync(join(game, "OUTERPLANE_Data", "Managed"), { recursive: true });
  writeFileSync(join(root, "steamapps", "appmanifest_4247320.acf"), `"AppState"\n{\n "installdir" "OUTERPLANE"\n "buildid" "123"\n}\n`);
  mkdirSync(join(game, "BepInEx", "core"), { recursive: true });
  writeFileSync(join(game, "BepInEx", "core", "BepInEx.dll"), "core");
  writeFileSync(join(game, "winhttp.dll"), "loader");
  mkdirSync(join(game, "BepInEx", "plugins", "GearSolverCapture"), { recursive: true });
  writeFileSync(join(game, "BepInEx", "plugins", "GearSolverCapture", "GearSolverCapture.dll"), "PLUGIN");
  mkdirSync(join(game, "BepInEx", "config"), { recursive: true });
  return { game, cfg: join(game, "BepInEx", "config", "outerpedia.gearsolver.capture.cfg") };
}

function localConfig(launchOptions: string | null): string {
  const app = launchOptions == null ? `"LastPlayed" "1"` : `"LaunchOptions" "${launchOptions.replace(/"/g, '\\"')}"`;
  return `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"4247320"\n\t\t\t\t\t{\n\t\t\t\t\t\t${app}\n\t\t\t\t\t}\n\t\t\t\t\t// another game\n\t\t\t\t\t"620"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions" "WINEDLLOVERRIDES=\\"winhttp=n,b\\" %command%"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`;
}

function writeLocalConfig(steamRoot: string, id: string, launchOptions: string | null): void {
  mkdirSync(join(steamRoot, "userdata", id, "config"), { recursive: true });
  writeFileSync(join(steamRoot, "userdata", id, "config", "localconfig.vdf"), localConfig(launchOptions));
}

beforeEach(() => resetSteamCaches());
afterAll(() => setPlatform(null));

describe("linux platform — Steam roots", () => {
  it("finds the Flatpak root under HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "gs-home-"));
    const flatpak = join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam");
    mkdirSync(join(flatpak, "steamapps"), { recursive: true });
    setPlatform(linuxPlatform({ home, procDir: fakeProc([]) }));
    expect(await findSteamRoot()).toBe(flatpak);
  });

  it("prefers the native root, and skips a root without steamapps", async () => {
    const home = mkdtempSync(join(tmpdir(), "gs-home-"));
    mkdirSync(join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam", "steamapps"), { recursive: true });
    mkdirSync(join(home, ".local", "share", "Steam"), { recursive: true }); // no steamapps
    mkdirSync(join(home, ".steam", "steam", "steamapps"), { recursive: true });
    setPlatform(linuxPlatform({ home, procDir: fakeProc([]) }));
    expect(await findSteamRoot()).toBe(join(home, ".steam", "steam"));
  });

  it("no Steam at all → null", async () => {
    setPlatform(linuxPlatform({ home: mkdtempSync(join(tmpdir(), "gs-home-")), procDir: fakeProc([]) }));
    expect(await findSteamRoot()).toBeNull();
  });
});

describe("linux platform — processes", () => {
  it("lists the processes whose command line carries OUTERPLANE.exe", async () => {
    const procDir = fakeProc([
      { pid: 4100, cmdline: ["Z:\\home\\me\\.local\\share\\Steam\\steamapps\\common\\OUTERPLANE\\OUTERPLANE.exe"] },
      { pid: 4200, cmdline: ["/usr/bin/bash", "-c", "echo OUTERPLANE"] },
      { pid: 4300, cmdline: ["/home/me/.steam/steam/steamapps/common/Proton - Experimental/proton", "waitforexitandrun", "/home/me/.local/share/Steam/steamapps/common/OUTERPLANE/OUTERPLANE.exe"] },
    ]);
    const os = linuxPlatform({ procDir });
    expect((await os.gamePids("OUTERPLANE.exe")).sort()).toEqual([4100, 4300]);
    expect(await os.gamePids("OTHER.exe")).toEqual([]);
  });

  it("a heartbeat belongs to the game when written after the process started (Wine pids aren't Linux pids)", () => {
    const procDir = fakeProc([{ pid: 4100, cmdline: ["OUTERPLANE.exe"], startS: 500 }]);
    const os = linuxPlatform({ procDir });
    const at = (s: number) => new Date((BOOT_S + s) * 1000).toISOString();
    expect(os.ownsHeartbeat({ pid: 288, startedAt: at(510) }, [4100])).toBe(true);
    expect(os.ownsHeartbeat({ pid: 288, startedAt: at(400) }, [4100])).toBe(false); // previous session
    expect(os.ownsHeartbeat({ pid: 288, startedAt: at(510) }, [])).toBe(false);
    expect(os.ownsHeartbeat({ pid: 288, startedAt: "" }, [4100])).toBe(false);
  });
});

describe("linux platform — plugin paths (Wine Z: drive)", () => {
  const os = linuxPlatform();
  it.each([
    ["/home/me/.config/Outerpedia Gear Solver/capture-out", "Z:\\home\\me\\.config\\Outerpedia Gear Solver\\capture-out"],
    ["/home/Sévih Léon/Données de jeu/capture-out", "Z:\\home\\Sévih Léon\\Données de jeu\\capture-out"],
  ])("%s round-trips", (native, wine) => {
    expect(os.toPluginPath(native)).toBe(wine);
    expect(os.fromPluginPath(wine)).toBe(native);
  });

  it("leaves another drive alone", () => {
    expect(os.fromPluginPath("C:\\users\\steamuser\\capture-out")).toBe("C:\\users\\steamuser\\capture-out");
  });
});

describe("linux platform — Proton launch option (localconfig.vdf)", () => {
  it("true when one account has it, false when none does, null when unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "gs-steam-"));
    expect(protonLaunchOptionsOk(root)).toBeNull();
    writeLocalConfig(root, "111", null);
    expect(protonLaunchOptionsOk(root)).toBe(false);
    writeLocalConfig(root, "222", "PROTON_LOG=1 %command%");
    expect(protonLaunchOptionsOk(root)).toBe(false);
    writeLocalConfig(root, "333", 'WINEDLLOVERRIDES="winhttp=n,b" %command%');
    expect(protonLaunchOptionsOk(root)).toBe(true);
  });
});

describe("steamStatus / install under Linux", () => {
  function setup(heartbeatAtS: number) {
    const home = mkdtempSync(join(tmpdir(), "gs-home-"));
    const steam = join(home, ".local", "share", "Steam");
    const { cfg } = fakeSteam(steam);
    const out = join(home, ".config", "Outerpedia Gear Solver", "capture-out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, ".steam-plugin.json"), JSON.stringify({ version: "1.0", pid: 288, startedAt: new Date((BOOT_S + heartbeatAtS) * 1000).toISOString() }));
    const bundled = join(home, "bundled.dll");
    writeFileSync(bundled, "PLUGIN");
    const procDir = fakeProc([{ pid: 4100, cmdline: ["Z:\\OUTERPLANE.exe"], startS: 500 }]);
    setPlatform(linuxPlatform({ home, procDir }));
    return { steam, cfg, out, bundled };
  }

  // The Z: mapping is of POSIX paths: on the Windows CI runner the temp
  // folders are `C:\…`, which Wine would never show as `Z:C:\…`.
  const posixOnly = it.skipIf(process.platform === "win32");

  posixOnly("compares the OutDir after the Z: translation, reads the launch option, matches the heartbeat", async () => {
    const { steam, cfg, out, bundled } = setup(510);
    writeFileSync(cfg, `[Capture]\nOutDir = Z:${out.replace(/\//g, "\\")}\n`);
    writeLocalConfig(steam, "111", 'WINEDLLOVERRIDES="winhttp=n,b" %command%');
    const st = await steamStatus(out, bundled);
    expect(st.plugin.outDir).toBe(out);
    expect(st.plugin.outDirOk).toBe(true);
    expect(st.ready).toBe(true);
    expect(st.launchOptionsOk).toBe(true);
    expect(st.gameRunning).toBe(true);
    expect(st.live).toBe(true);
  });

  it("a native path in the config doesn't count, a stale heartbeat isn't live, a missing option is false", async () => {
    const { steam, cfg, out, bundled } = setup(400);
    writeFileSync(cfg, `[Capture]\nOutDir = C:\\users\\steamuser\\capture-out\n`);
    writeLocalConfig(steam, "111", null);
    const st = await steamStatus(out, bundled);
    expect(st.plugin.outDirOk).toBe(false);
    expect(st.launchOptionsOk).toBe(false);
    expect(st.live).toBe(false);
  });

  posixOnly("install writes the OutDir as the plugin reads it inside Wine", async () => {
    const { cfg, out, bundled } = setup(400);
    const st = await installSteamPlugin({ captureOut: out, bundledDll: bundled, scratchDir: join(out, "..", "scratch"), log: () => {} });
    expect(readFileSync(cfg, "utf-8").split("\n")).toContain(`OutDir = Z:${out.replace(/\//g, "\\")}`);
    expect(st.plugin.outDirOk).toBe(true);
  });
});
