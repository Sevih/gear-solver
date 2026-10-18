import { describe, expect, it } from "vitest";
import type { GameData, SetDef } from "@gear-solver/core";
import { pickSetLevel } from "../src/design/GearDetail.js";
import setsJson from "../../../data/derived/sets.json";

// The gear detail's set tier follows the contract's per-piece level
// (`pieceSetLevel`), not a hard-coded BT4 cut.
const SETS = setsJson as unknown as GameData["sets"];
const ATTACK = "1";
const game = (sets: GameData["sets"]) => ({ sets }) as unknown as GameData;

/** Attack set with its rows rewritten by `edit`. */
function attackWith(edit: (l: SetDef["levels"][number]) => SetDef["levels"][number]): GameData {
  const def = SETS[ATTACK]!;
  return game({ ...SETS, [ATTACK]: { ...def, levels: def.levels.map(edit) } });
}

describe("gear detail — set level", () => {
  it("committed contract: BT3 → level 1, BT4 → level 2", () => {
    expect(pickSetLevel(game(SETS), ATTACK, 3)?.level.level).toBe(1);
    expect(pickSetLevel(game(SETS), ATTACK, 4)?.level.level).toBe(2);
  });

  it("reads the rows' breakLimitCounts", () => {
    const g = attackWith((l) => ({ ...l, breakLimitCounts: l.level === 2 ? [3, 4] : [0, 1, 2] }));
    expect(pickSetLevel(g, ATTACK, 3)?.level.level).toBe(2);
  });

  it("a contract without breakLimitCounts falls back to the former rule", () => {
    const g = attackWith(({ breakLimitCounts: _b, ignoreLowSet: _i, ...l }) => l);
    expect(pickSetLevel(g, ATTACK, 3)?.level.level).toBe(1);
    expect(pickSetLevel(g, ATTACK, 4)?.level.level).toBe(2);
  });
});
