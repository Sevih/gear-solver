/// <reference types="node" />
// "Min ≥ / Max ≤" from a result cell keeps the row it was read on — on the real
// engine (`precomputeContext` → `solveChunk` → `finalizeBuilds` → the
// orchestrator's merge) and the real contract (`data/derived/`). The bound set
// is the menu's (`cellThresholdBound`: the printed value, else the next one at
// the same precision on the row's side) and the re-solve pins the row's pieces
// through the prunes (`pinPieceUids`): at Top % < 100 a Min re-splits the
// budget (`keepTopUnion` halves the objective's slice for the bound's floor
// scorer) and cut a piece of the row.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import {
  collapseTalismanVariants, compareBuilds, finalizeBuilds, precomputeContext, solveChunk, TALISMAN_VARIANTS_KEPT,
} from "../src/lib/solver/engine.js";
import type { SolveBuild, SolveFilters, SolveMode, SolveRequest } from "../src/lib/solver/types.js";
import { cellThresholdBound } from "../src/screens/builder/ResultsTable.js";

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

/** Deterministic PRNG (mulberry32) — the inventory is the same at every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBS: Array<{ stat: RolledStat["stat"]; percent: boolean; lo: number; hi: number }> = [
  { stat: "atk", percent: false, lo: 20, hi: 160 },
  { stat: "atkPct", percent: true, lo: 2, hi: 18 },
  { stat: "critRate", percent: true, lo: 2, hi: 14 },
  { stat: "critDmg", percent: true, lo: 3, hi: 22 },
  { stat: "spd", percent: false, lo: 2, hi: 12 },
  { stat: "hp", percent: false, lo: 60, hi: 600 },
  { stat: "def", percent: false, lo: 10, hi: 90 },
  { stat: "pen", percent: true, lo: 1, hi: 8 },
];
const MAINS: Record<string, RolledStat[]> = {
  weapon: [{ stat: "atk", value: 480, percent: false }],
  helmet: [{ stat: "hp", value: 2400, percent: false }],
  armor: [{ stat: "def", value: 300, percent: false }],
  gloves: [{ stat: "critRate", value: 24, percent: true }],
  boots: [{ stat: "spd", value: 40, percent: false }],
  accessory: [{ stat: "atkPct", value: 30, percent: true }],
  ooparts: [{ stat: "atk", value: 300, percent: false }],
};
// Lv6 gems: ATK% / DEF% / HP% / CHC / CHD / DMG+.
const GEMS = [15046, 15047, 15048, 15049, 15050, 15053];
const SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "ooparts"];

/** 5 pieces per slot, 4 random subs each (Talismans: 5 random gems), the
 *  first of each slot worn by the hero (2000001, an ATK scaler). */
function inventory(): Inventory {
  const r = rng(7);
  const gear: GearPiece[] = [];
  for (const slot of SLOTS) {
    for (let i = 0; i < 5; i++) {
      const subs: RolledStat[] = [];
      for (const s of [...SUBS].sort(() => r() - 0.5).slice(0, 4)) {
        const v = s.lo + (s.hi - s.lo) * r();
        subs.push({ stat: s.stat, value: s.percent ? Math.round(v * 10) / 10 : Math.round(v), percent: s.percent, ticks: 1 } as RolledStat);
      }
      const gems = slot === "ooparts" ? Array.from({ length: 5 }, () => GEMS[Math.floor(r() * GEMS.length)]!) : [];
      gear.push({
        uid: `${slot}${i}`, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: `${slot}${i}`,
        classLimit: null, breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false,
        locked: false, equippedBy: i === 0 ? "H" : null, main: MAINS[slot]!, subs: slot === "ooparts" ? [] : subs, gemSlots: gems,
      } as unknown as GearPiece);
    }
  }
  const hero = {
    uid: "H", charId: 2000001, name: "H", stars: 9, locked: false, exp: 1e12, levelMaxStep: 0, trustExp: 0,
    skills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 }, fusionCharId: 0, fusionLevel: 0,
  };
  return { characters: [hero], gear, presets: [] } as unknown as Inventory;
}
const INV = inventory();

const TOP = 200;
/** One solve as the orchestrator runs it, on one chunk: precompute, search,
 *  finalize, then the merge (sort, talisman-variant collapse, top-N). */
async function solve(mode: SolveMode, filters: Partial<SolveFilters>, pinPieceUids?: readonly string[]): Promise<SolveBuild[]> {
  const base: SolveFilters = {
    options: { onlyMaxed: false, reforgeMode: "disable", equippedScope: "all", keepCurrent: false, allowBrokenSets: true },
    excludedHeroes: [], statFilters: {}, ratingFilters: {}, priority: {}, topPct: 100, mainPicks: {},
    setPlans: [], excludedSets: [], weaponEffectPicks: {}, accessoryEffectPicks: {}, minQuality: null,
  };
  const req: SolveRequest = {
    type: "solve", solveId: 1, mode, heroUid: "H", game: GAME, inventory: INV,
    userGeasLevels: null, userCodexLevel: null, heroPriority: {}, userSkills: { first: 5, second: 5, ultimate: 5, chainPassive: 5 },
    topK: TOP, chunkIndex: 0, chunkCount: 1, filters: { ...base, ...filters },
    ...(pinPieceUids ? { pinPieceUids: [...pinPieceUids] } : {}),
  };
  const ctx = { req, ...precomputeContext(req) };
  const { builds } = await solveChunk(ctx, 0, 1, TOP);
  const merged = finalizeBuilds(ctx, builds, mode).sort((a, b) => compareBuilds(a, b, mode));
  return collapseTalismanVariants(merged, TALISMAN_VARIANTS_KEPT).slice(0, TOP);
}

type Col = { kind: "stat" | "rating"; key: string };
// A flat stat, a % stat, the crit (the sheet's, bounded at 100, as the cell
// and the engine's bound read it), a rating and the CP.
const COLS: Col[] = [
  { kind: "stat", key: "atk" }, { kind: "stat", key: "critDmg" }, { kind: "stat", key: "critRate" },
  { kind: "rating", key: "dmg" }, { kind: "rating", key: "cp" },
];
/** The cell's raw value, as `ResultRow` hands it to the menu. */
const cellOf = (b: SolveBuild, c: Col): number =>
  c.kind === "stat" ? (b.finalStats as unknown as Record<string, number>)[c.key]!
    : c.key === "cp" ? b.cp! : (b.ratings as unknown as Record<string, number>)[c.key]!;
const sig = (b: SolveBuild): string => b.pieceUids.join(",");
/** `filters` with the cell's bound set as the reducer does (the other bound stays). */
function withBound(filters: Partial<SolveFilters>, c: Col, bound: "min" | "max", value: number): Partial<SolveFilters> {
  const field = c.kind === "stat" ? "statFilters" : "ratingFilters";
  const bands = { ...(filters[field] ?? {}) };
  bands[c.key] = { ...(bands[c.key] ?? {}), [bound]: value };
  return { ...filters, [field]: bands };
}

const PRIORITY = { atk: 2, critDmg: 2, critRate: 1, spd: 1 };
// Top % 0.2 prunes these 5-piece pools to 4-5 per slot (budget 53 k for
// 78 k combos) — the ratio of a real account at the default Top % 60.
const CASES: Array<[string, SolveMode, Partial<SolveFilters>]> = [
  ["SOLVE, Top % 100", "score", { priority: PRIORITY }],
  ["SOLVE CP, Top % 100", "cp", {}],
  ["SOLVE, pruned", "score", { priority: PRIORITY, topPct: 0.2 }],
  ["SOLVE CP, pruned", "cp", { topPct: 0.2 }],
];

describe("a cell's Min ≥ / Max ≤ keeps its row in the re-solve (real engine)", () => {
  it("the bound is the printed value when it keeps the row, else the next one on the row's side", () => {
    expect(cellThresholdBound(1234.6, "min")).toBe(1234);
    expect(cellThresholdBound(1234.6, "max")).toBe(1235);
    expect(cellThresholdBound(1234.4, "max")).toBe(1235);
    expect(cellThresholdBound(1234.4, "min")).toBe(1234);
    expect(cellThresholdBound(54.26, "min")).toBe(54.2);
    expect(cellThresholdBound(54.26, "max")).toBe(54.3);
    expect(cellThresholdBound(54.24, "max")).toBe(54.3);
    expect(cellThresholdBound(99.96, "min")).toBe(99.9);
    expect(cellThresholdBound(3553, "min")).toBe(3553);
    expect(cellThresholdBound(82.3, "max")).toBe(82.3);
  });

  for (const [label, mode, start] of CASES) {
    it(`${label}: Min then Max on rows 2, 8 and 41 × ATK, CHD, CHC, Dmg, CP`, async () => {
      const first = await solve(mode, start);
      expect(first.length).toBe(TOP);
      const lost: string[] = [];
      for (const idx of [1, 7, 40]) {
        const row = first[idx]!;
        for (const c of COLS) {
          // Min ≥ from the first table's row…
          const withMin = withBound(start, c, "min", cellThresholdBound(cellOf(row, c), "min"));
          const second = await solve(mode, withMin, row.pieceUids);
          const again = second.find((b) => sig(b) === sig(row));
          if (!again) { lost.push(`row ${idx + 1} ${c.key} min → ${second.length} results`); continue; }
          // …then Max ≤ from the same row in the new table (the Min stays).
          const withBoth = withBound(withMin, c, "max", cellThresholdBound(cellOf(again, c), "max"));
          const third = await solve(mode, withBoth, again.pieceUids);
          if (!third.some((b) => sig(b) === sig(row))) lost.push(`row ${idx + 1} ${c.key} min+max → ${third.length} results`);
          // Max ≤ alone, from the first table.
          const withMax = withBound(start, c, "max", cellThresholdBound(cellOf(row, c), "max"));
          const fourth = await solve(mode, withMax, row.pieceUids);
          if (!fourth.some((b) => sig(b) === sig(row))) lost.push(`row ${idx + 1} ${c.key} max → ${fourth.length} results`);
        }
      }
      expect(lost).toEqual([]);
    }, 120_000);
  }
});
