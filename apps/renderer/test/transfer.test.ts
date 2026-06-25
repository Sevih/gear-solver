import { beforeEach, describe, expect, it } from "vitest";
import { applyBackup, buildBackup } from "../src/lib/storage/transfer.js";

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
    const res = applyBackup(bundle, "merge");
    expect(res.builds).toBe(2); // b2 (new in h1) + b3 (new hero h2); b1 deduped
    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored.h1.map((b: { id: string }) => b.id)).toEqual(["b1", "b2"]);
    expect(stored.h2.map((b: { id: string }) => b.id)).toEqual(["b3"]);
  });

  it("keeps the existing entry on id collision (incoming skipped)", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "b1", name: "original" }] }));
    const bundle = buildBackup(0);
    bundle.savedBuilds = { h1: [{ id: "b1", name: "incoming" } as { id: string }] };
    const res = applyBackup(bundle, "merge");
    expect(res.builds).toBe(0);
    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored.h1[0].name).toBe("original");
  });
});

describe("transfer — applyBackup replace", () => {
  it("overwrites both blobs wholesale", () => {
    store.set(SAVED_KEY, JSON.stringify({ h1: [{ id: "old" }] }));
    const bundle = {
      kind: "gear-solver-backup",
      version: 1,
      exportedAt: 0,
      savedBuilds: { h2: [{ id: "new" }] },
      filterPresets: {},
    };
    const res = applyBackup(bundle, "replace");
    expect(res.builds).toBe(1);
    const stored = JSON.parse(store.get(SAVED_KEY)!);
    expect(stored).toEqual({ h2: [{ id: "new" }] });
  });
});

describe("transfer — validation", () => {
  it("rejects a non-backup object", () => {
    expect(() => applyBackup({ foo: 1 }, "merge")).toThrow(/wrong kind/i);
  });
  it("rejects an unsupported version", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 99, savedBuilds: {}, filterPresets: {} }, "merge"))
      .toThrow(/version/i);
  });
  it("rejects a bundle missing its maps", () => {
    expect(() => applyBackup({ kind: "gear-solver-backup", version: 1 }, "merge")).toThrow(/savedBuilds/i);
  });
});
