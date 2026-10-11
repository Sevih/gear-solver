import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { electronMock, electronUpdaterMock } from "./electron-mock.js";
import { withServer } from "./http-harness.js";

const userData = mkdtempSync(join(tmpdir(), "gs-host-"));
vi.mock("electron", () => electronMock(userData));
vi.mock("electron-updater", () => electronUpdaterMock());

/** A DNS-rebinding page: the browser resolves attacker.example to 127.0.0.1
 *  but keeps sending its own name in Host. */
const rebound = { host: "attacker.example:17891" };

async function setup() {
  const { CAPTURE_OUT } = await import("../src/paths.js");
  const { handle } = await import("../src/server.js");
  mkdirSync(CAPTURE_OUT, { recursive: true });
  writeFileSync(join(CAPTURE_OUT, "user_item.json"), '{"ItemList":["ACCOUNT"]}');
  return handle;
}

describe("Host guard on account reads", () => {
  it("GET /captured/* is refused for a non-local Host", async () => {
    await withServer(await setup(), async (call) => {
      const r = await call("/captured/user_item.json", { headers: rebound });
      expect(r.status).toBe(403);
      expect(r.body).not.toContain("ACCOUNT");
    });
  });

  it("GET /api/* is refused for a non-local Host", async () => {
    await withServer(await setup(), async (call) => {
      expect((await call("/api/capture/status", { headers: rebound })).status).toBe(403);
      expect((await call("/api/stat-locks", { headers: rebound })).status).toBe(403);
    });
  });

  it("the renderer's own same-origin reads still pass", async () => {
    await withServer(await setup(), async (call) => {
      const r = await call("/captured/user_item.json");
      expect(r.status).toBe(200);
      expect(r.body).toContain("ACCOUNT");
      expect((await call("/api/capture/status", { headers: { host: "localhost:17891" } })).status).toBe(200);
    });
  });
});
