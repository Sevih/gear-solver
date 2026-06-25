/**
 * Solver regression tests — the load-bearing math the hot loop relies on.
 *
 * Why these specifically:
 *  - `aggregateGemDelta` + the `gemOverride` path in `aggregateGearBuckets`
 *    is the perf-critical optimization that replaced per-combo
 *    `resolveStat × 10 gems × N combos`. A silent regression here would
 *    inflate stats vs in-game without crashing.
 *  - `computeCheapRatings` is keyed off `FinalStats.crc/chd` being in
 *    DISPLAY percent form (35 = 35%). Drift between display and decimal
 *    would silently 100x the rating values.
 *  - `STAT_TO_PRIORITY` mapping engine→user keys: without it, half the
 *    priority panel doesn't influence ranking (rolls with `critRate` key
 *    don't see priority `crc`).
 *  - `TopKHeap` keeps the top-K by score; min-heap regression silently
 *    drops better builds in favor of worse ones.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat, StatType } from "@gear-solver/core";
import { aggregateGearBuckets, type GemOverride } from "../src/lib/composeBuild.js";
import { simulateReforges, TopKHeap } from "../src/lib/solver/engine.js";
import type { SolveBuild } from "../src/lib/solver/types.js";
import { aggregateGemDelta, allocateGems, buildGemPool, gemSlotsOf, scoreGemPool } from "../src/lib/solver/gems.js";
import { computeCheapRatings, computeScore, STAT_NORMS, STAT_TO_PRIORITY } from "../src/lib/solver/ratings.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Test fixtures — minimal GameData covering the gem IDs and option lookups
 * the assertions touch. Real `data/derived/options.json` has 20+k entries;
 * we only need the gem block (15001..15054) for the override math.
 * ───────────────────────────────────────────────────────────────────────── */
const gemOpt = (st: string, ap: string, v: number) => ({ st, ap, v });

const game = {
  options: {
    // ATK% gems (15001..15046, every 9 IDs = next level)
    "15001": gemOpt("ST_ATK", "OAT_RATE", 3),     // Lv1: +0.3% ATK
    "15037": gemOpt("ST_ATK", "OAT_RATE", 24),    // Lv5: +2.4% ATK
    // CHC gems
    "15004": gemOpt("ST_CRITICAL_RATE", "OAT_ADD", 2),   // Lv1: +0.2% CHC
    "15049": gemOpt("ST_CRITICAL_RATE", "OAT_ADD", 30),  // Lv6: +3.0% CHC
    // DMG_BOOST gems
    "15053": gemOpt("ST_DMG_BOOST", "OAT_ADD", 40),      // Lv6: +4.0% DMG+
  },
  equipment: {},
  sets: {},
  equipmentPassives: {},
  multiTierPassives: {},
  gems: {},
  singularityOptions: {},
  eePassives: {},
  characters: {},
  enhance: { enhanceFactor: 0, tierFactor: 0, maxEnhanceLevel: 10,
    singularity: { activation: 0, steps: [] }, expCurves: {} },
  buffs: {},
  expCharacter: [],
  charLevelMax: {},
  codexCurve: [],
  archiveBonus: [],
  trustCharacter: [],
  trustBuffs: [],
} as unknown as GameData;

/** Helper: build a minimal Talisman piece with the given gem IDs socketed.
 *  The parser stores gems in `subs` (resolved by `toRolled` from SubOptionList),
 *  so we mirror that: each gem's resolved (stat, value, percent) becomes a sub. */
function talismanWithGems(gemIds: number[]): GearPiece {
  const subs: RolledStat[] = gemIds.filter((id) => id !== 0).map((id) => {
    const def = (game.options as Record<string, { st: string; ap: string; v: number }>)[String(id)]!;
    const isRate = def.ap === "OAT_RATE";
    // Mirror parse.ts's resolveOption: percent = (rate || addPercent flag).
    // For CHC OAT_ADD, addPercent is true (it's a percent stat), so value/10.
    // For ATK OAT_RATE, isRate=true, value/10.
    // For DMG_BOOST OAT_ADD, addPercent=true, value/10.
    const percent = isRate || def.st === "ST_CRITICAL_RATE" || def.st === "ST_DMG_BOOST";
    const stat = (isRate
      ? (def.st === "ST_ATK" ? "atkPct" : def.st === "ST_CRITICAL_RATE" ? "critRate" : "dmgUp")
      : (def.st === "ST_ATK" ? "atk" : def.st === "ST_CRITICAL_RATE" ? "critRate" : "dmgUp")) as StatType;
    return { stat, value: percent ? def.v / 10 : def.v, percent, ticks: 1, reforgeTicks: 0 };
  });
  return {
    uid: "test-tali", itemId: 10203, slot: "ooparts", setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: "Test Talisman", classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 5, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: [], subs, gemSlots: gemIds,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * GEMS — pool building, scoring, allocation, delta aggregation
 * ───────────────────────────────────────────────────────────────────────── */

describe("buildGemPool", () => {
  it("counts each OptionID across all owned Talisman/EE pieces", () => {
    const inv = {
      gear: [
        talismanWithGems([15001, 15004, 15001, 0, 0]),      // 2× ATK lv1, 1× CHC lv1
        talismanWithGems([15049, 15049, 15053, 0, 0]),      // 2× CHC lv6, 1× DMG+ lv6
        { ...talismanWithGems([15037]), slot: "exclusive" as const, uid: "test-ee" }, // EE: 1× ATK lv5
      ],
      characters: [],
      presets: [],
    } as Inventory;
    const pool = buildGemPool(inv);
    expect(pool.get(15001)).toBe(2);
    expect(pool.get(15004)).toBe(1);
    expect(pool.get(15049)).toBe(2);
    expect(pool.get(15053)).toBe(1);
    expect(pool.get(15037)).toBe(1);
    expect(pool.get(99999)).toBeUndefined(); // not socketed
  });

  it("ignores gemSlots=0 (empty sockets)", () => {
    const inv = {
      gear: [talismanWithGems([0, 0, 0, 0, 0])],
      characters: [],
      presets: [],
    } as Inventory;
    expect(buildGemPool(inv).size).toBe(0);
  });
});

describe("scoreGemPool", () => {
  it("scores by priority × value / ROLL_NORMS, sorted desc", () => {
    const pool = new Map([[15001, 1], [15037, 1], [15004, 1]]);
    // priority: ATK=3 (high), CHC=0 (neutral)
    const scored = scoreGemPool(pool, { atk: 3 }, game);
    // ROLL_NORMS[atkPct] = 40
    //   ATK lv5 (15037) score = 3 × 2.4 / 40 = 0.18 — wins
    //   ATK lv1 (15001) score = 3 × 0.3 / 40 = 0.0225
    //   CHC lv1 (15004) score = 0 (no priority on crc)
    expect(scored[0]!.id).toBe(15037);
    expect(scored[1]!.id).toBe(15001);
    expect(scored[2]!.id).toBe(15004);
    expect(scored[2]!.score).toBe(0);
  });

  it("normalizes cross-stat — equal priority keeps both gems in the same ballpark", () => {
    // ATK% gem Lv5 (24% raw → 2.4 display) vs CHC gem Lv6 (30 raw → 3.0 display flat).
    // Without per-roll normalization, raw-value ranking would put CHC 8× over ATK
    // (or with STAT_NORMS sized for endgame: ATK 50× under CHC). With ROLL_NORMS
    // (atkPct=40, critRate=20) the ratio stays sane.
    const pool = new Map([[15037, 1], [15049, 1]]);
    const scored = scoreGemPool(pool, { atk: 1, crc: 1 }, game);
    // ATK: 1 × 2.4 / 40 = 0.06
    // CHC: 1 × 3.0 / 20 = 0.15 — CHC wins (more impactful per-roll at endgame)
    // ratio ~2.5× — both gems would be picked, ranking reflects realistic value
    expect(scored[0]!.id).toBe(15049);
    expect(scored[1]!.id).toBe(15037);
    const ratio = scored[0]!.score / scored[1]!.score;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(5);
  });

  it("returns empty score=0 for unknown gem IDs", () => {
    const pool = new Map([[99999, 1]]);
    expect(scoreGemPool(pool, { atk: 1 }, game)).toEqual([]);
  });

  it("expands pool multiplicity — 3 copies → 3 scored entries", () => {
    const pool = new Map([[15037, 3]]);
    const scored = scoreGemPool(pool, { atk: 1 }, game);
    expect(scored).toHaveLength(3);
    expect(scored.every((g) => g.id === 15037)).toBe(true);
  });

  it("priority empty → all scores collapse to 0 (default — SOLVE-mode semantics)", () => {
    const pool = new Map([[15037, 1], [15049, 1], [15053, 1]]);
    const scored = scoreGemPool(pool, {}, game);
    expect(scored.every((g) => g.score === 0)).toBe(true);
  });

  it("priority empty + allowZeroPriority=true → raw value/norm scoring (SOLVE CP fallback)", () => {
    // SOLVE CP without explicit priority: gems must still be optimized.
    // Score = value / ROLL_NORMS[stat], so high-tier gems beat low-tier
    // ones within each axis (allocator picks Lv5 over Lv1 for the same
    // ATK% axis, etc).
    const pool = new Map([[15001, 1], [15037, 1], [15049, 1], [15053, 1]]);
    const scored = scoreGemPool(pool, {}, game, { allowZeroPriority: true });
    expect(scored.every((g) => g.score > 0)).toBe(true);
    const atkLv5 = scored.find((g) => g.id === 15037)!;
    const atkLv1 = scored.find((g) => g.id === 15001)!;
    expect(atkLv5.score).toBeGreaterThan(atkLv1.score);
  });

  it("allowZeroPriority ignored when priority is non-empty (priority dominates)", () => {
    // Even with the opt-in flag, gems still ranked by priority × value/norm
    // when priority has any non-zero entry — no surprise raw-value fallback.
    const pool = new Map([[15053, 1]]); // DMG+ Lv6 — would top raw scoring
    const scored = scoreGemPool(pool, { atk: 3 }, game, { allowZeroPriority: true });
    expect(scored[0]!.score).toBe(0); // priority.dmgUp undefined → 0
  });
});

describe("allocateGems", () => {
  it("fills Talisman first, then EE, in score-desc order", () => {
    const scored = [
      { id: 15053, stat: "dmgUp", value: 4, percent: true, score: 100 },
      { id: 15049, stat: "critRate", value: 3, percent: true, score: 50 },
      { id: 15037, stat: "atkPct", value: 2.4, percent: true, score: 25 },
    ];
    const out = allocateGems(scored, 2, 1);
    expect(out.talisman).toEqual([15053, 15049]);
    expect(out.ee).toEqual([15037]);
  });

  it("stops at score ≤ 0 (skipping zero-priority gems)", () => {
    const scored = [
      { id: 15053, stat: "dmgUp", value: 4, percent: true, score: 100 },
      { id: 15049, stat: "critRate", value: 3, percent: true, score: 0 }, // stop here
      { id: 15037, stat: "atkPct", value: 2.4, percent: true, score: 25 },
    ];
    const out = allocateGems(scored, 2, 2);
    expect(out.talisman).toEqual([15053, 0]); // 1 picked, 1 padded
    expect(out.ee).toEqual([0, 0]);
  });

  it("pads with zeros to match slot count", () => {
    const out = allocateGems([], 4, 5);
    expect(out.talisman).toHaveLength(4);
    expect(out.ee).toHaveLength(5);
    expect(out.talisman.every((x) => x === 0)).toBe(true);
  });
});

describe("aggregateGemDelta", () => {
  it("aggregates per-stat into {flat, pct} buckets", () => {
    const scored = [
      { id: 15053, stat: "dmgUp", value: 4, percent: true, score: 10 },
      { id: 15037, stat: "atkPct", value: 2.4, percent: true, score: 5 },
      { id: 15037, stat: "atkPct", value: 2.4, percent: true, score: 5 }, // 2 copies stack
    ];
    const delta = aggregateGemDelta(scored, 2, 1);
    expect(delta).not.toBeNull();
    expect(delta!.pct.atkPct).toBeCloseTo(4.8);
    expect(delta!.pct.dmgUp).toBe(4);
    expect(delta!.flat).toEqual({});
  });

  it("returns null when no positive-scoring gems available", () => {
    const scored = [
      { id: 15001, stat: "atkPct", value: 0.3, percent: true, score: 0 },
    ];
    expect(aggregateGemDelta(scored, 5, 5)).toBeNull();
  });

  it("respects slot total cap (talismanSlots + eeSlots)", () => {
    const scored = Array.from({ length: 10 }, (_, i) => ({
      id: 15053, stat: "dmgUp", value: 4, percent: true, score: 100 - i,
    }));
    const delta = aggregateGemDelta(scored, 2, 1); // cap = 3
    expect(delta!.pct.dmgUp).toBe(12); // 3 × 4
  });

  it("end-to-end: SOLVE CP without priority yields a non-null delta (no silent skip)", () => {
    // Pre-fix bug: SOLVE CP without priority → all gem scores = 0 → delta
    // = null → solver kept currently-socketed gems → "max CP" actually
    // optimized everything EXCEPT gems. This test guards the fix path.
    const pool = new Map([[15053, 1], [15037, 1]]);
    const scored = scoreGemPool(pool, {}, game, { allowZeroPriority: true });
    const delta = aggregateGemDelta(scored, 5, 5);
    expect(delta).not.toBeNull();
    expect(Object.keys(delta!.pct).length).toBeGreaterThan(0);
  });
});

describe("gemSlotsOf", () => {
  it("returns 5 when enhanceLevel ≥ 5, else 4", () => {
    expect(gemSlotsOf(talismanWithGems([0]))).toBe(5); // enhanceLevel=5 in fixture
    expect(gemSlotsOf({ ...talismanWithGems([0]), enhanceLevel: 4 })).toBe(4);
    expect(gemSlotsOf({ ...talismanWithGems([0]), enhanceLevel: 0 })).toBe(4);
  });

  it("returns 0 for non-gem slots and null pieces", () => {
    expect(gemSlotsOf(null)).toBe(0);
    expect(gemSlotsOf({ ...talismanWithGems([0]), slot: "weapon" })).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * COMPOSE BUILD — gem override equivalence
 *
 * The optimization replaces "iterate piece.subs (which holds current gems)"
 * with "use a pre-aggregated {flat, pct} delta". For the SAME gems, both
 * paths must produce identical buckets. This is the load-bearing invariant
 * — break it and every solver-side stat silently drifts.
 * ───────────────────────────────────────────────────────────────────────── */

describe("aggregateGearBuckets — gem override equivalence", () => {
  it("override delta matching socketed gems == no override (subs path)", () => {
    const tali = talismanWithGems([15037, 15049, 15053]); // ATK% 2.4, CHC 3, DMG+ 4

    const noOverride = aggregateGearBuckets([tali], game);

    // Build the equivalent override delta by hand (or via aggregateGemDelta).
    const override: GemOverride = {
      flat: {},
      pct: { atkPct: 2.4, critRate: 3, dmgUp: 4 },
    };
    const withOverride = aggregateGearBuckets([tali], game, override);

    expect(withOverride.flat).toEqual(noOverride.flat);
    expect(withOverride.pct).toEqual(noOverride.pct);
    expect(withOverride.buffPct).toEqual(noOverride.buffPct);
  });

  it("override skips the talisman's own subs (no double-counting)", () => {
    const tali = talismanWithGems([15037]); // ATK% 2.4 socketed
    // Override with EMPTY delta → result should NOT include the socketed gem.
    const override: GemOverride = { flat: {}, pct: {} };
    const out = aggregateGearBuckets([tali], game, override);
    expect(out.pct.atkPct).toBeUndefined();
  });

  it("override doesn't affect non-gem slots' subs (weapons/armor/etc.)", () => {
    const weapon: GearPiece = {
      uid: "w", itemId: 1, slot: "weapon", setId: null, armorSetId: null,
      rarity: "unique", star: 6, name: "", classLimit: null,
      breakthrough: 0, reforgeCount: 0, enhanceLevel: 0, singularityLevel: 0,
      ascended: false, locked: false, equippedBy: null,
      main: [], subs: [{ stat: "atkPct", value: 5, percent: true }],
    };
    // Even with a gem override active, weapon's atkPct sub must contribute.
    const override: GemOverride = { flat: {}, pct: { critRate: 100 } };
    const out = aggregateGearBuckets([weapon], game, override);
    expect(out.pct.atkPct).toBe(5);
    expect(out.pct.critRate).toBe(100); // override layered on top
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * RATINGS — formula validation + Score normalization
 * ───────────────────────────────────────────────────────────────────────── */

describe("computeCheapRatings", () => {
  it("expects FinalStats.crc/chd in DISPLAY percent (35 = 35%), NOT decimal", () => {
    // ATK 1000, CHC 50 (= 50%), CHD 200 (= 200%) → dmg = 1000 × 0.5 × 2.0 = 1000
    const fs = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 50, chd: 200,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    const r = computeCheapRatings(fs);
    expect(r.dmg).toBe(1000);          // 1000 × 0.5 × 2.0
    expect(r.dmgs).toBe(100000);       // dmg × spd
    expect(r.mcd).toBe(2000);          // 1000 × 2.0 (assumes 100% CHC)
  });

  it("EHP uses linear DEF scaling: HP × (DEF/300 + 1)", () => {
    const fs = { atk: 0, def: 600, hp: 10000, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(fs).ehp).toBe(30000); // 10000 × (600/300 + 1) = 10000 × 3
  });
});

describe("computeScore", () => {
  it("normalizes against STAT_NORMS — high priority on small-magnitude stat beats low priority on big stat", () => {
    const fs = { atk: 4000, def: 0, hp: 0, spd: 0, crc: 100, chd: 0,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    // priority: atk=1, crc=3
    // atk contrib = 1 × 4000 / 4000 = 1.0 → ×100 = 100
    // crc contrib = 3 × 100 / 100 = 3.0 → ×100 = 300
    // total = 400
    expect(computeScore(fs, { atk: 1, crc: 3 })).toBe(400);
  });

  it("negative priority subtracts", () => {
    const fs = { atk: 4000, def: 0, hp: 0, spd: 0, crc: 0, chd: 0,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeScore(fs, { atk: -1 })).toBe(-100);
  });

  it("returns 0 when priority is empty", () => {
    const fs = { atk: 9999, def: 0, hp: 0, spd: 0, crc: 0, chd: 0,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeScore(fs, {})).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * REFORGE — predict the max-rolled state of a piece given remaining
 * reforges and the user's priority. Greedy heuristic, capped at LV6/sub.
 * ───────────────────────────────────────────────────────────────────────── */

/** Helper: build a generic gear piece (non-talisman) with the given
 *  star + reforgeCount + subs. Used to test the reforge simulator
 *  without the talisman/EE gem-slot apparatus. */
function piece(star: number, reforgeCount: number, subs: RolledStat[]): GearPiece {
  return {
    uid: "p", itemId: 1, slot: "weapon", setId: null, armorSetId: null,
    rarity: "unique", star, name: "", classLimit: null,
    breakthrough: 4, reforgeCount, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: [], subs,
  };
}

describe("simulateReforges", () => {
  it("returns the same piece when no reforges remain", () => {
    const p = piece(6, 6, [{ stat: "atkPct", value: 12, percent: true, ticks: 4 }]);
    expect(simulateReforges(p, { atk: 3 })).toBe(p);
  });

  it("returns the same piece when subs is empty", () => {
    const p = piece(6, 0, []);
    expect(simulateReforges(p, { atk: 3 })).toBe(p);
  });

  it("funnels all remaining reforges into the highest-priority sub", () => {
    // 6★, 0 reforged → 6 remaining. ATK% sub has perTick = 12/4 = 3.
    // CHC sub has perTick = 4/4 = 1. With atk priority 3, every reforge
    // goes to ATK (weighted 9 vs 0 for CHC) until the LV6 cap (4 → 6 = 2 ticks),
    // then to CHC for remaining (weighted 0 but raw perTick highest among
    // available — actually any sub with capacity wins on the tie).
    const p = piece(6, 0, [
      { stat: "atkPct", value: 12, percent: true, ticks: 4 },
      { stat: "critRate", value: 4, percent: true, ticks: 4 },
    ]);
    const sim = simulateReforges(p, { atk: 3 });
    const atk = sim.subs.find((s) => s.stat === "atkPct")!;
    expect(atk.ticks).toBe(6); // capped
    expect(atk.value).toBeCloseTo(18); // +2 ticks × 3 perTick
    const crc = sim.subs.find((s) => s.stat === "critRate")!;
    expect(crc.ticks).toBe(6); // remaining 4 reforges flow here
  });

  it("respects the LV6 per-sub cap (can't push beyond)", () => {
    // sub already at LV6 → no reforge applied to it even with priority.
    const p = piece(6, 0, [{ stat: "atkPct", value: 18, percent: true, ticks: 6 }]);
    const sim = simulateReforges(p, { atk: 3 });
    expect(sim.subs[0]!.ticks).toBe(6); // unchanged
    expect(sim.subs[0]!.value).toBe(18); // unchanged
  });

  it("with empty priority, picks the highest raw per-tick sub", () => {
    const p = piece(3, 0, [
      { stat: "atkPct", value: 6, percent: true, ticks: 2 },   // perTick = 3
      { stat: "critRate", value: 2, percent: true, ticks: 2 }, // perTick = 1
    ]);
    const sim = simulateReforges(p, {});
    const atk = sim.subs.find((s) => s.stat === "atkPct")!;
    // 3 reforges, ATK has 4 ticks of headroom → all 3 go to ATK.
    expect(atk.ticks).toBe(5);
    expect(atk.value).toBeCloseTo(15); // 6 + 3 × 3
  });

  it("does not mutate the original piece", () => {
    const subs: RolledStat[] = [{ stat: "atkPct", value: 12, percent: true, ticks: 4 }];
    const p = piece(6, 0, subs);
    simulateReforges(p, { atk: 3 });
    expect(p.subs[0]!.ticks).toBe(4); // untouched
    expect(p.subs[0]!.value).toBe(12);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * TOP-K HEAP — guards that the heap keeps the K highest-scoring builds
 * across a stream of pushes. Silent regressions would drop better builds
 * for worse ones — only visible by comparing solve outputs side-by-side,
 * so we test it directly.
 * ───────────────────────────────────────────────────────────────────────── */

/** Helper: build a placeholder SolveBuild with just the heap key set. */
function buildWithScore(score: number, cp = 0): SolveBuild {
  return {
    pieceUids: [],
    gemAllocation: { talisman: [], ee: [] },
    finalStats: { atk: 0, def: 0, hp: 0, spd: 0, crc: 0, chd: 0,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 },
    ratings: { hps: 0, ehp: 0, ehps: 0, dmg: 0, dmgs: 0, mcd: 0, mcds: 0, dmgh: 0 },
    score, cp, upg: 0,
  };
}

describe("TopKHeap", () => {
  it("keeps top-K by score in SOLVE mode", () => {
    const heap = new TopKHeap(3, "score");
    [5, 10, 3, 7, 1, 8, 2].forEach((s) => heap.push(buildWithScore(s)));
    const out = heap.toSorted();
    expect(out.map((b) => b.score)).toEqual([10, 8, 7]);
  });

  it("keeps top-K by cp in SOLVE CP mode", () => {
    const heap = new TopKHeap(2, "cp");
    [50, 100, 30, 70].forEach((cp) => heap.push(buildWithScore(999, cp)));
    expect(heap.toSorted().map((b) => b.cp)).toEqual([100, 70]);
  });

  it("never grows beyond K capacity", () => {
    const heap = new TopKHeap(5, "score");
    for (let i = 0; i < 100; i++) heap.push(buildWithScore(i));
    expect(heap.toSorted()).toHaveLength(5);
    expect(heap.toSorted().map((b) => b.score)).toEqual([99, 98, 97, 96, 95]);
  });

  it("returns fewer than K when fewer pushes happened", () => {
    const heap = new TopKHeap(10, "score");
    [5, 3, 8].forEach((s) => heap.push(buildWithScore(s)));
    expect(heap.toSorted().map((b) => b.score)).toEqual([8, 5, 3]);
  });

  it("CP mode treats null cp as -Infinity (never wins a slot)", () => {
    const heap = new TopKHeap(2, "cp");
    heap.push({ ...buildWithScore(0, 100), cp: null });
    heap.push(buildWithScore(0, 50));
    heap.push(buildWithScore(0, 30));
    // The null-cp build should be excluded; only the two with real cp.
    const out = heap.toSorted();
    expect(out.map((b) => b.cp)).toEqual([50, 30]);
  });
});

describe("STAT_TO_PRIORITY", () => {
  it("maps every engine percent variant to its user key", () => {
    expect(STAT_TO_PRIORITY.atkPct).toBe("atk");
    expect(STAT_TO_PRIORITY.hpPct).toBe("hp");
    expect(STAT_TO_PRIORITY.critRate).toBe("crc");
    expect(STAT_TO_PRIORITY.critDmg).toBe("chd");
    expect(STAT_TO_PRIORITY.effRes).toBe("res");
    expect(STAT_TO_PRIORITY.dmgReduce).toBe("dmgRed");
    expect(STAT_TO_PRIORITY.critDmgReduce).toBe("critDmgRed");
  });

  it("user keys round-trip to themselves", () => {
    for (const userKey of Object.keys(STAT_NORMS)) {
      // The corresponding engine key (if it differs) maps back to userKey.
      // We don't enforce a full bijection; just check it doesn't accidentally
      // remap user keys to something else.
      const mapped = STAT_TO_PRIORITY[userKey] ?? userKey;
      expect(STAT_NORMS[mapped]).toBeDefined();
    }
  });
});
