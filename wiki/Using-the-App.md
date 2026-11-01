# Using the App

How to drive gear-solver day to day. New here? Start with [Getting Started](Getting-Started)
to import your account first.

The window has five tabs — **Heroes**, **Optimizer**, **Presets**, **Worklist**, **Gear** —
plus a **Settings** modal (the **Settings** button, top-right) and the capture controls in the header:
one **capture pill** (Checking… · Steam not found · Plugin needed · Plugin update available · Game closed ·
Waiting for game · Live — hover it for the detail and the game folder), next to it the one button that
unblocks you (**Install plugin** / **Update plugin** / **Launch game**, the same as in Settings → Setup)
and **Reload**. When an app update is waiting, a **vX ready** (or **vX available**) badge shows in the
header whatever the tab; click it to open the update center in **Settings › Data & updates**.

The app opens on **Heroes** (afterwards, on the tab you last left). On the first launch, before
anything is captured, **Heroes** and **Gear** show the capture steps: which one is next (in the
capture pill's words), a link to **Settings › Setup**, and the install plugin → launch game → reach
the lobby path. The install / launch button itself is the header's (or Setup's).

---

## Gear — browse your pieces

Three views, under a bar at the top: **Overview**, **Pieces** and **Scrap**. The view you picked
stays when you switch tabs, back to Overview on the next launch.

### Overview

A read of your captured account:

- **Snapshot line** — heroes owned, gear count, and when the snapshot was captured ("3h ago (14:32)").
- **Gear quality distribution** — how much of your gear is Perfect / Excellent / Good /
  Decent / Poor, by tier (same colors as the Pieces quality filter). Click a tier to open
  **Pieces** filtered on it.
- **Roster** — your heroes by element and by class, and **Export**, which saves your hero
  progression as a JSON file for outerpedia's hero tracker.
- **Gear breakdown** — a toggle with four views: **Overview** (count by slot + your top armor sets;
  click a slot or a set to open **Pieces** filtered on it), **Class** (per class, the unique
  weapon/accessory effects you own as chips — hover for name + effect), **All sets** (the full set
  catalog, owned-first; unowned are dimmed with a red `0`), and **Talisman** (a talisman × main-stat
  cross-tab — each talisman framed like in Pieces, cells are a heatmap of how many you own with that
  main stat, with row/column totals), plus the Ascended / Singularity / Locked counts. The view you
  picked stays when you switch tabs, back to Overview on the next launch.

The capture state and its button are in the header, **Sync game data** and the app updates in
**Settings › Data & updates**, your saved builds and filter sets in the **Optimizer**.

### Pieces

A dense, searchable table of every gear piece you own.

- **Sub-tabs**: **All**, **Gear** (the six rolled-substat slots), **Special Gear** (Talisman + EE,
  which carry gems instead of substats).
- **Filters** (the Filter button, top-right): slot, rarity, star, **quality**, main stat, sub
  stats (AND/OR), armor set, class-restricted, **Hide equipped**, and three boxes next to
  it: **+0 only**, **T0 only** (no breakthrough) and **Not reforged**. Chips that can't
  match anything in the current view are greyed out so you never zero out the grid by accident.
- **Reachable quality** (in the Filter modal, right after Quality): the tier a piece would reach
  if a Transistone raised its best substat line to tier 4 — the "→ N reachable" of the detail
  panel. Only a 6★ Legendary with four lines has that potential: one line can go up to tier 4,
  or up to tier 3 when the piece already has a tier-4 line (a 3/3/3/3 can become 4/3/3/3, a
  4/4/3/2 can become 4/4/3/3); a 4/3/3/3 or a 4/4/3/3 has nothing left to gain. Any other piece
  counts at its current tier. A **Good** piece that a reroll would push past 85 % shows under
  **Excellent** here and not under Quality's Excellent. Talismans and EE have no quality score and
  never match.
- **Base rolls** (in the Filter modal): the initial tiers of a piece's substats, best line first,
  before reforge and enhancement — the same "3/3/3/1" as the Transistone reroll. Pick an operator
  (at least, more than, exactly, at most, less than) and four values (X = any): every line must
  match. E.g. **less than 2/2/2/2** keeps the pieces with no line at 2 or above (the ones to sell),
  **at least 4/3/X/X** the ones whose best line is 4 and second at least 3, **exactly 3/3/3/1**
  that pattern. Tick **not** to keep the pieces that do NOT match: **not at least 3/3/3/X** keeps
  everything without three lines at 3 (a 3/2/2/1 stays, which "less than 3/3/3/X" would drop). A
  piece with three lines has a 4th line at 0; Talisman and EE (gems, no substats) never pass an
  active Base rolls filter, with or without not.
- **Filter sets** (top row of the Filter modal): pick a filter set and **Load** it into the modal
  (adjust, then **Apply**); **Save as…** saves the current filters under a name (1–24 characters; an
  existing name is overwritten); **Delete** removes one of yours. A filter set keeps every filter
  except the search and the sub-tab (All / Gear / Special Gear): **Load** leaves your search in
  place, and a filter set holding a slot the current sub-tab doesn't show switches the view to **All**
  on Apply. A selected value no piece of the view carries stays in the modal, dimmed, so you can
  remove it. The built-in **Scrap
  candidates** (always first, can't be deleted) shows the unequipped 5★ / 6★ gear at +0, T0, never
  reforged, with Base rolls **not at least 3/3/3/X** — the pieces without three lines at 3.
- **Sort**: by enhance level, stars, breakthrough, or by a specific substat's value.
- **Scrap value** (a card under the piece panel, once a filter is set or pieces are selected): what
  the pieces would return in-game — the gold from selling them, and the gold and materials from
  dissolving them (a min–max range, from the game tables), with the gold and material icons; hover a
  material for its name, and past six materials hover **+n more** for the rest. The card prices
  your **selection** when there is one (every selected piece, even those outside the current view),
  the pieces on screen otherwise; its header says which (**2 selected** or **37 shown**). Only free
  pieces count: equipped or locked pieces neither sell nor dissolve, and an enhanced piece doesn't
  sell but still dissolves; it then also refunds part of its enhancement materials, which the card
  does not estimate (it says how many such pieces there are). Information only — nothing is sold
  from here. The card appears once the synced game data carries the sell and dissolve values.
- **Selecting pieces** (in the Scrap value card): **Select pieces** turns on selection mode, where
  a click on a tile selects or unselects it and shows it in the panel; outside the mode a click only
  shows it, and **Ctrl+click** always selects or unselects. **Select all shown** adds the pieces on
  screen, **Select never used** the pieces marked **Never use**, **Clear** empties the selection.
  A selected tile carries an amber check in its top-left corner. Leaving the mode keeps the
  selection; it lasts until you clear it or close the app (switching tabs keeps it, the mode and
  the piece shown too), and a piece that leaves the inventory leaves it too.
- **Click any piece** → the left panel shows the full detail: main stat(s), substats with their
  tick counts (or gems for Talisman/EE), reforge / breakthrough / Singularity state, a
  **quality score**, and any item / set passives. **Never use** under the card (or a right-click
  on the tile) keeps the piece out of every solve, marked ⊘ on its tile; **Never used — click to
  allow** brings it back. **Optimize wearer →**, next to it, opens the **Optimizer** on the hero
  wearing the piece (greyed out on a free piece); a click on the wearer's portrait in the card
  does the same.

> Sorts and filters reset to their defaults each time you relaunch the app — so you always
> start from a clean view. Filter sets are kept.

### Scrap

The same grid, set up to pick what to sell or dissolve:

- It opens on the **Scrap candidates** filters (the built-in filter set above) and keeps its own
  filters, apart from Pieces'. Change them with **Filter**; the **Scrap candidates** link at the right
  of the slot bar puts them back.
- **Selection mode is on**: a click on a tile selects or unselects it (and shows it in the panel).
  The selection, the sub-tab, the sort and the piece shown are the same as in Pieces.
- The **Scrap value** card is always there: it prices your selection, or the pieces on screen when
  nothing is selected. When the synced game tables carry no sell / dissolve values, a line above the
  grid says so instead (sync game data in **Settings › Data & updates**).

An estimate only: nothing is sold or dissolved from the app — you do it in the game.

---

## Heroes — your roster

One card per **equipped** hero, showing their **composed final stats** — computed exactly the
way the game does (validated to match the in-game character sheet).

- **Advice** — each card auto-flags notable things: missing gear, a lone set piece (no bonus),
  3/4 of a set (one piece away from the 4-pc — and when a free piece of that set for the missing
  slot sits in your inventory, not reserved in the Worklist for another hero, it says so),
  **wasted caps** (crit rate or penetration over 100%), **empty gem slots** on the Talisman / EE, **upgrade headroom** (pieces with unused
  reforges, 6★ pieces not yet ascended) and **poor-quality** pieces (Gear's quality
  tier).
- **Inspect a piece** — hover an equipped piece to see the same full detail panel as
  Gear.
- **Optimize →** — jumps straight to the **Optimizer** with that hero pre-selected.
- **Roster filters** — search by name (the same search as every hero picker: the name shown,
  nickname, base name or id; "fusion" finds the Core Fusion heroes), filter by element / class,
  sort by **CP** or by **Rank** (rank 1 first, unranked last, then CP; ties keep the capture
  order). (A lock-state pill also appears if you enable the stat-lock tooling in
  **Settings › Advanced**.)
- **Notes** — jot a per-hero note (kept across relaunches).

---

## Presets — your in-game equipment presets

One card per equipment preset saved in-game, in the **same order as the game's preset editor**
(favorites first): its number, name and ★ (favorite), its class icon, its 7 pieces laid out like
the game's equipment screen — Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots — and
the heroes **currently wearing** it (gear identical to the preset, EE aside). The EE is never part
of a preset — each hero keeps their own: its cell shows the reference hero's EE, dimmed. On a wide
window an open card shows the pieces on the left and the heroes on the right. Under each tile, the
icon and value of the main stat that matters for it: the weapon's second main (the one that changes —
every weapon has flat ATK first), the accessory's and the talisman's main; nothing under the helmet,
armor, gloves, boots and EE (hover a tile's line for every main), the set name under the armor
pieces. Between the pieces and the heroes, three lines: **Quality** (the six pieces' rolled substat ticks out of 6 × 23 = 138, each piece
ascended and fully reforged; hover for the cap at the pieces' current investment), **Offensive**
(the +15 roll grade of the weapon / accessory) and **Defensive** (helmet / armor / gloves / boots),
"–" for a piece without a +15 roll. Nothing is sent to the game.

- **Class filter and sort** — the class chips at the top show only the presets of the ticked
  classes (**Clear** resets them); **Sort: Class** groups the cards by class instead of the
  game's order. A preset's class comes from its class-restricted weapon or accessory, else from
  its reference hero, its wearers or its associated heroes.
- **Expand all / Collapse all** — next to the sort, open or close every card at once (in-game and
  local, filtered or not). A card you open or close by hand afterwards keeps it until the next
  Expand all / Collapse all. The chips, the sort and the open cards stay when you switch tabs, and
  reset on the next launch.

- **Reference** — the hero the preset was built for (solve them in the Optimizer as usual). If a
  single hero wears the preset, they're proposed by default.
- **Associated** — the heroes you plan to share the outfit with (add with the picker, remove
  with ✕). They wear it as-is and adjust through their own EE gems.
- **EE gems** — the Talisman and its gems are part of the preset, but each hero keeps their own
  EE: the line lists the **EE gems** that score best for that hero with this outfit (picked from
  their EE and from Talismans / EEs nobody wears — never from the preset's pieces or another
  hero's gear). A gem already in the right socket stays there.
- **Scores** — for the reference and each associated hero: the preset's **Score** (with that
  hero's priority and the EE gems proposed for them — the score with the gems as socketed today
  is shown in brackets when it differs), **Dmg** and **DmgS** — hover each for what it measures. An associated hero also shows how
  much they lose versus their own best known build — their latest **saved build**, or their
  current gear without one. Both sides are scored on their real rolls: the saved build is rebuilt
  from its pieces as they are in your capture today (not the projected stats it was solved with),
  with the gems it allocated; if one of its pieces is gone (sold, dissolved), the current gear is
  the comparison instead. Past the threshold (15 % by default, set with the **−/+** stepper in the
  sentence at the top of the Presets screen, 5 to 50 % by steps of 5) the line
  turns orange: "Ame loses 23 % vs their saved build". The priority is the one set in the Optimizer
  for that hero — kept across relaunches, and a weight you change there counts here right away —
  else the one the hero's latest saved build was solved with ("priority from saved build"); a hero
  with neither gets no score — open them in the Optimizer and set one.
- **Overcap** — when the outfit pushes a hero's **crit rate** past 102 % or their **penetration**
  past 100 %, the line shows a badge, the same as on the Heroes tab: "Crit rate 142% — 40% wasted
  over the 102% cap". From 10 points wasted the line turns orange; below, the badge alone. The
  badge's tooltip says when the proposed EE gems add to it.
- **+ Worklist** — on each hero's line: queues the preset's pieces that hero doesn't wear yet
  and the EE gems to socket as that hero's **Worklist** entry (replacing their previous one). A
  piece no longer in your inventory is left out, and the toast says so.
- **Optimize preset →** — on the reference hero's line: opens the Optimizer on that hero with the
  outfit's weapon, accessory and talisman effects **required**, and up to five priority substats
  taken from what the outfit already rolls and from Outerpedia's recommendation for the hero
  (its weapon and accessory main stats too). Sets are left open, and your stat bands and options
  stay as they were. The Optimizer's status line says where the substats come from; offline, or
  without a recommendation, they come from the outfit alone.
- **Optimize →** — on an associated hero's line: opens the Optimizer on that hero, like on the
  Heroes tab.
- **Rank and lock** — each preset has a priority **rank**, like the heroes on the Heroes tab
  (1 = most important; type a position, or drag the ⠿ handle with **Sort: Rank**; empty =
  unranked = lowest; new presets get one in the in-game order as soon as a capture is imported). **Optimize preset →** never takes
  a piece from a preset ranked above or equal to it (unranked counts as lowest). The 🔒 **Lock**
  button keeps a preset's pieces out of every solve — any hero, any preset — except **Optimize
  preset →** on that preset itself; a locked card has an amber outline. A lock holds pieces, not
  gems: the gems on a locked (or higher-ranked) preset's Talisman can still be proposed, in the
  Optimizer as in the EE gems here. In the Optimizer, the
  Library says which preset is being optimized, and a proposed piece that sits in another preset
  says **from preset ‹name›** on its card.
- **Warnings** — a piece no longer in your inventory, or a piece that sits in **two** presets
  (two presets can't be worn in the same fight), is marked on the piece and in the card's banner.
  Empty presets are listed collapsed.
- **Local presets** — presets kept in GS only, to prepare an outfit without touching the game:
  a name (12 characters, the in-game limit) and the 7 pieces, no EE. Make one from an Optimizer
  result (**Save as local preset…**, the Optimizer's hero as its reference) or with **Copy as local
  preset** on an in-game card (same pieces, the hero shown as reference, the name cut to 12
  characters). They're listed under the in-game presets, most recent first, on the same card
  with a **Local** badge: the pieces (a missing one is marked), the reference hero's line with
  their score and **Optimize →**. No rank, lock, associated heroes, Worklist or **Optimize preset
  →**; **Rename** in place, **Delete** asks for one more click (**Delete?**). They keep no piece
  away from a solve, and the class filter applies to them too.

---

## Optimizer — optimize a hero

The heart of the app: pick a hero and it searches *your* inventory for the best gear
combinations. Layout is dense (Fribbels-style) — top panels set the rules, the table shows
results, the bottom band shows the selected build's pieces.

### 1. Pick a hero, pick a mode

- **Hero** — type in the search box (name shown, nickname, base name or id; "fusion" finds the
  Core Fusion heroes), ↑/↓ then Enter or a click to pick. The list follows your hero **Rank**
  (rank 1 first, unranked last, then capture order) — the same list, search and order as in
  **Don't take from…** and the Presets tab's **Reference** / **Associated** pickers.
- **Score | CP** — pick the mode next to the **Solve** button (picking doesn't start a solve);
  **Solve** runs the mode shown.
  - **Score** maximizes a **Score** weighted by the substat priorities you set. Use it when you
    know which stats you want. With no priority set, Solve takes the weights of the hero's
    Outerpedia reco (only its priority, from its first build) and says so under the hero row
    (**Priority from outerpedia reco · Edit · Clear**); the priority stays with the hero like one
    you set. If the hero has no reco (or it can't be loaded), that solve goes by Combat Power
    instead and a toast tells you.
  - **CP** maximizes the in-game **Combat Power** number. One objective, no tuning needed.
- While no priority is set, a banner under the hero row says what Solve will do, with **Load
  reco** (the whole reco), **Set priority** (opens the Priority panel) and **Use CP** (switches
  to CP and solves).
- **Cancel** stops a running solve. You usually get no partial results — only work chunks
  that had already fully finished are kept (most cancels happen mid-chunk, so typically
  none). **Reset filters** clears everything.

### 2. Tell it what you want (the top panels)

- **Substat priority** — a slider per stat (−1 to 3). Higher = the solver values it more.
- **Top %** — a speed/quality dial. Lower = faster but may skip the absolute-best build; the
  hint warns you when it's set too low. (In **CP** it always applies — each slot is
  ranked by a CP proxy. In **Score** it ranks by your priority.)
- **Main stats** — for Weapon / Accessory / Talisman, click a main-stat icon to cycle
  allowed → excluded → off. Allowed = the mains you'll accept; excluded = never use a piece
  with that main — e.g. rule out ATK talismans when a teammate already brings one (talisman
  mains are shared by the team and don't stack).
- **Sets** — click an armor-set icon to cycle: require 2-pc → require 4-pc → exclude → off.
  Pair it with **Allow broken sets** in Options if you want to force a set *and* still let the
  remaining slots be anything.
- **Weapon / Accessory effects** — require or exclude specific effect pieces.
- **Stat filters** — min/max on any final stat (e.g. "Speed ≥ 200"). Plus rating filters and a
  CP min/max. Gems: a stat filter's minimum is served before the priority — a build short of
  it gets that stat's gems first, the priority fills the remaining slots; a build that only
  passes with its socketed gems keeps them (the gear band then shows the pieces' own gems).

### 3. Options

- **Reforge** — four modes: **Off** / **+10R6** (preview pieces at +10, not ascended — 6
  reforge ticks) / **+10R9** (preview at +10 ascended — 9 ticks, same main stat as +10R6, no
  Singularity passive) / **+15R9** (preview at +15 fully ascended — 9 ticks plus the
  Singularity passive). Lets you compare builds as if the gear were maxed — each piece up to
  its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stops at +10 with its own
  number of reforges and no Singularity passive, whatever the mode. The default for a hero's
  first solve is set in **Settings › Solver**, **+10R6** out of the box; the mode you pick for a
  hero stays with its filters.
- **Maxed only** — no extrapolation: only pieces **already at their own ceiling in the reforge
  mode (or better)**, scored on their real rolls (no projection). Off: any piece as-is ·
  +10R6: +10 with ≥ 6 reforges done · +10R9: +10 with ≥ 9 reforges · +15R9: +15 with ≥ 9
  reforges (the talisman, which stops at +10, only needs +10; a piece that can't ascend only
  needs +10 and its own reforges — a 5★ at +10 with 5 reforges counts as maxed). Use it to answer "what's my best build with zero further investment?".
- **Transistone potential** — on a 6★ Legendary with no tier-4 substat, a Transistone can
  reroll one line up to tier 4 (a 5 % draw per pass, reforges kept); a piece already holding a
  tier-4 line can't get a second one but can still raise a line to tier 3 (a 3/3/3/3 can become
  4/3/3/3, a 4/4/3/2 can become 4/4/3/3). This toggle previews the best case: the hero's
  highest-priority line (else the largest roll) raised that far, marked
  `T+n` on the result cards. Works with or without a reforge mode; ignored under **Maxed only**.
  The default for a hero's first solve is set in **Settings › Solver**, off out of the box; the
  choice you make for a hero stays with its filters.
- **Equipped items** — a three-way control for which gear worn by *other* heroes the solver
  may pull in: **None** (only the hero's own gear + free gear), **≤ Lower** (default — also
  gear on heroes ranked strictly lower in the Heroes ranking; every new hero gets a default
  rank by CP as soon as a capture is imported, without opening Heroes; with no ranks set this
  degrades to own + free gear), or **All** (any equipped gear). Pieces **reserved by a
  Worklist entry** count as worn by the claiming hero, so solving your next hero respects
  what earlier queued builds already grabbed (under **All**, reservations are ignored like
  equipment is).
- **Keep current** — lock the slots the hero already has equipped.
- **Don't take from…** — drop gear worn by specific heroes you tick (same hero list and search as
  the hero picker; the button shows how many are ticked, ✕ clears them).

### 4. Read the results

- The **table** lists ranked builds with a red→green **heatmap** per column: sets, the main
  stats, derived ratings, **Score**, and **Swaps** (how many slots change vs what's currently
  equipped — not upgrades to do). Click a column header to sort; **right-click** a header (or the
  Columns button) to show/hide columns. **Right-click a value** (a stat, a rating or CP) →
  **Min ≥** / **Max ≤** that value: the bound lands in the filter panels and the solve re-runs.
  A crit rate past the in-game 100 % cap shows as **100% ⁺42** (the overflow in amber; hover for
  the raw value and how much is wasted past the 2 % buffer), and the column shades and sorts on
  the raw value — the **Current → Projected** panel shows it the same way.
- **Click a row** → the **bottom gear band** shows the 8 pieces of that build, laid out like the
  game's equipment screen (Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots), including the
  **recommended gem allocation** (with a "swap" badge if it differs from what's socketed) and,
  if a Reforge mode is on, the **projected** max-roll stats. Each card is the Gear tab's piece card
  (rarity and slot, quality with its help and bar, the Singularity +15 effect), without the weapon /
  accessory passive and the set bonuses, which the **Effects** card under the stats lists for the whole
  build. **Settings › Display › Compact result
  cards** shortens them: no item icon (enhance, breakthrough and stars next to the name), set names
  instead of item names (« EE » for the exclusive), icon + value stats with the substats two per row,
  gems as icons, one-line quality and effects (the Singularity +15 bonus as grade + short label + value,
  e.g. « S+ DS DMG+ +12% » for DMG within Dimensional Singularity or « vs Fire DMG- » for DMG taken from
  Fire targets; details on hover), the talisman's passive moved to the hover text of its name, the EE
  and the talisman sharing one card (seven cards, four then three), and a small **Never use** icon instead
  of the button. A slot the build leaves empty says so on its card (« No weapon in this build »).
- **Apply to snapshot** — above the gear band, applies the selected build's pieces to the hero in
  your captured snapshot. A confirmation popup spells out how many pieces move (and how many would
  be taken off other heroes); on confirm it rewrites the snapshot and re-imports. Only the local
  capture changes, never the game itself: equip the pieces in-game yourself. Greyed out while the
  game runs with the capture plugin loaded (hover it for the reason).
- **+ Worklist** — next to Apply to snapshot; queues the selected build's gear changes (and the gems
  to socket on its Talisman / EE) onto the **Worklist** tab instead of applying them right away.
  One entry per hero: if the hero is already queued, the button reads **Replace in worklist**
  and the new build replaces the old one.
- Two helper panels per hero: **Sub tick value** (is a flat or % substat tick worth more for
  this hero?) and **Damage / +1%** (which stat gives the most damage per +1% — ATK/DEF/HP vs
  Crit Damage vs DMG increase).

### 5. Save what you like

In the right sidebar (**Library**):

- **Save / Remove build** — bookmark the selected build for this hero. Saving a build also
  saves the filters that produced it as a **filter set** under the same name — one action,
  no separate "save preset" step.
- **Save as local preset…** — type a name (12 characters max) and **Save**: the selected build's
  7 pieces (the EE left out) become a **local preset** on the Presets tab, with this hero as its
  reference. Nothing is sent to the game.
- **Filter sets** — reload (or remove) a saved set of filters per hero, independently of
  the build it was saved with.
- **Restore** — push a saved build back into the table + gear band.
- **Load reco** — import a recommended build from Outerpedia as a starting filter set. Its
  advised talismans are only *preferred*: used if you own one (any star of the same family),
  otherwise any talisman is.

---

## Worklist — queued gear changes

A cross-hero to-do list of gear swaps, fed from the Optimizer's **+ Worklist** button (and the
Presets tab's, labeled **Preset** on the card). Each
queued build becomes a card for its hero (one card per hero — a newer build replaces it), with
one checkable line per changed slot — the target piece's image, stats, and where it currently
lives (which hero wears it, or Gear) — and one line per gem to socket on the Talisman / EE,
under its piece (gem, stat, and the gem it replaces). The tab uses the whole window: on a wide
one the cards sit two per row.

- **Queued pieces are reserved** — a line above the cards says so. Until a piece line shows as
  **applied** (the snapshot has the piece on the hero) or you remove the card, the Optimizer treats
  the piece as already worn by the card's hero, so solving your next hero respects what earlier
  queued builds grabbed: under **Equipped items ≤ Lower** only a higher-ranked hero can take it,
  under **None** nobody else, under **All** reservations are ignored. Ticking a line doesn't lift
  its reservation; gem lines and pieces gone from the inventory reserve nothing.
- **Links** — a card's hero (portrait and name, **Optimize →**) opens the **Optimizer** on that
  hero; on a line, **on ‹hero›** opens it on the hero wearing the piece now, and **in Gear**
  opens **Gear** with the piece shown in the detail panel (the view is kept when it
  shows the piece, reset to All without filters when it hides it).
- **Work through it in-game** — tick each line off as you equip it for real; on your next
  capture (or as soon as the app sees the move, with the game open), changes that are done are
  pruned automatically and a notice in the bottom-right corner says so.
- **Apply locally** — per card, rewrites your captured snapshot with that hero's swaps (never
  the game itself), so the rest of the app reflects them. Gems aren't socketed by the app:
  socket them in-game. If it fails, the card says why (game open, no snapshot, write error).
- **Apply all** — applies every queued change across all heroes in one go, in an order that
  frees a piece before the build that reuses it.
- The list stays truthful on its own: lines flip to **applied** when the piece lands on the
  hero (for a gem, once the piece holds it — in any socket), **contested** when two queued builds want the
  same single copy (resolve one before Apply all), and **piece gone** (amber) when the piece left
  your inventory — eaten as fodder, sold or dissolved in-game; a notice says so when it happens, and
  the line no longer counts in the tab's badge. Each line names its piece (and a Talisman's main) as
  it is now, so an enhance done in-game shows right away.

---

## Settings (the Settings button)

A tabbed modal with six panes, in this order. **Esc** closes it; it reopens on the last pane you
visited (on **Setup** until the first setup check has passed).

- **Setup** — the capture plugin checklist (game found in Steam · plugin installed · plugin
  loaded in the game), with Install / Update / Remove plugin and Launch game. The header shows
  your game build next to the loaded game-data version (same format as in Data & updates), with a
  warning line when your build differs from the client outerpedia last read (informational: capture
  still works).
- **Data & updates** — the **update center** first: the app version, the update state (up to date,
  checking, downloading with its progress, ready → **Install new version**, offline → **Retry**,
  manual → the reason) and **Check again**; app updates come from the GitHub releases, checked in the
  background whatever the tab (no native pop-ups). Then the current **game-data version** (game
  version of the tables, hash and date — so you can see which snapshot is loaded), **Sync game data**
  (download the latest game tables published by outerpedia after a patch) and **Wipe captured data**
  (with the game closed).
- **Solver** — what the next solve reads (*Solver tuning · applies next solve*): worker count
  (Auto = use your CPU; or pin a number), how many results to return and, under *Show advanced*,
  the per-worker depth. Then the *Hero defaults* (*for a hero's first solve*): **Default reforge
  mode** (Off / +10R6 / +10R9 / +15R9, +10R6 out of the box) and **Transistone potential by
  default** (off out of the box) — what a hero with no filters of their own opens on in the
  Optimizer; a hero who already has filters, and the hero open, keep theirs. **Reset solver
  settings to defaults** puts these five back (+10R6, Transistone off).
- **Display** — applied at once: results heatmap on/off, compact result cards (shorter gear cards
  under the Optimizer's results; Gear and tooltips unchanged) and **Result rows**, the height of the
  Optimizer's results table (5 to 15 rows, 12 by default — the height slider above the table sets
  the same value). **Reset display settings to defaults** puts these three back.
- **Backup** — **Export backup / Import backup**: one JSON file with everything you set up in the
  app — saved builds, filter sets (Optimizer and Gear), local presets, the heroes of your in-game
  presets, hero and preset ranks, locked presets, never-use pieces, the worklist, hero notes, the
  last filters per hero, the Optimizer layout and your Solver, Display and developer settings
  (and the Presets loss threshold). The list is shown
  under the Export button. Never the captured gear: that comes from the game (re-capture it on the
  other PC). Import merges: builds and presets already present are kept; ranks, worklist entries,
  notes and settings from the file replace yours (settings held within their bounds). A file
  exported by an older version (builds & presets only) still imports.
- **Advanced** — developer toggles (stat-lock tooling on Heroes, solver fan-out logging; safe to
  ignore), **Reset onboarding prompt** (shows Settings as the setup wizard on next launch), then the
  app journal (**Logs**: plugin install lines and every status message, kept for this session only)
  with **Copy** and **Clear**.

The Presets loss threshold is not in Settings: it is set on the Presets screen (see above).

---

## Keeping things up to date

- **App updates** — checked automatically; a **vX ready** badge appears in the header once one is
  downloaded, whatever the tab. Click it (or open **Settings › Data & updates**) and click **Install new version**. On Linux the AppImage needs to sit in a folder you can write to; otherwise the
  card reads **Manual** with the reason, and you download the new AppImage by hand.
- **Game data** — after an OUTERPLANE patch, the app refreshes its game tables on launch. You can
  also force it from **Settings › Data & updates › Sync game data**, then re-capture your account.

Stuck? → **[FAQ & Troubleshooting](FAQ)**
