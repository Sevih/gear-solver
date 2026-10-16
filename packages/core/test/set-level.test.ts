import { describe, it, expect } from "vitest";
import { pieceSetLevel, wornSetRows } from "../src/set-level.js";
import type { SetDef, SetsTable } from "../src/gamedata.js";
import setsJson from "../../../data/derived/sets.json";

// Set-level rule against the committed contract (outerpedia `sets.json`, with
// `breakLimitCounts` / `ignoreLowSet`) and against the same rows stripped of
// those fields (cache synced before they existed → former rule).
const SETS = setsJson as unknown as SetsTable;
const ATTACK = "1", PENETRATION = "11", SPEED = "13";

/** Contract without the per-piece fields, as an older cache holds it. */
function legacy(def: SetDef): SetDef {
  return { ...def, levels: def.levels.map(({ breakLimitCounts: _b, ignoreLowSet: _i, ...l }) => l) };
}

/** Raw set bonus (‰) on `st` for pieces at these breakthroughs. */
function bonus(def: SetDef, bts: number[], st: string): number {
  const { row2, row4, drop2 } = wornSetRows(def, bts);
  const p2 = drop2 ? null : row2?.p2;
  const p4 = row4?.p4;
  return (p2?.st === st ? p2.v : 0) + (p4?.st === st ? p4.v : 0);
}

describe("set level — committed contract", () => {
  it("carries the per-piece fields on the armor sets", () => {
    for (const id of [ATTACK, PENETRATION, SPEED]) {
      const levels = SETS[id]!.levels;
      expect(levels.flatMap((l) => l.breakLimitCounts ?? []).sort(), id).toEqual([0, 1, 2, 3, 4]);
      expect(levels.every((l) => typeof l.ignoreLowSet === "boolean"), id).toBe(true);
    }
  });

  it("piece level: BT0-3 → 1, BT4 → 2", () => {
    const def = SETS[ATTACK]!;
    expect([0, 1, 2, 3, 4].map((bt) => pieceSetLevel(def, bt))).toEqual([1, 1, 1, 1, 2]);
  });

  it("Attack: the 2-pc reads the min of the 2 best, the 4-pc the min of the 4 best", () => {
    const def = SETS[ATTACK]!;
    expect(bonus(def, [4, 4, 3], "ST_ATK")).toBe(350);
    expect(bonus(def, [4, 4, 3, 3], "ST_ATK")).toBe(350 + 200);
    expect(bonus(def, [4, 4, 4, 3], "ST_ATK")).toBe(350 + 200);
    expect(bonus(def, [4, 4, 4, 4], "ST_ATK")).toBe(350 + 250);
    expect(bonus(def, [3, 3], "ST_ATK")).toBe(300);
  });

  it("Speed: the level-1 4-pc's ignoreLowSet drops the level-2 2-pc (25 %, not 38 %)", () => {
    const def = SETS[SPEED]!;
    expect(bonus(def, [4, 4, 3, 3], "ST_SPEED")).toBe(250);
    expect(wornSetRows(def, [4, 4, 3, 3]).drop2).toBe(true);
    expect(bonus(def, [4, 4], "ST_SPEED")).toBe(130);
    expect(bonus(def, [4, 4, 4, 4], "ST_SPEED")).toBe(130 + 120);
  });

  it("Penetration [4,4,3,3]: the level-1 4-pc alone", () => {
    const def = SETS[PENETRATION]!;
    const rows = wornSetRows(def, [4, 4, 3, 3]);
    expect(rows.row2?.level).toBe(2);
    expect(rows.row4?.level).toBe(1);
    expect(rows.drop2).toBe(true);
    expect(bonus(def, [4, 4, 3, 3], "ST_PIERCE_POWER_RATE")).toBe(200);
  });

  it("no rows under 2 pieces, no 4-pc row under 4", () => {
    const def = SETS[ATTACK]!;
    expect(wornSetRows(def, [4])).toEqual({ row2: null, row4: null, drop2: false });
    expect(wornSetRows(def, [4, 4, 4]).row4).toBeNull();
  });
});

describe("set level — fallback without the contract fields (former rule)", () => {
  it("level 2 only when every piece is BT4, same row for the 2-pc and the 4-pc", () => {
    const atk = legacy(SETS[ATTACK]!);
    expect(bonus(atk, [4, 4, 3], "ST_ATK")).toBe(300);
    expect(bonus(atk, [4, 4, 3, 3], "ST_ATK")).toBe(300 + 200);
    expect(bonus(atk, [4, 4, 4, 3], "ST_ATK")).toBe(300 + 200);
    expect(bonus(atk, [4, 4, 4, 4], "ST_ATK")).toBe(350 + 250);
    expect(bonus(atk, [3, 3], "ST_ATK")).toBe(300);
  });

  it("never the per-piece rule without ignoreLowSet (Speed stays 25 %)", () => {
    expect(bonus(legacy(SETS[SPEED]!), [4, 4, 3, 3], "ST_SPEED")).toBe(250);
    expect(bonus(legacy(SETS[SPEED]!), [4, 4], "ST_SPEED")).toBe(130);
    expect(bonus(legacy(SETS[PENETRATION]!), [4, 4, 3, 3], "ST_PIERCE_POWER_RATE")).toBe(200);
  });

  it("piece level falls back to BT4 → 2, else 1", () => {
    const atk = legacy(SETS[ATTACK]!);
    expect([0, 3, 4].map((bt) => pieceSetLevel(atk, bt))).toEqual([1, 1, 2]);
    expect(pieceSetLevel(undefined, 4)).toBe(2);
  });

  it("a breakthrough no row lists falls back too", () => {
    const def: SetDef = {
      name: "X", desc: null, levels: [
        { level: 1, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 300 }, p4: null, p2_desc: null, p4_desc: null, breakLimitCounts: [0, 1, 2, 3], ignoreLowSet: false },
        { level: 2, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 350 }, p4: null, p2_desc: null, p4_desc: null, breakLimitCounts: [4], ignoreLowSet: false },
      ],
    };
    expect(bonus(def, [5, 4], "ST_ATK")).toBe(350);
    expect(bonus(def, [5, 3], "ST_ATK")).toBe(300);
  });
});

describe("set level — ignoreLowSet compares stat by stat (built rows)", () => {
  const row = (level: number, bt: number[], p2: string | null, p4: string | null, ignoreLowSet: boolean, p4_desc: string | null = null) => ({
    level, breakLimitCounts: bt, ignoreLowSet,
    p2: p2 ? { st: p2, ap: "OAT_RATE", v: 100 } : null,
    p4: p4 ? { st: p4, ap: "OAT_RATE", v: 100 } : null,
    p2_desc: "2pc", p4_desc: p4_desc ?? (p4 ? "4pc" : null),
  });

  it("keeps a 2-pc stat the 4-pc row does not carry", () => {
    const def: SetDef = { name: "X", desc: null, levels: [row(1, [0, 1, 2, 3], null, "ST_DEF", true), row(2, [4], "ST_ATK", "ST_ATK", false)] };
    expect(wornSetRows(def, [4, 4, 3, 3]).drop2).toBe(false);
  });

  it("drops a combat-effect 2-pc only when the 4-pc row's 4-pc is a combat effect too", () => {
    const withBuff4: SetDef = { name: "X", desc: null, levels: [row(1, [0, 1, 2, 3], null, null, true, "buff 4pc"), row(2, [4], null, null, false)] };
    expect(wornSetRows(withBuff4, [3, 3, 3, 3]).drop2).toBe(true);
    // Fortification at level 2: ignoreLowSet but an empty 4-pc → its 2-pc stays.
    const fort = SETS["8"]!;
    expect(wornSetRows(fort, [4, 4, 4, 4]).row4?.ignoreLowSet).toBe(true);
    expect(wornSetRows(fort, [4, 4, 4, 4]).drop2).toBe(false);
  });
});
