/// <reference types="node" />
// +15 passive picks in the engine's pool filter (`allow`), on the real
// contract (`data/derived/`): per group (weapon / accessory / armor), an
// excluded family drops the piece at any grade, a required one keeps only the
// pieces carrying it at its minimum grade or better — a piece without a
// passive (below +15) is dropped by a required pick. Drops are counted in
// `poolSizes[slot].passiveExcluded`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
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

const DS = "Increased DMG within Dimensional Singularity";

/** A piece carrying singularity option `optId` (none when null). */
function piece(uid: string, slot: string, optId: string | null): GearPiece {
  const opt = optId ? GAME.singularityOptions[optId]! : null;
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: opt ? 15 : 10, singularityLevel: 0, ascended: !!opt, locked: false,
    equippedBy: null, subs: [], gemSlots: [],
    main: opt ? [{ stat: "dmgUp", value: 120, percent: true, fromBuff: true, source: "singularity", name: opt.name, desc: opt.desc, combatOnly: true }] : [],
  } as unknown as GearPiece;
}

function precompute(gear: GearPiece[], passivePicks: SolveFilters["passivePicks"]) {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const filters: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
    ...(passivePicks ? { passivePicks } : {}),
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode: "score", heroUid: "H", game: GAME,
    inventory: { characters: [hero], gear, presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 10, chunkIndex: 0, chunkCount: 1, filters,
  };
  return precomputeContext(req);
}

const uids = (pool: GearPiece[]) => pool.map((g) => g.uid).sort();

// 300137 = DS DMG+ grade A, 300132 = grade B.
const WEAPONS = [piece("dsA", "weapon", "300137"), piece("dsB", "weapon", "300132"), piece("none", "weapon", null)];

describe("+15 passive picks — weapon pool", () => {
  it("required DS DMG+ at A → only the grade-A weapon", () => {
    const ctx = precompute(WEAPONS, { weapon: { [DS]: { state: "required", minGrade: "A" } } });
    expect(uids(ctx.pools.weapon)).toEqual(["dsA"]);
    expect(ctx.poolSizes.weapon!.passiveExcluded).toBe(2);
  });

  it("required at C (any grade) → both weapons carrying it, never the one without a passive", () => {
    const ctx = precompute(WEAPONS, { weapon: { [DS]: { state: "required", minGrade: "C" } } });
    expect(uids(ctx.pools.weapon)).toEqual(["dsA", "dsB"]);
    expect(ctx.poolSizes.weapon!.passiveExcluded).toBe(1);
  });

  it("excluded DS DMG+ → only the weapon without it", () => {
    const ctx = precompute(WEAPONS, { weapon: { [DS]: { state: "excluded", minGrade: "C" } } });
    expect(uids(ctx.pools.weapon)).toEqual(["none"]);
    expect(ctx.poolSizes.weapon!.passiveExcluded).toBe(2);
  });

  it("several required families = any of them, each at its own grade", () => {
    const dmg = piece("dmgC", "weapon", "300106"); // "DMG Increase to target ", grade C
    const ctx = precompute([...WEAPONS, dmg], {
      weapon: { [DS]: { state: "required", minGrade: "A" }, "DMG Increase to target": { state: "required", minGrade: "C" } },
    });
    expect(uids(ctx.pools.weapon)).toEqual(["dmgC", "dsA"]);
  });

  it("a required pick on Armor leaves the weapons alone", () => {
    const helmets = [piece("h-none", "helmet", null)];
    const ctx = precompute([...WEAPONS, ...helmets], { armor: { "Reduced DMG Taken vs Fire": { state: "required", minGrade: "C" } } });
    expect(uids(ctx.pools.weapon)).toEqual(["dsA", "dsB", "none"]);
    expect(ctx.pools.helmet).toEqual([]);
    expect(ctx.poolSizes.helmet!.passiveExcluded).toBe(1);
    expect(ctx.poolSizes.weapon!.passiveExcluded).toBeUndefined();
  });

  it("no pick (older payload) → the whole pool, nothing counted", () => {
    const ctx = precompute(WEAPONS, undefined);
    expect(uids(ctx.pools.weapon)).toEqual(["dsA", "dsB", "none"]);
    expect(ctx.poolSizes.weapon!.passiveExcluded).toBeUndefined();
  });
});
