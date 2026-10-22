/// <reference types="node" />
// Presets tab, the tuning side — the EE gems proposed to each hero of a preset
// (`bestEeGemsFor`, pieces fixed, on the real gem table of `data/derived/`),
// the worklist entry "+ Worklist" queues (`presetWorklistFor`), the priority
// that survives a relaunch (`presetPriorityOf`) and `gs.presetHeroes` in the
// backup (`buildBackup` / `applyBackup`).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Character, GameData, GearPiece, Inventory, Preset, RolledStat, StatScaling } from "@gear-solver/core";
import { resolveStat } from "@gear-solver/core";
import { alignToSockets, bestEeGemsFor } from "../src/lib/presets/eeGems.js";
import { evaluatePresetFor, presetPriorityOf, type HeroBase, type PresetEvalContext } from "../src/lib/presets/evaluate.js";
import { presetRows } from "../src/lib/presets/presetRows.js";
import { presetWorklistFor } from "../src/lib/presets/presetWorklist.js";
import type { FinalStatsBaseline, ScalingMap } from "../src/lib/composeBuild.js";
import { upsertWorklistEntry, type WorklistEntry } from "../src/lib/storage/worklist.js";
import { applyBackup, buildBackup } from "../src/lib/storage/transfer.js";
import { PRESET_HEROES_KEY } from "../src/lib/storage/presetHeroes.js";
import type { SavedBuild } from "../src/lib/storage/savedBuilds.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));

const GAME = {
  options: derived("options.json"), equipment: {}, sets: {}, gems: derived("gems.json"), enhance: derived("enhance.json"),
} as unknown as GameData;

// Lv6 gems: ATK% / HP% / CHC / CHD / DMG+ ; lv5 ATK%.
const ATK6 = 15046, HP6 = 15048, CRC6 = 15049, CHD6 = 15050, DMGUP6 = 15053, ATK5 = 15037;

const atk = (value: number): RolledStat => ({ stat: "atk", value, percent: false, source: "option" });

function piece(slot: GearPiece["slot"], uid: string, equippedBy: string | null, main: RolledStat[] = [], gems?: number[]): GearPiece {
  // Socketed gems ARE the subs of a Talisman / EE (the parser's path).
  const subs = (gems ?? []).flatMap((id) => {
    const r = id ? resolveStat(id, 1, GAME.options) : null;
    return r ? [{ ...r, source: "option" }] : [];
  });
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
    ascended: false, locked: false, equippedBy, main, subs,
    ...(gems ? { gemSlots: gems } : {}),
  } as GearPiece;
}

const hero = (uid: string): Character => ({ uid, charId: 1, name: uid } as unknown as Character);
const preset = (num: number, itemUids: string[]): Preset => ({ num, name: `P${num}`, itemUids, favorite: false });
const five = (id: number) => [id, id, id, id, id];

// A wears preset 1 (w1, a1, Talisman t1 with DMG+ gems). B wears its own
// outfit (Talisman t2 with lv5 ATK% gems) and an EE full of HP% gems. C wears
// an EE of CHC gems. A free Talisman holds 2 ATK% + 1 CHD.
const GEAR: GearPiece[] = [
  piece("weapon", "w1", "A", [atk(300)]),
  piece("armor", "a1", "A"),
  piece("ooparts", "t1", "A", [], five(DMGUP6)),
  piece("exclusive", "eeA", "A", [], five(0)),
  piece("weapon", "w2", "B", [atk(500)]),
  piece("armor", "a2", "B"),
  piece("ooparts", "t2", "B", [], five(ATK5)),
  piece("exclusive", "eeB", "B", [atk(80)], five(HP6)),
  piece("exclusive", "eeC", "C", [], five(CRC6)),
  piece("ooparts", "tFree", null, [], [ATK6, ATK6, CHD6, 0, 0]),
];

// Preset 1 also lists a helmet the inventory no longer holds.
const INVENTORY: Inventory = {
  gear: GEAR,
  characters: [hero("A"), hero("B"), hero("C")],
  presets: [preset(1, ["w1", "0", "999", "a1", "0", "0", "0", "t1"])],
};

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };
// Every stat the off-limits gems carry is wanted — they'd be picked if offered.
const PRIORITY = { atk: 1, dmgUp: 1, critRate: 1 };

function base(uid: string, priority: Record<string, number> | null = PRIORITY): HeroBase {
  return { uid, baseline: BASELINE, scaling: SCALING, dmgStat: "atk", noCrit: false, skillFactor: 1, turnFactor: 1, priority };
}

function ctxWith(heroes: HeroBase[]): PresetEvalContext {
  return { inventory: INVENTORY, game: GAME, heroes: new Map(heroes.map((h) => [h.uid, h])), savedBuilds: {} };
}

const row = () => presetRows(INVENTORY)[0]!;

describe("bestEeGemsFor", () => {
  it("never proposes the preset's Talisman gems, another hero's EE gems or the hero's own Talisman gems", () => {
    const gems = bestEeGemsFor("B", row().presentPieces, ctxWith([base("B")]))!;
    expect(gems.ee).toHaveLength(5);
    expect(gems.ee).not.toContain(DMGUP6); // t1, in the preset
    expect(gems.ee).not.toContain(CRC6); // eeC, worn by C
    expect(gems.ee).not.toContain(ATK5); // t2, B's own Talisman
    // The free Talisman's ATK% take two sockets, B's HP% gems that stay keep theirs.
    expect(gems.ee.filter((id) => id === ATK6)).toHaveLength(2);
    expect(gems.ee.slice(0, 2)).toEqual([HP6, HP6]);
    // The preset's Talisman stays off limits when nobody wears it.
    const inv: Inventory = { ...INVENTORY, gear: GEAR.map((g) => (g.uid === "t1" ? { ...g, equippedBy: null } : g)) };
    const free = bestEeGemsFor("B", presetRows(inv)[0]!.presentPieces, { ...ctxWith([base("B")]), inventory: inv })!;
    expect(free.ee).not.toContain(DMGUP6);
  });

  it("no priority → no proposal", () => {
    expect(bestEeGemsFor("B", row().presentPieces, ctxWith([base("B", null)]))).toBeNull();
  });

  it("scores higher with the proposed gems than as socketed", () => {
    const ctx = ctxWith([base("B")]);
    const gems = bestEeGemsFor("B", row().presentPieces, ctx)!;
    const asSocketed = evaluatePresetFor("B", row().presentPieces, ctx)!.score!;
    const withGems = evaluatePresetFor("B", row().presentPieces, ctx, gems.ee)!.score!;
    expect(withGems).toBeGreaterThan(asSocketed);
  });

  it("the gems as socketed, passed as `eeGems`, compose like the EE itself", () => {
    const ctx = ctxWith([base("B")]);
    const plain = evaluatePresetFor("B", row().presentPieces, ctx)!;
    const same = evaluatePresetFor("B", row().presentPieces, ctx, five(HP6))!;
    for (const k of ["atk", "hp", "dmgUp", "critDmg"] as const) expect(same.finalStats[k]).toBeCloseTo(plain.finalStats[k], 6);
  });

  it("no proposal when the EE already holds the best of what is on offer", () => {
    // Without the free Talisman, B's own HP% gems are all there is: same gems back.
    const inv: Inventory = { ...INVENTORY, gear: GEAR.filter((g) => g.uid !== "tFree") };
    const ctx = { ...ctxWith([base("B"), base("A")]), inventory: inv };
    expect(bestEeGemsFor("B", presetRows(inv)[0]!.presentPieces, ctx)).toBeNull();
    // A's EE is empty and nothing is free: nothing to socket.
    expect(bestEeGemsFor("A", presetRows(inv)[0]!.presentPieces, ctx)).toBeNull();
  });

  it("alignToSockets keeps a gem in its socket and never empties one", () => {
    expect(alignToSockets([ATK6, ATK6, CHD6, HP6, HP6], five(HP6))).toEqual([HP6, HP6, ATK6, ATK6, CHD6]);
    expect(alignToSockets([ATK6, 0, 0, 0, 0], [HP6, CHD6, 0, 0, 0])).toEqual([ATK6, CHD6, 0, 0, 0]);
  });
});

describe("presetWorklistFor", () => {
  const ctx = ctxWith([base("B")]);
  const gems = bestEeGemsFor("B", row().presentPieces, ctx)!;
  const queued = presetWorklistFor("B", row(), gems, INVENTORY, GAME);

  it("the preset's pieces the hero doesn't wear, then the EE gem lines; the missing piece left out", () => {
    const pieces = queued.changes.filter((c) => c.kind !== "gem");
    expect(pieces.map((c) => [c.slot, c.toUid, c.fromUid])).toEqual([
      ["weapon", "w1", "w2"], ["armor", "a1", "a2"], ["ooparts", "t1", "t2"],
    ]);
    expect(queued.upg).toBe(3);
    expect(queued.missing).toBe(1);
    expect(queued.changes.some((c) => c.toUid === "999")).toBe(false);
    const gemLines = queued.changes.filter((c) => c.kind === "gem");
    // Only the sockets that change, all on B's EE — never a Talisman line.
    expect(gemLines.map((c) => [c.slot, c.toUid, c.gemIndex])).toEqual([
      ["exclusive", "eeB", 2], ["exclusive", "eeB", 3], ["exclusive", "eeB", 4],
    ]);
    expect(gemLines.map((c) => c.kind === "gem" && c.toGem.id)).toEqual(gems.ee.slice(2));
  });

  it("the wearer with nothing to tune queues nothing", () => {
    expect(presetWorklistFor("A", row(), null, INVENTORY, GAME).changes).toEqual([]);
  });

  it("replaces the hero's existing entry", () => {
    const entry = (id: string, mode: WorklistEntry["mode"]): WorklistEntry => ({
      id, heroUid: "B", heroName: "B", charId: 1, mode, cp: null, upg: queued.upg, changes: queued.changes, createdAt: 0,
    });
    const other = { ...entry("o", "score"), heroUid: "C" };
    const list = upsertWorklistEntry([entry("old", "score"), other], entry("new", "preset"));
    expect(list.map((e) => [e.id, e.mode])).toEqual([["new", "preset"], ["o", "score"]]);
  });
});

describe("presetPriorityOf", () => {
  const saved = (id: string, createdAt: number, priority: Record<string, number>): SavedBuild => ({
    id, name: id, heroUid: "B", mode: "score", createdAt,
    build: {} as SavedBuild["build"], reforge: { reforgeMode: "disable", priority },
  });
  const builds = { B: [saved("old", 1, { hp: 1 }), saved("new", 2, { def: 2 })] };

  it("session first, then the most recent saved build, then null", () => {
    const session: Record<string, Record<string, number>> = { A: { atk: 3 }, B: { atk: 0 } };
    const of = presetPriorityOf((uid) => session[uid], builds);
    expect(of("A")).toEqual({ priority: { atk: 3 }, source: "session" });
    // B's session priority carries no weight — the saved build's is read.
    expect(of("B")).toEqual({ priority: { def: 2 }, source: "saved" });
    expect(of("C")).toBeNull();
  });
});

describe("gs.presetHeroes in the backup", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    } as Storage;
  });

  it("round-trips, a local preset entry winning over the imported one", () => {
    store.set(PRESET_HEROES_KEY, JSON.stringify({ 1: { referenceUid: "A", associatedUids: ["B"] } }));
    const bundle = buildBackup(0);
    expect(bundle.presetHeroes).toEqual({ 1: { referenceUid: "A", associatedUids: ["B"] } });

    store.set(PRESET_HEROES_KEY, JSON.stringify({
      1: { referenceUid: "C", associatedUids: [] },
      3: { referenceUid: null, associatedUids: [] },
    }));
    bundle.presetHeroes = { ...bundle.presetHeroes, 2: { referenceUid: null, associatedUids: ["C"] }, 3: { referenceUid: "B", associatedUids: [] } };
    const res = applyBackup(bundle);
    expect(res.presetGroups).toBe(2);
    expect(JSON.parse(store.get(PRESET_HEROES_KEY)!)).toEqual({
      1: { referenceUid: "C", associatedUids: [] }, // local kept
      2: { referenceUid: null, associatedUids: ["C"] }, // new preset
      3: { referenceUid: "B", associatedUids: [] }, // local was empty
    });
  });

  it("a backup made before the field imports without it", () => {
    const res = applyBackup({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {} });
    expect(res.presetGroups).toBe(0);
    expect(store.has(PRESET_HEROES_KEY)).toBe(false);
  });
});
