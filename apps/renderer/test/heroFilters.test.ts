import { beforeEach, describe, expect, it } from "vitest";
import type { SolverFilters } from "../src/lib/solver/builderFilters.js";
import { filtersForHero, HERO_FILTERS_KEY, loadHeroFilters, persistHeroFilters, withHeroFilters, type HeroFiltersMap } from "../src/lib/storage/heroFilters.js";

const DEFAULTS = { topPct: 60, priority: {}, excludedHeroes: new Set<string>() } as unknown as SolverFilters;
const TUNED_X = { topPct: 20, priority: { atk: 2 }, excludedHeroes: new Set(["z"]) } as unknown as SolverFilters;

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

describe("per-hero filter memory — storage", () => {
  it("written to and read from localStorage, the excludedHeroes Set round-tripped", () => {
    persistHeroFilters({ X: TUNED_X });
    expect(local.has(HERO_FILTERS_KEY)).toBe(true);
    expect(session.has(HERO_FILTERS_KEY)).toBe(false);
    const x = loadHeroFilters().X!;
    expect(x.topPct).toBe(20);
    expect(x.priority).toEqual({ atk: 2 });
    expect([...x.excludedHeroes]).toEqual(["z"]);
  });

  it("a map left in sessionStorage by an older version is ignored", () => {
    session.set(HERO_FILTERS_KEY, JSON.stringify({ X: { ...TUNED_X, excludedHeroes: [] } }));
    expect(loadHeroFilters()).toEqual({});
  });
});

describe("per-hero filter memory — opening a hero", () => {
  it("the Builder opens on the hero's remembered filters", () => {
    const f = filtersForHero({ X: TUNED_X }, "X", DEFAULTS, { hp: 1 });
    expect(f.topPct).toBe(20);
    expect(f.priority).toEqual({ atk: 2 }); // kept set wins over the fallback
    expect(f.excludedHeroes).not.toBe(TUNED_X.excludedHeroes); // cloned, not aliased
  });

  it("falls back to the defaults for an unknown or absent hero", () => {
    expect(filtersForHero({ X: TUNED_X }, "Y", DEFAULTS)).toBe(DEFAULTS);
    expect(filtersForHero({ X: TUNED_X }, null, DEFAULTS)).toBe(DEFAULTS);
  });

  it("no kept set: the defaults with the fallback priority (latest saved build's)", () => {
    const f = filtersForHero({}, "Y", DEFAULTS, { def: 3 });
    expect(f.topPct).toBe(60);
    expect(f.priority).toEqual({ def: 3 });
    expect(DEFAULTS.priority).toEqual({}); // the defaults aren't touched
    expect(f.excludedHeroes).not.toBe(DEFAULTS.excludedHeroes);
  });
});

describe("per-hero filter memory — writing the open hero", () => {
  it("sets the hero's entry to a clone of the live filters, the others kept", () => {
    const map: HeroFiltersMap = { X: TUNED_X };
    const live = { ...DEFAULTS, topPct: 40 } as SolverFilters;
    const next = withHeroFilters(map, "Y", live);
    expect(next).not.toBe(map);
    expect(next.X).toBe(TUNED_X);
    expect(next.Y!.topPct).toBe(40);
    expect(next.Y!.excludedHeroes).not.toBe(live.excludedHeroes);
  });
});
