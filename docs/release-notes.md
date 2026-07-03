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

## [1.5.2] — 2026-07-03

- **The solver now respects your Worklist** — pieces already reserved by a queued
  build are treated as if equipped on that hero. Solving your next hero won't
  propose gear a higher-priority hero's pending build has claimed (same
  priority-rank rules as for actually-equipped gear).
- **"Maxed only" reworked** — it now means *no extrapolation*: the solver only
  uses pieces already at the selected reforge mode's investment level (or
  better), scored on their real rolls. Off: any piece as-is · +10R6: +10 with 6+
  reforges · +10R9: +10 with 9+ reforges · +15R9: +15 with 9+ reforges.
  Previously it always demanded +15, which wrongly excluded +10 endgame gear.
- Fixed the "≤ Lower" button wrapping onto two lines in the Options panel.
- **Top % now defaults to 60** (was 30) — the search covers twice as many
  combinations out of the box, so the best builds show up without having to
  stack stat filters first. Set it to 100 for a fully exhaustive search.

## [1.5.1] — 2026-07-03

_Nothing yet — user-facing notes for the next release go here._

## [1.5.0] — 2026-07-03

_Nothing yet — user-facing notes for the next release go here._

## [1.4.0] — 2026-07-02

- **Solver honours demanding stat minimums** — setting a high minimum (e.g. a
  steep Effectiveness or Speed floor) no longer returns "no builds" when a valid
  build actually exists. The pre-search filtering was dropping the very pieces
  needed to reach the floor; it now keeps them.
- **Clearer roster sort in Builds** — a "Sort: CP / Rank" selector makes both
  orderings explicit (CP was the default hidden behind a single toggle).

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
