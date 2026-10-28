import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameData } from "@gear-solver/core";
import { itemLabel, itemNameOf, loadGameData } from "../src/data.js";

/** Every /gamedata/* table answers `{}`, items.json answers `items` (a status
 *  number, or a body). */
function serve(items: number | unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/gamedata/items.json") return typeof items === "number" ? new Response("not found", { status: items }) : Response.json(items);
    return Response.json({});
  }));
}
afterEach(() => { vi.unstubAllGlobals(); });

const GOLD = { name: "Gold", icon: "Item_Gold", itemType: "IT_MONEY", itemSubType: "IST_NONE", grade: "IG_NORMAL", canSell: false, sellPrice: 0 };

describe("loadGameData — items.json", () => {
  it("absent (404): the game data still loads, items empty", async () => {
    serve(404);
    const game = await loadGameData();
    expect(game).not.toBeNull();
    expect(game!.items).toEqual({});
  });

  it("present: loaded as game.items", async () => {
    serve({ "10": GOLD });
    expect((await loadGameData())!.items).toEqual({ "10": GOLD });
  });
});

describe("itemNameOf / itemLabel", () => {
  const game: Pick<GameData, "items"> = { items: { "10": GOLD, "20": { ...GOLD, name: null } } };

  it("names a known item, by number or string id", () => {
    expect(itemNameOf(game, 10)).toBe("Gold");
    expect(itemNameOf(game, "10")).toBe("Gold");
    expect(itemLabel(game, 10)).toBe("Gold");
  });

  it("unknown id, unnamed item, empty table or no game data: null, label `item <id>`", () => {
    expect(itemNameOf(game, 99)).toBeNull();
    expect(itemNameOf(game, 20)).toBeNull();
    expect(itemNameOf({ items: {} }, 10)).toBeNull();
    expect(itemNameOf(null, 10)).toBeNull();
    expect(itemLabel(game, 99)).toBe("item 99");
    expect(itemLabel(game, "20")).toBe("item 20");
    expect(itemLabel(undefined, 10)).toBe("item 10");
  });
});
