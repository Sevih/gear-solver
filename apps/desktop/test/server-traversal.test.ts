import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { electronMock, electronUpdaterMock } from "./electron-mock.js";
import { withServer } from "./http-harness.js";

const userData = mkdtempSync(join(tmpdir(), "gs-srv-"));
vi.mock("electron", () => electronMock(userData));
vi.mock("electron-updater", () => electronUpdaterMock());

describe("server mounts — traversal into a sibling directory", () => {
  it("/gamedata/ refuses ../derived2/… (DERIVED is a prefix of derived2)", async () => {
    const { DERIVED, CAPTURE_OUT } = await import("../src/paths.js");
    const { handle } = await import("../src/server.js");
    mkdirSync(DERIVED, { recursive: true });
    mkdirSync(`${DERIVED}2`, { recursive: true });
    writeFileSync(join(`${DERIVED}2`, "secret.json"), '"SECRET"');
    mkdirSync(`${CAPTURE_OUT}-old`, { recursive: true });
    writeFileSync(join(`${CAPTURE_OUT}-old`, "user_item.json"), '"ACCOUNT"');

    await withServer(handle, async (call) => {
      const g = await call("/gamedata/..%2Fderived2%2Fsecret.json");
      expect(g.body).not.toContain("SECRET");
      expect(g.status).toBe(403);
      const c = await call("/captured/..%2Fcapture-out-old%2Fuser_item.json");
      expect(c.body).not.toContain("ACCOUNT");
    });
  });
});
