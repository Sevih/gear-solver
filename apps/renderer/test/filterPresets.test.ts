import { beforeEach, describe, expect, it } from "vitest";
import { FILTER_PRESETS_KEY, loadFilterPresets } from "../src/lib/storage/filterPresets.js";
import { applyBackup } from "../src/lib/storage/transfer.js";

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

/** A preset as saved before `reforgeMode` and `topPct` existed. */
function legacyPreset(options: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: "p1", name: "old", heroUid: "h1", createdAt: 0,
    filters: { excludedHeroes: [], setPlans: [[]], excludedSets: [], priority: {}, statFilters: {}, options, ...extra },
  };
}

function loadOne(preset: unknown) {
  store.set(FILTER_PRESETS_KEY, JSON.stringify({ h1: [preset] }));
  return loadFilterPresets().h1![0]!.filters;
}

describe("filter presets — legacy migration", () => {
  it("useReforged: true → reforgeMode classic", () => {
    expect(loadOne(legacyPreset({ useReforged: true })).options.reforgeMode).toBe("classic");
  });

  it("useReforged: false or absent → reforgeMode disable", () => {
    expect(loadOne(legacyPreset({ useReforged: false })).options.reforgeMode).toBe("disable");
    expect(loadOne(legacyPreset({})).options.reforgeMode).toBe("disable");
  });

  it("a saved reforgeMode wins over a leftover useReforged", () => {
    expect(loadOne(legacyPreset({ reforgeMode: "ascended", useReforged: false })).options.reforgeMode).toBe("ascended");
  });

  it("missing topPct → 60, saved topPct kept", () => {
    expect(loadOne(legacyPreset({})).topPct).toBe(60);
    expect(loadOne(legacyPreset({}, { topPct: 20 })).topPct).toBe(20);
  });
});

describe("filter presets — talisman effect picks", () => {
  it("a preset saved before the field loads with no talisman pick", () => {
    expect(loadOne(legacyPreset({})).talismanEffectPicks).toEqual({});
  });

  it("preferred / required / excluded come back as saved (list-shaped 6★ setIds included)", () => {
    const picks = { "3029, 3129": "preferred", "3023, 3123": "required", "3007": "excluded" };
    expect(loadOne(legacyPreset({}, { talismanEffectPicks: picks })).talismanEffectPicks).toEqual(picks);
  });

  it("an unknown state or a non-setId key is dropped", () => {
    const picks = { "3029, 3129": "maybe", TI_Icon_UO_Talisman_07: "required" };
    expect(loadOne(legacyPreset({}, { talismanEffectPicks: picks })).talismanEffectPicks).toEqual({});
  });

  it("preferred stays a talisman state — a weapon pick saved as preferred is dropped", () => {
    expect(loadOne(legacyPreset({}, { weaponEffectPicks: { "1001": "preferred" } })).weaponEffectPicks).toEqual({});
  });
});

describe("filter presets — main exclusions", () => {
  it("a preset saved before the field loads with no exclusion", () => {
    expect(loadOne(legacyPreset({})).mainExcludes).toEqual({});
  });

  it("saved exclusions come back as saved", () => {
    const excludes = { talisman: { atkPct: true } };
    expect(loadOne(legacyPreset({}, { mainExcludes: excludes })).mainExcludes).toEqual(excludes);
  });
});

describe("filter presets — a malformed entry", () => {
  it("is skipped, the other presets still load", () => {
    store.set(FILTER_PRESETS_KEY, JSON.stringify({ h1: [legacyPreset({}), { id: "x", name: "no filters" }], h2: [legacyPreset({}, { topPct: 20 })] }));
    const map = loadFilterPresets();
    expect(map.h1!.map((p) => p.id)).toEqual(["p1"]);
    expect(map.h2![0]!.filters.topPct).toBe(20);
  });

  it("merged by a backup import doesn't hide the presets already saved", () => {
    store.set(FILTER_PRESETS_KEY, JSON.stringify({ h1: [legacyPreset({})] }));
    applyBackup({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: { h2: [{ id: "x", name: "broken" }] } });
    expect(loadFilterPresets().h1!.map((p) => p.id)).toEqual(["p1"]);
  });
});
