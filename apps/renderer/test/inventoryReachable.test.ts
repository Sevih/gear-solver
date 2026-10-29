// Inventory Reachable quality filter (screens/inventory/filters.ts): the tier a
// piece would reach with the Transistone potential (`QualityScore.reachable`),
// its current tier without one, null without a quality score.
import { describe, expect, it } from "vitest";
import type { GearPiece, GearSlot } from "@gear-solver/core";
import { toUiPiece } from "../src/design/adapter.js";
import {
  FILTER_CODEC, activeFilterCount, emptyFilters, matchesFilters, reachableTier, type FilterState,
} from "../src/screens/inventory/filters.js";
import type { QualityTier } from "../src/lib/quality.js";

const piece = (slot: GearSlot, star: number, ticks: number[]): GearPiece => ({
  uid: `p-${slot}-${ticks.join("")}`, itemId: 1, slot, setId: null, armorSetId: null,
  rarity: "unique", star, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: null, main: [],
  subs: ticks.map((t) => ({ stat: "atkPct", value: 4 * t, percent: true, ticks: t, reforgeTicks: 0 })),
});
const withQ = (key: "quality" | "reachable", tiers: QualityTier[]): FilterState =>
  ({ ...emptyFilters(), [key]: new Set(tiers) });

describe("reachableTier", () => {
  it("a 6★ Legendary good piece whose best line can go to stage 4 reaches excellent", () => {
    const p = toUiPiece(piece("helmet", 6, [3, 3, 3, 2])); // 11/14 good, reachable 13/14 = 93 %
    expect(p.quality?.tier).toBe("good");
    expect(reachableTier(p)).toBe("excellent");
  });

  it("a piece without potential reads its current tier, a talisman reads null", () => {
    expect(reachableTier(toUiPiece(piece("helmet", 6, [4, 3, 3, 3])))).toBe("excellent"); // line at stage 4 already
    expect(reachableTier(toUiPiece(piece("helmet", 5, [3, 3, 3, 2])))).toBe("good"); // 5★: no Transistone
    expect(reachableTier(toUiPiece(piece("ooparts", 6, [])))).toBeNull();
  });
});

describe("matchesFilters — Reachable quality", () => {
  it("keeps the good piece with reachable = {excellent}, Quality = {excellent} rejects it", () => {
    const p = toUiPiece(piece("helmet", 6, [3, 3, 3, 2]));
    expect(matchesFilters(p, withQ("reachable", ["excellent"]))).toBe(true);
    expect(matchesFilters(p, withQ("quality", ["excellent"]))).toBe(false);
    expect(matchesFilters(p, withQ("reachable", ["good"]))).toBe(false);
  });

  it("OR across tiers; a talisman never passes", () => {
    const f = withQ("reachable", ["good", "excellent"]);
    expect(matchesFilters(toUiPiece(piece("helmet", 5, [3, 3, 3, 2])), f)).toBe(true);
    expect(matchesFilters(toUiPiece(piece("ooparts", 6, [])), withQ("reachable", ["poor"]))).toBe(false);
  });
});

describe("Reachable quality — codec and badge", () => {
  it("survives the codec round-trip (the Set must be in the codec's list)", () => {
    const back = FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(withQ("reachable", ["excellent", "perfect"])));
    expect(back.reachable).toBeInstanceOf(Set);
    expect([...back.reachable].sort()).toEqual(["excellent", "perfect"]);
  });

  it("an older stored filter without the field reads empty; activeFilterCount counts it", () => {
    const { reachable: _drop, ...old } = emptyFilters();
    void _drop;
    expect(FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(old as FilterState)).reachable.size).toBe(0);
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount(withQ("reachable", ["excellent"]))).toBe(1);
  });
});
