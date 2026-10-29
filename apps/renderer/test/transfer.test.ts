import { beforeEach, describe, expect, it } from "vitest";
import { applyBackup, buildBackup, onBackupImported } from "../src/lib/storage/transfer.js";
import { addSavedBuild, loadSavedBuilds, persistSavedBuilds, type SavedBuild } from "../src/lib/storage/savedBuilds.js";

// Minimal localStorage shim — the transfer module is the only storage code
// exercised here and it only needs get/set. Vitest runs in the `node`
// environment (no DOM), so we install a Map-backed stub on globalThis.
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

const SAVED_KEY = "gs.solver.savedBuilds";
const PRESETS_KEY = "gs.solver.filterPresets";

describe("transfer — backup round-trip", () => {
  it("buildBackup snapshots both blobs verbatim", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "b1" }] }));
    store.set(PRESETS_KEY, JSON.stringify({ h1: [{ id: "p1", filters: { excludedHeroes: ["x"] } }] }));
    const bundle = buildBackup(12345);
    expect(bundle.kind).toBe("gear-solver-backup");
    expect(bundle.version).toBe(1);
    expect(bundle.exportedAt).toBe(12345);
    expect(bundle.savedBuilds).toEqual({ h1: [{ id: "b1" }] });
    // Preset Set fields stay in serialized array form — no Set conversion.
    expect(bundle.filterPresets.h1?.[0]).toMatchObject({ id: "p1", filters: { excludedHeroes: ["x"] } });
  });

  it("buildBackup yields empty maps when nothing is stored", () => {
    const bundle = buildBackup(0);
    expect(bundle.savedBuilds).toEqual({});
    expect(bundle.filterPresets).toEqual({});
  });
});

describe("transfer — applyBackup merge", () => {
  it("adds only entries whose id is not already present", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "b1" }] }));
    const bundle = {
      kind: "gear-solver-backup",
      version: 1,
      exportedAt: 0,
      savedBuilds: { h1: [{ id: "b1" }, { id: "b2" }], h2: [{ id: "b3" }] },
      filterPresets: {},
    };
    const res = applyBackup(bundle);
    expect(res.builds).toBe(2); // b2 (new in h1) + b3 (new hero h2); b1 deduped
    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored.h1.map((b: { id: string }) => b.id)).toEqual(["b1", "b2"]);
    expect(stored.h2.map((b: { id: string }) => b.id)).toEqual(["b3"]);
  });

  it("keeps the existing entry on id collision (incoming skipped)", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "b1", name: "original" }] }));
    const bundle = buildBackup(0);
    bundle.savedBuilds = { h1: [{ id: "b1", name: "incoming" } as { id: string }] };
    const res = applyBackup(bundle);
    expect(res.builds).toBe(0);
    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored.h1[0].name).toBe("original");
  });
});

describe("transfer — validation", () => {
  it("rejects a non-backup object", () => {
    expect(() => applyBackup({ foo: 1 })).toThrow(/wrong kind/i);
  });
  it("rejects an unsupported version", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 99, savedBuilds: {}, filterPresets: {} }))
      .toThrow(/version/i);
  });
  it("rejects a bundle missing its maps", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 1 })).toThrow(/savedBuilds/i);
  });
});

describe("transfer — a mounted screen keeps the imported entries", () => {
  const bundle = (savedBuilds: Record<string, Array<{ id: string }>>) =>
    ({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds, filterPresets: {} });
  const build = (id: string) => ({ id, name: id, heroUid: "h1", mode: "score", createdAt: 0, build: {} }) as unknown as SavedBuild;

  it("reloads its in-memory map after an import, so its next save doesn't drop them", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [build("b1")] }));
    // What the Builder does: map loaded once into state, re-persisted on edit.
    let memory = loadSavedBuilds();
    const off = onBackupImported(() => { memory = loadSavedBuilds(); });

    applyBackup(bundle({ h1: [{ id: "imported" }] }));
    // The user then saves a new build in the (still mounted) Builder.
    memory = addSavedBuild(memory, build("b2"));
    persistSavedBuilds(memory);
    off();

    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored.h1.map((b: { id: string }) => b.id).sort()).toEqual(["b1", "b2", "imported"]);
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const off = onBackupImported(() => { calls++; });
    applyBackup(bundle({}));
    off();
    applyBackup(bundle({}));
    expect(calls).toBe(1);
  });
});

describe("transfer — Inventory filter presets", () => {
  const INV_KEY = "gs.inv.filterPresets";
  const entry = (id: string, name: string) => ({ id, name, filters: "{}", createdAt: 0 });

  it("exports the list, imports the new entries, the local one wins on id or name", () => {
    store.set(INV_KEY, JSON.stringify([entry("a", "A")]));
    expect(buildBackup(0).inventoryFilterPresets).toEqual([entry("a", "A")]);
    const res = applyBackup({
      kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {},
      inventoryFilterPresets: [entry("a", "other"), entry("z", "A"), entry("b", "B")],
    });
    expect(res.inventoryPresets).toBe(1);
    expect(JSON.parse(store.get(INV_KEY)!).map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
  });

  it("a backup without the field imports none", () => {
    const res = applyBackup({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {} });
    expect(res.inventoryPresets).toBe(0);
    expect(store.has(INV_KEY)).toBe(false);
  });
});

describe("transfer — entries the loaders reject", () => {
  const bundle = (over: object) => ({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {}, ...over });

  it("a Builder preset without filters counts 0 and writes nothing", () => {
    const res = applyBackup(bundle({ filterPresets: { h1: [{ id: "p1", name: "broken" }] } }));
    expect(res.presets).toBe(0);
    expect(JSON.parse(store.get(PRESETS_KEY)!)).toEqual({});
  });

  it("a readable Builder preset next to a broken one counts 1", () => {
    const good = { id: "p2", name: "ok", heroUid: "h1", createdAt: 0, filters: { excludedHeroes: [] } };
    const res = applyBackup(bundle({ filterPresets: { h1: [{ id: "p1", name: "broken" }, good] } }));
    expect(res.presets).toBe(1);
    expect(JSON.parse(store.get(PRESETS_KEY)!).h1.map((p: { id: string }) => p.id)).toEqual(["p2"]);
  });

  it("an Inventory preset with an invalid name or unreadable filters counts 0", () => {
    const INV_KEY = "gs.inv.filterPresets";
    const res = applyBackup(bundle({ inventoryFilterPresets: [
      { id: "a", name: "", filters: "{}", createdAt: 0 },
      { id: "b", name: "x".repeat(25), filters: "{}", createdAt: 0 },
      { id: "c", name: "no filters", createdAt: 0 },
      { id: "d", name: "bad json", filters: "{", createdAt: 0 },
      { id: "e", name: "array", filters: "[]", createdAt: 0 },
      { id: "f", name: "Scrap candidates", filters: "{}", createdAt: 0 },
    ] }));
    expect(res.inventoryPresets).toBe(0);
    expect(store.has(INV_KEY)).toBe(false);
  });
});

describe("transfer — local presets", () => {
  const LOCAL_KEY = "gs.presets.local";
  const WIRE = ["w", "a", "h", "b", "g", "s", "0", "t"];
  const entry = (id: string, name: string) => ({ id, name, itemUids: WIRE, heroUid: null, createdAt: 0 });
  const bundle = (over: object) => ({ kind: "gear-solver-backup", version: 1, exportedAt: 0, savedBuilds: {}, filterPresets: {}, ...over });

  it("exports the list, imports the new ids, the local entry wins on id", () => {
    store.set(LOCAL_KEY, JSON.stringify([entry("a", "Mine")]));
    expect(buildBackup(0).localPresets).toEqual([entry("a", "Mine")]);
    const res = applyBackup(bundle({ localPresets: [entry("a", "Theirs"), entry("b", "B")] }));
    expect(res.localPresets).toBe(1);
    const stored = JSON.parse(store.get(LOCAL_KEY)!);
    expect(stored.map((e: { id: string; name: string }) => [e.id, e.name])).toEqual([["a", "Mine"], ["b", "B"]]);
  });

  it("counts only the entries the loader reads; a backup without the field imports none", () => {
    const res = applyBackup(bundle({ localPresets: [
      entry("long", "x".repeat(13)),
      { ...entry("short", "Short"), itemUids: ["w"] },
      { name: "No id", itemUids: WIRE, heroUid: null, createdAt: 0 },
      entry("ok", "Ok"),
    ] }));
    expect(res.localPresets).toBe(1);
    expect(JSON.parse(store.get(LOCAL_KEY)!).map((e: { id: string }) => e.id)).toEqual(["ok"]);
    store.clear();
    expect(applyBackup(bundle({})).localPresets).toBe(0);
    expect(store.has(LOCAL_KEY)).toBe(false);
  });

  it("rejects a malformed list", () => {
    expect(() => applyBackup(bundle({ localPresets: {} }))).toThrow(/localPresets/);
  });
});
