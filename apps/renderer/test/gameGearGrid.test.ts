/**
 * The game's equipment screen order (`GAME_GEAR_GRID`) — shared by the Builds
 * cards, Presets and the Builder's bottom band, so a reorder shows everywhere.
 */
import { describe, expect, it } from "vitest";
import { GAME_GEAR_GRID, SLOTS, toDesignSlot, toEngineSlot } from "../src/design/tokens.js";

describe("GAME_GEAR_GRID", () => {
  it("holds the 8 slots once each", () => {
    expect(GAME_GEAR_GRID).toHaveLength(8);
    expect([...GAME_GEAR_GRID].sort()).toEqual(SLOTS.map((s) => s.id).sort());
  });

  it("starts with weapon, exclusive — the game's first row", () => {
    expect(GAME_GEAR_GRID.slice(0, 2)).toEqual(["weapon", "exclusive"]);
  });

  it("maps to engine slots and back", () => {
    expect(GAME_GEAR_GRID.map(toEngineSlot)).toContain("ooparts");
    expect(GAME_GEAR_GRID.map(toEngineSlot).map(toDesignSlot)).toEqual([...GAME_GEAR_GRID]);
  });
});
