// Optimizer › Weapons, Accessories and Talismans: one effect panel each
// (`EffectPanel`). Weapons and accessories show the effect icon, talismans
// the art of the first owned piece (`EffectEntry.image`, built by
// `effectCatalogFromInventory`) on its rarity slot plate, the initials without
// one; the cycle and the tooltip are the same. Rendered server-side.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, Inventory } from "@gear-solver/core";
import type { ChipState } from "../src/lib/solver/builderFilters.js";
import { effectCatalogFromInventory, type EffectEntry } from "../src/screens/builder/catalogs.js";
import { EffectPanel, type EffectGroup } from "../src/screens/builder/EffectPanel.js";

const entry = (key: string, over: Partial<EffectEntry> = {}): EffectEntry => ({
  key, icon: `UO_${key}`, image: `TI_Equipment_${key}`, rarity: "legendary", name: `Effect ${key}`, descT4: null, owned: 1, ...over,
});

const render = (group: EffectGroup, effects: EffectEntry[], picks: Record<string, ChipState> = {}) =>
  renderToStaticMarkup(createElement(EffectPanel, { group, effects, picks, dispatch: () => {} }));

describe("EffectPanel", () => {
  it("Weapons and Accessories: the effect icon, titled after their group", () => {
    const w = render("weapon", [entry("1")]);
    expect(w).toContain(">Weapons<");
    expect(w).toContain('src="/img/ui/effect/UO_1.webp"');
    expect(w).not.toContain("/img/equipment/");
    expect(w).not.toContain("/img/ui/bg/");
    const a = render("accessory", [entry("2")], { "2": "excluded" });
    expect(a).toContain(">Accessories<");
    expect(a).toContain('src="/img/ui/effect/UO_2.webp"');
    expect(a).toContain("border-rose-400/40");
  });

  it("Talismans: the item art on its rarity plate, not the effect icon; no image → the initials, no plate", () => {
    const html = render("talisman", [entry("3"), entry("4", { image: null, name: "Zeal" })], { "3": "preferred" });
    expect(html).toContain(">Talismans<");
    expect(html).toContain('src="/img/equipment/TI_Equipment_3.webp"');
    expect(html).not.toContain("/img/ui/effect/");
    // The legendary plate, painted before the art (under it).
    expect(html.indexOf('src="/img/ui/bg/TI_Slot_Unique.webp"')).toBeLessThan(html.indexOf('src="/img/equipment/TI_Equipment_3.webp"'));
    expect(html.match(/\/img\/ui\/bg\//g)).toHaveLength(1);
    expect(render("talisman", [entry("5", { rarity: "epic" })])).toContain('src="/img/ui/bg/TI_Slot_Rare.webp"');
    expect(render("talisman", [entry("6", { rarity: null })])).not.toContain("/img/ui/bg/");
    expect(html).toContain(">Ze<");
    expect(html).toContain("border-dashed");
  });

  it("no effect owned → none", () => {
    expect(render("talisman", [])).toContain(">none<");
  });
});

describe("effectCatalogFromInventory — image", () => {
  it("the art and rarity of the first owned piece of each effect", () => {
    const game = {
      equipment: {
        "10": { setId: "500", image: "TI_Equipment_Talisman_10", grade: "unique", effectIcon: "UO_A", name: "Talisman A" },
        "11": { setId: "500", image: "TI_Equipment_Talisman_11", grade: "rare", effectIcon: "UO_A", name: "Talisman A+" },
        "12": { setId: "501", image: null, grade: null, effectIcon: null, name: "Talisman B" },
      },
      equipmentPassives: {},
    } as unknown as GameData;
    const inv = { gear: [{ slot: "ooparts", itemId: 10 }, { slot: "ooparts", itemId: 11 }, { slot: "ooparts", itemId: 12 }] } as unknown as Inventory;
    const cat = effectCatalogFromInventory(inv, game, "talisman", null);
    expect(cat.map((e) => [e.key, e.image, e.rarity, e.owned])).toEqual([
      ["500", "TI_Equipment_Talisman_10", "legendary", 2],
      ["501", null, null, 1],
    ]);
  });
});
