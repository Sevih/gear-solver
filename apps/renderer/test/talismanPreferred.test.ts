/// <reference types="node" />
// Talisman advice on the real contract (`data/derived/`): a recommendation's
// talismans are "preferred" — the pool narrows to them when the hero can use
// at least one (after every `allow` filter), and stays open otherwise; never
// 0 builds because of it. `required` keeps the weapon behavior (empty pool when
// not owned).
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

// 6★ Tactician's Charm (top tier 10207 and a variant 95001 share setId
// "3029, 3129") and 6★ Executioner's Charm (10201, "3023, 3123").
const TACTICIAN = GAME.equipment["10207"]!.setId!;
const EXECUTIONER = GAME.equipment["10201"]!.setId!;

function talisman(uid: string, itemId: number, extra: Partial<GearPiece> = {}): GearPiece {
  return {
    uid, itemId, slot: "ooparts", setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: null, main: [], subs: [], gemSlots: [], ...extra,
  } as unknown as GearPiece;
}

function poolOf(gear: GearPiece[], filters: Partial<SolveFilters>): string[] {
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
    filters: { ...base, ...filters, options: { ...base.options, ...(filters.options ?? {}) } },
  };
  return precomputeContext(req).pools.ooparts.map((g) => g.uid).sort();
}

const heroClass = (GAME.characters["2000001"] as { cls?: string }).cls!;
const otherClass = ["Striker", "Defender", "Ranger", "Healer", "Mage"].find((c) => c !== heroClass)!;

describe("talisman effect picks — preferred narrows only when it can", () => {
  const gear = [talisman("tac", 10207), talisman("tac-variant", 95001), talisman("exe", 10201)];

  it("a preferred talisman the hero owns → the pool is reduced to it (variants included)", () => {
    expect(poolOf(gear, { talismanEffectPicks: { [TACTICIAN]: "preferred" } })).toEqual(["tac", "tac-variant"]);
  });

  it("a preferred talisman not owned → the whole pool", () => {
    expect(poolOf([talisman("exe", 10201)], { talismanEffectPicks: { [TACTICIAN]: "preferred" } })).toEqual(["exe"]);
  });

  it("owned but filtered out by another criterion → the whole remaining pool", () => {
    // Class: the only Tactician's is limited to another class.
    const classLocked = [talisman("tac", 10207, { classLimit: otherClass } as Partial<GearPiece>), talisman("exe", 10201)];
    expect(poolOf(classLocked, { talismanEffectPicks: { [TACTICIAN]: "preferred" } })).toEqual(["exe"]);
    // "Equipped items" scope: the only Tactician's is worn by another hero.
    const worn = [talisman("tac", 10207, { equippedBy: "other" }), talisman("exe", 10201)];
    expect(poolOf(worn, { talismanEffectPicks: { [TACTICIAN]: "preferred" }, options: { equippedScope: "none" } as SolveFilters["options"] })).toEqual(["exe"]);
  });

  it("required not owned → empty pool (weapon behavior); excluded drops the effect", () => {
    expect(poolOf([talisman("exe", 10201)], { talismanEffectPicks: { [TACTICIAN]: "required" } })).toEqual([]);
    expect(poolOf(gear, { talismanEffectPicks: { [EXECUTIONER]: "required" } })).toEqual(["exe"]);
    expect(poolOf(gear, { talismanEffectPicks: { [TACTICIAN]: "excluded" } })).toEqual(["exe"]);
  });

  it("keep current: the worn talisman stays locked over a preference", () => {
    const g = [talisman("tac", 10207), talisman("exe", 10201, { equippedBy: "H" })];
    expect(poolOf(g, { talismanEffectPicks: { [TACTICIAN]: "preferred" }, options: { keepCurrent: true } as SolveFilters["options"] })).toEqual(["exe"]);
  });

  it("no talisman pick (older payload) → the whole pool", () => {
    expect(poolOf(gear, {})).toEqual(["exe", "tac", "tac-variant"]);
  });
});
