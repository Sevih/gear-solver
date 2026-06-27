# Roadmap

*Mirror of `docs/roadmap.md` (translated to English) — see the repo for the authoritative source.*

**North star:** for a chosen hero, find the best gear combinations from *your* inventory
under stat constraints and set requirements — fast, in the browser, from auto-imported data.

Stay focused: every feature should serve that sentence. Defer anything that doesn't.

---

## Done ✅

- **M0 — Capture.** One-button pipeline (`tools/capture`) decrypts the game server and
  writes account JSON. No pinning; XOR key recovered.
- **M1 — Data foundation.** Game tables copied to `data/game`, distilled to `data/derived`
  (`data/build.mjs`). Mappings ItemID→equipment, OptionID→stat (validated vs in-game),
  CharID→character. Engine parses a real inventory with resolved stats.
- **M2 — Auto-import.** Web app loads game data + latest capture automatically (Vite
  middleware serves `data/derived` and `tools/capture/out`).
- **M3 — Inventory UX.** Table, filters, per-piece detail (main/subs/ticks/reforge/BT/singularity),
  substat score per piece.
- **M4 — Stat model.** Main stat scaling (+0..+15, BT, singularity), set bonuses, character
  base + evo + class passive + Skill_8 + geas + codex compound — validated against
  `data/stat-locks.json` regression snapshots.
- **M5 — Solver core.** See entry below.
- **M6 — Solver UX.** See entry below.
- **M6.5 — Solver polish.** Cancel mid-solve (`MessageChannel` yield), Upg column
  (computed, sortable, filterable), Exclude-equipped multi-select, reforge simulation
  (`simulateReforges`, projected up to the bottom band), recommended gem allocation.
- **M7 (partial) — Persistence.** Save/Remove build per hero + Filter presets per hero,
  in **localStorage** (`lib/storage/`). Optimize button → (Builds → Builder).
- **Desktop Electron.** `apps/desktop` (main + local server + emulator detection) —
  functional in dev.
- **Repo sync (images + game data).** On launch, the app syncs against the public repo
  `Sevih/outerpediaV2` (`data-sync.ts` dual-mode checkout/repo SHA-gated; shared `/img/*`
  handler cascades checkout→cache→CDN→302) → tracks game patches **without a new build**.
  Packaged prod still to be verified (M8).
- **Home dashboard.** Home tab (`HomeScreen.tsx`): account snapshot (2×2),
  gear quality breakdown by tier with explanations, roster breakdowns
  (element / class / rarity), a 4-view **Gear breakdown** toggle (Overview /
  Class effects / full set catalog / Talisman × main-stat cross-tab), inline
  update center (no native popups).
- **Shared UI & inspection.** Extracted gear detail panel (`design/GearDetail.tsx`,
  `GearDetailBody`) **reused** by the Inventory (full panel) and the Builds tab
  (hover tooltip, `RichTooltip`). Builder kept mounted across tabs (preserves the
  results + background solve). Settings reworked into a tabbed modal
  (`design/SettingsModal.tsx`: Setup / Solver / Data / Backup / Debug).

## Next

### M7 (rest) — Persistence & sharing
- **JSON import/export** of builds/presets (sharing / backup) — ✅ **delivered**
  (`lib/storage/transfer.ts` + Backup section in Settings + 8 tests).
- **Session-scoped view state** — ✅ **delivered**: Inventory sorts/filters + Builds roster
  filters in `sessionStorage` (`useSessionState`), reset on each launch (`gs.builds.notes` stays durable).
- **Versioning of the `data/` snapshot** — stamp + surfacing ✅ **delivered** (`build.mjs` →
  `version.json` `{ hash, builtAt }`, stable content hash; shown in Settings → Data). **Remaining**:
  invalidating localStorage caches when the hash changes (prune SavedBuilds with vanished `pieceUids`).
- **Equipment editing** — core methods (`equipItem`/`unequipItem`) + `POST /api/captured/user-item`
  write-back + renderer client ✅ **delivered**; remaining: the Builder/Builds trigger UI.
- **Production build path** for `data` (bake derived + snapshot into the prod bundle).

### M8 — Desktop packaging (wired, to verify)
- The plumbing is in place (electron-builder `extraResources` baking `data/derived` into
  `resources`, prod local server, `setupAutoUpdate` / `electron-updater`). What remains is to
  **verify it end-to-end on a real packaged build**: working installer, validated `data/`
  bake, auto-update tested against a signed release + feed.

### Perf hot-path (as profiling dictates)
- Incremental bucket accumulator — ✅ **delivered**: `aggregatePrefixBuckets` sums the 6
  invariant pieces 1×/accessory, `computeFinalStatsFromPrefix` clones + adds talisman/EE/
  gems/sets (bit-identical, +4 equivalence tests). The set-bonus hoist was already delivered.
- SOLVE CP per-combo cost — ✅ **cut**: prepared CP evaluator (`makeCpEvaluator`, constant
  bonuses captured once, no `CpArgs` allocation) + cheap ratings deferred to finalize when no
  rating filter. **Structural remainder**: cut the **number** of combos (pool pre-filter, CP bound).
- Results table virtualization (topN=1000) — ✅ **delivered**
  (`@tanstack/react-virtual` + `memo(ResultRow)`).

> Equip / Unequip: **local** editing (rewriting the captured JSON) is delivered as methods +
> plumbing; pushing the change **to the game** stays out of scope as long as no game API exists
> (the capture pipeline is read-only).

---

## Reference — solver internals (M5/M6 delivered)

### M5 — Solver core ✅
- Pruned cartesian search in a **Web Worker pool** (`hardwareConcurrency-1`, hard cap 64,
  embarrassingly parallel partition on the largest slot). Per-slot prefilter (main, effect,
  sets-excluded), **set-based armor pool prune** (`armorSetWhitelist` — a fully-constraining
  set requirement drops out-of-set pieces; **Allow broken sets** toggle for the partial case),
  Top-% substat prune, mid-tree set-feasibility prune, fixed-size top-K min-heap.
- Gem sub-solver greedy with pre-aggregated `{flat, pct}` delta per `talismanSlots` variant.
- Two modes: **SOLVE** (priority-weighted Score, CP computed lazily for top-N),
  **SOLVE CP** (CP in-loop as sort key, prepared `makeCpEvaluator` + deferred ratings).
- `noCrit` heroes score with `pCrit = 0` (no phantom CHC/CHD reward).
- *Full details*: [Solver](Solver).

### M6 — Solver UX ✅
- BuilderScreen (Fribbels-style dense layout): 9 top panels, results table
  with heatmap, bottom gear band of 8 slots, fixed footer with P/S/Results counters.
- Centralized state via `useReducer(SolverFilters)` — 19 actions (grown since M6), all inputs controlled.
- SOLVE / SOLVE CP / Cancel / Reset filters buttons wired to the orchestrator.

---

## Guardrails (don't scope-creep)

- **One game, one job.** No team-builder, damage sim, or PvP meta — just gear optimization.
- **Engine stays pure.** No DOM/Node in `packages/core`; data comes in as plain objects.
- **Capture stays external.** The app consumes JSON; it never embeds the MITM stack.
- **Derived data is generated.** Never hand-edit `data/derived`; change `data/build.mjs`.
- **Validate against reality.** New stat/formula work ships with a test pinned to a real
  captured item vs its in-game display.
