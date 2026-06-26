/**
 * CP-weighted auto-prune support — `keepTopPct` (the generic top-% selector the
 * SOLVE-CP-without-priority path uses) plus the CP scoring it's fed. These lock:
 *  - keepTopPct keeps the top ceil(N × pct/100) by score, with a ≥1 floor;
 *  - required-set members survive even when they score below the cut (so a
 *    `req` plan can't be silently starved of pieces);
 *  - the engine's actual scorer — `cpEval(computeFinalStats(...))` — ranks a
 *    stronger piece above a weaker one, so the prune keeps the high-CP gear.
 *
 * The gating (mode === "cp" && no priority && topPct < 100, talisman/EE + locked
 * slots exempt) lives in `precomputeContext` and is covered by the documented
 * behavior; here we pin the selection + the scoring the engine composes.
 */
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece, RolledStat, StatScaling } from "@gear-solver/core";
import { allocateComboBudget, keepTopN, keepTopPct } from "../src/lib/solver/engine.js";
import { computeFinalStats, type FinalStatsBaseline, type ScalingMap } from "../src/lib/composeBuild.js";
import { makeCpEvaluator } from "../src/lib/solver/cp.js";

const GAME = { options: {}, equipment: {}, sets: {}, equipmentPassives: {}, multiTierPassives: {},
  gems: {}, singularityOptions: {}, eePassives: {}, characters: {},
  enhance: { enhanceFactor: 0, tierFactor: 0, maxEnhanceLevel: 15, singularity: { activation: 0, steps: [] }, expCurves: {} },
  buffs: {}, expCharacter: [], charLevelMax: {}, codexCurve: [], archiveBonus: [],
  trustCharacter: [], trustBuffs: [] } as unknown as GameData;

const sc = (baseValue: number): StatScaling => ({
  baseValue, evoValue: 0, awakValue: 0, awakPct: 0, transcendPct: 0, codexPct: 0, buffPct: 0, buffValue: 0,
});
const SCALING: ScalingMap = { atk: sc(1200), def: sc(600), hp: sc(6000), eff: sc(100), res: sc(100) };
const BASELINE: FinalStatsBaseline = { spd: 100, chc: 5, chd: 50, pen: 0, dmgInc: 0, dmgRed: 0 };

const cpEval = makeCpEvaluator({
  showUIStar: 5, starPlus: 1, fused: false, ee: null,
  skills: { first: 1, second: 1, ultimate: 1, chainPassive: 1 },
});
/** Mirror of the engine's CP-proxy scorer (others = [] for an isolated slot). */
const cpScore = (others: GearPiece[]) => (p: GearPiece): number =>
  cpEval(computeFinalStats(BASELINE, SCALING, others.concat(p), GAME), null);

const flatSub = (stat: string, value: number): RolledStat =>
  ({ stat, value, percent: false, ticks: 1 } as unknown as RolledStat);

function piece(uid: string, opts: { armorSetId?: string | null; subs?: RolledStat[] } = {}): GearPiece {
  return {
    uid, itemId: 1, slot: "armor", setId: null, armorSetId: opts.armorSetId ?? null,
    rarity: "epic", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null,
    main: [], subs: opts.subs ?? [],
  } as unknown as GearPiece;
}

const NO_REQ = new Set<string>();

describe("keepTopPct", () => {
  it("keeps the top ceil(N × pct/100) by score", () => {
    // Scores 1..4 via a trivial scorer; keep top 50% of 4 → 2 highest.
    const score = (p: GearPiece) => Number(p.uid);
    const pool = [piece("1"), piece("4"), piece("2"), piece("3")];
    const out = keepTopPct(pool, score, 50, NO_REQ);
    expect(out.map((p) => p.uid).sort()).toEqual(["3", "4"]);
  });

  it("floors the kept count at 1 even for a tiny pct", () => {
    const score = (p: GearPiece) => Number(p.uid);
    const out = keepTopPct([piece("1"), piece("9"), piece("5")], score, 5, NO_REQ);
    expect(out.map((p) => p.uid)).toEqual(["9"]);
  });

  it("returns the pool untouched when empty", () => {
    expect(keepTopPct([], () => 0, 30, NO_REQ)).toEqual([]);
  });

  it("preserves required-set members that score below the cut", () => {
    const score = (p: GearPiece) => Number(p.uid);
    // keep top 1 of 3 → "9"; "1" is in the required set and must survive too.
    const reqLow = piece("1", { armorSetId: "Rage" });
    const out = keepTopPct([reqLow, piece("9"), piece("5")], score, 33, new Set(["Rage"]));
    const uids = out.map((p) => p.uid).sort();
    expect(uids).toContain("1"); // preserved despite low score
    expect(uids).toContain("9"); // the top-% winner
    expect(uids).not.toContain("5"); // neither top-% nor required
  });
});

describe("keepTopN", () => {
  it("keeps the top n by score, clamped to the pool length", () => {
    const score = (p: GearPiece) => Number(p.uid);
    const pool = [piece("1"), piece("4"), piece("2"), piece("3")];
    expect(keepTopN(pool, score, 2, NO_REQ).map((p) => p.uid).sort()).toEqual(["3", "4"]);
    // n > length keeps everything; n < 1 floors at 1.
    expect(keepTopN(pool, score, 99, NO_REQ)).toHaveLength(4);
    expect(keepTopN(pool, score, 0, NO_REQ).map((p) => p.uid)).toEqual(["4"]);
  });

  it("preserves required-set members below the cut", () => {
    const score = (p: GearPiece) => Number(p.uid);
    const reqLow = piece("1", { armorSetId: "Rage" });
    const out = keepTopN([reqLow, piece("9"), piece("5")], score, 1, new Set(["Rage"]));
    expect(out.map((p) => p.uid).sort()).toEqual(["1", "9"]);
  });
});

describe("allocateComboBudget", () => {
  it("keeps the product within budget", () => {
    const counts = [12, 44, 50, 62, 45, 17]; // the real-account pools
    const keep = allocateComboBudget(counts, 8_000_000);
    const product = keep.reduce((a, b) => a * b, 1);
    expect(product).toBeLessThanOrEqual(8_000_000);
    // Every slot keeps ≥1 and never more than it has.
    keep.forEach((k, i) => {
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(counts[i]!);
    });
  });

  it("keeps small slots whole and only trims the big ones", () => {
    // Tight budget: the two small slots fit whole (3×4=12), the 200-pool gets
    // the rest and is trimmed so the product stays within budget.
    const keep = allocateComboBudget([3, 4, 200], 120);
    expect(keep[0]).toBe(3);
    expect(keep[1]).toBe(4);
    expect(keep[2]).toBeLessThan(200);
    expect(keep.reduce((a, b) => a * b, 1)).toBeLessThanOrEqual(120);
  });

  it("returns counts aligned to the input order (not the sorted order)", () => {
    const keep = allocateComboBudget([100, 2, 100], 400);
    expect(keep[1]).toBe(2); // the small middle slot stays whole in place
    expect(keep).toHaveLength(3);
  });
});

describe("CP scorer drives the prune toward high-CP gear", () => {
  it("ranks a stronger piece above a weaker one (same slot)", () => {
    const strong = piece("strong", { subs: [flatSub("atk", 400), flatSub("critRate", 8), flatSub("critDmg", 30)] });
    const weak = piece("weak", { subs: [flatSub("def", 40)] });
    const score = cpScore([]);
    expect(score(strong)).toBeGreaterThan(score(weak));
  });

  it("keeps the high-CP piece and drops the low-CP one on a 50% cut", () => {
    const strong = piece("strong", { subs: [flatSub("atk", 400), flatSub("critDmg", 30)] });
    const weak = piece("weak", { subs: [flatSub("def", 20)] });
    const out = keepTopPct([weak, strong], cpScore([]), 50, NO_REQ);
    expect(out.map((p) => p.uid)).toEqual(["strong"]);
  });
});
