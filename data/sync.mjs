/**
 * Refresh the committed `data/derived/*.json` from the local outerpedia
 * checkout's solver artifacts (`data/generated/solver/`, emitted by
 * outerpedia's datagen — the distillation pipeline that used to live here as
 * build.mjs/calc-stats.mjs).
 *
 * Run after a game patch (once outerpedia's `datagen:build` + `promote` ran):
 *   node data/sync.mjs      (or: npm run data:sync)
 *
 * Checkout lookup (scripts/outerpedia-checkout.mjs): `OUTERPEDIA_PATH` env →
 * `OUTERPEDIA_PATH` in `.env.local` → sibling `../outerpedia`. Exits non-zero when
 * the checkout or an expected artifact is missing so a release can't silently
 * ship stale data.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REPO_ROOT, findOuterpediaCheckout } from "../scripts/outerpedia-checkout.mjs";

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

const SOLVER_DIR = join("data", "generated", "solver");
const root = findOuterpediaCheckout(REPO_ROOT, join(SOLVER_DIR, "version.json"));
const checkout = root ? join(root, SOLVER_DIR) : null;
if (!checkout) {
  console.error("no outerpedia checkout with data/generated/solver found (set OUTERPEDIA_PATH in the environment or .env.local)");
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
