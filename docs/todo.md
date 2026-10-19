# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **Décision** = à trancher avant de coder.
>
> Dernier passage : 2026-10-19 — sortis : L1 (fait), L10 (abandonné), le filtre des passifs de skill (fait côté
> contrat), le mode CHECKOUT, le test de forme croisé et M3 ; section packaging requalifiée (installeur, données
> embarquées, mise à jour automatique et releases livrés). Les bugs confirmés de l'audit du 2026-09-07 sont
> livrés (T3, T4, T10, T14, #23-#29 ; cf. git log). En tête : les constats de la revue du 2026-10-09
> (identifiants C/M de la revue), tous revérifiés sur `main` au 2026-10-15.

---

## Reste à faire

### 🔴 Revue 2026-10 — calcul de la fiche
- [ ] 🟡 **M5 — Niveaux de compétence des fusionnés** — le jeu les reconstruit depuis `CharacterFusionLevel`, l'outil
      prend `First..Ultimate` de la capture (jusqu'à +1 200 CP d'écart). **Bloqué** : il faut une capture d'un
      fusionné dont les compétences d'origine dépassent celles de la fusion.
- [ ] 🟡 **Mineurs de fiche (revue)** — set Vitesse appliqué sur une base qui inclut les buffs OAT_ADD (~+3 SPD en 4P
      sur Claire, Faenan, Delta…) · `critRate` non borné à [0, 100] dans `FinalStats` (affichage, filtres, scaling
      secondaire crc de Regina) · CP en double au lieu de float32 (±1 sur ~0,5 % des fiches) · ATK/DEF/HP plats
      issus de `fromBuff` perdus, OAT_ADD sur EFF/RES traité en taux (latent) · `combatOnly` des mains d'EE décidé
      par le nom et non par le Type (latent) · `composeCharStats` ignore l'ATK plat de classe/skill8/cœur (vaut 0
      aujourd'hui) · `awakValue` : ATK prend `geas.atk` toutes sources, EFF/RES `geasStat` — unifier.

### 🔴 Revue 2026-10 — moteur et Builder
- [ ] 🟠 **M8 — Allocation de gemmes en SOLVE CP non optimale** — le glouton prend des gemmes de réduction de dégâts
      (34 643 CP contre un optimum à 35 044 sur Ame ; chiffres non relancés). `allocateGems` et `aggregateGemDelta`
      font le même travail : n'en garder qu'un.
- [ ] 🟡 **Mineurs moteur / Builder (revue)** — score arrondi utilisé comme clé de tri (ex aequo arbitraires) ·
      variantes de talisman fusionnées après le top-K par worker (candidats perdus) · erreur d'un worker → résultats
      partiels affichés sans avertissement · `allowBrokenSets=false` + Top% peut donner 0 build sans explication ·
      SOLVE CP avec priorité ne fixe pas l'équipement actuel · clés `mainStat` des recos non validées
      (`translateReco`, latent) · en-tête « N slots change » périmé après Equip · `plan.ts` marque cycliques les
      entrées qui ne font que dépendre d'un cycle · `buildAdvice` propose « +5 pour un 5e emplacement de gemme » aux
      talismans 4★/5★ qui n'en ont pas.

### 🔴 Contrat solver (avec outerpedia)
> Ordre pour tout changement de forme : outerpedia ajoute sans retirer et pose `schema` ; une version de gear-solver
> qui lit le nouveau champ est publiée ; ensuite seulement on retire l'ancien.
- [~] 🟡 **L6 — Une table `ST_*` → clés unique**, émise dans le contrat (`solver/stat-keys.json`) et lue par
      `GAME_STAT` et par le wiki. Y faire entrer les mains d'EE `ST_AVOID` (précision vs élément), présentes dans
      `buffs.json` mais inconnues de `GAME_STAT` → le main disparaît du panneau au lieu d'être affiché combat-only.
      Table du contrat tenue sous test (G30) ; reste le main d'EE `ST_AVOID` affiché combat-only, et la lecture par
      le wiki côté outerpedia.
- [ ] ⚪ **Règles du jeu recopiées à la main** au lieu de venir du contrat : `REFORGE_PER_SUB_CAP`
      (`OptionMaxValue`, que `parse.ts` n'applique pas non plus : sans effet tant que max = 6 × valeur), budgets
      6/9 (`AddSmeltingCount`), emplacements de gemme (`GemSlot`), `EVO_UNLOCK_LEVEL`. `ee-passives` ne garde que
      TargetType ME et le niveau de buff le plus haut (0 écart, fragile).

### 🟡 Revue 2026-10 — divers
- [ ] 🟡 **Plugin Steam en repli** : `GiftList` entre en collision avec `PVPStart` → écrit les geas de l'adversaire ·
      écritures du plugin dans un ordre non FIFO · ré-import déclenché par le seul mtime de `user_item`.
- [ ] 🟡 **data-sync** — `derivedReady` ne teste que `characters.json` · échecs de `writeAtomic` avalés · octets
      non JSON écrits tels quels · pas de verrou contre deux syncs simultanées.
- [ ] ⚪ **Desktop** — écritures du serveur non atomiques · `img-cache` ne revalide jamais une image en cache ·
      une route `/api/*` inconnue répond 200 avec `index.html`.

### 🟡 Audit projet (2026-09-07) — reste
- [ ] ⚪ **Stat-locks (debug) : `renameLegacyStatKeys` non appliqué** au fichier lu via `/api/stat-locks` — un
      fichier ancien (`crc`, `chd`, …) ne matchera jamais.
- [ ] ⚪ **Reset (Builds)** remet aussi le tri `byRank` à CP alors que la condition d'affichage ne le regarde pas ·
      clamp worker count à `hardwareConcurrency` côté Settings vs `WORKER_COUNT_CEILING` côté orchestrateur.
- [ ] 🟡 **Duplications** — formule CalcFinalStat (`calcFinalStat` core vs `composeMultStat` renderer) · calcul de
      qualité en 3 exemplaires (`computeQuality` de GearDetail et ResultGearDetail, `quality.ts`).
- [ ] 🟡 **Effets de bord dans des updaters `setState`** (persist localStorage dans App/Builds — exécutés 2× en
      StrictMode) · `setState` après `await` sans garde d'unmount (BuildsScreen stat-locks, WorklistScreen,
      SettingsModal).
- [ ] 🟡 **Perf render App** — badge Builds et `remainingChangeCount` recalculés sur tout `inv.gear` à chaque render
      (y compris chaque ligne de log de capture) → `useMemo` · `setLog((l) => [...l, line])` O(n²) · `equippedByHero`
      reconstruit 4× par changement d'inventaire (reconcile, claims, badge, WorklistScreen) → une map mémoïsée.
- [ ] 🟡 **Perf Inventory** — `matchesFilters` reconstruit la chaîne `hay` et rappelle `computeQuality` par pièce à
      chaque frappe (2×1000 recalculs) → précalculer dans `toUiPiece` (cf. item « Optims mineures Inventory »).
- [ ] 🟡 **Composants monolithiques** — BuilderScreen ~4600 lignes (~40 composants + reducer), InventoryScreen 1350,
      SettingsModal 1210 (5 panes + helpers réseau), HomeScreen `computeStats` 200 lignes. Découpage proposé :
      `builderFilters.ts`, `catalogs.ts`, `ResultsTable`, `BottomGearBand`, `BuilderToolbar` + panels, `RightSidebar`,
      `FilterFooter`, hook `useSolverSession` ; une pane par fichier côté Settings.
- [ ] ⚪ **`window.alert` / `confirm` bloquants** dans SettingsModal alors que l'app a une barre de status.
- [ ] ⚪ **Casts JSON non validés** (stat-locks `as Record<…>`, `j.ItemList` sur `any`).
- [ ] ⚪ **`useMemo(…, [])` comme « lire une fois »** (HomeScreen) → initialiseur `useState`.

### 🟢 Ratings offensifs — après la colonne « meilleur skill » (2026-09-05)
- [ ] 🟢 **DPS de rotation pondéré par les cooldowns** — `dmgs` = hit du meilleur skill × SPD, pas une rotation. La
      donnée damage d'outerpedia porte déjà `levels[].cool` / `startCool` par skill : un facteur « moyen par tour »
      (S1 filler + S2/S3 quand dispo) est calculable côté générateur. À faire dans le pipeline (nouveau champ),
      jamais en parsant localement.
- [ ] ⚪ **DoT dans le meilleur hit** — assumé non modélisé (Gnosis Beth sous-estimée) ; ne traiter que si le moteur
      damage expose un facteur DoT par skill comparable au hit direct.

### 🟢 Tests manquants — audit Builder (2026-07-03)
- [ ] 🟢 **Crit-cap slow path de bout en bout** — rien ne teste le trigger `wantCritCap` + recompose dans `solveChunk`
      (le chemin par-combo `allocateGemsReachingCap` + `gemDeltaEquals` + le memo `capAllocCache`).
- [ ] 🟢 **Flux orchestrateur** — cancel / supersede / `solveId` anti-stale / `workersDone === activeChunks` / crash
      worker (`onerror` → cancel) / flux `estimate` (id anti-stale, null-on-error) : aucun test.

### 🟠 Perf solver
- [~] **Solver CP** — perf résolue (> 100 s → < 4 s sur un vrai compte : auto-prune CP-pondéré + budget de combos,
      gemmes notées par apport CP, pin du build courant ; cf. changelog). **Reste** : (a) confirmer en jeu la justesse
      du top-CP (≥ build équipé) ; (b) *optionnel* : la notation standalone peut sous-classer un membre de set couplé
      (garde set-aware) ; (c) *optionnel* : B&B CP exact.
- [ ] *(optionnel, si profilage)* Profiler un vrai solve (DevTools) · **SharedArrayBuffer** pour le flag `cancelled`
      (COOP/COEP) · **Object pool** `FinalStats`/`CheapRatings`.

### 🟡/⚪ UX-cohérence & nits
- [~] 🟡 **`Advices` (tab Builds)** — **reste le lot secondaire** (main off-scaling vs `meta.dmgStat`, basse qualité,
      « 4pc dispo en inventaire ») : il faut passer l'inventaire complet à `computeAdvice` (`inventory.gear` +
      `meta.dmgStat` dans `AdviceInput`).
- [~] ⚪ **Optims mineures Inventory (si profilage)** — **reste** : `computeQuality` encore recalculé dans
      `matchesFilters` (chip quality actif) et le panneau de détail ; un précalcul partagé (`toUiPiece` / map par UID)
      traverserait la frontière adapter↔quality, différé tant que le profilage ne le réclame pas.

### Persistence
- [~] **Snapshot `data/` versioning** — stamp `version.json` livré. **Reste** : comparer le `hash` au démarrage à un
      `gs.data.hash` stocké et, au changement, invalider/élaguer les caches localStorage (SavedBuild référençant des
      `pieceUids` disparus, presets). Dans la couche storage / au boot, hors UI Builder.
- [~] **Equip / Unequip** — Builder « Equip build » et Worklist livrés. **Reste (optionnel)** : un déclencheur côté
      **Builds** (unequip / assignation par slot).

### Externe — vérifs sur la version installée
- [~] 🟢 **Capture no-root** — livrée par la source Steam (plugin BepInEx, validé en jeu le 2026-09-05). **Reste** :
      (a) vérifier qu'un compte mobile se lie au client Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester
      le chemin « BepInEx absent » (download + pose dans le dossier du jeu) sur une install vierge.
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé → comparaison du hash de
      `version.json` → download des artefacts solver depuis `Sevih/outerpedia` ; images en cache à la demande depuis
      R2. Vérifier `/img/*` ne tape R2 que sur miss · 2e lancement inchangé = instantané · simuler un patch
      (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
