import { describe, it, expect } from "vitest";
import { parseInventory, projectMainToCeiling, scaleMain } from "../src/parse.js";
import type { EnhanceData, GameData, OptionsTable } from "../src/gamedata.js";
import type { RawUserItem } from "../src/raw.js";
import optionsJson from "../../../data/derived/options.json";
import enhanceJson from "../../../data/derived/enhance.json";

// Main stats against the client's float32 chain (`CItem.InitializeOptionData`,
// `CItemMainOption.get_OptionValue`), on the committed contract.
const options = optionsJson as unknown as OptionsTable;
const enhance = enhanceJson as unknown as EnhanceData;

// Reference: outerpedia `src/lib/damage/item.ts`, copied as-is (0 mismatch
// against the client) — `sumFactorsF32` + `itemMainOptionValue`.
const f32 = Math.fround;
function sumFactorsF32(factors: readonly number[]): number {
  let sum = 0;
  for (const f of factors) sum = f32(sum + f32(f));
  return sum;
}
function itemMainOptionValue(optionValue: number, enchantFactor: number, breakLimitFactor = 0, singularityFactor = 0): number {
  let t = f32(f32(enchantFactor) + 1);
  t = f32(t + f32(singularityFactor));
  t = f32(t * f32(optionValue));
  t = f32(t * f32(f32(breakLimitFactor) + 1));
  return Math.trunc(t);
}
/** Client factor lists for one state: ItemEnchantTemplet levels 1..lv, the
 *  break-limit tiers 1..tier, singularity activation + steps reached. */
function gameValue(v: number, lv: number, tier: number, ascended: boolean, sing: number): number {
  const enchant = Array.from({ length: ascended ? enhance.maxEnhanceLevel : lv }, () => enhance.enhanceFactor);
  const breakLimit = Array.from({ length: tier }, () => enhance.tierFactor);
  const singularity = ascended ? [enhance.singularity.activation, ...enhance.singularity.steps.slice(0, sing)] : [];
  return itemMainOptionValue(v, sumFactorsF32(enchant), sumFactorsF32(breakLimit), sumFactorsF32(singularity));
}

describe("scaleMain — float32 like the client", () => {
  // States where the former double + epsilon formula read 1 too high.
  it.each([
    [60, 0, 1, 62],
    [90, 4, 0, 233],
    [100, 6, 1, 356],
    [120, 0, 1, 125],
  ])("OptionValue %i, +%i, tier %i → %i", (v, lv, tier, expected) => {
    expect(scaleMain(v, false, "weapon", lv, tier, false, 0, enhance)).toBe(expected);
    // A percent main truncates the same ‰ value, then shows it ÷10.
    expect(scaleMain(v, true, "weapon", lv, tier, false, 0, enhance)).toBe(expected / 10);
  });

  it("every IOT_STAT OptionValue × +0..+10 (and +10 ascended, singularity 0..5) × tier 0..4 matches the client", () => {
    const values = [...new Set(Object.values(options).flatMap((d) => ("st" in d && d.v > 0 ? [d.v] : [])))];
    expect(values.length).toBeGreaterThan(50);
    const states: Array<[number, boolean, number]> = [];
    for (let lv = 0; lv <= 10; lv++) states.push([lv, false, 0]);
    for (let sing = 0; sing <= 5; sing++) states.push([10, true, sing]);
    const mismatches: string[] = [];
    let n = 0;
    for (const v of values) for (const [lv, asc, sing] of states) for (let tier = 0; tier <= 4; tier++) {
      n++;
      const want = gameValue(v, lv, tier, asc, sing);
      const got = scaleMain(v, false, "weapon", asc ? 10 + sing : lv, tier, asc, sing, enhance);
      if (got !== want) mismatches.push(`v=${v} lv=${lv}${asc ? ` asc sing=${sing}` : ""} tier=${tier}: ${got} ≠ ${want}`);
    }
    expect(n).toBe(values.length * 17 * 5);
    expect(mismatches).toEqual([]);
  });

  it("Talisman (ooparts) mains don't scale", () => {
    expect(scaleMain(120, true, "ooparts", 10, 4, false, 0, enhance)).toBe(12);
  });
});

describe("projectMainToCeiling — re-scales from the exact +0 value", () => {
  // One flat ATK main (OptionValue 60) on a 6★ weapon, at +0 tier 1 (game: 62)
  // and at +10 tier 1.
  const game = {
    options: { "24": { st: "ST_ATK", ap: "OAT_ADD", v: 60 } },
    equipment: { "754": { slot: "weapon", grade: "unique", star: 6, classLimit: null, setId: "5", armorSetId: null, name: "W" } },
    enhance: { ...enhance, expCurves: { "weapon|unique|6": [0, 450, 1050, 1850, 2900, 4300, 6200, 8800, 12400, 17500, 25000] } },
    buffs: {}, singularityOptions: {}, eePassives: {}, characters: {},
  } as unknown as GameData;
  const item = (uid: string, exp: number) => ({
    ItemUID: uid, ItemID: 754, Exp: exp, BreakLimitLevel: 1, SmeltingCount: 0, SingularityStep: 0, SingularityLevel: 0,
    SingularityOptionID: 0, IsLock: 0, CharUID: "0", OptionList: [24], SubOptionList: [],
  });
  const inv = parseInventory({ ItemList: [item("p0", 0), item("p10", 25000)] } as unknown as RawUserItem, undefined, game);
  const [p0, p10] = inv.gear;
  const CLASSIC = { enhanceLevel: 10, ascended: false, singularityLevel: 0 };

  it("the +0 piece projected to +10 reads what the parser gives a real +10 piece", () => {
    expect(p0!.main[0]).toMatchObject({ value: 62, rawBase: 60 });
    expect(p10!.enhanceLevel).toBe(10);
    const projected = projectMainToCeiling(p0!, game, CLASSIC);
    expect(projected.main[0]!.value).toBe(p10!.main[0]!.value);
    expect(projected.main[0]!.value).toBe(gameValue(60, 10, 1, false, 0));
  });

  it("without `rawBase` it falls back to the multiplier ratio", () => {
    const { rawBase: _raw, ...main } = p0!.main[0]!;
    const projected = projectMainToCeiling({ ...p0!, main: [main] }, game, CLASSIC);
    // 62 / 1.05 × 5.25 = 310 — the truncation at +0 isn't undone.
    expect(projected.main[0]!.value).toBe(310);
  });
});
