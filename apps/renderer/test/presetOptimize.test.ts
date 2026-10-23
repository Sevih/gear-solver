/**
 * "Optimize preset →" — `presetOptimizePatch`: the outfit's weapon / accessory
 * / talisman effects required (talisman widened to its family), priority
 * substats merged from the outfit and the reco (cut to five), mains from the
 * reco, sets left open; and the status line `presetOptimizeNote`.
 * Synthetic equipment table: the ids only matter through `setId` / family.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, RolledStat, StatType } from "@gear-solver/core";
import { presetOptimizeNote, presetOptimizePatch } from "../src/lib/presets/optimize.js";
import { talismanFamilyKeys, type StructuredCharacterReco } from "../src/lib/reco/translateReco.js";
import { INITIAL_FILTERS, solverFiltersReducer } from "../src/lib/solver/builderFilters.js";

const EQUIPMENT = {
  "1": { slot: "weapon", name: "Blade", setId: "wEff" },
  "2": { slot: "accessory", name: "Amulet", setId: "aEff" },
  "3": { slot: "weapon", name: "Plain sword", setId: null },
  // One talisman family over three stars, and another one.
  "10": { slot: "ooparts", name: "Charm", setId: "t4" },
  "11": { slot: "ooparts", name: "Charm", setId: "t5" },
  "12": { slot: "ooparts", name: "Charm", setId: "t6" },
  "20": { slot: "ooparts", name: "Other", setId: "o6" },
} as unknown as GameData["equipment"];
const GAME = { equipment: EQUIPMENT } as unknown as GameData;
const FAMILY = talismanFamilyKeys(EQUIPMENT);

const sub = (stat: StatType): RolledStat => ({ stat, value: 1, percent: false, source: "option" } as RolledStat);

function piece(slot: GearPiece["slot"], itemId: number, subs: StatType[] = []): GearPiece {
  return {
    uid: `${slot}-${itemId}`, itemId, slot, setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: slot, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null, main: [], subs: subs.map(sub),
  } as GearPiece;
}

/** Weapon, accessory, 4 armor pieces, talisman (subs ignored) and EE (ignored). */
function outfit(armorSubs: StatType[][], extra: { weapon?: StatType[]; accessory?: StatType[] } = {}): GearPiece[] {
  const slots: GearPiece["slot"][] = ["helmet", "armor", "gloves", "boots"];
  return [
    piece("weapon", 1, extra.weapon),
    piece("accessory", 2, extra.accessory),
    ...armorSubs.map((subs, i) => piece(slots[i]!, 100 + i, subs)),
    piece("ooparts", 11, ["spd", "spd"]),
    piece("exclusive", 50, ["spd"]),
  ];
}

const reco = (builds: StructuredCharacterReco["builds"]): StructuredCharacterReco => ({ id: "1", builds });

describe("presetOptimizePatch — effects", () => {
  it("requires the weapon's and accessory's effects, and the talisman's whole family", () => {
    const { patch, notes } = presetOptimizePatch({ pieces: outfit([]), reco: null, game: GAME, talismanFamily: FAMILY });
    expect(patch.weaponEffectPicks).toEqual({ wEff: "required" });
    expect(patch.accessoryEffectPicks).toEqual({ aEff: "required" });
    expect(patch.talismanEffectPicks).toEqual({ t4: "required", t5: "required", t6: "required" });
    expect(notes.filter((n) => /effect filter/.test(n))).toEqual([]);
  });

  it("leaves a slot open, with a note, when its piece is missing or has no effect", () => {
    const pieces = [piece("weapon", 3), piece("ooparts", 20)];
    const { patch, notes } = presetOptimizePatch({ pieces, reco: null, game: GAME, talismanFamily: FAMILY });
    expect(patch.weaponEffectPicks).toEqual({});
    expect(patch.accessoryEffectPicks).toEqual({});
    expect(patch.talismanEffectPicks).toEqual({ o6: "required" });
    expect(notes).toContain("Weapon: no unique effect — no effect filter.");
    expect(notes).toContain("Accessory: not in the outfit — no effect filter.");
  });
});

describe("presetOptimizePatch — priority substats", () => {
  it("without a reco, weighs each key by the pieces rolling it (4+ → 3, 3 → 2, 2 → 1), talisman and EE aside", () => {
    // critRate on 4 armor pieces + weapon = 5; atk / atkPct count once per piece;
    // spd only on the talisman and the EE → not counted.
    const pieces = outfit(
      [["critRate", "atk", "atkPct"], ["critRate", "atkPct"], ["critRate", "pen"], ["critRate", "pen", "hp"]],
      { weapon: ["critRate", "atk"] },
    );
    const { patch, build, notes } = presetOptimizePatch({ pieces, reco: null, game: GAME, talismanFamily: FAMILY });
    expect(patch.priority).toEqual({ critRate: 3, atk: 2, pen: 1 });
    expect(build).toBeNull();
    expect(notes).toContain("No outerpedia reco: substats from the outfit only.");
  });

  it("merges with the reco: max of both weights, then reco keys first, then piece count; cut at five", () => {
    const pieces = outfit(
      [["critRate", "hp", "def"], ["critRate", "hp", "def"], ["critRate", "hp", "def"], ["critRate", "def", "effRes"]],
      { weapon: ["effRes"] },
    );
    const r = reco({
      Burst: { SubstatPrio: [["critDmg"], ["atkPct", "spd"], ["hp"], ["pen"]] },
      Tank: { SubstatPrio: [["def"]] },
    });
    const { patch, build, notes } = presetOptimizePatch({ pieces, reco: r, game: GAME, talismanFamily: FAMILY });
    // Weight 3: critDmg (reco, first), critRate and def (4 pieces each).
    // Weight 2, all three in the reco: hp (reco 1, but 3 pieces → 2) wins on
    // the piece count, then atk; spd is the sixth → cut. pen and effRes weigh 1.
    expect(Object.keys(patch.priority)).toEqual(["critDmg", "critRate", "def", "hp", "atk"]);
    expect(patch.priority).toEqual({ critDmg: 3, critRate: 3, def: 3, hp: 2, atk: 2 });
    expect(Object.values(patch.priority).every((w) => w >= 1 && w <= 3)).toBe(true);
    expect(build).toBe("Burst");
    expect(notes.some((n) => n.includes('"Burst"') && n.includes("first of 2"))).toBe(true);
  });

  it("an empty outfit and no reco give no priority at all", () => {
    const { patch } = presetOptimizePatch({ pieces: [], reco: null, game: GAME, talismanFamily: FAMILY });
    expect(patch.priority).toEqual({});
  });
});

describe("presetOptimizePatch — mains and sets", () => {
  it("takes the weapon and accessory mains from the reco, never its sets", () => {
    const r = reco({
      Only: {
        Weapon: [{ name: "W", itemId: 1, effectIcon: null, mainStat: ["atkPct"] }],
        Amulet: [{ name: "A", itemId: 2, effectIcon: null, mainStat: ["pen", "critDmg"] }],
        Set: [[{ name: "S", setId: "set1", count: 4 }]],
      },
    });
    const { patch, notes } = presetOptimizePatch({ pieces: outfit([]), reco: r, game: GAME, talismanFamily: FAMILY });
    expect(patch.mainPicks).toEqual({ weapon: { atkPct: true }, accessory: { pen: true, critDmg: true } });
    expect(patch.setPlans).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("has no main without a reco", () => {
    const { patch } = presetOptimizePatch({ pieces: outfit([]), reco: null, game: GAME, talismanFamily: FAMILY });
    expect(patch.mainPicks).toEqual({});
  });

  it("merged by the reducer, keeps bands and options and leaves the sets open", () => {
    const start = {
      ...INITIAL_FILTERS,
      statFilters: { spd: { min: 150 } },
      setPlans: [[{ setId: "old", count: 4 }]],
      priority: { hp: 3 },
    };
    const { patch } = presetOptimizePatch({ pieces: outfit([["pen"], ["pen"]]), reco: null, game: GAME, talismanFamily: FAMILY });
    const next = solverFiltersReducer(start, { type: "mergePreset", patch });
    expect(next.statFilters).toEqual({ spd: { min: 150 } });
    expect(next.setPlans).toEqual([[]]);
    expect(next.priority).toEqual({ pen: 1 });
    expect(next.talismanEffectPicks).toEqual({ t4: "required", t5: "required", t6: "required" });
  });
});

describe("presetOptimizeNote", () => {
  it("says where the substats come from, with the reco or without", () => {
    const pieces = outfit([["pen"], ["pen"]]);
    const withReco = presetOptimizePatch({ pieces, reco: reco({ Burst: { SubstatPrio: [["critDmg"]] } }), game: GAME, talismanFamily: FAMILY });
    expect(presetOptimizeNote({ num: 3, name: "Nuke" }, withReco)).toBe(
      'Optimizing preset #3 Nuke — same weapon / accessory / talisman effects required, 2 priority substats from the outfit + outerpedia\'s "Burst" reco.',
    );
    const without = presetOptimizePatch({ pieces, reco: null, game: GAME, talismanFamily: FAMILY });
    expect(presetOptimizeNote({ num: 3, name: "Nuke" }, without)).toBe(
      "Optimizing preset #3 Nuke — same weapon / accessory / talisman effects required, 1 priority substat from the outfit. No outerpedia reco: substats from the outfit only.",
    );
  });
});
