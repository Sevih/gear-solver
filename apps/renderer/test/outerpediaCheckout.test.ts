/// <reference types="node" />
// Outerpedia checkout lookup (dev): OUTERPEDIA_PATH env → .env.local → sibling
// ../outerpedia. Runs the TypeScript resolver (desktop + Vite) and its plain-node
// twin (data/sync.mjs, fetch-binaries.mjs) on the same fixtures so they can't drift.
// Lives here because the desktop package has no test runner; the node types
// reference above is what lets this file (and the desktop module) typecheck.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tsImpl from "../../desktop/src/outerpedia-checkout";

type Impl = Pick<typeof tsImpl, "findOuterpediaCheckout" | "outerpediaCandidates" | "readEnvFileKey">;
const mjsPath = fileURLToPath(new URL("../../../scripts/outerpedia-checkout.mjs", import.meta.url));
const mjsImpl = (await import(/* @vite-ignore */ mjsPath)) as Impl;

const MARKER = join("data", "generated", "solver", "version.json");

let ws: string; // workspace: <ws>/gear-solver (repo root) next to other checkouts
let repo: string;

/** Create a fake outerpedia checkout carrying MARKER. */
function checkout(dir: string): string {
  mkdirSync(join(dir, "data", "generated", "solver"), { recursive: true });
  writeFileSync(join(dir, MARKER), "{}");
  return dir;
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "gs-outerpedia-"));
  repo = join(ws, "gear-solver");
  mkdirSync(repo);
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe.each([["ts", tsImpl as Impl], ["mjs", mjsImpl]])("outerpedia checkout lookup (%s)", (_name, impl) => {
  it("finds a sibling ../outerpedia checkout with no configuration", () => {
    const sibling = checkout(join(ws, "outerpedia"));
    expect(impl.findOuterpediaCheckout(repo, MARKER, {})).toBe(sibling);
  });

  it("returns null when no candidate carries the marker", () => {
    mkdirSync(join(ws, "outerpedia")); // sibling exists but has no solver artifacts
    expect(impl.findOuterpediaCheckout(repo, MARKER, {})).toBeNull();
  });

  it("prefers .env.local over the sibling", () => {
    checkout(join(ws, "outerpedia"));
    const custom = checkout(join(ws, "elsewhere", "outerpedia"));
    writeFileSync(join(repo, ".env.local"), `# local\nOTHER=1\nOUTERPEDIA_PATH="${custom}"\n`);
    expect(impl.findOuterpediaCheckout(repo, MARKER, {})).toBe(custom);
  });

  it("prefers the process environment over .env.local", () => {
    const fromFile = checkout(join(ws, "from-file"));
    const fromEnv = checkout(join(ws, "from-env"));
    writeFileSync(join(repo, ".env.local"), `OUTERPEDIA_PATH=${fromFile}\n`);
    expect(impl.findOuterpediaCheckout(repo, MARKER, { OUTERPEDIA_PATH: fromEnv })).toBe(fromEnv);
  });

  it("falls through a configured path that lacks the marker", () => {
    const sibling = checkout(join(ws, "outerpedia"));
    expect(impl.findOuterpediaCheckout(repo, MARKER, { OUTERPEDIA_PATH: join(ws, "missing") })).toBe(sibling);
  });

  it("without a repo root (packaged build) only the environment counts", () => {
    checkout(join(ws, "outerpedia"));
    const fromEnv = checkout(join(ws, "from-env"));
    expect(impl.outerpediaCandidates(null, {})).toEqual([]);
    expect(impl.findOuterpediaCheckout(null, MARKER, {})).toBeNull();
    expect(impl.findOuterpediaCheckout(null, MARKER, { OUTERPEDIA_PATH: fromEnv })).toBe(fromEnv);
  });

  it("parses dotenv lines: export, quotes, comments, CRLF, last wins, empty = unset", () => {
    const f = join(ws, "env");
    writeFileSync(f, "# OUTERPEDIA_PATH=/commented\r\nexport OUTERPEDIA_PATH='/a b'\r\nOUTERPEDIA_PATH = /c\r\n");
    expect(impl.readEnvFileKey(f, "OUTERPEDIA_PATH")).toBe("/c");
    writeFileSync(f, "OUTERPEDIA_PATH='/a b'\n");
    expect(impl.readEnvFileKey(f, "OUTERPEDIA_PATH")).toBe("/a b");
    writeFileSync(f, "OUTERPEDIA_PATH=\n");
    expect(impl.readEnvFileKey(f, "OUTERPEDIA_PATH")).toBeNull();
    expect(impl.readEnvFileKey(join(ws, "absent"), "OUTERPEDIA_PATH")).toBeNull();
  });
});
