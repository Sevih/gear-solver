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
 *    download its version.json; only when the data hash differs too are the
 *    other 18 artifacts downloaded from the GitHub CDN into the writable cache.
 *    This is what lets the app track game patches WITHOUT shipping a new
 *    installer. Degrades cleanly offline (uses whatever derived is already
 *    cached).
 *
 * Electron-free (paths passed in) so the Vite config can import it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findOuterpediaCheckout } from "./outerpedia-checkout.js";
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
 *  `OUTERPEDIA_PATH` env wins; with a `repoRoot` (dev) `.env.local` and a
 *  sibling `../outerpedia` checkout are tried too (outerpedia-checkout.ts).
 *  Absent on a user's machine → REPO mode. */
function findSolverCheckout(repoRoot: string | null): string | null {
  // Test hook: force REPO mode even on a machine that has a checkout, so the
  // packaged-build sync path can be exercised in dev (OUTERPEDIA_NO_CHECKOUT=1).
  if (process.env.OUTERPEDIA_NO_CHECKOUT) return null;
  const root = findOuterpediaCheckout(repoRoot, join(SOLVER_DIR, "version.json"));
  return root ? join(root, SOLVER_DIR) : null;
}

/**
 * Highest `version.json` `schema` this build reads. outerpedia's solver
 * generator (header of `datagen/generators/solver.ts`) only bumps `schema` for
 * a change an older reader would misread (field removed, renamed, meaning
 * changed), in this order: (a) outerpedia adds the new field next to the old
 * one, `schema` unchanged; (b) a gear-solver release reads the new field and
 * raises this constant to `schema + 1`; (c) outerpedia drops the old field and
 * bumps `schema`. A newer schema is refused and the cache kept (see
 * `schemaRefusal`). Twin: `scripts/solver-schema.mjs` (data/sync.mjs).
 *
 * Format 2: `characters.json` drops `ingredients.corePassive`, leaving
 * `corePassiveByFusion` alone.
 */
export const SUPPORTED_SOLVER_SCHEMA = 2;

/** Contract schema of a solver `version.json` body: no `schema` field → 1 (the
 *  contract before outerpedia added it — still what an un-updated cache
 *  carries); an integer ≥ 1 → itself; anything else, or unparsable JSON → null. */
export function solverSchemaOf(body: string): number | null {
  let v: unknown;
  try { v = JSON.parse(body); } catch { return null; }
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const schema = (v as { schema?: unknown }).schema;
  if (schema === undefined) return 1;
  return typeof schema === "number" && Number.isInteger(schema) && schema >= 1 ? schema : null;
}

/** Why a `version.json` body can't be used by a build reading up to
 *  `supported`, or null when it can. Worded to read inside the UI's
 *  "Game data sync failed — <reason>; keeping the cached data." */
export function schemaRefusal(body: string, supported: number = SUPPORTED_SOLVER_SCHEMA): string | null {
  const schema = solverSchemaOf(body);
  if (schema == null) return "outerpedia's game data has an unreadable format";
  if (schema > supported) {
    return `outerpedia's game data uses format ${schema}, this version of gear-solver reads up to format ${supported} — update gear-solver`;
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

/** Content hash from a version.json body — null when malformed. */
function hashOf(buf: Buffer): string | null {
  try {
    const v = JSON.parse(buf.toString("utf-8")) as { hash?: string };
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
  /** gear-solver repo root — dev only, enables the `.env.local` and sibling
   *  checkout lookups. Null/absent (packaged build): `OUTERPEDIA_PATH` only. */
  repoRoot?: string | null;
  /** Highest contract schema accepted — tests only; defaults to
   *  `SUPPORTED_SOLVER_SCHEMA`. */
  supportedSchema?: number;
}

/** Refused data: nothing written, SHA not recorded — status by whether a
 *  cache is there to fall back on. */
function refused(reason: string, derivedReady: boolean): SyncResult {
  return derivedReady
    ? { status: "error", message: `${reason}; keeping the cached data` }
    : { status: "unavailable", message: `${reason}; no cached game data` };
}

/**
 * Refresh the derived game data. Picks CHECKOUT or REPO mode by whether a
 * local outerpedia checkout carries the solver artifacts. Never throws —
 * returns a status.
 */
export async function syncGameData(opts: SyncOptions): Promise<SyncResult> {
  const { derivedDir, shaStateFile, force, repoRoot = null, supportedSchema = SUPPORTED_SOLVER_SCHEMA } = opts;
  mkdirSync(derivedDir, { recursive: true });
  const derivedReady = existsSync(join(derivedDir, "characters.json"));

  // ── CHECKOUT mode ─────────────────────────────────────────────────────────
  const checkout = findSolverCheckout(repoRoot);
  if (checkout) {
    let body = "";
    try { body = readFileSync(join(checkout, "version.json"), "utf-8"); } catch { /* refused below */ }
    const refusal = schemaRefusal(body, supportedSchema);
    if (refusal) return refused(refusal, derivedReady);
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

  // Most outerpedia commits touch the site, not the solver data. Fetch
  // version.json first and compare its content hash with the cached one: the
  // same hash means the 18 other tables are byte-identical — record the new
  // SHA and stop there. (The manual Sync — force — still re-downloads all.)
  const bufs = new Map<string, Buffer>();
  const version = await fetchRepoFile(latest, `${SOLVER_DIR}/version.json`);
  if (version.status !== 200 || !version.buf) {
    return derivedReady
      ? { status: "error", message: `download failed: version.json (${version.status}) — keeping cached data` }
      : { status: "unavailable", message: `download failed: version.json (${version.status}) and no cached data` };
  }
  // A contract this build can't read is refused before anything else — no
  // table downloaded or written, and the SHA NOT recorded: recording it would
  // make the gate above answer "fresh" on every later launch, so an updated
  // app would never pick these tables up.
  const refusal = schemaRefusal(version.buf.toString("utf-8"), supportedSchema);
  if (refusal) return refused(refusal, derivedReady);
  const remoteHash = hashOf(version.buf);
  if (!force && derivedReady && remoteHash != null && remoteHash === readVersionHash(derivedDir)) {
    writeShaState(shaStateFile, latest);
    return { status: "fresh", message: `data up to date (${latest.slice(0, 7)}, data ${remoteHash})` };
  }
  bufs.set("version.json", version.buf);

  // Download ALL artifacts into memory first, then write — a mid-flight
  // network failure must never leave `derivedDir` half old / half new
  // (characters.json from one patch + equipment.json from another would be
  // an incoherent snapshot).
  let failed: string | null = null;
  await pool(SOLVER_FILES.filter((f) => f !== "version.json"), 8, async (f) => {
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
  // version.json goes LAST: its hash is what the next launch compares, so it
  // must never claim data a half-finished write didn't deliver.
  for (const [f, buf] of bufs) if (f !== "version.json") writeAtomic(join(derivedDir, f), compact(buf));
  writeAtomic(join(derivedDir, "version.json"), compact(version.buf));
  // Only record the SHA after a complete write — a failed sync retries next launch.
  writeShaState(shaStateFile, latest);
  return { status: "synced", message: `synced ${bufs.size} tables @ ${latest.slice(0, 7)}`, copied: bufs.size };
}
