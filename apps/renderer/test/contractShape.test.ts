/// <reference types="node" />
// Reader side of the solver contract's shape. `StatBlock` and
// `CharacterIngredients` are declared twice: here (packages/core/src/gamedata.ts)
// and in outerpedia's emitter (datagen/generators/solver-ingredients.ts, guarded
// there by its own shape test). The key lists below are checked exhaustive by
// tsc against OUR types, then every character of the committed contract — and
// of the outerpedia checkout, when there is one — must carry exactly them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CharacterIngredients, CharactersTable, StatBlock } from "@gear-solver/core";
import { findOuterpediaCheckout } from "../../desktop/src/outerpedia-checkout";

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

// `satisfies Record<…, true>`: a key missing from a list, or one the type
// doesn't have, fails typecheck.
const STAT_BLOCK_KEYS = {
  atk: true, def: true, hp: true, spd: true,
  chc: true, chd: true, pen: true,
  dmgInc: true, dmgRed: true,
  eff: true, res: true,
  effRate: true, resRate: true,
  atkPct: true, defPct: true, hpPct: true,
} as const satisfies Record<keyof StatBlock, true>;

const INGREDIENT_KEYS_REQUIRED = {
  base: true, evoByLevel: true, transcendByStar: true, classPassive: true, skill8ByLevel: true,
  s1ByLevel: true, s2ByLevel: true, s3ByLevel: true, geasByNode: true,
} as const satisfies Record<RequiredKeys<CharacterIngredients>, true>;

const INGREDIENT_KEYS_OPTIONAL = {
  corePassive: true, corePassiveByFusion: true,
} as const satisfies Record<OptionalKeys<CharacterIngredients>, true>;

const sorted = (keys: Iterable<string>) => [...keys].sort();
const STAT_BLOCK = sorted(Object.keys(STAT_BLOCK_KEYS));
const RATE_STAT_BLOCK = sorted([...STAT_BLOCK, "spdPct"]);
const REQUIRED = Object.keys(INGREDIENT_KEYS_REQUIRED);
const DECLARED = new Set([...REQUIRED, ...Object.keys(INGREDIENT_KEYS_OPTIONAL)]);

/** Every StatBlock of one character's ingredients, by path, with the keys it must have. */
function statBlocks(ing: CharacterIngredients): Array<[string, unknown, string[]]> {
  const out: Array<[string, unknown, string[]]> = [["classPassive", ing.classPassive, STAT_BLOCK]];
  const byLevel = ["evoByLevel", "skill8ByLevel", "s1ByLevel", "s2ByLevel", "s3ByLevel"] as const;
  for (const k of byLevel) for (const [lv, b] of Object.entries(ing[k] ?? {})) out.push([`${k}.${lv}`, b, STAT_BLOCK]);
  for (const [node, g] of Object.entries(ing.geasByNode ?? {})) {
    for (const [lv, b] of Object.entries(g.levels ?? {})) out.push([`geasByNode.${node}.levels.${lv}`, b, STAT_BLOCK]);
  }
  if (ing.corePassive != null) out.push(["corePassive", ing.corePassive, STAT_BLOCK]);
  for (const [t, b] of Object.entries(ing.corePassiveByFusion ?? {})) out.push([`corePassiveByFusion.${t}`, b, RATE_STAT_BLOCK]);
  return out;
}

/** Shape mismatches of a characters table, one line each — empty when it reads as ours. */
function shapeErrors(chars: CharactersTable): string[] {
  const errors: string[] = [];
  for (const [id, c] of Object.entries(chars)) {
    const ing = c.ingredients;
    if (ing == null) continue;
    const keys = Object.keys(ing);
    for (const k of keys) if (!DECLARED.has(k)) errors.push(`${id}: undeclared ingredient ${k}`);
    for (const k of REQUIRED) if (!keys.includes(k)) errors.push(`${id}: missing ingredient ${k}`);
    for (const [path, block, want] of statBlocks(ing)) {
      const got = block != null && typeof block === "object" ? sorted(Object.keys(block)) : [];
      if (got.join() !== want.join()) errors.push(`${id}: ${path} has [${got.join(", ")}]`);
    }
  }
  return errors;
}

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CONTRACT = join("data", "generated", "solver", "characters.json");
const checkout = findOuterpediaCheckout(REPO_ROOT, CONTRACT);
const read = (file: string) => JSON.parse(readFileSync(file, "utf-8")) as CharactersTable;

describe("solver contract — characters.json has the reader's shape", () => {
  it("the key lists match the types", () => {
    expect(STAT_BLOCK).toHaveLength(16);
    expect(sorted(DECLARED)).toEqual(sorted([...REQUIRED, "corePassive", "corePassiveByFusion"]));
  });

  it("committed data/derived/characters.json", () => {
    const chars = read(join(REPO_ROOT, "data", "derived", "characters.json"));
    expect(Object.keys(chars).length).toBeGreaterThan(0);
    expect(shapeErrors(chars)).toEqual([]);
  });

  // CI has no outerpedia checkout: say so instead of passing silently.
  it.skipIf(!checkout)(`outerpedia's ${CONTRACT}${checkout ? "" : " (skipped: no outerpedia checkout found)"}`, () => {
    const chars = read(join(checkout!, CONTRACT));
    expect(Object.keys(chars).length).toBeGreaterThan(0);
    expect(shapeErrors(chars)).toEqual([]);
  });

  it("catches a drift: an extra stat, a missing one, an undeclared ingredient", () => {
    const chars = read(join(REPO_ROOT, "data", "derived", "characters.json"));
    const [id, c] = Object.entries(chars).find(([, d]) => d.ingredients?.corePassiveByFusion)!;
    const ing = structuredClone(c.ingredients!) as unknown as Record<string, unknown> & CharacterIngredients;
    (ing.classPassive as unknown as Record<string, number>).spdPct = 0;
    delete (ing.corePassiveByFusion!["1"] as Partial<StatBlock & { spdPct: number }>).spdPct;
    ing.statKeys = {};
    delete (ing as Partial<CharacterIngredients>).geasByNode;
    expect(shapeErrors({ [id]: { ...c, ingredients: ing } })).toEqual([
      `${id}: undeclared ingredient statKeys`,
      `${id}: missing ingredient geasByNode`,
      `${id}: classPassive has [${sorted([...STAT_BLOCK, "spdPct"]).join(", ")}]`,
      `${id}: corePassiveByFusion.1 has [${STAT_BLOCK.join(", ")}]`,
    ]);
  });
});
