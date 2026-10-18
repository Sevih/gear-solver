import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { electronMock, electronUpdaterMock } from "./electron-mock.js";
import { withServer } from "./http-harness.js";

const userData = mkdtempSync(join(tmpdir(), "gs-wb-"));
vi.mock("electron", () => electronMock(userData));
vi.mock("electron-updater", () => electronUpdaterMock());

// The Steam plugin's liveness is a process probe (tasklist + heartbeat) —
// driven from the test instead.
const steam = vi.hoisted(() => ({ live: false }));
vi.mock("../src/steam-capture.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/steam-capture.js")>()),
  steamPluginLive: async () => steam.live,
}));

const ORIGINAL = '{"ItemList":["before"]}';
const EDITED = '{"ItemList":["after"]}';

async function setup() {
  const { CAPTURE_OUT } = await import("../src/paths.js");
  const { handle } = await import("../src/server.js");
  mkdirSync(CAPTURE_OUT, { recursive: true });
  const file = join(CAPTURE_OUT, "user_item.json");
  writeFileSync(file, ORIGINAL);
  return { handle, file };
}

beforeEach(() => { steam.live = false; });

describe("POST /api/captured/user-item vs the Steam source", () => {
  it("is refused while the Steam plugin is live (the next lobby would overwrite it)", async () => {
    const { handle, file } = await setup();
    steam.live = true;
    await withServer(handle, async (call) => {
      const r = await call("/api/captured/user-item", { method: "POST", body: EDITED });
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).error).toMatch(/steam/i);
    });
    expect(readFileSync(file, "utf-8")).toBe(ORIGINAL);
  });

  it("is written when no capture source is live", async () => {
    const { handle, file } = await setup();
    await withServer(handle, async (call) => {
      const r = await call("/api/captured/user-item", { method: "POST", body: EDITED });
      expect(r.status).toBe(204);
    });
    expect(readFileSync(file, "utf-8")).toBe(EDITED);
  });
});

describe("POST /api/capture/wipe vs the Steam source", () => {
  it("is refused while the Steam plugin is live (it would refill the folder behind the wipe)", async () => {
    const { handle, file } = await setup();
    const heartbeat = join(file, "..", ".steam-plugin.json");
    writeFileSync(heartbeat, '{"pid":4242}');
    steam.live = true;
    await withServer(handle, async (call) => {
      const r = await call("/api/capture/wipe", { method: "POST" });
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).error).toMatch(/steam/i);
    });
    expect(readFileSync(file, "utf-8")).toBe(ORIGINAL);
    expect(readFileSync(heartbeat, "utf-8")).toBe('{"pid":4242}');
  });

  it("empties the folder when no capture source is live", async () => {
    const { handle, file } = await setup();
    await withServer(handle, async (call) => {
      const r = await call("/api/capture/wipe", { method: "POST" });
      expect(r.status).toBe(200);
    });
    expect(readdirSync(join(file, ".."))).toEqual([]);
  });
});
