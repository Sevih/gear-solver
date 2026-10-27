/**
 * Presets tab model — `presetRows` (pieces, wearers, missing / shared pieces),
 * `evaluatePresetFor` / `bestKnownFor` / `presetLoss` (a preset scored on one
 * hero against their best known outfit) and the `gs.presetHeroes` store.
 * Heroes are hand-built `HeroBase`s (plain baseline/scaling, no compose).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Character, GearPiece, Inventory, Preset, RolledStat, StatScaling } from "@gear-solver/core";
import { arrangePresets, presetClasses, presetRows, presetSignature, type PresetRow } from "../src/lib/presets/presetRows.js";
import { bestKnownFor, effectivePriority, evaluatePresetFor, presetLoss, type HeroBase, type PresetEvalContext } from "../src/lib/presets/evaluate.js";
import { computeFinalStats, type FinalStatsBaseline, type ScalingMap } from "../src/lib/composeBuild.js";
import { computeScore } from "../src/lib/solver/ratings.js";
import {
  addPresetAssociated, loadPresetHeroes, persistPresetHeroes, presetHeroesFor, removePresetAssociated, setPresetReference,
  PRESET_HEROES_KEY,
} from "../src/lib/storage/presetHeroes.js";
import type { SavedBuild } from "../src/lib/storage/savedBuilds.js";

const atk = (value: number): RolledStat => ({ stat: "atk", value, percent: false, source: "option" });

function piece(slot: GearPiece["slot"], uid: string, equippedBy: string | null, main: RolledStat[] = []): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
    ascended: false, locked: false, equippedBy, main, subs: [],
  } as GearPiece;
}

const hero = (uid: string): Character => ({ uid, charId: 1, name: uid } as unknown as Character);
const preset = (num: number, itemUids: string[]): Preset => ({ num, name: `P${num}`, itemUids, favorite: false, presetType: 0, sortOrder: 0 });

/** Wire order: weapon, accessory, helmet, armor, gloves, boots, EE, talisman. */
const wire = (w: string, ac: string, h: string, a: string, g: string, b: string, ee: string, t: string) => [w, ac, h, a, g, b, ee, t];

// Hero A wears w1 + the common armor; hero B the same with w2 instead of w1.
// Each wears their own EE (+50 / +80 flat ATK).
const GEAR: GearPiece[] = [
  piece("weapon", "w1", "A", [atk(300)]),
  piece("weapon", "w2", "B", [atk(500)]),
  piece("accessory", "ac1", "A"), piece("helmet", "h1", "A"), piece("armor", "a1", "A"),
  piece("gloves", "g1", "A"), piece("boots", "b1", "A"), piece("ooparts", "t1", "A"),
  piece("accessory", "ac2", "B"), piece("helmet", "h2", "B"), piece("armor", "a2", "B"),
  piece("gloves", "g2", "B"), piece("boots", "b2", "B"), piece("ooparts", "t2", "B"),
  piece("exclusive", "eeA", "A", [atk(50)]),
  piece("exclusive", "eeB", "B", [atk(80)]),
  piece("exclusive", "eeX", null, [atk(999)]),
];

// Preset 1 = A's outfit, with ANOTHER EE in the wire EE slot (ignored).
// Preset 2 = B's armor with w1 (shared with preset 1) and a vanished helmet.
// Preset 3 = all empty.
const INVENTORY: Inventory = {
  gear: GEAR,
  characters: [hero("A"), hero("B")],
  presets: [
    preset(2, wire("w1", "ac2", "999", "a2", "g2", "b2", "0", "t2")),
    preset(1, wire("w1", "ac1", "h1", "a1", "g1", "b1", "eeX", "t1")),
    preset(3, wire("0", "0", "0", "0", "0", "0", "0", "0")),
  ],
};

describe("presetRows", () => {
  const rows = presetRows(INVENTORY);
  const byNum = (n: number) => rows.find((r) => r.preset.num === n)!;

  it("lists presets in number order when nothing else orders them, the EE slot never part of them", () => {
    expect(rows.map((r) => r.preset.num)).toEqual([1, 2, 3]);
    expect(byNum(1).pieces.map((p) => p.slot)).toEqual(["weapon", "accessory", "helmet", "armor", "gloves", "boots", "ooparts"]);
    expect(byNum(1).pieces.some((p) => p.uid === "eeX")).toBe(false);
  });

  it("the exact wearer is found despite a different EE; one piece off is not a wearer", () => {
    expect(byNum(1).wearerUids).toEqual(["A"]);
    // B wears preset 2's armor but w2, not w1 (and the helmet is gone anyway).
    expect(byNum(2).wearerUids).toEqual([]);
    const swapped: Inventory = { ...INVENTORY, presets: [preset(4, wire("w2", "ac1", "h1", "a1", "g1", "b1", "0", "t1"))] };
    expect(presetRows(swapped)[0]!.wearerUids).toEqual([]);
  });

  it("a piece the inventory no longer holds is flagged, its slot from the wire position", () => {
    const helmet = byNum(2).pieces.find((p) => p.uid === "999")!;
    expect(helmet).toMatchObject({ slot: "helmet", piece: null, missing: true });
    expect(byNum(2).missingCount).toBe(1);
    expect(byNum(2).presentPieces.map((p) => p.uid)).not.toContain("999");
  });

  it("a piece held by two presets is flagged on both", () => {
    expect(byNum(1).pieces.find((p) => p.uid === "w1")!.sharedWith).toEqual([{ num: 2, name: "P2" }]);
    expect(byNum(2).pieces.find((p) => p.uid === "w1")!.sharedWith).toEqual([{ num: 1, name: "P1" }]);
    expect(byNum(1).sharedCount).toBe(1);
    expect(byNum(1).pieces.find((p) => p.uid === "h1")!.sharedWith).toEqual([]);
  });

  it("an all-empty preset has no piece and no wearer", () => {
    expect(byNum(3)).toMatchObject({ empty: true, pieces: [], wearerUids: [] });
  });

  it("presetSignature skips the EE and empty slots, order-free", () => {
    const slots = new Map(GEAR.map((g) => [g.uid, g.slot]));
    expect(presetSignature(["h1", "eeA", "0", "w1"], slots)).toBe(presetSignature(["w1", "h1"], slots));
  });
});

describe("presetRows — the in-game editor's order", () => {
  const p = (num: number, favorite: boolean, sortOrder: number, presetType = 0): Preset => ({
    ...preset(num, wire("0", "0", "0", "0", "0", "0", "0", "0")), favorite, sortOrder, presetType,
  });
  it("favorites first, then the player's order (higher first), then num; Master League after", () => {
    const inv: Inventory = {
      ...INVENTORY,
      presets: [p(6, true, 9, 1), p(1, false, 0), p(4, false, 2), p(2, true, 0), p(3, false, 5), p(5, true, 1)],
    };
    expect(presetRows(inv).map((r) => r.preset.num)).toEqual([5, 2, 3, 4, 1, 6]);
  });
});

describe("presetClasses", () => {
  const restricted = (slot: GearPiece["slot"], uid: string, cls: string | null): GearPiece => ({ ...piece(slot, uid, null), classLimit: cls });
  const gear = [
    restricted("weapon", "wMage", "CCT_MAGE"), restricted("weapon", "wFree", null),
    restricted("accessory", "acRanger", "CCT_RANGER"), restricted("accessory", "acFree", null),
    restricted("helmet", "hX", null),
  ];
  const CLASS: Record<string, string> = { A: "CCT_ATTACKER", B: "CCT_PRIEST", C: "CCT_DEFENDER" };
  const classOf = (uid: string) => CLASS[uid] ?? null;
  const rowOf = (uids: string[], wearerUids: string[] = []): PresetRow => ({
    ...presetRows({ gear, characters: [], presets: [preset(1, wire(uids[0] ?? "0", uids[1] ?? "0", uids[2] ?? "0", "0", "0", "0", "0", "0"))] })[0]!,
    wearerUids,
  });
  const none = { referenceUid: null, associatedUids: [] };

  it("a class-restricted weapon makes the preset that class's, whoever wears it", () => {
    expect(presetClasses(rowOf(["wMage", "acFree", "hX"]), { referenceUid: "A", associatedUids: [] }, classOf)).toEqual(["CCT_MAGE"]);
  });
  it("a class-restricted accessory too", () => {
    expect(presetClasses(rowOf(["wFree", "acRanger"]), none, classOf)).toEqual(["CCT_RANGER"]);
  });
  it("two pieces restricted to two classes keep both", () => {
    expect(presetClasses(rowOf(["wMage", "acRanger"]), none, classOf)).toEqual(["CCT_MAGE", "CCT_RANGER"]);
  });
  it("no restricted piece: the reference hero, else the wearers, else the associated heroes", () => {
    const row = rowOf(["wFree", "acFree", "hX"], ["B"]);
    expect(presetClasses(row, { referenceUid: "A", associatedUids: ["C"] }, classOf)).toEqual(["CCT_ATTACKER"]);
    expect(presetClasses(row, { referenceUid: null, associatedUids: ["C"] }, classOf)).toEqual(["CCT_PRIEST"]);
    expect(presetClasses(rowOf(["wFree"]), { referenceUid: null, associatedUids: ["C", "A"] }, classOf)).toEqual(["CCT_DEFENDER", "CCT_ATTACKER"]);
  });
  it("nothing to tell: unknown", () => {
    expect(presetClasses(rowOf(["wFree"]), none, classOf)).toEqual([]);
    expect(presetClasses(rowOf([]), { referenceUid: "Z", associatedUids: [] }, classOf)).toEqual([]);
  });
});

describe("arrangePresets", () => {
  const ORDER = ["CCT_ATTACKER", "CCT_RANGER", "CCT_MAGE", "CCT_DEFENDER", "CCT_PRIEST"];
  const card = (num: number, classes: string[], empty = false) => ({ row: { preset: preset(num, []), empty } as PresetRow, classes });
  // Game order: 1 (mage), 2 (unknown), 3 (striker), 4 (empty, healer by its reference), 5 (mage + ranger).
  const CARDS = [card(1, ["CCT_MAGE"]), card(2, []), card(3, ["CCT_ATTACKER"]), card(4, ["CCT_PRIEST"], true), card(5, ["CCT_MAGE", "CCT_RANGER"])];
  const nums = (cards: ReturnType<typeof card>[]) => cards.map((c) => c.row.preset.num);

  it("no filter, in-game sort: everything, untouched", () => {
    expect(nums(arrangePresets(CARDS, new Set(), "game", ORDER))).toEqual([1, 2, 3, 4, 5]);
  });
  it("a filter keeps the cards with one of the classes, never an empty or unknown one", () => {
    expect(nums(arrangePresets(CARDS, new Set(["CCT_MAGE"]), "game", ORDER))).toEqual([1, 5]);
    expect(nums(arrangePresets(CARDS, new Set(["CCT_PRIEST", "CCT_RANGER"]), "game", ORDER))).toEqual([5]);
  });
  it("class sort: chip order, unknown last, the game's order within a class", () => {
    expect(nums(arrangePresets(CARDS, new Set(), "class", ORDER))).toEqual([3, 5, 1, 4, 2]);
  });
  it("class sort with a filter: only the selected classes rank a card", () => {
    expect(nums(arrangePresets(CARDS, new Set(["CCT_MAGE", "CCT_ATTACKER"]), "class", ORDER))).toEqual([3, 1, 5]);
  });
  it("priority sort: rank 1 first, the unranked last in the game's order", () => {
    expect(nums(arrangePresets(CARDS, new Set(), "priority", ORDER, { 5: 1, 3: 2, 1: 3 }))).toEqual([5, 3, 1, 2, 4]);
    expect(nums(arrangePresets(CARDS, new Set(["CCT_MAGE"]), "priority", ORDER, { 5: 2, 1: 1 }))).toEqual([1, 5]);
    expect(nums(arrangePresets(CARDS, new Set(), "priority", ORDER))).toEqual([1, 2, 3, 4, 5]);
  });
});

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
const PRIORITY = { atk: 1 };

function base(uid: string, priority: Record<string, number> | null = PRIORITY): HeroBase {
  return { uid, baseline: BASELINE, scaling: SCALING, dmgStat: "atk", noCrit: false, skillFactor: 1, turnFactor: 1, priority };
}

function ctxWith(heroes: HeroBase[], savedBuilds: PresetEvalContext["savedBuilds"] = {}): PresetEvalContext {
  return { inventory: INVENTORY, game: null, heroes: new Map(heroes.map((h) => [h.uid, h])), savedBuilds };
}

const compose = (uids: string[]) => computeFinalStats(BASELINE, SCALING, GEAR.filter((g) => uids.includes(g.uid)), null);
const preset1 = () => presetRows(INVENTORY).find((r) => r.preset.num === 1)!.presentPieces;

describe("evaluatePresetFor", () => {
  it("composes the preset's pieces with the hero's OWN EE — not the preset's", () => {
    const ctx = ctxWith([base("B")]);
    const r = evaluatePresetFor("B", preset1(), ctx)!;
    expect(r.finalStats).toEqual(compose(["w1", "ac1", "h1", "a1", "g1", "b1", "t1", "eeB"]));
    // B's own gear has w2 (+500) instead of w1 (+300): the preset costs 200 ATK.
    const current = compose(GEAR.filter((g) => g.equippedBy === "B").map((g) => g.uid));
    expect(current.atk - r.finalStats.atk).toBe(200);
    expect(r.score).toBe(computeScore(r.finalStats, PRIORITY));
    expect(r.ratings.dmg).toBeGreaterThan(0);
  });

  it("loss is 0 when the preset IS the hero's best known outfit (current gear)", () => {
    const ctx = ctxWith([base("A")]);
    const r = evaluatePresetFor("A", preset1(), ctx)!;
    const best = bestKnownFor("A", ctx)!;
    expect(best.source).toBe("current");
    expect(presetLoss(r.score, best.score)).toBe(0);
  });

  it("no priority → no score, no loss", () => {
    const ctx = ctxWith([base("B", null)]);
    const r = evaluatePresetFor("B", preset1(), ctx)!;
    expect(r.score).toBeNull();
    expect(presetLoss(r.score, bestKnownFor("B", ctx)!.score)).toBeNull();
    expect(effectivePriority({ atk: 0 })).toBeNull();
  });

  it("presetLoss: 1 − preset / best, null when best isn't positive", () => {
    expect(presetLoss(77, 100)).toBeCloseTo(0.23);
    expect(presetLoss(50, 0)).toBeNull();
  });

  it("a hero without a composed base is not evaluated", () => {
    expect(evaluatePresetFor("B", preset1(), ctxWith([]))).toBeNull();
  });
});

describe("bestKnownFor", () => {
  const stats = compose(["w2", "eeB"]);
  const saved = (id: string, createdAt: number, atkValue: number): SavedBuild => ({
    id, name: id, heroUid: "B", mode: "score", createdAt,
    build: { pieceUids: [], gemAllocation: { talisman: [], ee: [] }, finalStats: { ...stats, atk: atkValue }, ratings: {} as SavedBuild["build"]["ratings"], score: 12345, cp: null, upg: 0 },
    reforge: { reforgeMode: "disable", priority: { hp: 3 } },
  });

  it("takes the most recent saved build over the current gear", () => {
    const ctx = ctxWith([base("B")], { B: [saved("old", 1, 9000), saved("new", 2, 4000)] });
    const best = bestKnownFor("B", ctx)!;
    expect(best.source).toBe("saved");
    expect(best.finalStats.atk).toBe(4000);
  });

  it("re-scores the saved build with the CURRENT priority, not the saved one", () => {
    const ctx = ctxWith([base("B")], { B: [saved("new", 2, 4000)] });
    const best = bestKnownFor("B", ctx)!;
    expect(best.score).toBe(computeScore({ ...stats, atk: 4000 }, PRIORITY));
    expect(best.score).not.toBe(12345);
  });

  it("falls back to the current gear without a saved build", () => {
    const best = bestKnownFor("B", ctxWith([base("B")]))!;
    expect(best.source).toBe("current");
    expect(best.finalStats).toEqual(compose(GEAR.filter((g) => g.equippedBy === "B").map((g) => g.uid)));
  });
});

describe("gs.presetHeroes store", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    } as Storage;
  });

  it("round-trips through localStorage", () => {
    const map = addPresetAssociated(setPresetReference({}, 1, "A"), 1, "B");
    persistPresetHeroes(map);
    expect(JSON.parse(store.get(PRESET_HEROES_KEY)!)).toEqual({ 1: { referenceUid: "A", associatedUids: ["B"] } });
    expect(loadPresetHeroes()).toEqual(map);
  });

  it("a uid that left the roster is ignored on read", () => {
    const map = { 1: { referenceUid: "gone", associatedUids: ["B", "gone2"] } };
    expect(presetHeroesFor(map, 1, new Set(["A", "B"]))).toEqual({ referenceUid: null, associatedUids: ["B"] });
    expect(presetHeroesFor(map, 7, new Set(["A"]))).toEqual({ referenceUid: null, associatedUids: [] });
  });

  it("one role per hero: the reference leaves the associated list, no duplicate", () => {
    let map = addPresetAssociated({}, 1, "A");
    map = addPresetAssociated(map, 1, "A");
    expect(map[1]!.associatedUids).toEqual(["A"]);
    map = setPresetReference(map, 1, "A");
    expect(map[1]).toEqual({ referenceUid: "A", associatedUids: [] });
    expect(addPresetAssociated(map, 1, "A")).toBe(map);
    map = removePresetAssociated(addPresetAssociated(map, 1, "B"), 1, "B");
    expect(map[1]!.associatedUids).toEqual([]);
  });

  it("garbage in storage reads as empty", () => {
    store.set(PRESET_HEROES_KEY, "{not json");
    expect(loadPresetHeroes()).toEqual({});
  });
});
