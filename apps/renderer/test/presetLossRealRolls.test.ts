// The Presets loss in real rolls on both sides (`bestKnownFor`): a saved build
// is recomposed from its pieces as captured, with the gems it allocated
// (`gemAllocationOverride`), never read from its stored — projected —
// `finalStats`; a saved build missing a piece falls back to the current gear.
// And the gem pool ignores the in-game preset locks (`buildGemPool`): a lock
// holds pieces, not gems.
import { describe, expect, it } from "vitest";
import type { Character, GameData, GearPiece, Inventory, RolledStat, StatScaling } from "@gear-solver/core";
import { resolveStat } from "@gear-solver/core";
import {
  bestKnownFor, eeGemOverride, evaluatePresetFor, gemAllocationOverride, presetLoss, type HeroBase, type PresetEvalContext,
} from "../src/lib/presets/evaluate.js";
import { buildGemPool } from "../src/lib/solver/gems.js";
import type { FinalStatsBaseline, ScalingMap } from "../src/lib/composeBuild.js";
import type { SavedBuild } from "../src/lib/storage/savedBuilds.js";

// Gems: flat ATK, flat HP, ATK%.
const ATK_GEM = 9001, HP_GEM = 9002, ATKP_GEM = 9003;
const GAME = {
  options: {
    [ATK_GEM]: { st: "ST_ATK", ap: "OAT_ADD", v: 40 },
    [HP_GEM]: { st: "ST_HP", ap: "OAT_ADD", v: 500 },
    [ATKP_GEM]: { st: "ST_ATK", ap: "OAT_RATE", v: 50 },
  },
  sets: {},
} as unknown as GameData;

const atk = (value: number): RolledStat => ({ stat: "atk", value, percent: false, source: "option" });
const gemStat = (id: number) => resolveStat(id, 1, GAME.options)!;

function piece(slot: GearPiece["slot"], uid: string, equippedBy: string | null, main: RolledStat[] = [], gems?: number[]): GearPiece {
  // Socketed gems ARE the subs of a Talisman / EE (the parser's path).
  const subs = (gems ?? []).flatMap((id) => (id ? [{ ...gemStat(id), source: "option" }] : []));
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
    ascended: false, locked: false, equippedBy, main, subs,
    ...(gems ? { gemSlots: gems } : {}),
  } as GearPiece;
}

const TALISMAN_GEMS = [ATK_GEM, ATK_GEM, 0, 0];
const EE_GEMS = [HP_GEM, 0, 0, 0, 0];
// A wears w1, a1, the Talisman t1 and their EE; a weaker weapon lies free.
const GEAR: GearPiece[] = [
  piece("weapon", "w1", "A", [atk(300)]),
  piece("weapon", "wWeak", null, [atk(100)]),
  piece("armor", "a1", "A"),
  piece("ooparts", "t1", "A", [], TALISMAN_GEMS),
  piece("exclusive", "eeA", "A", [atk(50)], EE_GEMS),
];
const INVENTORY: Inventory = { gear: GEAR, characters: [{ uid: "A", charId: 1, name: "A" } as unknown as Character], presets: [] };

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
const HERO: HeroBase = {
  uid: "A", baseline: BASELINE, scaling: SCALING, dmgStat: "atk", noCrit: false, skillFactor: 1, turnFactor: 1, priority: { atk: 1, hp: 1 },
};

/** A saved build of A whose stored stats are deliberately wrong (ATK ×10, as
 *  far off as a projection can be) and its score a stale number. */
function saved(pieceUids: string[], gemAllocation = { talisman: TALISMAN_GEMS, ee: EE_GEMS }): SavedBuild {
  const wrong = evaluatePresetFor("A", [], ctx())!.finalStats;
  return {
    id: "s", name: "s", heroUid: "A", mode: "score", createdAt: 1,
    build: { pieceUids, gemAllocation, finalStats: { ...wrong, atk: wrong.atk * 10 }, ratings: {} as SavedBuild["build"]["ratings"], score: 99999, cp: null, upg: 0 },
    reforge: { reforgeMode: "ascended", priority: { atk: 1 } },
  };
}

function ctx(savedBuilds: PresetEvalContext["savedBuilds"] = {}): PresetEvalContext {
  return { inventory: INVENTORY, game: GAME, heroes: new Map([["A", HERO]]), savedBuilds };
}

const byUid = (...uids: string[]) => GEAR.filter((g) => uids.includes(g.uid));
const SAVED_UIDS = ["w1", "a1", "eeA", "t1"];

describe("Presets loss in real rolls on both sides", () => {
  it("(a) a preset made of the saved build's very pieces loses nothing, whatever the stored stats say", () => {
    const c = ctx({ A: [saved(SAVED_UIDS)] });
    const best = bestKnownFor("A", c)!;
    expect(best.source).toBe("saved");
    const preset = evaluatePresetFor("A", byUid("w1", "a1", "t1"), c)!;
    expect(Math.abs(presetLoss(preset.score, best.score)!)).toBeLessThan(1e-9);
    expect(best.finalStats.atk).toBeCloseTo(preset.finalStats.atk, 9);
  });

  it("(b) a preset swapping a piece for a weaker one loses", () => {
    const c = ctx({ A: [saved(SAVED_UIDS)] });
    const best = bestKnownFor("A", c)!;
    const preset = evaluatePresetFor("A", byUid("wWeak", "a1", "t1"), c)!;
    expect(presetLoss(preset.score, best.score)!).toBeGreaterThan(0);
  });

  it("(c) a saved build with a piece no longer in the inventory no longer counts", () => {
    const best = bestKnownFor("A", ctx({ A: [saved(["w1", "a1", "eeA", "soldTalisman"])] }))!;
    expect(best.source).toBe("current");
  });

  it("the saved build's allocated gems replace the socketed ones; an empty allocation keeps them", () => {
    const swapped = bestKnownFor("A", ctx({ A: [saved(SAVED_UIDS, { talisman: [ATKP_GEM, 0, 0, 0], ee: [0, 0, 0, 0, 0] })] }))!;
    const asSocketed = bestKnownFor("A", ctx())!;
    expect(swapped.finalStats.hp).toBeLessThan(asSocketed.finalStats.hp); // the EE's HP gem is gone
    const kept = bestKnownFor("A", ctx({ A: [saved(SAVED_UIDS, { talisman: [0, 0, 0, 0], ee: [0, 0, 0, 0, 0] })] }))!;
    expect(kept.source).toBe("saved");
    expect(kept.finalStats).toEqual(asSocketed.finalStats);
  });

  it("(d) gemAllocationOverride on a Talisman + EE: the allocated gems replace the socketed ones in the buckets", () => {
    const pieces = byUid("t1", "eeA");
    const out = gemAllocationOverride(pieces, { talisman: [ATKP_GEM, 0, 0, 0], ee: [HP_GEM, HP_GEM, 0, 0, 0] }, GAME);
    const atkp = gemStat(ATKP_GEM), hp = gemStat(HP_GEM);
    expect(out.pct).toEqual({ [atkp.stat]: atkp.value });
    expect(out.flat).toEqual({ [hp.stat]: 2 * hp.value }); // the Talisman's socketed ATK gems are gone
    // A slot left out keeps its socketed gems — `eeGemOverride` is the EE-only case.
    expect(eeGemOverride(pieces, [HP_GEM], GAME)).toEqual(gemAllocationOverride(pieces, { ee: [HP_GEM] }, GAME));
    expect(gemAllocationOverride(pieces, { ee: [] }, GAME).flat).toEqual({ [gemStat(ATK_GEM).stat]: 2 * gemStat(ATK_GEM).value });
  });

  it("(e) buildGemPool ignores preset locks: a locked preset's Talisman gems are in the hero's pool", () => {
    const inv = { gear: [piece("ooparts", "tLocked", null, [], [ATKP_GEM]), piece("ooparts", "tFree", null, [], [HP_GEM])], characters: [], presets: [] } as unknown as Inventory;
    const opts = { heroUid: "H", equippedScope: "all" as const, heroPriority: {}, excludedHeroes: new Set<string>() };
    // @ts-expect-error — `presetBlocked` is no gem-pool option any more (a lock holds pieces, not gems).
    const pool = buildGemPool(inv, { ...opts, presetBlocked: new Set(["tLocked"]) });
    expect([...pool.keys()].sort((a, b) => a - b)).toEqual([HP_GEM, ATKP_GEM]);
  });
});
