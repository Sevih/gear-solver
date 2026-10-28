/**
 * Refresh the committed `data/derived/*.json` from the local outerpedia
 * checkout's solver artifacts (`data/generated/solver/`, emitted by
 * outerpedia's datagen — the distillation pipeline that used to live here as
 * build.mjs/calc-stats.mjs).
 *
 * Also refreshes `apps/desktop/src/game-client.json`, the committed copy of
 * outerpedia's `data/curated/game-client.json` (Steam appid / exe / roots and
 * the pinned BepInEx release, read by steam-capture.ts). Not a solver table:
 * it ships inside the app build and is never downloaded at runtime.
 *
 * Run after a game patch (once outerpedia's `datagen:build` + `promote` ran):
 *   node data/sync.mjs      (or: npm run data:sync)
 *
 * Checkout lookup (scripts/outerpedia-checkout.mjs): `OUTERPEDIA_PATH` env →
 * `OUTERPEDIA_PATH` in `.env.local` → sibling `../outerpedia`. Exits non-zero when
 * the checkout or an expected artifact is missing or not JSON so a release can't
 * silently ship stale data, and when the checkout's `version.json` carries a
 * contract schema this build can't read (scripts/solver-schema.mjs). Every
 * artifact is read before anything is written, `version.json` last — the same
 * rule as the app's CHECKOUT mode (apps/desktop/src/data-sync.ts). An optional
 * artifact (`solver-files-optional.json`) absent from the checkout is skipped
 * with a log line instead; present, it is checked and copied like the others.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REPO_ROOT, findOuterpediaCheckout } from "../scripts/outerpedia-checkout.mjs";
import { schemaRefusal } from "../scripts/solver-schema.mjs";
// The one list of solver artifacts, shared with the app's runtime sync
// (apps/desktop/src/data-sync.ts); outerpedia's datagen/generators/solver.ts
// emits the same set of tables (`items.json` once published). `stat-keys.json`
// is copied like the others but only packages/core/test/stat-keys.test.ts reads it.
import SOLVER_FILES from "../apps/desktop/src/solver-files.json" with { type: "json" };
import OPTIONAL_SOLVER_FILES from "../apps/desktop/src/solver-files-optional.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const DERIVED = join(here, "derived");

const SOLVER_DIR = join("data", "generated", "solver");
const root = findOuterpediaCheckout(REPO_ROOT, join(SOLVER_DIR, "version.json"));
const checkout = root ? join(root, SOLVER_DIR) : null;
if (!checkout) {
  console.error("no outerpedia checkout with data/generated/solver found (set OUTERPEDIA_PATH in the environment or .env.local)");
  process.exit(1);
}

// A contract this build can't read must never reach `data/derived/` (it ships
// in the installer): refuse before writing anything.
const refusal = schemaRefusal(readFileSync(join(checkout, "version.json"), "utf-8"));
if (refusal) {
  console.error(`${refusal}; data/derived left untouched`);
  process.exit(1);
}

// Read and parse every artifact first: a missing or broken one stops the sync
// before `data/derived/` is touched.
const tables = new Map();
for (const f of SOLVER_FILES) {
  const src = join(checkout, f);
  if (!existsSync(src) && OPTIONAL_SOLVER_FILES.includes(f)) {
    console.log(`optional artifact not published yet: ${src}; skipped`);
    continue;
  }
  if (!existsSync(src)) {
    console.error(`missing artifact: ${src}; data/derived left untouched`);
    process.exit(1);
  }
  try {
    // Re-serialize compact: the generator pretty-prints its output, which would
    // bloat the committed tree / installer / runtime downloads ~2.6×. The
    // version.json hash identifies the SNAPSHOT (emitted content), not our
    // bytes, so compacting is safe.
    tables.set(f, JSON.stringify(JSON.parse(readFileSync(src, "utf-8"))));
  } catch {
    console.error(`unreadable or not JSON: ${src}; data/derived left untouched`);
    process.exit(1);
  }
}
// version.json last: its hash is what the app compares.
for (const [f, json] of tables) if (f !== "version.json") writeFileSync(join(DERIVED, f), json);
writeFileSync(join(DERIVED, "version.json"), tables.get("version.json"));
const version = JSON.parse(tables.get("version.json"));
console.log(`synced ${tables.size} tables from ${checkout}`);
console.log(`derived version: ${version.hash} (built ${version.builtAt})`);

// Shared Steam client reference, copied verbatim (outerpedia's tests guard its
// shape; ours compare the copy against it).
const GAME_CLIENT = join("data", "curated", "game-client.json");
const gameClientSrc = join(root, GAME_CLIENT);
if (!existsSync(gameClientSrc)) {
  console.error(`missing reference: ${gameClientSrc}`);
  process.exit(1);
}
copyFileSync(gameClientSrc, join(REPO_ROOT, "apps", "desktop", "src", "game-client.json"));
console.log(`synced game-client.json from ${gameClientSrc}`);
