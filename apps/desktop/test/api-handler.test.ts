import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiHandler, type ApiConfig } from "../src/api-handler.js";
import { withServer } from "./http-harness.js";

/** The dev wiring (vite.config.ts) in a temp tree: same handler as prod,
 *  only the paths and the updater differ. */
function devConfig(): ApiConfig {
  const root = mkdtempSync(join(tmpdir(), "gs-api-"));
  const captureOut = join(root, "tools", "capture", "out");
  mkdirSync(captureOut, { recursive: true });
  return {
    captureDir: join(root, "tools", "capture"),
    captureOut,
    derivedDir: join(root, "data", "derived"),
    repoShaState: join(root, ".cache", "repo-sha.json"),
    statLocks: join(root, "data", "stat-locks.json"),
    manualDevice: join(root, ".cache", "manual-device.json"),
    steamPluginDll: join(root, "GearSolverCapture.dll"),
    scratchDir: join(root, ".cache", "scratch"),
    bundledAdb: null,
    img: { cacheDir: join(root, ".cache", "outerpedia") },
    captureScriptArgs: async () => [],
    update: { status: () => ({ state: "uptodate" }), check: () => {}, install: () => true },
  };
}

/** A pid that is certainly not running (above Linux pid_max / Windows range). */
const DEAD_PID = 2_147_483_000;

describe("shared API handler — what the dev mirror used to get wrong", () => {
  it("a stale .mitm.pid (mitmdump crashed) is not 'armed', and is cleaned up", async () => {
    const cfg = devConfig();
    const pidFile = join(cfg.captureOut, ".mitm.pid");
    writeFileSync(pidFile, `${DEAD_PID}\n`);
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 404; res.end(); } }, async (call) => {
      const r = await call("/api/capture/status");
      expect(JSON.parse(r.body).armed).toBe(false);
    });
    expect(existsSync(pidFile)).toBe(false);
  });

  it("wipe is not wedged by a stale .mitm.pid", async () => {
    const cfg = devConfig();
    writeFileSync(join(cfg.captureOut, ".mitm.pid"), `${DEAD_PID}\n`);
    writeFileSync(join(cfg.captureOut, "user_item.json"), '{"ItemList":[]}');
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 404; res.end(); } }, async (call) => {
      const r = await call("/api/capture/wipe", { method: "POST" });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).removed).toBe(1);
    });
  });

  it("a live mitmdump pid is 'armed'", async () => {
    const cfg = devConfig();
    writeFileSync(join(cfg.captureOut, ".mitm.pid"), `${process.pid}\n`);
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 404; res.end(); } }, async (call) => {
      expect(JSON.parse((await call("/api/capture/status")).body).armed).toBe(true);
      expect((await call("/api/capture/wipe", { method: "POST" })).status).toBe(409);
    });
  });

  it("leaves the renderer's own paths to the caller", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 418; res.end("fallthrough"); } }, async (call) => {
      expect((await call("/index.html")).status).toBe(418);
      expect((await call("/assets/app.js")).status).toBe(418);
    });
  });

  it("serves the dev update payload through the injected updater", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      expect(JSON.parse((await call("/api/update/status")).body)).toEqual({ state: "uptodate" });
    });
  });
});
