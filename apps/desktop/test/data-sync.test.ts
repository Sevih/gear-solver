import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("same data hash with a new resVersion rewrites version.json only", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const urls = stubRemote("h1", { resVersion: "1.11.409" });
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("fresh");
    expect(urls.filter((u) => !u.startsWith("https://api.github.com/"))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8")))
      .toEqual({ resVersion: "1.11.409", hash: "h1", builtAt: "2026-02-02" });
    for (const f of SOLVER_FILES) if (f !== "version.json") expect(readFileSync(join(derivedDir, f), "utf-8")).toBe("{}");
    expect(JSON.parse(readFileSync(shaStateFile, "utf-8")).sha).toBe(NEW_SHA);
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

  it("same data hash with a new resVersion rewrites version.json only", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    vi.stubEnv("OUTERPEDIA_NO_CHECKOUT", "");
    vi.stubEnv("OUTERPEDIA_PATH", fakeCheckout({ schema: 1, resVersion: "1.11.409", hash: "h1", builtAt: "2026-02-02" }));
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r.status).toBe("fresh");
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8")))
      .toEqual({ schema: 1, resVersion: "1.11.409", hash: "h1", builtAt: "2026-02-02" });
    for (const f of SOLVER_FILES) if (f !== "version.json") expect(readFileSync(join(derivedDir, f), "utf-8")).toBe("{}");
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

const TABLES = SOLVER_FILES.filter((f) => f !== "version.json");

/** The cache `cache("h1")` built, every table included, untouched. */
function expectAllTablesIntact(derivedDir: string, shaStateFile: string) {
  expectCacheIntact(derivedDir, shaStateFile);
  for (const f of TABLES) expect(readFileSync(join(derivedDir, f), "utf-8")).toBe("{}");
}

describe("syncGameData — CHECKOUT mode reads every artifact before writing", () => {
  function checkoutMode(version: Record<string, unknown> = { schema: 2, hash: "h2", builtAt: "2026-02-02" }) {
    const root = fakeCheckout(version);
    vi.stubEnv("OUTERPEDIA_NO_CHECKOUT", "");
    vi.stubEnv("OUTERPEDIA_PATH", root);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in CHECKOUT mode"); }));
    return join(root, "data", "generated", "solver");
  }

  it("a complete checkout copies every table, version.json included", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    checkoutMode();
    const r = await syncGameData({ derivedDir, shaStateFile, force: false });
    expect(r).toEqual({ status: "synced", message: "synced 20 tables (checkout h2)", copied: 20 });
    for (const f of TABLES) expect(JSON.parse(readFileSync(join(derivedDir, f), "utf-8"))).toEqual({ from: "checkout" });
    expect(JSON.parse(readFileSync(join(derivedDir, "version.json"), "utf-8"))).toEqual({ schema: 2, hash: "h2", builtAt: "2026-02-02" });
  });

  // version.json is not in the list: without it the checkout isn't found at all (REPO mode).
  it.each(TABLES)("a missing %s writes nothing and keeps the cache", async (f) => {
    const { derivedDir, shaStateFile } = cache("h1");
    rmSync(join(checkoutMode(), f));
    const r = await syncGameData({ derivedDir, shaStateFile, force: true });
    expect(r).toEqual({ status: "error", message: `${f} is missing from the outerpedia checkout; keeping the cached data` });
    expectAllTablesIntact(derivedDir, shaStateFile);
  });

  it("an artifact that is not JSON writes nothing and keeps the cache", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    writeFileSync(join(checkoutMode(), "trust-character.json"), "{ truncated");
    const r = await syncGameData({ derivedDir, shaStateFile, force: true });
    expect(r).toEqual({ status: "error", message: "trust-character.json is not valid JSON in the outerpedia checkout; keeping the cached data" });
    expectAllTablesIntact(derivedDir, shaStateFile);
  });

  it("an artifact that can't be read writes nothing and keeps the cache", async () => {
    const { derivedDir, shaStateFile } = cache("h1");
    const solver = checkoutMode();
    rmSync(join(solver, "sets.json"));
    mkdirSync(join(solver, "sets.json"));
    const r = await syncGameData({ derivedDir, shaStateFile, force: true });
    expect(r).toEqual({ status: "error", message: "sets.json is unreadable in the outerpedia checkout; keeping the cached data" });
    expectAllTablesIntact(derivedDir, shaStateFile);
  });

  it("a missing artifact with no cache is unavailable, nothing written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-sync-"));
    const derivedDir = join(dir, "derived");
    rmSync(join(checkoutMode(), "characters.json"));
    const r = await syncGameData({ derivedDir, shaStateFile: join(dir, "repo-sha.json"), force: false });
    expect(r).toEqual({ status: "unavailable", message: "characters.json is missing from the outerpedia checkout; no cached game data" });
    expect(readdirSync(derivedDir)).toEqual([]);
  });
});

describe("one list of solver artifacts", () => {
  it("data-sync.ts exports solver-files.json, 20 distinct names", () => {
    const shared = JSON.parse(readFileSync(fileURLToPath(new URL("../src/solver-files.json", import.meta.url)), "utf-8"));
    expect(SOLVER_FILES).toEqual(shared);
    expect(new Set(SOLVER_FILES).size).toBe(20);
    expect(SOLVER_FILES).toContain("version.json");
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

describe("data/sync.mjs — reads the shared list, every artifact before writing", () => {
  const script = fileURLToPath(new URL("../../../data/sync.mjs", import.meta.url));
  const derived = fileURLToPath(new URL("../../../data/derived", import.meta.url));
  const snapshot = () => Object.fromEntries(SOLVER_FILES.map((f) => [f, readFileSync(join(derived, f), "utf-8")]));

  /** A fake checkout holding the committed tree's own bytes: even a broken
   *  script that wrote before failing would leave data/derived unchanged. */
  function checkoutOfCommittedTree(): { root: string; solver: string } {
    const root = mkdtempSync(join(tmpdir(), "gs-outerpedia-"));
    const solver = join(root, "data", "generated", "solver");
    mkdirSync(solver, { recursive: true });
    for (const f of SOLVER_FILES) cpSync(join(derived, f), join(solver, f));
    // The copied game-client.json would make a full run touch the repo: never reached here.
    return { root, solver };
  }

  const run = (root: string) =>
    spawnSync(process.execPath, [script], { env: { ...process.env, OUTERPEDIA_PATH: root }, encoding: "utf-8" });

  it.each(TABLES)("a checkout without %s (an entry of solver-files.json) exits non-zero, data/derived untouched", (f) => {
    const before = snapshot();
    const { root, solver } = checkoutOfCommittedTree();
    rmSync(join(solver, f));
    const r = run(root);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`missing artifact: ${join(solver, f)}; data/derived left untouched`);
    expect(snapshot()).toEqual(before);
  });

  it("an artifact that is not JSON exits non-zero, data/derived untouched", () => {
    const before = snapshot();
    const { root, solver } = checkoutOfCommittedTree();
    writeFileSync(join(solver, "trust-character.json"), "{ truncated");
    const r = run(root);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`unreadable or not JSON: ${join(solver, "trust-character.json")}; data/derived left untouched`);
    expect(snapshot()).toEqual(before);
  });
});
