#!/usr/bin/env node
/**
 * One-shot release for the desktop app.
 *
 *   npm run release                # patch bump (0.1.1 → 0.1.2)
 *   npm run release minor          # minor bump (0.1.1 → 0.2.0)
 *   npm run release major          # major bump (0.1.1 → 1.0.0)
 *   npm run release 0.5.0          # explicit version
 *   npm run release patch -- --dry-run    # show plan, no side effects
 *   npm run release -- --force --no-undraft   # skip safety checks / leave as draft
 *
 * Pipeline (each step quits on failure — re-run safe once you fixed the
 * blocker since version bump is the first idempotency-breaker):
 *   1. Pre-checks (clean git tree, GH_TOKEN set, gh CLI present)
 *   2. Bump apps/desktop/package.json (this version drives the tag + the
 *      installer filename + the electron-updater compare)
 *   3. Regenerate data/derived/* (passives, gems, multi-tier, EE labels…)
 *   4. Build web + desktop TS
 *   5. electron-builder --publish always → uploads installer + latest.yml
 *      to a DRAFT release on GitHub (provider config in apps/desktop pkg)
 *   6. git add + commit "chore: release vX.Y.Z" + tag + push (--follow-tags)
 *   7. Promote the draft to a live release via gh (skip with --no-undraft)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESKTOP_PKG = join(ROOT, "apps", "desktop", "package.json");

// ── small helpers ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const DRY_RUN = flag("--dry-run");
const FORCE = flag("--force");
const NO_UNDRAFT = flag("--no-undraft");
const bumpArg = args.find((a) => !a.startsWith("--")) ?? "patch";

const step = (n, msg) => console.log(`\n\x1b[36m[${n}/7]\x1b[0m \x1b[1m${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const skip = (msg) => console.log(`  \x1b[90m↷ ${msg}\x1b[0m`);
const die = (msg, hint) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  if (hint) console.error(`  \x1b[90m${hint}\x1b[0m`);
  process.exit(1);
};

function run(cmd, opts = {}) {
  if (DRY_RUN) {
    console.log(`  \x1b[90m$ ${cmd}\x1b[0m`);
    return "";
  }
  return execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", cwd: ROOT, ...opts }).toString();
}
function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

// ── version arithmetic ─────────────────────────────────────────────────
function bumpVersion(current, kind) {
  // Explicit X.Y.Z passes through (matches npm convention).
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) die(`Cannot parse current version: ${current}`);
  let [major, minor, patch] = [+m[1], +m[2], +m[3]];
  if (kind === "patch") patch++;
  else if (kind === "minor") { minor++; patch = 0; }
  else if (kind === "major") { major++; minor = 0; patch = 0; }
  else die(`Invalid bump argument: ${kind}`, "expected patch | minor | major | X.Y.Z");
  return `${major}.${minor}.${patch}`;
}

// ── PRE-CHECKS ─────────────────────────────────────────────────────────
step(1, "Pre-checks");

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  die(
    "GH_TOKEN / GITHUB_TOKEN not set in environment",
    "Generate a PAT with `repo` scope at https://github.com/settings/tokens, then `export GH_TOKEN=ghp_...`",
  );
}
ok("GH_TOKEN present");

try { runSilent("gh --version"); ok("gh CLI present"); }
catch { skip("gh CLI not found — auto-undraft step will be skipped (install at https://cli.github.com)"); }

const gitStatus = runSilent("git status --porcelain");
if (gitStatus && !FORCE) {
  die(
    "Working tree has uncommitted changes",
    "Commit or stash them first, or re-run with --force to release on top of a dirty tree.",
  );
}
ok(gitStatus ? "Working tree dirty (--force in effect)" : "Working tree clean");

const branch = runSilent("git rev-parse --abbrev-ref HEAD");
ok(`On branch ${branch}`);

// ── BUMP ───────────────────────────────────────────────────────────────
const pkgJson = JSON.parse(readFileSync(DESKTOP_PKG, "utf-8"));
const fromVersion = pkgJson.version;
const toVersion = bumpVersion(fromVersion, bumpArg);
const tag = `v${toVersion}`;

step(2, `Bump version  ${fromVersion} → \x1b[33m${toVersion}\x1b[0m  (tag ${tag})`);

if (toVersion === fromVersion) die(`Target version equals current (${fromVersion}) — nothing to do.`);

// Verify the tag doesn't already exist on GitHub (electron-builder would still
// publish but conflicts confuse the user).
try {
  runSilent(`gh release view ${tag} --json url -q .url`);
  die(`Release ${tag} already exists on GitHub`, "Pick a different version or delete the existing release first.");
} catch {
  // 404 expected — no existing release.
}

if (!DRY_RUN) {
  pkgJson.version = toVersion;
  writeFileSync(DESKTOP_PKG, JSON.stringify(pkgJson, null, 2) + "\n");
}
ok(`apps/desktop/package.json updated`);

// ── DATA REBUILD ───────────────────────────────────────────────────────
step(3, "Regenerate derived game data");
run("node data/build.mjs");

// ── BUILD ──────────────────────────────────────────────────────────────
step(4, "Build web + desktop TS");
run("npm run desktop:build");

// ── PUBLISH (electron-builder) ─────────────────────────────────────────
step(5, "Build installer + upload to GitHub (draft)");
// `electron-builder --publish always` reads `publish` block from apps/desktop
// package.json (provider: github / Sevih / gear-solver). Default releaseType
// is draft — we promote it in step 7.
run("npm run publish -w @gear-solver/desktop");

// ── COMMIT + PUSH ──────────────────────────────────────────────────────
step(6, `Commit + tag ${tag} + push`);
run(`git add apps/desktop/package.json`);
const commitMsg = `chore: release ${tag}`;
run(`git commit -m "${commitMsg}"`);
run(`git tag ${tag}`);
run(`git push --follow-tags origin ${branch}`);

// ── UNDRAFT ────────────────────────────────────────────────────────────
step(7, NO_UNDRAFT ? "Skip undraft (--no-undraft)" : "Promote draft → release");
if (NO_UNDRAFT) {
  skip("Draft left as-is — promote manually on GitHub when ready.");
} else {
  try { runSilent("gh --version"); }
  catch {
    skip("gh CLI not installed — promote manually at https://github.com/Sevih/gear-solver/releases");
    process.exit(0);
  }
  // --latest flips the "Latest release" badge on GitHub, which is what
  // electron-updater clients check via latest.yml.
  run(`gh release edit ${tag} --draft=false --latest`);
}

console.log(`\n\x1b[32m✓ Release ${tag} published.\x1b[0m`);
console.log(`  https://github.com/Sevih/gear-solver/releases/tag/${tag}`);
