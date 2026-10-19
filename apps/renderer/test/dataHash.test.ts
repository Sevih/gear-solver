import { beforeEach, describe, expect, it } from "vitest";
import type { GameData } from "@gear-solver/core";
import { INITIAL_FILTERS, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import { DATA_HASH_KEY, knownRefs, onDataPruned, pruneFilters, reconcileDataHash, type KnownRefs } from "../src/lib/storage/dataHash.js";
import { FILTER_PRESETS_KEY, loadFilterPresets } from "../src/lib/storage/filterPresets.js";
import { HERO_FILTERS_KEY, loadHeroFilters } from "../src/lib/storage/heroFilters.js";

// Map-backed Storage stubs — Vitest runs in the `node` environment.
function stubStorage(): { store: Map<string, string>; storage: Storage } {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
  return { store, storage };
}
let local: Map<string, string>;
let session: Map<string, string>;
beforeEach(() => {
  const l = stubStorage();
  const s = stubStorage();
  local = l.store;
  session = s.store;
  (globalThis as { localStorage?: Storage }).localStorage = l.storage;
  (globalThis as { sessionStorage?: Storage }).sessionStorage = s.storage;
});

/** Data with armor sets 1 and 2, and the effects "3001" (weapon) and
 *  "3023, 3123" (6★ talisman) — set 9 and effect "3999" are gone. */
const GAME = {
  sets: { "1": {}, "2": {} },
  equipment: {
    "10": { setId: "3001" },
    "11": { setId: "3023, 3123" },
    "12": { setId: null },
  },
} as unknown as GameData;
const KNOWN = knownRefs(GAME);

const TUNED: SolverFilters = {
  ...INITIAL_FILTERS,
  topPct: 20,
  setPlans: [[{ setId: "1", count: 2 }, { setId: "9", count: 2 }], [{ setId: "9", count: 4 }]],
  excludedSets: ["2", "9"],
  weaponEffectPicks: { "3001": "required", "3999": "required" },
  accessoryEffectPicks: { "3999": "excluded" },
  talismanEffectPicks: { "3023, 3123": "preferred" },
};

describe("pruneFilters", () => {
  it("drops dead set ids and effect keys, keeps the rest", () => {
    const f = pruneFilters(TUNED, KNOWN);
    expect(f.setPlans).toEqual([[{ setId: "1", count: 2 }]]); // the 4pc-of-9 plan emptied → dropped
    expect(f.excludedSets).toEqual(["2"]);
    expect(f.weaponEffectPicks).toEqual({ "3001": "required" });
    expect(f.accessoryEffectPicks).toEqual({});
    expect(f.talismanEffectPicks).toEqual({ "3023, 3123": "preferred" });
    expect(f.topPct).toBe(20);
  });

  it("every plan emptied → one empty plan, the editor's minimum", () => {
    expect(pruneFilters({ ...INITIAL_FILTERS, setPlans: [[{ setId: "9", count: 4 }]] }, KNOWN).setPlans).toEqual([[]]);
  });

  it("nothing dead → the same object", () => {
    const live = { ...INITIAL_FILTERS, setPlans: [[{ setId: "1", count: 4 }]], weaponEffectPicks: { "3001": "excluded" as const } };
    expect(pruneFilters(live, KNOWN)).toBe(live);
  });
});

/** The stored blobs, as the two storage modules write them. */
function seed(hash: string | null) {
  if (hash != null) local.set(DATA_HASH_KEY, hash);
  local.set(FILTER_PRESETS_KEY, JSON.stringify({
    h1: [{ id: "p1", name: "speed", heroUid: "h1", createdAt: 0, filters: { ...TUNED, excludedHeroes: ["h2"] } }],
  }));
  session.set(HERO_FILTERS_KEY, JSON.stringify({ h1: { ...TUNED, excludedHeroes: [] } }));
}

describe("reconcileDataHash", () => {
  it("first time: stores the hash, touches nothing", () => {
    seed(null);
    const presets = local.get(FILTER_PRESETS_KEY);
    const heroFilters = session.get(HERO_FILTERS_KEY);
    expect(reconcileDataHash("h-new", GAME)).toBe("first");
    expect(local.get(DATA_HASH_KEY)).toBe("h-new");
    expect(local.get(FILTER_PRESETS_KEY)).toBe(presets);
    expect(session.get(HERO_FILTERS_KEY)).toBe(heroFilters);
  });

  it("same hash: nothing", () => {
    seed("h1");
    const presets = local.get(FILTER_PRESETS_KEY);
    expect(reconcileDataHash("h1", GAME)).toBe("same");
    expect(local.get(FILTER_PRESETS_KEY)).toBe(presets);
    expect(loadHeroFilters().h1!.excludedSets).toEqual(["2", "9"]);
  });

  it("new hash: the vanished set leaves the preset and the per-hero filters, the rest stays", () => {
    seed("h1");
    expect(reconcileDataHash("h2", GAME)).toBe("pruned");
    expect(local.get(DATA_HASH_KEY)).toBe("h2");
    const preset = loadFilterPresets().h1![0]!;
    expect(preset.name).toBe("speed");
    expect(preset.filters.setPlans).toEqual([[{ setId: "1", count: 2 }]]);
    expect(preset.filters.excludedSets).toEqual(["2"]);
    expect(preset.filters.weaponEffectPicks).toEqual({ "3001": "required" });
    expect([...preset.filters.excludedHeroes]).toEqual(["h2"]);
    const remembered = loadHeroFilters().h1!;
    expect(remembered.setPlans).toEqual([[{ setId: "1", count: 2 }]]);
    expect(remembered.excludedSets).toEqual(["2"]);
    expect(remembered.topPct).toBe(20);
  });

  it("pruned notifies the subscribers with `known` once both maps are written; first / same don't; unsubscribe", () => {
    const calls: { known: KnownRefs; heroFilters: SolverFilters | undefined }[] = [];
    const off = onDataPruned((known) => calls.push({ known, heroFilters: loadHeroFilters().h1 }));
    seed(null);
    expect(reconcileDataHash("h1", GAME)).toBe("first");
    expect(reconcileDataHash("h1", GAME)).toBe("same");
    expect(calls).toHaveLength(0);
    seed("h1");
    expect(reconcileDataHash("h2", GAME)).toBe("pruned");
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.known.sets].sort()).toEqual([...KNOWN.sets].sort());
    expect([...calls[0]!.known.effects].sort()).toEqual([...KNOWN.effects].sort());
    // Already pruned on disk when the listener runs.
    expect(calls[0]!.heroFilters!.excludedSets).toEqual(["2"]);
    off();
    seed("h1");
    expect(reconcileDataHash("h2", GAME)).toBe("pruned");
    expect(calls).toHaveLength(1);
  });

  it("data that knows no set prunes nothing and keeps the old hash", () => {
    seed("h1");
    const presets = local.get(FILTER_PRESETS_KEY);
    expect(reconcileDataHash("h2", { ...GAME, sets: {} })).toBe("skipped");
    expect(local.get(DATA_HASH_KEY)).toBe("h1");
    expect(local.get(FILTER_PRESETS_KEY)).toBe(presets);
  });
});
