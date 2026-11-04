// Gear › Scrap's filter rules (lib/inventory/scrapRules.ts): the union of
// the rules (`matchesAnyRule`), their session codec (`RULES_CODEC`: an array,
// the one-filter object format, the default when empty), the chip label
// (`ruleLabel`) and the pure list updates.
import { beforeEach, describe, expect, it } from "vitest";
import { parseGearPiece, type RawItem } from "@gear-solver/core";
import { toUiPiece, type UiPiece } from "../src/design/adapter.js";
import { FILTER_CODEC, emptyFilters, matchesFilters, type FilterState } from "../src/screens/inventory/filters.js";
import { SCRAP_CANDIDATES } from "../src/lib/storage/inventoryFilterPresets.js";
import { RULES_CODEC, addRule, clampRuleIndex, matchesAnyRule, removeRule, ruleLabel, setRule } from "../src/lib/inventory/scrapRules.js";

// RULES_CODEC's default reads the Scrap default: an empty localStorage → the built-in.
beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {} };
});

/** A wire item whose sub lines carry these base stages (BaseLevel = stage - 1). */
const item = (stages: number[]): RawItem => ({
  ItemUID: "1", CharUID: "0", ItemID: 0, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0,
  SelectSubOptionNum: 0, SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [],
  SubOptionList: stages.map((st, i) => ({ OptionID: 160001 + i, BaseLevel: st - 1, Level: st - 1 })),
} as RawItem);
const piece = (stars: number, stages: number[]): UiPiece => ({
  ...toUiPiece(parseGearPiece(item(stages))),
  slot: "helmet", stars, enhance: 0, bt: 0, reforge: { n: 0, max: 5 }, status: "free",
});

// The two rules of the request: 6★ that lack three lines at base 3+, and every 5★.
const sixNot333: FilterState = { ...emptyFilters(), stars: new Set([6]), baseRolls: { op: "gte", lines: [3, 3, 3, null], not: true } };
const five: FilterState = { ...emptyFilters(), stars: new Set([5]) };

describe("matchesAnyRule", () => {
  it("shows a piece passing either rule, hides one passing neither", () => {
    const rules = [sixNot333, five];
    expect(matchesAnyRule(piece(6, [3, 3, 2]), rules)).toBe(true);
    expect(matchesAnyRule(piece(5, [2, 2, 1]), rules)).toBe(true);
    expect(matchesAnyRule(piece(5, [4, 4, 4, 4]), rules)).toBe(true);
    expect(matchesAnyRule(piece(6, [3, 3, 3]), rules)).toBe(false);
    expect(matchesAnyRule(piece(6, [4, 4, 4, 4]), rules)).toBe(false);
  });

  it("one rule is matchesFilters", () => {
    for (const p of [piece(6, [3, 3, 2]), piece(6, [3, 3, 3]), piece(5, [2, 2, 1])]) {
      expect(matchesAnyRule(p, [sixNot333])).toBe(matchesFilters(p, sixNot333));
    }
  });
});

describe("RULES_CODEC", () => {
  it("round-trips an array, Sets included", () => {
    const rules = [sixNot333, { ...five, query: "ring", subMode: "and" as const }];
    const back = RULES_CODEC.deserialize(RULES_CODEC.serialize(rules));
    expect(back).toEqual(rules);
    expect(back[0]!.stars).toBeInstanceOf(Set);
  });

  it("reads a single object (the one-filter format) as one rule", () => {
    expect(RULES_CODEC.deserialize(FILTER_CODEC.serialize!(five))).toEqual([five]);
  });

  it("empty, unreadable or holding no object → the default rules", () => {
    for (const raw of ["", "{", "[]", "[1, null]", "42"]) {
      expect(RULES_CODEC.deserialize(raw), raw).toEqual([SCRAP_CANDIDATES.filters()]);
    }
  });
});

describe("ruleLabel", () => {
  it("names only what is active, in order", () => {
    expect(ruleLabel(SCRAP_CANDIDATES.filters())).toBe("5★ 6★ · not ≥ 3/3/3/X · unequipped · +0 · T0 · not reforged");
    expect(ruleLabel(emptyFilters())).toBe("All pieces");
    expect(ruleLabel(five)).toBe("5★");
  });

  it("one stat by name, several by count, the search last", () => {
    const f: FilterState = {
      ...emptyFilters(),
      rarities: new Set(["legendary", "epic"]),
      quality: new Set(["good", "poor"]),
      mains: new Set(["atkPct"]),
      subs: new Set(["atkPct", "spd"]),
      armorSets: new Set(["7", "12"]),
      baseRolls: { op: "lt", lines: [2, null, null, null], not: false },
      singularityOnly: true,
      query: " ring ",
    };
    expect(ruleLabel(f)).toBe('Epic Legendary · Q: Poor Good · ATK% · 2 subs · 2 sets · < 2/X/X/X · singularity · "ring"');
  });
});

describe("rule list updates", () => {
  it("setRule replaces one rule, addRule appends", () => {
    const rules = [sixNot333, five];
    expect(setRule(rules, 1, emptyFilters())).toEqual([sixNot333, emptyFilters()]);
    expect(setRule(rules, 5, emptyFilters())).toBe(rules);
    expect(addRule(rules, emptyFilters())).toEqual([sixNot333, five, emptyFilters()]);
    expect(rules).toHaveLength(2);
  });

  it("removeRule never leaves the list empty", () => {
    expect(removeRule([sixNot333, five], 0)).toEqual([five]);
    expect(removeRule([five], 0)).toEqual([emptyFilters()]);
  });

  it("the active index is held within the list", () => {
    expect(clampRuleIndex(3, 2)).toBe(1);
    expect(clampRuleIndex(-1, 2)).toBe(0);
    expect(clampRuleIndex("x", 2)).toBe(0);
    expect(clampRuleIndex(1, 2)).toBe(1);
  });
});
