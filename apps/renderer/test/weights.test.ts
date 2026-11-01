import { describe, expect, it } from "vitest";
import { INITIAL_FILTERS } from "../src/lib/solver/builderFilters.js";
import type { SavedBuild } from "../src/lib/storage/savedBuilds.js";
import { effectivePriority, hasPriority, priorityOf } from "../src/lib/heroPriority/weights.js";

describe("hasPriority / effectivePriority", () => {
  it("empty or absent: none", () => {
    expect(hasPriority({})).toBe(false);
    expect(hasPriority(null)).toBe(false);
    expect(hasPriority(undefined)).toBe(false);
    expect(effectivePriority({})).toBeNull();
    expect(effectivePriority(null)).toBeNull();
  });

  it("only zero weights: none", () => {
    expect(hasPriority({ atk: 0, hp: 0 })).toBe(false);
    expect(effectivePriority({ atk: 0, hp: 0 })).toBeNull();
  });

  it("one weight: the priority itself", () => {
    const p = { atk: 0, crc: 2 };
    expect(hasPriority(p)).toBe(true);
    expect(effectivePriority(p)).toBe(p);
  });
});

describe("priorityOf", () => {
  const saved = (id: string, createdAt: number, priority: Record<string, number>): SavedBuild => ({
    id, name: id, heroUid: "H", mode: "score", createdAt,
    build: {} as SavedBuild["build"], reforge: { reforgeMode: "disable", priority },
  });
  const savedBuilds = { H: [saved("new", 2, { def: 2 }), saved("old", 1, { hp: 1 })] };

  it("kept filters with a weight: source \"filters\"", () => {
    const heroFilters = { H: { ...INITIAL_FILTERS, priority: { atk: 3 } } };
    expect(priorityOf("H", { heroFilters, savedBuilds })).toEqual({ priority: { atk: 3 }, source: "filters" });
  });

  it("kept filters without a weight + a saved build: the most recent build's, source \"saved\"", () => {
    const heroFilters = { H: { ...INITIAL_FILTERS, priority: {} } };
    expect(priorityOf("H", { heroFilters, savedBuilds })).toEqual({ priority: { def: 2 }, source: "saved" });
    expect(priorityOf("H", { heroFilters: {}, savedBuilds })).toEqual({ priority: { def: 2 }, source: "saved" });
  });

  it("nothing kept, nothing saved: null", () => {
    expect(priorityOf("H", { heroFilters: {}, savedBuilds: {} })).toBeNull();
    expect(priorityOf("X", { heroFilters: { H: { ...INITIAL_FILTERS, priority: { atk: 1 } } }, savedBuilds })).toBeNull();
  });
});
