import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Windows helpers: reg.exe answers with a temp Steam root, tasklist.exe
// with one OUTERPLANE pid. spawnSync must not be used on the status path —
// it blocks the main process, which also serves the renderer's HTTP.
const calls = vi.hoisted(() => ({ reg: 0, tasklist: 0, steamRoot: "", hashes: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawnSync: () => { throw new Error("spawnSync on the status path"); },
    execFile: (file: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      if (file === "reg.exe") {
        calls.reg++;
        setTimeout(() => cb(null, `HKEY_CURRENT_USER\\Software\\Valve\\Steam\n    SteamPath    REG_SZ    ${calls.steamRoot}\n`), 5);
      } else if (file === "tasklist.exe") {
        calls.tasklist++;
        setTimeout(() => cb(null, '"OUTERPLANE.exe","4242","Console","1","1,000 K"\r\n'), 5);
      } else cb(new Error(`unexpected ${file}`), "");
      return {};
    },
  };
});
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, createHash: (alg: string) => { calls.hashes++; return real.createHash(alg); } };
});

const { resetSteamCaches, steamStatus } = await import("../src/steam-capture.js");

/** A Steam library with OUTERPLANE + BepInEx + our plugin, and a capture
 *  folder whose heartbeat belongs to pid 4242. */
function fakeInstall() {
  const root = mkdtempSync(join(tmpdir(), "gs-steam-"));
  const steam = join(root, "Steam");
  const game = join(steam, "steamapps", "common", "OUTERPLANE");
  mkdirSync(join(game, "OUTERPLANE_Data", "Managed"), { recursive: true });
  writeFileSync(join(steam, "steamapps", "appmanifest_4247320.acf"), '"AppState"\n{\n "installdir" "OUTERPLANE"\n "buildid" "123"\n}\n');
  mkdirSync(join(game, "BepInEx", "core"), { recursive: true });
  writeFileSync(join(game, "BepInEx", "core", "BepInEx.dll"), "core");
  writeFileSync(join(game, "winhttp.dll"), "loader");
  mkdirSync(join(game, "BepInEx", "plugins", "GearSolverCapture"), { recursive: true });
  writeFileSync(join(game, "BepInEx", "plugins", "GearSolverCapture", "GearSolverCapture.dll"), "PLUGIN");
  const bundled = join(root, "bundled.dll");
  writeFileSync(bundled, "PLUGIN");
  const out = join(root, "capture-out");
  mkdirSync(join(game, "BepInEx", "config"), { recursive: true });
  writeFileSync(join(game, "BepInEx", "config", "outerpedia.gearsolver.capture.cfg"), `[Capture]\nOutDir = ${out}\n`);
  mkdirSync(out);
  writeFileSync(join(out, ".steam-plugin.json"), JSON.stringify({ version: "1.0", pid: 4242 }));
  calls.steamRoot = steam;
  return { out, bundled };
}

beforeEach(() => {
  resetSteamCaches();
  Object.assign(calls, { reg: 0, tasklist: 0, hashes: 0 });
});

describe("steamStatus — async, cached", () => {
  it("resolves without spawnSync and reports a live, ready install", async () => {
    const { out, bundled } = fakeInstall();
    const st = await steamStatus(out, bundled);
    expect(st.installed).toBe(true);
    expect(st.buildId).toBe("123");
    expect(st.plugin.upToDate).toBe(true);
    expect(st.ready).toBe(true);
    expect(st.live).toBe(true);
  });

  it("does not block the event loop while the helpers run", async () => {
    const { out, bundled } = fakeInstall();
    let ticked = false;
    setTimeout(() => { ticked = true; }, 0);
    const p = steamStatus(out, bundled);
    expect(ticked).toBe(false);
    await p;
    expect(ticked).toBe(true);
  });

  it("caches the registry lookup and the DLL hashes across polls", async () => {
    const { out, bundled } = fakeInstall();
    await steamStatus(out, bundled);
    expect(calls.reg).toBe(1);
    expect(calls.hashes).toBe(2); // installed + bundled DLL
    await steamStatus(out, bundled);
    await steamStatus(out, bundled);
    expect(calls.reg).toBe(1);
    expect(calls.hashes).toBe(2);
    expect(calls.tasklist).toBe(3); // the game can start/stop: never cached
  });

  it("re-hashes the installed DLL when it changes", async () => {
    const { out, bundled } = fakeInstall();
    expect((await steamStatus(out, bundled)).plugin.upToDate).toBe(true);
    writeFileSync(join(calls.steamRoot, "steamapps", "common", "OUTERPLANE", "BepInEx", "plugins", "GearSolverCapture", "GearSolverCapture.dll"), "OLDER PLUGIN BUILD");
    expect((await steamStatus(out, bundled)).plugin.upToDate).toBe(false);
  });
});
