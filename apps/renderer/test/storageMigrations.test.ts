/**
 * Legacy localStorage shapes → current types. Each case is a blob an older
 * release actually wrote; loading it must yield a value the solver / Builder
 * can consume without crashing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FILTER_PRESETS_KEY, loadFilterPresets } from "../src/lib/storage/filterPresets.js";
import { SAVED_BUILDS_KEY, loadSavedBuilds } from "../src/lib/storage/savedBuilds.js";

// Map-backed localStorage shim (vitest runs in the `node` environment).
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

describe("filter presets — legacy migration", () => {
  const legacyPreset = (options: Record<string, unknown>) => ({
    h1: [{ id: "p1", name: "old", heroUid: "h1", createdAt: 0, filters: { excludedHeroes: [], options } }],
  });

  it("maps useReforged → reforgeMode and defaults topPct", () => {
    store.set(FILTER_PRESETS_KEY, JSON.stringify(legacyPreset({ useReforged: true, onlyMaxed: false })));
    const f = loadFilterPresets().h1![0]!.filters;
    expect(f.options.reforgeMode).toBe("classic");
    expect(f.topPct).toBe(60);
  });

  it("useReforged false / absent → disable", () => {
    store.set(FILTER_PRESETS_KEY, JSON.stringify(legacyPreset({ useReforged: false })));
    expect(loadFilterPresets().h1![0]!.filters.options.reforgeMode).toBe("disable");
    store.set(FILTER_PRESETS_KEY, JSON.stringify(legacyPreset({})));
    expect(loadFilterPresets().h1![0]!.filters.options.reforgeMode).toBe("disable");
  });

  it("keeps a current reforgeMode / topPct untouched", () => {
    const cur = legacyPreset({ reforgeMode: "ascended" });
    (cur.h1[0]!.filters as Record<string, unknown>).topPct = 25;
    store.set(FILTER_PRESETS_KEY, JSON.stringify(cur));
    const f = loadFilterPresets().h1![0]!.filters;
    expect(f.options.reforgeMode).toBe("ascended");
    expect(f.topPct).toBe(25);
  });
});

describe("saved builds — legacy migration", () => {
  const saved = (build: Record<string, unknown>) => ({
    h1: [{ id: "b1", name: "old", heroUid: "h1", mode: "score", createdAt: 0, build }],
  });

  it("backfills a missing gemAllocation", () => {
    store.set(SAVED_BUILDS_KEY, JSON.stringify(saved({ slots: [], finalStats: { atk: 1 } })));
    expect(loadSavedBuilds().h1![0]!.build.gemAllocation).toEqual({ talisman: [], ee: [] });
  });

  it("keeps an existing gemAllocation", () => {
    const gemAllocation = { talisman: [1, 2, 0, 0, 0], ee: [3] };
    store.set(SAVED_BUILDS_KEY, JSON.stringify(saved({ slots: [], finalStats: {}, gemAllocation })));
    expect(loadSavedBuilds().h1![0]!.build.gemAllocation).toEqual(gemAllocation);
  });
});
