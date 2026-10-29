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

const { FilterModal } = await import("../src/screens/inventory/FilterModal.js");

function render(current: FilterState): string {
  return renderToStaticMarkup(createElement(FilterModal, {
    open: true, onClose: () => {}, current, onApply: () => {},
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
