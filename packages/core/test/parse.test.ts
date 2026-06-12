import { describe, it, expect } from "vitest";
import { parseInventory, isGear } from "../src/parse.js";
import type { RawUserItem } from "../src/raw.js";

const sample: RawUserItem = {
  ItemList: [
    {
      ItemUID: "1",
      CharUID: "0",
      ItemID: 619,
      Exp: 0,
      BreakLimitLevel: 4,
      Quantity: 1,
      SmeltingCount: 2,
      IsLock: 1,
      InvenType: 0,
      SelectSubOptionNum: 99,
      SingularityOptionID: 0,
      SingularityStep: 0,
      SingularityLevel: 5,
      OptionList: [5024, 5048],
      SubOptionList: [
        { OptionID: 160012, Level: 4, BaseLevel: 2 },
        { OptionID: 160009, Level: 1, BaseLevel: 1 },
        { OptionID: 0, Level: 0, BaseLevel: 0 },
      ],
    },
    // a non-gear stackable (no substats) — should be filtered out
    {
      ItemUID: "2",
      CharUID: "0",
      ItemID: 1,
      Exp: 0,
      BreakLimitLevel: 0,
      Quantity: 50,
      SmeltingCount: 0,
      IsLock: 0,
      InvenType: 0,
      SelectSubOptionNum: 0,
      SingularityOptionID: 0,
      SingularityStep: 0,
      SingularityLevel: 0,
      OptionList: [0, 0],
      SubOptionList: [],
    },
  ],
};

describe("parseInventory", () => {
  it("keeps gear, drops non-gear", () => {
    expect(sample.ItemList.filter(isGear)).toHaveLength(1);
    const inv = parseInventory(sample);
    expect(inv.gear).toHaveLength(1);
  });

  it("maps identity, breakthrough, reforge and substat ticks", () => {
    const g = parseInventory(sample).gear[0]!;
    expect(g.itemId).toBe(619);
    expect(g.breakthrough).toBe(4);
    expect(g.reforgeCount).toBe(2);
    expect(g.singularityLevel).toBe(5);
    expect(g.locked).toBe(true);
    expect(g.equippedBy).toBeNull();
    // two real subs (the OptionID:0 padding line is dropped)
    expect(g.subs).toHaveLength(2);
    const sub0 = g.subs[0]!;
    expect(sub0.ticks).toBe(4);
    expect(sub0.reforgeTicks).toBe(2); // 4 total - 2 initial
  });
});
