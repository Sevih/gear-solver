import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCaNotPackaged } from "../scripts/before-pack.mjs";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf-8")) as {
  build: { beforePack?: string; extraResources: { from: string }[] } & Record<string, unknown>;
};

describe("installer packaging ships no capture CA", () => {
  it("no extraResources entry maps prod-cert or the whole resources/ tree", () => {
    for (const e of pkg.build.extraResources) {
      expect(e.from).not.toMatch(/prod-cert/);
      expect(e.from.replace(/\/+$/, "")).not.toBe("resources");
    }
    expect(JSON.stringify(pkg.build)).not.toMatch(/prod-cert/);
  });

  it("the beforePack guard is wired and accepts the real config", () => {
    expect(pkg.build.beforePack).toBe("./scripts/before-pack.mjs");
    const empty = mkdtempSync(join(tmpdir(), "gs-pack-"));
    try {
      expect(checkCaNotPackaged(pkg.build, empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("the guard refuses a config that would package the old CA folder", () => {
    const withCert = { ...pkg.build, extraResources: [...pkg.build.extraResources, { from: "resources/prod-cert", to: "prod-cert" }] };
    expect(() => checkCaNotPackaged(withCert, DESKTOP)).toThrow(/prod-cert/);
    expect(() => checkCaNotPackaged({ extraResources: [{ from: "resources", to: "res" }] }, DESKTOP)).toThrow(/never be packaged/);
    expect(() => checkCaNotPackaged({ files: ["**/*"] }, DESKTOP)).toThrow(/never be packaged/);
  });

  it("a leftover prod-cert folder is ignored and reported, never an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-pack-"));
    try {
      mkdirSync(join(dir, "resources", "prod-cert"), { recursive: true });
      const warnings = checkCaNotPackaged(pkg.build, dir);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/NOT packaged/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
