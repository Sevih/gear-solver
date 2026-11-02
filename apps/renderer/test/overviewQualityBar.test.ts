// Gear › Overview quality bar: each of the five slices is the same shortcut
// as the tier's button under it — a button opening Gear › Pieces filtered on
// that tier, inert on an empty tier or without `onDrill`, the bar keeping its
// proportions, colors and height. Rendered server-side, the click read from
// the returned tree.
import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QUALITY_TIERS, type QualityTier } from "../src/lib/quality.js";
import type { InventoryDrill } from "../src/screens/inventory/InventoryScreen.js";
import { QualityBar } from "../src/screens/gear/OverviewView.js";

type Tiers = Parameters<typeof QualityBar>[0]["tiers"];
const COUNTS = [12, 0, 30, 8, 3];
const tiers: Tiers = QUALITY_TIERS.map((tier, i) => ({
  tier, label: `L-${tier}`, color: `#00000${i}`, hint: `H-${tier}`, count: COUNTS[i]!, pct: "",
}));

const slices = (html: string) => [...html.matchAll(/<button([^>]*)><\/button>/g)].map((m) => m[1]!);

describe("Gear › Overview — quality bar", () => {
  it("five buttons, inert on an empty tier, each titled like the tier's button", () => {
    const html = renderToStaticMarkup(createElement(QualityBar, { tiers, onDrill: () => {} }));
    expect(html).toMatch(/^<div class="flex h-8 gap-0.75 overflow-hidden rounded-lg">/);
    const s = slices(html);
    expect(s).toHaveLength(5);
    s.forEach((attrs, i) => {
      expect(attrs).toContain(`flex:${COUNTS[i]} 1 0`);
      expect(attrs).toContain(`background:#00000${i}`);
      expect(attrs).toContain(`title="H-${QUALITY_TIERS[i]}\n\nClick to see these L-${QUALITY_TIERS[i]} pieces in Gear"`);
      expect(attrs).toContain("opacity-92");
      if (COUNTS[i] === 0) {
        expect(attrs).toContain('disabled=""');
        expect(attrs).not.toContain("cursor-pointer");
      } else {
        expect(attrs).not.toContain("disabled");
        expect(attrs).toContain("cursor-pointer");
        expect(attrs).toContain("hover:opacity-100");
      }
    });
  });

  it("a click drills into its own tier", () => {
    const drills: InventoryDrill[] = [];
    const bar = QualityBar({ tiers, onDrill: (d) => drills.push(d) }) as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    for (const b of bar.props.children) b.props.onClick();
    expect(drills).toEqual(QUALITY_TIERS.map((quality: QualityTier) => ({ quality })));
  });

  it("without onDrill every slice is inert, its title the hint alone", () => {
    const s = slices(renderToStaticMarkup(createElement(QualityBar, { tiers })));
    expect(s).toHaveLength(5);
    s.forEach((attrs, i) => {
      expect(attrs).toContain('disabled=""');
      expect(attrs).toContain(`title="H-${QUALITY_TIERS[i]}"`);
    });
  });
});
