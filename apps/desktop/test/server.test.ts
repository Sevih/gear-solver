import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { electronMock, electronUpdaterMock } from "./electron-mock.js";
import { withServer } from "./http-harness.js";

const userData = mkdtempSync(join(tmpdir(), "gs-server-"));
vi.mock("electron", () => electronMock(userData));
vi.mock("electron-updater", () => electronUpdaterMock());

describe("server — harness smoke", () => {
  it("serves a missing captured JSON as 200 null", async () => {
    const { handle } = await import("../src/server.js");
    await withServer(handle, async (call) => {
      const r = await call("/captured/user_archive.json");
      expect(r.status).toBe(200);
      expect(r.body).toBe("null");
    });
  });

  it("refuses a POST from a non-local Host", async () => {
    const { handle } = await import("../src/server.js");
    await withServer(handle, async (call) => {
      const r = await call("/api/stat-locks", { method: "POST", headers: { host: "evil.example:17891" }, body: "{}" });
      expect(r.status).toBe(403);
    });
  });
});
