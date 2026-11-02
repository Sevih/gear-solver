// Gear tab (U13): Home dissolved into Gear › Overview, beside Pieces and
// Scrap. Rendered server-side with `gs.gear.view` stubbed: without a capture
// the first-capture steps (Heroes too), with one the sub-tab bar and the
// view — Overview without the cards that moved to the header and Settings,
// Pieces with its All / Gear / Special Gear sub-tabs, Scrap on the "Scrap
// candidates" filters while its session key is empty.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GearPiece, GearSlot, Inventory } from "@gear-solver/core";
import { GearScreen } from "../src/screens/gear/GearScreen.js";
import { scrapDefaultFilters } from "../src/screens/inventory/InventoryScreen.js";
import { SCRAP_CANDIDATES } from "../src/lib/storage/inventoryFilterPresets.js";
import { BuildsScreen } from "../src/screens/BuildsScreen.js";

const noop = () => {};

/** A getItem-only Web Storage over `store` (the render runs no effect, so
 *  nothing is written). */
function stubStorage(store: Record<string, string>) {
  const stub = { getItem: (k: string) => (k in store ? store[k] : null), setItem: noop };
  vi.stubGlobal("localStorage", stub);
  vi.stubGlobal("sessionStorage", stub);
}
afterEach(() => vi.unstubAllGlobals());

const piece = (uid: string, slot: GearSlot, ticks: number[]): GearPiece => ({
  uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy: null, main: [],
  subs: ticks.map((t) => ({ stat: "atkPct", value: 4 * t, percent: true, ticks: t, reforgeTicks: 0 })),
});
const inventory = { gear: [piece("1", "helmet", [4, 4, 3, 3]), piece("2", "ooparts", [])], characters: [] } as unknown as Inventory;

function render(inv: Inventory | null, view?: string, local: Record<string, string> = {}) {
  stubStorage({ ...(view ? { "gs.gear.view": JSON.stringify(view) } : {}), ...local });
  return renderToStaticMarkup(createElement(GearScreen, {
    inventory: inv, game: null, capStatus: null, steam: null, onOpenSetup: noop,
  }));
}

/** The labels of the Gear sub-tab bar, in order. */
function viewBar(html: string): string[] {
  const bar = html.slice(0, html.indexOf("</div>", html.indexOf("border-b")));
  return [...bar.matchAll(/<button[^>]*>([A-Za-z]+)/g)].map((m) => m[1]!);
}

describe("GearScreen", () => {
  it("shows the first-capture steps without an inventory, whatever the view", () => {
    for (const view of [undefined, "overview", "pieces", "scrap"]) {
      const html = render(null, view);
      expect(html).toContain("No account captured yet");
      expect(html).toContain("Heroes and Gear fill in on their own");
      expect(html).not.toContain("No capture yet");
    }
  });

  it("opens on Overview: the bar, the quality distribution, none of the cards that moved", () => {
    for (const html of [render(inventory), render(inventory, "overview")]) {
      expect(viewBar(html)).toEqual(["Overview", "Pieces", "Scrap"]);
      expect(html).toContain("Gear quality distribution");
      expect(html).toContain("Roster");
      expect(html).toContain("Gear breakdown");
      expect(html).toMatch(/2<\/span> pieces/);
      for (const gone of ["Account snapshot", "Library", "System health", "Sync game data", "Open Optimizer"]) expect(html).not.toContain(gone);
    }
  });

  it("Pieces: the All / Gear / Special Gear sub-tabs", () => {
    const html = render(inventory, "pieces");
    expect(viewBar(html)).toEqual(["Overview", "Pieces", "Scrap"]);
    for (const label of [">All<", ">Gear<", ">Special Gear<"]) expect(html).toContain(label);
    expect(html).not.toContain("Gear quality distribution");
    expect(html).not.toContain(SCRAP_CANDIDATES.name);
  });

  it("Scrap: the Scrap candidates link, and why no card when the tables lack scrap prices", () => {
    const html = render(inventory, "scrap");
    expect(html).toContain(SCRAP_CANDIDATES.name);
    expect(html).toContain("The loaded game tables carry no scrap prices");
    for (const label of [">All<", ">Gear<", ">Special Gear<"]) expect(html).toContain(label);
  });
});

describe("Scrap filters", () => {
  it("default to the built-in Scrap candidates preset", () => {
    expect(scrapDefaultFilters()).toEqual(SCRAP_CANDIDATES.filters());
  });

  // One getItem-only store stands in for both Web Storages here.
  const junk = { id: "u1", name: "Junk sets", filters: JSON.stringify({ stars: [4] }), createdAt: 0 };
  const chosen = { "gs.inv.filterPresets": JSON.stringify([junk]), "gs.gear.scrap.default": JSON.stringify("u1") };

  it("follow the filter set chosen with Use for Scrap, and its link carries the set's name", () => {
    stubStorage(chosen);
    expect(scrapDefaultFilters().stars).toEqual(new Set([4]));
    const html = render(inventory, "scrap", chosen);
    expect(html).toContain(">Junk sets</button>");
    expect(html).toContain('title="Back to the filters Gear › Scrap opens on"');
    expect(html).not.toContain(`>${SCRAP_CANDIDATES.name}</button>`);
  });

  it("the built-in's link title adds its description", () => {
    expect(render(inventory, "scrap")).toContain(`title="Back to the filters Gear › Scrap opens on — ${SCRAP_CANDIDATES.title}"`);
  });
});

describe("Heroes without a capture", () => {
  it("shows the first-capture steps", () => {
    stubStorage({});
    const html = renderToStaticMarkup(createElement(BuildsScreen, {
      inventory: null, game: null, userGeasLevels: null, userCodexLevel: null,
      heroPriority: {}, onHeroPriorityChange: noop, debug: false, onOptimize: noop,
      worklistClaims: {}, steam: null, onOpenSetup: noop,
    }));
    expect(html).toContain("No account captured yet");
    expect(html).toContain("Step by step in Settings › Setup");
  });
});
