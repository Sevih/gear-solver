/**
 * Presets tab, "Expand all" / "Collapse all" — `cardOpen` (a card's own click
 * under the latest command wins, a newer command overrides older clicks, else
 * the card's default) and `forceCards` (the buttons' next command); then the
 * screen rendered server-side on two presets (one filled, one empty), without
 * a command and with the "Expand all" one seeded through `initialCardCommand`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GearPiece, Inventory, Preset } from "@gear-solver/core";
import { cardOpen, forceCards, type CardOpenCommand } from "../src/lib/presets/cardOpen.js";

// The screen's starting command, swapped per test (null = the real one).
const seed = vi.hoisted(() => ({ command: null as CardOpenCommand | null }));
vi.mock("../src/lib/presets/cardOpen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/presets/cardOpen.js")>()),
  initialCardCommand: () => seed.command,
}));

const { PresetsScreen } = await import("../src/screens/presets/PresetsScreen.js");

describe("cardOpen", () => {
  it("no command, no click → the card's default", () => {
    expect(cardOpen(null, null, true)).toBe(true);
    expect(cardOpen(null, null, false)).toBe(false);
  });

  it("a command without a click wins over the default", () => {
    expect(cardOpen({ open: false, gen: 1 }, null, true)).toBe(false);
    expect(cardOpen({ open: true, gen: 1 }, null, false)).toBe(true);
  });

  it("a click under the same command wins over it", () => {
    expect(cardOpen({ open: false, gen: 1 }, { open: true, gen: 1 }, true)).toBe(true);
  });

  it("a click under an older command gives way to the new one", () => {
    expect(cardOpen({ open: false, gen: 2 }, { open: true, gen: 1 }, true)).toBe(false);
  });

  it("a click with no command yet (gen 0) wins over the default", () => {
    expect(cardOpen(null, { open: false, gen: 0 }, true)).toBe(false);
    expect(cardOpen(null, { open: true, gen: 0 }, false)).toBe(true);
  });

  it("forceCards numbers each command after the last", () => {
    const expand = forceCards(null, true);
    expect(expand).toEqual({ open: true, gen: 1 });
    expect(forceCards(expand, false)).toEqual({ open: false, gen: 2 });
  });
});

describe("PresetsScreen, Expand all", () => {
  const piece = (slot: GearPiece["slot"], uid: string): GearPiece => ({
    uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: "A", main: [], subs: [],
  } as GearPiece);
  const preset = (num: number, itemUids: string[]): Preset => ({ num, name: `P${num}`, itemUids, favorite: false, presetType: 0, sortOrder: 0 });
  // Preset 1 = A's outfit (wire order, EE slot empty); preset 2 = all empty.
  const inventory: Inventory = {
    gear: [piece("weapon", "w"), piece("accessory", "ac"), piece("helmet", "h"), piece("armor", "a"), piece("gloves", "g"), piece("boots", "b"), piece("ooparts", "t")],
    characters: [{ uid: "A", charId: 1, name: "A" } as unknown as Character],
    presets: [preset(1, ["w", "ac", "h", "a", "g", "b", "0", "t"]), preset(2, ["0", "0", "0", "0", "0", "0", "0", "0"])],
  };
  const render = () => renderToStaticMarkup(createElement(PresetsScreen, {
    inventory, game: null, userGeasLevels: null, userCodexLevel: null, lossWarnPct: 5, heroFilters: {},
    presetRank: {}, onPresetRankChange: () => {}, presetLocked: [], onPresetLockedChange: () => {},
  }));
  const expanded = (html: string) => html.split('aria-expanded="true"').length - 1;

  beforeEach(() => {
    seed.command = null;
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
  });

  it("shows both buttons; without a command only the filled preset is open", () => {
    const html = render();
    expect(html).toContain(">Expand all<");
    expect(html).toContain(">Collapse all<");
    expect(html).toContain('title="Open every preset card (in-game and local)"');
    expect(html).toContain('title="Close every preset card"');
    expect(expanded(html)).toBe(1);
  });

  it("after Expand all, the empty preset opens too", () => {
    seed.command = forceCards(null, true);
    expect(expanded(render())).toBe(2);
  });

  it("after Collapse all, none is open", () => {
    seed.command = forceCards(null, false);
    expect(expanded(render())).toBe(0);
  });
});
