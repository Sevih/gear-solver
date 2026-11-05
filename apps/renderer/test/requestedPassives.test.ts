/// <reference types="node" />
// Requested +15 passives counted on the sheet, on the real contract
// (`data/derived/`): a piece whose conditional passive (vs an element, within
// Dimensional Singularity…) is `required` in its group enters the pool as a
// clone whose `singularity` main is `combatOnly: false`, so its DMG+ / DMG-
// lands in the build's `dmgUp` / `dmgReduce`. Off and excluded families count
// nothing; an unconditional family is on the sheet either way. Also the
// results table's "+15" marker (`countedPassivesOfBuild`) and the family table
// itself: every family resolves to `dmgUp` or `dmgReduce`.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { resolveOption } from "@gear-solver/core";
import { computeFinalStats } from "../src/lib/composeBuild.js";
import { precomputeContext } from "../src/lib/solver/engine.js";
import type { SolveBuild, SolveFilters, SolveRequest } from "../src/lib/solver/types.js";
import { countedPassivesOfBuild, countedPassivesTitle, passiveOf } from "../src/lib/singularityPassives.js";
import { ResultRow, computeColumnRanges } from "../src/screens/builder/ResultsTable.js";
import { SOLVER_STATS, TABLE_RATINGS } from "../src/screens/builder/statColumns.js";

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
const UNCOND = "DMG Increase to target";
const VS_FIRE_RED = "Reduced DMG Taken vs Fire";

/** The `singularity` main entry exactly as `parseInventory` builds it. */
function singularityMain(optId: string): RolledStat {
  const opt = GAME.singularityOptions[optId]!;
  return { ...resolveOption(opt, 1)!, fromBuff: true, source: "singularity", name: opt.name ?? null, desc: opt.desc ?? null, combatOnly: opt.combatOnly } as RolledStat;
}

function piece(uid: string, slot: string, optId: string): GearPiece {
  return {
    uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 4, reforgeCount: 9, enhanceLevel: 15, singularityLevel: 5, ascended: true, locked: false,
    equippedBy: null, subs: [], gemSlots: [], main: [singularityMain(optId)],
  } as unknown as GearPiece;
}

function precompute(gear: GearPiece[], passivePicks: SolveFilters["passivePicks"], onlyMaxed = false) {
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  const filters: SolveFilters = {
    options: { onlyMaxed, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
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

/** The build sheet of the pooled pieces, the way `solveChunk` composes it. */
function sheet(ctx: ReturnType<typeof precompute>, pieces: GearPiece[]) {
  return computeFinalStats(ctx.baseline, ctx.scaling, pieces, GAME);
}

// 300137 = DS DMG+ grade A (v 1200 → +120 %), 300116 = DMG Increase to target
// grade A (unconditional, +35 %), 310023 = vs Fire DMG- (armor).
const dsA = () => piece("dsA", "weapon", "300137");

describe("requested +15 passives — counted on the sheet", () => {
  it("required DS DMG+ → the pooled weapon is a clone with its passive on, dmgUp + 120", () => {
    const w = dsA();
    const off = precompute([w], undefined);
    const req = precompute([w], { weapon: { [DS]: { state: "required", minGrade: "A" } } });
    const pooled = req.pools.weapon[0]!;
    expect(pooled).not.toBe(w);
    expect(pooled.main[0]!.combatOnly).toBe(false);
    expect(w.main[0]!.combatOnly).toBe(true); // the inventory piece untouched
    expect(off.pools.weapon[0]).toBe(w);
    expect(sheet(req, req.pools.weapon).dmgUp - sheet(off, off.pools.weapon).dmgUp).toBe(120);
  });

  it("the same family off or excluded counts nothing", () => {
    const w = dsA();
    const off = precompute([w], { weapon: {} });
    expect(off.pools.weapon[0]).toBe(w);
    // Excluded: the piece is dropped (G114), nothing reaches the sheet.
    const excl = precompute([w, piece("u", "weapon", "300116")], { weapon: { [DS]: { state: "excluded", minGrade: "C" } } });
    expect(excl.pools.weapon.map((g) => g.uid)).toEqual(["u"]);
    expect(excl.pools.weapon[0]!.main[0]!.combatOnly).toBe(false);
  });

  it("an unconditional family is on the sheet with or without the pick (never cloned)", () => {
    const u = piece("u", "weapon", "300116");
    const none = precompute([u], undefined);
    const req = precompute([u], { weapon: { [UNCOND]: { state: "required", minGrade: "C" } } });
    expect(req.pools.weapon[0]).toBe(u);
    expect(sheet(req, req.pools.weapon).dmgUp).toBe(sheet(none, none.pools.weapon).dmgUp);
    expect(sheet(none, none.pools.weapon).dmgUp - sheet(none, []).dmgUp).toBe(35);
  });

  it("armor: a required vs Fire DMG- lands in dmgReduce, also under Only maxed", () => {
    const h = piece("h", "helmet", "310023");
    const value = singularityMain("310023").value;
    for (const onlyMaxed of [false, true]) {
      const off = precompute([h], undefined, onlyMaxed);
      const req = precompute([h], { armor: { [VS_FIRE_RED]: { state: "required", minGrade: "C" } } }, onlyMaxed);
      expect(sheet(req, req.pools.helmet).dmgReduce - sheet(off, off.pools.helmet).dmgReduce).toBeCloseTo(value, 6);
    }
  });

  it("the table: every family resolves to dmgUp or dmgReduce", () => {
    const byFamily = new Map<string, string>();
    for (const opt of Object.values(GAME.singularityOptions)) {
      const r = resolveOption(opt, 1)!;
      byFamily.set(passiveOf(opt)!.family, r.stat);
    }
    expect(byFamily.size).toBe(15);
    for (const [family, stat] of byFamily) {
      expect(stat, family).toBe(/Reduced/i.test(family) ? "dmgReduce" : "dmgUp");
    }
  });
});

describe("results table — the \"+15\" marker", () => {
  const w = dsA();
  const h = piece("h", "helmet", "310023");
  const picks = { weapon: { [DS]: { state: "required" as const, minGrade: "A" as const } }, accessory: {}, armor: {} };

  it("lists the counted passives of a build's pieces, by column", () => {
    const list = countedPassivesOfBuild([w, h, undefined], picks);
    expect(list).toEqual([{ stat: "dmgUp", value: 120, family: DS, grade: "A" }]);
    expect(countedPassivesTitle(list)).toBe("+120% DS DMG+ (A)");
    expect(countedPassivesOfBuild([w], { weapon: { [DS]: { state: "excluded", minGrade: "A" } } })).toEqual([]);
    expect(countedPassivesOfBuild([w], undefined)).toEqual([]);
  });

  it("renders \"+15\" in the DMG UP% cell with the passives as its title", () => {
    const dmgCols = SOLVER_STATS.filter((s) => s.key === "dmgUp" || s.key === "dmgReduce");
    const build = {
      pieceUids: ["dsA"], gemAllocation: { talisman: [], ee: [] }, score: 0, cp: null, upg: 0,
      finalStats: { dmgUp: 120, dmgReduce: 0 }, ratings: {},
    } as unknown as SolveBuild;
    const row = (passives?: Parameters<typeof ResultRow>[0]["passives"]) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null,
      createElement(ResultRow, {
        build, upg: 0, ranges: computeColumnRanges([build], dmgCols), statCols: dmgCols, ratingCols: TABLE_RATINGS.slice(0, 0),
        showScore: false, showUpg: false, showWpn: false, showAcc: false, effects: undefined, setTags: undefined,
        index: 0, onSelect: () => {}, passives,
      }))));
    const marked = row({ dmgUp: countedPassivesOfBuild([w], picks) });
    expect(marked).toContain('title="+120% DS DMG+ (A)"');
    expect(marked).toMatch(/120%<sup[^>]*text-cyan-300[^>]*>\+15<\/sup>/);
    expect(marked.match(/\+15<\/sup>/g)).toHaveLength(1); // DMG RED% unmarked
    expect(row(undefined)).not.toContain("+15</sup>");
  });
});
