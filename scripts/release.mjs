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
 *   7. Promote the draft to a live release via gh + post the curated,
 *      player-facing notes from docs/release-notes.md ([Unreleased] section).
 *      Falls back to the `${prevTag}..HEAD~1` commit log when that section is
 *      empty (skip undraft with --no-undraft to edit the body manually).
 */
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESKTOP_PKG = join(ROOT, "apps", "desktop", "package.json");
// Two version-anchored journals, both stamped at release:
//  - release-notes.md = curated, English, PLAYER-facing → source of the GitHub notes.
//  - changelog.md     = detailed, French, DEV-facing engineering journal (not published).
const RELEASE_NOTES = join(ROOT, "docs", "release-notes.md");
const CHANGELOG = join(ROOT, "docs", "changelog.md");
const NOTES_PLACEHOLDER = "_Nothing yet — user-facing notes for the next release go here._";
const CHANGELOG_PLACEHOLDER = "_(rien en attente — les nouvelles entrées de session se mettent ici)_";

/** Read the body under `## [Unreleased]` (until the next `## ` heading),
 *  excluding the italic placeholder. Returns "" when there's only a placeholder
 *  (nothing real to release-note). This is the curated, hand-written copy —
 *  preferred over raw commit subjects for the GitHub release body. */
function readUnreleasedNotes(path) {
  let text;
  try { text = readFileSync(path, "utf-8"); } catch { return ""; }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+\[Unreleased\]/i.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  // A lone italic placeholder (`_…_`, no real `- `/`### ` entry) counts as empty.
  if (!body || (!/^(###\s|[-*]\s)/m.test(body) && body.startsWith("_"))) return "";
  return body;
}

/** Stamp a version-anchored journal at release time: turn its `## [Unreleased]`
 *  content into a `## [X.Y.Z] — date` section and leave a fresh, empty
 *  Unreleased on top (with its own placeholder). */
function stampUnreleased(path, version, dateStr, placeholder) {
  let text;
  try { text = readFileSync(path, "utf-8"); } catch { return; }
  const stamped = text.replace(
    /^##\s+\[Unreleased\][^\n]*\n/m,
    `## [Unreleased]\n\n${placeholder}\n\n## [${version}] — ${dateStr}\n`,
  );
  writeFileSync(path, stamped);
}

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
  // `stdio: "inherit"` lets the child stream straight to the user's terminal
  // (essential for npm/electron-builder progress bars) BUT it makes execSync
  // return `null` instead of a Buffer — guard against that since we never
  // need the captured output in inherit mode.
  const buf = execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", cwd: ROOT, ...opts });
  return buf ? buf.toString() : "";
}
function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

/** Restore the bumped version when a later step blows up — keeps the local
 *  package.json in sync with what's actually been published. The caller
 *  hands us the pre-bump version snapshot; we rewrite the file in place. */
function restoreVersion(pkgPath, pristineVersion) {
  try {
    const j = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (j.version !== pristineVersion) {
      j.version = pristineVersion;
      writeFileSync(pkgPath, JSON.stringify(j, null, 2) + "\n");
      console.error(`  \x1b[90m↻ Reverted apps/desktop/package.json to ${pristineVersion}\x1b[0m`);
    }
  } catch {
    console.error(`  \x1b[33m! Could not auto-revert version — restore manually: ${pristineVersion}\x1b[0m`);
  }
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

// Snapshot the previous release tag NOW (before we create the new one) so
// step 7 can build release notes from the commit range. `--match v*` skips
// any non-release tags that might have been created manually.
let prevTag = null;
try {
  prevTag = runSilent("git describe --tags --abbrev=0 --match v*");
  ok(`Previous release: ${prevTag}`);
} catch {
  skip("No previous release tag — notes will cover full history");
}

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

// Curated, player-facing notes come from release-notes.md's [Unreleased]
// section. Read it BEFORE stamping (stamping renames the heading), then stamp
// BOTH journals so the release commit carries them version-anchored.
const dateStr = new Date().toISOString().slice(0, 10);
const unreleasedBody = readUnreleasedNotes(RELEASE_NOTES);
if (!DRY_RUN) {
  pkgJson.version = toVersion;
  writeFileSync(DESKTOP_PKG, JSON.stringify(pkgJson, null, 2) + "\n");
  stampUnreleased(RELEASE_NOTES, toVersion, dateStr, NOTES_PLACEHOLDER);
  stampUnreleased(CHANGELOG, toVersion, dateStr, CHANGELOG_PLACEHOLDER);
}
ok(`apps/desktop/package.json updated`);
ok(unreleasedBody
  ? `release-notes [Unreleased] → [${toVersion}] (will be the release notes)`
  : `release-notes has no [Unreleased] entries — notes fall back to the commit log`);

// Past this point a failure leaves the local package.json bumped but with
// no matching artefact. We track when GitHub state becomes real (step 5
// onwards) so the catch block only auto-reverts BEFORE that — once the
// release exists on GitHub, reverting locally would just desync things.
let releasedToGitHub = false;
try {
  // ── DATA REBUILD ─────────────────────────────────────────────────────
  step(3, "Regenerate derived game data");
  run("node data/build.mjs");

  // ── BUILD ────────────────────────────────────────────────────────────
  step(4, "Build web + desktop TS");
  run("npm run desktop:build");

  // ── PUBLISH (electron-builder) ───────────────────────────────────────
  step(5, "Build installer + upload to GitHub (draft)");
  // `electron-builder --publish always` reads `publish` block from apps/desktop
  // package.json (provider: github / Sevih / gear-solver). Default releaseType
  // is draft — we promote it in step 7.
  run("npm run publish -w @gear-solver/desktop");
  releasedToGitHub = true;

  // ── COMMIT + PUSH ────────────────────────────────────────────────────
  step(6, `Commit + tag ${tag} + push`);
  // Stage the version bump AND the derived-data snapshot this release built +
  // published (step 3). The idempotent `version.json` write means this is a
  // no-op unless the game data genuinely changed since the last commit — in
  // which case the whole consistent `data/derived` set lands in the release
  // commit instead of being left dirty in the tree.
  run(`git add apps/desktop/package.json data/derived docs/release-notes.md docs/changelog.md`);
  const commitMsg = `chore: release ${tag}`;
  run(`git commit -m "${commitMsg}"`);
  run(`git tag ${tag}`);
  run(`git push --follow-tags origin ${branch}`);

  // ── UNDRAFT + RELEASE NOTES ──────────────────────────────────────────
  step(7, NO_UNDRAFT ? "Skip undraft (--no-undraft)" : "Promote draft → release + write notes");
  if (NO_UNDRAFT) {
    skip("Draft left as-is — promote manually on GitHub when ready.");
  } else {
    let hasGh = true;
    try { runSilent("gh --version"); } catch { hasGh = false; }
    if (!hasGh) {
      skip("gh CLI not installed — promote manually at https://github.com/Sevih/gear-solver/releases");
    } else {
      // Release notes: prefer the curated player-facing notes (release-notes.md
      // [Unreleased] section, captured before stamping). Fall back to the commit
      // subjects when that section had nothing staged.
      let notesBody = "";
      if (unreleasedBody) {
        notesBody = `${unreleasedBody}\n`;
        if (prevTag) notesBody += `\n**Full changelog:** https://github.com/Sevih/gear-solver/compare/${prevTag}...${tag}\n`;
      } else {
        // `HEAD~1` excludes the `chore: release ${tag}` commit (plumbing). Falls
        // back to the whole history when there's no previous tag (first release).
        const range = prevTag ? `${prevTag}..HEAD~1` : "HEAD~1";
        try {
          const log = runSilent(`git log ${range} --pretty=format:%s`);
          const lines = log.split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .filter((l) => !/^chore: release/i.test(l))            // shouldn't appear, defensive
            .filter((l) => !/^Merge (branch|pull request)/i.test(l)) // drop merge noise
            .map((l) => `- ${l.replace(/\s*\[no-discord\]\s*$/i, "")}`); // strip outerpedia tag
          if (lines.length > 0) {
            notesBody = `## What's new in ${tag}\n\n${lines.join("\n")}\n`;
            if (prevTag) {
              notesBody += `\n**Full changelog:** https://github.com/Sevih/gear-solver/compare/${prevTag}...${tag}\n`;
            }
          }
        } catch (err) {
          console.error(`  \x1b[33m! Couldn't gather commit log: ${err?.message ?? err}\x1b[0m`);
        }
      }
      const NOTES_FILE = join(ROOT, ".release-notes.tmp.md");
      const hasNotes = notesBody.length > 0;
      if (hasNotes) {
        writeFileSync(NOTES_FILE, notesBody, "utf-8");
        // --notes-file dodges shell escaping of multi-line / quoted content.
        run(`gh release edit ${tag} --draft=false --latest --notes-file "${NOTES_FILE}"`);
        try { unlinkSync(NOTES_FILE); } catch { /* best-effort cleanup */ }
        ok(`Release notes posted (${notesBody.split("\n").length - 4} commits)`);
      } else {
        // No commits in range → just flip the draft. The user can fill the
        // body in manually if they want.
        run(`gh release edit ${tag} --draft=false --latest`);
        skip("Empty commit range — release published without auto-notes");
      }
    }
  }

  console.log(`\n\x1b[32m✓ Release ${tag} published.\x1b[0m`);
  console.log(`  https://github.com/Sevih/gear-solver/releases/tag/${tag}`);
} catch (err) {
  console.error(`\n\x1b[31m✗ Release pipeline aborted.\x1b[0m`);
  if (err?.message) console.error(`  ${err.message.split("\n")[0]}`);
  if (!DRY_RUN) {
    if (releasedToGitHub) {
      console.error(`  \x1b[33m! Release ${tag} already exists on GitHub — fix the issue and finish manually:\x1b[0m`);
      console.error(`  \x1b[90m    git add apps/desktop/package.json && git commit -m "chore: release ${tag}" && git tag ${tag} && git push --follow-tags\x1b[0m`);
      console.error(`  \x1b[90m    gh release edit ${tag} --draft=false --latest\x1b[0m`);
    } else {
      restoreVersion(DESKTOP_PKG, fromVersion);
    }
  }
  process.exit(1);
}
