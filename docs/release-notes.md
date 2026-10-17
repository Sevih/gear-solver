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

## [1.10.0] — 2026-10-17

- **Emulator capture removed.** OUTERPLANE is on Steam, so the app now captures only through
  the Steam plugin; importing your files by hand still works. Settings → Setup no longer asks
  for a source, and an earlier "Emulator" choice simply reads as Steam.
- **Cleanup.** On first launch the app deletes the capture certificate it had generated for the
  emulator (private key included), the downloaded mitmproxy and its own emulator leftovers;
  your snapshots stay.
- **If you used an emulator:** the certificate the app had trusted there lived only until the
  instance restarted — restart it once and it's gone. The pushed files (`/sdcard/c8750f0d.0`,
  `/sdcard/bind_cert.sh`, `/sdcard/redir.sh`) can be deleted by hand, and you can turn the
  emulator's Root setting back off.

## [1.9.0] — 2026-10-16

- **Set bonuses follow the game's rule.** A set mixing Breakthrough 4 and lower pieces now
  gets the bonus the game gives: the 2-piece reads the level of your 2 best pieces, the
  4-piece the level of your 4 best (Attack 4/4/3: 35 %, not 30 %). Speed, Penetration and
  Bursting no longer stack their 2-piece on top of a lower-level 4-piece. The solver also
  stops discarding a better Breakthrough 4 piece in favour of a lower one of the same set.
- **Combat-effect sets no longer inflate CP.** Pulverization, Weakness, Augmentation and the
  Immunity 4-piece act in battle only; they no longer add stats to the sheet or the CP.
  The Mitigation set's Crit DMG Reduction is counted.
- **Fused heroes and stat rounding.** Core Fusion heroes are composed on their real character
  everywhere, and main stats round the way the game does.
- **Reforge projection.** Each piece is projected to its own ceiling, gems are filled with a
  stat your hero actually uses, and "+15R9 Maxed only" keeps a +10 talisman.
- **Builder and Worklist.** ΔCP says what it compares against; the Worklist keeps a hero's
  most recent build; the recommended talisman is shown as preferred; a Get preset that lands
  after you switched hero is ignored; a hero's filters and a cleared rank are remembered.
- **Emulator capture.** The capture certificate is now generated on your PC the first time you
  arm a capture and replaced in the emulator automatically — the installer no longer ships
  one. Settings → Data → Wipe captured data clears the whole capture folder; raw traffic is
  only kept with the new Settings → Debug option.
- **Steam capture.** Your account imports once at launch with no overlapping checks, and gear
  edits are refused while the plugin is live.
- **Startup and data.** The window opens before the data update, which only downloads when the
  data changed. If the data comes in a newer format than this version reads, the app keeps
  your current data and asks you to update. Backup import keeps your builds and presets, and a
  bad manual import file no longer breaks the import.

## [1.8.1] — 2026-10-08

- **Stat icons are back.** The stat icons (ATK, HP, Crit Chance…) had stopped loading after
  they moved on the image server — most visibly as broken images in Home → Gear breakdown →
  Talisman, and as missing icons next to stats everywhere else. They show again across the
  app: Home, Inventory, gear details, Builder, Builds and the worklist.

## [1.8.0] — 2026-09-05

- **Capture from the Steam client — no emulator, no root.** OUTERPLANE is on Steam now, and
  the app can read your account straight from that client: pick **Steam** as the capture
  source in Settings → Setup, click **Install plugin** once (a small BepInEx plugin goes into
  the game folder), then just play — your roster and gear import on their own when the lobby
  loads, no Arm / Disarm. The emulator pipeline stays available as the other source.
- **Element and class icons match the game again.** The Steam update changed the in-game
  icon set; Home, Inventory, Builds and the gear cards now use the new icons.
- **Damage column = your hero's strongest skill.** Builder's Dmg / DmgS (and the Mcd /
  McdS filters) now show the expected hit of the hero's best skill — S1, S2 or S3 at max
  level, burst states included — instead of a generic 100 % hit. Numbers are comparable
  across heroes; the ranking of builds for a given hero is unchanged. The column header
  shows which skill won (hover for the factor); heroes without skill data fall back to
  ×1 and say so. DoT-based kits are under-estimated (not modeled).

## [1.7.0] — 2026-08-13

- **Export your roster** — a new Export button next to the Roster heading on
  Home saves your hero progression as a JSON file: level, skill levels,
  affinity, transcendence, exclusive equipment and core fusion, one entry per
  hero you own. It's meant to be fed to planning tools; it contains no gear,
  stats or inventory.

## [1.6.0] — 2026-08-12

- **Game-data updates work again** — the app now pulls its game data from
  Outerpedia's new home, so new heroes and items show up automatically after
  a game patch (the old source had stopped receiving updates). This release
  ships with the latest data: Lambda, Homunculus Delta, Saeran and the new
  gear are all in.
- **Images load from Outerpedia's new image host** — icons and portraits keep
  working (and load a bit faster once cached).
- Update to this version to keep receiving game data — older versions are
  stuck on the old, frozen source.

## [1.5.6] — 2026-07-10

- **Fixed the first-capture mitmproxy download failing to install** — the
  downloaded archive was extracted with the wrong step and errored out right
  after the checksum passed ("Expand-Archive failed"). Capture now provisions
  mitmproxy correctly on a fresh machine.

## [1.5.5] — 2026-07-10

- **Smaller, cleaner installer** — the download is ~80 MB lighter, and it no
  longer bundles the mitmproxy tool that some antivirus programs mistook for
  unwanted software. The first time you run a capture, the app downloads
  mitmproxy from its official site (checksum-verified) into your app data. You
  need an internet connection for that first capture (already required for the
  game-data sync at launch).
- **Verify your download** — each release now publishes the installer's SHA-256
  so you can confirm the file is intact. The app still isn't code-signed, so
  Windows may warn on install — see the README for why and how to check the hash.

## [1.5.4] — 2026-07-05

- Renamed the "Effect Resistance" stat label to **Resilience**, matching the
  in-game name.

## [1.5.3] — 2026-07-03

- **Top % now defaults to 60** (was 30) — the search covers twice as many
  combinations out of the box, so the best builds show up without having to
  stack stat filters first. Set it to 100 for a fully exhaustive search.
- **Less talisman noise in the results** — the table no longer fills up with
  the same gear combo repeated across dozens of near-identical talismans: at
  most 3 talisman variants are kept per gear combo, freeing the list for
  genuinely different builds.

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
