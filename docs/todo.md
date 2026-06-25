# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence · ⚪ nit.
>
> État au 2026-06-25 : **tous les 🔴 sont faits**, la quasi-totalité des 🟠 aussi.
> Ce qui reste ci-dessous = polish 🟡/⚪, features, gros chantiers, ou « à vérifier en jeu ».

---

## Solver / engine

- [ ] 🟡 **Footgun : filtres silencieux sur clé inconnue** — `passesSpecs` fait
      `if (typeof v !== "number") continue;` → une clé mal orthographiée (`critRate`
      au lieu de `crc`) laisse tout passer = filtre no-op invisible si UI et
      `FinalStats` divergent un jour. Fix : `console.warn` en dev sur clé inconnue.
      `engine.ts` (`passesSpecs`).
- [ ] **CP fallback `chainPassive`** — déjà plumbé via `userSkills` ; vérifier qu'on
      lit la bonne colonne depuis l'inventaire capturé (`c.skills.chainPassive`).
- [ ] 🟠 **Accumulateur de buckets — partie re-sum déférée** — le hoist des set bonuses
      est fait (cf. Livré) ; reste le re-sum des 6+EE pièces par talisman. Gain marginal,
      et **risque d'ordre flottant** : `incSet/decSet` casserait la bit-identité (soustraction
      flottante ≠ inverse exact) et aucun test stat-locks automatisé ne rattrape une dérive
      ULP via `Math.trunc` dans `composeMultStat`. À faire en préservant l'ordre exact
      (prefix `[0..5]` → talisman → EE/override/sets) avec un test d'équivalence dédié.

### Perf solver (optionnel, seulement si profilage le justifie)

- [ ] **Profiler un vrai solve** (Chrome DevTools Performance) sur un inventaire moyen
      pour valider les 2-5 s visés.
- [ ] **SharedArrayBuffer** pour le flag `cancelled` — élimine la latence postMessage
      du cancel. Nécessite COOP/COEP headers (Vite + électron prod).
- [ ] **Object pool** pour `FinalStats` + `CheapRatings` — éviter d'allouer × millions.
- [ ] **Pré-filtrage armor par set requis** — si un seul req-4pc est actif, restreindre
      les 4 pools armor aux pièces de ce set (vs prune en chemin).

---

## Tab Builder (`BuilderScreen.tsx` + solver)

- [ ] 🟡 **Colonnes manquantes vs filtres** — la table n'affiche que `SOLVER_STATS.slice(0, 8)` :
      `dmgUp/dmgRed/eff/res` sont filtrables mais invisibles en colonne → on peut filtrer sur
      `eff` sans jamais voir sa valeur. À documenter ou rendre togglable.
- [ ] ⚪ **Heatmap colore sur `v` brut** alors que la cellule affiche `fmt(v)` arrondi →
      une cellule peut être "plus verte" qu'une voisine de valeur affichée identique. Cosmétique.
- [ ] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** alors que l'accessoire a un main
      user-sélectionnable → placeholder potentiellement faux quand aucun build sélectionné.
- [ ] ⚪ **Accessibilité combobox** — pas de navigation clavier (flèches), pas de
      `role="listbox"`/`aria-activedescendant` ; inputs `type=number` modifiables à la molette.
- [ ] ⚪ **Heatmap des résultats : gradient interpolé** — actuellement bands fixes
      (0.25/0.45/0.55/0.75), plus joli avec un vrai gradient (lerp HSL).

---

## Tab Builds (`BuildsScreen.tsx`)

- [ ] 🟡 **`SlotMini` non cliquable** — aucun moyen d'inspecter une pièce depuis la tab
      Builds (tooltip/clic), contrairement à l'Inventory.

---

## Tab Inventory (`InventoryScreen.tsx`)

- [ ] **À vérifier EN JEU — Cap de Quality ne scale pas avec les étoiles** —
      `computeQuality` fixe `max = 14 + reforge.n` (14 = spread 4+4+3+3 d'une 6★), mais
      `SubstatRow` considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses subs plus bas
      → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le filtre Quality.
      **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).
- [ ] ⚪ **Optims mineures (si profilage)** — `computeQuality` recalculé plusieurs fois par
      pièce (précalculable dans `toUiPiece`) · double virtualisation (`contentVisibility:auto`
      redondant avec `react-virtual`) · 7 `useMemo` d'availability fusionnables en une passe.

> ✅ À NE PAS toucher : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` avec
> callback stable, re-seed du draft à l'ouverture de la modal.

---

## Desktop / Electron — Packaging (M7+)

- [ ] **Build prod du `data/`** — Vite middleware sert `data/derived` en dev ; pour le packaged
      build il faut baker dans le bundle ou copier dans `apps/desktop/resources` (aujourd'hui :
      marche en dev, casse en prod).
- [ ] **Electron build** — finir le packaging (`apps/desktop` existe partiellement).
- [ ] **Auto-update** — `electron-updater` (config + feed).
- [ ] **Native capture button** — exposer `tools/capture/capture.ps1` via IPC Electron (déjà
      fait en dev via Vite middleware) pour que le bouton marche sans `npm run dev`.

---

## Persistence (M7)

- [ ] **JSON import/export** — bouton Settings pour exporter `{savedBuilds, filterPresets}` en
      JSON et réimporter (partage entre devices / backup).
- [ ] **Snapshot `data/` versioning** — chaque rebuild de `data/derived` devrait stamper un
      hash/timestamp pour invalider les caches localStorage après un patch jeu (les SavedBuild
      référencent des `pieceUids` qui peuvent disparaître).
- [ ] **Equip / Unequip** — nécessite une API jeu inexistante (supprimé du UI). À reprendre si
      on trouve un moyen d'envoyer des commandes au jeu (le pipeline de capture pourrait être
      étendu).

---

## Validation / régression (tests)

- [ ] **Test CP solver vs Builds** — comparer `calcBattlePower` sur le même build depuis les
      deux écrans, doit donner 0-diff.
- [ ] **Test mid-tree pruning** — fixture req-4pc Sharp + 1 helmet Sharp : le compteur de combos
      visités doit être strictement < combos sans prune.

---

## UX / UI (global)

- [ ] **Settings** — panneau pour les debug toggles + options globales (worker count override,
      topK/topN, heatmap on/off).
- [ ] **Empty state** plus accueillant pour Inventory/Builds quand la capture vient d'être faite
      mais qu'il n'y a pas encore de personnages.
- [ ] **Error boundary** React global — aujourd'hui un throw dans un `useMemo` casse tout l'écran
      sans message clair.

---

## Observabilité / debug

- [ ] **Logging & debug un peu partout** — le logging est quasi absent côté renderer et le
      solver/capture/desktop tournent en boîte noire. Mettre en place un logger léger gaté sur
      les flags `gs.debug.*` (même pattern que `gs.debug.statLocks`) plutôt que des `console.log`
      sauvages, et l'arroser aux points chauds :
  - Solver : fan-out orchestrateur (tailles de pools, `chunkCount`, workers utilisés),
    résultats par worker, compteurs de prune/combos visités, durée de solve.
  - Capture / desktop : lifecycle serveur, armed/disarm, erreurs I/O et process orphelins.
  - Footgun filtres : `console.warn` en dev sur clé de filtre inconnue (recoupe le 🟡 Solver).
  - Brancher l'activation sur le **panneau Settings** des debug toggles.

---

## Livré

### Session 2026-06-25 (détail dans git)

**🔴 Correctness solver/UI** — recall filtre CP/upg appliqué in-loop (`a6aa67b`) · échecs
silencieux + `restoreBuild`/`solveError` (`2e6def2`) · allocation de gemmes affichée (`20d3ce9`) ·
bandeau projette les stats reforgées + badge (`8b1df0e`).

**🔴 Trous Builds** — bouton Optimize → câblé (`6f0617b`) · cohérence roster « N equipped · M
total » + label No gear (`b832c7b`) · `computeAdvice` règles data-driven (`7700456`).

**🔴 Inventory** — champ recherche restauré + incohérence `query`/trim réglée (`51a489e`).

**🟠 Perf solver** — workers idle cappés à la taille du pool (`35bf809`) · table de résultats
virtualisée + `memo(ResultRow)` (`197fc61`) · hoist `computeSetBonuses` hors boucle talismans,
bit-identique + 3 tests d'équivalence (`92e84ca`).

**🟠 Desktop robustesse** — mitmdump orphelin (taskkill /T), écran noir silencieux, crash I/O
serveur, `.mitm.pid` liveness, disarm non bloquant (`c0f039c`). **Sécu** — gardes Host/Origin sur
les POST, validation redirect `/img/*`, cap body stat-locks (`9f8fefe`).

**🟠 Perf Builds** — `useStatLocks` gaté sur debug + re-sort roster court-circuité (`87306fe`).

**🟡/⚪ Polish** — `useClickOutside` partagé (`5f6bb79`) · Inventory modal Esc+autofocus, détail
dérivé de `ui` (`4f0649a`) · Builds carte responsive + scroll `flex-1` + hygiène round1/NoteField/
type=button (`611c49f`) · footer Builder sur une ligne (`8203c25`) · doc-comments sets/preset
(`a46ba66`).

**Data** — split des BuffID EE séparés par virgule : 7 self-passifs droppés récupérés, dont le
+50% CHD d'Eris (`a6dfb16`).

**Docs** — passe de cohérence : data-schema, reference §1.2 (noms kebab-case + Archive),
STATUS, solver.md, roadmap, architecture (Electron), capture README.

### Antérieur (rappel — détail dans roadmap.md)

Solver M6.5 : cancel mid-solve (MessageChannel-yield) · panneau Library (Save/Remove build) ·
Exclude-equipped multi-select · colonne Upg · simulation de reforge · tri de colonnes. —
Persistence M7 : Save Build per hero (localStorage) · Filter presets per hero. — Tests :
solver-side stat-lock · gem override math · top-K heap. — Hygiene : suppression des stubs morts
`packages/core/src/solver.ts` et `score.ts`.
