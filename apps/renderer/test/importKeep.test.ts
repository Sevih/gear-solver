// Re-imports without needless work:
//  - the results table's stat columns are keyed on WHICH are shown
//    (`visibleStatKey`), so typing a min / max bound keeps the same columns;
//  - a re-import whose tables carry the same `version.json` hash keeps the
//    loaded GameData (`keptGameData` + `autoImport(kept)`): none of the
//    `/gamedata/*` tables is fetched again and the reference is the same.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameData } from "@gear-solver/core";
import { autoImport, keptGameData } from "../src/data.js";
import { SOLVER_STATS, statColumnsOfKey, visibleStatKey } from "../src/screens/builder/statColumns.js";

describe("visibleStatKey — the stat columns, stable while only the bounds change", () => {
  it("typing a bound on a filtered stat keeps the same key", () => {
    const prefs = { atk: false };
    const a = visibleStatKey({ atk: { min: 1 } }, prefs);
    const b = visibleStatKey({ atk: { min: 12 } }, prefs);
    const c = visibleStatKey({ atk: { min: 125, max: 4000 } }, prefs);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.split(",")).toContain("atk"); // filtered: force-shown despite the pref
  });

  it("the default shows the first 8 stats; a band on a hidden one adds it; a pref hides one", () => {
    const first8 = SOLVER_STATS.slice(0, 8).map((s) => s.key).join(",");
    expect(visibleStatKey({}, {})).toBe(first8);
    expect(visibleStatKey({ eff: {} }, {})).toBe(first8); // an empty band is no filter
    expect(visibleStatKey({ eff: { max: 300 } }, {}).split(",")).toContain("eff");
    expect(visibleStatKey({}, { hp: false }).split(",")).not.toContain("hp");
  });

  it("statColumnsOfKey gives the same columns, in table order", () => {
    const key = visibleStatKey({ effRes: { min: 1 } }, { def: false });
    const cols = statColumnsOfKey(key);
    expect(cols.map((s) => s.key).join(",")).toBe(key);
    expect(cols.every((s) => SOLVER_STATS.includes(s))).toBe(true);
  });
});

/** Every /gamedata/* table answers `{}`, no capture on disk; counts the table fetches. */
function serve() {
  const tables: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/gamedata/")) { tables.push(url); return Response.json({}); }
    return new Response("not found", { status: 404 });
  }));
  return tables;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("GameData kept at an equal hash", () => {
  const game = { characters: {} } as unknown as GameData;
  const v = (hash: string) => ({ hash, builtAt: "2026-11-15T00:00:00.000Z" });

  it("keptGameData: same hash → the kept data; another hash, no stamp or nothing kept → load", () => {
    expect(keptGameData(v("h1"), { hash: "h1", game })).toBe(game);
    expect(keptGameData(v("h2"), { hash: "h1", game })).toBeUndefined();
    expect(keptGameData(null, { hash: "h1", game })).toBeUndefined();
    expect(keptGameData(v("h1"), null)).toBeUndefined();
  });

  it("autoImport(kept) fetches none of the tables and returns the same reference", async () => {
    const tables = serve();
    const r = await autoImport(keptGameData(v("h1"), { hash: "h1", game }));
    expect(tables).toEqual([]);
    expect(r.game).toBe(game);
  });

  it("autoImport() without kept data loads the tables", async () => {
    const tables = serve();
    const r = await autoImport();
    expect(tables).toContain("/gamedata/options.json");
    expect(r.game).not.toBeNull();
    expect(r.game).not.toBe(game);
  });
});
