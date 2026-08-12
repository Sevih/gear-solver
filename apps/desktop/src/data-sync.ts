/**
 * Game-data sync — keep `data/derived/*.json` current with the solver
 * artifacts outerpedia's datagen emits at `data/generated/solver/` (the
 * ready-to-consume distillation of the raw game tables — the old local
 * build.mjs pipeline now lives in outerpedia's `datagen/generators/solver.ts`).
 *
 * Two sources:
 *
 *  - CHECKOUT mode (dev, maintainer machine): a local outerpedia checkout is
 *    present. Copy `data/generated/solver/*.json` into `derivedDir`.
 *    version.json-hash-gated so a launch is a no-op when nothing changed.
 *    No network.
 *
 *  - REPO mode (packaged build, any machine): no checkout. Resolve the latest
 *    commit SHA of `Sevih/outerpedia`, and if it changed since last sync,
 *    download the 19 artifacts from the GitHub CDN into the writable cache.
 *    This is what lets the app track game patches WITHOUT shipping a new
 *    installer. Degrades cleanly offline (uses whatever derived is already
 *    cached).
 *
 * Electron-free (paths passed in) so the Vite config can import it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRepoFile, readShaState, resolveLatestSha, writeShaState } from "./repo-source.js";

/** Repo-relative dir holding the solver artifacts. */
const SOLVER_DIR = "data/generated/solver";

/** The 19 derived tables the engine consumes — the exact set outerpedia's
 *  solver generator emits (and the committed `data/derived/` tree mirrors). */
export const SOLVER_FILES = [
  "archive-bonus.json", "buffs.json", "char-level-max.json", "characters.json",
  "codex-curve.json", "ee-passives.json", "enhance.json", "equipment-passives.json",
  "equipment.json", "exp-character.json", "gems.json", "multi-tier-passives.json",
  "options.json", "sets.json", "singularity-options.json", "sub-ticks.json",
  "trust-buffs.json", "trust-character.json", "version.json",
];

/** Locate a local outerpedia checkout carrying the solver artifacts, if any.
 *  `OUTERPEDIA_PATH` env wins. Absent on a user's machine → REPO mode. */
function findSolverCheckout(): string | null {
  // Test hook: force REPO mode even on a machine that has a checkout, so the
  // packaged-build sync path can be exercised in dev (OUTERPEDIA_NO_CHECKOUT=1).
  if (process.env.OUTERPEDIA_NO_CHECKOUT) return null;
  const candidates = [
    process.env.OUTERPEDIA_PATH,
    "C:\\Users\\Sevih\\Documents\\Projet perso\\outerpedia",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(join(p, SOLVER_DIR, "version.json"))) return join(p, SOLVER_DIR);
  }
  return null;
}

/** Content hash from a derived tree's version.json — null when absent/corrupt. */
function readVersionHash(dir: string): string | null {
  try {
    const v = JSON.parse(readFileSync(join(dir, "version.json"), "utf-8")) as { hash?: string };
    return typeof v.hash === "string" ? v.hash : null;
  } catch {
    return null;
  }
}

/** Run a bounded-concurrency pool over `items`. */
async function pool<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]!); }
  });
  await Promise.all(workers);
}

let tmpCounter = 0;
/** Atomic single-file write (tmp + rename). */
function writeAtomic(file: string, buf: Buffer | string): void {
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
}

/** Re-serialize a JSON artifact compact — the generator pretty-prints, which
 *  would ~2.6× the disk/parse cost for the renderer. Falls back to the raw
 *  bytes when parsing fails (never lose data over formatting). */
function compact(buf: Buffer | string): Buffer | string {
  try { return JSON.stringify(JSON.parse(buf.toString("utf-8"))); } catch { return buf; }
}

export interface SyncResult {
  status: "synced" | "fresh" | "offline" | "unavailable" | "error";
  message: string;
  /** Number of artifact files copied/downloaded (synced only). */
  copied?: number;
}

export interface SyncOptions {
  /** Output dir for the derived tables the renderer consumes. */
  derivedDir: string;
  /** File persisting the last-synced commit SHA (REPO-mode gate). */
  shaStateFile: string;
  /** Skip the staleness/SHA gate (manual "Sync" button). */
  force: boolean;
}

/**
 * Refresh the derived game data. Picks CHECKOUT or REPO mode by whether a
 * local outerpedia checkout carries the solver artifacts. Never throws —
 * returns a status.
 */
export async function syncGameData(opts: SyncOptions): Promise<SyncResult> {
  const { derivedDir, shaStateFile, force } = opts;
  mkdirSync(derivedDir, { recursive: true });

  // ── CHECKOUT mode ─────────────────────────────────────────────────────────
  const checkout = findSolverCheckout();
  if (checkout) {
    const srcHash = readVersionHash(checkout);
    if (!force && srcHash != null && srcHash === readVersionHash(derivedDir)) {
      return { status: "fresh", message: `data already up to date (checkout ${srcHash})` };
    }
    let copied = 0;
    for (const f of SOLVER_FILES) {
      const src = join(checkout, f);
      if (!existsSync(src)) continue;
      try { writeAtomic(join(derivedDir, f), compact(readFileSync(src))); copied++; } catch { /* skip unreadable */ }
    }
    return { status: "synced", message: `synced ${copied} tables (checkout ${srcHash ?? "?"})`, copied };
  }

  // ── REPO mode ─────────────────────────────────────────────────────────────
  const derivedReady = existsSync(join(derivedDir, "characters.json"));
  const latest = await resolveLatestSha();
  const cached = readShaState(shaStateFile)?.sha ?? null;

  if (latest == null) {
    // Offline or rate-limited — fall back to whatever's already cached.
    return derivedReady
      ? { status: "offline", message: "offline — using cached game data" }
      : { status: "unavailable", message: "offline and no cached game data" };
  }
  if (!force && latest === cached && derivedReady) {
    return { status: "fresh", message: `data up to date (${latest.slice(0, 7)})` };
  }

  // Download ALL artifacts into memory first, then write — a mid-flight
  // network failure must never leave `derivedDir` half old / half new
  // (characters.json from one patch + equipment.json from another would be
  // an incoherent snapshot).
  const bufs = new Map<string, Buffer>();
  let failed: string | null = null;
  await pool(SOLVER_FILES, 8, async (f) => {
    if (failed) return;
    const got = await fetchRepoFile(latest, `${SOLVER_DIR}/${f}`);
    if (got.status !== 200 || !got.buf) { failed = `${f} (${got.status})`; return; }
    bufs.set(f, got.buf);
  });
  if (failed) {
    return derivedReady
      ? { status: "error", message: `download failed: ${failed} — keeping cached data` }
      : { status: "unavailable", message: `download failed: ${failed} and no cached data` };
  }
  for (const [f, buf] of bufs) writeAtomic(join(derivedDir, f), compact(buf));
  // Only record the SHA after a complete write — a failed sync retries next launch.
  writeShaState(shaStateFile, latest);
  return { status: "synced", message: `synced ${bufs.size} tables @ ${latest.slice(0, 7)}`, copied: bufs.size };
}
