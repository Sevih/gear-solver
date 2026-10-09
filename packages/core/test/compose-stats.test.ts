import { describe, it, expect } from "vitest";
import {
  baseAtLevel,
  sumEvoUpTo,
  calcFinalStat,
  composeCharStats,
  type ComposeOptions,
  type NoGearStats,
} from "../src/compose-stats.js";
import type {
  CharacterIngredients,
  CharactersTable,
  CodexCurve,
  StatBlock,
  StatBracket,
} from "../src/gamedata.js";
import charactersJson from "../../../data/derived/characters.json";
import codexCurveJson from "../../../data/derived/codex-curve.json";
import charLevelMaxJson from "../../../data/derived/char-level-max.json";
import statLocksJson from "../../../data/stat-locks.json";

// Committed game data (data/derived, synced from outerpedia) and the in-game
// captures (data/stat-locks.json), imported as-is so the tests run against the
// exact tables the app ships with.
const characters = charactersJson as unknown as CharactersTable;
const codexCurve = codexCurveJson as CodexCurve;
const charLevelMax = charLevelMaxJson as Record<string, { requireLevel: number; maxLevel: number; statModifierAfter100: number }>;
interface LockEntry { name: string; charId: number; level: number; stats: Record<string, number> }
const statLocks = statLocksJson as Record<string, LockEntry>;

const allIngredients: [string, CharacterIngredients][] = Object.entries(characters)
  .filter((e): e is [string, typeof e[1] & { ingredients: CharacterIngredients }] => e[1].ingredients != null)
  .map(([id, c]) => [id, c.ingredients]);

const ZERO: StatBlock = {
  atk: 0, def: 0, hp: 0, spd: 0, chc: 0, chd: 0, pen: 0, dmgInc: 0, dmgRed: 0,
  eff: 0, res: 0, effRate: 0, resRate: 0, atkPct: 0, defPct: 0, hpPct: 0,
};
const block = (patch: Partial<StatBlock>): StatBlock => ({ ...ZERO, ...patch });

/** LB modifiers per step, read from the committed CharacterMaxLevelTemplet
 *  mirror (3★ rows — the only BasicStar that reaches LB in practice). */
const LB_MOD = [0, 1, 2, 3].map((step) => (step === 0 ? 0 : charLevelMax[`3|${step}`]!.statModifierAfter100));
/** Max level reached at each LB step (100 / 105 / 110 / 120). */
const LB_CAP = [0, 1, 2, 3].map((step) => (step === 0 ? 100 : charLevelMax[`3|${step}`]!.maxLevel));
/** Smallest LB step whose cap allows `level`. */
const lbStepFor = (level: number): number => LB_CAP.findIndex((cap) => level <= cap);

const LEVELS = Array.from({ length: 120 }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// Captures from data/stat-locks.json
// ---------------------------------------------------------------------------
//
// The locks are FINAL stats read on the Builds tab: gear included, composed
// with the account's captured progression (TransStar, LB step, geas, codex,
// skill levels). Neither the inventory nor that progression is committed
// (tools/capture/out/ is git-ignored), so a lock is only reproducible here
// when the hero carried no gear on the locked axis AND the composer's
// "max everything" defaults equal the captured progression. Only these cases
// are asserted below; the other locks stay app-side (drift badge).

/** Lock key → NoGearStats key (the lock file uses the FinalStats names). */
const LOCK_KEY: Record<string, keyof NoGearStats> = {
  atk: "atk", def: "def", hp: "hp", spd: "spd", crc: "chc", chd: "chd",
  pen: "pen", dmgUp: "dmgInc", dmgRed: "dmgRed", eff: "eff", res: "res",
};

function lockFor(name: string): LockEntry {
  const entry = Object.values(statLocks).find((l) => l.name === name);
  if (!entry) throw new Error(`stat-locks.json has no capture named "${name}"`);
  return entry;
}

function expectLockedStats(noGear: NoGearStats, lock: LockEntry, keys: string[]): void {
  for (const k of keys) {
    expect.soft(noGear[LOCK_KEY[k]!], `${lock.name} ${k}`).toBe(lock.stats[k]);
  }
}

describe("composeCharStats — in-game captures reproducible from committed files", () => {
  it("Flamberge lv5 (TransStar 9, LB0, no gear): all 8 locked stats", () => {
    const lock = lockFor("Flamberge");
    // TransStar 9 = 6 UI stars (the "6★" of the composer comments). Level 5
    // gates every evolution row (first unlock at lv20).
    const { noGearStats } = composeCharStats(characters[String(lock.charId)]!.ingredients!, codexCurve, {
      level: lock.level, levelMaxStep: 0, transStar: 9,
    });
    expectLockedStats(noGearStats, lock, Object.keys(lock.stats));
    expect(Object.keys(lock.stats)).toHaveLength(8);
  });

  it("Core Fusion Notia lv100: EFF 255 (core +50% EFF on top of the 120 baseline)", () => {
    const lock = lockFor("Core Fusion Notia");
    // The lock stores the base charId (2000056); the fused hero composes from
    // its fusion variant 2700056, as BuildsScreen's `effectiveCharId` does.
    expect(lock.charId).toBe(2000056);
    const { noGearStats, scaling } = composeCharStats(characters["2700056"]!.ingredients!, codexCurve, {
      level: lock.level, levelMaxStep: 0,
    });
    expectLockedStats(noGearStats, lock, ["eff"]);
    expect(scaling.eff.buffPct).toBe(50);
  });

  it("Aer lv100 LB0: the 6 axes without gear contribution", () => {
    const lock = lockFor("Aer");
    const { noGearStats } = composeCharStats(characters[String(lock.charId)]!.ingredients!, codexCurve, {
      level: lock.level, levelMaxStep: 0,
    });
    // ATK (2273) and CRC (23) include gear — not reproducible without the
    // captured inventory.
    expectLockedStats(noGearStats, lock, ["def", "hp", "spd", "chd", "eff", "res"]);
    expect(noGearStats.atk).toBeLessThan(lock.stats.atk!);
    expect(noGearStats.chc).toBeLessThan(lock.stats.crc!);
  });

  it("Mystic Sage Ame lv105 LB1: white sheet ATK 1307 / DEF 965 / HP 3913 / EFF 120", () => {
    // These in-game values come from the composer's doc comments (baseAtLevel,
    // intrinsicStats), not from stat-locks.json, whose Ame entry is geared.
    const lock = lockFor("Mystic Sage Ame");
    const { intrinsicStats, scaling } = composeCharStats(characters[String(lock.charId)]!.ingredients!, codexCurve, {
      level: 105, levelMaxStep: 1, levelMaxModifier: LB_MOD[1],
    });
    expect(intrinsicStats.atk).toBe(1307);
    expect(intrinsicStats.def).toBe(965);
    expect(intrinsicStats.hp).toBe(3913);
    expect(intrinsicStats.eff).toBe(120);
    // ATK breakdown documented as base + evo 2..7 + geas = 783 + 124 + 400.
    expect(scaling.atk.baseValue).toBe(783);
    expect(scaling.atk.evoValue).toBe(124);
    expect(scaling.atk.awakValue).toBe(400);
  });

  it("every capture still points to a character with ingredients", () => {
    for (const lock of Object.values(statLocks)) {
      expect(characters[String(lock.charId)]?.ingredients, lock.name).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// baseAtLevel
// ---------------------------------------------------------------------------

describe("baseAtLevel — level bounds", () => {
  it("lands on Min at lv1 and on Max at lv100, whatever the LB modifier", () => {
    for (const [id, ing] of allIngredients) {
      for (const [stat, b] of Object.entries(ing.base) as [string, StatBracket][]) {
        for (const mod of LB_MOD) {
          expect(baseAtLevel(b, 1, mod), `${id} ${stat}`).toBe(b.min);
          expect(baseAtLevel(b, 100, mod), `${id} ${stat}`).toBe(b.max);
        }
      }
    }
  });

  it("ignores the modifier up to lv100", () => {
    const b = { min: 74, max: 744 };
    for (let L = 1; L <= 100; L++) {
      for (const mod of LB_MOD) expect(baseAtLevel(b, L, mod)).toBe(baseAtLevel(b, L, 0));
    }
  });

  it("is constant when Min == Max", () => {
    for (const L of LEVELS) for (const mod of LB_MOD) expect(baseAtLevel({ min: 138, max: 138 }, L, mod)).toBe(138);
  });

  it("returns integers (growth floored, never propagated as a float)", () => {
    const bad: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [stat, b] of Object.entries(ing.base) as [string, StatBracket][]) {
        for (const L of LEVELS) if (!Number.isInteger(baseAtLevel(b, L, LB_MOD[lbStepFor(L)]!))) bad.push(`${id} ${stat} lv${L}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("floors the two legs independently", () => {
    // rng 670: base leg floor(670×104/99) = 703, LB leg floor(670×5×200/99000) = 6.
    // A single floor over the float sum (703.79 + 6.77) would give 710, not 709.
    expect(baseAtLevel({ min: 74, max: 744 }, 105, 200)).toBe(74 + 703 + 6);
  });
});

describe("baseAtLevel — limit-break tiers", () => {
  it("reads the 200 / 400 / 700 modifiers and 105 / 110 / 120 caps from the table", () => {
    expect(LB_MOD).toEqual([0, 200, 400, 700]);
    expect(LB_CAP).toEqual([100, 105, 110, 120]);
  });

  it("above lv100, a higher LB modifier never lowers the stat", () => {
    const bad: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [stat, b] of Object.entries(ing.base) as [string, StatBracket][]) {
        for (let L = 101; L <= 120; L++) {
          for (let s = 1; s < LB_MOD.length; s++) {
            if (baseAtLevel(b, L, LB_MOD[s]!) < baseAtLevel(b, L, LB_MOD[s - 1]!)) bad.push(`${id} ${stat} lv${L} LB${s}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("with modifier 0 past lv100, extrapolates the lv1..100 line", () => {
    const b = { min: 476, max: 3251 };
    for (let L = 101; L <= 120; L++) expect(baseAtLevel(b, L, 0)).toBe(b.min + Math.floor((b.max - b.min) * (L - 1) / 99));
  });
});

describe("baseAtLevel — monotonicity", () => {
  it("never decreases with level, LB modifier following the level (every committed bracket)", () => {
    const bad: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [stat, b] of Object.entries(ing.base) as [string, StatBracket][]) {
        let prev = -Infinity;
        for (const L of LEVELS) {
          const v = baseAtLevel(b, L, LB_MOD[lbStepFor(L)]!);
          if (v < prev) bad.push(`${id} ${stat} lv${L}: ${prev} → ${v}`);
          prev = v;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("never decreases with level at a fixed modifier", () => {
    for (const mod of LB_MOD) {
      let prev = -Infinity;
      for (const L of LEVELS) {
        const v = baseAtLevel({ min: 27, max: 278 }, L, mod);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// sumEvoUpTo
// ---------------------------------------------------------------------------

/** Rows 2..9 with a distinct power of two on ATK, so the sum names exactly
 *  which rows were applied. */
const EVO_BITS: CharacterIngredients["evoByLevel"] = Object.fromEntries(
  [2, 3, 4, 5, 6, 7, 8, 9].map((e) => [String(e), block({ atk: 2 ** e })]),
);
const rowsOf = (sum: StatBlock): number[] =>
  [2, 3, 4, 5, 6, 7, 8, 9].filter((e) => (sum.atk & (2 ** e)) !== 0);

describe("sumEvoUpTo — level gates", () => {
  it("applies nothing below lv20", () => {
    for (let L = 1; L < 20; L++) expect(sumEvoUpTo(EVO_BITS, 9, 9, L)).toEqual(ZERO);
  });

  it("unlocks 2..6 at lv 20 / 40 / 60 / 80 / 100", () => {
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 19))).toEqual([]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 20))).toEqual([2]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 59))).toEqual([2, 3]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 80))).toEqual([2, 3, 4, 5]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 100))).toEqual([2, 3, 4, 5, 6]);
  });

  it("unlocks 7 / 8 / 9 at the LB caps 105 / 110 / 120 (nothing new at 115)", () => {
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 104))).toEqual([2, 3, 4, 5, 6]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 105))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 110))).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 115))).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 9, 120))).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps an unknown row locked until lv120", () => {
    const evo = { ...EVO_BITS, "10": block({ atk: 2 ** 10 }) };
    expect(sumEvoUpTo(evo, 10, 10, 119).atk & 2 ** 10).toBe(0);
    expect(sumEvoUpTo(evo, 10, 10, 120).atk & 2 ** 10).toBe(2 ** 10);
  });
});

describe("sumEvoUpTo — star and LB caps", () => {
  it("caps at min(TransStar, 6 + LB) even at lv120", () => {
    // LB0 (cap 6): a max-level, max-star hero never gets 7..9.
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 6 + 0, 120))).toEqual([2, 3, 4, 5, 6]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 6 + 1, 120))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 6 + 2, 120))).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 9, 6 + 3, 120))).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // TransStar below the LB cap wins.
    expect(rowsOf(sumEvoUpTo(EVO_BITS, 4, 6 + 3, 120))).toEqual([2, 3, 4]);
  });

  it("is the sum of exactly the selected rows on every axis (committed data)", () => {
    for (const [id, ing] of allIngredients) {
      for (let LB = 0; LB <= 3; LB++) {
        const sum = sumEvoUpTo(ing.evoByLevel, 9, 6 + LB, LB_CAP[LB]!);
        const expected = { ...ZERO };
        for (const [k, row] of Object.entries(ing.evoByLevel)) {
          if (Number(k) > 6 + LB) continue;
          for (const s of Object.keys(ZERO) as (keyof StatBlock)[]) expected[s] += row[s];
        }
        expect(sum, `${id} LB${LB}`).toEqual(expected);
      }
    }
  });
});

describe("sumEvoUpTo — monotonicity", () => {
  const STATS = Object.keys(ZERO) as (keyof StatBlock)[];
  let bad: string[] = [];
  const leq = (a: StatBlock, b: StatBlock, ctx: string) => {
    for (const s of STATS) if (a[s] > b[s]) bad.push(`${ctx} ${s}: ${a[s]} → ${b[s]}`);
  };

  it("committed evolution rows are non-negative (precondition of the properties below)", () => {
    const negative: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [k, row] of Object.entries(ing.evoByLevel)) {
        for (const s of STATS) if (row[s] < 0) negative.push(`${id} evo${k} ${s}`);
      }
    }
    expect(negative).toEqual([]);
  });

  it("never decreases with level, TransStar or LB (every committed hero)", () => {
    bad = [];
    for (const [id, ing] of allIngredients) {
      for (let L = 2; L <= 120; L++) {
        leq(sumEvoUpTo(ing.evoByLevel, 9, 9, L - 1), sumEvoUpTo(ing.evoByLevel, 9, 9, L), `${id} lv${L}`);
      }
      for (let star = 2; star <= 9; star++) {
        leq(sumEvoUpTo(ing.evoByLevel, star - 1, 9, 120), sumEvoUpTo(ing.evoByLevel, star, 9, 120), `${id} ★${star}`);
      }
      for (let LB = 1; LB <= 3; LB++) {
        leq(sumEvoUpTo(ing.evoByLevel, 9, 6 + LB - 1, 120), sumEvoUpTo(ing.evoByLevel, 9, 6 + LB, 120), `${id} LB${LB}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calcFinalStat (CFormula::CalcFinalStat)
// ---------------------------------------------------------------------------

/** Positional order of calcFinalStat, named for readability. */
interface CalcArgs {
  base: number; evo: number; awak: number;
  awakRate: number; transRate: number;
  gearFlat: number; gearRate: number;
  archiveRate: number; buffRate: number; buffValue: number;
}
const NONE: CalcArgs = {
  base: 0, evo: 0, awak: 0, awakRate: 0, transRate: 0, gearFlat: 0, gearRate: 0, archiveRate: 0, buffRate: 0, buffValue: 0,
};
const calc = (p: Partial<CalcArgs>): number => {
  const a = { ...NONE, ...p };
  return calcFinalStat(a.base, a.evo, a.awak, a.awakRate, a.transRate, a.gearFlat, a.gearRate, a.archiveRate, a.buffRate, a.buffValue);
};

describe("calcFinalStat — formula", () => {
  it("is the plain sum of flats when every rate is 0", () => {
    expect(calc({ base: 744, evo: 124, awak: 400, gearFlat: 250, buffValue: 50 })).toBe(744 + 124 + 400 + 250 + 50);
  });

  it("compounds the inner rates, then the buff rate, then adds codex on base only", () => {
    // part1 = trunc(1000 × 1.25) = 1250 ; part2 = trunc((1250 + 100) × 1.1) = 1485
    // codex = trunc(800 × 0.07) = 56
    const v = calc({ base: 800, evo: 150, awak: 50, awakRate: 50, transRate: 150, gearRate: 50, gearFlat: 100, buffRate: 100, archiveRate: 70 });
    expect(v).toBe(1485 + 56);
  });

  it("truncates each stage (Notia: (10 + 110 + 50 EFF) × 1.5 = 255)", () => {
    expect(calc({ base: 10, evo: 110, buffValue: 50, buffRate: 500 })).toBe(255);
    // trunc at part1: 999 × 1.001 = 999.999 → 999, then again → 999. A single
    // trunc over the compound (999 × 1.001 × 1.001 = 1000.998) would give 1000.
    expect(calc({ base: 999, transRate: 1, buffRate: 1 })).toBe(999);
  });

  it("truncates toward zero on negative intermediates, then clamps at 0", () => {
    // part2 = trunc(-15 × 1.5) = trunc(-22.5) = -22 (floor would give -23),
    // codex = trunc(100 × 0.3) = 30.
    expect(calc({ base: 100, gearFlat: -115, buffRate: 500, archiveRate: 300 })).toBe(-22 + 30);
    expect(calc({ base: 10, gearFlat: -500 })).toBe(0);
  });

  it("applies codex to the base value only, not to evo / geas / gear", () => {
    const withCodex = (p: Partial<CalcArgs>) => calc({ ...p, archiveRate: 100 }) - calc(p);
    expect(withCodex({ base: 1000 })).toBe(100);
    expect(withCodex({ base: 1000, evo: 500, awak: 300, gearFlat: 900, transRate: 300, buffRate: 300 })).toBe(100);
  });

  it("treats awak / transcend / gear rates as one additive bundle", () => {
    expect(calc({ base: 1000, awakRate: 100, transRate: 200, gearRate: 300 })).toBe(calc({ base: 1000, transRate: 600 }));
  });
});

describe("calcFinalStat — monotonicity", () => {
  const STEPS: Record<keyof CalcArgs, number[]> = {
    base: [0, 1, 7, 99, 744, 3251],
    evo: [0, 3, 124, 394],
    awak: [0, 5, 400],
    awakRate: [0, 30, 100],
    transRate: [0, 100, 300],
    gearFlat: [0, 1, 250, 1800],
    gearRate: [0, 70, 450],
    archiveRate: [0, 20, 100],
    buffRate: [0, 50, 300, 500],
    buffValue: [0, 5, 50],
  };
  const SAMPLES: Partial<CalcArgs>[] = [
    {},
    { base: 744, evo: 124, awak: 400, transRate: 300, archiveRate: 100 },
    { base: 3251, evo: 394, gearFlat: 1800, gearRate: 450, buffRate: 300 },
    { base: 10, evo: 110, buffValue: 50, buffRate: 500 },
    { base: 99, awakRate: 30, transRate: 100, gearRate: 70, archiveRate: 20, buffRate: 50, buffValue: 5 },
  ];

  it("never decreases when any single non-negative input grows", () => {
    for (const sample of SAMPLES) {
      for (const key of Object.keys(STEPS) as (keyof CalcArgs)[]) {
        let prev = -Infinity;
        for (const x of STEPS[key]) {
          const v = calc({ ...sample, [key]: x });
          expect(v, `${JSON.stringify(sample)} ${key}=${x}`).toBeGreaterThanOrEqual(prev);
          prev = v;
        }
      }
    }
  });

  it("returns non-negative integers", () => {
    for (const sample of SAMPLES) {
      for (const gearFlat of [-5000, -1, 0, 1]) {
        const v = calc({ ...sample, gearFlat });
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// composeCharStats — whole-sheet properties over the committed roster
// ---------------------------------------------------------------------------

describe("composeCharStats — level progression (every committed hero)", () => {
  const optsAt = (L: number): ComposeOptions => {
    const step = lbStepFor(L);
    return { level: L, levelMaxStep: step, levelMaxModifier: LB_MOD[step] };
  };
  const AXES: (keyof NoGearStats)[] = ["atk", "def", "hp", "spd", "chc", "chd", "pen", "dmgInc", "dmgRed", "eff", "res"];

  it("no-gear and white stats never decrease from lv1 to lv120", () => {
    const bad: string[] = [];
    for (const [id, ing] of allIngredients) {
      let prev: ReturnType<typeof composeCharStats> | null = null;
      for (const L of LEVELS) {
        const cur = composeCharStats(ing, codexCurve, optsAt(L));
        if (prev) {
          for (const k of AXES) {
            if (cur.noGearStats[k] < prev.noGearStats[k]) bad.push(`${id} lv${L} ${k}`);
            if (cur.intrinsicStats[k] < prev.intrinsicStats[k]) bad.push(`${id} lv${L} white ${k}`);
          }
        }
        prev = cur;
      }
    }
    expect(bad).toEqual([]);
  });

  it("scaling.baseValue equals baseAtLevel at the level bounds and LB caps", () => {
    for (const [id, ing] of allIngredients) {
      for (const L of [1, 100, ...LB_CAP.slice(1)]) {
        const { scaling } = composeCharStats(ing, codexCurve, optsAt(L));
        const mod = LB_MOD[lbStepFor(L)]!;
        expect(scaling.atk.baseValue, `${id} lv${L}`).toBe(baseAtLevel(ing.base.atk, L, mod));
        expect(scaling.def.baseValue, `${id} lv${L}`).toBe(baseAtLevel(ing.base.def, L, mod));
        expect(scaling.hp.baseValue, `${id} lv${L}`).toBe(baseAtLevel(ing.base.hp, L, mod));
      }
    }
  });

  it("noGear ATK/DEF/HP/EFF/RES equal calcFinalStat over the exposed scaling", () => {
    for (const [id, ing] of allIngredients) {
      for (const L of [1, 50, 100, 105, 110, 120]) {
        const { noGearStats, scaling } = composeCharStats(ing, codexCurve, optsAt(L));
        for (const k of ["atk", "def", "hp", "eff", "res"] as const) {
          const s = scaling[k];
          expect(noGearStats[k], `${id} lv${L} ${k}`).toBe(
            calcFinalStat(s.baseValue, s.evoValue, s.awakValue, s.awakPct * 10, s.transcendPct * 10, 0, 0, s.codexPct * 10, s.buffPct * 10, s.buffValue),
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Against the game client — CFormula.CalcFinalStat (client 1.4.18, decompiled)
// ---------------------------------------------------------------------------
//
// The client computes every stat in 64-bit integers: the flat sum
// (base + evo + awakening + Monad Gate enchant) times (1000 + spawn-advantage
// + transcend + item-option + awakening + Monad-enchant rates), divided by
// 1000; plus item-option flat and buff flat; times (1000 + buff rate) / 1000;
// plus base × archive rate / 1000; cast to int, then max(0, ·). C# integer
// division truncates toward zero. The reference below re-derives that with
// BigInt so the JS double arithmetic of `calcFinalStat` is checked against
// exact integer arithmetic.

/** Exact-integer model of the client formula, including the two terms
 *  gear-solver does not carry (spawn-advantage rate, Monad Gate enchant
 *  flat + rate). */
function clientCalcFinalStat(a: CalcArgs & { spawnRate?: number; monadValue?: number; monadRate?: number }): number {
  const B = BigInt;
  const flat = B(a.base) + B(a.evo) + B(a.awak) + B(a.monadValue ?? 0);
  const rate = 1000n + B(a.spawnRate ?? 0) + B(a.transRate) + B(a.gearRate) + B(a.awakRate) + B(a.monadRate ?? 0);
  const inner = flat * rate / 1000n + B(a.gearFlat) + B(a.buffValue);
  const total = inner * (1000n + B(a.buffRate)) / 1000n + B(a.base) * B(a.archiveRate) / 1000n;
  return Math.max(0, Number(total));
}

/** Deterministic PRNG (mulberry32) — reproducible "random" inputs. */
function rng(seed: number): (lo: number, hi: number) => number {
  let s = seed >>> 0;
  return (lo, hi) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return lo + Math.floor(r * (hi - lo + 1));
  };
}

describe("calcFinalStat — term by term against CFormula.CalcFinalStat", () => {
  it("matches exact integer arithmetic on 20 000 inputs, negatives included", () => {
    const r = rng(0x5eed);
    const bad: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const a: CalcArgs = {
        base: r(0, 12_000), evo: r(0, 2_000), awak: r(0, 1_500),
        awakRate: r(-200, 600), transRate: r(0, 600), gearFlat: r(-3_000, 20_000), gearRate: r(-500, 3_000),
        archiveRate: r(0, 200), buffRate: r(-900, 2_000), buffValue: r(-500, 500),
      };
      const got = calc(a);
      const want = clientCalcFinalStat(a);
      if (got !== want) bad.push(`${JSON.stringify(a)}: ${got} ≠ ${want}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("orders the stages like the client: inner rate bundle, + item flat + buff flat, × buff rate, + archive", () => {
    // The item-option flat and the buff flat sit OUTSIDE the inner rate bundle
    // but INSIDE the buff-rate amplifier.
    const a: CalcArgs = { ...NONE, base: 1000, transRate: 500, gearFlat: 100, buffValue: 20, buffRate: 100, archiveRate: 50 };
    // inner = 1000 × 1.5 = 1500 ; (1500 + 100 + 20) × 1.1 = 1782 ; + 1000 × 0.05 = 50
    expect(calc(a)).toBe(1832);
    expect(clientCalcFinalStat(a)).toBe(1832);
  });

  it("truncates both divisions toward zero, as C# long division does", () => {
    // inner flat × rate negative: -7 × 1.5 = -10.5 → -10 (floor: -11)
    const a: CalcArgs = { ...NONE, base: 0, evo: -7, transRate: 500, archiveRate: 0, gearFlat: 30 };
    expect(calc(a)).toBe(-10 + 30);
    expect(clientCalcFinalStat(a)).toBe(20);
  });

  it("the white sheet value is the client formula with only base / evo / awakening (no gear, no buff)", () => {
    // CStatValue derives the yellow "(+X)" delta as final − CalcFinalStat(base,
    // spawn, evo, awakening, awakening rate, 0…). For a hero sheet (no spawn
    // advantage) that baseline equals `intrinsicStats` as long as no
    // awakening (IOT_STAT geas) RATE exists — see the data guard below.
    for (const [id, ing] of allIngredients) {
      const { intrinsicStats, scaling } = composeCharStats(ing, codexCurve, { level: 120, levelMaxStep: 3, levelMaxModifier: LB_MOD[3] });
      for (const k of ["atk", "def", "hp"] as const) {
        const s = scaling[k];
        expect(intrinsicStats[k], `${id} ${k}`).toBe(
          clientCalcFinalStat({ ...NONE, base: s.baseValue, evo: s.evoValue, awak: s.awakValue, awakRate: s.awakPct * 10 }),
        );
      }
    }
  });
});

describe("baseAtLevel — against CStatValue / CFormula.CalcStat", () => {
  it("matches the client's integer interpolation (two separate integer divisions above lv100)", () => {
    // The client floors the LB leg as (rng × mod × (L-100) / 1000) / 99 in two
    // integer divisions; floor(floor(x / 1000) / 99) = floor(x / 99000) for
    // x ≥ 0, so the single division of `baseAtLevel` is equivalent.
    const bad: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [stat, b] of Object.entries(ing.base) as [string, StatBracket][]) {
        for (const L of LEVELS) {
          const mod = LB_MOD[lbStepFor(L)]!;
          const r = BigInt(b.max - b.min);
          const base = r * BigInt(L - 1) / 99n + BigInt(b.min);
          const extra = L > 100 ? r * BigInt(mod) * BigInt(L - 100) / 1000n / 99n : 0n;
          if (baseAtLevel(b, L, mod) !== Number(base + extra)) bad.push(`${id} ${stat} lv${L}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Terms the client has and gear-solver does not
// ---------------------------------------------------------------------------
//
// Each guard below holds on today's committed data. When one fails, the data
// gained a case the composer cannot represent: fix compose-stats (or the
// outerpedia generator), not the test.

describe("client terms gear-solver does not model — data guards", () => {
  const buffBlocks = (ing: CharacterIngredients): [string, StatBlock][] => [
    ["classPassive", ing.classPassive],
    ...Object.entries(ing.skill8ByLevel).map(([l, b]) => [`skill8@${l}`, b] as [string, StatBlock]),
    ...(["s1ByLevel", "s2ByLevel", "s3ByLevel"] as const).flatMap((s) =>
      Object.entries(ing[s] ?? {}).map(([l, b]) => [`${s}@${l}`, b] as [string, StatBlock])),
    ...(ing.corePassive ? [["corePassive", ing.corePassive] as [string, StatBlock]] : []),
  ];

  it("no awakening (IOT_STAT geas) rate: the client compounds it into the white value, intrinsicStats does not", () => {
    const hits: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [nodeId, node] of Object.entries(ing.geasByNode)) {
        if (node.source !== "stat") continue;
        for (const [lv, b] of Object.entries(node.levels)) {
          for (const s of ["atkPct", "defPct", "hpPct", "effRate", "resRate"] as const) if (b[s]) hits.push(`${id} geas ${nodeId}@${lv} ${s}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("no flat ATK/DEF/HP from a buff source: the client adds it as buff value, the composer drops it (class / skill / core) or compounds it as awakening (geas IOT_BUFF)", () => {
    const hits: string[] = [];
    for (const [id, ing] of allIngredients) {
      for (const [name, b] of buffBlocks(ing)) for (const s of ["atk", "def", "hp"] as const) if (b[s]) hits.push(`${id} ${name} ${s}`);
      for (const [nodeId, node] of Object.entries(ing.geasByNode)) {
        if (node.source !== "buff") continue;
        for (const [lv, b] of Object.entries(node.levels)) for (const s of ["atk", "def", "hp"] as const) if (b[s]) hits.push(`${id} geas ${nodeId}@${lv} ${s}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("only the two known SPD-rate core passives are pre-baked as flat SPD", () => {
    // outerpedia's generator turns an OAT_RATE SPD buff into a flat
    // floor((base max + all evo) × rate / 1000). The client applies the rate
    // to the whole combined value (current-level base + unlocked evo + gear +
    // buff flats), so the two only agree at full evolution without gear.
    const spdCore = allIngredients
      .filter(([, ing]) => (ing.corePassive?.spd ?? 0) !== 0)
      .map(([id]) => id);
    expect(spdCore).toEqual(["2700003", "2700005"]); // Core Fusion Snow, Core Fusion Lisha
  });
});

describe("known divergence — pre-baked SPD rate (Core Fusion Snow, +4.3% SPD)", () => {
  const snow = characters["2700003"]!.ingredients!;
  const SPD_RATE = 43; // core_passive_2star_ablity_speed, OAT_RATE per-mille
  const clientSpd = (level: number, step: number, gearFlat = 0) => {
    const base = baseAtLevel(snow.base.spd, level, LB_MOD[step]!);
    const evo = sumEvoUpTo(snow.evoByLevel, 9, 6 + step, level).spd;
    return clientCalcFinalStat({ ...NONE, base, evo, gearFlat, buffRate: SPD_RATE });
  };
  const composedSpd = (level: number, step: number) =>
    composeCharStats(snow, codexCurve, { level, levelMaxStep: step, levelMaxModifier: LB_MOD[step] }).noGearStats.spd;

  it("agrees with the client at lv100 (LB0) and lv120 (LB3), without gear", () => {
    expect(composedSpd(100, 0)).toBe(clientSpd(100, 0)); // 160
    expect(composedSpd(120, 3)).toBe(clientSpd(120, 3)); // 168
  });

  it("still overstates SPD by 1 at lv1 (138 × 1.043 = 143.9 → 143, composer 138 + 6 = 144)", () => {
    expect(clientSpd(1, 0)).toBe(143);
    expect(composedSpd(1, 0)).toBe(144);
  });

  it("does not amplify gear SPD: +40 SPD of gear is +41 in the client", () => {
    // Renderer side (composeBuild.computeFinalStats) adds gear SPD flat on top
    // of the no-gear SPD, so the composed sheet stays at 160 + 40 = 200.
    expect(clientSpd(100, 0, 40)).toBe(202);
    expect(composedSpd(100, 0) + 40).toBe(200);
  });
});
