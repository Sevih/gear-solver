import { beforeEach, describe, expect, it } from "vitest";
import { SAVED_BUILDS_KEY, loadSavedBuilds } from "../src/lib/storage/savedBuilds.js";

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

function saved(build: Record<string, unknown>) {
  return { id: "b1", name: "old", heroUid: "h1", mode: "solve", createdAt: 0, build };
}

describe("saved builds — gemAllocation migration", () => {
  it("backfills an empty allocation on a build saved without it", () => {
    store.set(SAVED_BUILDS_KEY, JSON.stringify({ h1: [saved({ pieceUids: [], finalStats: {}, score: 1 })] }));
    expect(loadSavedBuilds().h1![0]!.build.gemAllocation).toEqual({ talisman: [], ee: [] });
  });

  it("keeps an existing allocation untouched", () => {
    const gemAllocation = { talisman: [15001, 0], ee: [15002] };
    store.set(SAVED_BUILDS_KEY, JSON.stringify({ h1: [saved({ pieceUids: [], finalStats: {}, score: 1, gemAllocation })] }));
    expect(loadSavedBuilds().h1![0]!.build.gemAllocation).toEqual(gemAllocation);
  });
});
