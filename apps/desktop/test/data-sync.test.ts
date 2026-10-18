import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tsImpl from "../src/data-sync.js";
import { SOLVER_FILES, syncGameData } from "../src/data-sync.js";

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

/** A derived cache already holding data `hash`, last synced at OLD_SHA. */
function cache(hash: string) {
  const dir = mkdtempSync(join(tmpdir(), "gs-sync-"));
  const derivedDir = join(dir, "derived");
  mkdirSync(derivedDir);
  for (const f of SOLVER_FILES) writeFileSync(join(derivedDir, f), "{}");
  writeFileSync(join(derivedDir, "version.json"), JSON.stringify({ hash, builtAt: "2026-01-01" }));
  const shaStateFile = join(dir, "repo-sha.json");
  writeFileSync(shaStateFile, JSON.stringify({ sha: OLD_SHA, resolvedAt: 0 }));
  return { derivedDir, shaStateFile };
}

/** Fake GitHub API (latest = NEW_SHA) + CDN serving data `remoteHash`, its
 *  version.json carrying `extra` fields too (e.g. a contract `schema`). */
function stubRemote(remoteHash: string, extra: Record<string, unknown> = {}) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith("https://api.github.com/")) return new Response(NEW_SHA);
    if (url.endsWith("/version.json")) return Response.json({ ...extra, hash: remoteHash, builtAt: "2026-02-02" });
    return Response.json({ from: "remote" });
  }));
  return urls;
}

beforeEach(() => { vi.stubEnv("OUTERPEDIA_NO_CHECKOUT", "1"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("syncGameData — REPO mode", () => {
  it("a site-only commit (same data hash) downloads version.json only", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h1");
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("fresh");
    expect(urls.filter((u) => !u.startsWith("https://api.github.com/"))).toHaveLength(1);
    // The new SHA is recorded, so the next launch doesn't ask again.
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(NEW_SHA);
    expect(readFileSync(join(derivedDir, "characters.json"), "utf-8")).toBe("{}");
  });

  it("a data change downloads every table once", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h2");
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("synced");
    const cdn = urls.filter((u) => !u.startsWith("https://api.github.com/"));
    expect(cdn).toHaveLength(SOLVER_FILES.length);
    expect(new Set(cdn).size).toBe(SOLVER_FILES.length);
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8")).hash).toBe("h2");
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(NEW_SHA);
  });

  it("the manual Sync (force) still downloads everything", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h1");
    const r = await syncGameData({ derivedDir, shaStateFile, force: true });
    expect(r.status).toBe("synced");
    expect(urls.filter((u) => !u.startsWith("https://api.github.com/"))).toHaveLength(SOLVER_FILES.length);
  });
});

describe("syncGameData — version.json is the commit marker", () => {
  it("a write failure mid-sync leaves the old data hash in place", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    stubRemote("h2");
    // A non-empty directory where a table goes makes its atomic rename fail.
    rmSync(join(derivedDir, "trust-character.json"));
    mkdirSync(join(derivedDir, "trust-character.json", "x"), { recursive: true });
    await expect(syncGameData({ derivedDir, shaStateFile, force: false })).rejects.toThrow();
    // version.json must still say h1 so the next launch retries the download
    // instead of trusting a half-written tree as "fresh".
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8")).hash).toBe("h1");
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(OLD_SHA);
  });
});

/** CDN requests other than version.json (the GitHub API call excluded). */
const tableUrls = (urls: string[]) =>
  urls.filter((u) => !u.startsWith("https://api.github.com/") && !u.endsWith("/version.json"));

/** The cache `cache("h1")` built, untouched. */
function expectCacheIntact(derivedDir: string, shaStateFile: string) {
  expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8"))).toEqual({ hash: "h1", builtAt: "2026-01-01" });
  expect(readFileSync(join(derivedDir, "characters.json"), "utf-8")).toBe("{}");
  expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(OLD_SHA);
}

describe("syncGameData — contract schema (REPO mode)", () => {
  it("schema 1 behaves like no schema", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h2", { schema: 1, resVersion: "1.11.407" });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("synced");
    expect(tableUrls(urls)).toHaveLength(SOLVER_FILES.length - 1);
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(NEW_SHA);
  });

  it("schema 2 (corePassive dropped) is read", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h2", { schema: 2 });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("synced");
    expect(tableUrls(urls)).toHaveLength(SOLVER_FILES.length - 1);
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8"))).toMatchObject({ schema: 2, hash: "h2" });
  });

  it.each([false, true])("a newer schema is refused before any table, cache and SHA kept (force: %s)", async (force) => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h2", { schema: 3 });
    const r = await syncGameData({ derivedDir, shaStateFile, force });
    expect(r.status).toBe("error");
    expect(r.message).toBe(
      "outerpedia's game data uses format 3, this version of gear-solver reads up to format 2 — update gear-solver; keeping the cached data",
    );
    expect(tableUrls(urls)).toEqual([]);
    expectCacheIntact(derivedDir, shaStateFile);
  });

  it("a newer schema with no cache is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-sync-"));
    const derivedDir = join(dir, "derived");
    const shaStateFile = join(dir, "repo-sha.json");
    const urls = stubRemote("h2", { schema: 3 });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("unavailable");
    expect(r.message).toMatch(/format 3.*; no cached game data$/);
    expect(tableUrls(urls)).toEqual([]);
    expect(existsSync(join(derivedDir, "characters.json"))).toBe(false);
    expect(existsSync(shaStateFile)).toBe(false);
  });

  it.each([["1"], [1.5], [0], [-1], [null]])("an unreadable schema (%j) is refused", async (schema) => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h2", { schema });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("error");
    expect(r.message).toBe("outerpedia's game data has an unreadable format; keeping the cached data");
    expect(tableUrls(urls)).toEqual([]);
    expectCacheIntact(derivedDir, shaStateFile);
  });

  it("after a refusal, an app that reads the newer schema syncs on its next launch", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    stubRemote("h2", { schema: 3 });
    expect((await syncGameData({ derivedDir, shaStateFile, force: false })).status).toBe("error");
    // Same outerpedia commit, updated app: the unrecorded SHA lets it through the gate.
    const urls = stubRemote("h2", { schema: 3 });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false, supportedSchema: 3 });
    expect(r.status).toBe("synced");
    expect(tableUrls(urls)).toHaveLength(SOLVER_FILES.length - 1);
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8"))).toMatchObject({ schema: 3, hash: "h2" });
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(NEW_SHA);
  });
});

/** A fake outerpedia checkout whose solver artifacts carry `version`. */
function fakeCheckout(version: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "gs-outerpedia-"));
  const solver = join(root, "data", "generated", "solver");
  mkdirSync(solver, { recursive: true });
  for (const f of SOLVER_FILES) writeFileSync(join(solver, f), JSON.stringify({ from: "checkout" }));
  writeFileSync(join(solver, "version.json"), JSON.stringify(version));
  return root;
}

describe("syncGameData — contract schema (CHECKOUT mode)", () => {
  it("a newer schema copies nothing", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    vi.stubEnv("OUTERPEDIA_NO_CHECKOUT", "");
    vi.stubEnv("OUTERPEDIA_PATH", fakeCheckout({ schema: 3, hash: "h2", builtAt: "2026-02-02" }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in CHECKOUT mode"); }));
    const r = await syncGameData({ derivedDir, shaStateFile, force: true });
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/^outerpedia's game data uses format 3, .*; keeping the cached data$/);
    expectCacheIntact(derivedDir, shaStateFile);
  });

  it.each([1, 2])("schema %i still copies", async (schema) => {
    const { derivedDir, shaStateFile } = cache("h1");
    vi.stubEnv("OUTERPEDIA_NO_CHECKOUT", "");
    vi.stubEnv("OUTERPEDIA_PATH", fakeCheckout({ schema, hash: "h2", builtAt: "2026-02-02" }));
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("synced");
    expect(JSON.parse(readFileSync(join(derivedDir, "characters.json"), "utf-8"))).toEqual({ from: "checkout" });
  });
});

// data/sync.mjs can't import TypeScript and uses the plain-node twin.
type SchemaImpl = Pick<typeof tsImpl, "SUPPORTED_SOLVER_SCHEMA" | "solverSchemaOf" | "schemaRefusal">;
const mjsPath = fileURLToPath(new URL("../../../scripts/solver-schema.mjs", import.meta.url));
const mjsImpl = (await import(/* @vite-ignore */ mjsPath)) as SchemaImpl;

describe("contract schema — TypeScript and data/sync.mjs twins agree", () => {
  const bodies = [
    "{}", '{"hash":"h"}', '{"schema":1}', '{"schema":2}', '{"schema":3}', '{"schema":7,"hash":"h"}',
    '{"schema":"1"}', '{"schema":1.5}', '{"schema":0}', '{"schema":-3}', '{"schema":null}',
    "[]", "null", "not json", "",
  ];
  it("same supported schema", () => {
    expect(mjsImpl.SUPPORTED_SOLVER_SCHEMA).toBe(tsImpl.SUPPORTED_SOLVER_SCHEMA);
  });
  it.each(bodies)("same reading of %j", (body) => {
    expect(mjsImpl.solverSchemaOf(body)).toBe(tsImpl.solverSchemaOf(body));
    for (const supported of [1, 2, 3]) {
      expect(mjsImpl.schemaRefusal(body, supported)).toBe(tsImpl.schemaRefusal(body, supported));
    }
  });
  it("both read format 2 and refuse format 3", () => {
    for (const impl of [tsImpl, mjsImpl]) {
      expect(impl.SUPPORTED_SOLVER_SCHEMA).toBe(2);
      expect(impl.schemaRefusal('{"schema":2}')).toBeNull();
      expect(impl.schemaRefusal('{"schema":3}')).toBe(
        "outerpedia's game data uses format 3, this version of gear-solver reads up to format 2 — update gear-solver",
      );
    }
  });
  it("reads the documented values", () => {
    expect(tsImpl.solverSchemaOf('{"hash":"h"}')).toBe(1);
    expect(tsImpl.solverSchemaOf('{"schema":3}')).toBe(3);
    for (const b of ['{"schema":"1"}', '{"schema":1.5}', '{"schema":0}', "not json"]) expect(tsImpl.solverSchemaOf(b)).toBeNull();
  });
});

describe("data/sync.mjs — contract schema", () => {
  it("refuses a newer schema and exits non-zero without touching data/derived", () => {
    const derived = fileURLToPath(new URL("../../../data/derived/version.json", import.meta.url));
    const before = readFileSync(derived, "utf-8");
    // Only version.json in the fake checkout: even a broken check would stop
    // at the first missing table, before writing into the repo's data/derived.
    const root = mkdtempSync(join(tmpdir(), "gs-outerpedia-"));
    const solver = join(root, "data", "generated", "solver");
    mkdirSync(solver, { recursive: true });
    writeFileSync(join(solver, "version.json"), JSON.stringify({ schema: 3, hash: "h2", builtAt: "2026-02-02" }));
    const script = fileURLToPath(new URL("../../../data/sync.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, OUTERPEDIA_PATH: root }, encoding: "utf-8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("uses format 3, this version of gear-solver reads up to format 2");
    expect(readFileSync(derived, "utf-8")).toBe(before);
  });
});
