# Settings panel — redesign brief (for Claude Design)

> Paste this whole file into Claude Design. Goal: rethink the **Settings modal**
> from today's single stacked scroll into a **tabbed / sidebar-navigated** panel,
> and add a new **Solver** section. Deliver a self-contained React + Tailwind
> artifact in our dark theme, plus a short rationale + tradeoffs. Show **every
> tab populated** (not an empty shell) so we can judge the real density.

---

## 1. What you're designing

**gear-solver** is a desktop (Electron) gear optimizer for the mobile gacha RPG
*Outerplane* (Fribbels-for-E7 energy). The **Settings modal** opens from the
gear icon in the header, and **auto-opens on first launch** as a setup wizard.
It is a centered modal overlay (not a full page), dark theme, desktop-first.

Its job today is three unrelated things crammed into one scroll: **(1) a
first-run setup checklist** (is the emulator/ADB/root ready for capture), **(2)
data & backup actions**, and **(3) developer debug toggles**. We're now **adding
a fourth concern — solver tuning** — and the flat stacked layout no longer holds.
We want a **left-nav (tabs/sidebar) modal**: pick a section on the left, see its
controls on the right.

## 2. Deliverable

- **One primary direction**: a tabbed/sidebar Settings modal (left rail of
  sections, right content pane). Optionally a **second variation** on the nav
  treatment (e.g. icon+label vertical rail vs. slim top tab bar) — but converge
  on the left-rail idea; that's chosen.
- A **self-contained React + Tailwind** artifact, dark theme, using §3 identity.
  Realistic placeholder data/states.
- Show **each section populated**, and these specific states:
  - Setup with a **mix of pass/fail** checks (one failing, with its fix copy).
  - Solver with the worker field in **Auto** and in **manual override**.
  - A **danger** action (Wipe) and its visual weight.
- **Implementable**: we hand-port the winner into real React/Tailwind. Standard
  flex/grid, our tokens, no exotic deps. Reuse the existing control primitives
  in §5 (toggle switch, action row) — restyle, don't reinvent.

## 3. Visual identity (stay on-brand — this is a port, not a rebrand)

- **Type**: Space Grotesk for UI; **JetBrains Mono for all numbers** (worker
  counts, limits — tabular-nums). Section labels tiny, UPPERCASE, wide tracking,
  muted (`text-white/70`). Compact scale (≈10–13px).
- **Surfaces**: near-black modal (`bg-zinc-950`), hairline borders
  (`border-white/8`), `rounded-xl` modal / `rounded-md` controls. Section header
  strips on a faint `bg-white/2`. Quiet, not flashy.
- **Color is meaning, used sparingly**:
  - **Cyan `#22d3ee`** = primary affordance (the Re-check / confirm action,
    active nav item, an ON toggle).
  - **Rose** = destructive (Wipe) only.
  - **Emerald** = a passing setup check; **amber** = a failing/attention check.
  - Default text **white**; reserve `text-zinc-400/500` for secondary metadata
    and helper descriptions.
- Default size today is `max-w-lg`; a left-nav layout will want to be **wider**
  (≈`max-w-2xl`/`3xl`) and **height-capped** (`max-h-[90vh]`, content scrolls).

## 4. Current layout (what exists today)

A single centered modal, header + one long scroll of stacked sections + footer:

```
┌─────────────────────────────────────────────┐
│ Settings                                 [✕] │  header (title + subtitle)
├─────────────────────────────────────────────┤
│ SETUP STATUS                Target: …:5555  │  ← section strip
│  ✓ Android emulator installed               │
│  ✓ Emulator instance running                │
│  ! ADB Debug = Local Connection   (fix copy)│
│  · Root toggle ON                           │
│ DATA                                        │
│  [Sync game data]      … description  [Sync] │  ← action rows
│  [Reset onboarding]    …              [Reset]│
│  [Wipe captured data]  …  (danger)   [Wipe]  │
│ BACKUP                                      │
│  [Export builds & presets]          [Export] │
│  [Import builds & presets]          [Import] │
│ DEBUG                                       │
│  Stat lock & drift tooling (Builds)   (○ )  │  ← toggle rows
│  Solver fan-out logging               (○ )  │
├─────────────────────────────────────────────┤
│ Setup checks re-run on each open  [Close][Re-check] │  footer
└─────────────────────────────────────────────┘
```

Everything is always visible and the scroll mixes "one-time setup", "rare
destructive actions" and "dev toggles". Adding solver tuning makes it worse.

## 5. Functional inventory — every control MUST survive

Nothing is dropped. Re-group into left-nav sections; keep each control's exact
behavior. Suggested sections: **Setup · Solver · Data · Backup · Debug** (order
and naming open). The existing reusable primitives:

- **Toggle row** (`ToggleAction`): label + helper text on the left, a pill
  switch on the right (cyan when ON).
- **Action row** (`DataAction`): label + helper text + a right-aligned button
  (default or `danger` rose). Button can show a busy caption ("Syncing…").
- **Section header strip**: tiny uppercase label + optional right-aligned mono
  sub-note (e.g. `Target: 127.0.0.1:5555`).
- **Status dot**: ✓ emerald (pass) / ! amber (fail) / · dim (pending).

### A. Setup (today: "Setup status")
- A live checklist of **4 sequential checks** (probed from a backend on open):
  emulator installed · emulator running · ADB local-connection · root toggle ON.
- Each row: status dot + title + a mono detail line + (when failing) a paragraph
  of **fix instructions**. This is the most text-heavy section.
- A **Re-check** action (primary) re-runs the probe; a Close action. On first
  launch this section is the wizard and self-dismisses once all 4 pass.

### B. Solver (NEW — the reason for this redesign)
Four controls that tune the build search. All persist to localStorage.
- **Worker count** — how many parallel worker threads the solver pool uses.
  Default is **Auto** (= CPU logical cores − 1). An override field/stepper lets
  the user pin a number (e.g. to keep the machine quieter). Show the **effective
  value** and, as context, the machine's core count (e.g. "Auto · 31 of 32
  cores" or "Manual: 12"). Pattern: an **Auto ⇄ Manual** switch + a number
  input. Range 1…(cores). Helper: "More workers = faster solve, hotter/louder
  CPU. Takes effect on the next solve."
- **Result count** — how many ranked builds the results table keeps (default
  **1000**). Plain number input/stepper, range ~10…5000. Low-risk, user-facing.
- **Per-worker depth** *(advanced)* — internal heap size each worker keeps
  before the merge (default **1000**). **Mark it "Advanced"** (subtle warning
  tint / smaller, or behind a "Show advanced" disclosure): too low silently
  drops good builds (recall loss). Range ~100…5000.
- **Heatmap** — toggle the emerald→rose column shading on the results table
  (default ON). Simple toggle row.
- Nice-to-have: a **"Reset solver settings to defaults"** link at the section
  bottom.

### C. Data (today: "Data")
- **Sync game data** — refresh raw tables + rebuild derived data (busy state
  "Syncing…"). 
- **Reset onboarding prompt** — make this modal auto-open next launch.
- **Wipe captured data** *(danger)* — delete every imported snapshot; native
  confirm; blocked while capture is armed.

### D. Backup (today: "Backup")
- **Export builds & presets** — download a JSON file.
- **Import builds & presets** — merge a picked JSON (hidden file input).

### E. Debug (today: "Debug")
- **Stat lock & drift tooling (Builds)** — toggle dev tooling on Builds cards.
- **Solver fan-out logging** — toggle devtools logging of the solve (pool size,
  chunk count, workers, per-solve duration).

## 6. Problems to solve

1. **Four unrelated concerns in one scroll.** Setup (one-time), Solver (frequent
   power-user tuning), Data/Backup (rare), Debug (dev). They should be distinct,
   directly reachable sections — not a vertical pile.
2. **The new Solver tuning needs a real home** with clear control patterns
   (Auto/override, numeric steppers, an "advanced" affordance) that read calmly
   next to plain toggles.
3. **Hierarchy & weight.** A passing setup recedes; a *failing* check stands out
   with its fix. A *destructive* Wipe is visually distinct from a benign Export.
4. **Footer relevance.** "Re-check" is Setup-only — in a tabbed layout it
   shouldn't sit globally under unrelated sections. Decide: contextual footer
   per section, or move Re-check into the Setup pane and keep only Close global.

## 7. Constraints & details to honor

- It's a **centered modal**, not a full page. Click-outside / ✕ / Esc close it.
  Left nav + right scrollable content, height-capped, the content pane scrolls
  (the nav stays put).
- **Desktop-first**; design at ≈900×640 modal on a dark page. No mobile layout.
- **Port target**: plain React + Tailwind, our tokens, reuse the toggle/action
  primitives. Realistic copy is in §5.
- **Defaults & ranges** (so the controls read truthfully): Worker = Auto
  (cores−1); Result count = 1000 (10–5000); Per-worker depth = 1000 (100–5000,
  advanced); Heatmap = ON.
- **Don't** invent settings not listed. **Don't** rebrand — match the existing
  charcoal/cyan identity.

## 8. What we'll judge

- Does the left-nav make the four concerns instantly legible?
- Do the Solver controls (Auto/override, steppers, advanced marker) feel native
  next to the existing toggles/actions — calm, not noisy?
- Is the failing-setup-check still prominent, and the danger action still scary?
- Could we hand-port it in an afternoon with our primitives?
