// Compare two builds in the Optimizer: `compareBuilds` (per-axis values and
// deltas, the slots whose piece differs), the results table's row menu ("Pin
// for compare", its pinned state, the 📌 of the pinned row) and the Compare
// panel (two columns of tiles, differing slots highlighted, "vs loadout"),
// rendered server-side.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GearPiece } from "@gear-solver/core";
import { COMPARE_RATING_KEYS, compareBuilds, loadoutUidsOf, type CompareSide } from "../src/lib/solver/compareBuilds.js";
import { SOLVER_STATS, TABLE_RATINGS } from "../src/screens/builder/statColumns.js";
import { CellMenu, ResultRow, computeColumnRanges } from "../src/screens/builder/ResultsTable.js";
import { ComparePanel } from "../src/screens/builder/ComparePanel.js";
import type { FinalStats } from "../src/lib/composeBuild.js";
import type { CheapRatings } from "../src/lib/solver/ratings.js";
import type { SolveBuild } from "../src/lib/solver/types.js";

const piece = (uid: string, slot: string, equippedBy: string | null = null): GearPiece => ({
  uid, itemId: 0, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
  breakthrough: 4, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy, main: [], subs: [], gemSlots: [],
} as unknown as GearPiece);

const SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "ooparts"] as const;
// Hero "h" wears w0…t0 except the talisman (slot empty); w1 is a spare weapon.
const worn = SLOTS.filter((s) => s !== "ooparts").map((s) => piece(`${s}0`, s, "h"));
const spare = [piece("weapon1", "weapon"), piece("ooparts1", "ooparts")];
const pieceByUid = new Map([...worn, ...spare].map((p) => [p.uid, p]));

const stats = (atk: number, critRate = 50): FinalStats => ({
  atk, def: 1000, hp: 10000, spd: 150, critRate, critDmg: 200, critDmgReduce: 0, pen: 0, dmgUp: 0, dmgReduce: 0, eff: 0, effRes: 0,
}) as unknown as FinalStats;
const ratings = (dmg: number): CheapRatings => ({ hps: 1, ehp: 2, ehps: 3, dmg, dmgs: 5, mcd: 6, mcds: 7, dmgh: 8 });
const build = (uids: string[], atk: number, score: number, cp: number | null = null): SolveBuild => ({
  pieceUids: uids, gemAllocation: { talisman: [], ee: [] }, finalStats: stats(atk), ratings: ratings(atk * 2), score, cp, upg: 0,
});

const allWorn = [...worn.map((p) => p.uid), "ooparts1"];

describe("compareBuilds", () => {
  it("compares the table's axes: every solver stat in order, its ratings but CP", () => {
    const c = compareBuilds(build(allWorn, 1, 0), build(allWorn, 1, 0), pieceByUid);
    expect(c.stats.map((s) => s.key)).toEqual(SOLVER_STATS.map((s) => s.key));
    expect([...COMPARE_RATING_KEYS]).toEqual(TABLE_RATINGS.filter((r) => r.key !== "cp").map((r) => r.key));
  });

  it("two identical builds → no difference, zero deltas", () => {
    const a = build(allWorn, 3000, 200, 90000);
    const c = compareBuilds(a, { ...a }, pieceByUid);
    expect(c.differing).toBe(0);
    expect(c.slots.every((s) => !s.differs)).toBe(true);
    expect(c.stats.every((s) => s.delta === 0)).toBe(true);
    expect(c.score).toEqual({ key: "score", a: 200, b: 200, delta: 0 });
    expect(c.cp.delta).toBe(0);
  });

  it("one slot different → that slot only, deltas b − a", () => {
    const a = build(allWorn, 3000, 200, 90000);
    const b = build(allWorn.map((u) => (u === "weapon0" ? "weapon1" : u)), 3200, 215, null);
    const c = compareBuilds(a, b, pieceByUid);
    expect(c.differing).toBe(1);
    expect(c.slots.filter((s) => s.differs).map((s) => [s.slot, s.a?.uid, s.b?.uid])).toEqual([["weapon", "weapon0", "weapon1"]]);
    expect(c.stats.find((s) => s.key === "atk")).toEqual({ key: "atk", a: 3000, b: 3200, delta: 200 });
    expect(c.ratings.find((r) => r.key === "dmg")?.delta).toBe(400);
    expect(c.ratings.some((r) => r.key === "cp")).toBe(false); // CP has its own field
    expect(c.cp).toEqual({ key: "cp", a: 90000, b: null, delta: null }); // unknown → no Δ
    expect(c.slots.map((s) => s.slot)).toEqual([...SLOTS]);
  });

  it("vs loadout with an empty slot → that slot differs, unknown ratings stay null", () => {
    const loadoutUids = loadoutUidsOf("h", pieceByUid);
    expect(loadoutUids).toHaveLength(7);
    const loadout: CompareSide = { pieceUids: loadoutUids, finalStats: stats(2900), ratings: null, score: null, cp: null };
    const c = compareBuilds(build(allWorn, 3000, 200), loadout, pieceByUid);
    expect(c.differing).toBe(1);
    const tal = c.slots.find((s) => s.slot === "ooparts")!;
    expect(tal).toMatchObject({ differs: true, b: null });
    expect(tal.a?.uid).toBe("ooparts1");
    expect(c.ratings.every((r) => r.b === null && r.delta === null)).toBe(true);
    expect(c.score.delta).toBeNull();
  });

  it("crit reads the raw sum past the sheet's 100", () => {
    const a = { ...build(allWorn, 3000, 0), finalStats: { ...stats(3000, 100), critRateUncapped: 130 } as FinalStats };
    const b = { ...build(allWorn, 3000, 0), finalStats: stats(3000, 90) };
    expect(compareBuilds(a, b, pieceByUid).stats.find((s) => s.key === "critRate")).toEqual({ key: "critRate", a: 130, b: 90, delta: -40 });
  });
});

describe("results table — pin for compare", () => {
  const target = { x: 10, y: 10, index: 3, cell: { kind: "stat" as const, key: "atk", value: 3000, unit: "" } };
  const menu = (props: Partial<Parameters<typeof CellMenu>[0]>) =>
    renderToStaticMarkup(createElement(CellMenu, { target, onClose: () => {}, ...props }));

  it("the row menu carries the entry next to the thresholds", () => {
    const html = menu({ onPick: () => {}, onTogglePin: () => {} });
    expect(html).toContain("Min ≥ 3000");
    expect(html).toContain('role="menuitemcheckbox" aria-checked="false"');
    expect(html).toContain(">Pin for compare<");
  });

  it("pinned row → the entry unpins; a cell without value → pin only", () => {
    expect(menu({ pinned: true, onTogglePin: () => {} })).toContain('aria-checked="true"');
    expect(menu({ pinned: true, onTogglePin: () => {} })).toContain("Unpin compare");
    const rowOnly = menu({ target: { ...target, cell: null }, onPick: () => {}, onTogglePin: () => {} });
    expect(rowOnly).not.toContain("Min ≥");
    expect(rowOnly).toContain(">Pin for compare<");
    expect(menu({ onPick: () => {} })).not.toContain("Pin for compare");
  });

  it("the pinned row shows 📌 in its first cell", () => {
    const b = build(allWorn, 3000, 200);
    const row = (pinned: boolean) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null,
      createElement(ResultRow, {
        build: b, upg: 0, pinned, ranges: computeColumnRanges([b], []), statCols: [], ratingCols: [],
        showScore: false, showUpg: false, showWpn: false, showAcc: false, effects: undefined, setTags: undefined,
        index: 0, onSelect: () => {},
      }))));
    expect(row(true)).toMatch(/^<table><tbody><tr[^>]*><td[^>]*><span[^>]*><span[^>]*title="Pinned for compare"[^>]*>📌<\/span>/);
    expect(row(false)).not.toContain("📌");
  });
});

describe("Compare panel", () => {
  const pinned = build(allWorn, 3000, 200, 90000);
  const selected = build(allWorn.map((u) => (u === "weapon0" ? "weapon1" : u)), 3200, 215, 91000);
  const panel = (vsLoadout: boolean, compact = false) => {
    const other = vsLoadout
      ? { title: "Current loadout", side: { pieceUids: loadoutUidsOf("h", pieceByUid), finalStats: stats(2900), ratings: null, score: null, cp: 88000 }, swaps: 0 }
      : { title: "Selected #2", side: selected, swaps: 2 };
    return renderToStaticMarkup(createElement(ComparePanel, {
      pinned: { title: "Pinned #1", side: pinned, swaps: 1 }, other, vsLoadout, canPickSelected: true,
      pieceByUid, game: null, compact, onToggleVsLoadout: () => {}, onClose: () => {},
    }));
  };

  it("two columns, the differing slot highlighted, the others dimmed", () => {
    const html = panel(false);
    expect(html).toContain('data-compare-side="a"');
    expect(html).toContain('data-compare-side="b"');
    expect(html).toContain("📌 Pinned #1");
    expect(html).toContain("Selected #2");
    // One weapon tile per side differs; the 7 other slots ×2 are dimmed.
    expect(html.match(/data-slot="weapon" data-differs="true"/g)).toHaveLength(2);
    expect(html.match(/data-differs="true"/g)).toHaveLength(2);
    expect(html.match(/opacity-40/g)).toHaveLength(14);
    expect(html).toContain("1 piece differ, 2 swaps vs loadout");
    expect(html).toContain(">+200<"); // ATK Δ
    expect(html).toContain(">+1000<"); // CP Δ
    expect(html).toContain('aria-pressed="false"');
  });

  it("vs loadout: the loadout on the right, its empty talisman slot differs, the pinned build's swaps", () => {
    const html = panel(true);
    expect(html).toContain("Current loadout");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-slot="talisman" data-differs="true"');
    expect(html).toContain("1 piece differ, 1 swap vs loadout");
    expect(html).toContain(">-100<"); // ATK 3000 → 2900
  });

  it("compact setting → smaller tiles", () => {
    expect(panel(false, true)).toContain("width:36px");
    expect(panel(false, false)).toContain("width:48px");
  });
});
