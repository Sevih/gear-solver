/**
 * Plain-node twin of apps/desktop/src/outerpedia-checkout.ts, for the scripts
 * that can't import TypeScript (`data/sync.mjs`, `fetch-binaries.mjs`). Same
 * candidates, same order — keep both in sync
 * (apps/renderer/test/outerpediaCheckout.test.ts checks they agree):
 *
 *  1. `OUTERPEDIA_PATH` from the process environment;
 *  2. `OUTERPEDIA_PATH` from `<repoRoot>/.env.local` (gitignored, per machine);
 *  3. an `outerpedia` checkout next to this repo (`<repoRoot>/../outerpedia`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** gear-solver repo root (this file lives in `<root>/scripts/`). */
export const REPO_ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));

/** Read one key from a dotenv-style file. Null when the file or key is absent.
 *  @param {string} file @param {string} key @returns {string | null} */
export function readEnvFileKey(file, key) {
  let text;
  try { text = readFileSync(file, "utf-8"); } catch { return null; }
  let found = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    found = value; // last assignment wins, like dotenv
  }
  return found || null;
}

/** Candidate checkout roots, in priority order.
 *  @param {string | null} repoRoot @param {NodeJS.ProcessEnv} [env] @returns {string[]} */
export function outerpediaCandidates(repoRoot, env = process.env) {
  const out = [env.OUTERPEDIA_PATH];
  if (repoRoot) {
    out.push(readEnvFileKey(join(repoRoot, ".env.local"), "OUTERPEDIA_PATH"));
    out.push(join(repoRoot, "..", "outerpedia"));
  }
  return out.filter(Boolean).map((p) => normalize(p));
}

/** First candidate checkout root holding `marker` (relative path), or null.
 *  @param {string | null} repoRoot @param {string} marker @param {NodeJS.ProcessEnv} [env]
 *  @returns {string | null} */
export function findOuterpediaCheckout(repoRoot, marker, env = process.env) {
  for (const root of outerpediaCandidates(repoRoot, env)) {
    if (existsSync(join(root, marker))) return root;
  }
  return null;
}
