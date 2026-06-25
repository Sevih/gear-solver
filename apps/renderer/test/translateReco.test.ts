import { describe, expect, it } from "vitest";
import { translateRecoBuild, type StructuredRecoBuild } from "../src/lib/reco/translateReco.js";

describe("translateRecoBuild — mains", () => {
  it("unions main-stat keys across alternative pieces into the OR-list", () => {
    const build: StructuredRecoBuild = {
      Weapon: [{ name: "W", itemId: 1, effectIcon: "wi", mainStat: ["atkPct"] }],
      Amulet: [
        { name: "A1", itemId: 2, effectIcon: "ai1", mainStat: ["pen", "critDmg"] },
        { name: "A2", itemId: 3, effectIcon: "ai2", mainStat: ["spd"] },
      ],
    };
    const { patch } = translateRecoBuild(build);
    expect(patch.mainPicks.weapon).toEqual({ atkPct: true });
    expect(patch.mainPicks.accessory).toEqual({ pen: true, critDmg: true, spd: true });
  });

  it("omits a slot with no main recommendation", () => {
    const { patch } = translateRecoBuild({ Weapon: [] });
    expect(patch.mainPicks.weapon).toBeUndefined();
  });
});

describe("translateRecoBuild — effects", () => {
  it("maps each effect icon to required (OR at slot level)", () => {
    const build: StructuredRecoBuild = {
      Weapon: [{ name: "W", itemId: 1, effectIcon: "TI_W_11", mainStat: ["atkPct"] }],
      Amulet: [
        { name: "A1", itemId: 2, effectIcon: "TI_A_01", mainStat: ["pen"] },
        { name: "A2", itemId: 3, effectIcon: "TI_A_02", mainStat: ["spd"] },
      ],
    };
    const { patch } = translateRecoBuild(build);
    expect(patch.weaponEffectPicks).toEqual({ TI_W_11: "required" });
    expect(patch.accessoryEffectPicks).toEqual({ TI_A_01: "required", TI_A_02: "required" });
  });

  it("warns and skips a piece with a null effect icon", () => {
    const { patch, warnings } = translateRecoBuild({
      Weapon: [{ name: "Mystery", itemId: 1, effectIcon: null, mainStat: ["atkPct"] }],
    });
    expect(patch.weaponEffectPicks).toEqual({});
    expect(warnings.some((w) => /Mystery.*effect icon/.test(w))).toBe(true);
    // Its main stat still lands (icon and main are independent).
    expect(patch.mainPicks.weapon).toEqual({ atkPct: true });
  });
});

describe("translateRecoBuild — sets", () => {
  it("maps each combo 1:1 to an OR plan", () => {
    const build: StructuredRecoBuild = {
      Set: [
        [{ name: "Speed", setId: "13", count: 4 }],
        [{ name: "Crit", setId: "2", count: 2 }, { name: "Destruction", setId: "5", count: 2 }],
      ],
    };
    const { patch, warnings } = translateRecoBuild(build);
    expect(patch.setPlans).toEqual([
      [{ setId: "13", count: 4 }],
      [{ setId: "2", count: 2 }, { setId: "5", count: 2 }],
    ]);
    expect(warnings).toEqual([]);
  });

  it("drops a whole combo (not just the cond) when a setId is unresolved", () => {
    const build: StructuredRecoBuild = {
      Set: [
        [{ name: "Crit", setId: "2", count: 2 }, { name: "Mystery", setId: null, count: 2 }],
        [{ name: "Speed", setId: "13", count: 4 }],
      ],
    };
    const { patch, warnings } = translateRecoBuild(build);
    // Partial plan would weaken the constraint — the whole alternative is dropped.
    expect(patch.setPlans).toEqual([[{ setId: "13", count: 4 }]]);
    expect(warnings.some((w) => /unresolved set/.test(w))).toBe(true);
  });
});

describe("translateRecoBuild — substat priority", () => {
  it("maps tiers to decreasing weights via STAT_TO_PRIORITY", () => {
    const build: StructuredRecoBuild = {
      SubstatPrio: [["atk"], ["critRate"], ["critDmg"], ["spd"], ["dmgUp"]],
    };
    const { patch } = translateRecoBuild(build);
    expect(patch.priority).toEqual({
      atk: 3,    // tier 0
      crc: 2,    // tier 1 (critRate → crc)
      chd: 1,    // tier 2 (critDmg → chd)
      spd: 1,    // tier 3, clamped to 1
      dmgUp: 1,  // tier 4, clamped to 1
    });
  });

  it("ties within a tier share that tier's weight", () => {
    const { patch } = translateRecoBuild({ SubstatPrio: [["atk", "critRate"], ["spd"]] });
    expect(patch.priority).toEqual({ atk: 3, crc: 3, spd: 2 });
  });

  it("keeps the best (earliest) tier when a priority bucket repeats", () => {
    // atk (tier 0 → 3) and atkPct (tier 2 → 1) both map to "atk".
    const { patch } = translateRecoBuild({ SubstatPrio: [["atk"], ["spd"], ["atkPct"]] });
    expect(patch.priority.atk).toBe(3);
  });

  it("warns and skips an unknown stat key", () => {
    const { patch, warnings } = translateRecoBuild({ SubstatPrio: [["atk"], ["bogus"]] });
    expect(patch.priority).toEqual({ atk: 3 });
    expect(warnings.some((w) => /unknown stat "bogus"/.test(w))).toBe(true);
  });
});
