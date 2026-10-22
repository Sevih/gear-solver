import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
        expect((await call(url, { method })).status).toBe(404);
      }
      expect(JSON.parse((await call("/api/capture/status")).body)).toEqual({
        captured: false,
        userItemMtime: null,
        mtimes: { user_item: null, user_character: null, user_gift: null, user_archive: null },
      });
    });
  });

  it("answers an unknown /api/* with a JSON 404 instead of falling through to the SPA", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { if (!handle(req, res)) { res.statusCode = 418; res.end("fallthrough"); } }, async (call) => {
      for (const [url, method] of [["/api/capture/stauts", "GET"], ["/api/nope", "POST"], ["/api/stat-locks?x=1", "DELETE"], ["/api/", "GET"]] as const) {
        const r = await call(url, { method });
        expect(r.status).toBe(404);
        expect(r.headers["content-type"]).toBe("application/json");
        expect(JSON.parse(r.body)).toEqual({ error: "unknown endpoint" });
      }
      // `/api` alone and look-alike prefixes are not API routes.
      expect((await call("/api")).status).toBe(418);
      expect((await call("/apix/foo")).status).toBe(418);
    });
  });

  it("writes stat-locks atomically: full file, folder created, no temp file left", async () => {
    const cfg = devConfig();
    const handle = createApiHandler(cfg);
    const body = JSON.stringify({ hero: { atk: 1234 } });
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      expect((await call("/api/stat-locks", { method: "POST", body })).status).toBe(204);
    });
    expect(readFileSync(cfg.statLocks, "utf-8")).toBe(body);
    expect(readdirSync(dirname(cfg.statLocks)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("serves the dev update payload through the injected updater", async () => {
    const handle = createApiHandler(devConfig());
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      expect(JSON.parse((await call("/api/update/status")).body)).toEqual({ state: "uptodate" });
    });
  });
});

describe("/api/capture/status — mtimes of every imported snapshot", () => {
  it("reports user_item, user_character, user_gift and user_archive; absent files are null", async () => {
    const cfg = devConfig();
    const out = cfg.captureOut;
    const stamp = (name: string, sec: number) => {
      writeFileSync(join(out, `${name}.json`), "{}");
      utimesSync(join(out, `${name}.json`), sec, sec);
    };
    stamp("user_item", 1_000);
    stamp("user_character", 2_000);
    stamp("user_gift", 3_000);
    writeFileSync(join(out, ".captured"), "x");
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      expect(JSON.parse((await call("/api/capture/status")).body)).toEqual({
        captured: true,
        userItemMtime: 1_000_000,
        mtimes: { user_item: 1_000_000, user_character: 2_000_000, user_gift: 3_000_000, user_archive: null },
      });
    });
  });

  it("folds the plugin's equip journal into user_item.json first, once", async () => {
    const cfg = devConfig();
    const out = cfg.captureOut;
    const file = join(out, "user_item.json");
    writeFileSync(file, JSON.stringify({ ItemList: [{ ItemUID: "6124885095", CharUID: "0" }, { ItemUID: "6036468941", CharUID: "6012124257" }] }));
    utimesSync(file, 1_000, 1_000);
    writeFileSync(join(out, "equip-events.ndjson"), JSON.stringify({
      seq: 1, at: "2026-10-22T08:00:00.0000000Z", path: "/item/equip",
      res: { CharUID: "6012124257", ToEquipUID: "6124885095", ToInvenUID: "6036468941", UnEquipCharUID: "0" },
    }) + "\n");
    const handle = createApiHandler(cfg);
    await withServer((req, res) => { handle(req, res); }, async (call) => {
      const first = JSON.parse((await call("/api/capture/status")).body) as { userItemMtime: number };
      expect(first.userItemMtime).not.toBe(1_000_000);
      expect(statSync(file).mtimeMs).toBe(first.userItemMtime);
      expect((JSON.parse(readFileSync(file, "utf-8")) as { ItemList: unknown[] }).ItemList).toEqual([
        { ItemUID: "6124885095", CharUID: "6012124257" },
        { ItemUID: "6036468941", CharUID: "0" },
      ]);
      // No new event: nothing rewritten.
      const second = JSON.parse((await call("/api/capture/status")).body) as { userItemMtime: number };
      expect(second.userItemMtime).toBe(first.userItemMtime);
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
