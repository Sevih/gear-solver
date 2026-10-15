import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { electronMock } from "./electron-mock.js";

const userData = mkdtempSync(join(tmpdir(), "gs-paths-"));
vi.mock("electron", () => electronMock(userData));

describe("paths (packaged)", () => {
  it("keeps every writable path under userData", async () => {
    const p = await import("../src/paths.js");
    expect(p.IS_DEV).toBe(false);
    for (const dir of [p.CAPTURE_OUT, p.CACHE_ROOT, p.STAT_LOCKS, p.MANUAL_DEVICE, p.SCRATCH_DIR, p.CAPTURE_CA_DIR]) {
      expect(dir.startsWith(userData)).toBe(true);
    }
  });

  it("keeps the capture CA in userData, outside the install dir and the mitmdump version dir", async () => {
    const p = await import("../src/paths.js");
    expect(p.CAPTURE_CA_DIR).toBe(join(userData, "capture-ca"));
    expect(p.CAPTURE_CA_DIR.startsWith(process.resourcesPath)).toBe(false);
    expect(p.CAPTURE_CA_DIR.startsWith(join(userData, "bin"))).toBe(false);
  });
});
