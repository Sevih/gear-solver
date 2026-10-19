/// <reference types="node" />
// SOLVE CP keeps the hero's current gear reachable through the combo-budget
// prune — with a priority as without one (the ranking differs, the pin
// doesn't). Real contract (`data/derived/`) for the hero compose.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { precomputeContext } from "../src/lib/solver/engine.js";
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

const SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"] as const;

function piece(slot: string, uid: string, atk: number, equippedBy: string | null = null): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main: [], subs: [{ stat: "atk", value: atk, percent: false, ticks: 1 } as RolledStat], gemSlots: [],
  } as unknown as GearPiece;
}

/** 12 pieces per slot (atk 10..120) + the hero's worn helmet, the weakest of
 *  its slot (atk 1). 12⁷ combos ≫ the Top% 1 budget → each slot is cut to a
 *  handful, the worn helmet ranks last. */
function helmetPool(mode: SolveMode, priority: Record<string, number>): string[] {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const gear = SLOTS.flatMap((slot) => Array.from({ length: 12 }, (_, i) => piece(slot, `${slot}${i}`, 10 * (i + 1))));
  gear.push(piece("helmet", "worn", 1, "H"));
  const filters: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    // A harmless stat MAX turns the CP dominance prune off: it would drop the
    // dominated worn helmet on its own (legitimately — its dominator never
    // yields less CP), hiding what the budget prune keeps.
    excludedHeroes: [], statFilters: { atk: { max: 1e9 } }, ratingFilters: {}, priority, topPct: 1, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode, heroUid: "H", game: GAME,
    inventory: { characters: [hero], gear, presets: [] } as unknown as Inventory,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: hero.skills,
    topK: 10, chunkIndex: 0, chunkCount: 1, filters,
  };
  return precomputeContext(req).pools.helmet.map((g) => g.uid);
}

describe("SOLVE CP — the current gear survives the combo-budget prune", () => {
  it("without a priority (CP-ranked prune)", () => {
    const pool = helmetPool("cp", {});
    expect(pool.length).toBeLessThan(13); // the prune did cut
    expect(pool).toContain("worn");
  });

  it("with a priority, same pin", () => {
    const pool = helmetPool("cp", { atk: 1 });
    expect(pool.length).toBeLessThan(13);
    expect(pool).toContain("worn");
  });

  it("SOLVE (Score) keeps no pin — its objective is the score, not 'never below current CP'", () => {
    expect(helmetPool("score", { atk: 1 })).not.toContain("worn");
  });
});
