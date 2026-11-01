/**
 * The `gs.*` key registry (`lib/storage/keys.ts`, U9): one entry per key, the
 * registry and the code agree both ways (every `"gs.` literal of the sources is
 * declared, every declared key is used), the settings come from `SETTINGS`,
 * the backup carries every localStorage key but the app's own state, and every
 * pruned key has its pruner (`dataHash.ts`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKUP_KEYS, PRUNED_KEYS, STORAGE_KEYS, backupLabels } from "../src/lib/storage/keys.js";
import { PRUNERS } from "../src/lib/storage/dataHash.js";
import { SETTINGS } from "../src/lib/settings.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const REGISTRY = join(SRC, "lib/storage/keys.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Every `"gs.…"` string literal of the sources outside the registry. */
function codeLiterals(): Set<string> {
  const found = new Set<string>();
  for (const path of sources(SRC)) {
    if (path === REGISTRY) continue;
    for (const m of readFileSync(path, "utf8").matchAll(/"(gs\.[A-Za-z0-9_.]+)"/g)) found.add(m[1]!);
  }
  return found;
}

const keys = STORAGE_KEYS.map((s) => s.key);

describe("storage key registry", () => {
  it("declares each key once", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares every gs.* literal of the code, and every declared key is in the code", () => {
    const literals = codeLiterals();
    expect([...literals].filter((k) => !keys.includes(k))).toEqual([]);
    expect(keys.filter((k) => !literals.has(k))).toEqual([]);
  });

  it("names an owner module that exists", () => {
    for (const s of STORAGE_KEYS) expect(existsSync(join(SRC, s.owner)), s.owner).toBe(true);
  });

  it("composes the settings of lib/settings.ts", () => {
    for (const spec of Object.values(SETTINGS)) {
      expect(STORAGE_KEYS.find((s) => s.key === spec.key)).toMatchObject({ store: "local", owner: "lib/settings.ts" });
    }
  });

  it("backs up every localStorage key but the app's own state (D7), never a session key", () => {
    const notBackedUp = STORAGE_KEYS.filter((s) => s.store === "local" && !s.backup).map((s) => s.key).sort();
    expect(notBackedUp).toEqual(["gs.data.hash", "gs.onboarding.done", "gs.presets.seen", "gs.priority.seen", "gs.settings.pane", "gs.tab"]);
    expect(STORAGE_KEYS.filter((s) => s.store === "session" && s.backup)).toEqual([]);
    expect(BACKUP_KEYS.every((s) => s.store === "local")).toBe(true);
  });

  it("prunes the Builder's filter sets and per-hero filters, each with its pruner", () => {
    expect([...PRUNED_KEYS].sort()).toEqual(["gs.solver.filterPresets", "gs.solver.heroFilters"]);
    expect(Object.keys(PRUNERS).sort()).toEqual([...PRUNED_KEYS].sort());
  });

  it("lists what the backup carries, each label once", () => {
    const labels = backupLabels();
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(expect.arrayContaining(["Saved builds", "Filter sets", "Hero ranks", "Worklist", "Solver settings"]));
    expect(labels).not.toContain("Last Settings pane");
  });
});
