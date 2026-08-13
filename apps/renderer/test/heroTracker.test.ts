import { describe, expect, it } from "vitest";
import type { Character, GameData, GearPiece, Inventory } from "@gear-solver/core";
import { buildHeroTrackerExport } from "../src/lib/heroTracker.js";

// Minimal curves: index = level, value = cumulative XP threshold.
const EXP = [0, 0, 100, 200, 300, 400, 500, 600, 700, 800, 900];        // lv 1..10
const TRUST = [0, 0, 1000, 2000, 3000, 4000];                            // lv 1..5

const game = {
  characters: {
    "2000001": { star: 2 },
    "2000002": { star: 3 },
  },
  expCharacter: EXP,
  trustCharacter: TRUST,
} as unknown as GameData;

function char(over: Partial<Character> = {}): Character {
  return {
    uid: "u1", charId: 2000001, name: "K", stars: 9, locked: false,
    exp: 900, levelMaxStep: 0, trustExp: 4000,
    skills: { first: 5, second: 4, ultimate: 3, chainPassive: 2 },
    fusionCharId: 0, fusionLevel: 0,
    ...over,
  };
}
function ee(itemId: number, enhanceLevel: number): GearPiece {
  return { uid: `g${itemId}`, itemId, slot: "exclusive", enhanceLevel } as unknown as GearPiece;
}
function inv(characters: Character[], gear: GearPiece[] = []): Inventory {
  return { characters, gear, presets: [] };
}

describe("buildHeroTrackerExport", () => {
  it("emits the versioned envelope keyed by base hero id", () => {
    const doc = buildHeroTrackerExport(inv([char()]), game);
    expect(doc.format).toBe("outerpedia:hero-tracker");
    expect(doc.version).toBe(1);
    expect(Object.keys(doc.heroes)).toEqual(["2000001"]);
    expect(doc.heroes["2000001"]).toMatchObject({
      owned: true,
      level: 10,
      skills: { s1: 5, s2: 4, s3: 3, chain_passive: 2 },
      affinity: 5,
      transcend_star: 9,
      ee: 0,
    });
  });

  it("resolves level and affinity from the captured XP curves", () => {
    const doc = buildHeroTrackerExport(inv([char({ exp: 350, trustExp: 2500 })]), game);
    expect(doc.heroes["2000001"]!.level).toBe(5);   // 300 ≤ 350 < 400
    expect(doc.heroes["2000001"]!.affinity).toBe(3); // 2000 ≤ 2500 < 3000
  });

  it("floors level at 5 and affinity at 1 for an untouched hero", () => {
    const doc = buildHeroTrackerExport(inv([char({ exp: 0, trustExp: 0 })]), game);
    expect(doc.heroes["2000001"]!.level).toBe(5);
    expect(doc.heroes["2000001"]!.affinity).toBe(1);
  });

  it("takes the EE enhance level from the owned EE item, best copy wins", () => {
    const doc = buildHeroTrackerExport(inv([char()], [ee(2000001, 4), ee(2000001, 10)]), game);
    expect(doc.heroes["2000001"]!.ee).toBe(10);
  });

  it("ignores non-EE gear when resolving the EE level", () => {
    const weapon = { uid: "w", itemId: 2000001, slot: "weapon", enhanceLevel: 10 } as unknown as GearPiece;
    const doc = buildHeroTrackerExport(inv([char()], [weapon]), game);
    expect(doc.heroes["2000001"]!.ee).toBe(0);
  });

  it("keys a fused hero under its base id and nests the fusion block", () => {
    const doc = buildHeroTrackerExport(
      inv([char({ charId: 2000002, fusionCharId: 2700002, fusionLevel: 5 })],
          [ee(2000002, 10), ee(2700002, 3)]),
      game,
    );
    expect(Object.keys(doc.heroes)).toEqual(["2000002"]); // never 2700002
    expect(doc.heroes["2000002"]).toMatchObject({ ee: 10, core_fusion: { level: 5, ee: 3 } });
  });

  it("omits core_fusion entirely for an unfused hero", () => {
    const doc = buildHeroTrackerExport(inv([char()]), game);
    expect(doc.heroes["2000001"]).not.toHaveProperty("core_fusion");
  });

  it("treats owning the fused variant as fusion tier 1 when the level is missing", () => {
    const doc = buildHeroTrackerExport(inv([char({ fusionCharId: 2700001, fusionLevel: 0 })]), game);
    expect(doc.heroes["2000001"]!.core_fusion).toEqual({ level: 1, ee: 0 });
  });

  it("clamps transcend_star up to the hero's base rarity", () => {
    // A 3★ hero reads 3 even if the capture field is zeroed.
    const doc = buildHeroTrackerExport(inv([char({ charId: 2000002, stars: 0 })]), game);
    expect(doc.heroes["2000002"]!.transcend_star).toBe(3);
  });

  it("clamps out-of-range values into the game's domains", () => {
    const doc = buildHeroTrackerExport(
      inv([char({ stars: 99, exp: 9e9, skills: { first: 0, second: 9, ultimate: 3, chainPassive: 3 } })],
          [ee(2000001, 99)]),
      game,
    );
    const h = doc.heroes["2000001"]!;
    expect(h.transcend_star).toBe(9);
    expect(h.level).toBe(10);   // curve max here; real curve caps at 120
    expect(h.skills.s1).toBe(1);
    expect(h.skills.s2).toBe(5);
    expect(h.ee).toBe(10);
  });

  it("still exports a hero the game data doesn't know", () => {
    const doc = buildHeroTrackerExport(inv([char({ charId: 2099999, stars: 4 })]), game);
    expect(doc.heroes["2099999"]!.transcend_star).toBe(4);
  });
});
