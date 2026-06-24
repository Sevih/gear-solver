# TODO — backlog actionnable

Liste à plat de tout ce qui reste, groupé par sujet. Le détail des
milestones livrées vit dans [roadmap.md](roadmap.md) ; cette liste-ci est
le backlog opérationnel.

---

## Solver — polish (M6.5)

- [x] **Cancel mid-solve qui interrompt vraiment** — `solveChunk` est désormais async,
      yield via `MessageChannel` à chaque tick (~4096 combos) → cancel arrive en ≤ 20-50ms.
      MessageChannel choisi vs `setTimeout(0)` (4ms throttle dans les workers → 9.6s
      d'overhead pour 10M combos vs ~250ms avec MessageChannel).
- [~] **Action buttons sidebar** (RightSidebar) — refondu en panneau **Library** :
  - [x] **Save Build** + **Remove Build** câblés via le panneau Saved Builds (localStorage).
  - [ ] **Equip** : nécessite une API jeu inexistante — supprimé du UI pour l'instant. À reprendre si on trouve un moyen d'envoyer des commandes au jeu (capture pipeline pourrait être étendu).
  - [ ] **Unequip** : idem.
  - [x] **Select All / Deselect All** : supprimés (pas de sémantique batch dans la table actuellement).
- [x] **Exclude equipped multi-select** — combobox searchable avec checkboxes, count + clear ✕. Nouvelle action reducer `clearExcludedHeroes`. Réutilise le haystack du Hero picker.
- [x] **Upg column** dans la results table — calculé dans `finalizeBuilds` (slots dont `pieceUid ≠ équipé actuel`), affichée entre Score et Actions.
- [x] **Reforge simulation** — `simulateReforges(piece, priority)` dans engine.ts : greedy par `priority × per-tick value`, cap à LV6/sub, total = `star - reforgeCount`. Appelé dans `prepareContext` AVANT le top-% prune si toggle ON. 6 tests vitest couvrent les cas (no remaining / cap / empty priority / no mutation / funnel).
- [ ] **CP fallback `chainPassive`** — déjà plumbé via `userSkills`, mais vérifier
      qu'on lit la bonne colonne depuis l'inventaire capturé (`c.skills.chainPassive`).
- [ ] **Heatmap des résultats** : actuellement bands fixes (0.25/0.45/0.55/0.75).
      Plus joli avec un vrai gradient interpolé (lerp HSL).
- [x] **Sort columns** dans la table — click sur header cycle null → desc → asc → null. Chevron ▼/▲ sur la colonne active. Reset sur clic d'une autre colonne. `selectedBuild` survit au resort (clé par identité).

## Persistence (M7)

- [x] **Save Build per hero** — localStorage (pas IDB — payload petit), per-hero map, panneau "Saved builds" dans la sidebar avec click-to-restore + suppression au hover. `apps/renderer/src/lib/storage/savedBuilds.ts`.
- [x] **Filter presets per hero** — même pattern, panneau "Filter presets" sidebar, action `loadPreset` au reducer. `apps/renderer/src/lib/storage/filterPresets.ts`.
- [ ] **JSON import/export** — bouton dans Settings pour exporter `{savedBuilds, filterPresets}` en JSON et réimporter (partage entre devices ou backup).
- [ ] **Build prod du `data/`** — Vite middleware sert `data/derived` en dev ; pour
      le packaged build (Electron / desktop) il faut baker dans le bundle ou copier
      dans `apps/desktop/resources`. Aujourd'hui : marche en dev, casse en prod.
- [ ] **Snapshot data/ versioning** — chaque rebuild de `data/derived` devrait stamper
      un hash/timestamp pour invalider les caches localStorage côté client après un patch jeu (les SavedBuild référencent des `pieceUids` qui peuvent disparaître).

## Validation / régression

- [x] **Stat-lock test solver-side** — partiellement couvert via `apps/renderer/test/solver.test.ts` (24 tests : gem pool, scoring, allocation, override equivalence, ratings, score normalization). Vitest configuré, run via `npm test -w @gear-solver/renderer`. Test a immédiatement caught un bug (`STAT_NORMS` mal dimensionnés pour per-roll → introduit `ROLL_NORMS`).
- [x] **Test gem override math** — équivalence override-vs-subs validée, double-counting check, no-bleed-on-non-gem-slots.
- [ ] **Test CP solver vs Builds** — comparer `calcBattlePower` sur le même build
      depuis les deux écrans, doit donner 0-diff.
- [ ] **Test mid-tree pruning** — fixture avec un req-4pc Sharp + 1 helmet Sharp :
      le compteur de combos visités doit être strictement < combos sans prune.
- [x] **Test top-K heap** — `TopKHeap` exporté + 5 tests (capacity, cp mode, overflow, partial fill, null cp ranks as -Infinity).

## Performance (optionnel, si profiling le justifie)

- [ ] **Profiler un vrai solve** (Chrome DevTools Performance) sur un inventaire moyen
      pour valider les 2-5 s visés. Si on dépasse 15 s : inliner `aggregateGearBuckets`
      dans le hot loop.
- [ ] **SharedArrayBuffer** pour le `cancelled` flag — élimine la latence postMessage
      du cancel. Nécessite COOP/COEP headers servis par Vite (et électron prod).
- [ ] **Object pool** pour `FinalStats` + `CheapRatings` — réutiliser les objets au
      lieu d'allouer × millions. Gain GC.
- [ ] **Pré-filtrage armor par set requis** — si l'utilisateur a un seul req-4pc actif,
      restreindre les 4 pools armor à pieces de ce set (vs prune en chemin).

## UX / UI (au-delà du Builder)

- [ ] **Settings** : un panneau pour les debug toggles + options globales (worker
      count override, topK/topN, heatmap on/off).
- [ ] **Empty state** plus accueillant pour Inventory/Builds quand la capture vient
      d'être faite mais qu'il n'y a pas encore de personnages.
- [ ] **Error boundary** React global — aujourd'hui un throw dans un useMemo casse
      tout l'écran sans message clair.

## Hygiene

- [x] **Supprimer `packages/core/src/solver.ts`** — stub mort, supprimé. `index.ts` ne le ré-exporte plus.
- [x] **`packages/core/src/score.ts`** — stub mort (`scorePiece`/`sumTotals` jamais consommés), supprimé. Comment dans `gamedata.ts` mis à jour.
- [ ] **Pre-existing TODOs** dans le code :
  - [ ] `docs/data-schema.md:36` — "TODO: confirm" sur un champ. Vérifier et trancher.
  - [ ] `tools/capture/README.md:66` — TODO sur le mapping OptionID → stat,
        normalement déjà fait via `data/derived/options.json`. Maj du README.

## Desktop wrapper (M7+)

- [ ] **Electron build** finir le packaging (`apps/desktop` existe partiellement).
- [ ] **Auto-update** : `electron-updater` configuration + feed.
- [ ] **Native capture button** : exposer `tools/capture/capture.ps1` via IPC Electron
      (déjà fait en dev via Vite middleware) — pour que le bouton fonctionne sans
      `npm run dev` qui tourne.

---

## Stratégie suggérée (ordre)

1. **Stat-lock test solver-side** d'abord (fast feedback que rien ne casse).
2. **Cancel mid-solve** (UX immédiate, code isolé).
3. **Save Build per hero** + **Filter presets** (déblocage UX majeur).
4. **Action buttons sidebar** (au moins Save/Remove ; Equip/Unequip plus tard si on a une API jeu).
5. **Exclude equipped multi-select** + **Upg column** (raffinements une fois la base solide).
6. **Reforge simulation** (gros morceau, à isoler en M6.6).
7. **Profilage + perf** (réactif, seulement si on observe des solves lentes en réel).
8. **Electron polish** (M7+).
