/// <reference types="node" />
// Builder › Mains exclusions on the real contract (`data/derived/`): a piece
// carrying an excluded main stat never enters its slot's pool, before the
// acceptables are checked; a slot emptied that way reports the cause in
// `poolSizes` so the Builder can name it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, StatType } from "@gear-solver/core";
import { precomputeContext } from "../src/lib/solver/engine.js";
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

/** A 6★ talisman (Tactician's Charm) with one option main stat. */
function talisman(uid: string, stat: StatType): GearPiece {
  return {
    uid, itemId: 10207, slot: "ooparts", setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: null, main: [{ stat, value: 30, percent: true }], subs: [], gemSlots: [],
  } as unknown as GearPiece;
}

function precompute(gear: GearPiece[], filters: Partial<SolveFilters>) {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const base: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: "score", heroUid: "H", game: GAME,
    inventory: { characters: [hero], gear, presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 10, chunkIndex: 0, chunkCount: 1,
    filters: { ...base, ...filters },
  };
  return precomputeContext(req);
}

const talismanPool = (gear: GearPiece[], filters: Partial<SolveFilters>): string[] =>
  precompute(gear, filters).pools.ooparts.map((g) => g.uid).sort();

describe("main stat exclusions — talisman", () => {
  const gear = [talisman("atk", "atkPct"), talisman("hp", "hpPct"), talisman("def", "defPct")];

  it("an excluded ATK% talisman leaves the pool, an HP% one stays", () => {
    expect(talismanPool(gear, { mainExcludes: { talisman: { atkPct: true } } })).toEqual(["def", "hp"]);
  });

  it("no exclusion (older payload) → the whole pool", () => {
    expect(talismanPool(gear, {})).toEqual(["atk", "def", "hp"]);
  });

  it("combined with acceptables: the exclusion drops, the acceptables narrow the rest", () => {
    expect(talismanPool(gear, {
      mainPicks: { talisman: { hpPct: true, atkPct: true } },
      mainExcludes: { talisman: { atkPct: true } },
    })).toEqual(["hp"]);
    expect(talismanPool(gear, {
      mainPicks: { talisman: { hpPct: true } },
      mainExcludes: { talisman: { defPct: true } },
    })).toEqual(["hp"]);
  });

  it("the exclusion is per slot — a weapon exclusion leaves talismans alone", () => {
    expect(talismanPool(gear, { mainExcludes: { weapon: { atkPct: true } } })).toEqual(["atk", "def", "hp"]);
  });

  it("a slot emptied by the exclusion reports how many pieces it dropped", () => {
    const ctx = precompute([talisman("atk", "atkPct"), talisman("atk2", "atkPct")], { mainExcludes: { talisman: { atkPct: true } } });
    expect(ctx.poolSizes.talisman).toEqual({ hit: 0, of: 2, mainExcluded: 2 });
    // No exclusion → no cause reported.
    expect(precompute(gear, {}).poolSizes.talisman).toEqual({ hit: 3, of: 3 });
  });
});
