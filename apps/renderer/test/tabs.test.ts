/**
 * Tab names (U11): `parseTab` reads a stored `gs.tab` — the former labels
 * (Builds, Builder, Inventory) open their renamed tab, anything unknown opens
 * Home — and the header lists the six tabs in their target order with none of
 * the former labels.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GsHeader, parseTab } from "../src/design/Shell.js";

const noop = () => {};

describe("parseTab", () => {
  it("maps the former labels to their new tab", () => {
    expect(parseTab("Builds")).toBe("Heroes");
    expect(parseTab("Builder")).toBe("Optimizer");
    expect(parseTab("Inventory")).toBe("Gear");
  });

  it("keeps a current tab as is", () => {
    for (const t of ["Home", "Heroes", "Optimizer", "Presets", "Worklist", "Gear"] as const) expect(parseTab(t)).toBe(t);
  });

  it("opens Home on anything else", () => {
    expect(parseTab(null)).toBe("Home");
    expect(parseTab("Debug")).toBe("Home");
    expect(parseTab(42)).toBe("Home");
    expect(parseTab("toString")).toBe("Home");
  });
});

describe("GsHeader tabs", () => {
  const html = renderToStaticMarkup(createElement(GsHeader, {
    active: "Heroes", onTabChange: noop, onSetup: noop, version: "1.28.0", gameVersion: null,
    counts: { Home: null, Heroes: 12, Optimizer: null, Presets: null, Worklist: 3, Gear: 1450 },
    capture: { steam: { status: null, onInstall: noop, onLaunch: noop }, onReload: noop },
  }));

  it("lists the six tabs in order: Home, Heroes, Optimizer, Presets, Worklist, Gear", () => {
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const labels = [...nav.matchAll(/<button[^>]*>([A-Za-z]+)/g)].map((m) => m[1]);
    expect(labels).toEqual(["Home", "Heroes", "Optimizer", "Presets", "Worklist", "Gear"]);
  });

  it("names none of the former tabs", () => {
    for (const old of ["Builds", "Builder", "Inventory"]) expect(html).not.toContain(old);
  });
});
