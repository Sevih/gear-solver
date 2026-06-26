# Home tab — dashboard + update center (for Claude Design)

> Paste this whole file into Claude Design. Goal: design a NEW **Home** tab —
> the default landing page of the app. It is two things at once: an **update
> center** (replaces today's two native popups with an auto-download + one
> "Install new version" button) and an **at-a-glance dashboard** of the user's
> account/inventory. Deliver a self-contained React + Tailwind artifact in our
> dark theme + a short rationale. Show the dashboard **populated** and the
> update card in **several states**.

---

## 1. What you're designing

**gear-solver** is a desktop (Electron) gear optimizer for the mobile gacha RPG
*Outerplane* (Fribbels-for-E7 energy). The user captures their account from an
emulator, browses gear/heroes, and runs a build solver. Today the app opens on
the **Inventory** tab; there is no landing page, and app updates are surfaced as
**two native OS dialogs** ("Download?" then "Restart?") that interrupt launch.

We're adding a **Home** tab that becomes the **default landing page**. It has two
jobs:
1. **Update center** — on launch the app checks GitHub releases, **auto-downloads**
   any new version in the background, and Home surfaces the state inline. The only
   user action is an **"Install new version"** button (→ restart + apply). No more
   native popups.
2. **Dashboard** — a calm, scannable overview of the captured account: roster +
   gear stats, capture/setup health, library counts, quick actions.

Desktop-first, single page (min ~1100×720; design at ~1480×920). Dark, dense but
calm — it's the first thing the user sees each launch.

## 2. Deliverable

- **1–2 dashboard layout directions** (e.g. a prominent update banner + stat-card
  grid, vs. a left "system/update" column + right stat grid). For each: a 2–3
  sentence rationale + tradeoffs.
- A **self-contained React + Tailwind** artifact, dark theme, §3 identity,
  realistic placeholder data.
- Show these states explicitly:
  - **Update card**: (a) up-to-date, (b) downloading with a % progress, (c)
    downloaded → "Install new version" CTA, (d) check failed / offline → Retry.
  - **Dashboard**: a fully-populated account (numbers everywhere), AND a brief note
    on the **empty state** (no capture yet → a "Capture your account" CTA).
- **Port target**: plain React + Tailwind, our tokens, standard flex/grid, no
  exotic deps. Reuse our existing primitives (stat readouts in JetBrains Mono,
  pill toggles, section labels).

## 3. Visual identity (stay on-brand — this is a port, not a rebrand)

- **Type**: Space Grotesk for UI; **JetBrains Mono for all numbers** (counts,
  versions, %, tabular-nums). Section labels tiny, UPPERCASE, wide tracking,
  muted (`text-white/70`). Compact scale (≈10–13px), headline numbers can be larger.
- **Surfaces**: near-black background, elevated cards in a slightly lighter
  charcoal, hairline borders (`border-white/8`), `rounded-lg`/`rounded-xl`. Quiet.
- **Color is meaning, used sparingly**:
  - **Cyan `#22d3ee`** = primary action (Install new version, Capture).
  - **Emerald** = healthy/up-to-date/ready; **amber** = attention (setup not
    ready, update available); **rose** = error/offline.
  - **Gold `#fbbf24`** = stat values; **violet `#9D51FF`** = brand accent.
  - Element colors (roster breakdown): Fire `#ff6b6b`, Water `#4dabf7`,
    Earth `#51cf66`, Light `#ffe066`, Dark `#cc5de8`.
  - Gear quality tiers (Poor→Perfect): a 5-step ramp (e.g. zinc → blue → violet →
    gold → cyan) — pick a tasteful scale.
  - **Singularity gradient** cyan→violet→magenta for "ascended" accents.
- Default text **white**; reserve `text-zinc-400/500` for secondary metadata.

## 4. The Update card (centerpiece — design all states)

This replaces two native dialogs. Behavior: launch → silent check → **silent
auto-download** → Home shows the result. Render these states (one component,
state-driven):

| State | Content | Action |
|---|---|---|
| **Up to date** | "Outerpedia Gear Solver `v0.5.0` · up to date" + game-data version (short SHA) | (none, or "Check again") |
| **Checking** | "Checking for updates…" + spinner | — |
| **Downloading** | "Downloading `v0.6.0` — **42%**" + a progress bar | (auto; optional Cancel) |
| **Downloaded** | "`v0.6.0` ready to install" | **Install new version** (cyan, primary) → restart+apply |
| **Error / offline** | "Update check failed — offline?" (muted, not alarming) | **Retry** |

Also show, always: **app version** + **game-data version** (short SHA) as small
mono metadata (the user wants to know what they're running). The Install action
restarts the app — make that consequence legible (small "app will restart" note).

## 5. Dashboard content (what goes on Home)

All data below is already available to the renderer (inventory, capture status,
emulator/setup readiness, versions, saved builds/presets in localStorage). Group
into cards. **Core** sections must be present; **optional** can be cut/merged.

### CORE
- **Account snapshot** — big numbers: **N heroes owned**, **N gear pieces**,
  **last capture** ("3h ago"), a **capture status** pill (● armed / ○ idle).
- **System / setup health** — capture pipeline + emulator/ADB readiness. If NOT
  ready: an amber row "Setup incomplete — Open setup". If ready: quiet ✓ + a
  "Sync game data" / "Arm capture" affordance.
- **Gear quality distribution** — counts (and a stacked/segmented bar) across the
  5 tiers **Poor · Decent · Good · Excellent · Perfect**. The headline "interesting
  stat" — make it the visual centerpiece of the dashboard.

### USEFUL
- **Roster breakdown** — small bars/chips: by **element** (5, element-colored), by
  **class**, by **stars** (6★/5★/…). Compact.
- **Gear breakdown** — by **slot** (8 mini counts), **top owned armor sets**
  (top ~5 by piece count, set icon + count), and quick counters: **ascended**,
  **+15 maxed**, **locked**.

### OPTIONAL (cuttable)
- **Library** — **N saved builds** · **N filter presets**, link to the Builder.
- **Quick actions** — a row: Capture · Sync game data · Settings · Open Builder.

Numbers dominate; keep each card scannable in <1s. Don't invent data not in §5/§4.

## 6. States & layout notes

- **Empty (no capture yet)** — the whole dashboard collapses to a single centered
  CTA: "No account captured yet — Capture your roster" + a short how-it-works line.
  (The update card still shows.)
- **Loading** — game/inventory load async; cards can show skeleton/`—` placeholders.
- Default landing tab → it should feel like a *home*, not a settings dump: lead
  with identity (who am I: roster + gear counts) and the one thing that may need
  action (update / setup), let the deeper stats sit below.

## 7. Constraints

- Centered nowhere — this is a **full-page tab** inside the existing app shell
  (top nav already has Inventory · Builds · Builder; Home is added first).
- Desktop-first, no mobile layout. Design ~1480×920, must hold ≥1100px.
- **Port target**: plain React + Tailwind, our tokens, JetBrains-Mono numbers,
  reuse pill/section/stat primitives. No charts library — bars are divs.
- Calm and fast to read. It's the launch surface, seen every session.

## 8. What we'll judge

- Does the **update card** read clearly in every state, with the "Install new
  version" CTA obvious and the version metadata legible?
- Is the dashboard **scannable at a glance** — identity + health up top, the gear
  quality distribution as the hero stat, deeper breakdowns below?
- Does it feel like a **home/landing**, calm and on-brand, not a metrics dump?
- Could we hand-port it with our primitives in an afternoon?
