import { describe, expect, it } from "vitest";
import type { EquipmentDef, EquipmentTable, ItemsTable } from "@gear-solver/core";
import { scrapValue, type ScrapPiece } from "../src/lib/inventory/scrapValue.js";
import { addAll, materialRows, pruneSelection, scrapScope, toggleSelection } from "../src/lib/inventory/scrapCard.js";

type P = { id: string; name: string };
const a: P = { id: "a", name: "A" };
const b: P = { id: "b", name: "B" };
const c: P = { id: "c", name: "C" };
const byId = new Map([a, b, c].map((p) => [p.id, p]));

describe("scrapScope", () => {
  it("empty selection: the filtered view and its label", () => {
    const s = scrapScope(new Set(), [a, b], byId);
    expect(s.pieces).toEqual([a, b]);
    expect(s.label).toBe("2 shown");
  });

  it("a selection wins, even a piece outside the view", () => {
    const s = scrapScope(new Set(["c", "a"]), [a, b], byId);
    expect(s.pieces).toEqual([c, a]);
    expect(s.label).toBe("2 selected");
  });

  it("an id no longer in the inventory is not counted", () => {
    const s = scrapScope(new Set(["a", "gone"]), [b], byId);
    expect(s.pieces).toEqual([a]);
    expect(s.label).toBe("1 selected");
  });
});

describe("materialRows", () => {
  const BASE: EquipmentDef = {
    slot: "weapon", grade: "IG_UNIQUE", star: 6, classLimit: null, setId: null, armorSetId: null,
    name: null, mainGroup: null, subGroup: null, image: null, effectIcon: null, armorSetIcon: null, class: null,
  };
  const EQUIPMENT: EquipmentTable = {
    "1": { ...BASE, canSell: true, sellPrice: 1000, canDissolve: true, dissolve: { assets: [{ type: "AT_GOLD", min: 100, max: 200 }], items: [{ id: "500", min: 2, max: 4 }, { id: "600", min: 1, max: 1 }] } },
  };
  const ITEMS: ItemsTable = {
    "500": { name: "Stage 2 Enhancement Stone", icon: "TI_Item_Growth_Dissolve_01", itemType: "IT_MATERIAL", itemSubType: "IST_NONE", grade: "IG_NORMAL", canSell: false, sellPrice: 0 },
  };
  const piece: ScrapPiece = { itemId: 1, locked: false, equippedBy: null, enhance: 0 };

  it("name and icon from items; unknown → item <id> and no icon", () => {
    const v = scrapValue([piece, piece], EQUIPMENT, ITEMS);
    expect(materialRows(v, ITEMS)).toEqual([
      { id: "500", name: "Stage 2 Enhancement Stone", icon: "TI_Item_Growth_Dissolve_01", min: 4, max: 8 },
      { id: "600", name: "item 600", icon: null, min: 2, max: 2 },
    ]);
  });

  it("no items table: every icon null", () => {
    const v = scrapValue([piece], EQUIPMENT, null);
    expect(materialRows(v, null).map((m) => [m.name, m.icon])).toEqual([["item 500", null], ["item 600", null]]);
  });
});

describe("selection updates", () => {
  it("toggleSelection: adds then removes, on a new Set", () => {
    const s0 = new Set(["a"]);
    const s1 = toggleSelection(s0, "b");
    expect(s1).not.toBe(s0);
    expect(s0).toEqual(new Set(["a"]));
    expect(s1).toEqual(new Set(["a", "b"]));
    const s2 = toggleSelection(s1, "a");
    expect(s2).toEqual(new Set(["b"]));
    expect(s1).toEqual(new Set(["a", "b"]));
  });

  it("addAll: a new Set with the ids added, the same Set when nothing is new", () => {
    const s0 = new Set(["a"]);
    const s1 = addAll(s0, ["a", "b", "c", "b"]);
    expect(s1).not.toBe(s0);
    expect(s0).toEqual(new Set(["a"]));
    expect(s1).toEqual(new Set(["a", "b", "c"]));
    expect(addAll(s1, ["a", "c"])).toBe(s1);
  });

  it("pruneSelection: a piece gone from the inventory is dropped, on a new Set", () => {
    const s0 = new Set(["a", "gone"]);
    const s1 = pruneSelection(s0, byId);
    expect(s1).not.toBe(s0);
    expect(s0).toEqual(new Set(["a", "gone"]));
    expect(s1).toEqual(new Set(["a"]));
    expect(pruneSelection(s1, byId)).toBe(s1);
  });
});
