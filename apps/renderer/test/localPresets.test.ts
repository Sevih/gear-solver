// Local presets (`lib/storage/localPresets.ts`): kept in GS only — the store
// (round-trip, 12-character names, rename, remove, malformed entries skipped),
// a Builder result's pieces moved from the engine order to the wire order, the
// copy of an in-game preset (EE left out, name cut), their rows on the Presets
// tab (`localPresetRows`), and the solver holds, which never see them.
import { beforeEach, describe, expect, it } from "vitest";
import type { Character, GearPiece, Inventory, Preset } from "@gear-solver/core";
import {
  addLocalPreset, isReadableLocalPreset, loadLocalPresets, localCopyOf, LOCAL_PRESETS_KEY, removeLocalPreset,
  renameLocalPreset, validLocalPresetName, wireUidsFromBuild,
} from "../src/lib/storage/localPresets.js";
import { localPresetRows, presetRows } from "../src/lib/presets/presetRows.js";
import { presetBlockedUids, presetHolds } from "../src/lib/presets/presetHolds.js";
import type { SolveBuild } from "../src/lib/solver/types.js";

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

const WIRE = ["w", "a", "h", "b", "g", "s", "0", "t"]; // weapon, accessory, helmet, armor, gloves, boots, EE, talisman
const piece = (uid: string, slot: GearPiece["slot"], equippedBy: string | null = null): GearPiece => ({ uid, slot, equippedBy } as GearPiece);
const preset = (num: number, itemUids: string[], name = `P${num}`): Preset => ({
  num, name, itemUids, favorite: false, presetType: 0, sortOrder: 0,
});

describe("localPresets — store", () => {
  it("round-trips, most recent first, EE kept at 0", () => {
    const a = addLocalPreset({ name: "  Arena  ", itemUids: WIRE, heroUid: "h1" }, 1);
    const b = addLocalPreset({ name: "Raid", itemUids: ["w", "a", "h", "b", "g", "s", "ee", "t"], heroUid: null }, 2);
    expect(a?.name).toBe("Arena");
    expect(b?.itemUids[6]).toBe("0");
    const list = loadLocalPresets();
    expect(list.map((p) => p.name)).toEqual(["Raid", "Arena"]);
    expect(list[1]).toMatchObject({ id: a!.id, itemUids: WIRE, heroUid: "h1", createdAt: 1 });
    expect(list[0]!.heroUid).toBeNull();
  });

  it("refuses a 13-character name, an empty one, or a list that isn't 8 slots", () => {
    expect(validLocalPresetName("x".repeat(12))).toBe("x".repeat(12));
    expect(validLocalPresetName("x".repeat(13))).toBeNull();
    expect(addLocalPreset({ name: "x".repeat(13), itemUids: WIRE, heroUid: null })).toBeNull();
    expect(addLocalPreset({ name: "   ", itemUids: WIRE, heroUid: null })).toBeNull();
    expect(addLocalPreset({ name: "short", itemUids: WIRE.slice(0, 7), heroUid: null })).toBeNull();
    expect(store.has(LOCAL_PRESETS_KEY)).toBe(false);
  });

  it("renames (trimmed, 12 characters max) and removes", () => {
    const a = addLocalPreset({ name: "A", itemUids: WIRE, heroUid: null }, 1)!;
    const b = addLocalPreset({ name: "B", itemUids: WIRE, heroUid: null }, 2)!;
    expect(renameLocalPreset(a.id, " Renamed ")).toBe(true);
    expect(renameLocalPreset(a.id, "x".repeat(13))).toBe(false);
    expect(renameLocalPreset("nope", "C")).toBe(false);
    expect(loadLocalPresets().map((p) => p.name)).toEqual(["B", "Renamed"]);
    removeLocalPreset(b.id);
    expect(loadLocalPresets().map((p) => p.id)).toEqual([a.id]);
  });

  it("skips a malformed entry, loads the rest; unreadable storage reads as none", () => {
    const good = { id: "ok", name: "Good", itemUids: WIRE, heroUid: null, createdAt: 0 };
    store.set(LOCAL_PRESETS_KEY, JSON.stringify([
      good,
      { id: "long", name: "x".repeat(13), itemUids: WIRE, heroUid: null, createdAt: 0 },
      { id: "short", name: "Short", itemUids: ["w"], heroUid: null, createdAt: 0 },
      { id: "num", name: "Num", itemUids: [1, 2, 3, 4, 5, 6, 7, 8], heroUid: null, createdAt: 0 },
      { id: "hero", name: "Hero", itemUids: WIRE, heroUid: 3, createdAt: 0 },
      { name: "No id", itemUids: WIRE, heroUid: null, createdAt: 0 },
      null,
    ]));
    expect(loadLocalPresets().map((p) => p.id)).toEqual(["ok"]);
    expect(isReadableLocalPreset(good)).toBe(true);
    expect(isReadableLocalPreset({ ...good, createdAt: "0" })).toBe(false);
    store.set(LOCAL_PRESETS_KEY, "{not json");
    expect(loadLocalPresets()).toEqual([]);
  });
});

describe("localPresets — from a Builder result", () => {
  it("moves each uid from the engine order to its wire index, EE at 0", () => {
    // Engine order: weapon, helmet, armor, gloves, boots, accessory, exclusive, ooparts.
    const build = { pieceUids: ["W", "H", "B", "G", "S", "A", "EE", "T"] } as SolveBuild;
    expect(wireUidsFromBuild(build.pieceUids)).toEqual(["W", "A", "H", "B", "G", "S", "0", "T"]);
  });
  it("an empty engine slot stays 0", () => {
    expect(wireUidsFromBuild(["W", "", "B", "G", "S", "A", "EE"])).toEqual(["W", "A", "0", "B", "G", "S", "0", "0"]);
  });
});

describe("localPresets — copy of an in-game preset", () => {
  const slots = new Map<string, GearPiece["slot"]>([["w", "weapon"], ["ee", "exclusive"], ["t", "ooparts"]]);
  const slotOf = (uid: string) => slots.get(uid);

  it("keeps the pieces, EE at 0, name cut to 12 characters", () => {
    const c = localCopyOf(preset(4, ["w", "a", "h", "b", "g", "s", "ee", "t"], "A very long preset name"), slotOf);
    expect(c.itemUids).toEqual(["w", "a", "h", "b", "g", "s", "0", "t"]);
    expect(c.name).toBe("A very long");
  });
  it("an unnamed preset is named by its number; a short list goes by inventory slot", () => {
    const c = localCopyOf(preset(7, ["t", "ee", "w"], "   "), slotOf);
    expect(c.name).toBe("Preset #7");
    expect(c.itemUids).toEqual(["w", "0", "0", "0", "0", "0", "0", "t"]);
  });
});

describe("localPresetRows", () => {
  const gear = [piece("w", "weapon", "h1"), piece("a", "accessory", "h1"), piece("t", "ooparts", "h1"), piece("x", "helmet")];
  const inventory: Inventory = {
    gear,
    characters: [{ uid: "h1" } as Character],
    presets: [preset(1, ["w", "a", "0", "0", "0", "0", "0", "t"])],
  };

  it("resolves the pieces like an in-game preset, with a negative num and its id", () => {
    const rows = localPresetRows([
      { id: "L1", name: "Mine", itemUids: ["w", "a", "gone", "0", "0", "0", "0", "t"] },
      { id: "L2", name: "Worn", itemUids: ["w", "a", "0", "0", "0", "0", "0", "t"] },
    ], inventory);
    expect(rows.map((r) => [r.preset.num, r.localId])).toEqual([[-1, "L1"], [-2, "L2"]]);
    expect(rows[0]!.pieces.map((p) => p.uid)).toEqual(["w", "a", "gone", "t"]);
    expect(rows[0]!.missingCount).toBe(1);
    expect(rows[0]!.pieces.find((p) => p.uid === "gone")?.slot).toBe("helmet"); // from its wire position
    // An in-game preset holds the same pieces: nothing is "shared" on a local card.
    expect(rows[1]!.sharedCount).toBe(0);
    expect(rows[1]!.wearerUids).toEqual(["h1"]);
    // The in-game rows are unchanged — no local id, no local preset among them.
    expect(presetRows(inventory).map((r) => [r.preset.num, r.localId])).toEqual([[1, undefined]]);
  });

  it("holds nothing for the solver: presetBlockedUids reads the in-game presets only", () => {
    addLocalPreset({ name: "Locked?", itemUids: ["x", "0", "0", "0", "0", "0", "0", "0"], heroUid: null });
    expect(loadLocalPresets()).toHaveLength(1);
    const holds = presetHolds(inventory, { 1: 1 }, [1]);
    expect(holds.holders.x).toBeUndefined();
    expect([...presetBlockedUids(holds, null)].sort()).toEqual(["a", "t", "w"]);
  });
});
