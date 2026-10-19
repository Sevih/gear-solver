import { describe, expect, it } from "vitest";
import { parseStatLocks } from "../src/lib/statLocks.js";

describe("parseStatLocks — the fetched /api/stat-locks file", () => {
  it("renames legacy stat keys (crc, chd, res…) in an enriched entry", () => {
    const r = parseStatLocks({
      "u1": { name: "Hero", charId: 2000001, level: 100, stats: { atk: 3000, crc: 85.5, chd: 210, res: 40 } },
    });
    expect(r).toEqual({
      u1: { name: "Hero", charId: 2000001, level: 100, stats: { atk: 3000, critRate: 85.5, critDmg: 210, effRes: 40 } },
    });
  });

  it("wraps the pre-rich bare shape and migrates its keys too", () => {
    expect(parseStatLocks({ u1: { crc: 50, hp: 12000 } })).toEqual({
      u1: { name: "?", charId: 0, level: 0, stats: { critRate: 50, hp: 12000 } },
    });
  });

  it("keeps canonical keys untouched", () => {
    const entry = { name: "H", charId: 1, level: 120, stats: { critRate: 100, spd: 180 } };
    expect(parseStatLocks({ u1: entry })).toEqual({ u1: entry });
  });

  it("keeps only finite numeric stats and defaults bad context fields", () => {
    const r = parseStatLocks({
      u1: { name: 7, charId: "x", stats: { atk: "3000", def: null, hp: Number.NaN, spd: 150 } },
    });
    expect(r).toEqual({ u1: { name: "?", charId: 0, level: 0, stats: { spd: 150 } } });
  });

  it("drops entries that are not objects or keep no numeric stat", () => {
    const r = parseStatLocks({
      a: 12, b: null, c: [1, 2], d: { stats: "oops" }, e: { stats: {} }, f: { name: "only context" },
      g: { stats: { atk: 1 } },
    });
    expect(Object.keys(r)).toEqual(["g"]);
  });

  it("reads anything but an object as an empty map", () => {
    for (const data of [null, undefined, 42, "x", [], [{ stats: { atk: 1 } }]]) {
      expect(parseStatLocks(data)).toEqual({});
    }
  });
});
