/// <reference types="node" />
// Gem filling on the real contract (`data/derived/`): once the priority is
// served, the free Talisman/EE slots take the zero-score gems by the `dmg` gain
// they bring the hero (`gemDmgGains`, weighed on the equipped build), then by
// raw magnitude — never a negatively-prioritized stat, never a stat under a
// `max` bound. Same walk in the four allocators. SOLVE CP without a priority
// picks by marginal CP instead (`allocateGemsByCp`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { computeFinalStats } from "../src/lib/composeBuild.js";
import { makeCpEvaluator } from "../src/lib/solver/cp.js";
import { prepareContext } from "../src/lib/solver/engine.js";
import {
  allocateGems, allocateGemsCapped, allocateGemsReachingCap, scoreGemPool, type ScoredGem,
} from "../src/lib/solver/gems.js";
import type { SolveFilters, SolveMode, SolveRequest } from "../src/lib/solver/types.js";

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

// Lv6 gems (15046..15054 = ATK% / DEF% / HP% / CHC / CHD / EFF / RES / DMG+ / DMG-).
const ATK6 = 15046, HP6 = 15048, CRC6 = 15049, CHD6 = 15050, DMGUP6 = 15053;
// Lv5 ATK% (smaller than a lv6 CHD by raw magnitude).
const ATK5 = 15037;

/** A Talisman or EE worn by the hero, +10 (5 gem slots), with these gems. */
function gemPiece(uid: string, slot: "ooparts" | "exclusive", gems: number[]): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: "H", main: [], subs: [], gemSlots: gems,
  } as unknown as GearPiece;
}

function request(charId: number, gems: number[], filters: Partial<SolveFilters>, mode: SolveMode = "score"): SolveRequest {
  const hero = {
    uid: "H", charId, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const base: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const gear = [gemPiece("t", "ooparts", gems.slice(0, 5)), gemPiece("ee", "exclusive", gems.slice(5))];
  return {
    type: "solve", solveId: 1, mode, heroUid: "H", game: GAME,
    inventory: { characters: [hero], gear, presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 100, chunkIndex: 0, chunkCount: 1,
    filters: { ...base, ...filters, options: { ...base.options, ...(filters.options ?? {}) } },
  };
}

const allocOf = (req: SolveRequest) => prepareContext(req).gemAllocByTalismanSlots.get(5)!;
const ids = (n: number, id: number): number[] => Array.from({ length: n }, () => id);

describe("gem filling — the free slots take the hero's useful stat", () => {
  it("review case: { critDmg: 3 }, 5 ATK% + 2 CHD → both CHD first, then the five ATK% (no empty slot left)", () => {
    const pool = new Map([[ATK6, 5], [CHD6, 2]]);
    // Direct call (no dmg model → fillers rank by raw magnitude).
    const scored = scoreGemPool(pool, { critDmg: 3 }, GAME);
    expect(allocateGems(scored, 5, 5).alloc).toEqual({ talisman: [CHD6, CHD6, ATK6, ATK6, ATK6], ee: [ATK6, ATK6, 0, 0, 0] });
    // Through the engine on hero 2000001 (ATK scaler).
    const alloc = allocOf(request(2000001, [...ids(5, ATK6), ...ids(2, CHD6)], { priority: { critDmg: 3 } }));
    expect(alloc).toEqual({ talisman: [CHD6, CHD6, ATK6, ATK6, ATK6], ee: [ATK6, ATK6, 0, 0, 0] });
  });

  it("a negatively-prioritized stat is never socketed, even with free slots", () => {
    const alloc = allocOf(request(2000001, [CHD6, ...ids(4, HP6), ATK6], { priority: { critDmg: 3, hp: -1 } }));
    expect([...alloc.talisman, ...alloc.ee]).not.toContain(HP6);
    expect(alloc.talisman).toEqual([CHD6, ATK6, 0, 0, 0]);
  });

  it("a stat under a `max` bound is never socketed as filler", () => {
    const alloc = allocOf(request(2000001, [CHD6, ...ids(3, ATK6), HP6], {
      priority: { critDmg: 3 }, statFilters: { atk: { max: 99999 } },
    }));
    expect([...alloc.talisman, ...alloc.ee]).not.toContain(ATK6);
    expect(alloc.talisman).toEqual([CHD6, HP6, 0, 0, 0]);
  });

  it("an HP-scaling hero fills with HP% before ATK% (raw magnitude would say ATK%)", () => {
    // Drakhan (2000063, dmgStat hp). ATK% 4 / 40 > HP% 3 / 40 by raw magnitude.
    const alloc = allocOf(request(2000063, [CHD6, ...ids(2, ATK6), ...ids(2, HP6)], { priority: { critDmg: 3 } }));
    expect(alloc.talisman).toEqual([CHD6, HP6, HP6, ATK6, ATK6]);
  });

  it("a noCrit hero takes no CHD as filler while a useful gem is left", () => {
    // Rhona (2000008, noCrit): CHD gains 0 dmg, so the lv5 ATK% go first though
    // a lv6 CHD is bigger by raw magnitude.
    const alloc = allocOf(request(2000008, [DMGUP6, ...ids(3, ATK5), ...ids(6, CHD6)], { priority: { dmgUp: 3 } }));
    expect(alloc.talisman).toEqual([DMGUP6, ATK5, ATK5, ATK5, CHD6]);
    expect(alloc.ee).toEqual(ids(5, CHD6));
  });

  it("allocateGems' delta composes exactly the gems it displays", () => {
    const ctx = prepareContext(request(2000063, [CHD6, ATK6, HP6, CRC6, DMGUP6, ATK5, HP6], { priority: { critDmg: 3 } }));
    for (const ts of [4, 5]) {
      const alloc = ctx.gemAllocByTalismanSlots.get(ts)!;
      const placed = [...alloc.talisman, ...alloc.ee].filter((id) => id !== 0);
      const byId = new Map(ctx.scoredGems.map((g) => [g.id, g]));
      const expected = { flat: {} as Record<string, number>, pct: {} as Record<string, number> };
      for (const id of placed) {
        const g = byId.get(id)!;
        const bucket = g.percent ? expected.pct : expected.flat;
        bucket[g.stat] = (bucket[g.stat] ?? 0) + g.value;
      }
      expect(ctx.gemDeltaByTalismanSlots.get(ts)).toEqual(expected);
      expect(allocateGems(ctx.scoredGems, ts, 5).delta).toEqual(expected);
    }
  });

  it("SOLVE without any priority is unchanged: no override, the socketed gems stay", () => {
    const ctx = prepareContext(request(2000001, [...ids(5, ATK6), ...ids(2, CHD6)], {}));
    expect(ctx.gemDeltaByTalismanSlots.get(5)).toBeNull();
    expect(ctx.scoredGems.every((g) => g.fill == null)).toBe(true);
  });

  it("SOLVE CP without priority fills its zero-CP-weight gems by the same rule", () => {
    // Every gem is socketed: CP weights or filler, no slot left empty.
    const alloc = allocOf(request(2000001, [...ids(5, ATK6), ...ids(2, CHD6)], {}, "cp"));
    expect([...alloc.talisman, ...alloc.ee].filter((id) => id !== 0)).toHaveLength(7);
  });
});

describe("gem filling — crit-cap paths", () => {
  // CHD is the priority; CRC and ATK% are fillers (raw order: CRC 3/20 > ATK% 4/40).
  const scored: ScoredGem[] = scoreGemPool(new Map([[CHD6, 1], [CRC6, 4], [ATK6, 5]]), { critDmg: 3 }, GAME);

  it("allocateGemsCapped: no filler crit gem past the cap", () => {
    // pre-gem CHC 98 → one crit gem (98 → 101), then no more.
    const { alloc } = allocateGemsCapped(scored, 5, 5, 98);
    const placed = [...alloc.talisman, ...alloc.ee];
    expect(placed.filter((id) => id === CRC6)).toHaveLength(1);
    expect(alloc.talisman).toEqual([CHD6, CRC6, ATK6, ATK6, ATK6]);
    expect(alloc.ee).toEqual([ATK6, ATK6, 0, 0, 0]);
  });

  it("allocateGemsReachingCap: a filler crit gem follows the same skip at the cap", () => {
    expect(allocateGemsReachingCap(scored, 5, 5, 100).alloc.talisman).not.toContain(CRC6);
    const below = allocateGemsReachingCap(scored, 5, 5, 98);
    expect([...below.alloc.talisman, ...below.alloc.ee].filter((id) => id === CRC6)).toHaveLength(1);
  });

  it("without filler, the capped allocators still stop at the priority gems", () => {
    const priorityOnly = scored.map((g) => (g.score > 0 ? g : { ...g, fill: undefined }));
    expect(allocateGemsCapped(priorityOnly, 5, 5, 50).alloc.talisman).toEqual([CHD6, 0, 0, 0, 0]);
  });
});

describe("SOLVE CP without priority — gems by marginal CP", () => {
  // Review case (M8): Ame (2000065), a fixed equipped build, a pool of five
  // copies of seven lv6 gems. The score walk (linear CP weights) socketed five
  // DMG-reduce gems; the optimum is 3 ATK% + 2 DMG-reduce (34 643 vs 35 044 CP
  // on the review's level-100 9★ sheet; the engine's own composition here
  // gives other totals, same optimum).
  const DEF6 = 15047, DMGRED6 = 15054;
  const GEM_IDS = [ATK6, CHD6, CRC6, DMGUP6, HP6, DMGRED6, DEF6];
  const roll = (stat: string, value: number, percent: boolean) => ({ stat, value, percent });
  const piece = (uid: string, slot: string, o: Record<string, unknown>): GearPiece => ({
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 9, enhanceLevel: 15, singularityLevel: 5, ascended: true, locked: false,
    equippedBy: null, main: [], subs: [], ...o,
  } as unknown as GearPiece);
  const talisman = (uid: string, equippedBy: string | null, main: ReturnType<typeof roll>[], gems: number[]) =>
    piece(uid, "ooparts", { equippedBy, enhanceLevel: 10, ascended: false, singularityLevel: 0, reforgeCount: 0, main, gemSlots: gems });
  const pool = GEM_IDS.flatMap((id) => ids(5, id));
  const gear = [
    piece("w", "weapon", { equippedBy: "H", main: [roll("atk", 500, false)], subs: [roll("critRate", 12, true), roll("critDmg", 16, true)] }),
    piece("h", "helmet", { equippedBy: "H", main: [roll("hp", 1000, false)] }),
    piece("a", "armor", { equippedBy: "H", main: [roll("def", 200, false)] }),
    piece("gl", "gloves", { equippedBy: "H", main: [roll("atk", 300, false)], subs: [roll("critRate", 15, true)] }),
    piece("b", "boots", { equippedBy: "H", main: [roll("spd", 40, false)] }),
    piece("acc", "accessory", { equippedBy: "H", main: [roll("critDmg", 40, true)] }),
    talisman("t", "H", [roll("atk", 200, false)], pool.slice(0, 5)),
    // Free talismans carrying the rest of the pool.
    ...Array.from({ length: 6 }, (_, i) => talisman(`t${i}`, null, [], pool.slice(5 + 5 * i, 10 + 5 * i))),
  ];

  it("reaches the exhaustive optimum on the review case (3 ATK% + 2 DMG-reduce)", () => {
    const req = request(2000065, [], {}, "cp");
    req.inventory = { ...req.inventory, gear } as Inventory;
    const ctx = prepareContext(req);
    const equipped = gear.filter((g) => g.equippedBy === "H");
    const cpEval = makeCpEvaluator({
      showUIStar: ctx.starMeta.showUIStar, starPlus: ctx.starMeta.starPlus, skills: ctx.skills, ee: ctx.ee, fused: ctx.starMeta.fused,
    });
    const cpOf = (delta: { flat: Record<string, number>; pct: Record<string, number> }): number =>
      cpEval(computeFinalStats(ctx.baseline, ctx.scaling, equipped, GAME, delta), equipped.find((g) => g.slot === "ooparts")!);

    // Every multiset of 5 gems from the pool (≤ 5 copies of each of the 7 ids).
    const gems = GEM_IDS.map((id) => ctx.scoredGems.find((g) => g.id === id)!);
    let best = -Infinity;
    const walk = (k: number, left: number, delta: { flat: Record<string, number>; pct: Record<string, number> }): void => {
      if (k === gems.length) { if (left === 0) best = Math.max(best, cpOf(delta)); return; }
      const g = gems[k]!;
      for (let n = 0; n <= Math.min(5, left); n++) {
        const bucket = g.percent ? "pct" : "flat";
        const next = { ...delta, [bucket]: { ...delta[bucket], [g.stat]: (delta[bucket][g.stat] ?? 0) + n * g.value } };
        walk(k + 1, left - n, n ? next : delta);
      }
    };
    walk(0, 5, { flat: {}, pct: {} });

    const delta = ctx.gemDeltaByTalismanSlots.get(5)!;
    expect(cpOf(delta)).toBeGreaterThanOrEqual(best);
    expect(cpOf(delta)).toBe(best);
    const alloc = ctx.gemAllocByTalismanSlots.get(5)!;
    expect([...alloc.talisman].sort()).toEqual([ATK6, ATK6, ATK6, DMGRED6, DMGRED6].sort());
    expect(alloc.ee).toEqual([]);
  });

  it("sees the CHC cap: a crit gem past 100 % waits behind any gem that still adds CP", () => {
    // Pre-gem CHC 94 % (weapon 33 + gloves 15 + the hero's own): two crit gems
    // reach the cap, the DEF% gem comes next, the last two crit gems only fill.
    // The score walk took the five crit gems and left the DEF% one out.
    const req = request(2000065, [], {}, "cp");
    const own = gear.filter((g) => g.equippedBy === "H" && g.slot !== "ooparts");
    req.inventory = {
      ...req.inventory,
      gear: [
        ...own.map((g) => (g.uid === "w" ? piece("w", "weapon", { ...g, subs: [roll("critRate", 33, true), roll("critDmg", 16, true)] }) : g)),
        talisman("t", "H", [roll("atk", 200, false)], ids(5, CRC6)),
        talisman("t0", null, [], [DEF6]),
      ],
    } as Inventory;
    expect(prepareContext(req).gemAllocByTalismanSlots.get(5)!.talisman).toEqual([CRC6, CRC6, DEF6, CRC6, CRC6]);
  });
});
