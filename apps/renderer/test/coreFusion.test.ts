/// <reference types="node" />
// A Core Fusion hero solves on its fused character (`effectiveCharacter`), on
// the real contract (`data/derived/`): the engine's no-gear baseline is the
// one the Builds card composes for that hero, and the fused variant's own
// dmgStat drives the offensive ratings (fused Veronica scales off HP).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeCharStats, expToLevel, type GameData, type Inventory } from "@gear-solver/core";
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

const SKILLS = { first: 5, second: 5, ultimate: 5, chainPassive: 5 };

function hero(charId: number, fusionCharId: number) {
  return {
    uid: "H", charId, name: null, stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: SKILLS, fusionCharId, fusionLevel: fusionCharId ? 1 : 0,
  };
}

function request(charId: number, fusionCharId: number): SolveRequest {
  const filters: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  return {
    type: "solve", solveId: 1, mode: "score", heroUid: "H", game: GAME,
    inventory: { characters: [hero(charId, fusionCharId)], gear: [], presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: SKILLS,
    topK: 10, chunkIndex: 0, chunkCount: 1, filters,
  };
}

/** The Builds card's composition for a hero (`BuildsScreen` `composed`), on
 *  the given CharacterDef id. */
function buildsBaseline(defId: string) {
  return composeCharStats(GAME.characters[defId]!.ingredients!, GAME.codexCurve, {
    transStar: 9, level: expToLevel(GAME.expCharacter, 1e12), levelMaxModifier: 0, levelMaxStep: 0,
    userGeasLevels: null, userSkillLevels: { first: 5, second: 5, ultimate: 5 },
  }).noGearStats;
}

describe("Core Fusion — the engine composes the fused character", () => {
  it("fused Snow: baseline = the Builds card's (2700003), not the origin's", () => {
    const ctx = precomputeContext(request(2000003, 2700003));
    expect(ctx.baseline).toEqual(buildsBaseline("2700003"));
    expect(ctx.baseline).not.toEqual(buildsBaseline("2000003"));
  });

  it("unfused Snow still composes on the origin", () => {
    const ctx = precomputeContext(request(2000003, 0));
    expect(ctx.baseline).toEqual(buildsBaseline("2000003"));
  });

  it("fused Veronica (2700037) scales off HP; the origin off ATK", () => {
    expect(precomputeContext(request(2000037, 2700037)).dmgStat).toBe("hp");
    expect(precomputeContext(request(2000037, 0)).dmgStat).toBe("atk");
  });
});
