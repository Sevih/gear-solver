/**
 * Refresh the committed `data/derived/*.json` from the local outerpedia
 * checkout's solver artifacts (`data/generated/solver/`, emitted by
 * outerpedia's datagen — the distillation pipeline that used to live here as
 * build.mjs/calc-stats.mjs).
 *
 * Run after a game patch (once outerpedia's `datagen:build` + `promote` ran):
 *   node data/sync.mjs      (or: npm run data:sync)
 *
 * `OUTERPEDIA_PATH` env overrides the checkout location. Exits non-zero when
 * the checkout or an expected artifact is missing so a release can't silently
 * ship stale data.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DERIVED = join(here, "derived");

// Keep in sync with SOLVER_FILES in apps/desktop/src/data-sync.ts (the
// runtime downloader) and outerpedia's datagen/generators/solver.ts (emitter).
const SOLVER_FILES = [
  "archive-bonus.json", "buffs.json", "char-level-max.json", "characters.json",
  "codex-curve.json", "ee-passives.json", "enhance.json", "equipment-passives.json",
  "equipment.json", "exp-character.json", "gems.json", "multi-tier-passives.json",
  "options.json", "sets.json", "singularity-options.json", "sub-ticks.json",
  "trust-buffs.json", "trust-character.json", "version.json",
];

const candidates = [
  process.env.OUTERPEDIA_PATH,
  "C:\\Users\\Sevih\\Documents\\Projet perso\\outerpedia",
].filter(Boolean);
const checkout = candidates.map((p) => join(p, "data", "generated", "solver"))
  .find((p) => existsSync(join(p, "version.json")));
if (!checkout) {
  console.error("no outerpedia checkout with data/generated/solver found (set OUTERPEDIA_PATH?)");
  process.exit(1);
}

let copied = 0;
for (const f of SOLVER_FILES) {
  const src = join(checkout, f);
  if (!existsSync(src)) {
    console.error(`missing artifact: ${src}`);
    process.exit(1);
  }
  // Re-serialize compact: the generator pretty-prints its output, which would
  // bloat the committed tree / installer / runtime downloads ~2.6×. The
  // version.json hash identifies the SNAPSHOT (emitted content), not our
  // bytes, so compacting is safe.
  writeFileSync(join(DERIVED, f), JSON.stringify(JSON.parse(readFileSync(src, "utf-8"))));
  copied++;
}
const version = JSON.parse(readFileSync(join(DERIVED, "version.json"), "utf-8"));
console.log(`synced ${copied} tables from ${checkout}`);
console.log(`derived version: ${version.hash} (built ${version.builtAt})`);
