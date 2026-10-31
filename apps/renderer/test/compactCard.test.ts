// Compact Builder result cards (Settings › Solver › Compact result cards):
// short quality label, Singularity effects shortened to icon + value or a
// short name, substat cells reduced to icon + value with the details in the
// title, no equipment icon (enhance / breakthrough / stars in the header),
// gems as icons and one icon action in the footer — while the non-compact
// card keeps its icon and its full-width exclude button. Rendered
// server-side, the equipment icon mocked to a marker element.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiPiece } from "../src/design/adapter.js";
import { QUALITY_TIERS, qualityShortLabel } from "../src/lib/quality.js";

vi.mock("../src/design/EquipmentIcon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/design/EquipmentIcon.js")>()),
  EquipmentIcon: () => createElement("i", { "data-equipment-icon": "" }),
}));

const { ResultItemDetail, compactEffect, compactSubTitle, compactSubTone } = await import("../src/design/ResultGearDetail.js");

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
  return renderToStaticMarkup(createElement(ResultItemDetail, {
    piece: p, equippedChar: null, game: null, excluded, onToggleExclude: () => {},
    addedTicks: [1, 0, 0, 0], transistoneTicks: [1, 0, 0, 0], compact,
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

describe("ResultItemDetail — compact card", () => {
  it("no equipment icon; the header carries enhance, breakthrough and stars", () => {
    const html = render(piece(), true);
    expect(html).not.toContain("data-equipment-icon");
    expect(text(html)).toContain("+15T26★");
    expect(text(render(piece({ bt: 0, enhance: 0 }), true))).toContain("+06★");
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

  it("footer: a single icon action with its hover label", () => {
    const html = render(piece(), true);
    const buttons = [...html.matchAll(/<button([^>]*)>/g)].map((m) => m[1]!);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('aria-label="Exclude from solver"');
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(text(html)).not.toContain("Exclude from solver");
    const excluded = [...render(piece(), true, true).matchAll(/<button([^>]*)>/g)].map((m) => m[1]!);
    expect(excluded[0]).toContain('aria-label="Excluded from solver — click to include"');
    expect(excluded[0]).toContain('aria-pressed="true"');
  });
});

describe("ResultItemDetail — non-compact card", () => {
  it("keeps the equipment icon and the full-width exclude button", () => {
    const html = render(piece(), false);
    expect(html).toContain("data-equipment-icon");
    const button = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
    expect(button).toHaveLength(1);
    expect(button[0]![1]).toContain("w-full");
    expect(text(button[0]![2]!)).toBe("Exclude from solver");
  });
});
