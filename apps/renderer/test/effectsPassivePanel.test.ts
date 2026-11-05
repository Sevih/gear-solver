/// <reference types="node" />
// Optimizer › Effects, "+15 passive" lines: the per-group catalog built from
// the inventory (only the families a piece of the group carries, in table
// order) and the panel markup (a text chip per family, the minimum grade
// selector beside a required one). Rendered server-side.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { emptyPassivePicks } from "../src/lib/solver/builderFilters.js";
import { passiveCatalogFromInventory } from "../src/screens/builder/catalogs.js";
import { WeaponsAccessoriesPanel } from "../src/screens/builder/WeaponsAccessoriesPanel.js";

const TABLE = JSON.parse(readFileSync(new URL("../../../data/derived/singularity-options.json", import.meta.url), "utf8")) as GameData["singularityOptions"];
const GAME = { singularityOptions: TABLE } as GameData;
const DS = "Increased DMG within Dimensional Singularity";

const piece = (slot: string, id: string | null): GearPiece => ({
  slot,
  main: id ? [{ stat: "dmgUp", value: 1, source: "singularity", name: TABLE[id]!.name, desc: TABLE[id]!.desc }] : [],
} as unknown as GearPiece);

describe("passiveCatalogFromInventory", () => {
  it("per group, the families carried, in table order, with their owned count", () => {
    // 300137 DS DMG+, 300001 vs Earth DMG+ (first family of the table), 310023 vs Fire DMG-.
    const inv = { gear: [piece("weapon", "300137"), piece("weapon", "300001"), piece("weapon", "300132"), piece("weapon", null), piece("boots", "310023"), piece("ooparts", null)] } as unknown as Inventory;
    const cat = passiveCatalogFromInventory(inv, GAME);
    expect(cat.weapon).toEqual([
      { family: "DMG Increase vs Earth", label: "vs Earth DMG+", owned: 1 },
      { family: DS, label: "DS DMG+", owned: 2 },
    ]);
    expect(cat.accessory).toEqual([]);
    expect(cat.armor).toEqual([{ family: "Reduced DMG Taken vs Fire", label: "vs Fire DMG-", owned: 1 }]);
  });
});

describe("Effects panel — +15 passive", () => {
  const render = (picks = emptyPassivePicks()) => renderToStaticMarkup(createElement(WeaponsAccessoriesPanel, {
    weapons: [], accessories: [], talismans: [], weaponPicks: {}, accPicks: {}, talismanPicks: {},
    passives: { weapon: [{ family: DS, label: "DS DMG+", owned: 2 }], accessory: [], armor: [] },
    passivePicks: picks, dispatch: () => {},
  }));

  it("a chip per family carried; an Armor block that says when it has none", () => {
    const html = render();
    expect(html.match(/>DS DMG\+</g)).toHaveLength(1);
    expect(html).toContain(">Armor<");
    expect(html).toContain("no +15 passive");
    expect(html).not.toContain("Minimum grade for");
  });

  it("a required chip carries its grade selector; an excluded one is struck through", () => {
    const req = render({ ...emptyPassivePicks(), weapon: { [DS]: { state: "required", minGrade: "A" } } });
    expect(req).toContain('aria-label="Minimum grade for DS DMG+"');
    expect(req).toMatch(/<option value="A" selected="">A<\/option>/);
    const exc = render({ ...emptyPassivePicks(), weapon: { [DS]: { state: "excluded", minGrade: "C" } } });
    expect(exc).not.toContain("Minimum grade for");
    expect(exc).toContain("line-through");
  });

  it("a picked family no piece carries any more stays listed, so it can be cleared", () => {
    const html = render({ ...emptyPassivePicks(), armor: { "Reduced DMG Taken vs Dark": { state: "excluded", minGrade: "C" } } });
    expect(html).toContain(">vs Dark DMG-<");
    expect(html).not.toContain("no +15 passive");
  });
});
