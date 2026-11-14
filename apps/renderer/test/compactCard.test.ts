// Compact Builder result cards (Settings › Solver › Compact result cards):
// short quality label, Singularity effects shortened to icon + value or a
// short name, substat cells reduced to icon + value with the details in the
// title, no equipment icon (enhance / breakthrough / stars in the header),
// gems as icons and one icon action at the top right (G124, no footer), the
// Singularity +15 bonus as grade + short label + value — while the non-compact
// card keeps its icon and a labelled exclude button at the top right. The talisman's
// multi-tier passive moves to the name's title, and the EE + talisman share
// one card in the compact band (seven cells), each compact card at its own
// content height (no row stretch). The header's stars and breakthrough sit
// above the enhance; the band is a fluid grid whose cards take their column
// (`w-full`), the card outside it keeping its fixed width. Rendered server-side, the
// equipment icon mocked to a marker element.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";
import type { SlotDiff } from "../src/lib/buildDiff.js";
import type { SolveBuild } from "../src/lib/solver/types.js";
import { QUALITY_TIERS, qualityShortLabel } from "../src/lib/quality.js";

vi.mock("../src/design/EquipmentIcon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/design/EquipmentIcon.js")>()),
  EquipmentIcon: () => createElement("i", { "data-equipment-icon": "" }),
}));

const { GearCardPanel, ResultPairDetail } = await import("../src/design/GearCard.js");
const { compactEffect, compactPassiveTitle, compactSubTitle, compactSubTone, singularityGrade, singularityShortLabel } = await import("../src/design/gearCardText.js");
const { BottomGearBand, COMPACT_GEAR_GRID } = await import("../src/screens/builder/BottomGearBand.js");

const effect = (over: Partial<UiPiece["effects"][number]>): UiPiece["effects"][number] =>
  ({ stat: "atkPct", value: "12%", percent: true, name: null, desc: null, combatOnly: false, ...over });

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
  reforge: { n: 3, max: 6 }, quality: { current: 17, max: 17, pct: 100, tier: "perfect" },
  searchText: "", status: "free", locked: false, equippedBy: null,
  image: null, effectIcon: null, setIcon: null, class: null,
  iconPiece: { slot: "weapon", rarity: "legendary", stars: 6, enhance: 15, bt: 2, singularity: false },
  ...over,
} as UiPiece);

function render(p: UiPiece, compact: boolean, excluded = false): string {
  return renderToStaticMarkup(createElement(GearCardPanel, {
    piece: p, equippedChar: null, game: null, excluded, onToggleExclude: () => {},
    projection: { addedTicks: [1, 0, 0, 0], transistoneTicks: [1, 0, 0, 0] }, effects: "none", compact,
  }));
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Each element carrying a `title` that starts with `prefix`: [title, visible text]. */
function titled(html: string, prefix: string): [string, string][] {
  return [...html.matchAll(/<div[^>]*title="([^"]*)"[^>]*>(.*?)<\/div>/g)]
    .filter((m) => m[1]!.startsWith(prefix))
    .map((m) => [m[1]!, text(m[2]!)]);
}

describe("qualityShortLabel", () => {
  it("abbreviates the five tiers", () => {
    expect(QUALITY_TIERS.map(qualityShortLabel)).toEqual(["Poor", "Dec.", "Good", "Exc.", "Perf."]);
  });
});

describe("compactEffect", () => {
  it("stat + value → icon + signed value, long label in the title", () => {
    expect(compactEffect(effect({}))).toEqual({ kind: "stat", stat: "atkPct", value: "+12%", title: "Attack% +12%" });
    expect(compactEffect(effect({ stat: "spd", value: "-5", name: "Speed down" })))
      .toEqual({ kind: "stat", stat: "spd", value: "-5", title: "Speed down -5" });
  });

  it("description → its name, or its first 24 untagged characters + …, full text in the title", () => {
    const desc = "Increases <color=#ffd200>Attack</color> by 10% at the start of battle.";
    const plain = "Increases Attack by 10% at the start of battle.";
    expect(compactEffect(effect({ desc, name: "Fury" }))).toEqual({ kind: "text", text: "Fury", title: plain });
    expect(compactEffect(effect({ desc }))).toEqual({ kind: "text", text: "Increases Attack by 10%…", title: plain });
    expect(compactEffect(effect({ desc: "Short <color=#fff>one</color>" }))).toEqual({ kind: "text", text: "Short one", title: "Short one" });
  });

  it("a known Singularity option → grade + short label + signed value, untagged desc in the title", () => {
    const desc = "<color=#ff00ff>S+</color> DMG increases by <color=#0D99DA>12%</color> within Dimensional Singularity";
    expect(compactEffect(effect({ stat: "dmgUp", value: "12%", name: "Increased DMG within Dimensional Singularity", desc }))).toEqual({
      kind: "short", grade: { grade: "S+", color: "#ff00ff" }, label: "DS DMG+", stat: "dmgUp", value: "+12%",
      title: "S+ DMG increases by 12% within Dimensional Singularity",
    });
    const reduce = "<color=#27D054>C</color> DMG taken from Fire-type targets decreases by <color=#0D99DA>20%</color>";
    expect(compactEffect(effect({ stat: "dmgReduce", value: "20%", name: "Reduced DMG Taken vs Fire", desc: reduce }))).toMatchObject({
      kind: "short", grade: { grade: "C", color: "#27D054" }, label: "vs Fire DMG-", value: "+20%",
    });
  });

  it("a desc whose name isn't a known option stays text", () => {
    expect(compactEffect(effect({ desc: "<color=#27D054>C</color> Something else", name: "Fury" })).kind).toBe("text");
  });
});

describe("singularityShortLabel", () => {
  const ELEMENTS = ["Fire", "Water", "Earth", "Light", "Dark"];

  it("every option name of the table → its short label", () => {
    for (const el of ELEMENTS) {
      expect(singularityShortLabel(`DMG Increase vs ${el}`)).toBe(`vs ${el} DMG+`);
      expect(singularityShortLabel(`Reduced DMG Taken vs ${el}`)).toBe(`vs ${el} DMG-`);
    }
    expect(singularityShortLabel("Increased DMG within Dimensional Singularity")).toBe("DS DMG+");
    expect(singularityShortLabel("Reduced DMG taken within Dimensional Singularity")).toBe("DS DMG-");
    expect(singularityShortLabel("Ultimate Skill DMG increases within Dimensional Singularity")).toBe("DS Ult DMG+");
    expect(singularityShortLabel("DMG Increase to target ")).toBe("DMG+");
    expect(singularityShortLabel("Reduced DMG Taken from targets")).toBe("DMG-");
  });

  it("case and edge spaces tolerated; unknown names and null → null", () => {
    expect(singularityShortLabel("  dmg increase VS fire ")).toBe("vs fire DMG+");
    expect(singularityShortLabel("Reduced DMG Taken within Dimensional Singularity")).toBe("DS DMG-");
    expect(singularityShortLabel("DMG Increase vs Wind")).toBeNull();
    expect(singularityShortLabel("Fury")).toBeNull();
    expect(singularityShortLabel("")).toBeNull();
    expect(singularityShortLabel(null)).toBeNull();
  });
});

describe("singularityGrade", () => {
  it("leading grade letter and its color", () => {
    expect(singularityGrade("<color=#27D054>C</color> DMG dealt to Earth-type targets increases by <color=#0D99DA>40%</color>"))
      .toEqual({ grade: "C", color: "#27D054" });
    expect(singularityGrade("<color=#0EA8F5>B</color> DMG taken decreases")).toEqual({ grade: "B", color: "#0EA8F5" });
    expect(singularityGrade("<color=#ff00ff>S+</color> DMG increases")).toEqual({ grade: "S+", color: "#ff00ff" });
  });

  it("no leading grade, or no desc → null", () => {
    expect(singularityGrade("DMG dealt increases by <color=#0D99DA>40%</color>")).toBeNull();
    expect(singularityGrade("<color=#0D99DA>40%</color> more DMG")).toBeNull();
    expect(singularityGrade(null)).toBeNull();
  });
});

describe("compact substat cell", () => {
  it("title carries LV, the reforge split and the Transistone mark", () => {
    expect(compactSubTitle({ stat: "atkPct", lv: 5, reforges: 1 }, 0, 1)).toBe("LV 5 (4 + 1) · Attack% · T+1");
    expect(compactSubTitle({ stat: "atkPct", lv: 6, reforges: 2 }, 1)).toBe("LV 6 (4 + 1 + 1) · Attack%");
    expect(compactSubTitle({ stat: "spd", lv: 3, reforges: 0 })).toBe("LV 3 · Speed");
  });

  it("tone: cyan for projected ticks (wins over Transistone), violet, amber at cap, white", () => {
    expect(compactSubTone(6, 1, 1)).toBe("cyan");
    expect(compactSubTone(6, 0, 1)).toBe("violet");
    expect(compactSubTone(6, 0, 0)).toBe("amber");
    expect(compactSubTone(5, 0, 0)).toBe("white");
  });
});

describe("GearCardPanel — compact card", () => {
  it("no equipment icon; the header carries enhance, breakthrough and stars", () => {
    const html = render(piece(), true);
    expect(html).not.toContain("data-equipment-icon");
    expect(text(html)).toContain("6★|T2+15");
    expect(text(render(piece({ bt: 0, enhance: 0 }), true))).toContain("6★+0");
  });

  it("header on two right-aligned lines: « 6★ | T3 » then « +15 », « 6★ » alone then « +0 » without breakthrough", () => {
    const head = (p: UiPiece) => {
      const html = render(p, true);
      const block = /<span class="[^"]*flex-col items-end[^"]*">(.*?<span title="Enhance level">[^<]*<\/span>)<\/span>/.exec(html)![1]!;
      return /^<span class="flex items-center gap-1">(.*?)<\/span>(<span title="Enhance level">.*)$/.exec(block)!.slice(1).map(text);
    };
    expect(head(piece({ enhance: 15, bt: 3, stars: 6 }))).toEqual(["6★|T3", "+15"]);
    expect(head(piece({ enhance: 0, bt: 0, stars: 6 }))).toEqual(["6★", "+0"]);
    const html = render(piece({ bt: 3 }), true);
    expect(html).toContain('<span class="text-white/30">|</span>');
    for (const t of ["Stars", "Breakthrough", "Enhance level"]) expect(html).toContain(`title="${t}"`);
  });

  it("the name wraps instead of being cut", () => {
    const name = /<span class="([^"]*font-display[^"]*)"/.exec(render(piece(), true))![1]!.split(" ");
    expect(name).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "leading-tight", "wrap-break-word"]));
    expect(name).not.toContain("truncate");
  });

  it("substat cells show icon + value only; LV and +n go to the title", () => {
    const cells = titled(render(piece(), true), "LV ");
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual(["LV 5 (4 + 0 + 1) · Attack% · T+1", "+7.5%"]);
    for (const [, visible] of cells) expect(visible).not.toMatch(/LV|T\+/);
    expect(cells.map(([, v]) => v)).toEqual(["+7.5%", "+4%", "+8", "+120"]);
  });

  it("gems: five icons, details in the titles, no visible text", () => {
    const gemSlots: UiPiece["gemSlots"] = [
      { unlocked: true, gem: { type: "ATK", level: 6, stat: "atkPct", percent: true, value: 8 } },
      { unlocked: true, gem: null },
      { unlocked: false, gem: null },
      { unlocked: false, gem: null },
      { unlocked: false, gem: null },
    ];
    const html = render(piece({ slot: "talisman", subs: [], gemSlots, quality: null }), true);
    expect(html).toContain('title="Lv 6 · Attack% +8%"');
    expect(html).toContain('title="Empty gem slot"');
    expect(html.match(/title="Locked — unlocks at enhance \+5"/g)).toHaveLength(3);
    expect(text(html)).not.toMatch(/Lv 6|Empty|Locked/);
  });

  it("quality on one line: score, →reachable, short tier", () => {
    const html = render(piece({ quality: { current: 14, max: 17, pct: 82, tier: "good", reachable: 15 } }), true);
    expect(text(html)).toContain("14/17→15Good");
    expect(text(html)).not.toContain("reachable");
  });

  it("Singularity effects on one line, shortened", () => {
    const effects = [effect({}), effect({ desc: "Grants a shield equal to 20% of max HP." })];
    const t = text(render(piece({ singularity: true, effects }), true));
    expect(t).toContain("+12%Grants a shield equal to…");
  });

  it("the +15 bonus reads grade + short label + value, not the truncated game name", () => {
    const desc = "<color=#ff00ff>S+</color> DMG increases by <color=#0D99DA>12%</color> within Dimensional Singularity";
    const effects = [effect({ stat: "dmgUp", value: "12%", name: "Increased DMG within Dimensional Singularity", desc })];
    const html = render(piece({ singularity: true, effects }), true);
    // Markup: grade, icon (no text), label and value as sibling spans — no spaces between them.
    expect(text(html)).toContain("S+DS DMG++12%");
    expect(text(html)).not.toContain("Increased DMG within");
    expect(html).toContain('title="S+ DMG increases by 12% within Dimensional Singularity"');
    expect(html).toContain("color:#ff00ff");
  });

  it("top right: a single icon action with its hover label, in the header row, no footer", () => {
    const html = render(piece(), true);
    const buttons = [...html.matchAll(/<button([^>]*)>/g)].map((m) => m[1]!);
    expect(buttons).toHaveLength(1);
    // After the header's enhance, before the substats; nothing under the body.
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf('title="Enhance level"'));
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf('title="LV '));
    expect(html).not.toContain("border-t");
    expect(buttons[0]).toContain('aria-label="Never use"');
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(text(html)).not.toContain("Never use");
    const excluded = [...render(piece(), true, true).matchAll(/<button([^>]*)>/g)].map((m) => m[1]!);
    expect(excluded[0]).toContain('aria-label="Never used — click to allow"');
    expect(excluded[0]).toContain('aria-pressed="true"');
  });
});

describe("GearCardPanel — non-compact card", () => {
  it("keeps the equipment icon; Never use sits at the top right, in the name's row, no footer", () => {
    const html = render(piece(), false);
    expect(html).toContain("data-equipment-icon");
    const button = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
    expect(button).toHaveLength(1);
    expect(button[0]![1]).not.toContain("w-full");
    expect(button[0]![1]).toContain('aria-pressed="false"');
    expect(button[0]![2]).toContain("<svg");
    expect(text(button[0]![2]!)).toBe("Never use");
    // After the name, before the icon row; the card has no footer left.
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf(">Blade<"));
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf("data-equipment-icon"));
    expect(html).not.toContain("border-t");
    const excluded = [...render(piece(), false, true).matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
    expect(excluded[0]![1]).toContain('aria-pressed="true"');
    expect(excluded[0]![1]).toContain("rose");
    expect(text(excluded[0]![2]!)).toBe("Never used — click to allow");
  });
});

describe("talisman multi-tier passive", () => {
  const multiTierPassive: UiPiece["multiTierPassive"] = {
    name: "Charm passive",
    tiers: [
      { unlockLevel: 0, isAdd: false, active: true, desc: "Base: <color=#ffd200>ATK</color> +5%" },
      { unlockLevel: 5, isAdd: true, active: true, desc: "Adds: Speed +3" },
      { unlockLevel: 10, isAdd: true, active: false, desc: "Locked: CRIT +4%" },
    ],
  };
  const talisman = piece({ slot: "talisman", name: "Charm", subs: [], quality: null, multiTierPassive });
  const nameTitle = (html: string) => html.match(/<span[^>]*title="([^"]*)"[^>]*>Charm<\/span>/)?.[1];

  it("title text: visible tiers, active first, untagged, joined by ·", () => {
    expect(compactPassiveTitle([
      { isAdd: false, active: true, desc: "Base" },
      { isAdd: true, active: false, desc: "Later <color=#fff>tier</color>" },
      { isAdd: true, active: true, desc: "Now" },
    ])).toBe("Base · Now · Later tier");
    // An unlocked upgrade (non-additive later tier) hides the base tier.
    expect(compactPassiveTitle([
      { isAdd: false, active: true, desc: "Base" },
      { isAdd: false, active: true, desc: "Upgraded" },
    ])).toBe("Upgraded");
  });

  it("compact: not rendered, carried by the name's title", () => {
    const html = render(talisman, true);
    expect(text(html)).not.toMatch(/Base:|Adds:|Locked:/);
    expect(nameTitle(html)).toBe("Charm\nBase: ATK +5% · Adds: Speed +3 · Locked: CRIT +4%");
  });

  it("non-compact: still rendered", () => {
    const t = text(render(talisman, false));
    expect(t).toContain("Base: ATK +5%");
    expect(t).toContain("Locked: CRIT +4%");
  });
});

describe("ResultPairDetail — compact EE + talisman card", () => {
  const ee = piece({ id: "ee1", slot: "exclusive", name: "Blade of Dawn", main: [], subs: [], quality: null });
  const tal = piece({ id: "t1", slot: "talisman", name: "Charm", subs: [], quality: null });
  const cell = (p: UiPiece | null, emptyLabel: string) =>
    ({ piece: p, equippedChar: null, excluded: false, onToggleExclude: () => {}, emptyLabel });
  const renderPair = (top: UiPiece | null, bottom: UiPiece | null) =>
    renderToStaticMarkup(createElement(ResultPairDetail, { top: cell(top, "No EE"), bottom: cell(bottom, "No talisman"), game: null, compact: true }));

  it("one w-56 container, both names, two exclude actions named after their piece", () => {
    const html = renderPair(ee, tal);
    expect(html.match(/<aside/g)).toHaveLength(1);
    expect(html).toContain("w-56");
    expect(text(html)).toContain("EE");
    expect(text(html)).toContain("Charm");
    const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["Never use EE", "Never use talisman"]);
  });

  it("each half's action at its own top right: EE's in its header, the talisman's after its name", () => {
    const html = renderPair(ee, tal);
    const [first, second] = [...html.matchAll(/<button/g)].map((m) => m.index!);
    expect(first).toBeGreaterThan(html.indexOf(">EE<"));
    expect(first).toBeLessThan(html.indexOf(">Charm<"));
    expect(second).toBeGreaterThan(html.indexOf(">Charm<"));
    // The only rule left is the one between the two halves.
    expect(html.match(/border-t/g)).toHaveLength(1);
  });

  it("a missing piece shows its empty label, without an action", () => {
    const html = renderPair(ee, null);
    expect(text(html)).toContain("No talisman");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(text(renderPair(null, tal))).toContain("No EE");
  });
});

describe("BottomGearBand — compact band", () => {
  const SLOTS = ["weapon", "exclusive", "helmet", "armor", "accessory", "ooparts", "gloves", "boots"];
  const gear = (slot: string): GearPiece => ({
    uid: `u-${slot}`, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "epic", star: 6, name: `P-${slot}`, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy: null, main: [], subs: [],
  }) as unknown as GearPiece;
  const diff: SlotDiff[] = SLOTS.map((slot) => ({ slot, proposed: gear(slot), worn: null, changed: true }) as SlotDiff);
  const game = { equipment: {}, sets: {} } as unknown as GameData;
  const renderBand = (compact: boolean) => renderToStaticMarkup(createElement(BottomGearBand, {
    build: null, diff, game, reforge: { reforgeMode: "disable", priority: {} }, charsByUid: new Map(),
    excludedPieceUids: new Set<string>(), onToggleExclude: () => {}, compact,
  }));

  it("order: weapon, EE + talisman, helmet, armor, accessory, gloves, boots", () => {
    expect(COMPACT_GEAR_GRID).toEqual(["weapon", ["exclusive", "talisman"], "helmet", "armor", "accessory", "gloves", "boots"]);
  });

  it("compact: seven cells, one of them double (EE above the talisman)", () => {
    const html = renderBand(true);
    const cells = html.split("<aside").slice(1);
    expect(cells).toHaveLength(7);
    const pair = cells[1]!;
    expect(pair.indexOf(">EE<")).toBeGreaterThan(-1);
    expect(pair.indexOf(">EE<")).toBeLessThan(pair.indexOf(">P-ooparts<"));
    expect(cells.filter((c) => c.includes("P-ooparts") || c.includes(">EE<"))).toHaveLength(1);
  });

  it("non-compact: eight cards", () => {
    expect(renderBand(false).match(/<aside/g)).toHaveLength(8);
  });

  it("each card's Never use sits in its header, no footer in the Optimizer", () => {
    for (const compact of [false, true]) {
      const html = renderBand(compact);
      expect(html).not.toContain("border-t border-white/8 px-4");
      expect(html.match(/<button/g)).toHaveLength(8);
    }
  });

  it("an empty card names its slot, never the Inventory's tile prompt", () => {
    const noWeapon = diff.filter((d) => d.slot !== "weapon" && d.slot !== "exclusive");
    const band = (build: SolveBuild | null, compact: boolean) => text(renderToStaticMarkup(createElement(BottomGearBand, {
      build, diff: build ? noWeapon : [], game, reforge: { reforgeMode: "disable", priority: {} }, charsByUid: new Map(),
      excludedPieceUids: new Set<string>(), onToggleExclude: () => {}, compact,
    })));
    const solved = {} as SolveBuild;
    for (const compact of [false, true]) {
      expect(band(solved, compact)).toContain("No weapon in this build");
      expect(band(solved, compact)).toContain("No EE in this build");
      expect(band(null, compact)).toContain("No boots yet");
      expect(band(null, compact)).not.toContain("Click a tile");
      expect(band(null, compact)).not.toContain("No piece selected");
    }
    expect(band(null, false)).toContain("Solve, then pick a build in the table.");
  });

  const rootClass = (html: string) => /^<div class="([^"]*)"/.exec(html)![1]!.split(" ");
  const asideClasses = (html: string) => [...html.matchAll(/<aside class="([^"]*)"/g)].map((m) => m[1]!.split(" "));

  it("compact: cells and rows don't stretch, no card fills its row", () => {
    const html = renderBand(true);
    expect(rootClass(html)).toEqual(expect.arrayContaining(["items-start", "content-start"]));
    const asides = asideClasses(html);
    expect(asides).toHaveLength(7);
    for (const c of asides) expect(c).not.toContain("h-full");
  });

  it("non-compact: the band stretches and its eight cards fill their row", () => {
    const html = renderBand(false);
    expect(rootClass(html)).not.toContain("items-start");
    const asides = asideClasses(html);
    expect(asides).toHaveLength(8);
    for (const c of asides) expect(c).toContain("h-full");
  });

  it("a fluid grid of at most four columns, no max-content; the band's cards take their column (w-full)", () => {
    for (const [compact, min] of [[true, "224px"], [false, "320px"]] as const) {
      const html = renderBand(compact);
      const root = rootClass(html);
      expect(root).toContain("grid");
      expect(root).toContain(`grid-cols-[repeat(auto-fit,minmax(max(${min},calc((100%_-_24px)/4)),1fr))]`);
      expect(html).not.toContain("max-content");
      expect(html).not.toMatch(/min-\[1(232|616)px\]/);
      for (const c of asideClasses(html)) {
        expect(c).toContain("w-full");
        expect(c).not.toContain("w-56");
        expect(c).not.toContain("w-80");
      }
    }
  });

  it("outside the band the card keeps its fixed width: w-80 in Gear › Pieces, w-56 compact", () => {
    const card = (compact: boolean, p: UiPiece | null) => asideClasses(renderToStaticMarkup(createElement(GearCardPanel, {
      piece: p, equippedChar: null, game: null, effects: "card", compact,
    })))[0]!;
    for (const p of [piece(), null]) {
      expect(card(false, p)).toContain("w-80");
      expect(card(true, p)).toContain("w-56");
      expect(card(false, p)).not.toContain("w-full");
    }
  });

  it("compact empty card keeps its content height, the non-compact one fills", () => {
    const empty = (compact: boolean) => renderToStaticMarkup(createElement(GearCardPanel, { piece: null, equippedChar: null, game: null, effects: "none", compact }));
    expect(empty(true)).toContain("No piece in this build");
    expect(empty(true)).not.toContain("Click a tile");
    expect(asideClasses(empty(true))[0]).not.toContain("h-full");
    expect(asideClasses(empty(false))[0]).toContain("h-full");
  });
});
