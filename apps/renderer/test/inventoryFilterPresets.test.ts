// Inventory filter presets (lib/storage/inventoryFilterPresets.ts): the
// `gs.inv.filterPresets` list (codec string per entry, tolerant read, a name
// taken twice overwrites) and the built-in "Scrap candidates" preset read
// through `matchesFilters`.
import { beforeEach, describe, expect, it } from "vitest";
import { parseGearPiece, type RawItem } from "@gear-solver/core";
import { toUiPiece, type UiPiece } from "../src/design/adapter.js";
import { emptyFilters, matchesFilters, type FilterState } from "../src/screens/inventory/filters.js";
import {
  INVENTORY_FILTER_PRESETS_KEY, SCRAP_CANDIDATES, deleteInventoryFilterPreset, loadInventoryFilterPresets,
  saveInventoryFilterPreset,
} from "../src/lib/storage/inventoryFilterPresets.js";

// Map-backed localStorage stub — Vitest runs in the `node` environment.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
});

const stored = () => JSON.parse(store.get(INVENTORY_FILTER_PRESETS_KEY)!) as Array<{ id: string; name: string; filters: string }>;

describe("inventory filter presets — storage", () => {
  it("round-trips a FilterState, Sets included, search cleared", () => {
    const f: FilterState = {
      ...emptyFilters(),
      slots: new Set(["helmet", "boots"]),
      stars: new Set([6]),
      subs: new Set(["spd", "critRate"]),
      subMode: "and",
      armorSets: new Set(["12"]),
      baseRolls: { op: "lt", lines: [2, 2, null, null], not: true },
      notReforged: true,
      query: "boots",
    };
    const saved = saveInventoryFilterPreset("  Speed boots ", f);
    expect(saved?.name).toBe("Speed boots");
    const [p] = loadInventoryFilterPresets();
    expect(p?.name).toBe("Speed boots");
    expect(p?.filters).toEqual({ ...f, query: "" });
    expect(p?.filters.slots).toBeInstanceOf(Set);
    expect(typeof stored()[0]?.filters).toBe("string");
  });

  it("skips a malformed entry and keeps the valid ones", () => {
    saveInventoryFilterPreset("good", emptyFilters());
    const list = stored();
    store.set(INVENTORY_FILTER_PRESETS_KEY, JSON.stringify([
      null,
      { id: "a", name: "no filters", createdAt: 0 },
      { id: "b", name: "bad json", filters: "{", createdAt: 0 },
      { id: "c", name: "array", filters: "[]", createdAt: 0 },
      { id: "d", name: "", filters: "{}", createdAt: 0 },
      { id: "e", name: "x".repeat(25), filters: "{}", createdAt: 0 },
      ...list,
    ]));
    expect(loadInventoryFilterPresets().map((p) => p.name)).toEqual(["good"]);
    store.set(INVENTORY_FILTER_PRESETS_KEY, "not json");
    expect(loadInventoryFilterPresets()).toEqual([]);
  });

  it("an entry stored before a newer field reads its default", () => {
    store.set(INVENTORY_FILTER_PRESETS_KEY, JSON.stringify([{ id: "old", name: "old", filters: JSON.stringify({ stars: [5] }), createdAt: 0 }]));
    const [p] = loadInventoryFilterPresets();
    expect(p?.filters.stars).toEqual(new Set([5]));
    expect(p?.filters.notReforged).toBe(false);
    expect(p?.filters.baseRolls).toEqual(emptyFilters().baseRolls);
  });

  it("a name taken twice overwrites that preset in place", () => {
    const first = saveInventoryFilterPreset("A", { ...emptyFilters(), stars: new Set([5]) });
    saveInventoryFilterPreset("B", emptyFilters());
    const again = saveInventoryFilterPreset("A", { ...emptyFilters(), stars: new Set([6]) });
    expect(again?.id).toBe(first?.id);
    const list = loadInventoryFilterPresets();
    expect(list.map((p) => p.name)).toEqual(["A", "B"]);
    expect(list[0]?.filters.stars).toEqual(new Set([6]));
  });

  it("rejects an empty, a 25-character or the built-in's name", () => {
    expect(saveInventoryFilterPreset("   ", emptyFilters())).toBeNull();
    expect(saveInventoryFilterPreset("x".repeat(25), emptyFilters())).toBeNull();
    expect(saveInventoryFilterPreset(SCRAP_CANDIDATES.name, emptyFilters())).toBeNull();
    expect(saveInventoryFilterPreset("x".repeat(24), emptyFilters())).not.toBeNull();
    expect(loadInventoryFilterPresets()).toHaveLength(1);
  });

  it("deletes by id", () => {
    const a = saveInventoryFilterPreset("A", emptyFilters());
    saveInventoryFilterPreset("B", emptyFilters());
    deleteInventoryFilterPreset(a!.id);
    expect(loadInventoryFilterPresets().map((p) => p.name)).toEqual(["B"]);
  });
});

/** A wire item whose sub lines carry these base stages (BaseLevel = stage - 1). */
const item = (stages: number[]): RawItem => ({
  ItemUID: "1", CharUID: "0", ItemID: 0, Exp: 0, BreakLimitLevel: 0, Quantity: 1, SmeltingCount: 0, IsLock: 0,
  SelectSubOptionNum: 0, SingularityOptionID: 0, SingularityStep: 0, SingularityLevel: 0, OptionList: [],
  SubOptionList: stages.map((st, i) => ({ OptionID: 160001 + i, BaseLevel: st - 1, Level: st - 1 })),
} as RawItem);
/** A free +0 T0 never-reforged piece of `stars` stars with these base stages. */
const piece = (stars: number, stages: number[], over: Partial<UiPiece> = {}): UiPiece => ({
  ...toUiPiece(parseGearPiece(item(stages))),
  slot: "helmet", stars, enhance: 0, bt: 0, reforge: { n: 0, max: 5 }, status: "free", ...over,
});

describe("Scrap candidates", () => {
  const f = SCRAP_CANDIDATES.filters();
  it("keeps 6★ 2/2/1/0 and 6★ 3/2/2/1 at +0 T0 not reforged, free", () => {
    expect(matchesFilters(piece(6, [2, 2, 1]), f)).toBe(true);
    expect(matchesFilters(piece(6, [3, 2, 2, 1]), f)).toBe(true);
  });

  it("rejects 6★ 3/3/3/0, 5★ 2/2/2/2 at +3, 4★ 1/1/1/1 and a talisman", () => {
    expect(matchesFilters(piece(6, [3, 3, 3]), f)).toBe(false);
    expect(matchesFilters(piece(5, [2, 2, 2, 2], { enhance: 3 }), f)).toBe(false);
    expect(matchesFilters(piece(4, [1, 1, 1, 1]), f)).toBe(false);
    expect(matchesFilters(piece(6, [], { slot: "talisman" }), f)).toBe(false);
  });

  it("rejects an equipped piece, and each call hands out fresh Sets", () => {
    expect(matchesFilters(piece(6, [2, 2, 1], { status: "equipped" }), f)).toBe(false);
    expect(SCRAP_CANDIDATES.filters().stars).not.toBe(f.stars);
  });
});
