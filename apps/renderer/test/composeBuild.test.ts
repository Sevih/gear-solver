/**
 * Set bonuses → composer buckets. Data-driven guard: every `st` carried by a
 * 2pc/4pc bonus in `sets.json` must map to a stat key, otherwise
 * `addSetBonuses` drops it silently (the Mitigation set, audit 2026-09-07).
 */
import { describe, expect, it } from "vitest";
import { aggregateGearBuckets, setBonusStatKey } from "../src/lib/composeBuild.js";
import SETS_JSON from "../../../data/derived/sets.json";

type SetRow = { st: string; ap: string; v: number } | null;
type SetDef = { name: string; levels: Array<{ p2: SetRow; p4: SetRow }> };
const SETS = SETS_JSON as unknown as Record<string, SetDef>;

// Combat-only set stats: applied as buffs, not part of FinalStats.
const NOT_IN_FINAL_STATS = new Set(["ST_NONE", "ST_VAMPIRIC", "ST_COUNTER_RATE", "ST_ENTER_AP"]);

describe("set bonuses", () => {
  it("maps every set-bonus st in sets.json to a stat key", () => {
    const missing: string[] = [];
    for (const [id, def] of Object.entries(SETS)) {
      for (const lv of def.levels) {
        for (const row of [lv.p2, lv.p4]) {
          if (!row || NOT_IN_FINAL_STATS.has(row.st)) continue;
          if (!setBonusStatKey(row.st, row.ap === "OAT_RATE")) missing.push(`${id} ${def.name}: ${row.st}/${row.ap}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("Mitigation 2pc adds 25% Crit DMG Reduc", () => {
    const b = aggregateGearBuckets([], null, undefined, [{ st: "ST_E_CRI_DMG_REDUCE", ap: "OAT_ADD", v: 250 }]);
    expect(b.pct.critDmgReduce).toBe(25);
  });
});
