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
 *    version.json-hash-gated so a launch is a no-op when nothing changed (at
 *    an unchanged hash, only a version.json whose stamp moved is rewritten).
 *    Every artifact is read and parsed before anything is written: one missing
 *    or unreadable file refuses the whole sync and keeps the cache, like
 *    `data/sync.mjs`. No network.
 *
 *  - REPO mode (packaged build, any machine): no checkout. Resolve the latest
 *    commit SHA of `Sevih/outerpedia`, and if it changed since last sync,
 *    download its version.json; only when the data hash differs too are the
 *    other 19 artifacts downloaded from the GitHub CDN into the writable cache
 *    (at an unchanged hash, only version.json is rewritten, when it differs).
 *    This is what lets the app track game patches WITHOUT shipping a new
 *    installer. Every download must parse as JSON, else nothing is written.
 *    Degrades cleanly offline (uses the cached derived tree, when complete).
 *
 * Both modes write in two steps — every file to a temp file, then the renames,
 * version.json last — and report a write failure as a status. One sync runs at
 * a time: a call while one is in flight gets that sync's promise.
 *
 * The artifact list is `solver-files.json`, shared with `data/sync.mjs`.
 *
 * Electron-free (paths passed in) so the Vite config can import it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findOuterpediaCheckout } from "./outerpedia-checkout.js";
import { fetchRepoFile, readShaState, resolveLatestSha, writeShaState } from "./repo-source.js";
// The one list of solver artifacts, also imported by `data/sync.mjs` (the
// committed-tree refresh) — a table added or dropped changes both.
import solverFiles from "./solver-files.json" with { type: "json" };

/** Repo-relative dir holding the solver artifacts. */
const SOLVER_DIR = "data/generated/solver";

/** The 20 derived tables — the exact set outerpedia's solver generator emits
 *  (and the committed `data/derived/` tree mirrors). All but one feed the
 *  engine: `stat-keys.json` (`ST_*` / `OAT_*` → contract stat key, % nature,
 *  abbreviation) is downloaded like the others but never loaded — only
 *  `packages/core/test/stat-keys.test.ts` reads it, to hold `GAME_STAT`
 *  (packages/core/src/stats.ts) against the contract. */
export const SOLVER_FILES: readonly string[] = solverFiles;

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

/** Write `tables` (name → JSON text), then `version` as version.json when
 *  given, into `derivedDir` in two steps: every body to a sibling temp file
 *  first, then the renames, version.json last — its hash is what the next
 *  launch compares, so it must never claim tables a failed write didn't
 *  deliver. Returns null when done, else why, naming the file; the temp files
 *  are removed. Never throws. */
function commitFiles(derivedDir: string, tables: ReadonlyMap<string, string>, version: string | null): string | null {
  const files = [...tables];
  if (version != null) files.push(["version.json", version]);
  const tmps = new Map<string, string>();
  let current = "";
  try {
    for (const [f, body] of files) {
      current = f;
      const tmp = `${join(derivedDir, f)}.${process.pid}.${tmpCounter++}.tmp`;
      tmps.set(f, tmp);
      writeFileSync(tmp, body);
    }
    for (const [f] of files) {
      current = f;
      renameSync(tmps.get(f)!, join(derivedDir, f));
      tmps.delete(f);
    }
    return null;
  } catch (err) {
    for (const tmp of tmps.values()) try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    const code = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
    return `could not write ${current} to the game data folder (${code})`;
  }
}

/** Re-serialize a JSON artifact compact — the generator pretty-prints, which
 *  would ~2.6× the disk/parse cost for the renderer. Falls back to the raw
 *  bytes when parsing fails; only a version.json body that already passed
 *  `schemaRefusal` is written through it. */
function compact(buf: Buffer | string): Buffer | string {
  try { return JSON.stringify(JSON.parse(buf.toString("utf-8"))); } catch { return buf; }
}

/** At an unchanged data hash, rewrite the cached version.json when its body
 *  differs (a new `resVersion` — the hash covers the 18 tables, not the stamp)
 *  — the only file written. Null when done or nothing to do, else why. */
function refreshVersionStamp(derivedDir: string, body: Buffer | string): string | null {
  const next = compact(body).toString();
  let cur: Buffer | string = "";
  try { cur = compact(readFileSync(join(derivedDir, "version.json"))); } catch { /* rewritten below */ }
  return cur.toString() !== next ? commitFiles(derivedDir, new Map(), next) : null;
}

/** A usable cache holds every artifact of the list: one missing table (a
 *  half-seeded or hand-pruned folder) is neither "fresh" nor an offline
 *  fallback. */
function cacheComplete(derivedDir: string): boolean {
  return SOLVER_FILES.every((f) => existsSync(join(derivedDir, f)));
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

/** The sync in flight, if any — the launch sync and the manual Sync button
 *  (`/api/data/sync`) must never write the same folder at once. */
let inFlight: Promise<SyncResult> | null = null;

/**
 * Refresh the derived game data. Picks CHECKOUT or REPO mode by whether a
 * local outerpedia checkout carries the solver artifacts. One at a time: a
 * call while a sync runs gets that sync's promise (its options ignored).
 * Never throws — returns a status.
 */
export function syncGameData(opts: SyncOptions): Promise<SyncResult> {
  if (inFlight) return inFlight;
  const run = runSync(opts)
    .catch((err: unknown): SyncResult => ({
      status: "error",
      message: `game data sync failed (${err instanceof Error ? err.message : String(err)})`,
    }))
    .finally(() => { inFlight = null; });
  inFlight = run;
  return run;
}

async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const { derivedDir, shaStateFile, force, repoRoot = null, supportedSchema = SUPPORTED_SOLVER_SCHEMA } = opts;
  mkdirSync(derivedDir, { recursive: true });
  const derivedReady = cacheComplete(derivedDir);

  // ── CHECKOUT mode ─────────────────────────────────────────────────────────
  const checkout = findSolverCheckout(repoRoot);
  if (checkout) {
    let body = "";
    try { body = readFileSync(join(checkout, "version.json"), "utf-8"); } catch { /* refused below */ }
    const refusal = schemaRefusal(body, supportedSchema);
    if (refusal) return refused(refusal, derivedReady);
    const srcHash = readVersionHash(checkout);
    if (!force && derivedReady && srcHash != null && srcHash === readVersionHash(derivedDir)) {
      const unwritten = refreshVersionStamp(derivedDir, body);
      if (unwritten) return refused(unwritten, derivedReady);
      return { status: "fresh", message: `data already up to date (checkout ${srcHash})` };
    }
    // Read and parse EVERY artifact before writing any: a missing or broken
    // file must never leave `derivedDir` half one snapshot, half another.
    // version.json is the body already checked above.
    const tables = new Map<string, string>();
    for (const f of SOLVER_FILES) {
      if (f === "version.json") continue;
      const src = join(checkout, f);
      if (!existsSync(src)) return refused(`${f} is missing from the outerpedia checkout`, derivedReady);
      let text: string;
      try { text = readFileSync(src, "utf-8"); } catch { return refused(`${f} is unreadable in the outerpedia checkout`, derivedReady); }
      try { tables.set(f, JSON.stringify(JSON.parse(text))); } catch { return refused(`${f} is not valid JSON in the outerpedia checkout`, derivedReady); }
    }
    const unwritten = commitFiles(derivedDir, tables, compact(body).toString());
    if (unwritten) return refused(unwritten, derivedReady);
    const copied = tables.size + 1;
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
  // same hash means the 18 other tables are byte-identical — refresh the
  // version.json stamp if its body moved (`resVersion`), record the new SHA
  // and stop there. (The manual Sync — force — still re-downloads all.)
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
    const unwritten = refreshVersionStamp(derivedDir, version.buf);
    if (unwritten) return refused(unwritten, derivedReady);
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
  // Every artifact must be JSON: a 200 carrying an error page or a truncated
  // body is refused whole, nothing written, SHA not recorded.
  const tables = new Map<string, string>();
  for (const f of SOLVER_FILES) {
    if (f === "version.json") continue;
    try { tables.set(f, JSON.stringify(JSON.parse(bufs.get(f)!.toString("utf-8")))); } catch {
      return refused(`${f} downloaded from outerpedia is not valid JSON`, derivedReady);
    }
  }
  const unwritten = commitFiles(derivedDir, tables, compact(version.buf).toString());
  if (unwritten) return refused(unwritten, derivedReady);
  // Only record the SHA after a complete write — a failed sync retries next launch.
  writeShaState(shaStateFile, latest);
  return { status: "synced", message: `synced ${bufs.size} tables @ ${latest.slice(0, 7)}`, copied: bufs.size };
}
