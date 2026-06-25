# TODO — backlog gear-solver (consolidé)

> Backlog opérationnel unique, issu de la fusion de 4 listes (backlog M6.5/M7 +
> 3 audits du 2026-06-25 : global, tab Builder, tab Builds). Doublons supprimés.
> Le détail des milestones livrées vit dans [roadmap.md](roadmap.md).
>
> Refs `fichier:ligne` valables au commit `1aecb11` (vérifiées 2026-06-25).
> Priorités héritées des audits : 🔴 casse la confiance / fonctionnel · 🟠 perf ·
> 🟡 UX-cohérence · ⚪ nit.

---

## Solver / engine — correctness & perf

- [x] 🔴 **Recall : SOLVE + filtre CP/upg peut perdre des builds** — ✅ corrigé :
      les filtres CP et upg sont désormais appliqués **dans la boucle** de `solveChunk`
      (CP calculé en mode score dès qu'un `cpFilter` est posé ; `equippedUids` résolu
      en amont pour l'upg) → le heap ne contient que des builds valides, top-K-par-score
      parmi les valides = exact, plus de sous-retour. Re-checks au finalize devenus
      no-op idempotents. (Meilleur que le « gonfler topK ×4 » probabiliste initialement
      envisagé.) `engine.ts` (`solveChunk` + `finalizeBuilds`).
- [ ] 🟠 **Hot-path : buckets recalculés inutilement** — la boucle interne talismans
      appelle `computeFinalStats` → `aggregateGearBuckets`, qui re-somme les 8 pièces
      ET recalcule `computeSetBonuses` à chaque talisman, alors que les set bonuses
      ne dépendent que des pièces porteuses d'`armorSetId` (jamais du talisman :
      `armorSetId: null` pour les ooparts, `parse.ts:194`). Le sous-ensemble
      `{weapon…accessory, EE}` + set bonuses est invariant sur toute la boucle.
      Fix : accumulateur de buckets incrémental (modèle `setCount`/`incSet`/`decSet`
      déjà à côté, `engine.ts:799-806`) → coût par combo O(8) → ~O(1).
      Garde-fou régression : lire `data/stat-locks.json` avant de toucher
      `compose-stats.ts`/`composeMultStat` (memory `project_gear_solver_stat_locks`).
      `engine.ts:678-689`, `composeBuild.ts:115-156`.
- [ ] 🟠 **Workers en idle quand un pool est petit** — `chunkCount = workers.length`
      (jusqu'à 8) mais `partition()` découpe le plus gros pool ; si ce pool a 3 pièces
      et qu'il y a 8 workers, les workers 3..7 reçoivent une slice vide. Fix :
      `chunkCount = Math.min(workers.length, maxPoolHit)` (l'orchestrateur connaît déjà
      `precomputed.poolSizes`), ne poster qu'aux `chunkCount` premiers workers.
      `orchestrator.ts:98,136-141`, `engine.ts:811-818` (`pickPartitionSlot`).
- [ ] 🟡 **Footgun : filtres silencieux sur clé inconnue** — `passesSpecs` fait
      `if (typeof v !== "number") continue;` → une clé mal orthographiée (`critRate`
      au lieu de `crc`) laisse tout passer = filtre no-op invisible si UI et
      `FinalStats` divergent un jour. Fix : `console.warn` en dev sur clé inconnue.
      `engine.ts:854-864`.
- [ ] **CP fallback `chainPassive`** — déjà plumbé via `userSkills` ; vérifier qu'on
      lit la bonne colonne depuis l'inventaire capturé (`c.skills.chainPassive`).

### Perf solver (optionnel, seulement si profilage le justifie)

- [ ] **Profiler un vrai solve** (Chrome DevTools Performance) sur un inventaire moyen
      pour valider les 2-5 s visés. (L'inline de `aggregateGearBuckets` dans le hot
      loop est déjà couvert par le fix incrémental ci-dessus.)
- [ ] **SharedArrayBuffer** pour le flag `cancelled` — élimine la latence postMessage
      du cancel. Nécessite COOP/COEP headers (Vite + électron prod).
- [ ] **Object pool** pour `FinalStats` + `CheapRatings` — éviter d'allouer × millions.
- [ ] **Pré-filtrage armor par set requis** — si un seul req-4pc est actif, restreindre
      les 4 pools armor aux pièces de ce set (vs prune en chemin).

---

## Tab Builder (`BuilderScreen.tsx` + solver)

> App Electron desktop → la contrainte responsive-mobile du projet ne s'applique pas
> ici (sauf fenêtre réduite, cf. #footer).

- [x] 🔴 **L'allocation de gemmes recommandée n'est jamais affichée** — ✅ corrigé :
      `BottomGearBand` propage `build.gemAllocation.talisman`/`.ee` aux `GearCard`
      Talisman/EE ; nouveau composant `GemRecommendation` résout les OptionIDs via
      `resolveStat(id, 1, game.options)` → liste stat/valeur + badge **swap** quand la
      reco diffère des gemmes socketées actuelles (rien affiché si allocation vide =
      gemmes conservées, ex. SOLVE sans priorité). Les stats affichées (calculées AVEC
      ces gemmes en SOLVE CP) sont donc atteignables. `BuilderScreen.tsx`.
- [x] 🔴 **Le bandeau du bas ignore les stats reforgées** — ✅ corrigé : `simulateReforges`
      étant pur/déterministe, `BottomGearBand` re-simule côté main thread avec le contexte
      solve-time (`useReforged` + `priority`, snapshotté au solve via `solveReforgeRef`,
      propagé aux résultats live ET aux builds restaurés via un champ `reforge` optionnel
      sur `SavedBuild`) → substats affichés = projection scorée par l'engine. Badge **reforged**
      sur les cartes dont les subs sont projetés. `BuilderScreen.tsx`, `savedBuilds.ts`.
- [x] 🔴 **Échecs silencieux (pas de feedback)** — ✅ corrigé :
      - `startSolve` pose un `solveError` (« Game data is still loading… » / hero introuvable)
        au lieu de `return` muet.
      - État vide du `ResultsTable` : nouveau `emptyReason` dérivé de `poolSizes` →
        liste les slots tombés à 0 après filtres (« Weapon: 0 pieces after filters »).
        `BuilderScreen.tsx` (`startSolve`, `emptyReason`, `ResultsTable`).
- [x] 🔴 **`restoreBuild` ne reset pas `solveError`** — ✅ corrigé :
      `setSolveError(null)` ajouté en tête de `restoreBuild`. `BuilderScreen.tsx`.
- [ ] 🟠 **Table de résultats non virtualisée** — `topN = 1000` par défaut, `ResultsTable`
      rend toutes les lignes (~1000 × ~20 cellules ≈ 20k nœuds DOM), `ResultRow` non-`memo`
      avec `onClick` recréé ×1000 à chaque tri/sélection. L'Inventory est virtualisé →
      incohérent. Fix : `memo(ResultRow)` + handler stable + virtualiser le tbody
      (`react-virtual`/`react-window` déjà utilisés ailleurs). À défaut, cap d'affichage
      (~200) avec "voir plus". `orchestrator.ts:40-42`, `BuilderScreen.tsx:1933,1986-1998`.
- [ ] 🟠 **Listeners `mousedown` document dupliqués** — `HeroSelect` et
      `ExcludeHeroesPicker` attachent chacun un listener global et sont ~90% identiques.
      Fix : hook partagé `useClickOutside`. `BuilderScreen.tsx:1068-1075,1255-1262`.
- [ ] 🟡 **Doc-comment du cycle des chips Sets périmé** — le commentaire décrit
      `off → req-4pc → req-2pc → excluded` alors que le code fait
      `off → req-2pc → req-4pc → excluded` (confirmé par le hint panel). Fix : corriger
      le commentaire. `BuilderScreen.tsx:1739` (faux), `:1757-1764` (réel), `:1642` (hint).
- [ ] 🟡 **Colonnes manquantes vs filtres** — la table n'affiche que
      `SOLVER_STATS.slice(0, 8)` : `dmgUp/dmgRed/eff/res` sont filtrables mais invisibles
      en colonne → on peut filtrer sur `eff` sans jamais voir sa valeur. À documenter ou
      rendre togglable. `BuilderScreen.tsx:1959` (header), `:2085` (rows).
- [ ] 🟡 **Footer fixe + `flex-wrap` peut recouvrir le bandeau gear** — `FilterFooter`
      est `position:fixed` avec réservation fixe `pb-9` ; sur fenêtre étroite les 8 chips
      wrappent sur 2 lignes et recouvrent le bandeau gear. `BuilderScreen.tsx:562,2261`.
- [ ] 🟡 **`saveCurrentPreset` : commentaire mensonger sur le deep-copy** — dit
      « Deep-copy via JSON round-trip » mais ne re-matérialise que le `Set` ;
      `statFilters`/`mainPicks`/`setPicks` restent des références partagées. OK par chance
      (reducer immutable) mais piège. Fix : corriger le commentaire OU vrai
      `structuredClone`. `BuilderScreen.tsx:478-481`.
- [ ] ⚪ **Heatmap colore sur `v` brut** alors que la cellule affiche `fmt(v)` arrondi →
      une cellule peut être "plus verte" qu'une voisine de valeur affichée identique.
      Cosmétique. `BuilderScreen.tsx:2114,2123`.
- [ ] ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** alors que l'accessoire a un main
      user-sélectionnable → placeholder potentiellement faux quand aucun build sélectionné.
      `BuilderScreen.tsx:2345-2349`.
- [ ] ⚪ **Accessibilité combobox** — pas de navigation clavier (flèches), pas de
      `role="listbox"`/`aria-activedescendant` ; inputs `type=number` modifiables à la
      molette par accident. `BuilderScreen.tsx:1086,1397`.
- [ ] **Heatmap des résultats : gradient interpolé** — actuellement bands fixes
      (0.25/0.45/0.55/0.75), plus joli avec un vrai gradient (lerp HSL). *(distinct du
      nit ci-dessus : ici c'est l'esthétique des paliers, là c'est brut-vs-affiché.)*

---

## Tab Builds (`BuildsScreen.tsx`)

> Roster équipé/composé (≠ "Saved builds" du Builder, qui vivent dans `savedBuilds.ts`).
> Toute l'UI stat-lock/drift/copy-dump est `debug`-only (`gs.debug.statLocks`).

- [x] 🔴 **Bouton « Optimize → » non câblé** — ✅ corrigé : `App` tient `builderHero`,
      passe `onOptimize(uid)` à `BuildsScreen` (→ `BuildCard` → bouton) qui fait
      `setBuilderHero(uid) + setTab("Builder")`. `BuilderScreen` reçoit `initialHeroUid`
      (init de `selectedUid`) et `onInitialHeroConsumed` (clear au mount pour ne pas
      re-présélectionner lors d'une visite normale). `App.tsx`, `BuildsScreen.tsx`,
      `BuilderScreen.tsx`.
- [ ] 🔴 **`computeAdvice` est un stub (toujours `[]`)** — toute l'infra
      `AdviceItem`/`AdviceList`/`ADVICE_REQUIRED_SLOTS` est branchée mais ne produit rien.
      Décision : implémenter de vraies règles (set cassé, main off-stat, pièce manquante…)
      ou retirer le code mort. La fonction doit rester pure (no IO/Date, déterministe).
      `BuildsScreen.tsx:488-500`.
- [x] 🔴 **Incohérence roster complet vs équipés** — ✅ décision : **garder tout le roster**.
      Pill réconciliée → « N equipped · M total » (`equippedCount` = héros avec ≥1 pièce,
      même sémantique que le badge d'onglet) + tooltip explicatif. Cartes sans gear :
      grille dimmée (`opacity-40`) + label « No gear » au lieu d'une grille vide muette.
      `BuildsScreen.tsx`. *(NB : compose/CP tourne toujours pour tous — perf non
      adressée par choix « tout le roster » ; à profiler si besoin.)*
- [ ] 🟠 **`useStatLocks` fetch/persist même hors debug** — `fetch("/api/stat-locks")` au
      montage + listener `beforeunload` alors que l'UI de lock est `debug`-only. Fix :
      gater le hook sur `debug`. `BuildsScreen.tsx:408-428`.
- [ ] 🟠 **Re-sort du roster à chaque toggle de lock** — le `useMemo` `roster` dépend de
      `lockedStats` → filtre+tri relancés à chaque clic de lock même quand
      `filters.locks === "all"` (résultat identique). Fix : court-circuiter quand
      `locks === "all"`. `BuildsScreen.tsx:916-946`.
- [ ] 🟡 **Carte non responsive** — `flex items-center gap-4` avec 6 sections `shrink-0`,
      aucun `flex-wrap` → déborde horizontalement sur fenêtre étroite. `BuildsScreen.tsx:663`.
- [ ] 🟡 **`maxHeight: calc(100vh - 130px)` en dur** — le parent est déjà
      `flex h-full min-h-0 flex-col` → le scroll-container devrait être `flex-1 min-h-0`.
      Le `130px` magique se désaligne quand la barre de statut (dynamique) apparaît/disparaît.
      `BuildsScreen.tsx:961`.
- [ ] 🟡 **`SlotMini` non cliquable** — aucun moyen d'inspecter une pièce depuis la tab
      Builds (tooltip/clic), contrairement à l'Inventory. `BuildsScreen.tsx:704`.
- [ ] ⚪ **Nettoyage** — `round1` dupliqué (`BuildsScreen.tsx:26` + `composeBuild.ts:40`,
      à factoriser) · `NoteField` double cap (`slice(0, NOTE_MAX)` + `maxLength`,
      `:549-552`) · boutons filtres sans `type="button"` (`:268`, `:292`).

---

## Tab Inventory (`InventoryScreen.tsx`)

> 1660 lignes. Audit `InventoryScreen.tsx`.

- [ ] 🔴 **Filtre `query` = code mort qui agit encore** — `query` vit dans le state, le
      codec de persistance (`gs.inv.filters.v3`), `matchesFilters` (~L170) et
      `activeFilterCount` (~L313), **mais aucun champ de recherche ne l'alimente** (disparu
      à la migration FilterPanel → modal). Conséquences : une vieille valeur localStorage
      filtre la grille sans moyen UI de la retirer ; `matchesFilters` teste `if (f.query)`
      alors qu'`activeFilterCount` teste `.trim() !== ""` → une query d'espaces filtre mais
      n'incrémente pas le badge. Reco : réintroduire le champ recherche dans la modal (le
      `hay` L172 est déjà construit) plutôt que supprimer `query`.
- [ ] 🟡 **`FilterModal` ne ferme pas avec Échap + pas de focus trap/autofocus** (~L382-384) —
      ferme au clic backdrop + croix uniquement, incohérent avec le travail Esc sur les
      comboboxes (commit `a40932c`).
- [ ] 🟡 **Sélection dérivée de `sorted` et non de `ui`** (~L1563) — sélectionner une pièce
      puis appliquer un filtre qui la masque vide silencieusement le panneau de détail alors
      que `selectedId` reste actif. Dériver de `ui` garderait le détail. (Accessoirement :
      `.find()` O(n) non mémoïsé par render.)
- [ ] **À vérifier EN JEU — Cap de Quality ne scale pas avec les étoiles** —
      `computeQuality` (~L968) fixe `max = 14 + reforge.n` (14 = spread 4+4+3+3 d'une 6★),
      mais `SubstatRow` (~L984) considère `isMax = s.lv >= stars` → une pièce 5★ plafonne ses
      subs plus bas → risque que les < 6★ soient classées "Poor"/"Decent" et écartées par le
      filtre Quality. **Confirmer en jeu** si le cap doit dépendre de `stars` (ne pas présumer).
- [ ] ⚪ **Optims mineures (si profilage)** — `computeQuality` recalculé plusieurs fois par
      pièce (précalculable dans `toUiPiece`) · double virtualisation (`contentVisibility:auto`
      redondant avec `react-virtual`, ~L663) · 7 `useMemo` d'availability (~L1447-1498)
      fusionnables en une passe.

> ✅ À NE PAS toucher : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles (~L1504), `memo` sur `GearTile`
> avec callback stable, re-seed du draft à l'ouverture de la modal.

---

## Desktop / Electron (`apps/desktop`)

### Robustesse démarrage + cleanup

- [ ] 🟠 **mitmdump orphelin** — `child.kill()` ne tue que `powershell.exe` ; les process
      lancés via `Start-Process` survivent. Fix : `taskkill /PID <pid> /T /F` sous Windows.
      `server.ts:138`.
- [ ] 🟠 **Écran noir silencieux** — `app.whenReady().then(async () => { await createWindow() })`
      sans `.catch` : si `startServer` rejette (bind échoué `server.ts:369-385`) ou `loadURL`
      échoue → unhandled rejection, fenêtre vide. Fix :
      `.catch(e => { dialog.showErrorBox(...); app.quit() })`. `main.ts:115-118`.
- [ ] 🟠 **Crash serveur sur I/O** — `createReadStream().pipe(res)` sans handler `error` → un
      `EBUSY`/fichier disparu (fréquent Windows) tue le process serveur. Fix :
      `stream.on("error", () => { if (!res.headersSent) res.statusCode = 500; res.end(); })`.
      `server.ts:89`.
- [ ] 🟠 **`.mitm.pid` orphelin** — si mitmdump crashe hors disarm, le fichier reste →
      `armed:true` à vie et `/api/capture/wipe` refuse pour toujours (409). Fix : vérifier
      `process.kill(pid, 0)` avant de conclure « armed », nettoyer si mort. `server.ts:150,217`.
- [ ] 🟠 **Disarm bloquant 15 s** — `spawnSync` synchrone au `before-quit` gèle l'UI. Fix :
      async non bloquant + `app.exit()` après délai max. `main.ts:136-146`, `server.ts:347-350`.

### Sécurité (serveur 127.0.0.1, impact faible mais trivial à durcir)

- [ ] 🟡 **Pas de garde `Host`/`Origin`** sur les POST mutateurs — tout site ouvert localement
      peut POST `/api/capture/run` ou `/wipe` (port fixe `17891`, CSRF/DNS-rebinding). Fix :
      rejeter si `Host` ≠ `127.0.0.1:<port>` + header custom (soumis au preflight).
      `server.ts:198-237`.
- [ ] 🟡 **Redirection `/img/*` non validée** — path non décodé/normalisé →
      response-splitting/open-redirect. Fix : borner à `[\w./-]`, strip `..` et CRLF.
      `server.ts:310-313`.
- [ ] 🟡 **Body `/api/stat-locks` sans limite** — cap à ~1 Mo, `res.destroy()` au-delà.
      `server.ts:271-285`.

> ✅ Spawn ADB/PowerShell partout en mode array (pas `shell:true`) → pas d'injection shell.
> Garder ainsi.

### Packaging (M7+)

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

- [ ] **Logging & debug un peu partout** — aujourd'hui le logging est quasi absent côté
      renderer (1 seul `console.*`) et le solver/capture/desktop tournent en boîte noire.
      Mettre en place un logger léger gaté sur les flags `gs.debug.*` (même pattern que
      `gs.debug.statLocks`, `App.tsx:48`) plutôt que des `console.log` sauvages, et l'arroser
      aux points chauds :
  - Solver : fan-out orchestrateur (tailles de pools, `chunkCount`, workers utilisés),
    résultats par worker, compteurs de prune/combos visités, durée de solve.
  - Capture / desktop : lifecycle serveur (`server.ts`), armed/disarm, erreurs I/O et
    process orphelins (recoupe les items "Robustesse démarrage").
  - Échecs silencieux : matérialiser en log + UI les `return` muets (`game == null`,
    pool de slot = 0, clé de filtre inconnue) — recoupe **Échecs silencieux** (Builder) et
    **Footgun filtres** (Solver, `console.warn` en dev).
  - Brancher l'activation sur le **panneau Settings** des debug toggles (cf. UX/UI global)
    pour ne rien afficher en usage normal.

---

## Hygiene

- [ ] **Pre-existing TODOs dans le code** :
  - [ ] `docs/data-schema.md:36` — "TODO: confirm" sur un champ. Vérifier et trancher.
  - [ ] `tools/capture/README.md:66` — TODO sur le mapping OptionID → stat, normalement déjà
        fait via `data/derived/options.json`. Maj du README.

---

## Stratégie suggérée (ordre)

1. **Correctness solver/UI** d'abord (confiance dans les résultats) : recall CP filter, gem
   allocation non affichée, bandeau qui ignore le reforge, `restoreBuild`/`solveError`.
2. **Trous fonctionnels Builds** : câbler **Optimize →**, trancher roster complet vs équipés
   (débloque la perf compose), décider du sort de `computeAdvice`.
3. **Perf hot-path** : accumulateur de buckets incrémental, workers idle, virtualisation des
   tables de résultats.
4. **Robustesse desktop** + durcissement sécurité (cheap wins).
5. **Le reste** (UX, a11y, hygiène, perf optionnelle) au fil de l'eau, profilage à l'appui.

---

## Livré (rappel — détail dans roadmap.md)

Solver M6.5 : cancel mid-solve (MessageChannel-yield) · panneau Library (Save/Remove build) ·
Exclude-equipped multi-select · colonne Upg · simulation de reforge (`simulateReforges`) ·
tri de colonnes. — Persistence M7 : Save Build per hero (localStorage) · Filter presets per hero. —
Tests : solver-side stat-lock (24 tests, a caught un bug `ROLL_NORMS`) · gem override math ·
top-K heap (5 tests). — Hygiene : suppression des stubs morts `packages/core/src/solver.ts` et
`score.ts`.
