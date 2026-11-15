// The Optimizer band's denser gear cards (G129, `dense` on `GearCardPanel` /
// `GearCardBody` / `ResultPairDetail`, passed by `BottomGearBand` only): no
// rarity, slot nor "‹Class› Exclusive" text beside the icon (G131),
// "preset ‹names›" under the top-right Never use instead of "from preset
// ‹names›" under the header, and — full card — quality and the Singularity
// +15 effects on one line in their compact form, no quality bar, no "Active
// Effect at +15 Enhancement" title. Gear › Pieces' card (no `dense`) keeps its
// rarity, slot, "‹Class› Exclusive", "from preset" line and bar. Rendered server-side, the
// equipment icon mocked to a marker element.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";
import type { SlotDiff } from "../src/lib/buildDiff.js";

vi.mock("../src/design/EquipmentIcon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/design/EquipmentIcon.js")>()),
  EquipmentIcon: () => createElement("i", { "data-equipment-icon": "" }),
}));

const { GearCardPanel, ResultPairDetail } = await import("../src/design/GearCard.js");
const { BottomGearBand } = await import("../src/screens/builder/BottomGearBand.js");

const desc = "<color=#ff00ff>S+</color> DMG increases by <color=#0D99DA>12%</color> within Dimensional Singularity";
const piece = (over: Partial<UiPiece> = {}): UiPiece => ({
  id: "p1", itemId: 1, slot: "weapon", setId: null, armorSetId: null, rarity: "legendary", classLimit: null,
  stars: 6, enhance: 15, bt: 2, singularity: true, name: "Blade",
  main: [{ label: "ATK 500", stat: "atk", value: "500", percent: false, name: null }],
  subs: [
    { stat: "atkPct", value: "7.5%", lv: 5, reforges: 1 },
    { stat: "critRate", value: "4%", lv: 6, reforges: 2 },
  ],
  effects: [{ stat: "dmgUp", value: "12%", percent: true, name: "Increased DMG within Dimensional Singularity", desc, combatOnly: false }],
  passive: null, multiTierPassive: null, gemSlots: null,
  reforge: { n: 3, max: 6 }, quality: { current: 14, max: 20, pct: 70, tier: "excellent", reachable: 17 },
  searchText: "", status: "free", locked: false, equippedBy: null,
  image: null, effectIcon: null, setIcon: null, class: null,
  iconPiece: { slot: "weapon", rarity: "legendary", stars: 6, enhance: 15, bt: 2, singularity: true },
  ...over,
} as UiPiece);

const render = (p: UiPiece, opts: { compact?: boolean; dense?: boolean; fromPresets?: string[] } = {}) =>
  renderToStaticMarkup(createElement(GearCardPanel, {
    piece: p, equippedChar: null, game: null, excluded: false, onToggleExclude: () => {},
    fromPresets: opts.fromPresets ?? ["Arena"], effects: "none", compact: opts.compact ?? false, dense: opts.dense ?? false, fluid: true,
  }));

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const BAR = /h-1\.5 overflow-hidden rounded-full/;
const PRESET_TITLE = 'title="Held by the in-game preset Arena — taking it changes that preset"';

describe("dense full card (Optimizer band)", () => {
  it("no rarity nor slot text; the main rolls stay beside the icon", () => {
    const html = render(piece(), { dense: true });
    expect(text(html)).not.toContain("Legendary");
    expect(text(html)).not.toContain("Weapon");
    expect(html.indexOf("data-equipment-icon")).toBeLessThan(html.indexOf(">500<"));
  });

  it("drops « ‹Class› Exclusive » too: the main rolls come right after the icon", () => {
    const html = render(piece({ classLimit: "Striker" }), { dense: true });
    expect(text(html)).not.toContain("Exclusive");
    expect(html).not.toContain("Striker");
    // No text line between the icon and the main rolls' column.
    expect(html).toMatch(/<i data-equipment-icon=""><\/i><div class="min-w-0 flex-1"><div class="space-y-1">/);
  });

  it("« preset X » under Never use, right-aligned, without « from », same title, cut", () => {
    const html = render(piece(), { dense: true });
    expect(text(html)).not.toContain("from preset");
    const line = /<div class="([^"]*)" title="Held by[^"]*">([^<]*)<\/div>/.exec(html)!;
    expect(line[2]).toBe("preset Arena");
    expect(line[1]!.split(" ")).toEqual(expect.arrayContaining(["truncate", "text-right"]));
    expect(html).toContain(PRESET_TITLE);
    // After the button, both before the icon row.
    expect(html.indexOf("preset Arena")).toBeGreaterThan(html.indexOf("</button>"));
    expect(html.indexOf("preset Arena")).toBeLessThan(html.indexOf("data-equipment-icon"));
    // In the button's column, at the top right of the name's row.
    const column = /<div class="ml-auto flex shrink-0 flex-col items-end[^"]*">(.*?)<\/div><\/div>/.exec(html)![1]!;
    expect(column).toContain("<button");
    expect(column).toContain("preset Arena");
  });

  it("quality and the +15 effect on ONE line, no bar, no effect title", () => {
    const html = render(piece(), { dense: true });
    const t = text(html);
    expect(t).toContain("14/20→17Exc.");
    expect(t).toContain("S+DS DMG++12%");
    expect(t).not.toContain("Active Effect at +15 Enhancement");
    expect(t).not.toMatch(/Quality/);
    expect(html).not.toMatch(BAR);
    // The same row, the card's last: quality at the left, the effects (pushed
    // right) after it.
    const row = html.slice(html.indexOf('<div class="flex items-center gap-3">'));
    expect(text(row)).toBe("14/20→17Exc.S+DS DMG++12%");
    expect(row).toMatch(/^<div class="flex items-center gap-3"><div class="[^"]*shrink-0" title="Excellent/);
    expect(row).toMatch(/<div class="[^"]*ml-auto min-w-0 justify-end"><span[^>]*title="S\+ DMG increases by 12% within Dimensional Singularity"/);
  });

  it("quality alone, or the effects alone, still on that line", () => {
    expect(text(render(piece({ singularity: false, effects: [] }), { dense: true }))).toContain("14/20→17Exc.");
    expect(text(render(piece({ quality: null }), { dense: true }))).toContain("S+DS DMG++12%");
  });
});

describe("dense compact card (Optimizer band)", () => {
  it("no rarity nor slot text; « preset X » under the icon action, without « from »", () => {
    const html = render(piece({ classLimit: "Striker" }), { compact: true, dense: true });
    const t = text(html);
    expect(t).not.toMatch(/Legendary|Weapon/);
    expect(t).not.toContain("from preset");
    expect(html).toContain(PRESET_TITLE);
    expect(html).toMatch(/<div class="[^"]*text-right[^"]*" title="Held by[^"]*">preset Arena<\/div>/);
    expect(html.indexOf("preset Arena")).toBeGreaterThan(html.indexOf("<button"));
    expect(html.indexOf("preset Arena")).toBeLessThan(html.indexOf('title="LV '));
    // Quality and effects keep their compact lines, no bar.
    expect(t).toContain("14/20→17Exc.");
    expect(html).not.toMatch(BAR);
  });

  it("the EE + talisman pair: « preset X » in each half, without « from »", () => {
    const cell = (p: UiPiece, emptyLabel: string) =>
      ({ piece: p, equippedChar: null, fromPresets: ["Arena"], excluded: false, onToggleExclude: () => {}, emptyLabel });
    const html = renderToStaticMarkup(createElement(ResultPairDetail, {
      top: cell(piece({ id: "ee1", slot: "exclusive", name: "EE piece", main: [], subs: [], quality: null }), "No EE"),
      bottom: cell(piece({ id: "t1", slot: "talisman", name: "Charm", subs: [], quality: null, singularity: false, effects: [] }), "No talisman"),
      game: null, compact: true, dense: true,
    }));
    expect(html.match(/>preset Arena</g)).toHaveLength(2);
    expect(text(html)).not.toContain("from preset");
  });
});

describe("non-dense card (Gear › Pieces) unchanged", () => {
  it("full: rarity, slot, « from preset » under the header, the Quality block with its bar, the +15 title", () => {
    const html = render(piece(), {});
    const t = text(html);
    expect(t).toContain("Legendary");
    expect(t).toContain("Weapon");
    expect(t).toContain("from preset Arena");
    expect(t).toContain("Active Effect at +15 Enhancement");
    expect(html).toMatch(BAR);
    expect(html).toMatch(/<div class="truncate text-amber-200\/85 -mt-2 text-\[11px\]" title="Held by/);
    expect(html).not.toContain("flex-col items-end");
  });

  it("full: « ‹Class› Exclusive » stays above the main rolls", () => {
    const html = render(piece({ classLimit: "Striker" }), {});
    expect(text(html)).toContain("Striker Exclusive");
    expect(html.indexOf("Striker Exclusive")).toBeGreaterThan(html.indexOf("data-equipment-icon"));
    expect(html.indexOf("Striker Exclusive")).toBeLessThan(html.indexOf(">500<"));
  });

  it("compact: « from preset » under the header", () => {
    expect(text(render(piece(), { compact: true }))).toContain("from preset Arena");
  });
});

describe("BottomGearBand passes `dense`", () => {
  const SLOTS = ["weapon", "exclusive", "helmet", "armor", "accessory", "ooparts", "gloves", "boots"];
  const gear = (slot: string): GearPiece => ({
    uid: `u-${slot}`, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "epic", star: 6, name: `P-${slot}`, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null, main: [], subs: [],
  }) as unknown as GearPiece;
  const diff: SlotDiff[] = SLOTS.map((slot) => ({ slot, proposed: gear(slot), worn: null, changed: true }) as SlotDiff);
  const game = { equipment: {}, sets: {} } as unknown as GameData;
  const band = (compact: boolean) => renderToStaticMarkup(createElement(BottomGearBand, {
    build: null, diff, game, reforge: { reforgeMode: "disable", priority: {} }, charsByUid: new Map(),
    presetsOf: () => ["Arena"], excludedPieceUids: new Set<string>(), onToggleExclude: () => {}, compact,
  }));

  it("full and compact: « preset Arena » on every card, never « from preset », no rarity / slot text", () => {
    for (const compact of [false, true]) {
      const html = band(compact);
      expect(html.match(/>preset Arena</g)).toHaveLength(8);
      expect(text(html)).not.toContain("from preset");
      expect(text(html)).not.toMatch(/Epic|Helmet|Gloves/);
    }
  });
});
