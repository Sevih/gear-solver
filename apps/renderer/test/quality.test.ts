/// <reference types="node" />
// Gear quality — one rule (`qualityScore`, lib/quality.ts) read by the solver's
// quality filter (`gearPieceQualityTier`), the Inventory filters and both detail
// panels (`UiPiece.quality`, precomputed by `toUiPiece`). The equality block
// replays the three former copies (GearDetail / ResultGearDetail `computeQuality`
// on a UiPiece, `gearPieceQualityTier` on a GearPiece) against every item of
// `data/derived/equipment.json` so the merge provably changed nothing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EquipmentTable, GearPiece, GearSlot, RolledStat } from "@gear-solver/core";
import { toUiPiece, type UiPiece } from "../src/design/adapter.js";
import { gearPieceQuality, gearPieceQualityTier, qualityScore, qualityTierFromScore, type QualityTier } from "../src/lib/quality.js";

const equipment = JSON.parse(
  readFileSync(new URL("../../../data/derived/equipment.json", import.meta.url), "utf8"),
) as EquipmentTable;

const sub = (ticks: number, reforgeTicks = 0): RolledStat => ({ stat: "atkPct", value: 4 * ticks, percent: true, ticks, reforgeTicks });

const piece = (slot: GearSlot | null, star: number | null, reforgeCount: number, ticks: number[], itemId = 1): GearPiece => ({
  uid: `p-${itemId}-${reforgeCount}-${ticks.join("")}`, itemId, slot, setId: null, armorSetId: null,
  rarity: "unique", star, name: "", classLimit: null,
  breakthrough: 0, reforgeCount, enhanceLevel: 10, singularityLevel: 0,
  ascended: false, locked: false, equippedBy: null, main: [], subs: ticks.map((t) => sub(t)),
});

// Former copies, verbatim apart from their names.
function legacyUiQuality(piece: UiPiece): { current: number; max: number; pct: number; tier: QualityTier } | null {
  if (piece.slot === "talisman" || piece.slot === "exclusive") return null;
  if (piece.subs.length === 0 || piece.stars <= 0) return null;
  const current = piece.subs.reduce((sum, s) => sum + s.lv, 0);
  const max = 14 + piece.reforge.n;
  const pct = Math.min(100, Math.round((current / max) * 100));
  const tier = qualityTierFromScore(current, max);
  return { current, max, pct, tier };
}
function legacyGearPieceQualityTier(p: GearPiece): QualityTier | null {
  if (p.slot === "ooparts" || p.slot === "exclusive") return null;
  if (p.subs.length === 0 || (p.star ?? 0) <= 0) return null;
  const current = p.subs.reduce((sum, s) => sum + (s.ticks ?? 0), 0);
  return qualityTierFromScore(current, 14 + p.reforgeCount);
}

describe("qualityScore — the rule", () => {
  it("talisman / EE have no quality score", () => {
    expect(qualityScore("ooparts", 6, 0, [4, 4, 3, 3])).toBeNull();
    expect(qualityScore("exclusive", 6, 0, [4, 4, 3, 3])).toBeNull();
  });

  it("a piece without subs, or without a star tier, has none either", () => {
    expect(qualityScore("helmet", 6, 0, [])).toBeNull();
    expect(qualityScore("helmet", 0, 0, [4, 4, 3, 3])).toBeNull();
    expect(qualityScore("helmet", null, 0, [4, 4, 3, 3])).toBeNull();
  });

  it("cap 14 + 1 per spent reforge, tiers at 50 / 70 / 85 / 100 %", () => {
    expect(qualityScore("weapon", 6, 0, [4, 4, 3, 3])).toEqual({ current: 14, max: 14, pct: 100, tier: "perfect" });
    expect(qualityScore("weapon", 6, 0, [4, 3, 3, 2])?.tier).toBe("excellent"); // 12/14 = 86 %
    expect(qualityScore("weapon", 6, 0, [3, 3, 2, 2])?.tier).toBe("good");      // 10/14 = 71 %
    expect(qualityScore("weapon", 6, 0, [2, 2, 2, 1])?.tier).toBe("decent");    //  7/14 = 50 %
    expect(qualityScore("weapon", 6, 0, [2, 2, 1, 1])?.tier).toBe("poor");      //  6/14 = 43 %
    expect(qualityScore("boots", 6, 6, [6, 5, 5, 4])).toEqual({ current: 20, max: 20, pct: 100, tier: "perfect" });
    expect(qualityScore("boots", 6, 6, [4, 4, 3, 3])?.tier).toBe("good");      // 14/20 = 70 %
  });

  it("gearPieceQualityTier keeps its signature and reads the same rule", () => {
    const p = piece("gloves", 6, 3, [5, 4, 4, 2]);
    expect(gearPieceQuality(p)).toEqual(qualityScore("gloves", 6, 3, [5, 4, 4, 2]));
    expect(gearPieceQualityTier(p)).toBe("excellent"); // 15/17 = 88 %
    expect(gearPieceQualityTier(piece("ooparts", 6, 0, [4, 4, 3, 3]))).toBeNull();
  });
});

describe("reachable — the score with the Transistone potential", () => {
  it("qualityScore: set only with a gain, max / pct / tier stay the current rolls'", () => {
    expect(qualityScore("weapon", 6, 0, [3, 3, 3, 2])).not.toHaveProperty("reachable");
    expect(qualityScore("weapon", 6, 0, [3, 3, 3, 2], 2)).toEqual({ current: 11, max: 14, pct: 79, tier: "good", reachable: 13 });
  });

  it("gearPieceQuality: a 3/3/3/2 6★ Legendary reaches 13/14; 4/3/3/3 and the native 4/4/3/3 have nothing to reach", () => {
    expect(gearPieceQuality(piece("helmet", 6, 0, [3, 3, 3, 2]))?.reachable).toBe(13); // best line: the 2 → 4
    expect(gearPieceQuality(piece("helmet", 6, 0, [3, 3, 3, 3]))?.reachable).toBe(13);
    expect(gearPieceQuality(piece("helmet", 6, 0, [4, 3, 3, 3]))).not.toHaveProperty("reachable");
    expect(gearPieceQuality(piece("helmet", 6, 0, [4, 4, 3, 3]))).not.toHaveProperty("reachable");
  });

  it("only on a 6★ Legendary", () => {
    expect(gearPieceQuality(piece("helmet", 5, 0, [3, 3, 3, 2]))).not.toHaveProperty("reachable");
    expect(gearPieceQuality({ ...piece("helmet", 6, 0, [3, 3, 3, 2]), rarity: "rare" })).not.toHaveProperty("reachable");
  });

  it("reforge ticks are kept on top of the raised base, under the LV6 cap", () => {
    // Bases 1/3/3/3 with 5 reforges on the 1 (LV6): that line can't climb, the
    // others gain +1 → 15 + 1 = 16 of 19.
    const g: GearPiece = { ...piece("boots", 6, 5, []), subs: [sub(6, 5), sub(3), sub(3), sub(3)] };
    expect(gearPieceQuality(g)).toEqual({ current: 15, max: 19, pct: 79, tier: "good", reachable: 16 });
  });
});

describe("toUiPiece — precomputed quality and search text", () => {
  it("quality is the rule's score; searchText is the lower-cased haystack", () => {
    const g: GearPiece = {
      ...piece("ooparts", 6, 0, []),
      name: " Gaze of the Abyss ",
      main: [{ stat: "atkPct", value: 60, percent: true, source: "option" }],
    };
    const ui = toUiPiece(g);
    expect(ui.quality).toBeNull();
    expect(ui.searchText).toBe("gaze of the abyss talisman legendary atk% 60% ");
    const armor = toUiPiece({ ...piece("armor", 6, 2, [4, 4, 3, 3]), name: "Tough Armor" });
    expect(armor.quality).toEqual({ current: 14, max: 16, pct: 88, tier: "excellent" });
    expect(armor.searchText).toBe("tough armor armor legendary  atkpct atkpct atkpct atkpct");
  });
});

describe("the three former quality paths agree with the merged one", () => {
  // Deterministic spread of tick layouts / reforge counts: 0..4 subs, 1..6
  // ticks each, 0..9 reforges.
  const layouts: Array<{ ticks: number[]; reforges: number }> = [];
  for (let n = 0; n <= 4; n++) {
    for (let r = 0; r <= 9; r += 3) {
      layouts.push({ ticks: Array.from({ length: n }, (_, i) => 1 + ((i * 2 + r + n) % 6)), reforges: r });
    }
  }

  it("on every item of data/derived/equipment.json", () => {
    let scored = 0;
    for (const [id, meta] of Object.entries(equipment)) {
      for (const { ticks, reforges } of layouts) {
        const g = piece(meta.slot as GearSlot, meta.star ?? null, reforges, ticks, Number(id));
        const ui = toUiPiece(g);
        const legacyUi = legacyUiQuality(ui);
        expect(ui.quality).toEqual(legacyUi);
        expect(gearPieceQualityTier(g)).toBe(legacyGearPieceQualityTier(g));
        expect(legacyGearPieceQualityTier(g)).toBe(legacyUi?.tier ?? null);
        if (ui.quality) scored++;
      }
    }
    expect(scored).toBeGreaterThan(1000);
  }, 30_000); // 5 s is too short on the Windows CI runner (the whole table, ~5 s there)

  it("on a hand-built 6★ ascended piece with reforge ticks", () => {
    const g: GearPiece = {
      ...piece("accessory", 6, 9, []),
      ascended: true,
      subs: [sub(6, 2), sub(6, 3), sub(5, 2), sub(4, 1)],
    };
    const ui = toUiPiece(g);
    expect(ui.quality).toEqual(legacyUiQuality(ui));
    expect(ui.quality).toEqual({ current: 21, max: 23, pct: 91, tier: "excellent" });
    expect(gearPieceQualityTier(g)).toBe(legacyGearPieceQualityTier(g));
  });
});
