// One piece card (`GearCardBody`) for the Inventory, the Builds / Presets
// tooltips and the Builder's result cards: the same piece, not projected,
// renders the same body in the Inventory and in the Builder (apart from the
// wearer line and the effects); `effects="none"` leaves the passive and the
// set bonuses out, `effects="card"` renders them; a projection adds the cyan
// ticks and the `T+n` mark; the Quality block (title and help) is there in
// both contexts; `compact` keeps the compact card. Rendered server-side, the
// equipment icon mocked to a marker element.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GameData } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";

vi.mock("../src/design/EquipmentIcon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/design/EquipmentIcon.js")>()),
  EquipmentIcon: () => createElement("i", { "data-equipment-icon": "" }),
}));

const { GearCardBody } = await import("../src/design/GearCard.js");
type BodyProps = Parameters<typeof GearCardBody>[0];

const piece = (over: Partial<UiPiece> = {}): UiPiece => ({
  id: "p1", itemId: 1, slot: "weapon", setId: null, armorSetId: null, rarity: "legendary", classLimit: null,
  stars: 6, enhance: 15, bt: 2, singularity: false, name: "Blade",
  main: [{ label: "ATK 500", stat: "atk", value: "500", percent: false, name: null }],
  subs: [
    { stat: "atkPct", value: "7.5%", lv: 5, reforges: 1 },
    { stat: "critRate", value: "4%", lv: 6, reforges: 2 },
    { stat: "spd", value: "8", lv: 3, reforges: 0 },
    { stat: "hp", value: "120", lv: 3, reforges: 0 },
  ],
  effects: [], passive: null, multiTierPassive: null, gemSlots: null,
  reforge: { n: 3, max: 6 }, quality: { current: 15, max: 17, pct: 88, tier: "excellent", reachable: 16 },
  searchText: "", status: "free", locked: false, equippedBy: null,
  image: null, effectIcon: null, setIcon: null, class: null,
  iconPiece: { slot: "weapon", rarity: "legendary", stars: 6, enhance: 15, bt: 2, singularity: false },
  ...over,
} as UiPiece);

const ame = { uid: "h9", charId: 7, name: "Ame" } as unknown as Character;
const game = {
  sets: { "1": { name: "Attack Set", desc: null, levels: [{ level: 1, p2_desc: "ATK +10%", p4_desc: "ATK +25%" }] } },
} as unknown as GameData;

const body = (p: UiPiece, props: Omit<BodyProps, "piece" | "game">, g: GameData | null = null) =>
  renderToStaticMarkup(createElement(GearCardBody, { piece: p, game: g, ...props }));
const inventory = (p: UiPiece, extra: Partial<BodyProps> = {}, g: GameData | null = null) =>
  body(p, { effects: "card", onOptimizeWearer: () => {}, ...extra }, g);
const builder = (p: UiPiece, extra: Partial<BodyProps> = {}, g: GameData | null = null) =>
  body(p, { effects: "none", ...extra }, g);
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("GearCardBody — one body for the Inventory and the Builder", () => {
  it("the same piece, not projected, renders the same body", () => {
    const p = piece({ locked: true, singularity: true, effects: [{ stat: "atkPct", value: "12%", percent: true, name: null, desc: null, combatOnly: false }] });
    const inv = inventory(p, { equippedChar: null });
    expect(builder(p)).toBe(inv);
    expect(builder(p, { projection: { addedTicks: [0, 0, 0, 0], transistoneTicks: [0, 0, 0, 0] } })).toBe(inv);
  });

  it("only the wearer line differs: an Optimize button in the Inventory, a portrait in the Builder", () => {
    const inv = inventory(piece(), { equippedChar: ame });
    const bld = builder(piece(), { equippedChar: ame });
    expect(inv).toContain('aria-label="Optimize Ame →"');
    expect(bld).not.toContain("<button");
    expect(bld).toContain("FI_7.webp");
    const strip = (html: string) => html.replace(/<button[^>]*>(<img[^>]*>)<\/button>/, "$1");
    expect(strip(inv)).toBe(bld);
  });

  it("aligned on the Inventory: rarity / slot line, lock, horizontal gradient, +15 title, one substat width", () => {
    const p = piece({ locked: true, singularity: true, classLimit: "Striker", effects: [{ stat: "atkPct", value: "12%", percent: true, name: null, desc: null, combatOnly: false }] });
    for (const html of [inventory(p), builder(p)]) {
      expect(text(html)).toContain("Legendary");
      expect(text(html)).toContain("Striker Exclusive");
      expect(html).toContain('title="Locked in-game"');
      expect(html).toContain("linear-gradient(90deg");
      expect(text(html)).toContain("Blade - [Singularity]");
      expect(text(html)).toContain("Active Effect at +15 Enhancement");
      expect(html).toContain("w-30");
      expect(html).not.toContain("w-22");
    }
  });

  it("full header: the name wraps on two lines at most, slot and class on two spans beside the portrait", () => {
    const p = piece({ classLimit: "Striker", name: "A Very Long Weapon Name That Would Not Fit" });
    for (const html of [inventory(p, { equippedChar: ame }), builder(p, { equippedChar: ame })]) {
      const name = /<span class="([^"]*font-display[^"]*)"/.exec(html)![1]!.split(" ");
      expect(name).toEqual(expect.arrayContaining(["line-clamp-2", "min-w-0", "wrap-break-word"]));
      expect(name).not.toContain("truncate");
      expect(html).toContain('<span class="flex flex-wrap gap-x-2 text-white"><span>Weapon</span><span>Striker Exclusive</span></span>');
    }
    expect(builder(piece())).toContain('<span class="flex flex-wrap gap-x-2 text-white"><span>Weapon</span></span>');
  });

  it("main rolls in the icon's column, under rarity and slot, before the portrait and the subs", () => {
    const weapon = piece({ main: [
      { label: "ATK 500", stat: "atk", value: "500", percent: false, name: null },
      { label: "CRIT DMG 48%", stat: "critDmg", value: "48%", percent: true, name: "Critical Damage" },
    ] });
    for (const html of [inventory(weapon, { equippedChar: ame }), builder(weapon, { equippedChar: ame })]) {
      const at = (needle: string) => html.indexOf(needle);
      const order = ["data-equipment-icon", ">Legendary<", "<span>Weapon</span>", ">500<", ">48%<", "FI_7.webp", "LV 5"].map(at);
      for (const i of order) expect(i).toBeGreaterThan(-1);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(html).toMatch(/<span class="min-w-0 flex-1 truncate text-white" title="Critical Damage">Critical Damage<\/span>/);
      expect(html).toMatch(/<div class="flex items-center gap-1.5 font-mono text-\[12px\] tabular-nums">/);
      expect(html).not.toContain("text-[13px]");
    }
  });

  it("the Quality block — title, help, score, reachable, tier, bar — in both contexts", () => {
    for (const html of [inventory(piece()), builder(piece())]) {
      expect(html).toMatch(/<span>Quality<\/span><span tabindex="0" class="group inline-flex cursor-help/);
      expect(text(html)).toContain("15 / 17 → 16 reachableExcellent");
      expect(html).toContain("width:88%");
    }
  });
});

describe("GearCardBody — effects", () => {
  const passive = { name: "Fury", text: "Increases ATK by 10%." } as UiPiece["passive"];

  it('"card" renders the weapon passive, "none" leaves it out', () => {
    expect(text(inventory(piece({ passive })))).toContain("Increases ATK by 10%.");
    expect(text(builder(piece({ passive })))).not.toContain("Fury");
  });

  it('"card" renders the 2 / 4-pc set bonuses, "none" leaves them out', () => {
    const helmet = piece({ slot: "helmet", armorSetId: "1", bt: 3 });
    const inv = text(inventory(helmet, {}, game));
    expect(inv).toContain("Attack Set");
    expect(inv).toContain("2-pcATK +10%");
    expect(inv).toContain("4-pcATK +25%");
    const bld = text(builder(helmet, {}, game));
    expect(bld).not.toContain("Attack Set");
    expect(bld).not.toContain("2-pc");
  });

  it('"none" shows the EE as its image + gems, "card" shows all of it', () => {
    const ee = piece({ slot: "exclusive", name: "Dawn", main: [{ label: "ATK 30", stat: "atk", value: "30", percent: false, name: "EE ATK" }], subs: [], quality: null });
    expect(text(inventory(ee))).toContain("EE ATK");
    expect(text(builder(ee))).not.toContain("EE ATK");
  });
});

describe("GearCardBody — projection", () => {
  it("adds the projected ticks in cyan and the Transistone T+n", () => {
    const html = builder(piece(), { projection: { addedTicks: [0, 1, 0, 0], transistoneTicks: [1, 0, 0, 0] } });
    expect(html).toContain('(4 + 1<span class="text-cyan-300"> + 1</span>)');
    expect(text(html)).toContain("LV 6(4 + 1 + 1)");
    expect(html).toMatch(/title="Transistone: base tier 3 → 4">T\+1</);
  });

  it("without a projection, the line reads LV n (base + reforges)", () => {
    const t = text(inventory(piece()));
    expect(t).toContain("LV 5(4 + 1)");
    expect(t).toContain("LV 6(4 + 2)");
    expect(t).not.toContain("T+");
  });
});

describe("GearCardBody — header action", () => {
  it("the full card puts it at the end of the name's row, the compact one after the portrait", () => {
    const action = createElement("b", { "data-action": "" });
    const full = builder(piece(), { equippedChar: ame, headerAction: action });
    expect(full.indexOf("data-action")).toBeGreaterThan(full.indexOf(">Blade<"));
    expect(full.indexOf("data-action")).toBeLessThan(full.indexOf("data-equipment-icon"));
    const compact = builder(piece(), { equippedChar: ame, compact: true, headerAction: action });
    expect(compact.indexOf("data-action")).toBeGreaterThan(compact.indexOf("FI_7.webp"));
    expect(compact.indexOf("data-action")).toBeLessThan(compact.indexOf('title="LV '));
    expect(builder(piece())).not.toContain("ml-auto shrink-0 self-start");
  });
});

describe("GearCardBody — compact", () => {
  it("keeps the compact card: no icon, header enhance / T / stars, subs as icon + value with the details in the title", () => {
    const html = builder(piece(), { compact: true, projection: { addedTicks: [1, 0, 0, 0], transistoneTicks: [1, 0, 0, 0] } });
    expect(html).not.toContain("data-equipment-icon");
    expect(text(html)).toContain("6★|T2+15");
    expect(html).toContain('title="LV 5 (4 + 0 + 1) · Attack% · T+1"');
    expect(text(html)).toContain("15/17→16Exc.");
    expect(text(html)).not.toContain("Quality");
  });
});
