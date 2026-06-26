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
- **M6.5 — Solver polish.** Cancel mid-solve (`MessageChannel` yield), Upg column
  (calculée, triable, filtrable), Exclude-equipped multi-select, reforge simulation
  (`simulateReforges`, projetée jusqu'au bottom band), allocation de gemmes recommandée.
- **M7 (partiel) — Persistence.** Save/Remove build par héros + Filter presets par héros,
  en **localStorage** (`lib/storage/`). Bouton Optimize → (Builds → Builder).
- **Desktop Electron.** `apps/desktop` (main + serveur local + détection émulateur) —
  fonctionnel en dev.
- **Repo sync (images + game data).** Au lancement, l'app se synchronise sur le repo public
  `Sevih/outerpediaV2` (`data-sync.ts` dual-mode checkout/repo SHA-gated ; handler `/img/*`
  partagé cascade checkout→cache→CDN→302) → suit les patchs jeu **sans nouveau build**.
  Prod packagé encore à vérifier (M8).

## Next

### M7 (reste) — Persistence & sharing
- **JSON import/export** des builds/presets (partage / backup) — ✅ **livré**
  (`lib/storage/transfer.ts` + section Backup dans Settings + 8 tests).
- **Versioning du snapshot `data/`** pour invalider les caches localStorage après un patch.
- **Production build path** pour `data` (bake derived + snapshot dans le bundle prod).

### M8 — Packaging desktop (câblé, à vérifier)
- Le plumbing est en place (electron-builder `extraResources` baking `data/derived` dans
  `resources`, serveur local prod, `setupAutoUpdate` / `electron-updater`). Reste à le
  **vérifier end-to-end sur un vrai build packagé** : installeur fonctionnel, bake `data/`
  validé, auto-update testé contre une release signée + feed.

### Perf hot-path (au fil du profilage)
- Accumulateur de buckets incrémental (`aggregateGearBuckets` re-somme tout par combo) —
  hoist des set bonuses **livré**, re-sum par talisman encore déféré.
- Virtualisation de la table de résultats (topN=1000) — ✅ **livrée**
  (`@tanstack/react-virtual` + `memo(ResultRow)`).

> Equip / Unequip **vers le jeu** : hors scope tant qu'aucune API jeu n'existe (le pipeline
> de capture est read-only).

---

## Reference — solver internals (M5/M6 delivered)

### M5 — Solver core ✅
- Pruned cartesian search in a **Web Worker pool** (`hardwareConcurrency-1`, hard cap 64,
  embarrassingly parallel partition on the largest slot). Per-slot prefilter (main, effect,
  sets-excluded), Top-% substat prune, mid-tree set-feasibility prune, fixed-size top-K min-heap.
- Gem sub-solver greedy with pre-aggregated `{flat, pct}` delta per `talismanSlots` variant.
- Two modes: **SOLVE** (priority-weighted Score, CP computed lazily for top-N),
  **SOLVE CP** (CP in-loop as sort key).
- *Détails complets* : [docs/solver.md](solver.md).

### M6 — Solver UX ✅
- BuilderScreen (Fribbels-style dense layout) : 9 panneaux du haut, table résultats
  avec heatmap, bottom gear band 8 slots, footer fixé avec compteurs P/S/Results.
- État centralisé via `useReducer(SolverFilters)` — 13 actions, tous les inputs contrôlés.
- Boutons SOLVE / SOLVE CP / Cancel / Reset filters branchés sur l'orchestrator.

---

## Guardrails (don't scope-creep)

- **One game, one job.** No team-builder, damage sim, or PvP meta — just gear optimization.
- **Engine stays pure.** No DOM/Node in `packages/core`; data comes in as plain objects.
- **Capture stays external.** The app consumes JSON; it never embeds the MITM stack.
- **Derived data is generated.** Never hand-edit `data/derived`; change `data/build.mjs`.
- **Validate against reality.** New stat/formula work ships with a test pinned to a real
  captured item vs its in-game display.
