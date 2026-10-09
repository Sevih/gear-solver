# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **1 🔴 ouverts** — audit projet complet du 2026-09-07 (4 sections en tête de « Reste à faire »).
> L'audit Builder 2026-07-03 est entièrement livré (cf. changelog).

---

## Reste à faire

### 🔴 Audit projet (2026-09-07) — bugs confirmés
- [ ] 🔴 **Race « Get preset » vs changement de héros** — `BuilderScreen` `getPreset` : après `await fetchReco`, rien ne
      vérifie que le héros sélectionné est le même → la reco de A est mergée dans les filtres de B. Capturer
      `selectedUid` avant l'await et bail si différent.
- [ ] 🟠 **Double import Steam au démarrage** — `App.tsx` : l'effet initial et le `tick()` Steam appellent
      `getCaptureStatus()` en parallèle ; si le tick gagne avec `lastItemMtime` null → second `refreshInventory`. Pas de
      garde in-flight si un tick dépasse 5 s. Un seul chemin d'init + flag `busy`.
- [ ] 🟠 **`onFiles` sans try/catch** — `App.tsx` : `JSON.parse(await f.text())` → rejection non gérée sur un fichier
      invalide ; ne remet pas `userGeas`/`userCodex`, ne vide pas l'`<input>`.
- [ ] 🟠 **Reset onboarding annulé par simple réouverture de Settings** — `onReady()` rappelé à chaque probe réussie
      de l'onglet Setup, avant même un relaunch.
- [ ] 🟠 **Worklist : deux définitions du « conflit »** — la carte (`WorklistScreen`) compte les claims par uid (même
      héros, changes appliqués inclus) ; `plan.ts` exige ≥ 2 héros distincts sur des changes live. Un héros avec deux
      builds visant la même pièce voit « conflict » alors que l'entête dit « order doesn't matter ». Une seule source
      (`plan.ts`).
- [ ] 🟠 **`syncGameData` (App) ne teste pas `r.ok`** — HTTP 500 sans JSON → « Game data synced. » ; et
      `SettingsModal` réimplémente le même bouton avec `window.location.reload()` (tue un solve en cours). Un seul
      chemin.
- [ ] 🟠 **`capture.ts` : reliquat sans `\n` final** — émis via `onLine` sans test du sentinel `__EXIT__` → « Capture
      failed (exit -1) » si le serveur ne termine pas par un retour ligne.

### 🟠 Audit projet (2026-09-07) — sécurité / robustesse desktop
- [ ] 🟠 **`GET /captured/*` exposé sans garde Host** — `server.ts` ne filtre que les POST par `isLocalRequest` ; le
      commentaire dit que les GET « n'exposent rien de sensible », mais `/captured/user_item.json` est le compte du
      joueur (lisible par DNS rebinding). Appliquer la garde Host aux mounts `/captured/*` (et `/api/*` GET).
- [ ] 🟠 **Vite middleware ≠ server.ts (dérive)** — le mirror dev (`vite.config.ts`) teste `armed` par simple présence
      de `.mitm.pid` (pas de vérif de vivacité, wedge possible) et n'a pas le kill en arbre `taskkill /T`. ~430 lignes
      dupliquées : extraire un `createApiHandler(paths)` partagé dans `apps/desktop/src` (déjà Electron-free pour la
      plupart des modules) et le monter des deux côtés.
- [ ] 🟠 **Write-back d'équipement non protégé contre la source Steam** — `/api/captured/user-item` refuse si
      `isArmed()` (mitm) mais pas si le plugin Steam est live, alors que le prochain lobby écrase l'édition pareil.
      Refuser (ou avertir) quand `steamStatus().live`.
- [ ] 🟠 **`steamStatus()` toutes les 5 s en `spawnSync`** — `reg.exe` + `tasklist.exe` (timeouts 3-4 s) + SHA-256
      de deux DLL, dans le thread principal Electron qui sert aussi le HTTP. Passer en async (`execFile`), cacher
      `findOuterplane()` et le hash du DLL bundlé (invariant par process).
- [ ] 🟡 **Fenêtre ouverte seulement après la sync réseau** — `main.ts` await `syncGameData` avant `createWindow` :
      offline avec DNS lent = jusqu'à ~30 s sans fenêtre. Ouvrir la fenêtre, puis sync + notification (le renderer
      sait déjà afficher le statut).
- [ ] 🟡 **Pas de cache négatif sur `/img/*`** — une image absente du bucket R2 est refetchée à chaque rendu, sans
      `Cache-Control` sur le 404. Mémoriser les misses (TTL) + `Cache-Control` court sur la 404.
- [ ] ⚪ **Garde de traversal `file.startsWith(dir)` sans séparateur** (server.ts `tryMount`, img-cache.ts `safeJoin`)
      : `dir2/` passe si `dir` en est un préfixe. Comparer avec `dir + sep` (ou `path.relative` sans `..`).
- [ ] ⚪ **Sync REPO gatée sur le SHA du repo** — tout commit site-only d'outerpedia redéclenche le download des 19
      fichiers. Télécharger `version.json` d'abord et comparer le `hash` avant le reste.
- [ ] ⚪ **Chemins perso codés en dur** (`C:\Users\Sevih\...`) dans `paths.ts`, `data-sync.ts`, `data/sync.mjs`,
      `vite.config.ts` — passer par `OUTERPEDIA_PATH` + un `.env.local` gitignoré (déjà listé dans `.gitignore`).

### 🟡 Audit projet (2026-09-07) — incohérences docs ↔ code
- [ ] 🟡 **Top % par défaut : 60 dans le code**, encore 30 dans `docs/solver.md` (§ résumé perf), `todo.md` (item Perf
      solver), `CARTESIAN_WARN` et le commentaire de `COMBO_BUDGET` (`engine.ts`). Le hint UI présente Top % comme
      « percentile par slot » et l'avertissement ambre « Top % has no effect without priority » contredit le moteur
      (prune par magnitude en Score sans priorité). Aligner UI + docs sur « budget absolu de combos ».
- [ ] 🟡 **Docs publiques cassées** — `wiki/Engine-Reference.md` documente `npm run data:build` (n'existe plus) et
      décrit `build.mjs` ; `docs/solver.md` lie un fichier mémoire hors repo ; `roadmap.md` et l'item Persistence de ce
      todo citent `data/build.mjs` ; `compose-stats.ts` parle de « data/calc-stats.mjs output » ; `cp.ts` /
      `composeBuild.ts` renvoient vers `memory/game_*.md` inexistants. STATUS.md liste « gardes Host/Origin » en
      renvoyant vers ce todo, qui n'en parlait plus (cf. section sécu ci-dessus).
- [ ] 🟡 **Commentaires faux / périmés** — `gamedata.ts` : « +0.04 per enhance level (stored as 0.4) » alors que le
      code applique +40 %/niveau (×5 à +10, validé par tests) · `server.ts` `disarmIfArmed` « uses spawnSync » (async
      spawn) · en-tête de `BuilderScreen.tsx` « UX-only, no logic wired » · `gs.builder.solveMode` (clé inexistante,
      fallback sur « Solve CP » au lieu de « Solve ») · « auto-ranked by CP on capture » (le rang est manuel) · CP
      décrit « no skill enhances » alors que `skillSum` compte · chips effets « identité = icône » (clé = `setId`) ·
      libellés Score (« + rating filters ») et Upg (« improved » vs « differ ») · commentaires storage
      « localStorage » (Inventory/Builds) alors que c'est sessionStorage.
- [ ] 🟡 **`emptyReason` accuse l'EE** — `poolSizes.exclusive.hit = ee ? 1 : 0` : un héros sans EE affiche
      « Exclusive: 0 pieces after filters » alors que le solve tourne sans EE. Exclure `exclusive` de `dead`. Même
      écran : après un « Filter » client qui vide la table, message « Pick a hero and click SOLVE » au lieu de « filtré ».
- [ ] 🟡 **EE mains `ST_AVOID`** (accuracy vs élément) — présents dans `buffs.json` avec leur nom, mais `GAME_STAT`
      (`stats.ts`) ne les connaît pas → le main disparaît du panneau au lieu d'être affiché combat-only.
- [ ] 🟡 **Stat-locks : migration `renameLegacyStatKeys` non appliquée** au fichier lu via `/api/stat-locks` — un
      fichier ancien (`crc`, `chd`, …) ne matchera jamais.
- [ ] 🟡 **`mergePreset` peut rendre les filtres contradictoires** — remplace `setPlans` par ceux de la reco mais
      laisse `excludedSets` : set requis + exclu → 0 build sans explication. Retirer des `excludedSets` les sets des
      nouveaux plans (ou avertir).
- [ ] ⚪ **`SOLVER_FILES` en 4 exemplaires** (`data/sync.mjs`, `data-sync.ts`, `data.ts`, outerpedia). En mode checkout
      `data-sync.ts` saute silencieusement un artefact manquant là où `sync.mjs` sort en erreur. Une seule liste
      exportée (core) + même règle d'échec.
- [ ] ⚪ **Code mort** — `SourcePicker` n'offre jamais le retour à « auto » (`onChange(null)`) ·
      `addWorklistEntry`/`removeWorklistEntry`/`toggleWorklistChange` (worklist.ts) réimplémentés inline ·
      `DebugFlag "capture"` · `GearCard` reçoit 9 props « reserved for pimp » jamais rendues · docstrings orphelines
      (`saveCurrentPreset`, composant gems disparu) · `APP_VERSION` fallback « 0.4 » + « set in next.config ».
- [ ] ⚪ **Reset (Builds)** remet aussi le tri `byRank` à CP alors que la condition d'affichage ne le regarde pas ·
      clamp worker count à `hardwareConcurrency` côté Settings vs `WORKER_COUNT_CEILING` côté orchestrateur.

### 🟡 Audit projet (2026-09-07) — pratiques / perf
- [ ] 🟠 **Aucune CI de vérification** — le seul workflow publie le wiki ; ni typecheck ni tests sur push/PR, et
      `scripts/release.mjs` ne lance pas `npm test` avant `publish`. Ajouter un workflow `typecheck + test` et
      l'étape dans la release.
- [ ] 🟠 **Aucun ESLint configuré** — les `eslint-disable-next-line react-hooks/exhaustive-deps` sont inertes, les deps
      de hooks ne sont vérifiées par rien. Ajouter `eslint.config.js` (typescript-eslint + react-hooks) et corriger ce
      qui sort.
- [ ] 🟡 **`packages/core` déclare `vite` en dependency** (jamais importé, le package est « pure TS ») — supprimer.
- [ ] 🟡 **Dépendance inversée `lib → screens`** — `filterPresets.ts` et `heroFilters.ts` importent `SolverFilters`
      depuis `screens/BuilderScreen`. Déplacer le type + le reducer dans `lib/solver/builderFilters.ts` (permet aussi de
      tester la migration des presets sans tirer l'écran).
- [ ] 🟡 **Duplications** — formule CalcFinalStat (`calcFinalStat` core vs `composeMultStat` renderer) · `computeQuality`
      copié 3× (GearDetail, ResultGearDetail, quality.ts) · « slot changé » défini 3× dans le Builder (`equipPlan`,
      `addToWorklist`, `pieceBySlot`) → une `diffBuildVsLoadout` partagée, même invariant que `upg` moteur.
- [ ] 🟡 **Effets de bord dans des updaters `setState`** (persist localStorage dans App/Builds — exécutés 2× en
      StrictMode) · `setState` après `await` sans garde d'unmount (BuildsScreen stat-locks, WorklistScreen,
      SettingsModal) · timers non nettoyés (`setWorklistAdded`, `CopyDebugButton`) · `filtersRef.current = filters`
      pendant le rendu · effets réabonnés à chaque render (`RecoBuildPicker`/`EquipConfirm` avec `onClose` inline).
- [ ] 🟡 **Perf render Builder** — `useRef(loadHeroFilters())` relit sessionStorage à chaque render (~10/s pendant un
      solve) → `useState(() => …)` · `DmgPer1PctPanel` recalcule `dmgTickGains` à chaque tick de progression →
      `useMemo(comp)` · isoler `solveProgress` dans le footer pour ne pas re-rendre tout l'arbre.
- [ ] 🟡 **Perf render App** — badge Builds et `remainingChangeCount` recalculés sur tout `inv.gear` à chaque render
      (y compris chaque ligne de log de capture) → `useMemo` · `setLog((l) => [...l, line])` O(n²) · `equippedByHero`
      reconstruit 4× par changement d'inventaire (reconcile, claims, badge, WorklistScreen) → une map mémoïsée.
- [ ] 🟡 **Perf Inventory** — `matchesFilters` reconstruit la chaîne `hay` et rappelle `computeQuality` par pièce à
      chaque frappe (2×1000 recalculs) → précalculer dans `toUiPiece` (cf. item « Optims mineures Inventory »).
- [ ] 🟡 **Composants monolithiques** — BuilderScreen 4600 lignes (~40 composants + reducer), InventoryScreen 1350,
      SettingsModal 1220 (5 panes + helpers réseau), HomeScreen `computeStats` 200 lignes. Découpage proposé :
      `builderFilters.ts`, `catalogs.ts`, `ResultsTable`, `BottomGearBand`, `BuilderToolbar` + panels, `RightSidebar`,
      `FilterFooter`, hook `useSolverSession` ; une pane par fichier côté Settings.
- [ ] ⚪ **`window.alert` / `confirm` bloquants** dans SettingsModal alors que l'app a une barre de status.
- [ ] ⚪ **Casts JSON non validés** (`as PreflightResult`, stat-locks `as Record<…>`, `j.ItemList` sur `any`).
- [ ] ⚪ **`useMemo(…, [])` comme « lire une fois »** (HomeScreen) → initialiseur `useState`.

### 🟢 Ratings offensifs — après la colonne « meilleur skill » (2026-09-05)
- [ ] 🟢 **DPS de rotation pondéré par les cooldowns** — `dmgs` = hit du meilleur skill × SPD,
      pas une rotation. La donnée damage d'outerpedia porte déjà `levels[].cool` / `startCool`
      par skill : un `bestSkill`-like « facteur moyen par tour » (S1 filler + S2/S3 quand
      dispo) est calculable côté générateur. À faire dans le pipeline (nouveau champ), jamais
      en parsant localement.
- [ ] ⚪ **DoT dans le meilleur hit** — assumé non modélisé (Gnosis Beth sous-estimée) ; ne
      traiter que si le moteur damage expose un facteur DoT par skill comparable au hit direct.

### 🟢 Tests manquants — audit Builder (2026-07-03)
- [ ] 🟢 **Crit-cap slow path de bout en bout** — rien ne teste le trigger `wantCritCap`
      + recompose dans `solveChunk` (le chemin par-combo `allocateGemsReachingCap` +
      `gemDeltaEquals` + le memo `capAllocCache`).
- [ ] 🟢 **Flux orchestrateur** — cancel / supersede / `solveId` anti-stale /
      `workersDone === activeChunks` / crash worker (`onerror` → cancel) / flux
      `estimate` (id anti-stale, null-on-error) : aucun test, et c'est là que vivaient
      les bugs corrigés par l'audit (cf. changelog).

### 🟠 Perf solver
- [~] **Solver CP trop lent** — diagnostic sur vrai compte : Top% 100 défaut + aucune priorité = **cartésien
      complet** (2,4 G combos, >100 s, `S ≈ P`) ; et un prune **en %** ne suffit pas (30 %/slot = encore 1,25 G).
      **Perf RÉSOLUE** (mesuré sur D.Luna, vrai compte : >100 s → **< 4 s**) : (1) **auto-prune CP-pondéré + budget
      combos** sur les 6 slots gear **+ talisman** — chaque slot classé par le CP qu'une pièce donne dans le build
      courant, `allocateComboBudget` borne `∏ ≤ 8 M` (scalé par Top%) ; (2) **gemmes notées par apport CP**
      (`cpStatWeights`, plus de dmg-red gobées) ; (3) **pin du build courant** (jamais pire que l'équipé) ;
      (4) **défaut Top% → 30** (slider 100 = exhaustif) ; (5) **garde-fou** bandeau si `∏ poolSizes > 50 M`.
      **Reste** : (a) confirmer la **justesse du top-CP** en jeu (≥ build équipé) ; (b) *optionnel* : qualité —
      la notation standalone peut sous-classer un membre de set couplé (garde set-aware) ; (c) *optionnel* : B&B CP exact.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) ·
      **SharedArrayBuffer** pour le flag
      `cancelled` (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡/⚪ UX-cohérence & nits
- [~] 🟡 **`Advices` (tab Builds)** — lot prioritaire + (1)/(2) livrés (`lib/buildAdvice.ts` : caps gaspillés,
      gems vides, upgrade agrégé ; **(1)** bruit Missing supprimé sur persos WIP — `Missing` ne sort que ≤ 2
      slots manquants ; **(2)** ligne agrégée « N pieces below max enhance » (cap +10, +15 si ascended) ;
      cf. changelog). **Reste — (3) lot secondaire** (main off-scaling vs `meta.dmgStat`, basse qualité,
      « 4pc dispo en inventaire ») : nécessite de **passer l'inventaire complet** à `computeAdvice` (thread
      `inventory.gear` + `meta.dmgStat` dans `AdviceInput`) — plus gros changement, différé.
- [~] ⚪ **Optims mineures Inventory (si profilage)** — double virtualisation + fusion des 7 `useMemo`
      d'availability livrées (cf. changelog). **Reste** : `computeQuality` est encore recalculé dans
      `matchesFilters` (chip quality actif) et le panneau de détail — un précalcul partagé (`toUiPiece` /
      map par UID) traverserait la frontière adapter↔quality, différé tant que le profilage ne le réclame pas.

### Persistence
- [~] **Snapshot `data/` versioning** — stamp + expo livrés (`build.mjs` → `version.json` `{ hash, builtAt }`,
      affiché Settings → Data ; cf. changelog). **Reste (différé — touche les caches Builder)** : comparer le
      `hash` au démarrage vs un `gs.data.hash` stocké et, au changement, **invalider/élaguer** les caches
      localStorage (SavedBuild référençant des `pieceUids` disparus, presets). À faire dans la couche storage /
      au boot, hors UI Builder.
- [~] **Equip / Unequip** — méthodes core + endpoint writer + client + **déclencheur Builder « Equip
      build »** livrés (popup de confirmation → `equipPieces` réécrit le snapshot en 1 passe → `refreshInventory` ;
      cf. changelog). **Reste (optionnel)** : un déclencheur côté **Builds** (unequip / assignation par slot).
      → consommé par la **worklist** (§ Workflow) pour le « fait ».

### Externe — packaging desktop (vérif sur un vrai build, le plumbing existe)
- [~] **Support Mobile et emulateur** — **émulateurs : LIVRÉ** (détection générique via `adb devices` +
      override « Manual device » → tout émulateur rooté marche, plus seulement LDPlayer/MuMu/Nox ; cf.
      changelog — à **valider sur un vrai ému** non-profilé). **Reste : mobile/physique** — bloqué par le
      root (téléphone rooté = ADB USB + cert via module Magisk à câbler ; non-rooté = hors de portée, c'est
      une limite physique pas un manque de code). Le wizard signale déjà « physique pas supporté ».
- [~] 🟢 **Capture no-root** — livré par la **source Steam** (plugin BepInEx `tools/capture-steam/`, cf.
      changelog 2026-09-05) : plus de root, d'émulateur ni de proxy pour les joueurs PC. Le root reste
      requis pour la voie émulateur (redirect iptables + CA système, cf.
      [tools/capture/README.md](../tools/capture/README.md)) — plus de raison d'y investir.
      Validé en jeu le 2026-09-05 (hook principal `Log2InternalWeb` actif, 9 endpoints capturés,
      auto-import OK — cf. changelog). **Reste** : (a) vérifier qu'un compte mobile se lie au client
      Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester le chemin « BepInEx absent »
      (download + pose dans le dossier du jeu) sur une install vierge — sur la machine de dev BepInEx
      était déjà là ; (c) mobile physique : toujours bloqué par le root (limite physique, cf. item
      au-dessus).
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé →
      sync SHA → download des 19 artefacts solver depuis `Sevih/outerpedia` (sans rebuild) ; images
      peuplent le cache à la demande depuis R2 + préfetch des icônes d'équipement référencées par la
      donnée. Vérifier `/img/*` ne tape R2 que sur miss (127.0.0.1 ensuite) · 2e lancement SHA
      inchangé = instantané · simuler un patch (`OUTERPEDIA_REF` autre branche) · offline cold-cache
      = pas de crash. (Mode REPO déjà smoke-testé hors packaging le 2026-08-12 : download @ 387a58c OK.)

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
