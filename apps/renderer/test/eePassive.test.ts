/// <reference types="node" />
// EE level-gated passives on the sheet (`source: "eePassive"`, `fromBuff`),
// from the committed contract: Fatal's Eclipse (2000078) unlocks CHD +30 % at
// +10 — the one IOT_STAT EE unique (ee-passives.json, outerpedia's C20).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeCharStats, parseGearPiece, type CharactersTable, type CodexCurve, type GameData, type RawItem } from "@gear-solver/core";
import { computeFinalStats } from "../src/lib/composeBuild.js";

const derived = (f: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/derived/${f}`, import.meta.url), "utf8"));
const game = {
  options: derived("options.json"),
  equipment: derived("equipment.json"),
  equipmentPassives: {},
  enhance: derived("enhance.json"),
  singularityOptions: {},
  eePassives: derived("ee-passives.json"),
} as unknown as GameData;

const FATAL = "2000078";
const eclipse = (level: number) => {
  const raw: RawItem = {
    ItemUID: `ee${level}`, CharUID: "0", ItemID: 2000078, Exp: game.enhance.expCurves["exclusive|unique|6"]![level]!,
    BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0, SelectSubOptionNum: 0,
    SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [], SubOptionList: [],
  };
  const piece = parseGearPiece(raw, game);
  expect(piece.enhanceLevel).toBe(level);
  return piece;
};

describe("Fatal's Eclipse (2000078) — CHD +30 % at +10", () => {
  const characters = derived("characters.json") as CharactersTable;
  const codexCurve = derived("codex-curve.json") as CodexCurve;
  const c = composeCharStats(characters[FATAL]!.ingredients!, codexCurve, { level: 100, levelMaxStep: 0, levelMaxModifier: 0 });
  const chd = (gear: ReturnType<typeof eclipse>[]) => computeFinalStats(c.noGearStats, c.scaling, gear, null).critDmg;

  it("+9 leaves Fatal's CHD unchanged", () => {
    expect(chd([])).toBeGreaterThan(0);
    expect(chd([eclipse(9)])).toBe(chd([]));
  });

  it("+10 adds 30 to Fatal's CHD", () => {
    expect(chd([eclipse(10)])).toBe(chd([]) + 30);
  });
});
