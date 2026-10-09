/**
 * Locate the maintainer's local outerpedia checkout (dev only), the same way on
 * Windows and Linux. Candidates, first match wins:
 *
 *  1. `OUTERPEDIA_PATH` from the process environment;
 *  2. `OUTERPEDIA_PATH` from `<repoRoot>/.env.local` (gitignored, per machine);
 *  3. an `outerpedia` checkout next to this repo (`<repoRoot>/../outerpedia`).
 *
 * Without a `repoRoot` (packaged build) only the process environment counts:
 * a user's install never guesses a checkout location.
 *
 * Electron-free so the Vite config can import it. The plain-node scripts
 * (`data/sync.mjs`, `apps/desktop/scripts/fetch-binaries.mjs`) can't import
 * TypeScript and use the twin `scripts/outerpedia-checkout.mjs` — keep both in
 * sync (apps/renderer/test/outerpediaCheckout.test.ts checks they agree).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

/** Read one key from a dotenv-style file (`KEY=value`, `#` comments, optional
 *  quotes, optional `export `). Null when the file or the key is absent. */
export function readEnvFileKey(file: string, key: string): string | null {
  let text: string;
  try { text = readFileSync(file, "utf-8"); } catch { return null; }
  let found: string | null = null;
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

/** Candidate checkout roots, in priority order (see module doc). */
export function outerpediaCandidates(repoRoot: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  const out: (string | null | undefined)[] = [env.OUTERPEDIA_PATH];
  if (repoRoot) {
    out.push(readEnvFileKey(join(repoRoot, ".env.local"), "OUTERPEDIA_PATH"));
    out.push(join(repoRoot, "..", "outerpedia"));
  }
  return out.filter((p): p is string => Boolean(p)).map((p) => normalize(p));
}

/** First candidate checkout holding `marker` (a path relative to its root), or
 *  null. Returns the checkout root. */
export function findOuterpediaCheckout(
  repoRoot: string | null,
  marker: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const root of outerpediaCandidates(repoRoot, env)) {
    if (existsSync(join(root, marker))) return root;
  }
  return null;
}
