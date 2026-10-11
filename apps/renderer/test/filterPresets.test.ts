import { beforeEach, describe, expect, it } from "vitest";
import { FILTER_PRESETS_KEY, loadFilterPresets } from "../src/lib/storage/filterPresets.js";

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
