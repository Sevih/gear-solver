/**
 * One hero picker (U10a): `HeroPicker` rendered server-side in `single` (value
 * shown, rows with portraits) and `multi` (ticked boxes, « N selected »); the
 * one search (`heroSearchHaystack` / `heroMatches`, a fused hero found under
 * its displayed name and its base name); the one order (`heroListOrder`:
 * rank, then CP, then capture).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GameData } from "@gear-solver/core";
import { HeroPicker } from "../src/design/HeroPicker.js";
import { heroMatches, heroSearchHaystack } from "../src/lib/heroes/heroName.js";
import { heroListOrder } from "../src/lib/heroes/heroListOrder.js";

const hero = (uid: string, charId: number, name: string, fusionCharId = 0): Character =>
  ({ uid, charId, name, fusionCharId } as unknown as Character);

// 1001 = "Ame" (no nickname); 1002 = "Rin", fused into 2701002 whose sheet
// carries the nickname "Radiant".
const game = {
  characters: {
    "1001": { nickname: null, cls: "striker", element: "fire" },
    "1002": { nickname: "Mystic", cls: "mage", element: "water" },
    "2701002": { nickname: "Radiant", cls: "mage", element: "light" },
  },
} as unknown as GameData;

const ame = hero("A", 1001, "Ame");
const rin = hero("R", 1002, "Rin", 2701002);
const noop = () => {};

describe("HeroPicker — single", () => {
  it("shows the picked hero's displayed name, closed", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, { mode: "single", heroes: [ame, rin], game, value: "R", onChange: noop }));
    expect(html).toContain('value="Core Fusion Radiant Rin"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="option"');
  });

  it("lists every hero with a portrait when open, the picked one selected", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, { mode: "single", heroes: [ame, rin], game, value: "R", onChange: noop, defaultOpen: true }));
    const options = html.split('role="option"').slice(1);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain("Ame");
    expect(options[1]).toContain("Core Fusion Radiant Rin");
    // Portrait: the fused one for Rin (charId 2701002).
    expect(html.match(/<img /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain("2701002");
    expect(options[0]).toContain('aria-selected="false"');
    expect(options[1]).toContain('aria-selected="true"');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("HeroPicker — multi", () => {
  it("shows the label and « N selected » once something is ticked", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, {
      mode: "multi", heroes: [ame, rin], game, values: new Set(["A"]), onToggle: noop, onClear: noop, label: "Don't take from…", showCount: true,
    }));
    expect(html).toContain("Don&#x27;t take from…");
    expect(html).toContain("1 selected");
    expect(html).toContain("✕");
  });

  it("no counter nor clear when nothing is ticked", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, {
      mode: "multi", heroes: [ame, rin], game, values: new Set<string>(), onToggle: noop, onClear: noop, label: "Don't take from…", showCount: true,
    }));
    expect(html).not.toContain("selected");
    expect(html).not.toContain("✕");
  });

  it("lists every hero with a checkbox and a portrait when open, ticked ones checked", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, {
      mode: "multi", heroes: [ame, rin], game, values: new Set(["R"]), onToggle: noop, label: "Don't take from…", defaultOpen: true,
    }));
    const options = html.split('role="option"').slice(1);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('type="checkbox"');
    expect(options[0]).not.toContain("checked");
    expect(options[1]).toContain('checked=""');
    expect(options[1]).toContain("Core Fusion Radiant Rin");
    expect(html.match(/<img /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('placeholder="Search hero…"');
  });
});

describe("heroSearchHaystack", () => {
  it("finds a fused hero under its displayed name and its base name", () => {
    const hay = heroSearchHaystack(rin, game);
    expect(hay).toContain("core fusion radiant rin"); // displayed
    expect(hay).toContain("mystic"); // base sheet's nickname
    expect(hay).toContain("rin");
    expect(hay).toContain("1002");
    expect(heroMatches(rin, game, "Radiant")).toBe(true);
    expect(heroMatches(rin, game, "  MYSTIC ")).toBe(true);
    expect(heroMatches(rin, game, "fusion")).toBe(true);
    expect(heroMatches(ame, game, "fusion")).toBe(false);
    expect(heroMatches(ame, game, "")).toBe(true);
  });

  it("works before the data loads", () => {
    expect(heroMatches(ame, null, "ame")).toBe(true);
    expect(heroMatches(ame, null, "1001")).toBe(true);
  });
});

describe("heroListOrder", () => {
  const h = (uid: string) => ({ uid });
  const uids = (xs: { uid: string }[]) => xs.map((x) => x.uid).join("");

  it("rank first, then CP, then capture order", () => {
    const list = [h("a"), h("b"), h("c"), h("d"), h("e")];
    const cp: Record<string, number> = { a: 100, b: 300, c: 200, d: 900, e: 300 };
    expect(uids(heroListOrder(list, { rank: { c: 2, a: 1 }, cp: (u) => cp[u] }))).toBe("acdbe");
  });

  it("unranked heroes after ranked ones, heroes without CP after those with one", () => {
    const list = [h("a"), h("b"), h("c"), h("d")];
    expect(uids(heroListOrder(list, { rank: { d: 5 }, cp: (u) => (u === "c" ? 50 : null) }))).toBe("dcab");
  });

  it("ties keep the capture (input) order", () => {
    const list = [h("a"), h("b"), h("c")];
    expect(uids(heroListOrder(list))).toBe("abc");
    expect(uids(heroListOrder(list, { rank: {}, cp: () => 10 }))).toBe("abc");
    expect(uids(heroListOrder(list, { rank: { b: 1 } }))).toBe("bac");
  });

  it("CP only (Builds' CP sort): highest first, rank ignored", () => {
    const list = [h("a"), h("b"), h("c")];
    const cp: Record<string, number> = { a: 1, b: 3, c: 2 };
    expect(uids(heroListOrder(list, { rank: null, cp: (u) => cp[u] }))).toBe("bca");
  });

  it("does not mutate its input", () => {
    const list = [h("b"), h("a")];
    heroListOrder(list, { rank: { a: 1 } });
    expect(uids(list)).toBe("ba");
  });
});
