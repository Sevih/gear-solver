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
    for (const dir of [p.CAPTURE_OUT, p.CACHE_ROOT, p.STAT_LOCKS, p.MANUAL_DEVICE, p.SCRATCH_DIR]) {
      expect(dir.startsWith(userData)).toBe(true);
    }
  });
});
