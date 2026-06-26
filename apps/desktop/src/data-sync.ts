/**
 * Game-data sync — keep `data/derived/*.json` current with the Outerplane game
 * tables, from one of two sources:
 *
 *  - CHECKOUT mode (dev, maintainer machine): a local outerpedia checkout is
 *    present. Copy its raw tables into `gameDir` and rebuild; build.mjs reads
 *    the checkout directly for equipment / buff inputs. mtime-gated so a launch
 *    is instant when nothing changed. No network.
 *
 *  - REPO mode (packaged build, any machine): no checkout. Resolve the latest
 *    commit SHA of `Sevih/outerpediaV2`, and if it changed since last sync,
 *    download the raw tables (+ build inputs) from the GitHub CDN into the
 *    writable cache and rebuild. This is what lets the app track game patches
 *    WITHOUT shipping a new installer. Degrades cleanly offline (uses whatever
 *    derived is already cached).
 *
 * Electron-free (paths passed in) so the Vite config can import it.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchRepoFile, readShaState, resolveLatestSha, writeShaState } from "./repo-source.js";

/** The raw tables the engine needs (29 files — the full set build.mjs loads,
 *  matching the committed `data/game/` tree). */
const GAME_FILES = [
  "ItemTemplet.json", "ItemOptionTemplet.json", "ItemSpecialOptionTemplet.json",
  "ItemOptionChangeTemplet.json", "ItemBreakLimitTemplet.json", "ItemEnchantTemplet.json",
  "ItemEnchantExpTemplet.json", "ItemSmeltingTemplet.json", "SingularityEquipEnchantTemplet.json",
  "SingularityGradeTemplet.json", "SingularityOptionPopUpTemplet.json", "SpecialEquipEnchantTemplet.json",
  "CharacterTemplet.json", "CharacterEvolutionStatTemplet.json", "GameConfigTemplet.json",
  "CharacterArchiveStatTemplet.json", "ArchiveBonusTemplet.json", "CharacterTranscendentTemplet.json",
  "CharacterSkillLevelTemplet.json", "CharacterAwakeningLevelTemplet.json",
  "CharacterAwakeningNodeTemplet.json", "CharacterFusionTemplet.json",
  "CharacterMaxLevelTemplet.json", "ExpCharacterTemplet.json",
  "BuffTemplet.json", "TrustBuffTemplet.json",
  "TextItem.json", "TextCharacter.json", "TextSystem.json",
];

/** Outerpedia-only build inputs (read by build.mjs's loadOuterpedia), mirrored
 *  under `syncDir` at their repo-relative paths so build.mjs finds them. */
const JSON2_EXTRAS = ["TextSkill.json", "CharacterExtraTemplet.json"];
const EQUIPMENT_FILES = ["weapon.json", "accessory.json", "talisman.json", "ee.json", "sets.json"];

/** Locate the outerpedia `data/admin/json2` dir (the raw datamine) in a local
 *  checkout, if any. `OUTERPEDIA_PATH` env wins. Absent on a user's machine →
 *  triggers REPO mode. */
function findJson2(): string | null {
  // Test hook: force REPO mode even on a machine that has a checkout, so the
  // packaged-build sync path can be exercised in dev (OUTERPEDIA_NO_CHECKOUT=1).
  if (process.env.OUTERPEDIA_NO_CHECKOUT) return null;
  const env = process.env.OUTERPEDIA_PATH;
  const candidates = [
    env ? join(env, "data", "admin", "json2") : null,
    "C:\\Users\\Sevih\\Documents\\Projet perso\\outerpedia-v2\\data\\admin\\json2",
    "C:\\Users\\Sevih\\Documents\\dev\\outerpedia\\data\\admin\\json2",
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

function mtimeOf(p: string): number {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}
function newestIn(dir: string): number {
  try {
    let m = 0;
    for (const f of readdirSync(dir)) { const t = mtimeOf(join(dir, f)); if (t > m) m = t; }
    return m;
  } catch { return 0; }
}

/** Checkout-mode staleness: any outerpedia source newer than built characters.json. */
function isStale(json2: string, outerRoot: string, derivedDir: string): boolean {
  const built = mtimeOf(join(derivedDir, "characters.json"));
  if (!built) return true;
  let newest = 0;
  for (const f of GAME_FILES) { const t = mtimeOf(join(json2, f)); if (t > newest) newest = t; }
  newest = Math.max(newest, newestIn(join(outerRoot, "public", "damage-calc", "buffs")));
  return newest > built;
}

/** Run a bounded-concurrency pool over `items`. */
async function pool<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]!); }
  });
  await Promise.all(workers);
}

let dlCounter = 0;
/** Download a single repo file to `destFile` (atomic write). Returns true on 200. */
async function downloadOne(ref: string, relPath: string, destFile: string): Promise<boolean> {
  const got = await fetchRepoFile(ref, relPath);
  if (got.status !== 200 || !got.buf) return false;
  mkdirSync(dirname(destFile), { recursive: true });
  const tmp = `${destFile}.${process.pid}.${dlCounter++}.tmp`;
  writeFileSync(tmp, got.buf);
  renameSync(tmp, destFile);
  return true;
}

/** REPO mode: download the 29 game tables into `gameDir` and the build inputs
 *  into `syncDir` (mirroring repo paths). Returns the count of files written. */
async function downloadGameData(ref: string, gameDir: string, syncDir: string): Promise<number> {
  let copied = 0;
  // Game tables → gameDir (flat).
  await pool(GAME_FILES, 8, async (f) => {
    if (await downloadOne(ref, `data/admin/json2/${f}`, join(gameDir, f))) copied++;
  });
  // json2 extras → syncDir mirror.
  await pool(JSON2_EXTRAS, 8, async (f) => {
    if (await downloadOne(ref, `data/admin/json2/${f}`, join(syncDir, "data", "admin", "json2", f))) copied++;
  });
  // equipment lists → syncDir mirror.
  await pool(EQUIPMENT_FILES, 8, async (f) => {
    if (await downloadOne(ref, `data/equipment/${f}`, join(syncDir, "data", "equipment", f))) copied++;
  });
  // per-character damage-calc buffs → syncDir mirror. Ids come from the freshly
  // downloaded CharacterTemplet; not every id has a buff file (404 tolerated).
  let charIds: string[] = [];
  try {
    const chars = JSON.parse(readFileSync(join(gameDir, "CharacterTemplet.json"), "utf-8")) as Array<{ ID?: number | string }>;
    charIds = chars.map((c) => String(c.ID)).filter((id) => id && id !== "undefined");
  } catch { /* no chars → skip buffs */ }
  await pool(charIds, 8, async (id) => {
    if (await downloadOne(ref, `public/damage-calc/buffs/${id}.json`, join(syncDir, "public", "damage-calc", "buffs", `${id}.json`))) copied++;
  });
  return copied;
}

/** Spawn build.mjs, pointing it at the synced dirs via env. */
function runBuild(repoRoot: string, env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(repoRoot, "data", "build.mjs")], {
      cwd: repoRoot,
      windowsHide: true,
      // ELECTRON_RUN_AS_NODE: run the Electron binary as plain Node (the desktop
      // ships Electron only, no separate node on PATH).
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export interface SyncResult {
  status: "synced" | "fresh" | "offline" | "unavailable" | "error";
  message: string;
  /** Number of raw files copied/downloaded (synced only). */
  copied?: number;
}

export interface SyncOptions {
  /** Dir holding build.mjs/calc-stats.mjs (REPO_ROOT in dev, resourcesPath in prod). */
  repoRoot: string;
  /** Where the 29 raw game tables live (data/game in dev, cache in prod). */
  gameDir: string;
  /** Mirror dir for build inputs (null in dev — build reads the checkout). */
  syncDir: string | null;
  /** Output dir for derived tables. */
  derivedDir: string;
  /** File persisting the last-synced commit SHA (REPO-mode gate). */
  shaStateFile: string;
  /** Skip the staleness/SHA gate (manual "Sync" button). */
  force: boolean;
}

/**
 * Refresh game data and rebuild derived. Picks CHECKOUT or REPO mode by whether
 * a local outerpedia checkout is present. Never throws — returns a status.
 */
export async function syncGameData(opts: SyncOptions): Promise<SyncResult> {
  const { repoRoot, gameDir, syncDir, derivedDir, shaStateFile, force } = opts;
  const buildScript = join(repoRoot, "data", "build.mjs");
  if (!existsSync(buildScript)) {
    return { status: "unavailable", message: "build script not present (packaged without data/build.mjs?)" };
  }
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(derivedDir, { recursive: true });

  const json2 = findJson2();

  // ── CHECKOUT mode ─────────────────────────────────────────────────────────
  if (json2) {
    const outerRoot = join(json2, "..", "..", "..");
    if (!force && !isStale(json2, outerRoot, derivedDir)) {
      return { status: "fresh", message: "data already up to date (checkout)" };
    }
    let copied = 0;
    for (const f of GAME_FILES) {
      const src = join(json2, f);
      if (!existsSync(src)) continue;
      try { copyFileSync(src, join(gameDir, f)); copied++; } catch { /* skip unreadable */ }
    }
    // No OUTERPEDIA_SYNC_DIR — build.mjs reads the checkout via findOuterpedia().
    const code = await runBuild(repoRoot, { OUTERPEDIA_GAME_DIR: gameDir, OUTERPEDIA_DERIVED_DIR: derivedDir });
    if (code !== 0) return { status: "error", message: `build.mjs exited ${code}`, copied };
    return { status: "synced", message: `synced ${copied} tables + rebuilt (checkout)`, copied };
  }

  // ── REPO mode ─────────────────────────────────────────────────────────────
  if (!syncDir) return { status: "unavailable", message: "no checkout and no syncDir for repo mode" };
  const derivedReady = existsSync(join(derivedDir, "characters.json"));
  const latest = await resolveLatestSha();
  const cached = readShaState(shaStateFile)?.sha ?? null;

  if (latest == null) {
    // Offline or rate-limited — fall back to whatever's already built.
    return derivedReady
      ? { status: "offline", message: "offline — using cached game data" }
      : { status: "unavailable", message: "offline and no cached game data" };
  }
  if (!force && latest === cached && derivedReady) {
    return { status: "fresh", message: `data up to date (${latest.slice(0, 7)})` };
  }

  mkdirSync(syncDir, { recursive: true });
  const copied = await downloadGameData(latest, gameDir, syncDir);
  const code = await runBuild(repoRoot, { OUTERPEDIA_GAME_DIR: gameDir, OUTERPEDIA_SYNC_DIR: syncDir, OUTERPEDIA_DERIVED_DIR: derivedDir });
  if (code !== 0) return { status: "error", message: `build.mjs exited ${code}`, copied };
  // Only record the SHA after a successful build — a failed build retries next launch.
  writeShaState(shaStateFile, latest);
  return { status: "synced", message: `synced ${copied} files @ ${latest.slice(0, 7)} + rebuilt`, copied };
}
