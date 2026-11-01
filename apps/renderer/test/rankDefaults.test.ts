/// <reference types="node" />
// Default ranks, set by App on each import (`useRankDefaults`):
//  - rankDefaults: a fresh inventory ranks every key in the given order; a
//    second pass with nothing new is a no-op (same objects); a newcomer gets
//    the next rank without moving the others; a key seen but unranked (the
//    user cleared it) stays unranked;
//  - heroRankOrder: by in-game CP, highest first, on the real contract
//    (`data/derived/`); presetRankOrder: the in-game order (`presetGameOrder`);
//  - the Builds and Presets screens no longer set any rank: their sources
//    reference neither the `seen` helpers nor `fillUnrankedByOrder` (a source
//    check: the node test environment has no DOM to run their mount effects).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, Preset, RolledStat } from "@gear-solver/core";
import { heroRankOrder, presetRankOrder, rankDefaults } from "../src/lib/storage/rankDefaults.js";
import { presetGameOrder } from "../src/lib/presets/presetHolds.js";

describe("rankDefaults", () => {
  it("a fresh inventory ranks every key in the given order", () => {
    const r = rankDefaults({ rank: {}, seen: new Set(), ordered: ["b", "a", "c"] });
    expect(r.changed).toBe(true);
    expect(r.rank).toEqual({ b: 1, a: 2, c: 3 });
    expect([...r.seen].sort()).toEqual(["a", "b", "c"]);
  });

  it("a second pass with nothing new is a no-op and returns the same objects", () => {
    const first = rankDefaults({ rank: {}, seen: new Set(), ordered: ["b", "a"] });
    const second = rankDefaults({ rank: first.rank, seen: first.seen, ordered: ["b", "a"] });
    expect(second.changed).toBe(false);
    expect(second.rank).toBe(first.rank);
    expect(second.seen).toBe(first.seen);
  });

  it("a newcomer gets the next rank, the existing ranks stay", () => {
    const r = rankDefaults({ rank: { a: 1, b: 2 }, seen: new Set(["a", "b"]), ordered: ["n", "b", "a"] });
    expect(r.changed).toBe(true);
    expect(r.rank).toEqual({ a: 1, b: 2, n: 3 });
    expect(r.seen.has("n")).toBe(true);
  });

  it("a key seen but unranked (cleared by the user) is not ranked again", () => {
    const seen = new Set(["a", "b"]);
    const rank = { a: 1 };
    const same = rankDefaults({ rank, seen, ordered: ["b", "a"] });
    expect(same.changed).toBe(false);
    expect(same.rank).toBe(rank);
    const withNew = rankDefaults({ rank, seen, ordered: ["b", "a", "n"] });
    expect(withNew.rank).toEqual({ a: 1, n: 2 });
    expect(withNew.rank.b).toBeUndefined();
  });
});

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

function hero(uid: string, charId = 2000001) {
  return {
    uid, charId, name: uid, stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
}

function weapon(uid: string, atk: number, equippedBy: string): GearPiece {
  return {
    uid, itemId: 1, slot: "weapon", setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0, ascended: false, locked: false,
    equippedBy, main: [], subs: [{ stat: "atk", value: atk, percent: false, ticks: 1 } as RolledStat], gemSlots: [],
  } as unknown as GearPiece;
}

describe("heroRankOrder", () => {
  it("sorts the heroes by in-game CP, highest first; an unresolved CP sinks", () => {
    const inventory = {
      characters: [hero("unknown", 1), hero("low"), hero("high"), hero("mid")],
      gear: [weapon("w1", 100, "low"), weapon("w2", 900, "high"), weapon("w3", 400, "mid")],
      presets: [],
    } as unknown as Inventory;
    expect(heroRankOrder(inventory, GAME, null, null)).toEqual(["high", "mid", "low", "unknown"]);
  });

  it("without game data, keeps the roster order", () => {
    const inventory = { characters: [hero("a"), hero("b")], gear: [weapon("w", 900, "b")], presets: [] } as unknown as Inventory;
    expect(heroRankOrder(inventory, null, null, null)).toEqual(["a", "b"]);
  });
});

describe("presetRankOrder", () => {
  it("follows the in-game order (presetGameOrder)", () => {
    const presets = [3, 1, 2].map((num) => ({ num, name: `P${num}`, itemUids: [] })) as unknown as Preset[];
    const inventory = { characters: [], gear: [], presets } as unknown as Inventory;
    expect(presetRankOrder(inventory)).toEqual(presetGameOrder(presets));
  });
});

describe("Builds and Presets no longer set a rank", () => {
  const source = (p: string) => readFileSync(new URL(`../src/screens/${p}`, import.meta.url), "utf8");
  it.each(["BuildsScreen.tsx", "presets/PresetsScreen.tsx"])("%s writes neither gs.priority.seen nor gs.presets.seen", (p) => {
    const s = source(p);
    for (const name of ["loadSeenHeroes", "persistSeenHeroes", "loadSeenPresets", "persistSeenPresets", "fillUnrankedByOrder", "gs.priority.seen", "gs.presets.seen"]) {
      expect(s).not.toContain(name);
    }
  });
});
