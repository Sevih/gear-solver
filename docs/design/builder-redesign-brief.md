# Builder tab — redesign brief (for Claude Design)

> Paste this whole file into Claude Design. Goal: rethink the **Builder** tab's
> full-page layout. Show **2–3 genuinely distinct directions** (don't converge),
> each as a self-contained React + Tailwind artifact in our dark theme, with a
> short rationale + tradeoffs per direction.

---

## 1. What you're designing

**gear-solver** is a desktop (Electron) gear optimizer for the mobile gacha
RPG *Outerplane*. It's a power-user tool (Fribbels-for-E7 energy): the player
imports their account, picks a hero, sets constraints, runs a brute-force
"solve" over their gear, and reads a ranked table of candidate builds.

The **Builder** tab is the optimizer cockpit. Its job, top to bottom:
**configure a solve → run it → read ranked results → inspect the winning gear.**
It is information-dense by nature and desktop-first (min width ~1100px). The
current layout works but feels cluttered and un-hierarchical — that's what we're
fixing.

## 2. Deliverable

- **2–3 distinct full-page layout directions** for the Builder tab. Diverge on
  structure (e.g. left config-rail vs top toolbar vs normalized card grid), not
  just spacing. For each: a 2–3 sentence rationale + what it trades off.
- Each as a **self-contained React + Tailwind** artifact, dark theme, using the
  visual identity in §3. Realistic placeholder data is fine.
- Keep it **implementable**: we hand-port the winner into a real React/Tailwind
  codebase, so favor standard Tailwind, fl/grid, no exotic deps.

## 3. Visual identity (stay on-brand — this is a port, not a rebrand)

- **Type**: Space Grotesk for UI; **JetBrains Mono for all numbers/stats/data**
  (tabular-nums). Compact scale (≈10–13px). Section labels are tiny, UPPERCASE,
  wide letter-spacing, muted (`text-white/70`).
- **Surfaces**: near-black background, elevated cards in a slightly lighter
  charcoal, hairline borders (`border-white/8`), `rounded-lg`. Quiet, not flashy.
- **Color is meaning, used sparingly**:
  - **Cyan `#22d3ee`** = the primary *Solve / optimize* action only.
  - **Violet `#9D51FF`** = brand accent.
  - **Gold `#fbbf24`** = stat values / numbers.
  - **Amber** = star rows; **Singularity gradient** cyan→violet→magenta for
    ascended gear.
  - **Emerald→rose** continuous heatmap on the results table (good→bad per
    column).
  - Required chips = cyan tint; excluded = rose tint; off = dim.
- Default text is **white**, not gray; reserve `text-zinc-400/500` for genuine
  secondary metadata.

## 4. Current layout (what exists today)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TOP BAND — 9 cards in a flex-wrap row (THE MAIN PROBLEM: ragged, no group): │
│ [Hero] [Stats] [Options] [Stat filters] [Rating filters] [Substat priority] │
│ [Accessory mains] [Sets] [Weapons & accessories]   ← wrap at varying widths │
├──────────────────────────────────────────────┬────────────────────────────┤
│ RESULTS TABLE (sortable, color heatmap,       │ LIBRARY (right sidebar)    │
│  virtualized up to 1000 rows, height slider)  │  Get preset / Save build / │
│                                               │  Save preset · Saved builds│
│                                               │  list · Filter presets list│
├──────────────────────────────────────────────┴────────────────────────────┤
│ BOTTOM GEAR BAND — the selected build's 8 gear cards (one per slot)         │
├────────────────────────────────────────────────────────────────────────────┤
│ FIXED FOOTER — live solve progress (permutations / searched / pool sizes)   │
└────────────────────────────────────────────────────────────────────────────┘
```

The top band is the pain point: nine cards of different widths/heights wrap
unpredictably, with no grouping or visual hierarchy — the eye can't tell the
"set the target" controls from the "constrain the search" controls from the
"filter the pieces" controls.

## 5. Functional inventory — every control MUST survive the redesign

Nothing here can be dropped. Grouping, collapsing, tabbing, or re-flowing is
welcome; *hiding a needed control behind deep navigation is not* (the common
path — pick hero, set a couple of priorities, solve — must stay fast).

**A. Target / run** (today: "Hero" card)
- Hero combobox (searchable, keyboard nav) — the hero to optimize for.
- A small read-out of that hero's current snapshot stats.
- **SOLVE** (score mode) and **SOLVE CP** (in-game Combat Power mode) buttons —
  this is THE primary action, cyan. A Cancel state while solving. A reset-filters
  link.

**B. Stats read-out** (today: "Stats" card)
- 12 final stats (ATK, DEF, HP, SPD, CRC, C.DMG, CDR, PEN, DMG+, DMG-, EFF, RES),
  shown as **current vs projected** (projected = the selected result row's build).

**C. Search options** (today: "Options" card)
- 4 toggles: Use reforged stats · Only maxed gear · Include gear equipped on
  other heroes · Keep current (lock equipped, only fill empty + re-allocate gems).
- Exclude-heroes multi-select (lock specific heroes' gear out of the pool).

**D. Stat filters** (today: "Stat filters" card)
- Per-stat **min/max** numeric bands on the 12 final stats (most empty most of
  the time; it's a wide but sparse grid).

**E. Rating filters** (today: "Rating filters" card)
- Per-rating **min/max** bands on derived ratings: HpS, Ehp, EhpS, Dmg, DmgS,
  Mcd, McdS, DmgH, CP, Score, Upg.

**F. Substat priority** (today: "Substat priority" card) — *the heart of a solve*
- Per-stat weight on a **−1…3** scale for the 12 stats (drives Score + pruning).
- A **Top %** slider (5–100): keep only the top X% of each slot's pool by
  priority score. Shows a "no effect until a priority is set" hint when priority
  is empty. A "clear" link.

**G. Accessory / main-stat picks** (today: "Accessory mains" card)
- Per-slot OR-list of acceptable **main stats** for weapon / accessory / talisman
  (each slot shows its owned main-stat options as toggle chips).

**H. Sets** (today: "Sets" card — recently rebuilt, keep its model)
- **Require / Exclude** mode toggle.
- *Require*: an **OR-of-AND plan editor** — plan tabs (`Plan 1 | Plan 2 | + OR`);
  the icon grid edits the active plan, cycling each set off→2pc→4pc→off; a
  read-only summary line "Match: SpeedSet ×4  OR  CritSet ×2 + DestSet ×2".
- *Exclude*: a global ban-list of sets (orthogonal to the plans).
- Set chips are icon tiles with a 2/4/✕ badge + rich tooltip (set name, owned
  count, 2pc/4pc effect text).

**I. Weapons & accessories effects** (today: "Weapons & accessories" card)
- Two icon-chip lists (Weapons, Accessories) of the effects present in the
  player's inventory; each chip cycles off→required→excluded (required = OR at
  the slot level). Chips show the effect icon (or initials fallback) + tooltip.

**J. Results table** (center)
- Virtualized, up to 1000 rows, sortable by any column (click header).
- Columns: a sets cell, 8 core stats (+ extra tail-stat columns appear when a
  filter targets them), ~6 rating columns, Score, Upg, an actions cell.
- **Continuous emerald→rose heatmap** per column.
- A **height slider** in the header (how many rows before scroll — so the gear
  band below stays visible). A "N builds" pill.
- Click a row → it drives the projected stats (B) and the gear band (L).

**K. Library** (today: right sidebar)
- **Get preset** (pull the hero's recommended build from outerpedia — busy state
  + result line + a build picker modal when multiple), **Save build**, **Save
  filter preset**.
- **Saved builds** list (click to load, trash to remove).
- **Filter presets** list (click to apply a saved filter set).

**L. Bottom gear band**
- The selected build's **8 gear cards** (weapon, helmet, armor, gloves, boots,
  accessory, EE, talisman): each shows the piece icon, name, +enhance / ascended,
  main stat, substats, and recommended gems (for talisman/EE). Em-dash
  placeholders when no build is selected.

**M. Footer (fixed, bottom)**
- Live solve telemetry: permutations, searched count, per-slot pool sizes,
  result count, a Solving… / done state.

## 6. Problems to solve

1. **No grouping / hierarchy.** The 9 top cards mix four very different intents:
   *(i) set the target* (hero, solve), *(ii) constrain the search* (options, stat
   filters, rating filters), *(iii) express intent* (substat priority + Top %),
   *(iv) filter the pieces* (mains, sets, weapon/accessory effects). They should
   read as distinct groups.
2. **Ragged wrapping.** Different card widths/heights wrap into an uneven mosaic.
   Want a regular, aligned rhythm at any window width ≥1100px.
3. **Weak visual flow.** The top-to-bottom story (configure → solve → read →
   inspect) isn't legible. Make the primary action (Solve) and the results
   obvious; let rarely-touched filters recede without disappearing.
4. **Density without calm.** It's a pro tool — keep it dense — but give it
   alignment, consistent spacing, and a clear typographic hierarchy so it stops
   feeling noisy.

## 7. Constraints

- Desktop-first, **single screen** ideally (min ~1100×720; design at ~1480×920).
  No mobile layout needed.
- **Keep every control reachable**; collapsibles / tabs / popovers are fine if
  the hero→priority→solve path stays 2–3 clicks.
- The **results table dominates** once a solve has run — give it room.
- Live/streaming: solving updates the footer continuously; the table virtualizes.
- It's a **port target**: plain React + Tailwind, standard flex/grid, our tokens.

## 8. Directions worth exploring (seeds, not a spec — surprise us too)

- **A — Left config rail:** a grouped, collapsible left column (Target ·
  Constraints · Priorities · Piece filters), results + gear taking the rest.
  Calm, scales to more filters later.
- **B — Toolbar + popovers:** a slim top toolbar (hero · solve · key options),
  the heavier filters living in labeled popover/drawer buttons; results go
  full-width. Maximizes result space.
- **C — Normalized card grid:** keep the card metaphor but lock it to a regular
  grid with explicit group headers ("TARGET", "CONSTRAINTS", "PRIORITIES",
  "PIECE FILTERS") and uniform card sizing.

For each direction, show the **configured** state (filters set) and the
**results** state (table populated, a row selected, gear band filled), so we can
judge the full flow — not just an empty shell.
