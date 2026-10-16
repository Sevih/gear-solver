import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiHandler, type ApiConfig } from "../src/api-handler.js";
import { withServer } from "./http-harness.js";

/** The dev wiring (vite.config.ts) in a temp tree: same handler as prod,
 *  only the paths and the updater differ. */
function devConfig(): ApiConfig {
  const root = mkdtempSync(join(tmpdir(), "gs-api-"));
  const captureOut = join(root, ".cache", "capture-out");
  mkdirSync(captureOut, { recursive: true });
  return {
    captureOut,
    derivedDir: join(root, "data", "derived"),
    repoShaState: join(root, ".cache", "repo-sha.json"),
    repoRoot: root,
    statLocks: join(root, "data", "stat-locks.json"),
    steamPluginDll: join(root, "GearSolverCapture.dll"),
    scratchDir: join(root, ".cache", "scratch"),
    img: { cacheDir: join(root, ".cache", "outerpedia") },
    update: { status: () => ({ state: "uptodate" }), check: () => {}, install: () => true },
  };
}

describe("shared API handler", () => {
  it("leaves the renderer's own paths to the caller", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 418; res.end("fallthrough"); } }, async (call) => {
      expect((await call("/index.html")).status).toBe(418);
      expect((await call("/assets/app.js")).status).toBe(418);
    });
  });

  it("no longer owns the routes of the removed emulator source", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 418; res.end("fallthrough"); } }, async (call) => {
      for (const [url, method] of [["/api/capture/run", "POST"], ["/api/capture/disarm", "POST"], ["/api/emulators", "GET"], ["/api/preflight", "GET"], ["/api/capture/manual-device", "GET"]] as const) {
        expect((await call(url, { method })).status).toBe(418);
      }
      expect(JSON.parse((await call("/api/capture/status")).body)).toEqual({ captured: false, userItemMtime: null });
    });
  });

  it("serves the dev update payload through the injected updater", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      expect(JSON.parse((await call("/api/update/status")).body)).toEqual({ state: "uptodate" });
    });
  });
});

describe("/api/capture/wipe — empties the whole capture folder", () => {
  it("removes every file and sub-folder, keeps the folder itself", async () => {
    const cfg = devConfig();
    const out = cfg.captureOut;
    for (const f of ["user_item.json", "user_character.json", "seen-paths.log", ".captured", ".steam-plugin.json"]) {
      writeFileSync(join(out, f), "x");
    }
    mkdirSync(join(out, "_unknown"));
    writeFileSync(join(out, "_unknown", "a.json"), "{}");
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 404; res.end(); } }, async (call) => {
      const r = await call("/api/capture/wipe", { method: "POST" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).removed).toBe(6);
    });
    expect(existsSync(out)).toBe(true);
    expect(readdirSync(out)).toEqual([]);
  });
});
