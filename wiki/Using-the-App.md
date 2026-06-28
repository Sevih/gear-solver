# Using the App

How to drive gear-solver day to day. New here? Start with [Getting Started](Getting-Started)
to import your account first.

The window has four tabs — **Home**, **Inventory**, **Builds**, **Builder** — plus a
**Settings** modal (gear icon, top-right) and the capture controls in the header.

---

## Home — dashboard

Your landing screen. At a glance:

- **Account snapshot** — heroes owned, gear count, and other quick totals.
- **Gear quality distribution** — how much of your gear is Excellent / Good / Decent / Poor,
  by tier (same colors as the Inventory quality filter).
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
  3/4 of a set (one piece away from the 4-pc), **wasted caps** (crit rate or penetration over
  100%), **empty gem slots** on the Talisman / EE, and **upgrade headroom** (pieces with unused
  reforges, 6★ pieces not yet ascended).
- **Inspect a piece** — hover an equipped piece to see the same full detail panel as the
  Inventory.
- **Optimize →** — jumps straight to the **Builder** with that hero pre-selected.
- **Roster filters** — search by name, filter by element / class / lock state.
- **Notes** — jot a per-hero note (kept across relaunches).

---

## Builder — optimize a hero

The heart of the app: pick a hero and it searches *your* inventory for the best gear
combinations. Layout is dense (Fribbels-style) — top panels set the rules, the table shows
results, the bottom band shows the selected build's pieces.

### 1. Pick a hero, pick a mode

- **SOLVE** — maximizes a **Score** weighted by the substat priorities you set. Use it when you
  know which stats you want.
- **SOLVE CP** — maximizes the in-game **Combat Power** number. One objective, no tuning needed.
- **Cancel** stops a running solve (you keep whatever it found so far); **Reset filters** clears
  everything.

### 2. Tell it what you want (the top panels)

- **Substat priority** — a slider per stat (−1 to 3). Higher = the solver values it more.
- **Top %** — a speed/quality dial. Lower = faster but may skip the absolute-best build; the
  hint warns you when it's set too low. (Only active once you've set at least one priority.)
- **Main stats** — for Weapon / Accessory / Talisman, click the main-stat icons you'll accept.
- **Sets** — click an armor-set icon to cycle: require 2-pc → require 4-pc → exclude → off.
  Pair it with **Allow broken sets** in Options if you want to force a set *and* still let the
  remaining slots be anything.
- **Weapon / Accessory effects** — require or exclude specific effect pieces.
- **Stat filters** — min/max on any final stat (e.g. "Speed ≥ 200"). Plus rating filters and a
  CP min/max.

### 3. Options

- **Reforge** — Off / **Classic** (preview pieces at +10, fully reforged) / **Ascended**
  (preview at +15 ascended). Lets you compare builds as if the gear were maxed.
- **Only maxed gear** — restrict to +15 pieces.
- **Include equipped on others** — also consider gear currently on other heroes.
- **Keep current** — lock the slots the hero already has equipped.
- **Exclude equipped** — drop gear worn by specific heroes you pick.

### 4. Read the results

- The **table** lists ranked builds with a red→green **heatmap** per column: sets, the main
  stats, derived ratings, **Score**, and **Upg** (how many slots differ from what's currently
  equipped). Click a column header to sort; **right-click** a header (or the Columns button) to
  show/hide columns.
- **Click a row** → the **bottom gear band** shows the 8 pieces of that build, including the
  **recommended gem allocation** (with a "swap" badge if it differs from what's socketed) and,
  if a Reforge mode is on, the **projected** max-roll stats.
- **Equip build** — above the gear band, applies the selected build's pieces to the hero. A
  confirmation popup spells out how many pieces move (and how many would be taken off other
  heroes); on confirm it rewrites your captured snapshot and re-imports. Requires the capture
  pipeline to be **disarmed** (it edits the local snapshot, never the game itself).
- Two helper panels per hero: **Sub tick value** (is a flat or % substat tick worth more for
  this hero?) and **Damage / +1%** (which stat gives the most damage per +1% — ATK/DEF/HP vs
  Crit Damage vs DMG increase).

### 5. Save what you like

In the right sidebar (**Library**):

- **Save / Remove build** — bookmark the selected build for this hero.
- **Filter presets** — save and reload a whole set of filters per hero.
- **Restore** — push a saved build back into the table + gear band.
- **Get Preset** — import a recommended build from Outerpedia as a starting filter set.

---

## Settings (gear icon)

A tabbed modal:

- **Setup** — re-run the emulator / ADB / root checklist.
- **Solver** — worker count (Auto = use your CPU; or pin a number), how many results to return,
  results heatmap on/off.
- **Data** — **Sync game data** (refresh the game tables after a patch), reset the onboarding
  wizard, **Wipe captured data**, and the current **game-data version** (so you can see which
  snapshot is loaded).
- **Backup** — **Export / Import** your saved builds + filter presets as a JSON file (move them
  to another PC; captured gear isn't included — re-capture it there).
- **Debug** — developer toggles (safe to ignore).

---

## Keeping things up to date

- **App updates** — the **Home** tab's update center checks automatically; click **Install** when
  one is downloaded.
- **Game data** — after an OUTERPLANE patch, the app refreshes its game tables on launch. You can
  also force it from **Settings → Data → Sync game data**, then re-capture your account.

Stuck? → **[FAQ & Troubleshooting](FAQ)**
