/**
 * Presets tab, "Expand all" / "Collapse all" — `cardOpen` (a card's own click
 * under the latest command wins, a newer command overrides older clicks, else
 * the card's default) and `forceCards` (the buttons' next command); the
 * session codecs of the command and of the cards' clicks (`cardChoice`); then
 * the screen rendered server-side on two presets (one filled, one empty),
 * without a command, with the "Expand all" one seeded through
 * `initialCardCommand`, and with its view state read back from sessionStorage
 * (`useSessionState`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GearPiece, Inventory, Preset } from "@gear-solver/core";
import { cardChoice, cardOpen, CHOICES_CODEC, forceCards, FORCED_CODEC, type CardOpenCommand } from "../src/lib/presets/cardOpen.js";

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

describe("session codecs", () => {
  it("gs.presets.forced round-trips with its generation", () => {
    const cmd = forceCards(forceCards(null, true), false);
    const read = FORCED_CODEC.deserialize!(JSON.stringify(cmd));
    expect(read).toEqual({ open: false, gen: 2 });
    // A click made under it still wins, one made under the first command doesn't.
    expect(cardOpen(read, { open: true, gen: 2 }, false)).toBe(true);
    expect(cardOpen(read, { open: true, gen: 1 }, false)).toBe(false);
  });

  it("gs.presets.forced reads a malformed value as no command", () => {
    for (const raw of ["null", "42", '"x"', '{"open":true}', '{"open":"yes","gen":1}', '{"open":true,"gen":0}', '{"open":true,"gen":1.5}']) {
      expect(FORCED_CODEC.deserialize!(raw)).toBeNull();
    }
  });

  it("gs.presets.open round-trips, in-game nums and local ids alike", () => {
    const choices = { "3": true, "7": false, "0b6f-local": true };
    expect(CHOICES_CODEC.deserialize!(JSON.stringify(choices))).toEqual(choices);
  });

  it("gs.presets.open drops what isn't a boolean, reads a non-object as no click", () => {
    expect(CHOICES_CODEC.deserialize!('{"1":true,"2":"open","3":1,"4":null,"5":false}')).toEqual({ "1": true, "5": false });
    for (const raw of ["null", "[true]", "true", '"x"']) expect(CHOICES_CODEC.deserialize!(raw)).toEqual({});
  });

  it("cardChoice stamps a kept click with the current command, none without a click", () => {
    const forced = forceCards(null, false);
    expect(cardChoice({ "1": true }, "1", forced)).toEqual({ open: true, gen: 1 });
    expect(cardChoice({ "1": true }, "1", null)).toEqual({ open: true, gen: 0 });
    expect(cardChoice({ "1": true }, "2", forced)).toBeNull();
    // Under "Collapse all", the card opened by hand since stays open.
    expect(cardOpen(forced, cardChoice({ "1": true }, "1", forced), true)).toBe(true);
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

  const session = new Map<string, string>();
  beforeEach(() => {
    seed.command = null;
    const stub = (store: Map<string, string>) => ({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    }) as Storage;
    (globalThis as { localStorage?: Storage }).localStorage = stub(new Map());
    session.clear();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = stub(session);
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

  it("reads the last command and the cards toggled since back from the session", () => {
    session.set("gs.presets.forced", JSON.stringify(forceCards(null, false)));
    session.set("gs.presets.open", JSON.stringify({ "2": true }));
    const html = render();
    // Collapse all, then the empty preset 2 opened by hand: only it is open.
    expect(expanded(html)).toBe(1);
    expect(html.indexOf('aria-expanded="true"')).toBeGreaterThan(html.indexOf(">P1<"));
  });

  it("reads the class chips and the sort back from the session", () => {
    session.set("gs.presets.classFilter", JSON.stringify(["CCT_ATTACKER"]));
    session.set("gs.presets.sort", JSON.stringify("priority"));
    const html = render();
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Rank</);
    // Neither preset has a known class: both hidden by the chip.
    expect(html).toContain("No preset of the selected classes.");
  });

  it("a sort the screen no longer knows reads as the in-game order", () => {
    session.set("gs.presets.sort", JSON.stringify("weight"));
    expect(render()).toMatch(/aria-checked="true"[^>]*>In-game</);
  });
});
