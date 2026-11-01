// Preset quality (six pieces' ticks vs 6 × 23) and +15 grades by slot — the
// summary lines under a preset card's pieces (lib/presets/presetQuality.ts).
import { describe, expect, it } from "vitest";
import type { GearPiece, GearSlot, RolledStat } from "@gear-solver/core";
import { PRESET_QUALITY_MAX, presetQuality, presetRolls } from "../src/lib/presets/presetQuality.js";
import type { PresetPiece } from "../src/lib/presets/presetRows.js";

const sub = (ticks: number): RolledStat => ({ stat: "atkPct", value: 4 * ticks, percent: true, ticks, reforgeTicks: 0 });

const singularity = (desc: string, name: string): RolledStat => ({
  stat: "atkPct", value: 0, percent: true, source: "singularity", name, desc,
});

const piece = (slot: GearSlot, reforgeCount: number, ticks: number[], main: RolledStat[] = []): GearPiece => ({
  uid: `p-${slot}`, itemId: 1, slot, setId: null, armorSetId: null,
  rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount, enhanceLevel: 10, singularityLevel: 0,
  ascended: main.length > 0, locked: false, equippedBy: null, main, subs: ticks.map(sub),
});

const row = (p: GearPiece | null, slot: GearSlot | null = p?.slot ?? null): PresetPiece => ({
  slot, uid: p?.uid ?? "gone", piece: p, missing: p == null, sharedWith: [],
});

// Ticks 4 + 4 + 3 + 3 = 14 on every piece except the boots (2 + 2 + 2 + 2 = 8).
const six = (): PresetPiece[] => [
  row(piece("weapon", 9, [4, 4, 3, 3])),
  row(piece("accessory", 6, [4, 4, 3, 3])),
  row(piece("helmet", 0, [4, 4, 3, 3])),
  row(piece("armor", 3, [4, 4, 3, 3])),
  row(piece("gloves", 6, [4, 4, 3, 3])),
  row(piece("boots", 1, [2, 2, 2, 2])),
];

describe("presetQuality", () => {
  it("is out of 6 × 23", () => {
    expect(PRESET_QUALITY_MAX).toBe(138);
  });

  it("sums the six pieces' ticks and their caps for the current investment", () => {
    // investedMax: (14 + 9) + (14 + 6) + 14 + (14 + 3) + (14 + 6) + (14 + 1).
    expect(presetQuality(six())).toEqual({ current: 5 * 14 + 8, max: 138, investedMax: 6 * 14 + 25, counted: 6 });
  });

  it("counts a missing piece or an empty slot as 0", () => {
    const rows = six();
    rows[3] = row(null, "armor");
    rows.splice(5, 1);
    expect(presetQuality(rows)).toEqual({ current: 4 * 14, max: 138, investedMax: 4 * 14 + 21, counted: 4 });
  });

  it("leaves out a talisman or an EE slipped into the list", () => {
    const rows = [...six(), row(piece("ooparts", 0, [6, 6, 6, 6])), row(piece("exclusive", 0, [6, 6, 6, 6]))];
    expect(presetQuality(rows)).toEqual(presetQuality(six()));
  });

  it("is empty without a scored piece", () => {
    expect(presetQuality([])).toEqual({ current: 0, max: 138, investedMax: 0, counted: 0 });
  });
});

describe("presetRolls", () => {
  it("lists weapon / accessory then helmet / armor / gloves / boots, with grade, color and name", () => {
    const rows = six();
    rows[0] = row(piece("weapon", 9, [4, 4, 3, 3], [singularity("<color=#ff0>S+</color> DMG dealt +12%", "DMG Increase to target")]));
    rows[4] = row(piece("gloves", 6, [4, 4, 3, 3], [singularity("<color=#b266ff>B</color> DMG taken -5%", "Reduced DMG Taken")]));
    const { offensive, defensive } = presetRolls(rows);
    expect(offensive).toEqual([
      { slot: "weapon", grade: "S+", color: "#ff0", name: "DMG Increase to target" },
      { slot: "accessory", grade: null, color: null, name: null },
    ]);
    expect(defensive.map((r) => r.slot)).toEqual(["helmet", "armor", "gloves", "boots"]);
    expect(defensive[2]).toEqual({ slot: "gloves", grade: "B", color: "#b266ff", name: "Reduced DMG Taken" });
  });

  it("gives null for a non-ascended piece and for an absent slot", () => {
    const rows = six().filter((r) => r.slot !== "boots");
    const { defensive } = presetRolls(rows);
    expect(defensive[0]).toEqual({ slot: "helmet", grade: null, color: null, name: null });
    expect(defensive[3]).toEqual({ slot: "boots", grade: null, color: null, name: null });
  });
});
