import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Fake GitHub API (latest = NEW_SHA) + CDN serving data `remoteHash`. */
function stubRemote(remoteHash: string) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith("https://api.github.com/")) return new Response(NEW_SHA);
    if (url.endsWith("/version.json")) return Response.json({ hash: remoteHash, builtAt: "2026-02-02" });
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
