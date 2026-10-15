# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **Décision** = à trancher avant de coder.
>
> Dernier passage : 2026-10-15. Les bugs confirmés de l'audit du 2026-09-07 sont livrés (T3, T4, T10, T14,
> #23-#29 ; cf. git log). En tête : les constats de la revue du 2026-10-09 (identifiants C/M de la revue),
> tous revérifiés sur `main` au 2026-10-15.

---

## Reste à faire

### 🔴 Revue 2026-10 — calcul de la fiche
- [ ] 🔴 **M1 — Niveau de set faux en mélange BT4/BT3** — `computeSetBonuses` (`composeBuild.ts`) passe au palier 2
      seulement si **toutes** les pièces du set sont BT4 ; le jeu prend le minimum des 2 (2P) ou 4 (4P) meilleures
      (`[4,4,3]` : 35 % en jeu, 30 % ici). Même règle recopiée dans `BuildEffectsPanel` (BuilderScreen) et
      `docs/reference.md`. Une seule fonction de niveau de set dans `core`, et le niveau dans la clé de dominance
      de `pruneDominatedForCp` (une BT3 peut aujourd'hui éliminer une BT4 meilleure du même set). Voir aussi O5
      (§ Contrat).
- [ ] 🔴 **M4 — Héros fusionnés calculés sur l'origine dans le Builder et le moteur** — Builds utilise
      `effectiveCharId` depuis T16, pas le Builder ni `precomputeContext` : pas de passif de cœur, mauvais
      `charLevelMax`, mauvaise stat de dégâts (Snow 1370 ATK au lieu de 1503). Un seul helper « héros effectif »
      dans `core`, appelé par Builds, Builder, moteur et Worklist ; corriger le commentaire du Builder qui dit
      l'inverse.
- [ ] 🟡 **Main stat en float32** — `parse.ts` `mainMult`/`roundMain` calcule en double + epsilon, le jeu en float32
      (`CItemMainOption`) : 21 cas d'écart d'arrondi. Porter la chaîne d'outerpedia.
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
- [ ] 🔴 **M7 — Priorité partielle : des emplacements de gemme restent vides** — `solver/gems.ts` s'arrête dès que
      le score est ≤ 0 (talisman `[15050, 15050, 0, 0, 0]`, le +20 % ATK des gemmes possédées disparaît de la fiche
      et de la CP). **Décision** : compléter par CP ou par la stat la plus utile, une fois la priorité servie ?
- [ ] 🔴 **M11 — ΔCP du Builder trompeur** — compare le build projeté (+10R6) à la CP réelle actuelle : un build
      identique à l'équipement affiche un ΔCP positif. **Décision** : base du ΔCP (équipé projeté pareil, ou
      projeté vs réel affiché comme tel) ?
- [ ] 🔴 **M12 — Worklist « Apply all » : deux builds d'un même héros sur un même emplacement** — `plan.ts` annonce
      « 0 contention » et la plus ancienne gagne, alors que `worklistClaims` dit « la plus récente gagne » et que la
      docstring « indépendant de l'ordre » de `equip.ts` est fausse (#18 ne couvre pas ce cas). **Décision** :
      quelle règle pour ce doublon (la plus récente, la plus ancienne, ou un conflit affiché) ?
- [ ] 🟠 **M8 — Allocation de gemmes en SOLVE CP non optimale** — le glouton prend des gemmes de réduction de dégâts
      (34 643 CP contre un optimum à 35 044 sur Ame ; chiffres non relancés). `allocateGems` et `aggregateGemDelta`
      font le même travail : n'en garder qu'un.
- [ ] 🟠 **M10 — La projection ignore l'étoile et la rareté** — une pièce 5★ est projetée à +15R9 avec un passif de
      singularité, ce que le jeu refuse (`GetMaxSmeltingCount`, `IsSingularityActivate`). Lié : `UiPiece.reforge.max
      = star` faux pour les pièces ascendées. **Décision** : vue « tout en 6★ » assumée, ou plafond réel par pièce ?
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
- [ ] 🔴 **L1 d'abord — versionner le contrat** — `schema` (entier) et `resVersion` dans `solver/version.json` ;
      `data-sync.ts` refuse un schéma plus récent que le sien et garde son cache. Aujourd'hui un push d'outerpedia
      qui change la forme casse toutes les installations à la fois (le chargeur caste le JSON sans le valider).
- [ ] 🔴 **C1 — Sets à effet de combat comptés comme stats de fiche** — Pulvérisation (17), Faiblesse (20, signe et
      cible retournés par `abs()`), Augmentation (21), Immunité 4P niveau 2 (18) : `resolveSetEffectEntry`
      (outerpedia) convertit leurs IOT_BUFF en stat, `computeSetBonuses` ne filtre pas → CP gonflée (+1 477 à
      +7 301 sur 59 142), « Max CP » sur-sélectionne ces sets. Ne produire en stat que les IOT_STAT ; côté
      gear-solver, ne rien compter sans `st`. **Décision** : exposer les IOT_BUFF dans un champ `combatEffects`
      affiché, ou seulement les retirer de la CP ?
- [ ] 🔴 **M2 — Uniques d'arme et d'accessoire qui touchent la fiche, ignorés** — Phantasm Necrosis (SPD −30 % caché,
      CP trop haute de ~8 000 à 220 SPD), Ambition de Briaréos (RES +20 à 40 %, niveau = 1 + BreakLimitCount).
      Générer les BT_STAT_PREMIUM/PASSIVE ciblant ME, cachés compris. **Décision** : livrer sur la preuve par le
      code, ou attendre une capture ?
- [ ] 🔴 **M3 — Unique IOT_STAT de l'EE de Fatal (2000078) absente** — CHD +30 % à +10 perdu : le contrat ne sort
      que les uniques IOT_BUFF. Seul cas parmi les EE.
- [ ] 🟡 **Vitesse en % du noyau** (`spdPct`) émise en taux et cuite au niveau courant par les deux compositeurs
      (aujourd'hui pré-cuite, erreur commune au wiki et au solver).
- [ ] 🟡 **Passif de cœur par niveau de fusion** — `corePassive` est un seul bloc pris au niveau max : faux pour une
      fusion 1 à 4 (Notia).
- [ ] 🟡 **Filtre des passifs de skill trop strict** côté contrat (`extractSkillPassiveByLevel` : ME seul, condition
      NONE, `TurnDuration −1`) ; sans rejet constaté aujourd'hui.
- [ ] 🟡 **O5 — Paliers de set par pièce et `IgnoreLowSet`** — le contrat n'émet ni les paliers séparés ni
      `ignoreLowSet` (2 pièces palier 2 + 2 palier 1 : 55 % en jeu, 50 % ici). **Décision** : maintenant (avec M1)
      ou plus tard ?
- [ ] 🟡 **L6 — Une table `ST_*` → clés unique**, émise dans le contrat (`solver/stat-keys.json`) et lue par
      `GAME_STAT` et par le wiki. Y faire entrer les mains d'EE `ST_AVOID` (précision vs élément), présentes dans
      `buffs.json` mais inconnues de `GAME_STAT` → le main disparaît du panneau au lieu d'être affiché combat-only.
- [ ] 🟡 **Mode CHECKOUT : fichier absent sauté par un `continue` muet** (`data-sync.ts`) alors que `data/sync.mjs`
      sort en erreur ; `SOLVER_FILES` recopié dans `data/sync.mjs` et `data-sync.ts`. Une seule liste exportée
      (core) et la même règle d'échec.
- [ ] 🟡 **Test de forme croisé** — `CharacterIngredients` et `StatBlock` définis deux fois (outerpedia
      `solver-ingredients.ts`, `core/gamedata.ts`), identiques aujourd'hui, rien ne le garantit.
- [ ] ⚪ **Règles du jeu recopiées à la main** au lieu de venir du contrat : `REFORGE_PER_SUB_CAP`
      (`OptionMaxValue`, que `parse.ts` n'applique pas non plus : sans effet tant que max = 6 × valeur), budgets
      6/9 (`AddSmeltingCount`), emplacements de gemme (`GemSlot`), `EVO_UNLOCK_LEVEL`. `ee-passives` ne garde que
      TargetType ME et le niveau de buff le plus haut (0 écart, fragile). `trust-buffs.json` synchronisé et chargé
      mais jamais lu (à raison : buffs de combat) → cesser de le charger.
- [ ] ⚪ **L10 — outerpedia consommateur de `packages/core`** : abandon recommandé (deux compositeurs tenus par un
      oracle client commun). **Décision**.

### 🟡 Revue 2026-10 — divers
- [ ] 🟡 **`Talisman` de `/api/reco` ignoré** — outerpedia émet `Talisman?: RecoGearStat[]`, le type recopié dans
      `translateReco.ts` ne l'a pas. Décidé le 15/10 : lu en contrainte « préféré » (lot G4).
- [ ] 🟡 **Plancher de « Maxed only » pour une pièce sous 6★** — une 5★ n'atteint jamais le budget du mode.
      Décidé le 15/10 : il voudra dire « au plafond de la pièce » ; petit lot après G2.
- [ ] ⚪ **`trust-buffs.json` chargé, jamais appliqué** (`apps/renderer/src/data.ts:79`) — s'il sert un jour, il
      faudra la chaîne d'affinité par perso (une seule stat par héros, pas les trois) : outerpedia la corrige côté
      site (lot C24) sans toucher au contrat.
- [ ] 🟡 **Plugin Steam en repli** : `GiftList` entre en collision avec `PVPStart` → écrit les geas de l'adversaire ·
      écritures du plugin dans un ordre non FIFO · ré-import déclenché par le seul mtime de `user_item`.
- [ ] 🟡 **data-sync** — `derivedReady` ne teste que `characters.json` · échecs de `writeAtomic` avalés · octets
      non JSON écrits tels quels · pas de verrou contre deux syncs simultanées.
- [ ] ⚪ **Desktop** — écritures du serveur non atomiques · `img-cache` ne revalide jamais une image en cache ·
      une route `/api/*` inconnue répond 200 avec `index.html` · `release.mjs` ne restaure que `package.json` en
      cas d'échec · champ `InvenType` déclaré dans `raw.ts` mais absent des captures.
- [ ] ⚪ **Commentaires morts vers outerpedia-v2** — `EquipmentIcon.tsx`, `GameText.tsx`, `Shell.tsx`,
      `InventoryScreen.tsx`, `BuilderScreen.tsx`, `core/gamedata.ts`, `core/parse.ts`.

### 🟡 Audit projet (2026-09-07) — reste
- [ ] 🟡 **`emptyReason` accuse l'EE** — `poolSizes.exclusive.hit = ee ? 1 : 0` : un héros sans EE affiche
      « Exclusive: 0 pieces after filters » alors que le solve tourne sans EE. Exclure `exclusive` de `dead`. Même
      écran : après un « Filter » client qui vide la table, message « Pick a hero and click SOLVE » au lieu de « filtré ».
- [ ] 🟡 **`mergePreset` peut rendre les filtres contradictoires** — remplace `setPlans` par ceux de la reco mais
      laisse `excludedSets` : set requis + exclu → 0 build sans explication. Retirer des `excludedSets` les sets des
      nouveaux plans (ou avertir).
- [ ] ⚪ **Stat-locks (debug) : `renameLegacyStatKeys` non appliqué** au fichier lu via `/api/stat-locks` — un
      fichier ancien (`crc`, `chd`, …) ne matchera jamais.
- [ ] ⚪ **Code mort** — `SourcePicker` n'offre jamais le retour à « auto » (`onChange(null)`) ·
      `addWorklistEntry`/`removeWorklistEntry`/`toggleWorklistChange` (worklist.ts) réimplémentés inline ·
      `DebugFlag "capture"` · `GearCard` reçoit des props « reserved for pimp » jamais rendues · `equipPiece`/
      `unequipPiece` (renderer `equip.ts`) · `toIconPiece` · `statColor` · `loadHeroPriority`/`persistHeroPriority` ·
      option `allowZeroPriority` · `has4pc`.
- [ ] ⚪ **Reset (Builds)** remet aussi le tri `byRank` à CP alors que la condition d'affichage ne le regarde pas ·
      clamp worker count à `hardwareConcurrency` côté Settings vs `WORKER_COUNT_CEILING` côté orchestrateur.
- [ ] 🟠 **`scripts/release.mjs` ne lance ni typecheck ni tests avant `publish`** (la CI les passe sur PR et `main`).
- [ ] 🟠 **Aucun ESLint configuré** — les `eslint-disable-next-line react-hooks/exhaustive-deps` sont inertes, les deps
      de hooks ne sont vérifiées par rien. Ajouter `eslint.config.js` (typescript-eslint + react-hooks) et corriger ce
      qui sort.
- [ ] 🟡 **`packages/core` déclare `vite` en dependency** (jamais importé, le package est « pure TS ») — supprimer.
- [ ] 🟡 **Dépendance inversée `lib → screens`** — `filterPresets.ts` et `heroFilters.ts` importent `SolverFilters`
      depuis `screens/BuilderScreen`. Déplacer le type + le reducer dans `lib/solver/builderFilters.ts`.
- [ ] 🟡 **Duplications** — formule CalcFinalStat (`calcFinalStat` core vs `composeMultStat` renderer) · calcul de
      qualité en 3 exemplaires (`computeQuality` de GearDetail et ResultGearDetail, `quality.ts`) · « slot changé »
      défini 3× dans le Builder (`equipPlan`, `addToWorklist`, `pieceBySlot`) → une `diffBuildVsLoadout` partagée,
      même invariant que `upg` moteur.
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
- [ ] 🟡 **Composants monolithiques** — BuilderScreen ~4600 lignes (~40 composants + reducer), InventoryScreen 1350,
      SettingsModal 1210 (5 panes + helpers réseau), HomeScreen `computeStats` 200 lignes. Découpage proposé :
      `builderFilters.ts`, `catalogs.ts`, `ResultsTable`, `BottomGearBand`, `BuilderToolbar` + panels, `RightSidebar`,
      `FilterFooter`, hook `useSolverSession` ; une pane par fichier côté Settings.
- [ ] ⚪ **`window.alert` / `confirm` bloquants** dans SettingsModal alors que l'app a une barre de status.
- [ ] ⚪ **Casts JSON non validés** (`as PreflightResult`, stat-locks `as Record<…>`, `j.ItemList` sur `any`).
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

### Externe — packaging desktop (vérif sur un vrai build, le plumbing existe)
- [~] **Support mobile et émulateur** — émulateurs livrés (détection `adb devices` + « Manual device » ; à valider sur
      un vrai ému non profilé). **Reste : mobile physique** — bloqué par le root (rooté = ADB USB + module Magisk à
      câbler ; non rooté = hors de portée). Le wizard signale déjà « physique pas supporté ».
- [~] 🟢 **Capture no-root** — livrée par la source Steam (plugin BepInEx, validé en jeu le 2026-09-05). **Reste** :
      (a) vérifier qu'un compte mobile se lie au client Steam (FAQ MAJOR9) avant de le vendre aux joueurs ; (b) tester
      le chemin « BepInEx absent » (download + pose dans le dossier du jeu) sur une install vierge.
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · installeur qui lance serveur local + renderer
      · mise à jour automatique sur un vrai feed de release · bouton capture natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** — 1er lancement online : seed `data/derived` bundlé → comparaison du hash de
      `version.json` → download des artefacts solver depuis `Sevih/outerpedia` ; images en cache à la demande depuis
      R2. Vérifier `/img/*` ne tape R2 que sur miss · 2e lancement inchangé = instantané · simuler un patch
      (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
