// Inventory FilterModal markup: a value selected in the draft but absent from
// the current view's availabilities (a filter preset loaded on another tab or
// scope) stays rendered, marked unavailable and clickable, so there is always
// a pill to remove. Rendered server-side with the portal mocked to its children.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignRarity } from "../src/design/tokens.js";
import type { QualityTier } from "../src/lib/quality.js";
import { emptyFilters, type FilterState } from "../src/screens/inventory/filters.js";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: unknown) => children,
}));
(globalThis as { document?: unknown }).document ??= { body: null };
// The presets row reads localStorage on mount.
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {} };

const { FilterModal, scrapDefaultButton } = await import("../src/screens/inventory/FilterModal.js");

function render(current: FilterState, scrapMode = false, availablePassives?: Set<string>): string {
  return renderToStaticMarkup(createElement(FilterModal, {
    open: true, onClose: () => {}, current, onApply: () => {}, scrapMode, availablePassives,
    availableMains: new Set(["atkPct"]), availableSubs: new Set(["atkPct"]),
    availableArmorSets: new Map([["7", "Sharp"]]), availableClasses: new Set<string>(),
    availableStars: new Set([6]), availableRarities: new Set<DesignRarity>(["legendary"]),
    availableQualities: new Set<QualityTier>(["good"]), availableReachable: new Set<QualityTier>(["good"]),
    armorSetName: (id: string) => (id === "12" ? "Swift" : `Set #${id}`),
  }));
}

/** The opening tag of each <button> whose text contains `label`. */
function buttons(html: string, label: string): string[] {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)]
    .filter((m) => m[2]!.replace(/<[^>]+>/g, "").includes(label))
    .map((m) => m[1]!);
}

const UNAVAILABLE = 'title="No piece in the current view"';

describe("FilterModal — selection outside the current view", () => {
  it("a selected sub absent from the view stays rendered, marked, clickable", () => {
    const [eff] = buttons(render({ ...emptyFilters(), subs: new Set(["eff"]) }), "EFF");
    expect(eff).toContain(UNAVAILABLE);
    expect(eff).not.toContain("pointer-events-none");
  });

  it("main, class and set selections absent from the view are rendered too", () => {
    const html = render({ ...emptyFilters(), mains: new Set(["spd"]), classes: new Set(["Healer"]) });
    expect(buttons(html, "SPD")[0]).toContain(UNAVAILABLE);
    expect(buttons(html, "Healer")[0]).toContain(UNAVAILABLE);
    const sets = render({ ...emptyFilters(), armorSets: new Set(["12"]) });
    expect(buttons(sets, "Swift")[0]).toContain(UNAVAILABLE);
    expect(buttons(sets, "Sharp")[0]).not.toContain(UNAVAILABLE);
  });

  it("star, grade, quality and reachable selections absent from the view are clickable", () => {
    const html = render({
      ...emptyFilters(), stars: new Set([5]), rarities: new Set<DesignRarity>(["epic"]),
      quality: new Set<QualityTier>(["perfect"]), reachable: new Set<QualityTier>(["perfect"]),
    });
    for (const label of ["5★", "Epic"]) {
      const [tag] = buttons(html, label);
      expect(tag).toContain(UNAVAILABLE);
      expect(tag).not.toContain("pointer-events-none");
    }
    const perfect = buttons(html, "Perfect");
    expect(perfect).toHaveLength(2);
    for (const tag of perfect) {
      expect(tag).toContain(UNAVAILABLE);
      expect(tag).not.toContain("pointer-events-none");
    }
  });

  it("an unselected value absent from the view stays disabled, an available one unmarked", () => {
    const html = render(emptyFilters());
    expect(buttons(html, "4★")[0]).toContain("pointer-events-none");
    expect(buttons(html, "4★")[0]).not.toContain(UNAVAILABLE);
    expect(buttons(html, "EFF")).toHaveLength(0);
    expect(html).not.toContain(UNAVAILABLE);
  });
});

// Nothing selected on a static render: the Scrap default's mark and button
// state are checked through the PresetsRow's initial `selected` ("").
describe("FilterModal — Use for Scrap", () => {
  it("only from Gear › Scrap; disabled while no filter set is selected", () => {
    expect(buttons(render(emptyFilters()), "Use for Scrap")).toHaveLength(0);
    const [tag] = buttons(render(emptyFilters(), true), "Use for Scrap");
    expect(tag).toContain("disabled");
  });

  const add = { label: "Use for Scrap", title: "Gear › Scrap opens on this filter set too, as one more rule" };

  it("Use for Scrap on a set outside the list, Drop from Scrap on a set in it", () => {
    const builtin = "builtin:scrap-candidates";
    expect(scrapDefaultButton("u1", true, [builtin])).toEqual({ ...add, disabled: false });
    expect(scrapDefaultButton("", false, [builtin])).toEqual({ ...add, disabled: true });
    expect(scrapDefaultButton("u1", true, [builtin, "u1"]))
      .toEqual({ label: "Drop from Scrap", disabled: false, title: "Gear › Scrap stops opening on this filter set" });
    expect(scrapDefaultButton(builtin, true, [builtin, "u1"]))
      .toEqual({ label: "Drop from Scrap", disabled: false, title: "Gear › Scrap stops opening on this filter set" });
    expect(scrapDefaultButton("u1", true, ["u1"]))
      .toEqual({ label: "Drop from Scrap", disabled: false, title: "Gear › Scrap goes back to opening on Scrap candidates" });
  });

  it("the built-in alone can't be dropped", () => {
    expect(scrapDefaultButton("builtin:scrap-candidates", true, ["builtin:scrap-candidates"]))
      .toEqual({ label: "Drop from Scrap", disabled: true, title: "Gear › Scrap opens on this filter set alone" });
  });

  it("marks the Scrap default in the list, only from Gear › Scrap", () => {
    expect(render(emptyFilters(), true)).toContain("Scrap candidates (Scrap default)");
    expect(render(emptyFilters())).not.toContain("(Scrap default)");
  });

  it("marks every set of the list", () => {
    const presets = [{ id: "u1", name: "Junk", filters: "{}", createdAt: 0 }, { id: "u2", name: "Other", filters: "{}", createdAt: 0 }];
    const local = {
      "gs.inv.filterPresets": JSON.stringify(presets),
      "gs.gear.scrap.default": JSON.stringify(["builtin:scrap-candidates", "u1"]),
    };
    const prev = globalThis.localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => local[k as keyof typeof local] ?? null, setItem: () => {} };
    try {
      const html = render(emptyFilters(), true);
      expect(html).toContain("Scrap candidates (Scrap default)");
      expect(html).toContain("Junk (Scrap default)");
      expect(html).not.toContain("Other (Scrap default)");
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });
});

describe("FilterModal — +15 passive", () => {
  const DS = "Increased DMG within Dimensional Singularity";
  const available = new Set([DS, "DMG Increase vs Fire"]);
  /** The grade picker of the section, opening tag. */
  const gradeSelect = (html: string) => html.match(/<span role="radiogroup" aria-label="Minimum passive grade"[^>]*>/)?.[0] ?? null;
  /** Its letter buttons, opening-tag attributes and text. */
  const gradeLetters = (html: string) =>
    [...(html.match(/<span role="radiogroup" aria-label="Minimum passive grade"[^>]*>(.*?)<\/span>/)?.[1] ?? "").matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
      .map((m) => ({ attrs: m[1]!, text: m[2]! }));

  it("no passive in the view and none ticked → no section", () => {
    const html = render(emptyFilters());
    expect(html).not.toContain("+15 passive");
    expect(gradeSelect(html)).toBeNull();
  });

  it("one pill per family of the view, by short label, full name in the title; the grade selector disabled while none is ticked", () => {
    const html = render(emptyFilters(), false, available);
    expect(html).toContain("+15 passive");
    expect(buttons(html, "DS DMG+")[0]).toContain(`title="${DS}"`);
    expect(buttons(html, "vs Fire DMG+")).toHaveLength(1);
    expect(buttons(html, "vs Water DMG+")).toHaveLength(0);
    expect(gradeSelect(html)).toContain('aria-disabled="true"');
    expect(gradeSelect(html)).toContain("opacity-40");
    expect(gradeLetters(html).map((l) => l.text)).toEqual(["C", "B", "A", "S", "S+"]);
  });

  it("a ticked family enables the selector; one absent from the view is listed after, marked", () => {
    const html = render({ ...emptyFilters(), passives: new Set([DS, "Reduced DMG Taken vs Dark"]), passiveMinGrade: "A" }, false, available);
    expect(gradeSelect(html)).not.toContain("aria-disabled");
    const [dark] = buttons(html, "vs Dark DMG-");
    expect(dark).toContain(UNAVAILABLE);
    expect(html.indexOf("vs Fire DMG+")).toBeLessThan(html.indexOf("vs Dark DMG-"));
    const letters = gradeLetters(html);
    expect(letters.filter((l) => l.attrs.includes('aria-pressed="true"')).map((l) => l.text)).toEqual(["A"]);
    expect(letters.every((l) => !l.attrs.includes('disabled=""'))).toBe(true);
  });
});
