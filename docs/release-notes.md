# Release notes — Outerpedia Gear Solver

> **Player-facing notes**, in English. This is the source the release script
> publishes to GitHub. Keep it short and about what changed for the *user* — no
> file names, no test counts, no dev tooling. The detailed engineering journal
> lives in [changelog.md](changelog.md) (French).
>
> Write the next version's notes under **`## [Unreleased]`** as you ship; the
> release script stamps it into `## [X.Y.Z] — date` and posts it on GitHub.

---

## [Unreleased]

_Nothing yet — user-facing notes for the next release go here._

## [1.3.0] — 2026-06-30

- **Readable Worklist** — each pending gear change now shows the item's image,
  its stats, and where that piece currently lives (on which hero, or in your
  inventory). The item name alone wasn't enough to tell similar copies apart.
- **More reliable first capture** — capture now waits longer for the game to
  reach the lobby, so a slow first launch (patch + login) no longer times out.
- **Solve always starts on "Solve"** — the button no longer remembers a previous
  "Solve CP"; every session opens on the default mode.
- **Damage / +1% ties highlighted** — when several stats give the same damage
  gain, they're all highlighted, not just one.
