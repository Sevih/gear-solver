import { describe, expect, it } from "vitest";
import type { EquipmentDef, EquipmentTable, ItemsTable } from "@gear-solver/core";
import { formatGold, formatRange, hasScrapFields, scrapValue, type ScrapPiece } from "../src/lib/inventory/scrapValue.js";

const BASE: EquipmentDef = {
  slot: "weapon", grade: "IG_UNIQUE", star: 6, classLimit: null, setId: null, armorSetId: null,
  name: null, mainGroup: null, subGroup: null, image: null, effectIcon: null, armorSetIcon: null, class: null,
};

/** 1: sells 1000, dissolves 100..200 gold + 2..4 × item 500 ; 2: sells 300,
 *  dissolves 50 gold + 1..3 × item 500 + 1 × item 600 ; 3: neither ;
 *  4: an entry from a table synced before the scrap fields. */
const EQUIPMENT: EquipmentTable = {
  "1": { ...BASE, canSell: true, sellPrice: 1000, canDissolve: true, dissolve: { assets: [{ type: "AT_GOLD", min: 100, max: 200 }], items: [{ id: "500", min: 2, max: 4 }] } },
  "2": { ...BASE, canSell: true, sellPrice: 300, canDissolve: true, dissolve: { assets: [{ type: "AT_GOLD", min: 50, max: 50 }], items: [{ id: "500", min: 1, max: 3 }, { id: "600", min: 1, max: 1 }] } },
  "3": { ...BASE, canSell: false, sellPrice: 0, canDissolve: false, dissolve: null },
  "4": { ...BASE },
};

const ITEMS: ItemsTable = {
  "500": { name: "Stage 2 Enhancement Stone", icon: null, itemType: "IT_MATERIAL", itemSubType: "IST_NONE", grade: "IG_NORMAL", canSell: false, sellPrice: 0 },
};

const piece = (itemId: number, over: Partial<ScrapPiece> = {}): ScrapPiece => ({ itemId, locked: false, equippedBy: null, enhance: 0, ...over });

describe("scrapValue", () => {
  it("free +0 pieces: sold and dissolved, min and max summed separately, same material merged", () => {
    const v = scrapValue([piece(1), piece(2)], EQUIPMENT, ITEMS);
    expect(v.sell).toEqual({ count: 2, gold: 1300 });
    expect(v.dissolve.count).toBe(2);
    expect(v.dissolve.gold).toEqual({ min: 150, max: 250 });
    expect(v.dissolve.items).toEqual([
      { id: "500", name: "Stage 2 Enhancement Stone", min: 3, max: 7 },
      { id: "600", name: "item 600", min: 1, max: 1 },
    ]);
    expect(v.dissolve.enhancedCount).toBe(0);
    expect(v.unknown).toBe(0);
  });

  it("equipped or locked: neither sold nor dissolved", () => {
    const v = scrapValue([piece(1, { equippedBy: "42" }), piece(1, { locked: true })], EQUIPMENT, ITEMS);
    expect(v.sell).toEqual({ count: 0, gold: 0 });
    expect(v.dissolve.count).toBe(0);
    expect(v.dissolve.gold).toEqual({ min: 0, max: 0 });
    expect(v.dissolve.items).toEqual([]);
  });

  it("enhanced: not sold, dissolved and counted in enhancedCount", () => {
    const v = scrapValue([piece(1, { enhance: 3 }), piece(1)], EQUIPMENT, ITEMS);
    expect(v.sell).toEqual({ count: 1, gold: 1000 });
    expect(v.dissolve.count).toBe(2);
    expect(v.dissolve.enhancedCount).toBe(1);
    expect(v.dissolve.gold).toEqual({ min: 200, max: 400 });
  });

  it("neither sellable nor dissolvable: counted nowhere, not unknown", () => {
    const v = scrapValue([piece(3)], EQUIPMENT, ITEMS);
    expect(v.sell.count).toBe(0);
    expect(v.dissolve.count).toBe(0);
    expect(v.unknown).toBe(0);
  });

  it("entry without the fields, or no entry at all: unknown", () => {
    const v = scrapValue([piece(4), piece(999), piece(1)], EQUIPMENT, ITEMS);
    expect(v.unknown).toBe(2);
    expect(v.sell.count).toBe(1);
  });

  it("no items table: materials named `item <id>`", () => {
    const v = scrapValue([piece(1)], EQUIPMENT, null);
    expect(v.dissolve.items).toEqual([{ id: "500", name: "item 500", min: 2, max: 4 }]);
  });
});

describe("hasScrapFields (shows the Inventory scrap line)", () => {
  it("tables carrying the fields: true", () => {
    expect(hasScrapFields(EQUIPMENT)).toBe(true);
  });

  it("tables without any field, empty or absent: false — no line", () => {
    expect(hasScrapFields({ "1": { ...BASE }, "2": { ...BASE } })).toBe(false);
    expect(hasScrapFields({})).toBe(false);
    expect(hasScrapFields(null)).toBe(false);
  });
});

describe("formatGold / formatRange", () => {
  it("groups thousands with a narrow no-break space", () => {
    expect(formatGold(0)).toBe("0");
    expect(formatGold(999)).toBe("999");
    expect(formatGold(12400)).toBe("12 400");
    expect(formatGold(1234567)).toBe("1 234 567");
  });

  it("a single value when min == max, `min–max` otherwise", () => {
    expect(formatRange({ min: 50, max: 50 })).toBe("50");
    expect(formatRange({ min: 2100, max: 3400 })).toBe("2 100–3 400");
  });
});
