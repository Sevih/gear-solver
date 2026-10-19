import { describe, it, expect } from "vitest";
import { DEFAULT_RULES, gameRulesOf, gemSlotsAt } from "../src/rules.js";
import { sumEvoUpTo } from "../src/compose-stats.js";
import type { GameData, StatBlock } from "../src/gamedata.js";
import enhanceJson from "../../../data/derived/enhance.json";
import progressionJson from "../../../data/derived/progression.json";

/** Only `enhance` and `progression` are read by `gameRulesOf`. */
function gameOf(enhance: unknown, progression?: unknown): GameData {
  return { enhance, ...(progression ? { progression } : {}) } as GameData;
}

describe("gameRulesOf", () => {
  // Non-regression guard: the committed contract carries exactly the rules
  // that were hard-coded before B62.
  it("reads exactly DEFAULT_RULES from today's contract", () => {
    expect(gameRulesOf(gameOf(enhanceJson, progressionJson))).toEqual(DEFAULT_RULES);
  });

  it("falls back to DEFAULT_RULES on a cache synced before B62, without throwing", () => {
    const legacy: Record<string, unknown> = { ...enhanceJson };
    delete legacy.gemSlots;
    delete legacy.reforge;
    expect(gameRulesOf(gameOf(legacy))).toEqual(DEFAULT_RULES);
  });

  it("reads the contract when it differs", () => {
    const rules = gameRulesOf(gameOf(
      {
        ...enhanceJson,
        gemSlots: { ...enhanceJson.gemSlots, unlocks: { ...enhanceJson.gemSlots.unlocks, ooparts: [{ enhanceLevel: 7, slots: 2 }] } },
        reforge: { ...enhanceJson.reforge, countByStar: { ...enhanceJson.reforge.countByStar, "6": 7 }, ascendedBonus: 2 },
      },
      { evoUnlockLevel: { ...progressionJson.evoUnlockLevel, "7": 100 } },
    ));
    expect(gemSlotsAt(rules.gemSlots.ooparts, 6)).toBe(4);
    expect(gemSlotsAt(rules.gemSlots.ooparts, 7)).toBe(6);
    expect(gemSlotsAt(rules.gemSlots.exclusive, 5)).toBe(5);
    expect(rules.reforge).toEqual({ maxTicksPerSub: 6, countByStar: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7 }, ascendedBonus: 2 });
    // Evolution row 7 now unlocks at lv 100 instead of 105.
    const zero: StatBlock = {
      atk: 0, def: 0, hp: 0, spd: 0, chc: 0, chd: 0, pen: 0, dmgInc: 0, dmgRed: 0,
      eff: 0, res: 0, effRate: 0, resRate: 0, atkPct: 0, defPct: 0, hpPct: 0,
    };
    const evo = { "6": { ...zero, atk: 1 }, "7": { ...zero, atk: 2 } };
    expect(sumEvoUpTo(evo, 9, 9, 100, rules.evoUnlockLevel).atk).toBe(3);
    expect(sumEvoUpTo(evo, 9, 9, 100).atk).toBe(1);
  });

  it("sums several unlock tiers reached", () => {
    const rules = gameRulesOf(gameOf({
      ...enhanceJson,
      gemSlots: { ...enhanceJson.gemSlots, unlocks: { ...enhanceJson.gemSlots.unlocks, exclusive: [{ enhanceLevel: 10, slots: 1 }, { enhanceLevel: 5, slots: 1 }] } },
    }));
    expect(rules.gemSlots.exclusive).toMatchObject({ unlockLevel: 5, unlockSlots: 1 });
    expect([0, 5, 10].map((lv) => gemSlotsAt(rules.gemSlots.exclusive, lv))).toEqual([4, 5, 6]);
  });

  it("memoizes per GameData object", () => {
    const game = gameOf(enhanceJson, progressionJson);
    expect(gameRulesOf(game)).toBe(gameRulesOf(game));
  });
});
