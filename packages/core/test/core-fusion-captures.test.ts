import { describe, it, expect } from "vitest";
import { composeCharStats } from "../src/compose-stats.js";
import { effectiveCharacter, type CharacterDef, type CodexCurve } from "../src/gamedata.js";
import charactersJson from "../../../data/derived/characters.json";
import codexJson from "../../../data/derived/codex-curve.json";

/** Captures prises en jeu le 09/10/2026 sur des Core Fusion : niveau 100,
 *  sans équipement, compte où transcendance, codex, quirks et fusion sont au
 *  maximum — soit les défauts de `composeCharStats` (transStar, codex, geas
 *  et niveaux de skill au max) avec `level: 100`. Elles établissent que la
 *  base d'un fusionné est celle de son perso d'origine (Snow : ATK, HP, DEF
 *  et vitesse ; Lisha : ATK), que son évolution s'applique et que ses
 *  passifs de classe et de noyau se cumulent.
 *
 *  Pas dans `data/stat-locks.json` : ses entrées sont indexées par l'UID de
 *  personnage d'un compte, que ces captures n'ont pas. */
const characters = charactersJson as unknown as Record<string, CharacterDef>;
const codex = codexJson as unknown as CodexCurve;

const CAPTURES = [
  // [nom, ID fusionné, stat, valeur affichée, part blanche (base + évo + quirks)]
  ["Snow", "2700003", "atk", 1503, 1004],
  ["Snow", "2700003", "hp", 6452, 4203],
  ["Snow", "2700003", "def", 1366, 1002],
  ["Snow", "2700003", "spd", 155, 149],
  ["Lisha", "2700005", "atk", 2093, 1293],
  ["Veronica", "2700037", "atk", 1562, 1138],
] as const;

describe("Core Fusion — captures lv100 sans équipement", () => {
  it.each(CAPTURES)("%s (%s) : %s %i, dont %i en blanc", (_name, id, stat, value, white) => {
    const ingredients = characters[id]?.ingredients;
    expect(ingredients).toBeTruthy();
    const r = composeCharStats(ingredients!, codex, { level: 100 });
    expect(r.noGearStats[stat]).toBe(value);
    expect(r.intrinsicStats[stat]).toBe(white);
  });
});

describe("effectiveCharacter — le perso que le héros est en jeu", () => {
  const snow = { charId: 2000003, fusionCharId: 2700003 };

  it("Snow fusionnée → 2700003 et sa fiche, pas celle de l'origine", () => {
    const eff = effectiveCharacter(snow, characters);
    expect(eff.charId).toBe(2700003);
    expect(eff.def).toBe(characters["2700003"]);
  });

  it("non fusionné → l'origine", () => {
    const eff = effectiveCharacter({ charId: 2000003, fusionCharId: 0 }, characters);
    expect(eff.charId).toBe(2000003);
    expect(eff.def).toBe(characters["2000003"]);
  });

  it("fusion absente du contrat → repli sur l'origine", () => {
    const { "2700003": _fused, ...withoutFusion } = characters;
    const eff = effectiveCharacter(snow, withoutFusion);
    expect(eff.charId).toBe(2000003);
    expect(eff.def).toBe(characters["2000003"]);
  });

  it("pas encore de table → l'id fusionné, sans fiche", () => {
    expect(effectiveCharacter(snow, null)).toEqual({ charId: 2700003, def: null });
  });

  it("l'étoile d'un fusionné est celle de son origine : même clé de charLevelMax", () => {
    for (const [origin, fused] of [["2000003", "2700003"], ["2000005", "2700005"], ["2000037", "2700037"]] as const) {
      expect(characters[fused]?.star).toBe(characters[origin]?.star);
    }
    expect(characters["2700003"]?.star).toBe(2);
  });
});
