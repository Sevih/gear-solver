import { describe, it, expect } from "vitest";
import { equipItem, unequipItem } from "../src/equip.js";
import type { RawItem, RawUserItem } from "../src/raw.js";
import type { GameData } from "../src/gamedata.js";

// Only `game.equipment[ItemID].slot` is read by the equip helpers — cast a
// minimal table instead of building a full GameData.
const game = {
  equipment: {
    10: { slot: "helmet" },
    11: { slot: "helmet" },
    20: { slot: "armor" },
    30: { slot: "weapon" },
    // 99 deliberately absent → a non-gear / unknown template.
  },
} as unknown as GameData;

function mkItem(p: Partial<RawItem> & Pick<RawItem, "ItemUID" | "ItemID">): RawItem {
  return {
    CharUID: "0", Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0,
    IsLock: 0, InvenType: 0, SelectSubOptionNum: 0, SingularityOptionID: 0,
    SingularityStep: 0, SingularityLevel: 0, OptionList: [], SubOptionList: [],
    ...p,
  };
}

function uid(raw: RawUserItem, u: string): string | undefined {
  return raw.ItemList.find((it) => it.ItemUID === u)?.CharUID;
}

describe("equipItem", () => {
  it("sets CharUID on an empty slot with no displacement", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10 })] };
    const out = equipItem(raw, game, "a", "hero1");
    expect(uid(out, "a")).toBe("hero1");
  });

  it("displaces the piece already in that char's same slot", () => {
    const raw: RawUserItem = {
      ItemList: [
        mkItem({ ItemUID: "old", ItemID: 10, CharUID: "hero1" }), // helmet on hero1
        mkItem({ ItemUID: "new", ItemID: 11, CharUID: "0" }),     // free helmet
      ],
    };
    const out = equipItem(raw, game, "new", "hero1");
    expect(uid(out, "new")).toBe("hero1");
    expect(uid(out, "old")).toBe("0"); // displaced
  });

  it("only displaces the SAME slot on the SAME char", () => {
    const raw: RawUserItem = {
      ItemList: [
        mkItem({ ItemUID: "h2", ItemID: 11, CharUID: "hero2" }), // helmet on a DIFFERENT char
        mkItem({ ItemUID: "armor1", ItemID: 20, CharUID: "hero1" }), // armor on SAME char
        mkItem({ ItemUID: "new", ItemID: 10, CharUID: "0" }),    // free helmet
      ],
    };
    const out = equipItem(raw, game, "new", "hero1");
    expect(uid(out, "new")).toBe("hero1");
    expect(uid(out, "h2")).toBe("hero2");      // other char untouched
    expect(uid(out, "armor1")).toBe("hero1");  // other slot untouched
  });

  it("is a no-op when the item is already on that char", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10, CharUID: "hero1" })] };
    const out = equipItem(raw, game, "a", "hero1");
    expect(uid(out, "a")).toBe("hero1");
  });

  it("is a no-op for an unknown itemUid", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10 })] };
    const out = equipItem(raw, game, "missing", "hero1");
    expect(uid(out, "a")).toBe("0");
  });

  it("is a no-op for a non-gear template (no equipment entry)", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "stack", ItemID: 99 })] };
    const out = equipItem(raw, game, "stack", "hero1");
    expect(uid(out, "stack")).toBe("0");
  });

  it("treats charUid '0' as unequip (target only, no displacement)", () => {
    const raw: RawUserItem = {
      ItemList: [
        mkItem({ ItemUID: "a", ItemID: 10, CharUID: "hero1" }),
        mkItem({ ItemUID: "b", ItemID: 11, CharUID: "hero1" }), // would-be displaced if equipping
      ],
    };
    const out = equipItem(raw, game, "a", "0");
    expect(uid(out, "a")).toBe("0");
    expect(uid(out, "b")).toBe("hero1"); // untouched
  });

  it("does not mutate the input", () => {
    const raw: RawUserItem = {
      ItemList: [
        mkItem({ ItemUID: "old", ItemID: 10, CharUID: "hero1" }),
        mkItem({ ItemUID: "new", ItemID: 11, CharUID: "0" }),
      ],
    };
    equipItem(raw, game, "new", "hero1");
    expect(uid(raw, "old")).toBe("hero1"); // original still equipped
    expect(uid(raw, "new")).toBe("0");
  });
});

describe("unequipItem", () => {
  it("clears CharUID on an equipped item", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10, CharUID: "hero1" })] };
    expect(uid(unequipItem(raw, "a"), "a")).toBe("0");
  });

  it("is a no-op for an already-free or unknown item", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10, CharUID: "0" })] };
    expect(uid(unequipItem(raw, "a"), "a")).toBe("0");
    expect(uid(unequipItem(raw, "missing"), "a")).toBe("0");
  });

  it("does not mutate the input", () => {
    const raw: RawUserItem = { ItemList: [mkItem({ ItemUID: "a", ItemID: 10, CharUID: "hero1" })] };
    unequipItem(raw, "a");
    expect(uid(raw, "a")).toBe("hero1");
  });
});
