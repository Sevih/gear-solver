/// <reference types="node" />
// Optimizer › +15 passives: the per-group catalog built from the inventory
// (only the families a piece of the group carries, in table order) and the
// panel markup (a text chip per family, the minimum grade picker beside a
// required one). Rendered server-side.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece, Inventory } from "@gear-solver/core";
import { emptyPassivePicks } from "../src/lib/solver/builderFilters.js";
import { passiveCatalogFromInventory } from "../src/screens/builder/catalogs.js";
import { PassivesPanel } from "../src/screens/builder/PassivesPanel.js";

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

describe("+15 passives panel", () => {
  const render = (picks = emptyPassivePicks()) => renderToStaticMarkup(createElement(PassivesPanel, {
    passives: { weapon: [{ family: DS, label: "DS DMG+", owned: 2 }], accessory: [], armor: [] },
    passivePicks: picks, game: GAME, dispatch: () => {},
  }));

  it("a chip per family carried; an Armor block that says when it has none", () => {
    const html = render();
    expect(html.match(/>DS DMG\+</g)).toHaveLength(1);
    expect(html).toContain(">Armor<");
    expect(html).toContain("no +15 passive");
    expect(html).not.toContain("Minimum grade for");
  });

  it("a required chip carries its grade picker; an excluded one is struck through", () => {
    const req = render({ ...emptyPassivePicks(), weapon: { [DS]: { state: "required", minGrade: "A" } } });
    expect(req).toContain('aria-label="Minimum grade for DS DMG+"');
    expect(req).toMatch(/aria-label="Grade A" aria-pressed="true"/);
    const exc = render({ ...emptyPassivePicks(), weapon: { [DS]: { state: "excluded", minGrade: "C" } } });
    expect(exc).not.toContain("Minimum grade for");
    expect(exc).toContain("line-through");
  });

  it("a picked family no piece carries any more stays listed, so it can be cleared", () => {
    const html = render({ ...emptyPassivePicks(), armor: { "Reduced DMG Taken vs Dark": { state: "excluded", minGrade: "C" } } });
    expect(html).toContain(">vs Dark DMG-<");
    // Only Accessory, empty, says it — no longer Armor.
    expect(html.match(/no \+15 passive/g)).toHaveLength(1);
  });

  it("the three groups, Weapon / Accessory / Armor, in that order; each empty one says so", () => {
    const html = render();
    expect(html.indexOf(">Weapon<")).toBeLessThan(html.indexOf(">Accessory<"));
    expect(html.indexOf(">Accessory<")).toBeLessThan(html.indexOf(">Armor<"));
    expect(html.match(/no \+15 passive/g)).toHaveLength(2);
  });

  it("the grade picker: five bold letters in the card colors, the chosen one framed, those below it still enabled", () => {
    const html = render({ ...emptyPassivePicks(), weapon: { [DS]: { state: "required", minGrade: "S" } } });
    const group = html.match(/<span role="radiogroup" aria-label="Minimum grade for DS DMG\+"[^>]*>(.*?)<\/span>/)?.[1] ?? "";
    const letters = [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
    expect(letters.map((m) => m[2])).toEqual(["C", "B", "A", "S", "S+"]);
    expect(letters.map((m) => m[1]!.match(/color:([^;"]+)/)?.[1]?.toLowerCase())).toEqual(["#27d054", "#0ea8f5", "#f5340e", "#b266ff", "#ff00ff"]);
    for (const m of letters) {
      expect(m[1]).toContain("font-bold");
      expect(m[1]).not.toContain('disabled=""');
    }
    const pressed = letters.filter((m) => m[1]!.includes('aria-pressed="true"'));
    expect(pressed.map((m) => m[2])).toEqual(["S"]);
    expect(pressed[0]![1]).toContain("bg-white/10");
    expect(pressed[0]![1]).toMatch(/border-color:#b266ff/i);
    expect(letters[0]![1]).toContain("opacity-55");
  });
});
