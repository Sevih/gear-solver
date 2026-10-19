/// <reference types="node" />
// End-to-end checks of two precompute rules on the real contract
// (`data/derived/`, hero 2000001):
//  - "Maxed only" in +15R9 keeps a +10 talisman (it has no Singularity, +10 is
//    its ceiling) instead of emptying the talisman pool → 0 builds, and in
//    +10R6 keeps a 5★ weapon at +10 R5 (its own ceiling);
//  - without a priority, the reforge projection spends its ticks by CP weight
//    (not on flat HP), and hands those weights back so the Builder's gear band
//    re-projects the same ticks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { precomputeContext, prepareContext, projectPieceForReforge, reforgeTickKey, solveChunk } from "../src/lib/solver/engine.js";
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

const r = (stat: string, value: number, percent: boolean, ticks?: number): RolledStat =>
  ({ stat, value, percent, ...(ticks != null ? { ticks } : {}) }) as RolledStat;

/** A piece worn by the hero, at +15 R9 ascended unless overridden. */
function piece(uid: string, slot: string, o: Partial<GearPiece> = {}): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 9, enhanceLevel: 15, singularityLevel: 5, ascended: true, locked: false,
    equippedBy: "H", main: [], subs: [], ...o,
  } as unknown as GearPiece;
}

const HERO = {
  uid: "H", charId: 2000001, name: "K", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
  skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
};

function request(gear: GearPiece[], mode: SolveMode, filters: Partial<SolveFilters>): SolveRequest {
  const base: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  return {
    type: "solve", solveId: 1, mode, heroUid: "H", game: GAME,
    inventory: { characters: [HERO], gear, presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: HERO.skills,
    topK: 100, chunkIndex: 0, chunkCount: 1,
    filters: { ...base, ...filters, options: { ...base.options, ...(filters.options ?? {}) } },
  };
}

/** Weapon..accessory at +15 R9 plus a +10 talisman (its maximum). */
function maxedGear(): GearPiece[] {
  return [
    piece("w", "weapon", { main: [r("atk", 500, false)] }),
    piece("h", "helmet", { main: [r("hp", 1000, false)] }),
    piece("a", "armor", { main: [r("def", 200, false)] }),
    piece("gl", "gloves", { main: [r("atk", 300, false)] }),
    piece("b", "boots", { main: [r("spd", 40, false)] }),
    piece("acc", "accessory", { main: [r("atkPct", 30, true)] }),
    piece("t", "ooparts", { enhanceLevel: 10, ascended: false, singularityLevel: 0, reforgeCount: 0, main: [r("atk", 200, false)] }),
  ];
}

describe("'Maxed only' +15R9 — the talisman is held to its own +10 ceiling", () => {
  it("a fully maxed build with a +10 talisman is found", async () => {
    expect(GAME.enhance.maxEnhanceLevel).toBe(10);
    const ctx = prepareContext(request(maxedGear(), "cp", { options: { onlyMaxed: true, reforgeMode: "ascended" } as SolveFilters["options"] }));
    expect(ctx.poolSizes.talisman?.hit).toBe(1);
    const res = await solveChunk(ctx, 0, 1, 10);
    expect(res.builds.length).toBeGreaterThan(0);
  });

  it("a +9 talisman stays out", () => {
    const gear = maxedGear().map((g) => (g.slot === "ooparts" ? { ...g, enhanceLevel: 9 } : g));
    const ctx = prepareContext(request(gear, "cp", { options: { onlyMaxed: true, reforgeMode: "ascended" } as SolveFilters["options"] }));
    expect(ctx.poolSizes.talisman?.hit).toBe(0);
  });
});

describe("'Maxed only' +10R6 — a piece is held to its own ceiling", () => {
  const classicMaxed = { options: { onlyMaxed: true, reforgeMode: "classic" } as SolveFilters["options"] };
  const weapon = (reforgeCount: number) =>
    piece("w5", "weapon", { star: 5, enhanceLevel: 10, reforgeCount, ascended: false, singularityLevel: 0, main: [r("atk", 400, false)] });

  it("a 5★ weapon at +10 R5 (its maximum) is in the pool", () => {
    const gear = maxedGear().map((g) => (g.slot === "weapon" ? weapon(5) : g));
    expect(precomputeContext(request(gear, "cp", classicMaxed)).pools.weapon.map((g) => g.uid)).toEqual(["w5"]);
  });

  it("a 5★ weapon at +10 R4 stays out", () => {
    const gear = maxedGear().map((g) => (g.slot === "weapon" ? weapon(4) : g));
    expect(precomputeContext(request(gear, "cp", classicMaxed)).pools.weapon).toEqual([]);
  });
});

describe("reforge projection without a priority — CP-weighted ticks", () => {
  // The replayed case: a +10 helmet with one tick of CRC, CHD, flat HP and ATK%,
  // 6 reforges to project. Raw per-tick values sent all 5 free ticks to HP.
  const helmet = piece("h", "helmet", {
    enhanceLevel: 10, ascended: false, singularityLevel: 0, reforgeCount: 0, main: [r("hp", 1000, false)],
    subs: [r("critRate", 4, true, 1), r("critDmg", 4.4, true, 1), r("hp", 180, false, 1), r("atkPct", 4, true, 1)],
  });
  const gear = maxedGear().map((g) => (g.slot === "helmet" ? helmet : g));
  const classic = { options: { reforgeMode: "classic" } as SolveFilters["options"] };

  for (const mode of ["cp", "score"] as const) {
    it(`${mode}: ticks go to the subs worth the most CP, not to flat HP`, () => {
      const ctx = prepareContext(request(gear, mode, classic));
      const w = ctx.reforgeTickWeights!;
      expect(w).not.toBeNull();
      const projected = ctx.pools.helmet[0]!;
      const hp = projected.subs.find((s) => s.stat === "hp")!;
      expect(hp.value).toBeLessThan(1080);
      // The sub with the best CP per tick is filled to LV6 first.
      const perTickCp = (s: RolledStat) => w[reforgeTickKey(s.stat, s.percent)]! * (s.value / (s.ticks ?? 1));
      const best = [...helmet.subs].sort((a, b) => perTickCp(b) - perTickCp(a))[0]!;
      expect(best.stat).not.toBe("hp");
      expect(projected.subs.find((s) => s.stat === best.stat)!.ticks).toBe(6);
      // The gear band re-projects with the returned weights → same ticks.
      const shown = projectPieceForReforge(helmet, GAME, "classic", {}, w);
      expect(shown.subs).toEqual(projected.subs);
    });
  }

  it("an explicit priority keeps steering the ticks (no weights computed)", () => {
    const ctx = prepareContext(request(gear, "cp", { ...classic, priority: { hp: 1 } }));
    expect(ctx.reforgeTickWeights).toBeNull();
    expect(ctx.pools.helmet[0]!.subs.find((s) => s.stat === "hp")!.ticks).toBe(6);
  });

  it("no projection, no weights", () => {
    expect(prepareContext(request(gear, "cp", {})).reforgeTickWeights).toBeNull();
    const maxed = { options: { reforgeMode: "classic", onlyMaxed: true } as SolveFilters["options"] };
    expect(prepareContext(request(gear, "cp", maxed)).reforgeTickWeights).toBeNull();
  });
});
