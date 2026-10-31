// App journal helpers (Settings → Logs): the timestamp format and the bound
// that keeps only the latest lines.
import { describe, expect, it } from "vitest";
import { appendBounded, stampLine } from "../src/lib/log/appLog.js";

describe("stampLine", () => {
  it("prefixes the local time as [HH:MM:SS]", () => {
    expect(stampLine("Manual import OK", new Date(2026, 9, 31, 14, 5, 9))).toBe("[14:05:09] Manual import OK");
  });

  it("zero-pads every field, midnight included", () => {
    expect(stampLine("x", new Date(2026, 9, 31, 0, 0, 0))).toBe("[00:00:00] x");
    expect(stampLine("x", new Date(2026, 9, 31, 9, 7, 3))).toBe("[09:07:03] x");
  });
});

describe("appendBounded", () => {
  it("concatenates under the bound", () => {
    expect(appendBounded(["a", "b"], ["c"], 5)).toEqual(["a", "b", "c"]);
  });

  it("keeps the last `max` lines past the bound", () => {
    expect(appendBounded(["a", "b", "c"], ["d", "e"], 3)).toEqual(["c", "d", "e"]);
    expect(appendBounded([], ["a", "b", "c", "d"], 2)).toEqual(["c", "d"]);
  });

  it("returns the same array for an empty batch", () => {
    const lines = ["a", "b"];
    expect(appendBounded(lines, [], 5)).toBe(lines);
  });
});
