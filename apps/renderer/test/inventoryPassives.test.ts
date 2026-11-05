/// <reference types="node" />
// Gear › Filter's "+15 passive" section (screens/inventory/filters.ts): OR on
// the Singularity families, with one minimum grade for the section; a piece
// below +15 has no passive and fails an active selection; no pill = inactive,
// grade included. Plus the session codec and the active-filter count.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGearPiece, type GameData, type RawItem } from "@gear-solver/core";
import { toUiPiece, type UiPiece } from "../src/design/adapter.js";
import { FILTER_CODEC, activeFilterCount, emptyFilters, matchesFilters, type FilterState } from "../src/screens/inventory/filters.js";

const TABLE = JSON.parse(readFileSync(new URL("../../../data/derived/singularity-options.json", import.meta.url), "utf8")) as GameData["singularityOptions"];
const DS = "Increased DMG within Dimensional Singularity";

const base = toUiPiece(parseGearPiece({
  ItemUID: "1", CharUID: "0", ItemID: 0, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0,
  SelectSubOptionNum: 0, SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [], SubOptionList: [],
} as unknown as RawItem));
/** A UI piece carrying singularity option `id` (none when null). */
const withPassive = (id: string | null): UiPiece => {
  const opt = id ? TABLE[id]! : null;
  return { ...base, effects: opt ? [{ stat: "dmgUp", value: "120%", percent: true, name: opt.name, desc: opt.desc, combatOnly: true }] : [] };
};
const f = (passives: string[], passiveMinGrade: FilterState["passiveMinGrade"] = "C"): FilterState =>
  ({ ...emptyFilters(), passives: new Set(passives), passiveMinGrade });

describe("matchesFilters — +15 passive", () => {
  const dsA = withPassive("300137");
  const dsB = withPassive("300132");
  const none = withPassive(null);

  it("a ticked family at C keeps every grade, never a piece without a passive", () => {
    expect(matchesFilters(dsA, f([DS]))).toBe(true);
    expect(matchesFilters(dsB, f([DS]))).toBe(true);
    expect(matchesFilters(none, f([DS]))).toBe(false);
  });

  it("the minimum grade keeps A and better", () => {
    expect(matchesFilters(dsA, f([DS], "A"))).toBe(true);
    expect(matchesFilters(dsB, f([DS], "A"))).toBe(false);
    expect(matchesFilters(dsA, f([DS], "S"))).toBe(false);
  });

  it("OR between families; another family fails", () => {
    expect(matchesFilters(dsA, f(["DMG Increase vs Fire", DS]))).toBe(true);
    expect(matchesFilters(dsA, f(["DMG Increase vs Fire"]))).toBe(false);
  });

  it("no pill = inactive, a stray grade included", () => {
    expect(matchesFilters(none, f([], "S+"))).toBe(true);
    expect(activeFilterCount(f([], "S+"))).toBe(0);
    expect(activeFilterCount(f([DS, "DMG Increase vs Fire"], "A"))).toBe(1);
  });
});

describe("FILTER_CODEC — +15 passive", () => {
  it("round-trips the families and the grade", () => {
    const back = FILTER_CODEC.deserialize(FILTER_CODEC.serialize!(f([DS], "S")));
    expect(back.passives).toEqual(new Set([DS]));
    expect(back.passiveMinGrade).toBe("S");
  });

  it("a session without the fields, or an unknown grade, reads none at C", () => {
    const back = FILTER_CODEC.deserialize(JSON.stringify({ subMode: "and" }));
    expect(back.passives).toEqual(new Set());
    expect(back.passiveMinGrade).toBe("C");
    expect(FILTER_CODEC.deserialize(JSON.stringify({ passives: [DS], passiveMinGrade: "Z" })).passiveMinGrade).toBe("C");
  });
});
