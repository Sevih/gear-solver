import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEquipJournalFollower,
  EQUIP_JOURNAL,
  foldEquipEvents,
  parseEquipJournal,
  type EquipEvent,
} from "../src/equip-events.js";

// Uids shaped like the real capture (10-digit strings, far below 2^53).
const HERO_A = "6012124257";
const HERO_B = "4051832267";
const W1 = "6124885095"; // free weapon
const W2 = "6036468941"; // weapon on A
const H1 = "4314195620"; // helmet on B
const H2 = "4314888893"; // free helmet

function snapshot() {
  return {
    ItemList: [
      { ItemUID: W1, CharUID: "0", ItemID: 1 },
      { ItemUID: W2, CharUID: HERO_A, ItemID: 2 },
      { ItemUID: H1, CharUID: HERO_B, ItemID: 3 },
      { ItemUID: H2, CharUID: "0", ItemID: 4 },
    ],
    PresetList: [{ Num: 1 }],
  };
}

const owners = (raw: { ItemList: Array<{ ItemUID: string; CharUID: string }> }) =>
  Object.fromEntries(raw.ItemList.map((it) => [it.ItemUID, it.CharUID]));

// Responses built after CWebRES_ItemEquip / CWebRES_ItemEquipAll (ids as the
// server spells them: JSON strings).
const equip = (seq: number, res: Record<string, string>): EquipEvent =>
  ({ seq, path: "/item/equip", res: { CharUID: "0", UnEquipCharUID: "0", ToEquipUID: "0", ToInvenUID: "0", ...res } });

describe("foldEquipEvents", () => {
  it("plain equip: the piece joins the hero", () => {
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(owners(next)[W1]).toBe(HERO_B);
    expect([applied, skipped]).toEqual([1, 0]);
  });

  it("slot swap: the old piece goes back to the inventory, the new one joins", () => {
    const { next, applied } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToEquipUID: W1, ToInvenUID: W2 })]);
    expect(owners(next)).toMatchObject({ [W1]: HERO_A, [W2]: "0" });
    expect(applied).toBe(2);
  });

  it("take off: ToEquipUID 0 frees ToInvenUID", () => {
    const { next } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(owners(next)[W2]).toBe("0");
  });

  it("taken from another hero (UnEquipCharUID): the piece changes owner", () => {
    const { next, applied } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, UnEquipCharUID: HERO_B, ToEquipUID: H1 })]);
    expect(owners(next)[H1]).toBe(HERO_A);
    expect(applied).toBe(1);
  });

  it("equipAll: UnEquipList, then ToInvenList, then ToEquipList", () => {
    const ev: EquipEvent = {
      seq: 1,
      path: "/item/equipAll",
      res: {
        CharUID: HERO_A,
        ToEquipList: [W1, H1, "0"],
        ToInvenList: [W2, "0", "0"],
        UnEquipList: [{ CharUID: HERO_B, ItemUID: H1 }],
      },
    };
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [ev]);
    expect(owners(next)).toEqual({ [W1]: HERO_A, [W2]: "0", [H1]: HERO_A, [H2]: "0" });
    expect([applied, skipped]).toEqual([3, 0]);
  });

  it("an uid missing from the snapshot is skipped, never invented", () => {
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToEquipUID: "6199999999", ToInvenUID: W2 })]);
    expect(next.ItemList.map((it) => it.ItemUID)).toEqual([W1, W2, H1, H2]);
    expect(owners(next)[W2]).toBe("0");
    expect([applied, skipped]).toEqual([1, 1]);
  });

  it("numeric ids are accepted while exact, an unsafe one is skipped", () => {
    const ev = (to: number): EquipEvent => ({ seq: 1, path: "/item/equip", res: { CharUID: Number(HERO_A), ToEquipUID: to, ToInvenUID: 0 } });
    expect(owners(foldEquipEvents(snapshot(), [ev(Number(W1))]).next)[W1]).toBe(HERO_A);
    expect(foldEquipEvents(snapshot(), [ev(2 ** 60)]).skipped).toBe(1);
  });

  it("is idempotent: replaying the same events changes nothing", () => {
    const events = [
      equip(1, { CharUID: HERO_A, ToEquipUID: W1, ToInvenUID: W2 }),
      equip(2, { CharUID: HERO_A, UnEquipCharUID: HERO_B, ToEquipUID: H1 }),
    ];
    const once = foldEquipEvents(snapshot(), events);
    const twice = foldEquipEvents(once.next, events);
    expect(twice.next).toEqual(once.next);
    expect(twice.applied).toBe(0);
  });

  it("keeps the other keys and leaves the input untouched", () => {
    const raw = snapshot();
    const { next } = foldEquipEvents(raw, [equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(next.PresetList).toEqual([{ Num: 1 }]);
    expect(owners(raw)[W1]).toBe("0");
  });
});

const subs = (...ids: number[]) => ids.map((OptionID) => ({ OptionID, Level: 0, BaseLevel: 0 }));
// `WSItemData` as the wire spells it (cf. other responses carrying it):
// ItemUID a string, CharUID 0 a number, IsLock a number; no InvenType here.
const wire = (ItemUID: string, CharUID: string | number, ItemID: number, sub: number[], extra: Record<string, unknown> = {}) =>
  ({ ItemUID, CharUID, ItemID, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0, OptionList: [0, 0], SubOptionList: subs(...sub), SelectSubOptionNum: 99, SingularityStep: 0, SingularityLevel: 0, SingularityOptionID: 0, ...extra });
const byUid = (raw: { ItemList: Array<{ ItemUID: string }> }, id: string) =>
  raw.ItemList.find((it) => it.ItemUID === id) as Record<string, unknown> | undefined;

describe("foldEquipEvents — whole items (gems, substats)", () => {
  const EE = "6200000001"; // EE on A, one gem socketed
  const GEM = "6200000002"; // stack of that gem in the inventory
  const base = () => ({
    ItemList: [
      ...snapshot().ItemList,
      { ItemUID: EE, CharUID: HERO_A, ItemID: 9, IsLock: 1, InvenType: 0, SubOptionList: subs(15001, 0, 0, 0, 0) },
      { ItemUID: GEM, CharUID: "0", ItemID: 22030, Quantity: 3, IsLock: 0, InvenType: 0, SubOptionList: subs(0, 0, 0, 0, 0) },
    ],
    PresetList: [{ Num: 1 }],
  });
  const gemIds = (raw: { ItemList: Array<{ ItemUID: string }> }, id: string) =>
    (byUid(raw, id)!.SubOptionList as Array<{ OptionID: number }>).map((s) => s.OptionID);

  const insert = (seq: number): EquipEvent =>
    ({ seq, path: "/item/gemInsert", res: { Item: wire(EE, HERO_A, 9, [15001, 15002, 0, 0, 0], { IsLock: 1 }) } });
  const remove = (seq: number): EquipEvent => ({
    seq,
    path: "/item/gemRemove",
    res: { Item: wire(EE, HERO_A, 9, [15001, 0, 0, 0, 0], { IsLock: true }), ItemGem: wire("6200000003", 0, 22031, [0, 0, 0, 0, 0]), Asset_0: 70205983 },
  });

  it("gemInsert: the piece's gems change, its owner and snapshot-only fields stay", () => {
    const { next, applied, skipped } = foldEquipEvents(base(), [insert(1)]);
    expect(gemIds(next, EE)).toEqual([15001, 15002, 0, 0, 0]);
    expect(byUid(next, EE)).toMatchObject({ CharUID: HERO_A, IsLock: 1, InvenType: 0 });
    // The consumed gem stack isn't in the response: left as is.
    expect(byUid(next, GEM)!.Quantity).toBe(3);
    expect([applied, skipped]).toEqual([1, 0]);
  });

  it("gemRemove: the piece loses the gem, the gem item joins the inventory at the end", () => {
    const { next, applied } = foldEquipEvents(foldEquipEvents(base(), [insert(1)]).next, [remove(2)]);
    expect(gemIds(next, EE)).toEqual([15001, 0, 0, 0, 0]);
    expect(byUid(next, EE)).toMatchObject({ IsLock: 1, CharUID: HERO_A });
    expect(next.ItemList.at(-1)).toMatchObject({ ItemUID: "6200000003", CharUID: "0", ItemID: 22031 });
    expect(next.ItemList).toHaveLength(base().ItemList.length + 1);
    expect(applied).toBe(2);
  });

  it("subOptionChange: the substats are replaced", () => {
    const piece = wire(W2, HERO_A, 2, [160001, 160004, 160007, 160010, 0]);
    const { next, applied } = foldEquipEvents(base(), [{ seq: 1, path: "/item/subOptionChange", res: { ItemData: piece } }]);
    expect(byUid(next, W2)!.SubOptionList).toEqual(piece.SubOptionList);
    expect(byUid(next, W2)!.CharUID).toBe(HERO_A);
    expect(applied).toBe(1);
  });

  it("gemChangeOption: the piece and the gem item are both upserted", () => {
    const res = { Item: wire(EE, HERO_A, 9, [15004, 0, 0, 0, 0]), ItemGem: wire(GEM, "0", 22030, [0, 0, 0, 0, 0], { Quantity: 2 }), Asset_0: 1 };
    const { next, applied } = foldEquipEvents(base(), [{ seq: 1, path: "/item/gemChangeOption", res }]);
    expect(gemIds(next, EE)).toEqual([15004, 0, 0, 0, 0]);
    expect(byUid(next, GEM)!.Quantity).toBe(2);
    expect(applied).toBe(2);
  });

  it("mixes with equip moves in journal order", () => {
    const events = [
      equip(1, { CharUID: HERO_B, ToEquipUID: W2 }), // W2: A → B
      { seq: 2, path: "/item/subOptionChange", res: { ItemData: wire(W2, HERO_B, 2, [160002, 0, 0, 0, 0]) } },
      insert(3),
      equip(4, { CharUID: HERO_A, ToInvenUID: EE }), // EE off A, keeps its new gem
    ];
    const { next } = foldEquipEvents(base(), events);
    expect(byUid(next, W2)).toMatchObject({ CharUID: HERO_B });
    expect((byUid(next, W2)!.SubOptionList as unknown[])[0]).toEqual({ OptionID: 160002, Level: 0, BaseLevel: 0 });
    expect(byUid(next, EE)!.CharUID).toBe("0");
    expect(gemIds(next, EE)).toEqual([15001, 15002, 0, 0, 0]);
  });

  it("is idempotent: the last state of a uid wins, a replay changes nothing", () => {
    const events = [insert(1), remove(2), insert(3)];
    const once = foldEquipEvents(base(), events);
    expect(gemIds(once.next, EE)).toEqual([15001, 15002, 0, 0, 0]);
    const twice = foldEquipEvents(once.next, events);
    expect(twice.next).toEqual(once.next);
    expect(twice.applied).toBe(0);
  });

  it("an uid absent from the snapshot is added; a response without a usable item is skipped", () => {
    const fresh = wire("6299999999", HERO_B, 9, [15003, 0, 0, 0, 0]);
    const { next, applied, skipped } = foldEquipEvents(base(), [
      { seq: 1, path: "/item/gemInsert", res: { Item: fresh } },
      { seq: 2, path: "/item/gemInsert", res: {} },
      { seq: 3, path: "/item/subOptionChange", res: { ItemData: { ItemUID: 2 ** 60, CharUID: 0 } } },
    ]);
    expect(next.ItemList.at(-1)).toMatchObject({ ItemUID: "6299999999", CharUID: HERO_B });
    expect([applied, skipped]).toEqual([1, 2]);
  });
});

describe("foldEquipEvents — upgrades (enchant, limit break, smelting, merge, craft, dissolve)", () => {
  const FODDER = "6300000001"; // free 1★ weapon, eaten by the enhance
  const STONE = "6300000002"; // enhance material stack
  const RESET = "6300000003"; // reset ticket stack
  const PIECE = "6300000004"; // smelting / limit-break material stack
  const base = () => ({
    ItemList: [
      ...snapshot().ItemList,
      { ItemUID: FODDER, CharUID: "0", ItemID: 5, Quantity: 1, InvenType: 0 },
      { ItemUID: STONE, CharUID: "0", ItemID: 30001, Quantity: 40, InvenType: 0 },
      { ItemUID: RESET, CharUID: "0", ItemID: 30002, Quantity: 2, InvenType: 0 },
      { ItemUID: PIECE, CharUID: "0", ItemID: 30003, Quantity: 7, InvenType: 0 },
    ],
    PresetList: [{ Num: 1 }],
  });
  // WSItemSimpleData / WSItemNormalData: uid + new stack count (+ ItemID).
  const simple = (ItemUID: string, Quantity: number, ItemID = 0) => ({ ItemUID, Quantity, ItemID });
  const uids = (raw: { ItemList: Array<{ ItemUID: string }> }) => raw.ItemList.map((it) => it.ItemUID);
  const enchant = (seq: number, exp: number, owner = HERO_A): EquipEvent => ({
    seq,
    path: "/item/enchant",
    res: { Item: wire(W2, owner, 2, [160001, 0, 0, 0, 0], { Exp: exp }), ItemList: [simple(FODDER, 0, 5), simple(STONE, 37, 30001)], Asset_0: 1 },
  });

  it("enchant: the piece is replaced, consumed materials removed or decremented", () => {
    const { next, applied, skipped } = foldEquipEvents(base(), [enchant(1, 1200)]);
    expect(byUid(next, W2)).toMatchObject({ Exp: 1200, CharUID: HERO_A });
    expect(byUid(next, FODDER)).toBeUndefined();
    expect(byUid(next, STONE)).toMatchObject({ Quantity: 37, InvenType: 0, ItemID: 30001 });
    expect(next.ItemList).toHaveLength(base().ItemList.length - 1);
    expect([applied, skipped]).toEqual([3, 0]);
  });

  it("enchantReset: the piece back to +0, the ticket decremented, the materials given back", () => {
    const res = {
      ResetItemData: wire(W2, HERO_A, 2, [160001, 0, 0, 0, 0], { Exp: 0 }),
      UseItemData: wire(RESET, 0, 30002, [0, 0, 0, 0, 0], { Quantity: 1 }),
      GetItemList: [simple(STONE, 43, 30001)],
      Asset_0: 1,
    };
    const { next, applied } = foldEquipEvents(foldEquipEvents(base(), [enchant(1, 1200)]).next, [{ seq: 2, path: "/item/enchantReset", res }]);
    expect(byUid(next, W2)!.Exp).toBe(0);
    // UseItemData only sets the count (CItemInventory.UpdateItem): the
    // snapshot's other fields stay.
    expect(byUid(next, RESET)).toEqual({ ItemUID: RESET, CharUID: "0", ItemID: 30002, Quantity: 1, InvenType: 0 });
    expect(byUid(next, STONE)!.Quantity).toBe(43);
    expect(applied).toBe(3);
  });

  it("breakLimit: the piece is replaced, the pieces it creates join the inventory", () => {
    const res = { Item: wire(W1, 0, 1, [0, 0, 0, 0, 0], { BreakLimitLevel: 1 }), ItemList: [wire("6300000099", 0, 30004, [0, 0, 0, 0, 0], { Quantity: 3 })], Asset_0: 1 };
    const { next, applied } = foldEquipEvents(base(), [{ seq: 1, path: "/item/breakLimit", res }]);
    expect(byUid(next, W1)).toMatchObject({ BreakLimitLevel: 1, CharUID: "0" });
    expect(next.ItemList.at(-1)).toMatchObject({ ItemUID: "6300000099", Quantity: 3, CharUID: "0" });
    expect(applied).toBe(2);
  });

  it("smelting and its reset: the piece's substats and count change, the source stack is decremented", () => {
    const smelt = { Item: wire(H1, HERO_B, 3, [160004, 0, 0, 0, 0], { SmeltingCount: 1 }), srcItem: { ItemUID: PIECE, Quantity: 6 }, Asset_0: 1 };
    const reset = { Item: wire(H1, HERO_B, 3, [160001, 0, 0, 0, 0], { SmeltingCount: 0 }), srcItem: { ItemUID: PIECE, Quantity: 5 }, Asset_0: 1 };
    const one = foldEquipEvents(base(), [{ seq: 1, path: "/item/smelting", res: smelt }]);
    expect(byUid(one.next, H1)).toMatchObject({ SmeltingCount: 1, CharUID: HERO_B });
    expect(byUid(one.next, PIECE)!.Quantity).toBe(6);
    expect(one.applied).toBe(2);
    const two = foldEquipEvents(one.next, [{ seq: 2, path: "/item/smeltingReset", res: reset }]);
    expect(byUid(two.next, H1)!.SmeltingCount).toBe(0);
    expect(byUid(two.next, PIECE)!.Quantity).toBe(5);
  });

  it("merge: the new item joins, the source stack is decremented (0 = gone)", () => {
    const res = { getItem: wire("6300000098", 0, 30005, [0, 0, 0, 0, 0]), useItem: wire(PIECE, 0, 30003, [0, 0, 0, 0, 0], { Quantity: 0 }), Asset_0: 1 };
    const { next, applied } = foldEquipEvents(base(), [{ seq: 1, path: "/item/merge", res }]);
    expect(byUid(next, PIECE)).toBeUndefined();
    expect(next.ItemList.at(-1)).toMatchObject({ ItemUID: "6300000098", ItemID: 30005 });
    expect(applied).toBe(2);
  });

  it("craft: the crafted pieces join, the materials and the additional item are decremented", () => {
    const res = {
      AdditionItem: wire(RESET, 0, 30002, [0, 0, 0, 0, 0], { Quantity: 1 }),
      MaterialItemList: [wire(STONE, 0, 30001, [0, 0, 0, 0, 0], { Quantity: 10 }), wire(PIECE, 0, 30003, [0, 0, 0, 0, 0], { Quantity: 0 })],
      CraftItemList: [wire("6300000097", 0, 7, [160001, 160002, 0, 0, 0]), wire("6300000096", 0, 7, [160003, 0, 0, 0, 0])],
      Asset_0: 1,
    };
    const { next, applied, skipped } = foldEquipEvents(base(), [{ seq: 1, path: "/item/craft", res }]);
    expect(uids(next).slice(-2)).toEqual(["6300000097", "6300000096"]);
    expect(byUid(next, RESET)!.Quantity).toBe(1);
    expect(byUid(next, STONE)!.Quantity).toBe(10);
    expect(byUid(next, PIECE)).toBeUndefined();
    expect([applied, skipped]).toEqual([5, 0]);
  });

  it("dissolve: pieces listed at 0 leave the inventory, even off a hero", () => {
    const res = { ItemList: [simple(H2, 0, 4), simple(H1, 0, 3)], RewardList: [], Asset_0: 1 };
    const { next, applied } = foldEquipEvents(base(), [{ seq: 1, path: "/item/dissolve", res }]);
    expect(uids(next)).not.toContain(H2);
    expect(uids(next)).not.toContain(H1);
    expect(applied).toBe(2);
  });

  it("a simple entry whose uid the snapshot lacks is skipped; a response with nothing usable too", () => {
    const { next, applied, skipped } = foldEquipEvents(base(), [
      { seq: 1, path: "/item/enchant", res: { Item: wire(W2, HERO_A, 2, [160001, 0, 0, 0, 0], { Exp: 5 }), ItemList: [simple("6399999999", 3), { ItemUID: STONE, Quantity: -1 }] } },
      { seq: 2, path: "/item/dissolve", res: { ItemList: [] } },
      { seq: 3, path: "/item/smelting", res: { srcItem: { ItemUID: PIECE } } },
    ]);
    expect(uids(next)).toEqual(uids(base()));
    expect(byUid(next, STONE)!.Quantity).toBe(40);
    expect([applied, skipped]).toEqual([1, 4]);
  });

  it("mixes with equip moves and gem changes in journal order", () => {
    const events: EquipEvent[] = [
      equip(1, { CharUID: HERO_B, ToEquipUID: W2 }), // W2: A → B
      enchant(2, 900, HERO_B),
      equip(3, { CharUID: HERO_A, ToEquipUID: FODDER }), // consumed already: skipped
      { seq: 4, path: "/item/gemInsert", res: { Item: wire(W2, HERO_B, 2, [160001, 15002, 0, 0, 0], { Exp: 900 }) } },
    ];
    const { next, skipped } = foldEquipEvents(base(), events);
    expect(byUid(next, W2)).toMatchObject({ CharUID: HERO_B, Exp: 900 });
    expect((byUid(next, W2)!.SubOptionList as Array<{ OptionID: number }>)[1]!.OptionID).toBe(15002);
    expect(byUid(next, FODDER)).toBeUndefined();
    expect(skipped).toBe(1);
  });

  it("is idempotent, and an entry removed then upserted again comes back", () => {
    const events: EquipEvent[] = [
      enchant(1, 1200),
      { seq: 2, path: "/item/merge", res: { getItem: wire(FODDER, 0, 5, [0, 0, 0, 0, 0], { Quantity: 1 }), useItem: simple(PIECE, 2) } },
    ];
    const once = foldEquipEvents(base(), events);
    expect(byUid(once.next, FODDER)).toMatchObject({ ItemID: 5, Quantity: 1, CharUID: "0" });
    expect(byUid(once.next, STONE)!.Quantity).toBe(37);
    expect(byUid(once.next, PIECE)!.Quantity).toBe(2);
    const twice = foldEquipEvents(once.next, events);
    expect(twice.next).toEqual(once.next);
    expect(twice.applied).toBe(0);
  });

  // CItemInventory.RemoveItem → DeletePresetEquipUID: in every preset, the
  // first slot holding the removed uid becomes 0.
  describe("presets of a removed piece", () => {
    const withPresets = () => ({
      ...base(),
      PresetList: [
        { PresetType: 0, Num: 1, Name: "", ItemUIDList: [W2, FODDER, "0", "0", "0", "0", "0", "0"], Favorites: 0 },
        { PresetType: 0, Num: 2, Name: "", ItemUIDList: [Number(FODDER), 0, 0, 0, 0, 0, 0, 0], Favorites: 0 },
        { PresetType: 0, Num: 3, Name: "", ItemUIDList: [W1, H2, "0", "0", "0", "0", "0", "0"], Favorites: 0 },
      ],
    });
    const slots = (raw: { PresetList?: unknown }) => (raw.PresetList as Array<{ ItemUIDList: unknown[] }>).map((p) => p.ItemUIDList);

    it("an enchant that eats a preset's piece zeroes its slot, in the slot's own type", () => {
      const raw = withPresets();
      const { next, applied } = foldEquipEvents(raw, [enchant(1, 1200)]);
      expect(slots(next)).toEqual([
        [W2, "0", "0", "0", "0", "0", "0", "0"],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [W1, H2, "0", "0", "0", "0", "0", "0"],
      ]);
      // A preset that didn't hold it keeps its ref; the input is untouched.
      expect((next.PresetList as unknown[])[2]).toBe(raw.PresetList[2]);
      expect(raw.PresetList[0]!.ItemUIDList[1]).toBe(FODDER);
      // W2, FODDER, STONE + the two slots cleared.
      expect(applied).toBe(5);
    });

    it("is idempotent, and a removed piece brought back stays out of the preset", () => {
      const events: EquipEvent[] = [
        enchant(1, 1200),
        { seq: 2, path: "/item/merge", res: { getItem: wire(FODDER, 0, 5, [0, 0, 0, 0, 0], { Quantity: 1 }), useItem: simple(PIECE, 2) } },
      ];
      const once = foldEquipEvents(withPresets(), events);
      expect(slots(once.next)[0]![1]).toBe("0");
      const twice = foldEquipEvents(once.next, events);
      expect(twice.next).toEqual(once.next);
      expect(twice.applied).toBe(0);
    });

    it("a removal that no preset holds leaves PresetList as is; one without ItemUIDList is tolerated", () => {
      const raw = withPresets();
      const dissolve: EquipEvent = { seq: 1, path: "/item/dissolve", res: { ItemList: [simple(H1, 0, 3)], RewardList: [], Asset_0: 1 } };
      expect(foldEquipEvents(raw, [dissolve]).next.PresetList).toBe(raw.PresetList);
      expect(foldEquipEvents(base(), [enchant(1, 1200)]).next.PresetList).toEqual([{ Num: 1 }]);
    });
  });
});

describe("parseEquipJournal", () => {
  it("reads complete lines only and drops malformed ones", () => {
    const text = [
      JSON.stringify(equip(1, { CharUID: HERO_B, ToEquipUID: W1 })),
      "not json",
      JSON.stringify({ seq: 2, path: "/item/equip", res: {} }),
      '{"seq":3,"path":"/item/eq', // torn: the plugin is mid-append
    ].join("\n");
    expect(parseEquipJournal(text).map((e) => e.seq)).toEqual([1, 2]);
    expect(parseEquipJournal("")).toEqual([]);
  });
});

describe("createEquipJournalFollower", () => {
  function folder() {
    const dir = mkdtempSync(join(tmpdir(), "gs-eq-"));
    const file = join(dir, "user_item.json");
    writeFileSync(file, JSON.stringify(snapshot()));
    // Back-date it, so a rewrite always shows a different mtime.
    utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
    const journal = (events: EquipEvent[]) =>
      writeFileSync(join(dir, EQUIP_JOURNAL), events.map((e) => JSON.stringify(e) + "\n").join(""));
    const read = () => owners(JSON.parse(readFileSync(file, "utf-8")) as ReturnType<typeof snapshot>);
    return { dir, file, journal, read };
  }

  it("folds new lines once, then stays idle until the journal grows", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()[W1]).toBe(HERO_B);
    const mtime = statSync(f.file).mtimeMs;
    expect(follower.sync()).toBe(0);
    expect(statSync(f.file).mtimeMs).toBe(mtime);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [W1]: HERO_B, [W2]: "0" });
  });

  it("remembers what it folded across an app restart", () => {
    const f = folder();
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(createEquipJournalFollower(f.dir).sync()).toBe(1);
    const mtime = statSync(f.file).mtimeMs;
    expect(createEquipJournalFollower(f.dir).sync()).toBe(0);
    expect(statSync(f.file).mtimeMs).toBe(mtime);
  });

  it("starts from zero after a truncation by a new /user/item", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(2);
    // New lobby: the plugin empties the journal, then rewrites the snapshot.
    f.journal([]);
    writeFileSync(f.file, JSON.stringify(snapshot()));
    expect(follower.sync()).toBe(0);
    expect(f.read()[W1]).toBe("0");
    // A new move after the lobby lands on the fresh snapshot.
    f.journal([equip(3, { CharUID: HERO_A, ToEquipUID: H2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [H2]: HERO_A, [W1]: "0", [W2]: HERO_A });
  });

  it("replays a new game session whose seq restarted at 1, even unseen while empty", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(2);
    // Game restarted: login rewrote the snapshot and truncated, then one move.
    writeFileSync(f.file, JSON.stringify(snapshot()));
    f.journal([equip(1, { CharUID: HERO_A, ToEquipUID: H2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [H2]: HERO_A, [W1]: "0", [W2]: HERO_A });
  });

  it("does not replay the journal over the app's own write-back", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(follower.sync()).toBe(1);
    // Game closed, local edit: W1 back to the inventory.
    const edited = snapshot();
    writeFileSync(f.file, JSON.stringify(edited));
    follower.noteSnapshotWritten();
    expect(follower.sync()).toBe(0);
    expect(f.read()[W1]).toBe("0");
  });
});
