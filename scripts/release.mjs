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
 * blocker: a failure before the step-6 upload succeeds reverts the version
 * bump and both journal stamps):
 *   1. Pre-checks (clean git tree, GH_TOKEN set, gh CLI present, .NET SDK
 *      `dotnet` on the PATH)
 *   2. Bump apps/desktop/package.json (this version drives the tag + the
 *      installer filename + the electron-updater compare) and stamp
 *      docs/release-notes.md + docs/changelog.md
 *   3. Regenerate data/derived/* (passives, gems, multi-tier, EE labels…)
 *   4. Checks: typecheck, tests, lint (after the data refresh, so the tests
 *      run against the tables the installer will ship)
 *   5. Rebuild the capture plugin DLL (fetch-binaries: dotnet build, version
 *      checked against Plugin.Version, staged in resources/capture-steam/ for
 *      extraResources), then build web + desktop TS
 *   6. electron-builder --win --linux --publish always → uploads the Windows
 *      installer + latest.yml and the Linux AppImage + latest-linux.yml to
 *      the same DRAFT release on GitHub (provider config in apps/desktop pkg);
 *      fails when either artifact is missing
 *   7. git add + commit "chore: release vX.Y.Z" + tag + push (--follow-tags)
 *   8. Promote the draft to a live release via gh + post the curated,
 *      player-facing notes from docs/release-notes.md ([Unreleased] section).
 *      Falls back to the `${prevTag}..HEAD~1` commit log when that section is
 *      empty (skip undraft with --no-undraft to edit the body manually).
 *
 * Env:
 *   GH_TOKEN / GITHUB_TOKEN   required — electron-builder publish + gh.
 *   VT_API_KEY                optional — when set, step 6 auto-submits the
 *                             installer and the AppImage to VirusTotal and
 *                             folds both scan links into the release notes. Get a free key at
 *                             https://www.virustotal.com/gui/my-apikey
 *                             (free tier: 4 req/min, 500/day — ample per release).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DESKTOP_PKG = join(ROOT, "apps", "desktop", "package.json");
// electron-builder drops the installer and the AppImage here
// (directories.output in the desktop package.json). We hash them post-build so
// the release notes can publish a verifiable SHA-256 — the app isn't
// code-signed, so a hash users can check is the next best integrity signal.
const INSTALLER_DIR = join(ROOT, "apps", "desktop", "release");
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

const step = (n, msg) => console.log(`\n\x1b[36m[${n}/8]\x1b[0m \x1b[1m${msg}\x1b[0m`);
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

/** Rewrite the journals stamped in step 2 with their pre-stamp text when a
 *  later step blows up before anything reached GitHub — same contract as
 *  restoreVersion. `snapshots` maps each path to its pristine text (null when
 *  the file couldn't be read, i.e. nothing was stamped). */
function restoreJournals(snapshots) {
  for (const [path, pristine] of snapshots) {
    if (pristine === null) continue;
    const name = relative(ROOT, path).replace(/\\/g, "/");
    try {
      if (readFileSync(path, "utf-8") !== pristine) {
        writeFileSync(path, pristine);
        console.error(`  \x1b[90m↻ Reverted ${name} to its pre-release text\x1b[0m`);
      }
    } catch {
      console.error(`  \x1b[33m! Could not auto-revert ${name} — restore it with git\x1b[0m`);
    }
  }
}

/** The two artifacts every release ships, matched in INSTALLER_DIR on the
 *  version right before the extension, so neither a stale file from a previous
 *  release nor a pre-release build of the same version (`1.20.0-g37`,
 *  `1.20.0-private.1`) in the same dir is ever picked. */
const ARTIFACTS = [
  { label: "Windows installer", platform: "Windows", match: (f, v) => /setup/i.test(f) && f.endsWith(` ${v}.exe`) },
  { label: "Linux AppImage", platform: "Linux", match: (f, v) => f.endsWith(`-${v}.AppImage`) },
];

/** Find the artifacts electron-builder just produced for `version` and return
 *  `{ label, platform, name, sha256 }` for each one found (none in dry-run). */
function hashArtifacts(version) {
  let entries;
  try { entries = readdirSync(INSTALLER_DIR); } catch { return []; }
  return ARTIFACTS.flatMap(({ label, platform, match }) => {
    const name = entries.find((f) => match(f, version));
    if (!name) return [];
    const sha256 = createHash("sha256").update(readFileSync(join(INSTALLER_DIR, name))).digest("hex");
    return [{ label, platform, name, sha256 }];
  });
}

/** Best-effort upload of one freshly-built artifact to VirusTotal (v3 API).
 *  Needs VT_API_KEY in the env; returns `{ guiUrl }` on a successful submit,
 *  else null. NEVER throws — a VT hiccup must not fail a release. Uses the
 *  large-file `upload_url` flow since both artifacts (~100 MB) are over VT's
 *  32 MB direct-upload cap. The GUI page is keyed by SHA-256 and resolves
 *  once the (possibly queued) analysis lands. */
async function submitToVirusTotal(installer) {
  if (!installer) return null;
  const key = process.env.VT_API_KEY;
  if (!key) { skip("VT_API_KEY not set — skipping VirusTotal auto-submit"); return null; }
  if (DRY_RUN) { skip("dry-run — skipping VirusTotal submit"); return null; }
  try {
    const buf = readFileSync(join(INSTALLER_DIR, installer.name));
    // 1. Large files require a one-time upload URL.
    const urlRes = await fetch("https://www.virustotal.com/api/v3/files/upload_url", { headers: { "x-apikey": key } });
    if (!urlRes.ok) throw new Error(`upload_url HTTP ${urlRes.status}`);
    const uploadUrl = (await urlRes.json()).data;
    // 2. Multipart upload of the file.
    const form = new FormData();
    form.append("file", new Blob([buf]), installer.name.replace(/ /g, "-"));
    const upRes = await fetch(uploadUrl, { method: "POST", headers: { "x-apikey": key }, body: form });
    if (!upRes.ok) throw new Error(`upload HTTP ${upRes.status}`);
    const guiUrl = `https://www.virustotal.com/gui/file/${installer.sha256}`;
    ok(`Submitted ${installer.name} to VirusTotal → ${guiUrl}`);
    return { guiUrl };
  } catch (err) {
    console.error(`  \x1b[33m! VirusTotal submit failed (non-fatal): ${err?.message ?? err}\x1b[0m`);
    return null;
  }
}

/** Markdown block appended to the release notes so users can verify the
 *  unsigned downloads: per artifact, its download link, SHA-256, the command
 *  that checks it and the VirusTotal scan when the submit succeeded (`vt` on
 *  the artifact). Empty string when none was found. The GitHub asset name
 *  replaces spaces with hyphens (electron-builder sanitizes the upload), so we
 *  show that — it's what the user actually downloads. */
function integrityNote(artifacts, tag) {
  if (artifacts.length === 0) return "";
  const lines = [
    "",
    "---",
    "",
    "**Verify your download** (nothing is code-signed, so Windows/AV may warn — see the README):",
    "",
  ];
  for (const a of artifacts) {
    const downloadName = a.name.replace(/ /g, "-");
    const check = a.platform === "Windows"
      ? ["```powershell", `Get-FileHash ".\\${downloadName}" -Algorithm SHA256`, "```"]
      : ["```bash", `sha256sum "${downloadName}"`, "```"];
    lines.push(
      `**${a.label}** — [${downloadName}](https://github.com/Sevih/gear-solver/releases/download/${tag}/${downloadName})`,
      "",
      "```",
      `SHA-256: ${a.sha256}`,
      "```",
      "",
      ...check,
      "",
    );
    if (a.vt?.guiUrl) lines.push(`🔍 **VirusTotal scan:** ${a.vt.guiUrl}`, "");
  }
  return lines.join("\n");
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

// Step 5 rebuilds the bundled capture plugin: without the SDK the installer
// would ship whatever DLL is lying in the (git-ignored) resources folder.
try { ok(`dotnet ${runSilent("dotnet --version")} present`); }
catch {
  die(
    "dotnet not found on the PATH — the capture plugin can't be rebuilt",
    "Install the .NET SDK (8+) and make sure `dotnet --version` works; the game must be installed too (the plugin compiles against it).",
  );
}

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
// step 8 can build release notes from the commit range. `--match v*` skips
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
// Pre-stamp text of both journals, rewritten by the catch below on a failure
// before publication (the stamp is otherwise left behind in the tree).
const journalSnapshots = [RELEASE_NOTES, CHANGELOG].map((path) => {
  try { return [path, readFileSync(path, "utf-8")]; } catch { return [path, null]; }
});
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
// no matching artefact. We track when GitHub state becomes real (step 6
// onwards) so the catch block only auto-reverts BEFORE that — once the
// release exists on GitHub, reverting locally would just desync things.
let releasedToGitHub = false;
try {
  // ── DATA REFRESH ─────────────────────────────────────────────────────
  step(3, "Refresh derived game data from the outerpedia checkout");
  run("node data/sync.mjs");

  // ── CHECKS ───────────────────────────────────────────────────────────
  // After the data refresh, so the tests (contract shape, oracles) run against
  // the derived tables the installer is about to ship. A failure lands in the
  // catch below, before anything is published.
  step(4, "Checks: typecheck + tests + lint");
  run("npm run typecheck");
  run("npm test");
  run("npm run lint");

  // ── BUILD ────────────────────────────────────────────────────────────
  // Plugin first: a missing game or a version mismatch fails in seconds, before
  // the longer web build.
  step(5, "Rebuild capture plugin + build web + desktop TS");
  run("npm run fetch-binaries -w @gear-solver/desktop");
  run("npm run desktop:build");

  // ── PUBLISH (electron-builder) ───────────────────────────────────────
  step(6, "Build installer + AppImage + upload to GitHub (draft)");
  // `electron-builder --publish always` reads `publish` block from apps/desktop
  // package.json (provider: github / Sevih / gear-solver). Default releaseType
  // is draft — we promote it in step 8. Both targets in one run, so they land
  // in the same release with latest.yml and latest-linux.yml; the NSIS build
  // goes through Wine on Linux.
  run("npm run dist -w @gear-solver/desktop -- --win --linux --publish always");
  releasedToGitHub = true;

  // Hash the freshly-built artifacts so step 8 can publish a verifiable
  // SHA-256 for each alongside the notes. A release missing one of them would
  // leave a platform without its update: stop (the catch prints how to finish).
  const artifacts = hashArtifacts(toVersion);
  if (!DRY_RUN) {
    const missing = ARTIFACTS.filter(({ label }) => !artifacts.some((a) => a.label === label)).map(({ label }) => label);
    if (missing.length) throw new Error(`${missing.join(" + ")} for ${toVersion} not found in ${relative(ROOT, INSTALLER_DIR)}`);
  }
  for (const a of artifacts) ok(`${a.label} SHA-256: ${a.sha256}`);

  // Auto-submit to VirusTotal (best-effort; adds the scan links to the notes).
  for (const a of artifacts) a.vt = await submitToVirusTotal(a);

  // ── COMMIT + PUSH ────────────────────────────────────────────────────
  step(7, `Commit + tag ${tag} + push`);
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
  step(8, NO_UNDRAFT ? "Skip undraft (--no-undraft)" : "Promote draft → release + write notes");
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
        notesBody += integrityNote(artifacts, tag);
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
            notesBody += integrityNote(artifacts, tag);
          }
        } catch (err) {
          console.error(`  \x1b[33m! Couldn't gather commit log: ${err?.message ?? err}\x1b[0m`);
        }
      }
      // Even with no curated notes and an empty commit range, still publish the
      // checksum block so every release carries a verifiable hash.
      if (!notesBody && artifacts.length) notesBody = `## ${tag}\n${integrityNote(artifacts, tag)}`;
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
  for (const a of artifacts) console.log(`  ${a.label}: ${a.name.replace(/ /g, "-")}`);
} catch (err) {
  console.error(`\n\x1b[31m✗ Release pipeline aborted.\x1b[0m`);
  if (err?.message) console.error(`  ${err.message.split("\n")[0]}`);
  if (!DRY_RUN) {
    if (releasedToGitHub) {
      console.error(`  \x1b[33m! Release ${tag} already exists on GitHub — fix the issue and finish manually:\x1b[0m`);
      console.error(`  \x1b[90m    git add apps/desktop/package.json data/derived docs/release-notes.md docs/changelog.md && git commit -m "chore: release ${tag}" && git tag ${tag} && git push --follow-tags\x1b[0m`);
      console.error(`  \x1b[90m    gh release edit ${tag} --draft=false --latest\x1b[0m`);
    } else {
      restoreVersion(DESKTOP_PKG, fromVersion);
      restoreJournals(journalSnapshots);
    }
  }
  process.exit(1);
}
