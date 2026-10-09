import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  steamPluginLive: () => steam.live,
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
