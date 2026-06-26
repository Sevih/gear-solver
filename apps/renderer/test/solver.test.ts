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
import {
  aggregateGearBuckets, aggregatePrefixBuckets, computeFinalStats, computeFinalStatsFromPrefix,
  computeSetBonuses, type FinalStatsBaseline, type GemOverride, type ScalingMap,
} from "../src/lib/composeBuild.js";
import type { StatScaling } from "@gear-solver/core";
import { simulateReforges, TopKHeap } from "../src/lib/solver/engine.js";
import type { SolveBuild } from "../src/lib/solver/types.js";
import { calcBattlePower, makeCpEvaluator } from "../src/lib/solver/cp.js";
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

/** Default unfiltered gem-pool opts — equivalent to the pre-B3 behavior
 *  (all gear in the inventory contributes regardless of equippedBy). Used
 *  by tests that aren't exercising the eligibility filter itself. */
const ALL_GEMS: Parameters<typeof buildGemPool>[1] = {
  heroUid: "hero-a",
  includeEquippedOnOthers: true,
  excludedHeroes: new Set(),
};

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
    const pool = buildGemPool(inv, ALL_GEMS);
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
    expect(buildGemPool(inv, ALL_GEMS).size).toBe(0);
  });

  it("respects includeEquippedOnOthers — other-hero gems excluded by default", () => {
    // Without the filter, the solver could propose gems that physically
    // require unequipping another hero's Talisman/EE.
    const mine = { ...talismanWithGems([15001, 15004]), uid: "t-mine", equippedBy: "hero-a" };
    const someone = { ...talismanWithGems([15049, 15053]), uid: "t-other", equippedBy: "hero-b" };
    const unequipped = { ...talismanWithGems([15037]), uid: "t-free", equippedBy: null };
    const inv = { gear: [mine, someone, unequipped], characters: [], presets: [] } as Inventory;
    const opts = { heroUid: "hero-a", includeEquippedOnOthers: false, excludedHeroes: new Set<string>() };
    const pool = buildGemPool(inv, opts);
    expect(pool.get(15001)).toBe(1); // hero-a's own gems
    expect(pool.get(15004)).toBe(1);
    expect(pool.get(15037)).toBe(1); // unequipped gem
    expect(pool.get(15049)).toBeUndefined(); // hero-b excluded
    expect(pool.get(15053)).toBeUndefined();
  });

  it("excludes gems on explicitly-excluded heroes even when includeEquippedOnOthers is on", () => {
    const a = { ...talismanWithGems([15001]), uid: "t-a", equippedBy: "hero-a" };
    const b = { ...talismanWithGems([15004]), uid: "t-b", equippedBy: "hero-b" };
    const c = { ...talismanWithGems([15037]), uid: "t-c", equippedBy: "hero-c" };
    const inv = { gear: [a, b, c], characters: [], presets: [] } as Inventory;
    const opts = {
      heroUid: "hero-a",
      includeEquippedOnOthers: true,
      excludedHeroes: new Set(["hero-c"]),
    };
    const pool = buildGemPool(inv, opts);
    expect(pool.get(15001)).toBe(1);
    expect(pool.get(15004)).toBe(1); // hero-b included (not excluded)
    expect(pool.get(15037)).toBeUndefined(); // hero-c excluded
  });

  it("selected hero is exempt from excludedHeroes — own gems always kept", () => {
    // The ExcludeHeroesPicker lists every character (including the selected
    // hero), so the user can tick himself. The gear pool's `allow()` exempts
    // him; the gem pool must mirror that or the solver becomes inconsistent.
    const mine = { ...talismanWithGems([15001, 15004]), uid: "t-mine", equippedBy: "hero-a" };
    const inv = { gear: [mine], characters: [], presets: [] } as Inventory;
    const opts = {
      heroUid: "hero-a",
      includeEquippedOnOthers: true,
      excludedHeroes: new Set(["hero-a"]), // user ticked himself by mistake
    };
    const pool = buildGemPool(inv, opts);
    expect(pool.get(15001)).toBe(1);
    expect(pool.get(15004)).toBe(1);
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
 * SET BONUSES — hoisting guard. The solver computes the set-bonus list ONCE
 * outside its talisman loop and passes it to aggregateGearBuckets. These
 * tests pin that the precomputed-list path is byte-for-byte equivalent to the
 * internal recompute, and that computeSetBonuses tolerates the sparse pieces
 * array the hoist hands it (talisman slot not yet filled).
 * ───────────────────────────────────────────────────────────────────────── */
describe("aggregateGearBuckets — precomputed set bonuses (hoist equivalence)", () => {
  const gameWithSet = {
    ...game,
    sets: {
      S1: {
        name: "Sharp",
        levels: [
          { level: 1, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 150 }, p4: { st: "ST_NONE", ap: "", v: null } },
          { level: 2, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 200 }, p4: { st: "ST_NONE", ap: "", v: null } },
        ],
      },
    },
  } as unknown as GameData;

  const armor = (slot: string, setId: string | null): GearPiece => ({
    uid: `p-${slot}-${setId}`, itemId: 1, slot: slot as GearPiece["slot"], setId: null, armorSetId: setId,
    rarity: "unique", star: 6, name: "", classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: [{ stat: "atk", value: 50, percent: false }],
    subs: [{ stat: "atkPct", value: 3, percent: true }, { stat: "critRate", value: 4, percent: true }],
  });

  it("precomputed set-bonus list == internal recompute (2pc active)", () => {
    const pieces = [armor("helmet", "S1"), armor("armor", "S1"), talismanWithGems([15037])];
    const internal = aggregateGearBuckets(pieces, gameWithSet);
    const pre = computeSetBonuses(pieces, gameWithSet.sets);
    const hoisted = aggregateGearBuckets(pieces, gameWithSet, undefined, pre);
    expect(hoisted.flat).toEqual(internal.flat);
    expect(hoisted.pct).toEqual(internal.pct);
    expect(hoisted.buffPct).toEqual(internal.buffPct);
    // sanity: the 2pc Sharp bonus actually landed — atkPct = 3 + 3 (piece subs)
    // + 150/10 (set 2pc OAT_RATE) + 2.4 (talisman ATK% gem 15037) = 23.4
    expect(internal.pct.atkPct).toBeCloseTo(23.4, 5);
  });

  it("equivalence holds with a gem override layered on too", () => {
    const pieces = [armor("helmet", "S1"), armor("armor", "S1"), talismanWithGems([15037])];
    const override: GemOverride = { flat: {}, pct: { atkPct: 2.4 } };
    const pre = computeSetBonuses(pieces, gameWithSet.sets);
    const internal = aggregateGearBuckets(pieces, gameWithSet, override);
    const hoisted = aggregateGearBuckets(pieces, gameWithSet, override, pre);
    expect(hoisted.flat).toEqual(internal.flat);
    expect(hoisted.pct).toEqual(internal.pct);
    expect(hoisted.buffPct).toEqual(internal.buffPct);
  });

  it("computeSetBonuses tolerates a sparse pieces array (hole at the talisman slot)", () => {
    const sparse: GearPiece[] = new Array(3);
    sparse[0] = armor("helmet", "S1");
    sparse[1] = armor("armor", "S1");
    // index 2 (talisman) is intentionally a hole — the solver hoists the call
    // before that slot is filled on the first iteration.
    expect(() => computeSetBonuses(sparse, gameWithSet.sets)).not.toThrow();
    // Same output as the dense [helmet, armor] array (the hole adds nothing).
    expect(computeSetBonuses(sparse, gameWithSet.sets))
      .toEqual(computeSetBonuses([armor("helmet", "S1"), armor("armor", "S1")], gameWithSet.sets));
  });
});

describe("computeFinalStatsFromPrefix — incremental bucket accumulator equivalence", () => {
  // The solver aggregates the 6 invariant pieces (weapon..accessory) ONCE per
  // accessory iteration, then clones + tops up with the talisman + EE per combo.
  // It MUST be bit-identical to folding the full [w,h,a,g,b,acc,tali,ee] array
  // in slot order — the in-game `Math.trunc` in composeMultStat is unforgiving
  // of ULP drift, and no stat-lock would catch a 1-off here.
  const gameWithSet = {
    ...game,
    sets: {
      S1: { name: "Sharp", levels: [
        { level: 1, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 153 }, p4: { st: "ST_NONE", ap: "", v: null } },
        { level: 2, p2: { st: "ST_ATK", ap: "OAT_RATE", v: 200 }, p4: { st: "ST_NONE", ap: "", v: null } },
      ] },
    },
  } as unknown as GameData;

  const sc = (baseValue: number): StatScaling => ({
    baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
  });
  // Awkward bases so the trunc lands near a boundary — maximizes the chance a
  // reordered ULP would flip a stat by 1 if the order weren't preserved.
  const baseline: FinalStatsBaseline = { spd: 103, chc: 5.3, chd: 51.7, pen: 0, dmgInc: 0, dmgRed: 0 };
  const scaling: ScalingMap = { atk: sc(1337), def: sc(733), hp: sc(7919), eff: sc(101), res: sc(97) };

  // Each slot dumps fractional %ATK (and other) rolls onto the SAME buckets, so
  // the running sum has many additions whose order must match exactly.
  const pc = (slot: string, setId: string | null, main: RolledStat[], subs: RolledStat[]): GearPiece => ({
    uid: `p-${slot}`, itemId: 1, slot: slot as GearPiece["slot"], setId: null, armorSetId: setId,
    rarity: "unique", star: 6, name: "", classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null, main, subs,
  });
  const atkp = (v: number): RolledStat => ({ stat: "atkPct", value: v, percent: true });
  const flatAtk = (v: number): RolledStat => ({ stat: "atk", value: v, percent: false });

  const weapon = pc("weapon", null, [atkp(61.8)], [atkp(3.3), flatAtk(47)]);
  const helmet = pc("helmet", "S1", [flatAtk(50)], [atkp(2.7), { stat: "hp", value: 533, percent: false }]);
  const armorP = pc("armor", "S1", [], [atkp(7.1), { stat: "def", value: 111, percent: false }]);
  const gloves = pc("gloves", "S1", [], [atkp(4.9), { stat: "critRate", value: 5.7, percent: true }]);
  const boots = pc("boots", "S1", [], [atkp(6.3), { stat: "spd", value: 13, percent: false }]);
  const accessory = pc("accessory", null, [{ stat: "critDmg", value: 37.4, percent: true }], [atkp(1.9)]);
  const talisman = pc("ooparts", null, [], [atkp(2.4), { stat: "atk", value: 200, percent: false }]);
  const ee = pc("exclusive", null, [{ stat: "atkPct", value: 8.8, percent: true, fromBuff: true } as RolledStat], [atkp(1.1)]);

  const prefix = [weapon, helmet, armorP, gloves, boots, accessory];

  for (const withEe of [false, true]) {
    for (const override of [undefined, { flat: { atk: 12 }, pct: { atkPct: 2.4, critRate: 3 } } as GemOverride]) {
      it(`matches the full-array compose (ee=${withEe}, override=${!!override})`, () => {
        const full = withEe ? [...prefix, talisman, ee] : [...prefix, talisman];
        const setBonuses = computeSetBonuses(full, gameWithSet.sets);
        const fromFull = computeFinalStats(baseline, scaling, full, gameWithSet, override, setBonuses);
        const fromPrefix = computeFinalStatsFromPrefix(
          baseline, scaling, aggregatePrefixBuckets(prefix), talisman, withEe ? ee : null, override, setBonuses,
        );
        // Strict deep equality — every truncated stat must match to the integer.
        expect(fromPrefix).toEqual(fromFull);
      });
    }
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * RATINGS — formula validation + Score normalization
 * ───────────────────────────────────────────────────────────────────────── */

describe("computeCheapRatings", () => {
  it("expected damage = ATK × (1 + pCrit × (CHD/100 − 1)) — weighted crit, not assume-100%", () => {
    // Pre-fix bug: dmg = ATK × pCrit × CHD/100, which implicitly priced
    // non-crits at 0. Now: ATK 1000, CHC 50%, CHD 200% →
    //   pCrit = 0.5, chdMult = 2.0, drFactor = 1 + 0.5 × (2 − 1) = 1.5
    //   penMult = 1 (PEN=0), dmg = 1000 × 1.5 × 1 = 1500
    const fs = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 50, chd: 200,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    const r = computeCheapRatings(fs);
    expect(r.dmg).toBe(1500);
    expect(r.dmgs).toBe(150000); // dmg × spd
    // Max crit damage assumes 100% CHC: ATK × CHD/100 = 1000 × 2.0 = 2000.
    expect(r.mcd).toBe(2000);
  });

  it("offensive ratings scale off the hero's damage stat (atk default, def/hp override)", () => {
    // Distinct atk/def/hp so the chosen base stat is unambiguous. CHC 0, CHD
    // 100, no dmgUp/pen → drFactor = mcdFactor = 1, penMult = 1, so each rating
    // equals the chosen base stat directly.
    const fs = { atk: 1000, def: 500, hp: 8000, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(fs).dmg).toBe(1000);          // default atk
    expect(computeCheapRatings(fs, "atk").dmg).toBe(1000);
    expect(computeCheapRatings(fs, "def").dmg).toBe(500);    // Caren-style
    expect(computeCheapRatings(fs, "hp").dmg).toBe(8000);    // HP-scaler
    // dmgh stays the fixed HP-scaling reference regardless of dmgStat.
    expect(computeCheapRatings(fs, "def").dmgh).toBe(8000);
    // mcds derives from the same base stat (× spd, mcdFactor = chd/100 = 1).
    expect(computeCheapRatings(fs, "def").mcds).toBe(50000); // 500 × 100
  });

  it("secondary scalings add stat × ratio to the damage base (D.Stella ATK+HP)", () => {
    // drFactor = 1 (CHC 0, CHD 100, no dmgUp), penMult = 1 → dmg = base.
    const fs = { atk: 1000, def: 500, hp: 8000, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    // ATK main + HP×0.03 secondary → 1000 + 8000×0.03 = 1240.
    expect(computeCheapRatings(fs, "atk", [{ stat: "hp", ratio: 0.03 }]).dmg).toBe(1240);
    // DEF main + HP×0.02 → 500 + 160 = 660.
    expect(computeCheapRatings(fs, "def", [{ stat: "hp", ratio: 0.02 }]).dmg).toBe(660);
    // Multiple secondaries sum: ATK + DEF×0.5 + HP×0.01 = 1000 + 250 + 80 = 1330.
    expect(computeCheapRatings(fs, "atk", [{ stat: "def", ratio: 0.5 }, { stat: "hp", ratio: 0.01 }]).dmg).toBe(1330);
  });

  it("CHC=0 still produces damage (every hit is a non-crit at ×1.0)", () => {
    // Pre-fix bug: ATK × 0 × anything = 0 → builds with no CHC ranked at
    // dmg=0 in the table, masking real damage potential.
    const fs = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 300,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(fs).dmg).toBe(1000); // drFactor = 1.0
  });

  it("dmgUp folds into the DR rate (per §3.2 attacker's DMGBoost)", () => {
    // ATK 1000, CHC 0, CHD 100 (irrelevant — no crit), dmgUp 20 → drFactor =
    // 1 + 0 + 0.20 = 1.20 → dmg = 1200.
    const base = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings({ ...base, dmgUp: 20 }).dmg).toBeCloseTo(1200);
  });

  it("dmgRed is a DEFENDER stat — doesn't reduce a build's own offensive output", () => {
    // Subtle bug in the v1 ratings rewrite: dmgRed got subtracted from the
    // attacker's drFactor, as if a build's own DEF-stat would shrink its
    // damage. dmgRed only matters when the build TAKES damage (→ ehp).
    const base = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings({ ...base, dmgRed: 0 }).dmg).toBe(
      computeCheapRatings({ ...base, dmgRed: 50 }).dmg,
    );
  });

  it("DR_FLOOR clamps at 30% — DR rate / dmgRed never zeros the rating", () => {
    // §3.2: `rate = Max(rate, 300)`. Pushed via a deeply negative dmgUp
    // (synthetic case — in normal builds dmgUp is ≥ 0).
    const fs = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: -200, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(fs).dmg).toBeCloseTo(300); // 1000 × 0.3
  });

  it("PEN multiplier vs TARGET_DEF=2000 — PEN 50% → ×1.5, PEN 100% → ×3.0", () => {
    // Without PEN, mit = 1000/(2000+1000) = 0.333. PEN 100% drops effDef to
    // 0 → mit = 1.0, ratio = 3.0. PEN 50% → effDef = 1000, mit = 0.5,
    // ratio = 1.5. Critical: pre-fix the rating ignored PEN entirely.
    const base = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    const noPen = computeCheapRatings(base).dmg;
    expect(computeCheapRatings({ ...base, pen: 50 }).dmg).toBeCloseTo(noPen * 1.5);
    expect(computeCheapRatings({ ...base, pen: 100 }).dmg).toBeCloseTo(noPen * 3.0);
  });

  it("PEN > 100% wasted (PPR caps at 100% per §1.2)", () => {
    const base = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings({ ...base, pen: 100 }).dmg).toBe(
      computeCheapRatings({ ...base, pen: 130 }).dmg,
    );
  });

  it("dmgh applies the same crit + PEN math as dmg, but scaled on HP", () => {
    // HP-scaling skills (Aer S3, Caren heal-as-damage) still hit DEF and
    // benefit from PEN; only the source stat changes.
    const fs = { atk: 0, def: 0, hp: 10000, spd: 100, crc: 50, chd: 200,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 50, critDmgRed: 0 };
    // drFactor = 1 + 0.5 × (2 − 1) = 1.5, penMult = 1.5, dmgh = 10000 × 1.5 × 1.5 = 22500
    expect(computeCheapRatings(fs).dmgh).toBeCloseTo(22500);
  });

  it("EHP matches the in-game mitigation: HP × (1 + DEF/1000)", () => {
    // Pre-fix bug: `DEF/300 + 1` over-credited DEF by ~3.3×. At DEF=600
    // the OLD rating produced 30000 (factor 3.0); the IN-GAME factor is
    // 1.6 → 16000.
    const fs = { atk: 0, def: 600, hp: 10000, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(fs).ehp).toBe(16000);
  });

  it("EHP includes dmgRed as a defender-side multiplier: HP × DEF_factor / max(0.3, 1 − dmgRed/100)", () => {
    // dmgRed reduces incoming DR rate per §3.2 (`rate -= DMGReduceRate;
    // rate = Max(rate, 300)`). 50% dmgRed → take 50% damage → EHP × 2.0.
    // 100%+ dmgRed clamps at the floor → take 30% damage → EHP × 3.33.
    const base = { atk: 0, def: 0, hp: 10000, spd: 100, crc: 0, chd: 100,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    expect(computeCheapRatings(base).ehp).toBe(10000); // 1× factor at dmgRed=0
    expect(computeCheapRatings({ ...base, dmgRed: 50 }).ehp).toBeCloseTo(20000);
    expect(computeCheapRatings({ ...base, dmgRed: 100 }).ehp).toBeCloseTo(10000 / 0.3); // floored
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

  it("REJECTS talisman pieces — their `subs` are gems, not reforgeable rolls", () => {
    // Pre-fix bug: simulateReforges would bump gem values (a mechanic that
    // doesn't exist in-game), then SOLVE + priority-vide path read those
    // inflated gems as the talisman's actual stat contribution → wrong CP.
    const tali: GearPiece = {
      ...piece(6, 0, [{ stat: "atkPct", value: 2.4, percent: true, ticks: 1 }]),
      slot: "ooparts",
    };
    const out = simulateReforges(tali, { atk: 3 });
    expect(out).toBe(tali); // same reference — no work done
    expect(out.subs[0]!.value).toBe(2.4); // unchanged
  });

  it("REJECTS EE (exclusive) pieces for the same reason", () => {
    const ee: GearPiece = {
      ...piece(6, 0, [{ stat: "critRate", value: 3, percent: true, ticks: 1 }]),
      slot: "exclusive",
    };
    const out = simulateReforges(ee, { crc: 3 });
    expect(out).toBe(ee);
    expect(out.subs[0]!.value).toBe(3);
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

/* ─────────────────────────────────────────────────────────────────────────
 * CP — defensive clamps in the in-game CalcBattlePower mirror.
 * ───────────────────────────────────────────────────────────────────────── */

describe("calcBattlePower", () => {
  const baseStats = {
    atk: 1000, def: 500, hp: 10000, spd: 100,
    crc: 50, chd: 150, eff: 100, res: 100,
    dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0,
  };
  const args = (skills: { first: number; second: number; ultimate: number; chainPassive: number }) => ({
    stats: baseStats,
    showUIStar: 0, starPlus: 0,
    skills,
    ee: null, ooparts: null,
    fused: false,
  });

  it("all skills at Lv1 contribute no CP; first=0 is clamped, never negative", () => {
    // Every skill starts at Lv1 in-game and counts as (level − 1) × 100, so a
    // fresh all-Lv1 character adds 0 skill CP (verified on Flamberge: all-Lv1
    // → in-game 6085 with skillSum 0). A parse glitch giving first=0 must clamp
    // to 0, not subtract 100.
    const cpAllLv1 = calcBattlePower(args({ first: 1, second: 1, ultimate: 1, chainPassive: 1 }));
    const cpZero = calcBattlePower(args({ first: 0, second: 0, ultimate: 0, chainPassive: 0 }));
    expect(cpAllLv1).toBe(cpZero);
  });

  it("each skill level above 1 adds 100 CP (symmetric across all four)", () => {
    // Flamberge: S1 Lv1/2/3 → CP 6085/6185/6285 (+100 per level from Lv1).
    const base = calcBattlePower(args({ first: 1, second: 1, ultimate: 1, chainPassive: 1 }));
    const s1Lv3 = calcBattlePower(args({ first: 3, second: 1, ultimate: 1, chainPassive: 1 }));
    expect(s1Lv3).toBe(base + 200); // (3−1) × 100
    const allLv5 = calcBattlePower(args({ first: 5, second: 5, ultimate: 5, chainPassive: 5 }));
    expect(allLv5).toBe(base + 1600); // 4 × (5−1) × 100
  });

  it("critDmgRed (ECDR) contributes to the defR multiplier", () => {
    // Pre-fix bug: ecdrRaw was hardcoded to 0, so CDR was free CP for the
    // user but invisible to the solver — builds stacking CDR were silently
    // undervalued vs equivalent crit/atk builds.
    const skills = { first: 4, second: 0, ultimate: 0, chainPassive: 0 };
    const noCdr = calcBattlePower({ ...args(skills), stats: { ...baseStats, critDmgRed: 0 } });
    const withCdr = calcBattlePower({ ...args(skills), stats: { ...baseStats, critDmgRed: 40 } });
    expect(withCdr).toBeGreaterThan(noCdr);
  });

  it("makeCpEvaluator is bit-identical to calcBattlePower (hot-loop CP path)", () => {
    // The solver's SOLVE-CP hot loop uses a prepared evaluator that captures
    // the constant star/skill/EE/fusion bonuses once. It MUST return exactly
    // the same integer as the all-inline calcBattlePower for every combo, or
    // SOLVE CP would rank/round differently than the validated formula.
    const ee = { enhanceLevel: 12 } as Parameters<typeof calcBattlePower>[0]["ee"];
    const oo = { enhanceLevel: 9, star: 6 } as Parameters<typeof calcBattlePower>[0]["ooparts"];
    const consts = { showUIStar: 5, starPlus: 2, skills: { first: 5, second: 3, ultimate: 4, chainPassive: 2 }, ee, fused: true };
    const evalCp = makeCpEvaluator(consts);
    // Sweep a range of stat profiles — crit cap, high CHD, PEN, CDR, off-stat.
    const profiles = [
      baseStats,
      { ...baseStats, crc: 100, chd: 300, pen: 60 },
      { ...baseStats, crc: 130, chd: 80, dmgUp: 40, dmgRed: 30, critDmgRed: 25 },
      { ...baseStats, atk: 4321, def: 1234, hp: 56789, spd: 257, eff: 312, res: 287 },
      { ...baseStats, atk: 0, def: 0, hp: 0, spd: 0, crc: 0, chd: 0, eff: 0, res: 0 },
    ];
    for (const stats of profiles) {
      expect(evalCp(stats, oo)).toBe(calcBattlePower({ ...consts, stats, ooparts: oo }));
      expect(evalCp(stats, null)).toBe(calcBattlePower({ ...consts, stats, ooparts: null }));
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * CRC overflow — CRC > 100 is wasted in-game; ratings and the score must
 * cap to 100% to avoid rewarding non-existent crit rate.
 * ───────────────────────────────────────────────────────────────────────── */

describe("crc clamp at 100%", () => {
  it("computeCheapRatings clamps CRC at 100% in dmg / dmgs (in-game cap)", () => {
    // Pre-fix bug: 115% CRC was credited as 1.15× damage even though the
    // 15% overflow is wasted in-game.
    const at100 = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 100, chd: 200,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    const at115 = { ...at100, crc: 115 };
    expect(computeCheapRatings(at100).dmg).toBe(computeCheapRatings(at115).dmg);
    expect(computeCheapRatings(at100).dmgs).toBe(computeCheapRatings(at115).dmgs);
  });

  it("computeScore clamps CRC at 100% — overflow doesn't inflate the score", () => {
    const fs100 = { atk: 0, def: 0, hp: 0, spd: 0, crc: 100, chd: 0,
      eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };
    const fs150 = { ...fs100, crc: 150 };
    expect(computeScore(fs100, { crc: 3 })).toBe(computeScore(fs150, { crc: 3 }));
  });
});

describe("computeCheapRatings — noCrit heroes", () => {
  // A no-crit hero can never land a crit, so CHC/CHD must not move its
  // offensive ratings (Rhona / K.Tamamo / G.Nella).
  const fs = { atk: 1000, def: 0, hp: 0, spd: 100, crc: 80, chd: 250,
    eff: 0, res: 0, dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0 };

  it("dmg ignores crit → equals the bare non-crit hit (ATK × penMult)", () => {
    // pCrit forced to 0 → drFactor = 1.0 → dmg = ATK = 1000, regardless of CHC/CHD.
    expect(computeCheapRatings(fs, "atk", undefined, true).dmg).toBe(1000);
    // Crit-capable hero with the SAME stats scores higher (crit upside cashed in).
    expect(computeCheapRatings(fs, "atk", undefined, false).dmg).toBeGreaterThan(1000);
  });

  it("mcd collapses to the non-crit hit (no 100%-crit ceiling to reach)", () => {
    const r = computeCheapRatings(fs, "atk", undefined, true);
    expect(r.mcd).toBe(r.dmg);   // mcdFactor === drFactor when noCrit
    expect(r.mcd).toBe(1000);
  });

  it("CHC/CHD are inert for a noCrit hero — varying them doesn't change dmg", () => {
    const lowCrit = { ...fs, crc: 0, chd: 100 };
    const highCrit = { ...fs, crc: 100, chd: 300 };
    expect(computeCheapRatings(lowCrit, "atk", undefined, true).dmg)
      .toBe(computeCheapRatings(highCrit, "atk", undefined, true).dmg);
  });

  it("dmgUp still applies (it's not a crit term)", () => {
    // drFactor = 1 + dmgUp/100 = 1.2 → dmg = 1200 even with no crit.
    expect(computeCheapRatings({ ...fs, dmgUp: 20 }, "atk", undefined, true).dmg).toBeCloseTo(1200);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * REFORGE BUDGET — 6★ ascended (Singularity) pieces get +3 reforges
 * on top of the regular star count.
 * ───────────────────────────────────────────────────────────────────────── */

describe("simulateReforges — 6★ ascended budget", () => {
  it("6★ ascended grants +3 reforges on top of the 6 default → 9 total", () => {
    // Pre-fix bug: max budget was always `star` (6), under-using 3 ticks
    // of headroom on the standard endgame piece.
    const p: GearPiece = {
      ...piece(6, 0, [
        { stat: "atkPct", value: 4, percent: true, ticks: 1 },   // perTick = 4, room → cap at 6
        { stat: "critRate", value: 1, percent: true, ticks: 1 }, // perTick = 1
      ]),
      ascended: true,
    };
    const sim = simulateReforges(p, { atk: 3 });
    const atk = sim.subs.find((s) => s.stat === "atkPct")!;
    const crc = sim.subs.find((s) => s.stat === "critRate")!;
    // 9 reforges: ATK absorbs 5 (1→6 cap), CHC absorbs 4 (1→5)
    expect(atk.ticks).toBe(6);
    expect(crc.ticks).toBe(5);
  });

  it("6★ non-ascended sticks to the 6-reforge budget", () => {
    const p = piece(6, 0, [
      { stat: "atkPct", value: 4, percent: true, ticks: 1 },
      { stat: "critRate", value: 1, percent: true, ticks: 1 },
    ]); // ascended: false by default in `piece()`
    const sim = simulateReforges(p, { atk: 3 });
    const atk = sim.subs.find((s) => s.stat === "atkPct")!;
    const crc = sim.subs.find((s) => s.stat === "critRate")!;
    // 6 reforges only: ATK absorbs 5 → cap at 6; CHC absorbs 1 → 2
    expect(atk.ticks).toBe(6);
    expect(crc.ticks).toBe(2);
  });

  it("budget override forces a fixed endgame budget regardless of real star", () => {
    // A 3★ piece (real budget 3) previewed in ascended mode gets the fixed
    // 9-tick budget — "project every piece as a maxed 6★ ascended".
    const p = piece(3, 0, [
      { stat: "atkPct", value: 4, percent: true, ticks: 1 },   // → cap at 6 (5 ticks)
      { stat: "critRate", value: 1, percent: true, ticks: 1 }, // → absorbs the other 4
    ]);
    const sim = simulateReforges(p, { atk: 3 }, 9);
    const atk = sim.subs.find((s) => s.stat === "atkPct")!;
    const crc = sim.subs.find((s) => s.stat === "critRate")!;
    expect(atk.ticks).toBe(6);
    expect(crc.ticks).toBe(5); // 9 total − 4 into atk
  });
});
