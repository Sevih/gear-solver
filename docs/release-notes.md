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

- **Upgrades you do in-game — enhance, limit break, smelting, reset, merge, craft, dissolve — now
  reach the app live**: the inventory shows the new +N within a few seconds and the pieces eaten as
  fodder disappear, no lobby needed. Update the capture plugin (0.4.0): Settings › Setup ›
  **Update plugin** with the game closed.
- Electron 44 (Chromium and Node.js runtime update); no visible change expected.
- **Presets**: cards in the game's order, class filter and sort, Optimize → per hero, hero
  dropdown no longer hidden by the next card.
- **Presets: Optimize preset →** opens the Builder with the preset's weapon / accessory / talisman
  effects required and up to five priority substats from the outfit and outerpedia's reco.
- **Presets and Worklist use the whole window**; preset pieces laid out as in-game, with the
  reference hero's EE; a hero whose crit rate or penetration overshoots 100 % on a preset is flagged.
- **Builder: crit rate past 100 % shows its raw value (+N)** in the results and the stats panel.
- **Builder**: CP before / after at the top of « Current → Projected »; the « Upg » column is now
  **Swaps** (slots that change vs the current loadout, not upgrades to do); right-click a value in the
  results to set it as a **Min ≥ / Max ≤** threshold and solve again.

## [1.14.0] — 2026-10-22

- **Gems you socket or remove in-game, and substat changes, now reach the app live too** — the
  Worklist's gem lines tick themselves whichever socket the game used, and a reforged piece shows
  its new substats without going back to the lobby. Update the capture plugin (0.3.0):
  Settings › Setup › **Update plugin** with the game closed.
- **Builder › Mains: a main stat can now be excluded per slot** — e.g. rule out ATK talismans
  when a teammate already brings one. Click a main-stat icon to cycle allowed → excluded → off;
  saved filter presets keep the exclusions.

## [1.13.0] — 2026-10-22

- **The app now follows the gear you move in-game, live — no need to go back to the lobby.**
  Equip, swap or take off a piece in the hero screen and, within a few seconds, the inventory
  shows it on its new hero and the matching Worklist line turns **applied**. Needs the updated
  capture plugin: Settings › Setup › **Update plugin** with the game closed (it then shows
  "plugin 0.2.0 live" while the game runs).
- **Worklist: one entry per hero** — queuing a new build replaces the hero's previous one; the
  gems to socket on the Talisman / EE are listed too; a toast tells you when lines clear
  themselves as you move gear in-game.
- **Presets tab**: your in-game equipment presets, who wears them, a reference hero and the
  heroes you plan to share the set with — with a warning when one of them loses too much
  versus their own build (threshold in Settings › Solver). It suggests the EE gems for each
  associated hero and queues the outfit to the Worklist; scores survive a relaunch (the
  priority of the hero's latest saved build is used), and the groups are part of the backup.

## [1.12.0] — 2026-10-22

- **Per-turn damage columns (DmgS / McdS) now use the hero's cooldown rotation**: the
  average skill factor per turn when the hero casts its strongest ready skill every turn
  (S3, then S2, then S1), instead of repeating its best hit. Dmg and Mcd still show the best
  hit. The column tooltip gives the rotation (e.g. "S3 ×1, S2 ×2, S1 ×1 over 4 turns"); a
  single hero's build ranking does not change.

## [1.11.1] — 2026-10-20

- **Game data 1.11.500 (patch of 2026-10-20, client 1.4.19).** Tamamo-no-Mae's rework is in:
  her 8th skill at level 2 now adds +100 % Effectiveness rate to the sheet, her best-skill
  damage (S3) goes up, and her Exclusive Equipment's tier-2 passive is the new one (Unbuffable
  on all enemies with Bite 'Em, Kitsu!). Delta's Gentle Moon Bunny costume and Origin Hard
  stay on the wiki side; no other hero's numbers move. Settings → Data shows client 1.4.19.

## [1.11.0] — 2026-10-19

- **Speed 4-piece follows the game.** The Speed set's % bonus is now computed on base + evolution
  + awakening speed only, as the game does — not on the +10 SPD some heroes get from their 8th
  skill. Heroes like Claire, Faenan or Delta show 2–3 SPD less in a 4-piece Speed set than before;
  that is the number you see in game, not a bug.
- **Crit Chance stops at 100 %.** The sheet, the filters and the "Crit DMG per 1 %" panel read the
  capped value; the solver still sees the raw total when it decides whether crit gems are wasted.
- **CP matches the game to the point.** CP is now computed with the game's own single-precision
  arithmetic, so the occasional ±1 difference against the in-game number is gone. Saved builds
  may shift by 1 when re-opened.
- **Weapon and accessory uniques count.** Phantasm Necrosis (−30 % SPD) and Briareos's Ambition
  (+20 % to +40 % RES by breakthrough) now enter the sheet and the CP, so "Max CP" no longer
  elects that weapon by mistake.
- **Core Fusion passive at your fusion tier.** A Core Fusion hero gets the core passive of the
  tier you actually reached (Notia's +50 % EFF only at fusion 5, not from fusion 1), and the
  core's speed bonus is applied as a rate on the whole speed, like the game — Snow's speed moves
  by 1 at some levels, and gear speed now benefits from it.
- **Set combat effects are shown.** Sets whose bonus only acts in battle (Pulverization, Weakness,
  Immunity, Revenge…) show a "combat" badge next to the description, in gear details and in the
  build's Effects panel, listing the actual values. They are never added to the sheet or the CP.
- **Data refresh.** Pulverization's 4-piece at tier 4 is now 50 % (it read 70 %), so the full set
  totals 120 % with the 2-piece. Best-skill damage updated: Sterope's S1 at burst 3, Regina and
  Luna without burst, Dahlia on S1, Saeran's combat form — the Dmg column of these heroes changes.
- **"Maxed only" means each piece's own ceiling.** A 5★ piece at +10 R5, or a non-Unique 6★ at
  +10 R6, is already maxed and stays in a +10R6 / +15R9 "Maxed only" solve instead of being dropped.
- **Gems picked by real CP gain.** In SOLVE CP without a priority, each gem slot takes the gem
  that raises the CP the most, re-evaluated after each pick (crit cap included), instead of a
  fixed stat order — builds reach the CP they should.
- **Stable ranking.** Ties between builds are broken the same way every time, whatever the number
  of workers; the Score keeps its decimals internally and is rounded only on screen.
- **Talisman variants.** A worker no longer fills its top results with the same six pieces under
  different talismans; distinct builds survive to the final list.
- **Clearer empty results.** With "Allow broken sets" off, a solve that finds no armor combination
  completing its sets says so and suggests raising Top %. A client-side Filter that hides every
  build shows "No build passes the current filter." A hero without an Exclusive Equipment is no
  longer blamed for an empty pool. A worker crash shows its error alone, without a partial table.
- **Builder fixes.** SOLVE CP with a priority keeps your currently equipped piece in the running
  (it could drop below the worn CP); a recommended build on an excluded set un-excludes it; a
  recommended talisman matches every piece of its family; the "N slots change" header updates after
  Equip; a fused hero shows its fused portrait and name in the hero picker.
- **Advices (Builds).** A 3/4 set now tells you when a free matching piece sits in your inventory
  ("a free Boots of this set is in your inventory"), and worn pieces of poor quality are listed.
- **Builds tab.** Reset keeps your sort order; stat locks saved by older versions for Crit Chance,
  Crit DMG, RES and DMG reduction are read again.
- **Inventory search is faster.** Typing in the search box no longer re-scores every piece on
  each keystroke; gear quality is computed once per import.
- **Game data update is all-or-nothing.** Every table (20 now) is downloaded and checked before
  anything is written; a bad download or a failed write keeps your current data and tells you why.
  Settings → Data shows the game version next to the data hash.
- **After a patch.** Presets and per-hero filters that still named a set or an effect the game
  removed are pruned when the data changes, so they no longer silently return "no builds". Your
  saved builds are untouched.
- **Images refresh.** Cached icons older than a week are re-checked against the server in the
  background; nothing waits on it.
- **Steam capture.** Captured files are written in the order they arrive; the roster re-imports
  when your characters, geas or archive change, not only your inventory; a PvP opponent's geas can
  no longer overwrite yours. Wipe captured data is refused while the game is running, and Settings
  → Steam shows the client build the data was read from and warns when yours differs.
- **Settings without pop-ups.** Export, import, sync, plugin removal and wipe report in the status
  bar instead of blocking dialogs; destructive buttons ask to "Click again to confirm". The worker
  count is capped to your CPU cores everywhere.
- **Game rules read from the data.** Gem slots, reforge caps and budgets and evolution levels now
  come from the synced game data instead of being hard-coded, so a balance change reaches the app
  with a data update. Exclusive-equipment mains that only act in battle (Accuracy) are shown as
  combat-only instead of being dropped.
- **Small fixes.** A piece reserved in the Worklist for another hero is no longer offered as
  "free" in Advices; the "upg" column follows what you actually wear; Settings messages show in
  the dialog's footer; the "combat" badge tooltip in Builds can be hovered; Phantasm's −30 % SPD
  no longer counts as −30 flat in the Score pre-sort.
- **Under the hood.** Builder, Inventory, Home and Settings were split into smaller modules with no
  change in behaviour; dead code and unused data were removed.

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
