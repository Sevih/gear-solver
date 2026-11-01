/**
 * Tab names (U11, U13): `parseTab` reads a stored `gs.tab` — the former labels
 * (Builds, Builder, Inventory) open their renamed tab, Home (dissolved into
 * Gear › Overview) and anything unknown open Heroes — and the header lists the
 * five tabs in their target order with none of the former labels.
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
    expect(parseTab("Home")).toBe("Heroes");
  });

  it("keeps a current tab as is", () => {
    for (const t of ["Heroes", "Optimizer", "Presets", "Worklist", "Gear"] as const) expect(parseTab(t)).toBe(t);
  });

  it("opens Heroes on anything else", () => {
    expect(parseTab(null)).toBe("Heroes");
    expect(parseTab("nope")).toBe("Heroes");
    expect(parseTab("Debug")).toBe("Heroes");
    expect(parseTab(42)).toBe("Heroes");
    expect(parseTab("toString")).toBe("Heroes");
  });
});

describe("GsHeader tabs", () => {
  const html = renderToStaticMarkup(createElement(GsHeader, {
    active: "Heroes", onTabChange: noop, onSetup: noop, version: "1.28.0", gameVersion: null,
    counts: { Heroes: 12, Optimizer: null, Presets: null, Worklist: 3, Gear: 1450 },
    capture: { steam: { status: null, onInstall: noop, onLaunch: noop }, onReload: noop },
  }));

  it("lists the five tabs in order: Heroes, Optimizer, Presets, Worklist, Gear", () => {
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const labels = [...nav.matchAll(/<button[^>]*>([A-Za-z]+)/g)].map((m) => m[1]);
    expect(labels).toEqual(["Heroes", "Optimizer", "Presets", "Worklist", "Gear"]);
  });

  it("names none of the former tabs", () => {
    for (const old of ["Home", "Builds", "Builder", "Inventory"]) expect(html).not.toContain(old);
  });
});
