import { describe, it, expect } from "vitest";
import { composeCharStats } from "../src/compose-stats.js";
import type { CharacterDef, CodexCurve } from "../src/gamedata.js";
import charactersJson from "../../../data/derived/characters.json";
import codexJson from "../../../data/derived/codex-curve.json";

/** Trois captures prises en jeu le 10/10/2026 sur des Core Fusion : niveau
 *  100, sans équipement, compte où transcendance, codex, quirks et fusion
 *  sont au maximum — soit les défauts de `composeCharStats` (transStar,
 *  codex, geas et niveaux de skill au max) avec `level: 100`. Elles
 *  établissent que la base d'un fusionné est celle de son perso d'origine
 *  (757 → 659 pour Snow, 861 → 749 pour Lisha), que son évolution
 *  s'applique et que ses passifs de classe et de noyau se cumulent.
 *  ATK seule : aucune capture ne porte sur DEF / HP / SPD.
 *
 *  Pas dans `data/stat-locks.json` : ses entrées sont indexées par l'UID de
 *  personnage d'un compte, que ces captures n'ont pas. */
const characters = charactersJson as unknown as Record<string, CharacterDef>;
const codex = codexJson as unknown as CodexCurve;

const CAPTURES = [
  // [nom, ID fusionné, ATK affichée, part blanche (base + évo + quirks)]
  ["Snow", "2700003", 1503, 1004],
  ["Lisha", "2700005", 2093, 1293],
  ["Veronica", "2700037", 1562, 1138],
] as const;

describe("Core Fusion — captures ATK lv100 sans équipement", () => {
  it.each(CAPTURES)("%s (%s) : ATK %i, dont %i en blanc", (_name, id, atk, white) => {
    const ingredients = characters[id]?.ingredients;
    expect(ingredients).toBeTruthy();
    const r = composeCharStats(ingredients!, codex, { level: 100 });
    expect(r.noGearStats.atk).toBe(atk);
    expect(r.intrinsicStats.atk).toBe(white);
  });
});
