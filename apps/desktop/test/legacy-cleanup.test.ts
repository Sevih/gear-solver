import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeEmulatorLeftovers } from "../src/legacy-cleanup.js";

function tree() {
  const userData = mkdtempSync(join(tmpdir(), "gs-cleanup-"));
  const captureOut = join(userData, "capture-out");
  mkdirSync(captureOut);
  return { userData, captureOut };
}

describe("removeEmulatorLeftovers — what the emulator source left in userData", () => {
  it("removes the CA, mitmdump, the device override and the pipeline files, keeps the snapshots", () => {
    const { userData, captureOut } = tree();
    mkdirSync(join(userData, "capture-ca"));
    writeFileSync(join(userData, "capture-ca", "mitmproxy-ca.pem"), "KEY");
    mkdirSync(join(userData, "bin", "mitmproxy", "12.1.2"), { recursive: true });
    writeFileSync(join(userData, "bin", "mitmproxy", "12.1.2", "mitmdump.exe"), "x");
    writeFileSync(join(userData, "manual-device.json"), "{}");
    for (const f of [".mitm.pid", "mitm.log", "mitm.log.err", "game.flows", "user_item.json", ".captured", ".steam-plugin.json", "seen-paths.log"]) {
      writeFileSync(join(captureOut, f), "x");
    }
    mkdirSync(join(captureOut, "_unknown"));

    const removed = removeEmulatorLeftovers(userData, captureOut);

    expect(removed).toHaveLength(7);
    expect(existsSync(join(userData, "capture-ca"))).toBe(false);
    expect(existsSync(join(userData, "bin", "mitmproxy"))).toBe(false);
    expect(existsSync(join(userData, "bin"))).toBe(true);
    expect(existsSync(join(userData, "manual-device.json"))).toBe(false);
    expect(readdirSync(captureOut).sort()).toEqual([".captured", ".steam-plugin.json", "_unknown", "seen-paths.log", "user_item.json"]);
  });

  it("does nothing when there is nothing to remove, and stays a no-op on the next launch", () => {
    const { userData, captureOut } = tree();
    writeFileSync(join(captureOut, "user_item.json"), "{}");
    expect(removeEmulatorLeftovers(userData, captureOut)).toEqual([]);
    expect(removeEmulatorLeftovers(join(userData, "missing"), join(userData, "missing", "out"))).toEqual([]);
    expect(readdirSync(userData).sort()).toEqual(["capture-out"]);
    expect(readdirSync(captureOut)).toEqual(["user_item.json"]);
  });
});
