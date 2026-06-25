/**
 * Game-data sync — refresh the raw tables from the local outerpedia checkout
 * and rebuild the derived tables. A Node port of `data/sync.ps1`, callable from
 * both the Vite dev middleware and the Electron prod server, plus an auto-run at
 * desktop startup.
 *
 * Dev-only by nature: it needs the source repo (`data/build.mjs`, `data/game/`)
 * and the outerpedia checkout, neither of which ships in a packaged build — so
 * it degrades to a clean "unavailable" there. Electron-free on purpose (paths
 * are passed in) so the Vite config can import it without pulling in `electron`.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The raw tables the engine needs — kept in sync with `data/sync.ps1`. */
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

/** Locate the outerpedia `data/admin/json2` dir (the raw datamine). Mirrors the
 *  candidate list in `data/sync.ps1` + the OUTERPEDIA_PATH override. */
function findJson2(): string | null {
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

/** True when any outerpedia source is newer than the built `characters.json`
 *  (or the derived tree doesn't exist yet). Cheap mtime comparison — avoids
 *  rebuilding on every launch when nothing changed. */
function isStale(json2: string, outerRoot: string, derivedDir: string): boolean {
  const built = mtimeOf(join(derivedDir, "characters.json"));
  if (!built) return true;
  let newest = 0;
  for (const f of GAME_FILES) { const t = mtimeOf(join(json2, f)); if (t > newest) newest = t; }
  // build.mjs also reads outerpedia's damage-calc per-char buffs (scalings).
  const buffsDir = join(outerRoot, "public", "damage-calc", "buffs");
  newest = Math.max(newest, newestIn(buffsDir));
  return newest > built;
}

function runBuild(repoRoot: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(repoRoot, "data", "build.mjs")], {
      cwd: repoRoot,
      windowsHide: true,
      // ELECTRON_RUN_AS_NODE: run the Electron binary as a plain Node so we don't
      // depend on a separate `node` on PATH (the desktop ships Electron only).
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export interface SyncResult {
  status: "synced" | "fresh" | "unavailable" | "error";
  message: string;
  /** Number of raw tables copied (synced only). */
  copied?: number;
}

/**
 * Copy the raw tables from outerpedia → `data/game/`, then rebuild `data/derived`.
 *  - `force` skips the staleness check (manual "Sync" button).
 *  - Returns "unavailable" when the source repo / outerpedia checkout is absent
 *    (packaged build, or a machine without the checkout) — never throws.
 */
export async function syncGameData(opts: { repoRoot: string; derivedDir: string; force: boolean }): Promise<SyncResult> {
  const { repoRoot, derivedDir, force } = opts;
  const buildScript = join(repoRoot, "data", "build.mjs");
  const gameDir = join(repoRoot, "data", "game");
  if (!existsSync(buildScript) || !existsSync(gameDir)) {
    return { status: "unavailable", message: "source repo not present (packaged build?)" };
  }
  const json2 = findJson2();
  if (!json2) return { status: "unavailable", message: "outerpedia checkout not found" };
  const outerRoot = join(json2, "..", "..", "..");

  if (!force && !isStale(json2, outerRoot, derivedDir)) {
    return { status: "fresh", message: "data already up to date" };
  }

  let copied = 0;
  for (const f of GAME_FILES) {
    const src = join(json2, f);
    if (!existsSync(src)) continue;
    try { copyFileSync(src, join(gameDir, f)); copied++; } catch { /* skip unreadable */ }
  }
  const code = await runBuild(repoRoot);
  if (code !== 0) return { status: "error", message: `build.mjs exited ${code}`, copied };
  return { status: "synced", message: `synced ${copied} tables + rebuilt derived`, copied };
}
