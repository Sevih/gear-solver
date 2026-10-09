#!/usr/bin/env node
/**
 * Export the no-gear stat oracle the outerpedia wiki tests its character
 * sheet ("Base Stats") against.
 *
 *   npm run oracle:wiki                          # → stdout
 *   npm run oracle:wiki -- --out <file>          # → file
 *   npm run oracle:wiki -- --data <dir>          # read another solver data dir
 *                                                #   (default: data/derived)
 *   npm run oracle:wiki -- --res-version 1.11.404
 *
 * Needs Node ≥ 22.6 (type stripping) to import `compose-stats.ts` as is.
 *
 * outerpedia cannot import this repo's code, so the comparison runs on a JSON
 * snapshot: for every character of the data contract, at every level the wiki
 * sheet shows (1, each evolution rung, 100 and the max level of each limit
 * break step), two sheets computed by `composeCharStats` — the very function
 * the solver uses (`apps/renderer/src/lib/solver/engine.ts`):
 *
 *   - `white` : base + evolution only (`intrinsicStats` with every Geas node
 *     at Lv 0 and codex 0) — the white portion of the in-game sheet;
 *   - `full`  : every permanent layer at max (`noGearStats` with max
 *     TransStar, codex, Geas and skill levels) — the unequipped sheet.
 *
 * Both are emitted with the LB step that level requires (lv ≤ 100 → step 0,
 * otherwise the smallest step of `char-level-max.json` whose `maxLevel`
 * reaches it) and that step's `statModifierAfter100`, exactly like the
 * engine resolves a captured hero.
 *
 * Provenance (this repo's commit, the data `version.json`, the game resVersion
 * when known) is written next to the values so the consumer can tell which
 * formulas and which tables produced them.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeCharStats } from "../packages/core/src/compose-stats.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Levels of the wiki sheet: lv 1, the evolution rungs, then the LB caps. */
export const ORACLE_LEVELS = [1, 20, 40, 60, 80, 100, 105, 110, 120];

/** Column order of every per-level row (engine keys, display units). */
export const ORACLE_STATS = ["atk", "def", "hp", "spd", "chc", "chd", "pen", "dmgInc", "dmgRed", "eff", "res"];

/** LB step a character needs to stand at `level`: 0 up to lv 100, else the
 *  smallest step whose `maxLevel` reaches it. Null when the table has no
 *  such step (level out of reach for this star). */
export function lbStepFor(charLevelMax, star, level) {
  if (level <= 100) return 0;
  const steps = Object.entries(charLevelMax)
    .map(([k, v]) => ({ star: Number(k.split("|")[0]), step: Number(k.split("|")[1]), ...v }))
    .filter((s) => s.star === star && s.maxLevel >= level)
    .sort((a, b) => a.step - b.step);
  return steps.length ? steps[0].step : null;
}

const row = (stats) => ORACLE_STATS.map((k) => stats[k]);

/** Build the oracle object from a solver data dir's three tables. Pure. */
export function buildOracle({ characters, codexCurve, charLevelMax }) {
  const out = {};
  for (const id of Object.keys(characters).sort()) {
    const meta = characters[id];
    if (!meta?.ingredients || meta.star == null) continue;
    const white = {};
    const full = {};
    for (const level of ORACLE_LEVELS) {
      const levelMaxStep = lbStepFor(charLevelMax, meta.star, level);
      if (levelMaxStep == null) continue;
      const levelMaxModifier = levelMaxStep > 0
        ? (charLevelMax[`${meta.star}|${levelMaxStep}`]?.statModifierAfter100 ?? 0)
        : 0;
      const common = { level, levelMaxStep, levelMaxModifier };
      // White: no Geas node unlocked (empty map, not null — null means "max"),
      // codex 0. TransStar stays at max: it only gates which evolution rows
      // count, and the wiki sheet applies every rung reached by the level.
      white[level] = row(composeCharStats(meta.ingredients, codexCurve, {
        ...common, userGeasLevels: {}, codexLevel: 0,
      }).intrinsicStats);
      // Full: every option left to its max default (TransStar, codex, Geas,
      // S1/S2/S3 levels).
      full[level] = row(composeCharStats(meta.ingredients, codexCurve, common).noGearStats);
    }
    out[id] = { name: meta.name, ...(meta.nickname ? { nickname: meta.nickname } : {}), white, full };
  }
  return out;
}

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Game resVersion: explicit flag, else the outerpedia checkout's
 *  `data/generated/game-version.json` (OUTERPEDIA_PATH, else a sibling repo). */
function findResVersion(explicit) {
  if (explicit) return explicit;
  const candidates = [process.env.OUTERPEDIA_PATH, join(ROOT, "..", "outerpedia")].filter(Boolean);
  for (const dir of candidates) {
    const p = join(dir, "data", "generated", "game-version.json");
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8")).resVersion ?? null;
      } catch { /* unreadable — try the next one */ }
    }
  }
  return null;
}

/** One row per line: diffable, and already in the shape prettier keeps. */
function serialize(oracle) {
  const lines = ["{", '  "provenance": {'];
  const prov = Object.entries(oracle.provenance);
  prov.forEach(([k, v], i) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < prov.length - 1 ? "," : ""}`));
  lines.push("  },");
  lines.push(`  "levels": [${oracle.levels.join(", ")}],`);
  lines.push(`  "stats": [${oracle.stats.map((s) => JSON.stringify(s)).join(", ")}],`);
  lines.push('  "characters": {');
  const ids = Object.keys(oracle.characters);
  ids.forEach((id, i) => {
    const c = oracle.characters[id];
    lines.push(`    ${JSON.stringify(id)}: {`);
    lines.push(`      "name": ${JSON.stringify(c.name)},`);
    if (c.nickname) lines.push(`      "nickname": ${JSON.stringify(c.nickname)},`);
    for (const part of ["white", "full"]) {
      lines.push(`      ${JSON.stringify(part)}: {`);
      const lvls = Object.keys(c[part]);
      lvls.forEach((lv, j) => {
        lines.push(`        ${JSON.stringify(lv)}: [${c[part][lv].join(", ")}]${j < lvls.length - 1 ? "," : ""}`);
      });
      lines.push(`      }${part === "white" ? "," : ""}`);
    }
    lines.push(`    }${i < ids.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataDir = resolve(arg("--data") ?? join(ROOT, "data", "derived"));
  const read = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
  const version = read("version.json");
  const characters = buildOracle({
    characters: read("characters.json"),
    codexCurve: read("codex-curve.json"),
    charLevelMax: read("char-level-max.json"),
  });
  const dirty = git("status --porcelain -- packages/core/src scripts/export-wiki-oracle.mjs");
  const oracle = {
    provenance: {
      generator: "gear-solver scripts/export-wiki-oracle.mjs (composeCharStats)",
      gearSolverCommit: git("rev-parse HEAD"),
      gearSolverDirty: dirty == null ? null : dirty.length > 0,
      dataHash: version.hash ?? null,
      dataBuiltAt: version.builtAt ?? null,
      resVersion: findResVersion(arg("--res-version")),
    },
    levels: ORACLE_LEVELS,
    stats: ORACLE_STATS,
    characters,
  };
  const text = serialize(oracle);
  const out = arg("--out");
  if (out) {
    writeFileSync(resolve(out), text);
    console.error(`wiki oracle: ${Object.keys(characters).length} characters → ${out}`);
  } else {
    process.stdout.write(text);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
