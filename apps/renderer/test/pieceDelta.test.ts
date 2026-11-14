/// <reference types="node" />
// "Why this piece?" — `pieceDelta` (the build's piece vs the worn one, stat by
// stat, weighted like the Score) on the real contract (`data/derived/`), and
// the static render of its popover (`PieceDeltaTooltip`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { resolveStat } from "@gear-solver/core";
import { precomputeContext } from "../src/lib/solver/engine.js";
import { computeScore } from "../src/lib/solver/ratings.js";
import { computeFinalStats, rollGainOnSheet, type FinalStats } from "../src/lib/composeBuild.js";
import { FINAL_STAT_KEYS, STAT_NORMS } from "../src/lib/statRegistry.js";
import { pieceDelta, type PieceDelta, type PieceDeltaContext } from "../src/lib/solver/pieceDelta.js";
import { PieceDeltaTooltip, pieceDeltaHeadline } from "../src/screens/builder/PieceDeltaTooltip.js";
import { SOLVER_STATS } from "../src/screens/builder/statColumns.js";
import type { SolveFilters, SolveRequest } from "../src/lib/solver/types.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));

const GAME = {
  options: derived("options.json"), equipment: derived("equipment.json"), sets: derived("sets.json"),
  equipmentPassives: derived("equipment-passives.json"), multiTierPassives: derived("multi-tier-passives.json"),
  gems: derived("gems.json"), singularityOptions: derived("singularity-options.json"),
  eePassives: derived("ee-passives.json"), characters: derived("characters.json"), enhance: derived("enhance.json"),
  buffs: derived("buffs.json"), expCharacter: derived("exp-character.json"), charLevelMax: derived("char-level-max.json"),
  codexCurve: derived("codex-curve.json"), archiveBonus: derived("archive-bonus.json"),
  trustCharacter: derived("trust-character.json"), trustBuffs: derived("trust-buffs.json"), subTicks: derived("sub-ticks.json"),
} as unknown as GameData;

// Lv6 gems: ATK% / HP%.
const ATK6 = 15046, HP6 = 15048;

const roll = (stat: string, value: number, percent: boolean): RolledStat =>
  ({ stat, value, percent, ticks: 1 } as unknown as RolledStat);

function piece(slot: string, uid: string, main: RolledStat[], subs: RolledStat[] = [], extra: Partial<GearPiece> = {}): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: null, main, subs, ...extra,
  } as unknown as GearPiece;
}

/** A gem-bearing piece whose socketed gems are its subs (the parser's path). */
function gemPiece(slot: "ooparts" | "exclusive", uid: string, main: RolledStat[], gems: number[]): GearPiece {
  const subs = gems.flatMap((id) => {
    const r = id ? resolveStat(id, 1, GAME.options) : null;
    return r ? [{ ...r, source: "option" } as RolledStat] : [];
  });
  return piece(slot, uid, main, subs, { gemSlots: gems });
}

/** The hero's gearless sheet, composed by the solve's own `precomputeContext`
 *  on a real character of the contract. */
const SHEET = (() => {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const filters: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: "score", heroUid: "H", game: GAME,
    inventory: { characters: [hero], gear: [], presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 10, chunkIndex: 0, chunkCount: 1, filters,
  };
  const { baseline, scaling } = precomputeContext(req);
  return { baseline, scaling };
})();
const CTX: PieceDeltaContext = { ...SHEET, game: GAME };

// The rest of the build — the same on both sides of the swap.
const OTHERS: GearPiece[] = [
  piece("helmet", "h", [roll("hp", 2000, false)], [roll("atkPct", 6, true), roll("critRate", 4, true)]),
  piece("armor", "a", [roll("def", 300, false)], [roll("critDmg", 8, true), roll("spd", 6, false)]),
  piece("gloves", "g", [roll("atk", 200, false)], [roll("atk", 40, false)]),
  piece("boots", "b", [roll("spd", 30, false)], [roll("hpPct", 5, true)]),
  piece("accessory", "x", [roll("atkPct", 20, true)], [roll("pen", 4, true)]),
];

const PRIORITY = { atk: 1, critRate: 2, critDmg: 1.5, spd: 0.5 };

// Weapon A (the build's) vs weapon B (worn).
const WEAPON_A = piece("weapon", "wA", [roll("atk", 320, false)], [roll("atkPct", 9, true), roll("critRate", 6, true), roll("hp", 300, false)]);
const WEAPON_B = piece("weapon", "wB", [roll("atk", 280, false)], [roll("critDmg", 12, true), roll("spd", 4, false), roll("eff", 20, false)]);

const fsOf = (pieces: GearPiece[]): FinalStats => computeFinalStats(SHEET.baseline, SHEET.scaling, pieces, GAME);
const read = (fs: FinalStats, key: string) => (fs as unknown as Record<string, number>)[key] ?? 0;
/** Compound axes (ATK/DEF/HP/EFF/RES) truncate per compose; the % axes round to 0.1. */
const COMPOUND = new Set(["atk", "def", "hp", "eff", "effRes"]);
const tolOf = (key: string) => (COMPOUND.has(key) ? 4 : 0.1);

describe("pieceDelta — the build's piece vs the worn one", () => {
  it("walks the solver's vocabulary: FINAL_STAT_KEYS is SOLVER_STATS, same order", () => {
    expect([...FINAL_STAT_KEYS]).toEqual(SOLVER_STATS.map((s) => s.key));
  });

  it("weapon vs worn weapon: per-stat deltas and total = the difference of the two builds' computeScore", () => {
    const d = pieceDelta(WEAPON_A, WEAPON_B, PRIORITY, CTX);
    expect(d.identical).toBe(false);
    expect(d.emptySlot).toBe(false);
    expect(d.setChanged).toBe(false);
    expect(d.rows.map((r) => r.key)).toEqual([...FINAL_STAT_KEYS]);

    const fsA = fsOf([WEAPON_A, ...OTHERS]);
    const fsB = fsOf([WEAPON_B, ...OTHERS]);
    // No total reaches a 100 % cap: the score sees the raw sums.
    expect(fsA.critRate).toBeLessThan(100);
    expect(fsB.critRate).toBeLessThan(100);

    let bound = 0;
    for (const r of d.rows) {
      // The piece alone on the sheet = the same delta as the two full builds,
      // up to the composer's truncations (the sheet is linear in the gear).
      expect(Math.abs(r.delta - (read(fsA, r.key) - read(fsB, r.key)))).toBeLessThanOrEqual(tolOf(r.key));
      // The normalization IS the Score's: Δ / STAT_NORMS × weight × 100.
      expect(r.weighted).toBeCloseTo((r.delta / STAT_NORMS[r.key]!) * r.weight * 100, 9);
      expect(r.weight).toBe((PRIORITY as Record<string, number>)[r.key] ?? 0);
      bound += (tolOf(r.key) / STAT_NORMS[r.key]!) * Math.abs(r.weight) * 100;
    }
    expect(d.total).toBeCloseTo(d.rows.reduce((s, r) => s + r.weighted, 0), 9);

    const scoreDiff = computeScore(fsA, PRIORITY) - computeScore(fsB, PRIORITY);
    expect(Math.abs(d.total - scoreDiff)).toBeLessThanOrEqual(bound);
    // …and the bound is small against the swing it explains.
    expect(bound).toBeLessThan(Math.abs(scoreDiff) / 10);

    // The values themselves: A's flat ATK main + its ATK% through the hero's base;
    // B's CHD, A's CHC, an unweighted HP / EFF on each side.
    const atk = d.rows.find((r) => r.key === "atk")!;
    expect(atk.candidate).toBeGreaterThan(320);
    expect(atk.worn).toBeGreaterThanOrEqual(280);
    expect(d.rows.find((r) => r.key === "critRate")).toMatchObject({ worn: 0, candidate: 6, delta: 6 });
    expect(d.rows.find((r) => r.key === "critDmg")).toMatchObject({ worn: 12, candidate: 0, delta: -12 });
    expect(d.rows.find((r) => r.key === "hp")!.weight).toBe(0);
    expect(d.rows.find((r) => r.key === "hp")!.weighted).toBe(0);
    expect(d.rows.find((r) => r.key === "eff")!.worn).toBeGreaterThan(0);
  });

  it("empty slot: the worn side is zero, the delta is the piece's own contribution", () => {
    const d = pieceDelta(WEAPON_A, null, PRIORITY, CTX);
    expect(d.emptySlot).toBe(true);
    expect(d.identical).toBe(false);
    for (const r of d.rows) {
      expect(r.worn).toBe(0);
      expect(r.delta).toBe(r.candidate);
    }
    const fsWith = fsOf([WEAPON_A, ...OTHERS]);
    const fsWithout = fsOf(OTHERS);
    expect(d.total).toBeGreaterThan(0);
    expect(Math.abs(d.total - (computeScore(fsWith, PRIORITY) - computeScore(fsWithout, PRIORITY)))).toBeLessThan(0.5);
    expect(pieceDeltaHeadline(d)).toMatch(/^\+\d+\.\d score vs the empty slot$/);
  });

  it("identical piece: every value zero, 'already equipped'", () => {
    const d = pieceDelta(WEAPON_A, { ...WEAPON_A }, PRIORITY, CTX);
    expect(d.identical).toBe(true);
    expect(d.total).toBe(0);
    expect(d.setChanged).toBe(false);
    for (const r of d.rows) expect([r.worn, r.candidate, r.delta, r.weighted]).toEqual([0, 0, 0, 0]);
    expect(pieceDeltaHeadline(d)).toMatch(/already equipped/i);
    expect(renderToStaticMarkup(createElement(PieceDeltaTooltip, { delta: d }))).toMatch(/already equipped/i);
  });

  it("talisman with gems: the candidate carries the build's allocation, the worn one its socketed gems", () => {
    const wornT = gemPiece("ooparts", "tW", [], [HP6, HP6, HP6, HP6, 0]);
    const candT = gemPiece("ooparts", "tC", [], [HP6, HP6, 0, 0, 0]);
    const alloc = [ATK6, ATK6, ATK6, ATK6, ATK6];
    const d = pieceDelta(candT, wornT, { atk: 1, hp: 1 }, { ...CTX, candidateGems: alloc });
    const gem = resolveStat(ATK6, 1, GAME.options)!;
    const hpGem = resolveStat(HP6, 1, GAME.options)!;
    const atk = d.rows.find((r) => r.key === "atk")!;
    const hp = d.rows.find((r) => r.key === "hp")!;
    // The five ATK% gems the solve allocated, through the hero's base — not
    // the candidate's own two HP% gems.
    expect(Math.abs(atk.candidate - rollGainOnSheet(SHEET.scaling, "atk", 5 * gem.value, true))).toBeLessThanOrEqual(1);
    expect(hp.candidate).toBe(0);
    // The worn talisman as socketed: its four HP% gems.
    expect(atk.worn).toBe(0);
    expect(Math.abs(hp.worn - rollGainOnSheet(SHEET.scaling, "hp", 4 * hpGem.value, true))).toBeLessThanOrEqual(1);
    expect(d.total).toBeCloseTo(atk.weighted + hp.weighted, 9);

    // No allocation (or an all-empty one): the engine's fallback, the piece's own gems.
    const own = pieceDelta(candT, wornT, { hp: 1 }, { ...CTX, candidateGems: [0, 0, 0, 0, 0] });
    expect(Math.abs(own.rows.find((r) => r.key === "hp")!.candidate - rollGainOnSheet(SHEET.scaling, "hp", 2 * hpGem.value, true))).toBeLessThanOrEqual(1);
  });

  it("an armor piece of another set flags the set change (bonuses are not counted)", () => {
    const helmA = piece("helmet", "hA", [roll("hp", 2000, false)], [], { armorSetId: "1" });
    const helmB = piece("helmet", "hB", [roll("hp", 2000, false)], [], { armorSetId: "2" });
    expect(pieceDelta(helmA, helmB, PRIORITY, CTX).setChanged).toBe(true);
    expect(pieceDelta(helmA, { ...helmB, armorSetId: "1" }, PRIORITY, CTX).setChanged).toBe(false);
    expect(pieceDelta(helmA, null, PRIORITY, CTX).setChanged).toBe(true);
  });
});

/** A hand-made delta for the render: rows in vocabulary order. */
function deltaOf(over: Record<string, Partial<{ worn: number; candidate: number; weight: number }>>, extra: Partial<PieceDelta> = {}): PieceDelta {
  let total = 0;
  const rows = FINAL_STAT_KEYS.map((key) => {
    const o = over[key] ?? {};
    const worn = o.worn ?? 0, candidate = o.candidate ?? 0, weight = o.weight ?? 0;
    const delta = candidate - worn;
    const weighted = (delta / STAT_NORMS[key]!) * weight * 100;
    total += weighted;
    return { key, worn, candidate, delta, weight, weighted };
  });
  return { rows, total, identical: false, emptySlot: false, setChanged: false, ...extra };
}

const render = (d: PieceDelta) => renderToStaticMarkup(createElement(PieceDeltaTooltip, { delta: d }));

describe("PieceDeltaTooltip", () => {
  it("weighted rows in the vocabulary's order, the zero-weight ones folded, the total in bold", () => {
    const d = deltaOf({
      critDmg: { worn: 10, candidate: 30, weight: 1 },
      atk: { worn: 300, candidate: 500, weight: 1 },
      critRate: { worn: 8, candidate: 4, weight: 2 },
      hp: { worn: 0, candidate: 900 },
      eff: { worn: 20, candidate: 0 },
      def: { weight: 3 }, // weighted but untouched: no row
    });
    const html = render(d);
    expect(html).toContain("Worn → this");
    const at = (k: string) => html.indexOf(`data-stat="${k}"`);
    expect(at("atk")).toBeGreaterThan(-1);
    expect(at("atk")).toBeLessThan(at("critRate"));
    expect(at("critRate")).toBeLessThan(at("critDmg"));
    expect(at("def")).toBe(-1);
    expect(at("hp")).toBe(-1);
    expect(at("eff")).toBe(-1);
    expect(html).toContain("+2 stats not weighted");
    expect(html).toContain("300 → 500");
    expect(html).toContain("8.0% → 4.0%");
    expect(html).toContain("−4.0%");
    expect(html).toMatch(/font-semibold[^>]*><td[^>]*>Total<\/td><td[^>]*>\+/);
    // Total = 200/4000·100 + (−4)/100·2·100 + 20/250·100 = 5 − 8 + 8 = +5.0
    expect(html).toContain("+5.0 score vs the worn piece");
    expect(html).not.toContain("Set bonus");
  });

  it("a negative total says the piece is kept for something else; a set change gets its line", () => {
    const d = deltaOf({ atk: { worn: 500, candidate: 376, weight: 1 } }, { setChanged: true });
    expect(d.total).toBeCloseTo(-3.1, 9);
    const html = render(d);
    expect(html).toContain("−3.1 score — kept for its set / effect");
    expect(html).toContain("Set bonus: see the Effects panel");
    expect(html).not.toContain("not weighted");
  });

  it("no weighted stat in the priority: says so, no table", () => {
    const html = render(deltaOf({ atk: { worn: 300, candidate: 500 } }));
    expect(html).toContain("No stat is weighted");
    expect(html).not.toContain("<table");
    expect(html).toContain("+1 stat not weighted");
  });
});
