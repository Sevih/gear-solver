import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeAtomic } from "../src/atomic-write.js";

const tmpFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".tmp"));

describe("writeAtomic", () => {
  it("creates the folder and writes the whole file, leaving no temp file", () => {
    const root = mkdtempSync(join(tmpdir(), "gs-atomic-"));
    const file = join(root, "a", "b", "state.json");
    const body = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) });
    writeAtomic(file, body);
    expect(readFileSync(file, "utf-8")).toBe(body);
    expect(tmpFiles(join(root, "a", "b"))).toEqual([]);
  });

  it("replaces an existing file, bytes included", () => {
    const root = mkdtempSync(join(tmpdir(), "gs-atomic-"));
    const file = join(root, "img.webp");
    writeFileSync(file, "old");
    writeAtomic(file, Buffer.from([1, 2, 3]));
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);
    expect(tmpFiles(root)).toEqual([]);
  });

  it("throws and removes its temp file when the rename fails", () => {
    const root = mkdtempSync(join(tmpdir(), "gs-atomic-"));
    const target = join(root, "taken");
    mkdirSync(join(target, "child"), { recursive: true }); // a non-empty folder can't be renamed over
    expect(() => writeAtomic(target, "x")).toThrow();
    expect(tmpFiles(root)).toEqual([]);
  });
});
