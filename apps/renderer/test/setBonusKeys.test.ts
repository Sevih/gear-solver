import { describe, expect, it } from "vitest";
import type { GameData, GearPiece } from "@gear-solver/core";
import { aggregateGearBuckets, setBonusStatKey } from "../src/lib/composeBuild.js";
import setsJson from "../../../data/derived/sets.json";

// The real set catalog — the guard below must follow what the game ships,
// not a hand-written fixture that would drift with the next patch.
const SETS = setsJson as unknown as GameData["sets"];

// Combat-only set effects: carried as buffs / on-hit procs, not as stat-sheet
// lines, so the composer skips them on purpose.
const COMBAT_ONLY = new Set(["ST_NONE", "ST_VAMPIRIC", "ST_COUNTER_RATE", "ST_ENTER_AP"]);

describe("set bonuses — every stat-sheet `st` is mapped", () => {
  const pairs = new Set<string>();
  for (const def of Object.values(SETS)) {
    for (const lv of def.levels) {
      for (const opt of [lv.p2, lv.p4]) {
        if (opt && !COMBAT_ONLY.has(opt.st)) pairs.add(`${opt.st}|${opt.ap}`);
      }
    }
  }

  it("finds set options to check", () => {
    expect(pairs.size).toBeGreaterThan(0);
  });

  for (const pair of pairs) {
    const [st, ap] = pair.split("|") as [string, string];
    it(`${st} (${ap}) has an engine stat key`, () => {
      expect(setBonusStatKey(st, ap === "OAT_RATE")).not.toBeNull();
    });
  }
});

describe("set bonuses — Mitigation (set 9)", () => {
  const piece = (slot: string): GearPiece =>
    ({ slot, armorSetId: "9", breakthrough: 0, main: [], subs: [] }) as unknown as GearPiece;

  it("2pc adds +25 % Crit DMG Reduction", () => {
    const b = aggregateGearBuckets([piece("helmet"), piece("armor")], { sets: SETS } as GameData);
    expect(b.pct.critDmgReduce).toBe(25);
  });

  it("4pc stacks the 2pc and 4pc bonuses (+25 % +20 %)", () => {
    const pieces = ["helmet", "armor", "gloves", "boots"].map(piece);
    const b = aggregateGearBuckets(pieces, { sets: SETS } as GameData);
    expect(b.pct.critDmgReduce).toBe(45);
  });
});
