# Using the App

How to drive gear-solver day to day. New here? Start with [Getting Started](Getting-Started)
to import your account first.

The window has five tabs, in the order of a session — **Heroes**, **Optimizer**, **Presets**,
**Worklist**, **Gear** — plus a **Settings** modal. The header, top-right, holds:

- the **capture pill** — one word for where the capture stands (Checking… · Steam not found ·
  Plugin needed · Plugin update available · Game closed · Waiting for game · Live); hover it for
  the detail and the game folder;
- next to it, the one button that unblocks you, when there is one: **Install plugin** / **Update
  plugin** / **Launch game** (the same as in **Settings › Setup**);
- **Reload** (the round-arrow icon): re-imports the latest snapshot from disk;
- when an app update is waiting, a **vX ready** (or **vX available**) badge, whatever the tab;
  click it to open the update center in **Settings › Data & updates**;
- the **Settings** button (the sliders icon), which opens the Settings modal.

The app opens on **Heroes** the first time, then on the tab you last left. On the first launch,
before anything is captured, **Heroes** and **Gear** show the capture steps instead: "No account
captured yet", which step is next (in the capture pill's words), a **Step by step in Settings ›
Setup** link, and the install plugin → launch game → reach the lobby path. The install / launch
button itself is the header's (or Setup's).

---

## A typical session

1. Launch the app — with the game open or not.
2. The snapshot reloads itself: the latest capture imports on launch, and while the game runs
   every lobby load and every move you make in-game reaches the app within seconds. **Reload**
   re-reads it on demand.
3. On **Heroes**, click **Optimize →** on the hero to work on: the **Optimizer** opens on them,
   with the filters you left them with.
4. Set what you want, or let the reco do it: with no priority set, **Solve** takes the weights of
   the hero's Outerpedia reco; **Load reco** (Library) loads the whole reco (mains, effects,
   sets, priority); the **Priority** popover sets the weights by hand; **CP** needs none.
5. Add rules if you need them — **Sets**, **Mains**, **Weapons**, **Talismans**, **+15 passives**,
   **Stat filters**…
6. Click **Solve**.
7. Read: click a row of the table; **Current → Projected** shows the stat change, the line above
   the cards gives **ΔCP**, the cards show the pieces.
8. **+ Worklist** to queue the changes, or **Apply to snapshot** (game closed) to rewrite your
   local snapshot only — nothing is ever sent to the game.
9. Make the changes in-game, from the **Worklist** tab.
10. The Worklist cleans itself: the lines you did leave on the next capture (or as soon as the
    app sees the move, with the game open), and a notice says so.

---

## Heroes — your roster

One card per **equipped** hero, showing their **composed final stats** — computed exactly the
way the game does (validated to match the in-game character sheet) — their **CP**, and the
in-game preset they wear when their loadout matches one (EE aside).

- **Rank** — the box at the left of each card: 1 = most important, type a position, or drag the
  ⠿ handle with **Sort: Rank**; empty = unranked = lowest. Every new hero gets a rank by CP as
  soon as a capture is imported. The rank is what the Optimizer's **Equipped items ≤ Lower**
  reads: a hero only takes pieces from heroes ranked below them.
- **Advice** — each card auto-flags notable things: missing gear, a lone set piece (no bonus),
  3/4 of a set (one piece away from the 4-pc — and when a free piece of that set for the missing
  slot sits in your inventory, not reserved in the Worklist for another hero, it says so),
  **wasted caps** (crit rate or penetration over 100%), **empty gem slots** on the Talisman / EE,
  **upgrade headroom** (pieces with unused reforges, 6★ pieces not yet ascended) and
  **poor-quality** pieces (Gear's quality tier).
- **Inspect a piece** — hover an equipped piece to see the same piece card as in Gear.
- **Optimize →** — opens the **Optimizer** on that hero.
- **Roster filters** — **Search hero…** (the same search as every hero picker: the name shown,
  nickname, base name or id; "fusion" finds the Core Fusion heroes), element and class chips,
  **Sort** by **CP** (the default) or by **Rank** (rank 1 first, unranked last, then CP), and
  **Reset** (clears the search and the chips, keeps the sort). They stay when you switch tabs and
  reset on the next launch. (A lock-state pill
  also appears if you enable the stat-lock tooling in **Settings › Advanced**.)
- **Notes** — jot a per-hero note (kept across relaunches).

---

## Optimizer — optimize a hero

The heart of the app: pick a hero and it searches *your* gear for the best combinations. The
layout is dense (Fribbels-style): two rows of controls at the top, the results table under them,
the selected build's piece cards under the table, a column of panels on the right and a status
footer at the bottom. Each hero keeps their own filters (priority, sets, mains, effects, bands,
options, reforge mode), saved as you change them and kept across relaunches.

### Toolbar, first row: hero and Solve

- **Hero** — the portrait, then the picker: type in **Search hero…** (name shown, nickname, base
  name or id; "fusion" finds the Core Fusion heroes), ↑/↓ then Enter or a click. The list follows
  your hero **Rank** (rank 1 first, unranked last, then capture order) — the same list, search
  and order as in **Don't take from…** and the Presets tab's **Reference** / **Associated**
  pickers.
- **Score | CP** — the mode, next to the **Solve** button (picking one doesn't start a solve;
  back to Score on each launch).
  - **Score** maximizes a **Score** weighted by the hero's substat **priority**. Use it when you
    know which stats you want.
  - **CP** maximizes the in-game **Combat Power** number. One objective, no tuning needed.
- **Solve** — runs the mode shown. In **Score** with no priority set, it first loads the hero's
  Outerpedia reco (the button reads **Loading reco…**) and takes its weights (only its priority,
  from its first build); the priority then stays with the hero like one you set. If the hero has
  no reco (or it can't be loaded), that solve goes by Combat Power instead and a toast says so.
- **Cancel** — the Solve button turns into **Cancel** while a solve runs. You usually get no
  partial results — only work chunks that had already fully finished are kept (most cancels
  happen mid-chunk, so typically none).
- **Filter** — after a solve, re-applies the **Stat filters** and **Ratings** bands to the
  results you already have, without solving again (instant). **✕** next to it shows every result
  again.

### The priority banner

Under the first row, while the hero has no priority of their own, a banner says what Solve will
do: "No priority set — Solve will use the outerpedia reco's weights" (or, for a hero without a
reco, "— Solve will use Combat Power"), with **Load reco** (the whole reco, as in the Library),
**Set priority** (opens the **Priority** popover) and **Use CP** (switches to CP and solves).
Once Solve has set the reco's weights, it reads **Priority from outerpedia reco · Edit · Clear**
until you change them (**Clear** puts every weight back to 0).

### Toolbar, second row: reforge and quick toggles

- **Reforge** — four modes: **Off** / **+10R6** (preview pieces at +10, not ascended — 6
  reforge ticks) / **+10R9** (preview at +10 ascended — 9 ticks, same main stat as +10R6, no
  Singularity passive) / **+15R9** (preview at +15 fully ascended — 9 ticks plus the
  Singularity passive). Lets you compare builds as if the gear were maxed — each piece up to
  its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stops at +10 with its own
  number of reforges and no Singularity passive, whatever the mode. The default for a hero's
  first solve is set in **Settings › Solver**, **+10R6** out of the box; the mode you pick for a
  hero stays with their filters.
- **Maxed only** — no extrapolation: only pieces **already at their own ceiling in the reforge
  mode (or better)**, scored on their real rolls (no projection). Off: any piece as-is ·
  +10R6: +10 with ≥ 6 reforges done · +10R9: +10 with ≥ 9 reforges · +15R9: +15 with ≥ 9
  reforges (the talisman, which stops at +10, only needs +10; a piece that can't ascend only
  needs +10 and its own reforges — a 5★ at +10 with 5 reforges counts as maxed). Use it to
  answer "what's my best build with zero further investment?".
- **Transistone potential** — on a 6★ Legendary with no tier-4 substat, a Transistone can
  reroll one line up to tier 4 (a 5 % draw per pass, reforges kept); a piece already holding a
  tier-4 line can't get a second one but can still raise a line to tier 3 (a 3/3/3/3 can become
  4/3/3/3, a 4/4/3/2 can become 4/4/3/3). This toggle previews the best case: the hero's
  highest-priority line (else the largest roll) raised that far, marked `T+n` on the result
  cards. Works with or without a reforge mode; ignored under **Maxed only**. The default for a
  hero's first solve is set in **Settings › Solver**, off out of the box; the choice you make for
  a hero stays with their filters.

### The filter popovers

The buttons on the right of the first row, on one line (below the hero in a narrow window) —
**Stat filters**, **Ratings**, **Priority**, **Mains**, **Sets**, **Weapons**, **Accessories**,
**Talismans**, **+15 passives** — and **Options**, first on the second row ahead of
**Reforge**, open one popover each; the number on a button
is how many rules it holds. Esc or a click outside closes it.

- **Priority** — a slider per stat (−1 to 3): higher = the solver values it more; **(clear)**
  puts them all back to 0. Under the sliders, **Top %**: a speed / quality dial (5 to 100, 100 =
  search everything). Lower = faster but may skip the absolute-best build — a warning above the
  table says when a search would take minutes.
- **Sets** — two modes. **Require**: click an armor-set icon to cycle off → 2pc → 4pc → off in
  the active plan; a plan is an AND group (2pc A + 2pc B), **+ OR** adds an alternative plan, and
  a build matches if any plan holds (the **Match:** line spells it out). Steps your gear can't form
  are skipped. **Exclude**: click a set to keep it out of every build, whatever the plans. Pair a
  required set with **Allow broken sets** (Options) to still let the remaining slots be anything.
- **Mains** — for Weapon / Accessory / Talisman, click a main-stat icon to cycle off → allowed →
  excluded. Allowed = the mains you'll accept for that slot; excluded = never use a piece with
  that main — e.g. rule out ATK talismans when a teammate already brings one (talisman mains are
  shared by the team and don't stack). Only the mains you own appear.
- **Weapons** and **Accessories** — click an effect icon to cycle off → required → excluded.
  Required = only the pieces rolling one of the required effects; excluded = never that effect.
  Empty = any effect. Only the effects you own (for the hero's class) appear.
- **Talismans** — the same cycle, but each chip shows the talisman itself (the art of the first
  one you own, on its rarity plate as in Gear), not its effect icon. A talisman advised by **Load reco** starts *preferred*
  (dotted outline): used if you own one (any star of the same family), otherwise any talisman is.
- **+15 passives** — three groups, **Weapon**, **Accessory** and **Armor** (the four armor pieces
  together), each listing the Singularity passives your pieces of that group already carry
  (DS DMG+, vs Fire DMG+, DMG-…); a group with none says *no +15 passive*. Click one to cycle
  off → required → excluded. A required passive gets the five grade letters **C B A S S+** beside
  it, bold, in the colors a piece's card shows them in: click one to set the minimum grade (C =
  any grade); only the pieces carrying the passive at that grade or better stay, e.g. **DS DMG+**
  required at **A** keeps the weapons with DS DMG+ in A, S or S+. Several required passives in a
  group = any of them. A piece without a passive (below +15) is dropped as soon as its group has
  a required one — the filter never guesses the passive a piece would roll at +15 — and an
  excluded passive drops the pieces carrying it at any grade. When a slot ends up empty, the
  footer names the pieces the passive filter dropped. A required passive also **counts**: asking
  for DS DMG+ (or vs Fire DMG+, DMG-…) means building for that content, so the value of the
  passive each piece carries goes into **DMG UP%** (weapon, accessory) or **DMG RED%** (armor) —
  and into the ratings and stat filters. The cell then shows a small cyan **+15**; hover it for
  the passives counted.
- **Stat filters** — min / max on any final stat (e.g. SPD ≥ 200). Gems: a stat filter's minimum
  is served before the priority — a build short of it gets that stat's gems first, the priority
  fills the remaining slots; a build that only passes with its socketed gems keeps them (its
  cards then show the pieces' own gems).
- **Ratings** — the same on the computed ratings (Cp, HpS, Ehp, EhpS, Dmg, DmgS, Mcd, McdS,
  DmgH), on **Score** and on **Swaps** — hover a name for what it measures.
- **Options** — **Equipped items**, which gear worn by *other* heroes the solver may take:
  **None** (only the hero's own gear + free gear), **≤ Lower** (default — also gear on heroes
  ranked strictly lower on Heroes; with no ranks set this falls back to own + free gear) or
  **All** (any equipped gear). Pieces **reserved by a Worklist entry** count as worn by the
  queued hero, so solving your next hero respects what earlier queued builds already took
  (under **All**, reservations are ignored like equipment is). **Keep current** keeps the slots
  the hero already wears (gems are still re-allocated). **Allow broken sets** (on by default):
  off, every armor piece must complete a 2pc / 4pc. **Min quality** drops pieces below a
  quality tier (Talisman / EE are always kept). **Don't take from…** keeps the gear worn by the
  heroes you tick out of the solve (same hero list and search as the hero picker; the button
  shows how many are ticked, ✕ clears them).

Pieces you marked **Never use** (in Gear, or on a result card) never enter a solve, and neither do
the pieces of a **locked** preset (see Presets).

**reset filters**, at the right end of the row, puts every filter back to the defaults (the
reforge mode and Transistone potential of **Settings › Solver**).

### The results table

- One row per build, with a red→green **heatmap** per column (**Settings › Display** turns it
  off): sets, the stats, the ratings, **Score**, **Swaps** (how many slots change vs the
  hero's loadout — not upgrades to do) and **to do** (how many of the six gear pieces still have
  to be enhanced, reforged or ascended to reach the build in the solve's reforge mode — talisman
  and EE not counted; 0 = the build is reached as is; hover for the detail, e.g. *3 pieces — 2 to
  enhance (+10 → +15), 5 reforges, 1 to ascend*; hidden with reforge **Off**). The first row is
  selected after a solve.
- Click a column header to sort; **right-click** a header (or the **columns** button) to show or
  hide columns. **Right-click a value** (a stat, a rating or CP) → **Min ≥** / **Max ≤** that value:
  the bound lands in the filter popovers and the solve re-runs.
- **height**, above the table, sets how many rows show before it scrolls (5 to 15; the same value
  as **Settings › Display › Result rows**).
- A crit rate past the in-game 100 % cap shows as **100% ⁺42** (the overflow in amber; hover for
  the raw value and how much is wasted past the 2 % buffer), and the column shades and sorts on
  the raw value — the **Current → Projected** panel shows it the same way.
- No result? The table says why: which slot dropped to zero pieces after the filters (and how
  many a main exclusion removed), or that **Allow broken sets** off rejected every armor
  combination.

### The right column

- **Current → Projected** — the hero's stats and CP with their loadout today, next to the
  selected build's, with the signed change per stat.
- **Effects** — the selected build's weapon / accessory passives and set bonuses.
- **Sub tick value** (is a flat or a % substat tick worth more for this hero?) and **Damage /
  +1%** (which stat gives the most damage per +1% — ATK / DEF / HP vs Crit Damage vs DMG
  increase).
- **Library**, for the hero on screen:
  - **Load reco** — loads the hero's Outerpedia reco into the filters (mains, sets, effects,
    priority); when the reco has several builds, you pick one.
  - **Save build + filter set** — keeps the selected build under a name you type, and the filters
    that produced it as a **filter set** under the same name.
  - **Save as local preset…** — type a name (12 characters max) and **Save**: the selected build's
    7 pieces (the EE left out) become a **local preset** on the Presets tab, with this hero as its
    reference. Nothing is sent to the game.
  - When the Optimizer was opened by **Optimize preset →**, a line says which preset is being
    optimized and what it keeps out.
- **Saved builds** — click one to load it back into the table and the cards; ✕ deletes it.
- **Filter sets** — click one to load it into the popovers (switch between, say, a crit build
  and a tank build without re-clicking every chip); ✕ deletes it.

### The selected build

Above the cards, a line sums up the selected build: **N slots change** and **ΔCP** against the
hero's loadout (outside **Off**, "ΔCP +X vs equipped (build at +10R6)": the build is counted in the
reforge mode, your loadout as it is now). Then two ways out:

- **+ Worklist** — queues the build's changes (the pieces, and the gems to socket on its
  Talisman / EE) on the **Worklist** tab, to do in-game. One entry per hero: if the hero is
  already queued, the button reads **Replace in worklist** and the new build replaces the old one.
- **Apply to snapshot** — applies the build's pieces to the hero in your captured snapshot. A
  confirmation says how many pieces move (and how many are taken off other heroes); on **Apply**
  it rewrites the snapshot and re-imports. Only the local capture changes, never the game: equip
  the pieces in-game yourself. Greyed out while the game runs with the capture plugin loaded
  (hover it for the reason: in-game moves already reach the app on their own).

### The piece cards

One card per slot, laid out like the game's equipment screen (Weapon, EE, Helmet, Armor /
Accessory, Talisman, Gloves, Boots). Each card is the Gear tab's piece card (the name with
**Never use** at its top right, then the piece icon with, beside it, the rarity, the slot and the
main stat(s), quality with its help and bar, the Singularity +15 effect), without the weapon / accessory
passive and the set bonuses, which the **Effects** panel lists for the whole build. On top:

- the **recommended gem allocation** on the Talisman / EE (with a **swap** badge when it differs
  from what's socketed);
- with a reforge mode on, the **projected** stats, with the ticks the projection added (`+n`) and
  the Transistone line (`T+n`);
- who wears the piece now (another hero — applying takes it off them —, this hero, or free), the
  piece it replaces when the slot changes, and **from preset ‹name›** when it sits in an in-game
  preset;
- **Never use**, top right of the card, which keeps the piece out of every solve from now on
  (**Never used — click to allow** brings it back).

**Why this piece?** Rest the pointer on a card for a moment (or move the keyboard focus onto it):
a popover tells what the piece brings **over the one the hero wears in that slot today**, in your
priority. The first line gives the score it adds (« +12.4 score vs the worn piece »); a negative
one (« −3.1 score — kept for its set / effect ») means the solver kept the piece for something the
score doesn't see — a set, a required effect, a main stat. Below, one row per weighted stat:
worn → this, the difference, its weight and its share of the score, then the total. Stats your
priority doesn't weight are summed up as « +N stats not weighted ». Both pieces are counted the way
the solve counted them (projected with a reforge mode on, the Talisman / EE with the build's gems);
set bonuses aren't, as they depend on the other pieces — the **Effects** panel shows them. A piece
the hero already wears just says « Already equipped ». The same in compact mode.

**Settings › Display › Compact result cards** shortens them: no piece icon (enhance, breakthrough
and stars next to the name), set names instead of piece names (« EE » for the exclusive), icon +
value stats with the substats two per row, gems as icons, one-line quality and effects (the
Singularity +15 bonus as grade + short label + value, e.g. « S+ DS DMG+ +12% » for DMG within
Dimensional Singularity or « vs Fire DMG- » for DMG taken from Fire targets; details on hover),
the talisman's passive moved to the hover text of its name, the EE and the talisman sharing one
card (seven cards, four then three, each half with its own icon), and a small **Never use** icon
at the top right instead of the button. A slot
the build leaves empty says so on its card (« No weapon in this build »).

### The footer

Pinned at the bottom: per slot, how many pieces survive the filters out of how many you own;
**P** (combinations explored), **S** (combinations that passed the filters and got scored),
**Results**; while solving, **solving…**, then the last solve's duration; and the number of
**workers** searching in parallel (**Settings › Solver**).

---

## Presets — your in-game equipment presets

One card per equipment preset saved in-game, in the **same order as the game's preset editor**
(favorites first): its number, name and ★ (favorite), its class icon, its 7 pieces laid out like
the game's equipment screen — Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots — and
the heroes **currently wearing** it (**Worn by**: a loadout identical to the preset, EE aside). The
EE is never part of a preset — each hero keeps their own: its cell shows the reference hero's EE,
dimmed. On a wide window an open card shows the pieces on the left and the heroes on the right.
Under each tile, the icon and value of the main stat that matters for it: the weapon's second main
(the one that changes — every weapon has flat ATK first), the accessory's and the talisman's main;
nothing under the helmet, armor, gloves, boots and EE (hover a tile's line for every main), the
set name under the armor pieces. Between the pieces and the heroes, three lines: **Quality** (the
six pieces' rolled substat ticks out of 6 × 23 = 138, each piece ascended and fully reforged;
hover for the cap at the pieces' current investment), **Offensive** (the +15 roll grade of the
weapon / accessory) and **Defensive** (helmet / armor / gloves / boots), "–" for a piece without a
+15 roll. Nothing is sent to the game.

- **The top line** — what a preset is, and the **loss threshold**: a **−/+** stepper inside the
  sentence (15 % by default, 5 to 50 % by steps of 5) sets when a hero's loss turns orange (see
  Scores below).
- **Class filter and sort** — the class chips show only the presets of the ticked classes
  (**Clear** resets them); **Sort: In-game** (the game's order), **Class** (grouped by class) or
  **Rank** (rank 1 first, unranked last). A preset's class comes from its class-restricted weapon
  or accessory, else from its reference hero, its wearers or its associated heroes.
- **Expand all / Collapse all** — open or close every card at once (in-game and local, filtered or
  not). A card you open or close by hand afterwards keeps it until the next Expand all / Collapse
  all. The chips, the sort and the open cards stay when you switch tabs, and reset on the next
  launch.
- **Reference** — the hero the preset was built for (solve them in the Optimizer as usual). If a
  single hero wears the preset, they're proposed by default.
- **Associated** — the heroes you plan to share the preset with (add with the picker, remove
  with ✕). They wear it as-is and adjust through their own EE gems.
- **EE gems** — the Talisman and its gems are part of the preset, but each hero keeps their own
  EE: the line lists the **EE gems** that score best for that hero with this preset (picked from
  their EE and from Talismans / EEs nobody wears — never from the preset's pieces or another
  hero's gear). A gem already in the right socket stays there.
- **Scores** — for the reference and each associated hero: the preset's **Score** (with that
  hero's priority and the EE gems proposed for them — the score with the gems as socketed today
  is shown in brackets when it differs), **Dmg** and **DmgS** — hover each for what it measures.
  An associated hero also shows how much they lose versus their own best known build — their
  latest **saved build**, or their current loadout without one. Both sides are scored on their
  real rolls: the saved build is rebuilt from its pieces as they are in your capture today (not
  the projected stats it was solved with), with the gems it allocated; if one of its pieces is
  gone (sold, dissolved), the current loadout is the comparison instead. Past the threshold the
  line turns orange: "Ame loses 23 % vs their saved build". The priority is the one set in the
  Optimizer for that hero — kept across relaunches, and a weight you change there counts here
  right away — else the one the hero's latest saved build was solved with ("priority from saved
  build"); a hero with neither gets no score — open them in the Optimizer and set one.
- **Overcap** — when the preset pushes a hero's **crit rate** past 102 % or their **penetration**
  past 100 %, the line shows a badge, the same as on the Heroes tab: "Crit rate 142% — 40% wasted
  over the 102% cap". From 10 points wasted the line turns orange; below, the badge alone. The
  badge's tooltip says when the proposed EE gems add to it.
- **+ Worklist** — on each hero's line: queues the preset's pieces that hero doesn't wear yet
  and the EE gems to socket as that hero's **Worklist** entry (replacing their previous one). A
  piece no longer in your inventory is left out, and the toast says so.
- **Optimize preset →** — on the reference hero's line: opens the Optimizer on that hero with the
  preset's weapon, accessory and talisman effects **required**, and up to five priority substats
  taken from what the preset already rolls and from Outerpedia's reco for the hero (its weapon
  and accessory main stats too). Sets are left open, and your stat bands and options stay as
  they were. The Optimizer's Library says where the substats come from; offline, or without a
  reco, they come from the preset alone.
- **Optimize →** — on an associated hero's line: opens the Optimizer on that hero, like on the
  Heroes tab.
- **Rank and lock** — each preset has a **rank**, like the heroes on the Heroes tab (1 = most
  important; type a position, or drag the ⠿ handle with **Sort: Rank**; empty = unranked =
  lowest; new presets get one in the in-game order as soon as a capture is imported).
  **Optimize preset →** never takes a piece from a preset ranked above or equal to it (unranked
  counts as lowest). The **Lock** button (🔒 **Locked** once on) keeps a preset's pieces out of
  every solve — any hero, any preset — except **Optimize preset →** on that preset itself; a
  locked card has an amber outline. A lock holds pieces, not gems: the gems on a locked (or
  higher-ranked) preset's Talisman can still be proposed, in the Optimizer as in the EE gems
  here. In the Optimizer, a proposed piece that sits in another preset says **from preset
  ‹name›** on its card.
- **Warnings** — a piece no longer in your inventory (**missing**), or a piece that sits in
  **two** presets (**shared** — two presets can't be worn in the same fight), is marked on the
  piece and in the card's banner. Empty presets are listed collapsed.
- **Local presets** — presets kept in GS only, to prepare a preset without touching the game:
  a name (12 characters, the in-game limit) and the 7 pieces, no EE. Make one from an Optimizer
  result (**Save as local preset…**, the Optimizer's hero as its reference) or with **Copy as
  local preset** on an in-game card (same pieces, the hero shown as reference, the name cut to 12
  characters). They're listed under the in-game presets, most recent first, on the same card
  with a **Local** badge: the pieces (a missing one is marked), the reference hero's line with
  their score and **Optimize →**. No rank, lock, associated heroes, Worklist or **Optimize preset
  →**; **Rename** in place, **Delete** asks for one more click (**Delete?**). They keep no piece
  away from a solve, and the class filter applies to them too.

---

## Worklist — queued gear changes

A cross-hero to-do list of gear swaps, fed from the Optimizer's **+ Worklist** button (and the
Presets tab's, labeled **Preset** on the card). Each queued build becomes a card for its hero (one
card per hero — a newer build replaces it), with one checkable line per changed slot — the target
piece's image, stats, and where it currently lives (which hero wears it, or Gear) — and one line
per gem to socket on the Talisman / EE, under its piece (gem, stat, and the gem it replaces). The
tab uses the whole window: on a wide one the cards sit two per row. The top line counts the
changes ("N changes across M heroes") and says whether their order matters.

- **Queued pieces are reserved** — a line above the cards says so. Until a piece line shows as
  **applied** (the snapshot has the piece on the hero) or you remove the card, the Optimizer treats
  the piece as already worn by the card's hero, so solving your next hero respects what earlier
  queued builds took: under **Equipped items ≤ Lower** only a higher-ranked hero can take it,
  under **None** nobody else, under **All** reservations are ignored. Ticking a line doesn't lift
  its reservation; gem lines and pieces gone from the inventory reserve nothing.
- **Links** — a card's hero (portrait and name, **Optimize →**) opens the **Optimizer** on that
  hero; on a line, **on ‹hero›** opens it on the hero wearing the piece now, and **in Gear**
  opens **Gear** with the piece shown in the detail panel (the view is kept when it shows the
  piece, reset to All without filters when it hides it).
- **Work through it in-game** — tick each line off as you equip it for real; on your next
  capture (or as soon as the app sees the move, with the game open), changes that are done are
  pruned automatically and a notice in the bottom-right corner says so.
- **Apply to snapshot** — per card, applies that hero's swaps to your captured snapshot (the same
  rewrite as the Optimizer's **Apply to snapshot**, never the game itself), so the rest of the app
  reflects them. Gems aren't socketed by the app: socket them in-game. If it fails, the card says
  why (game open, no snapshot, write error).
- **Apply all** — applies every queued change across all heroes in one snapshot rewrite, in an
  order that frees a piece before the build that reuses it.
- **Remove** — drops a card (no confirmation).
- The list stays truthful on its own: lines flip to **applied** when the piece lands on the
  hero (for a gem, once the piece holds it — in any socket), **contested** when two queued builds
  want the same single copy (resolve one before Apply all), and **piece gone** (amber) when the
  piece left your inventory — eaten as fodder, sold or dissolved in-game; a notice says so when it
  happens, and the line no longer counts in the tab's badge. Each line names its piece (and a
  Talisman's main) as it is now, so an enhance done in-game shows right away.

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

A dense, searchable grid of every gear piece you own.

- **Sub-tabs**: **All**, **Gear** (the six rolled-substat slots), **Special Gear** (Talisman + EE,
  which carry gems instead of substats).
- **Filters** (the Filter button, top-right): slot, rarity, star, **quality**, main stat, sub
  stats (AND/OR), armor set, class-restricted, **Hide equipped**, and three boxes next to
  it: **+0 only**, **T0 only** (no breakthrough) and **Not reforged**. Chips that can't
  match anything in the current view are greyed out so you never zero out the grid by accident.
- **Reachable quality** (in the Filter modal, right after Quality): the tier a piece would reach
  if a Transistone raised its best substat line to tier 4 — the "→ N reachable" of the piece
  card. Only a 6★ Legendary with four lines has that potential: one line can go up to tier 4,
  or up to tier 3 when the piece already has a tier-4 line (a 3/3/3/3 can become 4/3/3/3, a
  4/4/3/2 can become 4/4/3/3); a 4/3/3/3 or a 4/4/3/3 has nothing left to gain. Any other piece
  counts at its current tier. A **Good** piece that a reroll would push past 85 % shows under
  **Excellent** here and not under Quality's Excellent. Talismans and EE have no quality score and
  never match.
- **+15 passive** (in the Filter modal, after Secondary Stat): one pill per Singularity passive a
  piece of the current view carries (DS DMG+, vs Fire DMG+…, the full name on hover); ticking
  several keeps the pieces carrying any of them, and the grade letters (**C B A S S+**, in the
  card colors, C = any) keep only those at that grade or better. No pill ticked = the section is
  off, its grade letters grayed out. A piece below +15 has no passive and never passes; a Scrap
  rule shows the section as e.g. `DS DMG+ ≥ A`.
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
  remove it, also when the filter set changes the slots or the sub-tab: nothing is dropped
  without a click of yours, and a line above the grid counts them ("2 filters without an
  available piece"). The built-in **Scrap candidates** (always first, can't be deleted) shows the unequipped
  5★ / 6★ gear at +0, T0, never reforged, with Base rolls **not at least 3/3/3/X** — the pieces
  without three lines at 3.
- **Sort**: by enhance level, stars, breakthrough, or by a specific substat's value.
- **Scrap value** (a card under the piece card, once a filter is set or pieces are selected): what
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
  a click on a tile selects or unselects it and shows its card; outside the mode a click only
  shows it, and **Ctrl+click** always selects or unselects. **Select all shown** adds the pieces on
  screen, **Select never used** the pieces marked **Never use**, **Clear** empties the selection.
  A selected tile carries an amber check in its top-left corner. Leaving the mode keeps the
  selection; it lasts until you clear it or close the app (switching tabs keeps it, the mode and
  the piece shown too), and a piece that leaves the inventory leaves it too.
- **Click any piece** → the left panel shows its piece card: main stat(s), substats with their
  tick counts (or gems for Talisman/EE), reforge / breakthrough / Singularity state, a
  **quality score**, and the piece's own and set passives. **Never use** at the card's top right (or
  a right-click on the tile) keeps the piece out of every solve, marked ⊘ on its tile; **Never used
  — click to allow** brings it back. **Optimize wearer →**, under the card, opens the **Optimizer**
  on the hero wearing the piece (greyed out on a free piece); a click on the wearer's portrait in the
  card does the same.

> Sorts and filters reset to their defaults each time you relaunch the app — so you always
> start from a clean view. Filter sets are kept.

### Scrap

The same grid, set up to pick what to sell or dissolve:

- It opens on the **Scrap candidates** filters (the built-in filter set above) and keeps its own
  filters, apart from Pieces'. They are **rules**: a row of chips under the slot bar shows one per
  rule (`1 · 5★ 6★ · not ≥ 3/3/3/X · …`). Click a chip to make it the active rule — **Filter** and
  the slot bar edit that one; **+ Rule** adds an empty rule and opens Filter on it; **×** removes a
  rule. With two rules or more the grid shows the pieces matching **any** rule (the line "Pieces
  matching any rule" says so), and the Scrap value card prices them together: for example
  "6★, not ≥ 3/3/2/X" plus "5★".
- The link at the right of the slot bar puts the rules Scrap opens on back. To choose them, pick a
  filter set in **Filter › Filter sets** and click **Use for Scrap**: it is added as one more rule
  (marked "(Scrap default)" in the list); on a set already in, the button reads **Drop from Scrap**
  and removes it. The link carries the names of these sets (`Scrap candidates + 5★ junk`).
  Deleting a set drops it; when none is left Scrap goes back to **Scrap candidates**.
- **Selection mode is on**: a click on a tile selects or unselects it (and shows its card).
  The selection, the sub-tab, the sort and the piece shown are the same as in Pieces.
- The **Scrap value** card is always there: it prices your selection, or the pieces on screen when
  nothing is selected. When the synced game tables carry no sell / dissolve values, a line above the
  grid says so instead (sync game data in **Settings › Data & updates**).

An estimate only: nothing is sold or dissolved from the app — you do it in the game.

---

## Settings

The **Settings** button (top-right) opens a tabbed modal with six panes, in this order. **Esc**
closes it; it reopens on the last pane you visited (on **Setup** until the first setup check has
passed).

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
- **Display** — applied at once: results heatmap on/off, compact result cards (shorter piece cards
  under the Optimizer's results; Gear and tooltips unchanged) and **Result rows**, the height of the
  Optimizer's results table (5 to 15 rows, 12 by default — the **height** slider above the table sets
  the same value). **Reset display settings to defaults** puts these three back.
- **Backup** — **Export backup / Import backup**: one JSON file with everything you set up in the
  app — saved builds, filter sets (Optimizer and Gear), local presets, the heroes of your in-game
  presets, hero and preset ranks, locked presets, never-use pieces, the worklist, hero notes, the
  last filters per hero, the Optimizer layout, the Scrap default and your Solver, Display and
  developer settings (and the Presets loss threshold). The list is shown under the Export button.
  Never the captured gear: that comes from the game (re-capture it on the other PC). Import merges:
  builds and presets already present are kept; ranks, worklist entries, notes, the Scrap default
  and settings from the file replace yours (settings held within their bounds). A file exported by
  an older version (builds & presets only) still imports.
- **Advanced** — developer toggles (stat-lock tooling on Heroes, solver fan-out logging; safe to
  ignore), **Reset onboarding prompt** (shows Settings as the setup wizard on next launch), then the
  app journal (**Logs**: plugin install lines and every status message, kept for this session only)
  with **Copy** and **Clear**.

The Presets loss threshold is not in Settings: it is set on the Presets screen (see above).

---

## The menu bar

Hidden until you press **Alt**; its shortcuts work either way.

- **File** — **Quit**.
- **View** — **Zoom in** / **Zoom out** / **Reset zoom**, **Toggle full screen**, and **Toggle
  developer tools** (**F12** or **Ctrl+Shift+I**; that is where the solver fan-out logging of
  Settings › Advanced prints).
- **Help** — **User guide** (this wiki), **Report an issue** (the GitHub issues) and **About
  gear-solver**, with the app, Electron and Chromium versions.

There is no reload: **Ctrl+R** and **F5** do nothing, so a running solve or plugin install can't be
killed by a stray keypress. To pick up new game data, use **Settings › Data & updates › Sync game
data**.

---

## Keeping things up to date

- **App updates** — checked automatically; a **vX ready** badge appears in the header once one is
  downloaded, whatever the tab. Click it (or open **Settings › Data & updates**) and click
  **Install new version**. On Linux the AppImage needs to sit in a folder you can write to;
  otherwise the card reads **Manual** with the reason, and you download the new AppImage by hand.
- **Game data** — after an OUTERPLANE patch, the app refreshes its game tables on launch. You can
  also force it from **Settings › Data & updates › Sync game data**, then re-capture your account.
- **The capture plugin** — after a game update, the capture pill reads **Plugin update
  available** when the plugin needs a refresh: close the game and click **Update plugin** in the
  header (or in **Settings › Setup**).

Stuck? → **[FAQ & Troubleshooting](FAQ)**
