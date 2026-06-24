# Roadmap

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

## Next

### M6.5 — Solver polish
- **Cancel mid-solve** : yield via `MessageChannel` toutes les ~50 ms pour que le
  bouton Cancel interrompe vraiment la boucle synchrone (sinon : attend la fin
  du chunk courant, 2-5 s typique).
- **Action buttons** sidebar : Equip / Save Build / Remove Build / Select All / Deselect All — placeholders aujourd'hui.
- **Exclude-equipped multi-select** : la liste `excludedHeroes` existe dans le
  reducer mais aucun UI n'écrit dedans.
- **Upg column** dans la table : nombre de slots améliorés vs build actuel.
- **Reforge simulation** optionnelle (toggle "Use reforged stats" est visuel).

### M7 — Persistence & sharing
- Persist inventory locally (IndexedDB); manual JSON import/export.
- Filter presets per hero (save/load).
- Production build path for `data` (bake derived + a chosen snapshot).
- Optional: package as Tauri desktop if a native capture button is wanted.

---

## Reference — solver internals (M5/M6 delivered)

### M5 — Solver core ✅
- Pruned cartesian search in a **Web Worker pool** (≤ 8 workers, embarrassingly parallel
  partition on the largest slot). Per-slot prefilter (main, effect, sets-excluded), Top-%
  substat prune, mid-tree set-feasibility prune, fixed-size top-K min-heap.
- Gem sub-solver greedy with pre-aggregated `{flat, pct}` delta per `talismanSlots` variant.
- Two modes: **SOLVE** (priority-weighted Score, CP computed lazily for top-N),
  **SOLVE CP** (CP in-loop as sort key).
- *Détails complets* : [docs/solver.md](solver.md).

### M6 — Solver UX ✅
- BuilderScreen (Fribbels-style dense layout) : 9 panneaux du haut, table résultats
  avec heatmap, bottom gear band 8 slots, footer fixé avec compteurs P/S/Results.
- État centralisé via `useReducer(SolverFilters)` — 11 actions, tous les inputs contrôlés.
- Boutons SOLVE / SOLVE CP / Cancel / Reset filters branchés sur l'orchestrator.

---

## Guardrails (don't scope-creep)

- **One game, one job.** No team-builder, damage sim, or PvP meta — just gear optimization.
- **Engine stays pure.** No DOM/Node in `packages/core`; data comes in as plain objects.
- **Capture stays external.** The app consumes JSON; it never embeds the MITM stack.
- **Derived data is generated.** Never hand-edit `data/derived`; change `data/build.mjs`.
- **Validate against reality.** New stat/formula work ships with a test pinned to a real
  captured item vs its in-game display.
