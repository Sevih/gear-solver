/// <reference types="node" />
// +15 passives (lib/singularityPassives.ts): family = the Singularity option's
// name, grade = the letter its desc opens with, read on the real table
// (`data/derived/singularity-options.json`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, GearPiece } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";
import { singularityShortLabel } from "../src/design/gearCardText.js";
import {
  SINGULARITY_GRADES, gradeAtLeast, passiveFamilyOrder, passiveGroupOf, passiveLabel, passiveOf,
  passiveOfGearPiece, passiveOfUiPiece, singularityGradeColor,
} from "../src/lib/singularityPassives.js";

const TABLE = JSON.parse(readFileSync(new URL("../../../data/derived/singularity-options.json", import.meta.url), "utf8")) as GameData["singularityOptions"];
const GAME = { singularityOptions: TABLE } as GameData;

describe("singularity grades", () => {
  it("C < B < A < S < S+", () => {
    expect(SINGULARITY_GRADES).toEqual(["C", "B", "A", "S", "S+"]);
    expect(gradeAtLeast("A", "A")).toBe(true);
    expect(gradeAtLeast("S+", "A")).toBe(true);
    expect(gradeAtLeast("B", "A")).toBe(false);
    expect(gradeAtLeast("C", "C")).toBe(true);
    expect(gradeAtLeast("S", "S+")).toBe(false);
  });
});

describe("passiveOf", () => {
  it("reads the family and the grade of a real option", () => {
    // 300137: "Increased DMG within Dimensional Singularity", grade A.
    expect(passiveOf(TABLE["300137"]!)).toEqual({ family: "Increased DMG within Dimensional Singularity", grade: "A" });
    expect(passiveOf(TABLE["300147"]!)?.grade).toBe("S+");
  });

  it("trims the family (the table spells one with a trailing space)", () => {
    const family = passiveOf({ name: "DMG Increase to target ", desc: null })?.family;
    expect(family).toBe("DMG Increase to target");
    expect(passiveLabel(family!)).toBe("DMG+");
  });

  it("a desc without a grade letter → grade null; no name → null", () => {
    expect(passiveOf({ name: "Reduced DMG Taken vs Fire", desc: "DMG taken decreases" })).toEqual({ family: "Reduced DMG Taken vs Fire", grade: null });
    expect(passiveOf({ name: null, desc: TABLE["300137"]!.desc })).toBeNull();
  });

  it("reads a GearPiece's singularity main and a UiPiece's effect; none below +15", () => {
    const opt = TABLE["300137"]!;
    const gear = { main: [{ stat: "atk", value: 1, source: "option" }, { stat: "dmgUp", value: 120, source: "singularity", name: opt.name, desc: opt.desc }] } as unknown as GearPiece;
    expect(passiveOfGearPiece(gear)?.grade).toBe("A");
    expect(passiveOfGearPiece({ main: [] } as unknown as GearPiece)).toBeNull();
    const ui = { effects: [{ stat: "dmgUp", value: "120%", percent: true, name: opt.name, desc: opt.desc, combatOnly: true }] } as unknown as UiPiece;
    expect(passiveOfUiPiece(ui)?.family).toBe("Increased DMG within Dimensional Singularity");
    expect(passiveOfUiPiece({ effects: [] } as unknown as UiPiece)).toBeNull();
  });
});

describe("passiveGroupOf", () => {
  it("weapon, accessory, the four armor pieces; talisman and EE carry none", () => {
    expect(passiveGroupOf("weapon")).toBe("weapon");
    expect(passiveGroupOf("accessory")).toBe("accessory");
    for (const s of ["helmet", "armor", "gloves", "boots"]) expect(passiveGroupOf(s)).toBe("armor");
    for (const s of ["ooparts", "talisman", "exclusive", null]) expect(passiveGroupOf(s)).toBeNull();
  });
});

describe("the table's 15 families", () => {
  it("are listed in table order, each with a short label and all five grades", () => {
    const order = passiveFamilyOrder(GAME);
    expect(order).toHaveLength(15);
    expect(order[0]).toBe("DMG Increase vs Earth");
    for (const family of order) {
      expect(singularityShortLabel(family)).not.toBeNull();
      const grades = new Set(Object.values(TABLE).map((o) => passiveOf(o)).filter((p) => p?.family === family).map((p) => p!.grade));
      expect([...grades].sort()).toEqual([...SINGULARITY_GRADES].sort());
    }
  });
});

describe("singularityGradeColor", () => {
  it("the color of the grade letter on the real table, as a piece's card shows it", () => {
    expect(SINGULARITY_GRADES.map((g) => singularityGradeColor(g, GAME).toLowerCase())).toEqual(["#27d054", "#0ea8f5", "#f5340e", "#b266ff", "#ff00ff"]);
  });

  it("reads the table: another color there wins", () => {
    const game = { singularityOptions: { "1": { name: "X", desc: "<color=#123456>A</color> text" } } } as unknown as GameData;
    expect(singularityGradeColor("A", game)).toBe("#123456");
    expect(singularityGradeColor("S", game)).toBe("#b266ff");
  });

  it("without a table, the table's usual five colors", () => {
    expect(SINGULARITY_GRADES.map((g) => singularityGradeColor(g, null))).toEqual(["#27D054", "#0EA8F5", "#F5340E", "#b266ff", "#ff00ff"]);
  });
});
