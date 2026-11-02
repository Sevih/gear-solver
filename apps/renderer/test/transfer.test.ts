import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyBackup, buildBackup, onBackupImported } from "../src/lib/storage/transfer.js";
import { BACKUP_KEYS, backupLabels } from "../src/lib/storage/keys.js";
import { addSavedBuild, loadSavedBuilds, persistSavedBuilds, type SavedBuild } from "../src/lib/storage/savedBuilds.js";
import { BackupPane, importSummary } from "../src/design/settings/BackupPane.js";

// Minimal localStorage shim — the transfer module is the only storage code
// exercised here and it only needs get/set. Vitest runs in the `node`
// environment (no DOM), so we install a Map-backed stub on globalThis.
const store = new Map<string, string>();
const writes: string[] = [];
beforeEach(() => {
  store.clear();
  writes.length = 0;
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); store.set(k, String(v)); },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
});

const SAVED_KEY = "gs.solver.savedBuilds";
const PRESETS_KEY = "gs.solver.filterPresets";
const INV_KEY = "gs.inv.filterPresets";
const LOCAL_KEY = "gs.presets.local";
const WIRE = ["w", "a", "h", "b", "g", "s", "0", "t"];
const builderPreset = (id: string) => ({ id, name: id, heroUid: "h1", createdAt: 0, filters: { excludedHeroes: [] } });
const invPreset = (id: string, name: string) => ({ id, name, filters: "{}", createdAt: 0 });
const localPreset = (id: string, name: string) => ({ id, name, itemUids: WIRE, heroUid: null, createdAt: 0 });
const worklistEntry = (heroUid: string, id = `w-${heroUid}`) =>
  ({ id, heroUid, heroName: heroUid, charId: 1, mode: "score", cp: null, upg: 0, changes: [], createdAt: 0 });
const v1 = (over: object = {}) => ({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {}, ...over });
const v2 = (over: object = {}) => ({ kind: "gear-solver-backup", version: 2, exportedAt: 0, ...over });
const stored = (key: string) => JSON.parse(store.get(key)!) as unknown;

/** A value for every backed-up key, each one its loader reads. */
const EVERY_KEY: Record<string, unknown> = {
  [SAVED_KEY]: { h1: [{ id: "b1" }] },
  [PRESETS_KEY]: { h1: [builderPreset("p1")] },
  [INV_KEY]: [invPreset("i1", "Mine")],
  [LOCAL_KEY]: [localPreset("l1", "Local")],
  "gs.presetHeroes": { 1: { referenceUid: "h1", associatedUids: ["h2"] } },
  "gs.solver.heroFilters": { h1: { priority: { atkPct: 1 }, excludedHeroes: [] } },
  "gs.priority.rank": { h1: 1, h2: 2 },
  "gs.presets.rank": { 1: 1 },
  "gs.presets.locked": [1],
  "gs.solver.excludedPieces": ["junk"],
  "gs.worklist": [worklistEntry("h1")],
  "gs.builds.notes": { h1: "speed tune" },
  "gs.builder.cols": { score: false },
  "gs.gear.scrap.default": "i1",
  "gs.builder.resultRows": 8,
  "gs.solver.workerCount": 1,
  "gs.solver.topN": 500,
  "gs.solver.topK": 2000,
  "gs.solver.reforgeMode": "ascended",
  "gs.solver.rerollPotential": true,
  "gs.builder.heatmap": false,
  "gs.builder.compactCards": true,
  "gs.solver.presetLossWarn": 20,
  "gs.debug.solver": true,
  "gs.debug.statLocks": true,
};

describe("transfer — backup v2 round-trip", () => {
  it("the fixture covers every backed-up key", () => {
    expect(Object.keys(EVERY_KEY).sort()).toEqual(BACKUP_KEYS.map((s) => s.key).sort());
  });

  it("exports every backed-up key under its key and imports them all back", () => {
    for (const [k, v] of Object.entries(EVERY_KEY)) store.set(k, JSON.stringify(v));
    store.set("gs.tab", JSON.stringify("Optimizer"));
    store.set("gs.priority.seen", JSON.stringify(["h1"]));
    const bundle = buildBackup(12345);
    expect(bundle).toMatchObject({ kind: "gear-solver-backup", version: 2, exportedAt: 12345 });
    for (const [k, v] of Object.entries(EVERY_KEY)) expect(bundle[k], k).toEqual(v);
    // The app's own state stays home.
    expect(bundle["gs.tab"]).toBeUndefined();
    expect(bundle["gs.priority.seen"]).toBeUndefined();

    store.clear();
    const res = applyBackup(JSON.parse(JSON.stringify(bundle)));
    for (const [k, v] of Object.entries(EVERY_KEY)) {
      expect(stored(k), k).toEqual(v);
      expect(res[k], k).toBeGreaterThan(0);
    }
  });

  it("leaves out a key never written; importing the same file again changes and writes nothing", () => {
    store.set(SAVED_KEY, JSON.stringify(EVERY_KEY[SAVED_KEY]));
    const bundle = buildBackup(0);
    expect(Object.keys(bundle).filter((k) => k.startsWith("gs."))).toEqual([SAVED_KEY]);
    const res = applyBackup(bundle);
    expect(Object.values(res).every((n) => n === 0)).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("transfer — Scrap default", () => {
  it("the file's id replaces mine, even one this machine doesn't know (read falls back, not the import)", () => {
    store.set("gs.gear.scrap.default", JSON.stringify("mine"));
    expect(applyBackup(v2({ "gs.gear.scrap.default": "elsewhere" }))["gs.gear.scrap.default"]).toBe(1);
    expect(stored("gs.gear.scrap.default")).toBe("elsewhere");
    expect(applyBackup(v2({ "gs.gear.scrap.default": 3 }))["gs.gear.scrap.default"]).toBe(0);
    expect(stored("gs.gear.scrap.default")).toBe("elsewhere");
  });
});

describe("transfer — a v1 file (five blocks)", () => {
  it("imports each block under its key", () => {
    const res = applyBackup(v1({
      savedBuilds: { h1: [{ id: "b1" }] },
      filterPresets: { h1: [builderPreset("p1")] },
      presetHeroes: { 2: { referenceUid: "h1", associatedUids: [] } },
      inventoryFilterPresets: [invPreset("i1", "A")],
      localPresets: [localPreset("l1", "L")],
    }));
    expect(res).toMatchObject({ [SAVED_KEY]: 1, [PRESETS_KEY]: 1, "gs.presetHeroes": 1, [INV_KEY]: 1, [LOCAL_KEY]: 1, "gs.worklist": 0 });
    expect(stored(SAVED_KEY)).toEqual({ h1: [{ id: "b1" }] });
    expect(stored("gs.presetHeroes")).toEqual({ 2: { referenceUid: "h1", associatedUids: [] } });
    expect(stored(LOCAL_KEY)).toEqual([localPreset("l1", "L")]);
  });

  it("a v1 file without the optional blocks imports none of them", () => {
    const res = applyBackup(v1());
    expect(res[INV_KEY]).toBe(0);
    expect(res[LOCAL_KEY]).toBe(0);
    expect(writes).toEqual([]);
  });
});

describe("transfer — merge rules", () => {
  it("per-hero lists: adds only the ids not stored, the stored entry wins", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "b1", name: "original" }] }));
    const res = applyBackup(v2({ [SAVED_KEY]: { h1: [{ id: "b1", name: "incoming" }, { id: "b2" }], h2: [{ id: "b3" }] } }));
    expect(res[SAVED_KEY]).toBe(2);
    expect(stored(SAVED_KEY)).toEqual({ h1: [{ id: "b1", name: "original" }, { id: "b2" }], h2: [{ id: "b3" }] });
  });

  it("per-hero lists: an entry the loader rejects counts 0 and writes nothing", () => {
    store.set(PRESETS_KEY, JSON.stringify({}));
    const res = applyBackup(v1({ filterPresets: { h1: [{ id: "p1", name: "broken" }, builderPreset("p2")] } }));
    expect(res[PRESETS_KEY]).toBe(1);
    expect((stored(PRESETS_KEY) as Record<string, Array<{ id: string }>>).h1!.map((p) => p.id)).toEqual(["p2"]);
    writes.length = 0;
    expect(applyBackup(v1({ filterPresets: { h1: [{ id: "p3", name: "broken" }] } }))[PRESETS_KEY]).toBe(0);
    expect(writes).toEqual([]);
  });

  it("Gear filter sets: the stored entry wins on id or name, unreadable entries count 0", () => {
    store.set(INV_KEY, JSON.stringify([invPreset("a", "A")]));
    const res = applyBackup(v2({ [INV_KEY]: [
      invPreset("a", "other"), invPreset("z", "A"), invPreset("b", "B"),
      { id: "c", name: "", filters: "{}", createdAt: 0 }, { id: "d", name: "bad json", filters: "{", createdAt: 0 },
      { id: "f", name: "Scrap candidates", filters: "{}", createdAt: 0 },
    ] }));
    expect(res[INV_KEY]).toBe(1);
    expect((stored(INV_KEY) as Array<{ id: string }>).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("local presets: the stored entry wins on id, an entry the loader rejects counts 0", () => {
    store.set(LOCAL_KEY, JSON.stringify([localPreset("a", "Mine")]));
    const res = applyBackup(v2({ [LOCAL_KEY]: [localPreset("a", "Theirs"), localPreset("b", "B"), localPreset("long", "x".repeat(13)), { ...localPreset("short", "S"), itemUids: ["w"] }] }));
    expect(res[LOCAL_KEY]).toBe(1);
    expect((stored(LOCAL_KEY) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name])).toEqual([["a", "Mine"], ["b", "B"]]);
  });

  it("preset heroes: a stored preset with heroes is kept, an empty one is replaced", () => {
    store.set("gs.presetHeroes", JSON.stringify({ 1: { referenceUid: "C", associatedUids: [] }, 3: { referenceUid: null, associatedUids: [] } }));
    const res = applyBackup(v2({ "gs.presetHeroes": { 1: { referenceUid: "A", associatedUids: [] }, 3: { referenceUid: "B", associatedUids: [] } } }));
    expect(res["gs.presetHeroes"]).toBe(1);
    expect(stored("gs.presetHeroes")).toEqual({ 1: { referenceUid: "C", associatedUids: [] }, 3: { referenceUid: "B", associatedUids: [] } });
  });

  it.each([
    ["gs.builds.notes", { h1: "mine", h2: "kept" }, { h1: "theirs", h3: "new", h4: 7 }, { h1: "theirs", h2: "kept", h3: "new" }],
    ["gs.solver.heroFilters", { h1: { topPct: 1 }, h2: { topPct: 2 } }, { h1: { topPct: 9 }, h3: { topPct: 3 }, h4: "x" }, { h1: { topPct: 9 }, h2: { topPct: 2 }, h3: { topPct: 3 } }],
    ["gs.builder.cols", { score: false, atk: true }, { score: true, cp: false, hp: "no" }, { score: true, atk: true, cp: false }],
  ])("map by id (%s): the imported entry replaces the stored one of the same key, the others stay", (key, before, incoming, after) => {
    store.set(key, JSON.stringify(before));
    const res = applyBackup(v2({ [key]: incoming }));
    expect(res[key]).toBe(2);
    expect(stored(key)).toEqual(after);
  });

  it("ranks: the imported rank replaces, then every rank is renumbered 1..N (an imported key first on a tie)", () => {
    store.set("gs.priority.rank", JSON.stringify({ a: 1, b: 2, c: 3 }));
    const res = applyBackup(v2({ "gs.priority.rank": { d: 1, b: 3, e: 0, f: 1.5 } }));
    expect(res["gs.priority.rank"]).toBe(2);
    expect(stored("gs.priority.rank")).toEqual({ d: 1, a: 2, b: 3, c: 4 });
  });

  it.each([
    ["gs.solver.excludedPieces", ["p1"], ["p1", "p2", 3, "p2"], ["p1", "p2"]],
    ["gs.presets.locked", [1, 4], [4, 2, "3", 2.5], [1, 4, 2]],
  ])("id lists (%s): union", (key, before, incoming, after) => {
    store.set(key, JSON.stringify(before));
    const res = applyBackup(v2({ [key]: incoming }));
    expect(res[key]).toBe(1);
    expect(stored(key)).toEqual(after);
  });

  it("worklist: the imported entry replaces the same hero's in place, the others stay, a new hero is appended", () => {
    store.set("gs.worklist", JSON.stringify([worklistEntry("h1", "old"), worklistEntry("h2")]));
    const res = applyBackup(v2({ "gs.worklist": [worklistEntry("h1", "new"), worklistEntry("h3"), { heroUid: "h4" }] }));
    expect(res["gs.worklist"]).toBe(2);
    expect((stored("gs.worklist") as Array<{ id: string }>).map((e) => e.id)).toEqual(["new", "w-h2", "w-h3"]);
  });

  it("settings: the imported value replaces, held within the setting's bounds; a value of the wrong type is ignored", () => {
    store.set("gs.solver.topN", "1000");
    store.set("gs.builder.heatmap", "true");
    const res = applyBackup(v2({
      "gs.solver.topN": 99999,
      "gs.solver.presetLossWarn": 2,
      "gs.builder.heatmap": "no",
      "gs.solver.workerCount": null,
      "gs.builder.resultRows": 40,
    }));
    expect(stored("gs.solver.topN")).toBe(5000);
    expect(stored("gs.solver.presetLossWarn")).toBe(5);
    expect(res["gs.builder.heatmap"]).toBe(0);
    expect(stored("gs.builder.heatmap")).toBe(true);
    expect(stored("gs.solver.workerCount")).toBeNull();
    expect(stored("gs.builder.resultRows")).toBe(15);
  });
});

describe("transfer — reading a file", () => {
  it("ignores a key it doesn't back up, without error", () => {
    const res = applyBackup(v2({ "gs.unknown": { a: 1 }, "gs.tab": "Optimizer", "gs.data.hash": "abc", [SAVED_KEY]: { h1: [{ id: "b1" }] } }));
    expect(res[SAVED_KEY]).toBe(1);
    expect(store.has("gs.unknown")).toBe(false);
    expect(store.has("gs.tab")).toBe(false);
    expect(store.has("gs.data.hash")).toBe(false);
  });

  it("rejects a non-backup object", () => {
    expect(() => applyBackup({ foo: 1 })).toThrow(/wrong kind/i);
  });
  it("rejects an unsupported version", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 99, savedBuilds: {}, filterPresets: {} })).toThrow(/version/i);
  });
  it("rejects a v1 bundle missing its maps, or with a malformed block", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 1 })).toThrow(/savedBuilds/i);
    expect(() => applyBackup(v1({ localPresets: {} }))).toThrow(/localPresets/);
  });
  it("rejects a v2 key in the wrong container, before writing anything", () => {
    expect(() => applyBackup(v2({ [SAVED_KEY]: { h1: [{ id: "b1" }] }, "gs.worklist": {} }))).toThrow(/gs\.worklist/);
    expect(writes).toEqual([]);
  });
});

describe("transfer — a mounted screen keeps the imported entries", () => {
  const build = (id: string) => ({ id, name: id, heroUid: "h1", mode: "score", createdAt: 0, build: {} }) as unknown as SavedBuild;

  it("reloads its in-memory map after an import, so its next save doesn't drop them", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [build("b1")] }));
    // What the Builder does: map loaded once into state, re-persisted on edit.
    let memory = loadSavedBuilds();
    const off = onBackupImported(() => { memory = loadSavedBuilds(); });

    applyBackup(v1({ savedBuilds: { h1: [{ id: "imported" }] } }));
    // The user then saves a new build in the (still mounted) Builder.
    memory = addSavedBuild(memory, build("b2"));
    persistSavedBuilds(memory);
    off();

    const saved = stored(SAVED_KEY) as Record<string, Array<{ id: string }>>;
    expect(saved.h1!.map((b) => b.id).sort()).toEqual(["b1", "b2", "imported"]);
  });

  it("still notifies when a write fails halfway (quota), then rethrows", () => {
    let calls = 0;
    const off = onBackupImported(() => { calls++; });
    const setItem = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === PRESETS_KEY) throw new Error("QuotaExceededError");
      setItem(k, v);
    };
    expect(() => applyBackup(v1({ savedBuilds: { h1: [{ id: "imported" }] }, filterPresets: { h1: [builderPreset("p1")] } }))).toThrow(/Quota/);
    off();
    // The builds were written: a mounted screen must reload them.
    expect((stored(SAVED_KEY) as Record<string, unknown[]>).h1).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const off = onBackupImported(() => { calls++; });
    applyBackup(v1());
    off();
    applyBackup(v1());
    expect(calls).toBe(1);
  });
});

describe("Settings › Backup", () => {
  it("lists what the export carries under the Export button, and never the captured gear", () => {
    const html = renderToStaticMarkup(createElement(BackupPane, { importInputRef: { current: null }, onStatus: () => {} }));
    expect(html).toContain("Export backup");
    expect(html).toContain("Import backup");
    expect(html).toContain(backupLabels().join(" · "));
    expect(html).toContain("Never the captured gear: that comes from the game.");
    expect(html).not.toContain("builds &amp; presets");
  });

  it("cites the import counts by label", () => {
    expect(importSummary({ [SAVED_KEY]: 12, [PRESETS_KEY]: 3, "gs.priority.rank": 5, "gs.worklist": 4 }))
      .toBe("Imported: 12 saved builds · 3 filter sets · hero ranks · worklist (4)");
    expect(importSummary({ [SAVED_KEY]: 1, "gs.solver.topN": 1, "gs.solver.topK": 1 }))
      .toBe("Imported: 1 saved build · solver settings");
    expect(importSummary({ [SAVED_KEY]: 0 })).toMatch(/^Nothing new to import/);
  });
});
