# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique. Le détail des items **livrés** vit dans
> l'historique git + la section « Livré » en bas (et [roadmap.md](roadmap.md)).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence · ⚪ nit.
>
> État au 2026-06-25 : **tous les 🔴 sont faits**, la quasi-totalité des 🟠 aussi.
> Ce qui reste ci-dessous = polish 🟡/⚪, features, gros chantiers, ou « à vérifier en jeu ».

---

## Solver / engine

- [x] 🟡 **Footgun : filtres silencieux sur clé inconnue** — ✅ fait : `warnUnknownFilterKey`
      (warn-once via Set) appelé dans la branche clé-inconnue de `passesSpecs`/`passesRatingSpecs`
      → surface un mismatch UI/engine au lieu d'un filtre no-op silencieux. Zéro coût hot-loop
      pour les clés valides. `engine.ts`.
- [x] **CP fallback `chainPassive`** — ✅ vérifié (aucun changement) : `RawCharacter.ChainPassive`
      → `parse.ts` `skills.chainPassive` → `cp.ts` `skillSum += max(0, chainPassive-1)` → BP.
      Lu de la bonne colonne, utilisé par solver (BuilderScreen) ET Builds (`c.skills`).
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

- [x] 🟡 **Colonnes manquantes vs filtres** — ✅ fait : la table affiche toujours les 8 stats de
      base, et **appende** automatiquement `dmgUp/dmgRed/eff/res` dès qu'un filtre min/max actif
      porte dessus (`statCols` memoïsé passé à `computeColumnRanges` + `ResultRow`). On ne filtre
      plus jamais sur une colonne invisible ; coût nul tant qu'aucun de ces filtres n'est posé.
      `BuilderScreen.tsx`.
- [ ] ⚪ **Heatmap colore sur `v` brut** alors que la cellule affiche `fmt(v)` arrondi →
      une cellule peut être "plus verte" qu'une voisine de valeur affichée identique. Cosmétique.
- [ ] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** alors que l'accessoire a un main
      user-sélectionnable → placeholder potentiellement faux quand aucun build sélectionné.
- [x] ⚪ **Accessibilité combobox** — ✅ fait (HeroSelect) : navigation clavier (↑/↓ + Enter),
      `role=combobox/listbox/option` + `aria-activedescendant` + scroll-into-view de l'option
      surlignée ; inputs filtres `type=number` ne changent plus à la molette (`onWheel`→blur).
      `BuilderScreen.tsx`. *(ExcludeHeroesPicker — multi-select — laissé en clic/Esc.)*
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

> ⚠️ Le **plumbing est déjà écrit** (electron-builder `build`/`extraResources` dans
> `apps/desktop/package.json`, résolution `process.resourcesPath` dans `paths.ts`,
> `setupAutoUpdate()` dans `main.ts`, serveur local prod dans `server.ts`). Ce qui reste
> n'est donc PAS l'implémentation mais la **vérification end-to-end sur un vrai build packagé** :

- [ ] **Vérifier le bake prod du `data/`** — `extraResources` mappe `data/derived` →
      `process.resourcesPath` ; à valider sur un `electron-builder` réel (le dev passe par le
      Vite middleware, donc ce chemin n'a jamais tourné en packagé).
- [ ] **Vérifier l'`electron build`** — `pack`/`dist` existent ; produire un installeur et
      confirmer qu'il lance le serveur local + charge le renderer.
- [ ] **Vérifier l'auto-update** — `setupAutoUpdate()` est câblé (update-available/downloaded
      + `quitAndInstall`) mais **jamais testé contre une release signée + feed réels**.
- [ ] **Native capture button en packagé** — le serveur local (`server.ts`) sert déjà
      `/api/capture/*` en prod ; à confirmer que le bouton capture marche dans l'installeur
      (sans `npm run dev`).

---

## Persistence (M7)

- [x] **JSON import/export** — ✅ fait : section « Backup » dans Settings (export download
      `gear-solver-backup-YYYY-MM-DD.json` + import file-picker en mode **merge** dédupé par `id`).
      Module pur `lib/storage/transfer.ts` (`buildBackup`/`applyBackup`) opérant au niveau JSON
      brut → pas de re-conversion `Set` des presets ; clés `SAVED_BUILDS_KEY`/`FILTER_PRESETS_KEY`
      exportées comme source unique ; validation kind/version + 8 tests (`transfer.test.ts`).
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
- [x] **Empty state** plus accueillant — ✅ fait (Builds) : roster vide → message dédié
      « No characters captured yet » (gear importé mais pas de roster → jouer jusqu'au lobby +
      reload) vs « No hero matches the current filters » quand c'est un filtre. `BuildsScreen.tsx`.
      *(Inventory garde « No piece matches… » — acceptable.)*
- [x] **Error boundary** React global — ✅ fait : `ScreenErrorBoundary` (class component) enveloppe
      la zone main dans `App.tsx`, `key={tab}` reset au changement d'onglet + bouton Retry. Un throw
      en render/`useMemo` affiche l'erreur au lieu de blanker l'app, la coquille (header/tabs) survit.

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
