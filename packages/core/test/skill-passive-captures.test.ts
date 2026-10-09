import { describe, it, expect } from "vitest";
import { composeCharStats, pickSkillBlock } from "../src/compose-stats.js";
import type { CharacterDef, CodexCurve, StatBlock } from "../src/gamedata.js";
import charactersJson from "../../../data/derived/characters.json";
import codexJson from "../../../data/derived/codex-curve.json";

/** Deux captures prises en jeu le 10/10/2026 sur des passifs permanents de
 *  S2 : niveau 100, sans équipement, compte où transcendance (+30 %), codex
 *  et quirks sont au maximum — soit les défauts de `composeCharStats` avec
 *  `level: 100` et le niveau de S2 de la capture.
 *
 *  - Claire (2000017), S2 niv. 1 : ATK 1002, dont 730 en blanc. Son S2 ne
 *    porte le buff d'ATK qu'à partir du niveau 2 (`s2ByLevel` : 2..5) ; au
 *    niveau maximum le passif donnerait 1096.
 *  - Ame (2000065), S2 niv. 5 : taux critique 46 %, dont 15 en blanc
 *    (+25 du S2, +6 de la compétence de transcendance).
 *
 *  Pas dans `data/stat-locks.json` : ses entrées sont indexées par l'UID de
 *  personnage d'un compte, que ces captures n'ont pas. */
const characters = charactersJson as unknown as Record<string, CharacterDef>;
const codex = codexJson as unknown as CodexCurve;

function compose(id: string, s2: number | null) {
  const ingredients = characters[id]?.ingredients;
  expect(ingredients).toBeTruthy();
  return composeCharStats(ingredients!, codex, {
    level: 100,
    userSkillLevels: s2 == null ? null : { first: 1, second: s2, ultimate: 1 },
  });
}

describe("passifs permanents de S2 — captures lv100 sans équipement", () => {
  it("Claire, S2 niv. 1 : ATK 1002 (le passif d'ATK n'existe pas à ce niveau)", () => {
    const r = compose("2000017", 1);
    expect(r.noGearStats.atk).toBe(1002);
    expect(r.intrinsicStats.atk).toBe(730);
  });

  it("Claire sans niveau de S2 connu : aperçu au maximum, ATK 1096 (calcul, pas une capture)", () => {
    expect(compose("2000017", null).noGearStats.atk).toBe(1096);
    expect(compose("2000017", 5).noGearStats.atk).toBe(1096);
  });

  it("Ame, S2 niv. 5 : taux critique 46 %, dont 15 en blanc", () => {
    const r = compose("2000065", 5);
    expect(r.noGearStats.chc).toBe(46);
    expect(r.intrinsicStats.chc).toBe(15);
  });
});

describe("pickSkillBlock — niveau connu sans ligne", () => {
  const block = (atkPct: number) => ({ atkPct } as unknown as StatBlock);
  const table = { "2": block(5), "3": block(7.5), "5": block(10) };

  it("vaut zéro sous la première ligne émise", () => {
    expect(pickSkillBlock(table, 1).atkPct).toBe(0);
  });

  it("prend la ligne du niveau, ou la plus haute en dessous", () => {
    expect(pickSkillBlock(table, 3).atkPct).toBe(7.5);
    expect(pickSkillBlock(table, 4).atkPct).toBe(7.5);
    expect(pickSkillBlock(table, 5).atkPct).toBe(10);
  });

  it("retombe sur la ligne la plus haute seulement sans niveau connu", () => {
    expect(pickSkillBlock(table, undefined).atkPct).toBe(10);
    expect(pickSkillBlock(table, 0).atkPct).toBe(10);
    expect(pickSkillBlock({}, 3).atkPct).toBe(0);
  });

  it("s'applique de même à S1, S2 et S3", () => {
    const ingredients = characters["2000017"]!.ingredients!;
    const at = (slot: "first" | "second" | "ultimate", lv: number) =>
      composeCharStats({ ...ingredients, s1ByLevel: ingredients.s2ByLevel, s2ByLevel: {}, s3ByLevel: ingredients.s2ByLevel }, codex, {
        level: 100,
        userSkillLevels: { first: 5, second: 5, ultimate: 5, [slot]: lv },
      }).noGearStats.atk;
    // S1 et S3 portent chacun le passif de Claire : niveau 1 sur l'un retire son +10 %.
    const both = at("second", 1);
    expect(at("first", 1)).toBeLessThan(both);
    expect(at("ultimate", 1)).toBeLessThan(both);
    expect(at("first", 1)).toBe(at("ultimate", 1));
  });
});
