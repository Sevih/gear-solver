# Using the App

How to drive gear-solver day to day. New here? Start with [Getting Started](Getting-Started)
to import your account first.

The window has six tabs — **Home**, **Inventory**, **Builds**, **Presets**, **Builder**, **Worklist** —
plus a **Settings** modal (gear icon, top-right) and the capture controls in the header.

---

## Home — dashboard

Your landing screen. At a glance:

- **Account snapshot** — heroes owned, gear count, and other quick totals.
- **Gear quality distribution** — how much of your gear is Perfect / Excellent / Good /
  Decent / Poor, by tier (same colors as the Inventory quality filter).
- **Gear breakdown** — a toggle with four views: **Overview** (count by slot + your top armor sets),
  **Class** (per class, the unique weapon/accessory effects you own as chips — hover for name + effect),
  **All sets** (the full set catalog, owned-first; unowned are dimmed with a red `0`), and **Talisman**
  (a talisman × main-stat cross-tab — each talisman framed like in the Inventory, cells are a heatmap of
  how many you own with that main stat, with row/column totals).
- **Library** — your saved builds.
- **Update center** — checks for app updates inline; when one is ready, an **Install** button
  appears (no native pop-ups).

---

## Inventory — browse your gear

A dense, searchable table of every gear piece you own.

- **Sub-tabs**: **All**, **Gear** (the six rolled-substat slots), **Special Gear** (Talisman + EE,
  which carry gems instead of substats).
- **Filters** (the Filter button, top-right): slot, rarity, star, **quality**, main stat, sub
  stats (AND/OR), armor set, class-restricted, and "exclude equipped gear". Chips that can't
  match anything in the current view are greyed out so you never zero out the grid by accident.
- **Sort**: by enhance level, stars, breakthrough, or by a specific substat's value.
- **Click any piece** → the left panel shows the full detail: main stat(s), substats with their
  tick counts (or gems for Talisman/EE), reforge / breakthrough / Singularity state, a
  **quality score**, and any item / set passives.

> Sorts and filters reset to their defaults each time you relaunch the app — so you always
> start from a clean view.

---

## Builds — your heroes

One card per **equipped** hero, showing their **composed final stats** — computed exactly the
way the game does (validated to match the in-game character sheet).

- **Advice** — each card auto-flags notable things: missing gear, a lone set piece (no bonus),
  3/4 of a set (one piece away from the 4-pc — and when a free piece of that set for the missing
  slot sits in your inventory, not reserved in the Worklist for another hero, it says so),
  **wasted caps** (crit rate or penetration over 100%), **empty gem slots** on the Talisman / EE, **upgrade headroom** (pieces with unused
  reforges, 6★ pieces not yet ascended) and **poor-quality** pieces (the Inventory's quality
  tier).
- **Inspect a piece** — hover an equipped piece to see the same full detail panel as the
  Inventory.
- **Optimize →** — jumps straight to the **Builder** with that hero pre-selected.
- **Roster filters** — search by name, filter by element / class, sort by **CP** or by
  **priority rank**. (A lock-state pill also appears if you enable the stat-lock tooling in
  **Settings → Debug**.)
- **Notes** — jot a per-hero note (kept across relaunches).

---

## Presets — your in-game equipment presets

One card per equipment preset saved in-game, in the **same order as the game's preset editor**
(favorites first): its number, name and ★ (favorite), its class icon, its 7 pieces laid out like
the game's equipment screen — Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots — and
the heroes **currently wearing** it (gear identical to the preset, EE aside). The EE is never part
of a preset — each hero keeps their own: its cell shows the reference hero's EE, dimmed. On a wide
window an open card shows the pieces on the left and the heroes on the right. Nothing is sent to
the game.

- **Class filter and sort** — the class chips at the top show only the presets of the ticked
  classes (**Clear** resets them); **Sort: Class** groups the cards by class instead of the
  game's order. A preset's class comes from its class-restricted weapon or accessory, else from
  its reference hero, its wearers or its associated heroes.

- **Reference** — the hero the preset was built for (solve them in the Builder as usual). If a
  single hero wears the preset, they're proposed by default.
- **Associated** — the heroes you plan to share the outfit with (add with the picker, remove
  with ✕). They wear it as-is and adjust through their own EE gems.
- **EE gems** — the Talisman and its gems are part of the preset, but each hero keeps their own
  EE: the line lists the **EE gems** that score best for that hero with this outfit (picked from
  their EE and from Talismans / EEs nobody wears — never from the preset's pieces or another
  hero's gear). A gem already in the right socket stays there.
- **Scores** — for the reference and each associated hero: the preset's **Score** (with that
  hero's priority and the EE gems proposed for them — the score with the gems as socketed today
  is shown in brackets when it differs), **Dmg** and **DmgS**. An associated hero also shows how
  much they lose versus their own best known build — their latest **saved build**, or their
  current gear without one. Past the threshold (15 % by default, **Settings → Solver**) the line
  turns orange: "Ame loses 23 % vs their saved build". The priority is the one set in the Builder
  this session — the Builder keeps it when you switch to another hero, so one you are still editing
  counts once you move on — else the one the hero's latest saved build was solved with ("priority
  from saved build"); a hero with neither gets no score — open them in the Builder and set one.
- **Overcap** — when the outfit pushes a hero's **crit rate** past 102 % or their **penetration**
  past 100 %, the line shows a badge, the same as on the Builds tab: "Crit rate 142% — 40% wasted
  over the 102% cap". From 10 points wasted the line turns orange; below, the badge alone. The
  badge's tooltip says when the proposed EE gems add to it.
- **+ Worklist** — on each hero's line: queues the preset's pieces that hero doesn't wear yet
  and the EE gems to socket as that hero's **Worklist** entry (replacing their previous one). A
  piece no longer in your inventory is left out, and the toast says so.
- **Optimize preset →** — on the reference hero's line: opens the Builder on that hero with the
  outfit's weapon, accessory and talisman effects **required**, and up to five priority substats
  taken from what the outfit already rolls and from Outerpedia's recommendation for the hero
  (its weapon and accessory main stats too). Sets are left open, and your stat bands and options
  stay as they were. The Builder's status line says where the substats come from; offline, or
  without a recommendation, they come from the outfit alone.
- **Optimize →** — on an associated hero's line: opens the Builder on that hero, like on the
  Builds tab.
- **Warnings** — a piece no longer in your inventory, or a piece that sits in **two** presets
  (two presets can't be worn in the same fight), is marked on the piece and in the card's banner.
  Empty presets are listed collapsed.

---

## Builder — optimize a hero

The heart of the app: pick a hero and it searches *your* inventory for the best gear
combinations. Layout is dense (Fribbels-style) — top panels set the rules, the table shows
results, the bottom band shows the selected build's pieces.

### 1. Pick a hero, pick a mode

- **SOLVE** — maximizes a **Score** weighted by the substat priorities you set. Use it when you
  know which stats you want.
- **SOLVE CP** — maximizes the in-game **Combat Power** number. One objective, no tuning needed.
- **Cancel** stops a running solve. You usually get no partial results — only work chunks
  that had already fully finished are kept (most cancels happen mid-chunk, so typically
  none). **Reset filters** clears everything.

### 2. Tell it what you want (the top panels)

- **Substat priority** — a slider per stat (−1 to 3). Higher = the solver values it more.
- **Top %** — a speed/quality dial. Lower = faster but may skip the absolute-best build; the
  hint warns you when it's set too low. (In **SOLVE CP** it always applies — each slot is
  ranked by a CP proxy. In **SOLVE** it only kicks in once you've set at least one priority.)
- **Main stats** — for Weapon / Accessory / Talisman, click a main-stat icon to cycle
  allowed → excluded → off. Allowed = the mains you'll accept; excluded = never use a piece
  with that main — e.g. rule out ATK talismans when a teammate already brings one (talisman
  mains are shared by the team and don't stack).
- **Sets** — click an armor-set icon to cycle: require 2-pc → require 4-pc → exclude → off.
  Pair it with **Allow broken sets** in Options if you want to force a set *and* still let the
  remaining slots be anything.
- **Weapon / Accessory effects** — require or exclude specific effect pieces.
- **Stat filters** — min/max on any final stat (e.g. "Speed ≥ 200"). Plus rating filters and a
  CP min/max.

### 3. Options

- **Reforge** — four modes: **Off** / **+10R6** (preview pieces at +10, not ascended — 6
  reforge ticks) / **+10R9** (preview at +10 ascended — 9 ticks, same main stat as +10R6, no
  Singularity passive) / **+15R9** (preview at +15 fully ascended — 9 ticks plus the
  Singularity passive). Lets you compare builds as if the gear were maxed — each piece up to
  its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stops at +10 with its own
  number of reforges and no Singularity passive, whatever the mode.
- **Maxed only** — no extrapolation: only pieces **already at their own ceiling in the reforge
  mode (or better)**, scored on their real rolls (no projection). Off: any piece as-is ·
  +10R6: +10 with ≥ 6 reforges done · +10R9: +10 with ≥ 9 reforges · +15R9: +15 with ≥ 9
  reforges (the talisman, which stops at +10, only needs +10; a piece that can't ascend only
  needs +10 and its own reforges — a 5★ at +10 with 5 reforges counts as maxed). Use it to answer "what's my best build with zero further investment?".
- **Transistone potential** — on a 6★ Legendary with no stage-4 substat, a Transistone can
  reroll one line up to stage 4 (a 5 % draw per pass, reforges kept). This toggle previews the
  best case: the hero's highest-priority line (else the largest roll) raised to stage 4, marked
  `T+n` on the result cards. Works with or without a reforge mode; ignored under **Maxed only**.
- **Equipped items** — a three-way control for which gear worn by *other* heroes the solver
  may pull in: **None** (only the hero's own gear + free gear), **≤ Lower** (default — also
  gear on heroes ranked strictly lower in the Builds priority ranking; with no ranks set this
  degrades to own + free gear), or **All** (any equipped gear). Pieces **reserved by a
  Worklist entry** count as worn by the claiming hero, so solving your next hero respects
  what earlier queued builds already grabbed (under **All**, reservations are ignored like
  equipment is).
- **Keep current** — lock the slots the hero already has equipped.
- **Exclude equipped** — drop gear worn by specific heroes you pick.

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
  if a Reforge mode is on, the **projected** max-roll stats. **Settings › Solver › Compact result
  cards** shortens them: set names instead of item names (« EE » for the exclusive), icon + value
  stats, one-line effects (full text on hover).
- **Equip build** — above the gear band, applies the selected build's pieces to the hero. A
  confirmation popup spells out how many pieces move (and how many would be taken off other
  heroes); on confirm it rewrites your captured snapshot and re-imports. Refused while the game
  runs with the capture plugin loaded (it edits the local snapshot, never the game itself).
- **+ Worklist** — next to Equip build; queues the selected build's gear changes (and the gems
  to socket on its Talisman / EE) onto the **Worklist** tab instead of applying them right away.
  One entry per hero: if the hero is already queued, the button reads **Replace in worklist**
  and the new build replaces the old one.
- Two helper panels per hero: **Sub tick value** (is a flat or % substat tick worth more for
  this hero?) and **Damage / +1%** (which stat gives the most damage per +1% — ATK/DEF/HP vs
  Crit Damage vs DMG increase).

### 5. Save what you like

In the right sidebar (**Library**):

- **Save / Remove build** — bookmark the selected build for this hero. Saving a build also
  saves the filters that produced it as a **filter preset** under the same name — one action,
  no separate "save preset" step.
- **Filter presets** — reload (or remove) a saved set of filters per hero, independently of
  the build it was saved with.
- **Restore** — push a saved build back into the table + gear band.
- **Get Preset** — import a recommended build from Outerpedia as a starting filter set. Its
  advised talismans are only *preferred*: used if you own one (any star of the same family),
  otherwise any talisman is.

---

## Worklist — queued gear changes

A cross-hero to-do list of gear swaps, fed from the Builder's **+ Worklist** button (and the
Presets tab's, labeled **Preset** on the card). Each
queued build becomes a card for its hero (one card per hero — a newer build replaces it), with
one checkable line per changed slot — the target piece's image, stats, and where it currently
lives (which hero wears it, or Inventory) — and one line per gem to socket on the Talisman / EE,
under its piece (gem, stat, and the gem it replaces). The tab uses the whole window: on a wide
one the cards sit two per row.

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

## Settings (gear icon)

A tabbed modal:

- **Setup** — the capture plugin checklist (game found in Steam · plugin installed · plugin
  loaded in the game), with Install / Update / Remove plugin and Launch game. The header shows
  your game build next to the client outerpedia last read, with a warning line when they differ
  (informational: capture still works).
- **Solver** — worker count (Auto = use your CPU; or pin a number), how many results to return,
  results heatmap on/off, compact result cards (shorter gear cards under the Builder's results;
  Inventory and tooltips unchanged), and the Presets tab's loss warning (15 % by default).
- **Data** — **Sync game data** (refresh the game tables after a patch), reset the onboarding
  wizard, **Wipe captured data** (with the game closed), and the current **game-data version**
  (game version of the tables, hash and date — so you can see which snapshot is loaded).
- **Backup** — **Export / Import** your saved builds, filter presets and the heroes of your
  in-game presets (Presets tab) as a JSON file (move them to another PC; captured gear isn't
  included — re-capture it there).
- **Debug** — developer toggles (safe to ignore).

---

## Keeping things up to date

- **App updates** — the **Home** tab's update center checks automatically; click **Install** when
  one is downloaded.
- **Game data** — after an OUTERPLANE patch, the app refreshes its game tables on launch. You can
  also force it from **Settings → Data → Sync game data**, then re-capture your account.

Stuck? → **[FAQ & Troubleshooting](FAQ)**
