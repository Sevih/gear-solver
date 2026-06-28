# Changelog — livraisons gear-solver

> **Journal de ce qui a été livré** (le « suivi »). Les tâches **ouvertes** vivent dans
> [todo.md](todo.md) ; le détail commit-par-commit est dans l'historique git, et les jalons
> dans [roadmap.md](roadmap.md).

---

## Items de backlog clôturés (index)

### 🟠 Perf solver
- ✅ **Pruning par dominance (SOLVE CP)** — la CP étant monotone-croissante en chaque stat finale (et chaque
  stat finale en chaque entrée de bucket `flat/pct/buffPct`), une pièce dont la contribution est dominée
  composante-par-composante par une autre du **même slot + groupe** (set pour l'armure, effet pour
  arme/accessoire) ne peut jamais produire un build de CP supérieure → `pruneDominatedForCp` (`engine.ts`)
  l'élague du pool **avant le cartésien** (réduction multiplicative du nombre de combos). Ne compare que les
  axes de bucket réellement lus par `finalStatsFromBuckets` (CP-pertinents), et tourne **en dernier** (après
  onlyMaxed / set / projection reforge / top-%) sur le **tableau de pool exact que le solve itère** : la
  preuve de monotonie porte sur les nombres composés, donc elle tient quel que soit le `reforgeMode` (stats
  capturées en `disable`, projetées au plafond en `classic`/`ascended`) et que `onlyMaxed` soit actif ou non
  — le mode change *quelles* pièces survivent, jamais la correction. Désactivé si un filtre pourrait rendre un build à stats plus basses uniquement
  admissible (**borne max** sur une stat, ou **tout** filtre rating/cp/upg) ; les bornes min seules restent
  optimisées. Talisman/EE exemptés (gemmes issues de l'alloc globale + reroute de cap par-combo cassent la
  monotonie par-pièce). Exact au sommet du classement CP ; seuls des quasi-doublons strictement ≤ quittent la
  queue. +10 tests `dominance.test.ts` (drop strict, ties/Pareto/groupes gardés, reforge, équivalence top-CP
  end-to-end via `solveChunk`).
- ✅ **Accumulateur de buckets — re-sum déféré** — `aggregatePrefixBuckets` somme les 6 pièces
  invariantes (weapon..accessory) **1×/itération accessory** ; `computeFinalStatsFromPrefix` clone
  ce prefix et n'ajoute que talisman → EE → gemOverride → setBonuses, **dans l'ordre de slot exact**.
  Bit-identique (helpers `addPieceToBuckets`/`addGemOverride`/`addSetBonuses` partagés full/incremental).
  +4 tests d'équivalence (ee on/off × override on/off) + couvert par le test solveChunk 0-diff.

### 🟡/⚪ UX-cohérence & nits
- ✅ 🟡 **`noCrit` dans le scoring du solver** — `precomputeContext` lit `meta.noCrit` →
  `computeCheapRatings(fs, dmgStat, dmgSec, noCrit)` force `pCrit = 0` (le terme CHD disparaît, `mcd`
  retombe sur le hit non-crit). **CP laissé fidèle** (miroir 0-diff in-game). +4 tests `solver.test.ts`.
- ✅ 🟡 **`SlotMini` cliquable (Builds)** — hover sur une pièce équipée → `RichTooltip`
  (`placement="right"`) + `GearDetailBody` (panneau d'inspection complet, pas une version réduite).
- ✅ 🟡 **Conservation des résultats** — Builder reste monté (`display:none` quand inactif) :
  résultats / filtres / héros conservés + solve en fond. `initialHeroUid` consommé sur changement de prop.
- ✅ 🟡 **Reset des tris/filtres au lancement** — `useSessionState` (sessionStorage) : Inventory
  (tab/sort/dir/filters) + Builds (roster filters) session-scoped, remis au défaut au lancement.
  `gs.builds.notes` reste durable.
- ✅ 🟡 **Show/hide colonnes — clic-droit** — état `open` de `ColumnsMenu` remonté dans `ResultsTable` ;
  `onContextMenu` sur le `<tr>` d'en-tête `preventDefault()` + ouvre le menu.
- ✅ 🔍 **Cap de Quality — vérifié en jeu (aucun changement)** — confirmé : la note se fait sur l'**investi**,
  pas sur le potentiel ni les étoiles. Un 6★ non reforge a un socle **4/4/3/3 = 14** ; reforge ×2 → noté sur 16.
  Donc `computeQuality` = `14 + reforges_faits` (`max = 14 + reforge.n`) est **correct** — rien à corriger.
  (A fait surgir un nit séparé : le tint doré `isMax = s.lv >= stars` a un mauvais seuil par-sub, cf. todo.)
- ⚪ **`SLOT_MAIN_PLACEHOLDER.accessory = "hp"`** (wontfix assumé) — placeholder faux quand aucun build
  n'est sélectionné, **laissé volontairement** pour ne pas diverger du panneau Inventory qui partage la
  map. À ne reprendre que si les deux maps divergent.

### 🟢 Features
- ✅ 🟢 **Rentabilité % vs Flat (subs)** — encadré « Sub tick value » (Builder) : par héros, la valeur
  d'un tick de sub 6★ en flat vs en %. Un tick % scale sur `base+evo+awak` (gear-indépendant) → verdict
  = fonction de la base. Dérivé `sub-ticks.json` (`subStatPools` outerpedia) ; `lib/subValue.ts` (+5 tests).
- ✅ 🟢 **Rentabilité dégâts par +1% (subs offensifs)** — encadré « Damage / +1% » : gain de dégâts pour
  +1% de chaque stat de scaling (ATK/DEF/HP/SPD via `dmgStat`+`dmgSec`) vs CHD vs DMG inc, **à 100% crit**.
  Réutilise `computeCheapRatings` (formules 1.4.9) ; `lib/dmgValue.ts` (+4 tests).

### Tests (fixtures lourdes)
- ✅ **CP solver vs Builds** — `solveChunk.test.ts` : `solveChunk` CP → `finalizeBuilds` → `computeFinalStats`
  + `calcBattlePower` recalculés indépendamment = **0-diff** (stats **et** CP) ; ratings différés recalculés.
- ✅ **mid-tree pruning** — pools A/B 2-par-slot, `req-4pc A` → 1 combo scoré (chemin all-A) vs 16
  brute-force ; cas insatisfiable → 0 combo, search élaguée. `SolveContext` hand-construit.

---

## Journal de session (Livré)

### Session 2026-06-28 — 🟡 Onboarding : Setup pane → wizard linéaire brand-aware

Le Setup pane (auto-ouvert au 1er lancement) était une **checklist plate** de 4 checks (emulator
installed/running · ADB · root) — du jargon technique balancé d'un coup. Transformé en **wizard guidé**
qui ne montre que le **blocage courant**, avec instructions **par marque** d'émulateur.

- **Stepper** ([`SettingsModal.tsx`](../apps/renderer/src/design/SettingsModal.tsx) `SetupPane`) : barre de
  progression `N/4`, étapes franchies repliées (✓), étape courante en carte cyan « step N of 4 » + fix +
  détail live, étapes à venir grisées. **Re-check** (footer) fait avancer le wizard.
- **Brand-aware** (`BRAND_FIX`) : les étapes ADB / root affichent le **chemin de menu exact** selon
  `result.emulator.type` (LDPlayer / MuMu / Nox) au lieu d'un texte générique.
- **Cas « pas d'émulateur »** : l'étape install liste les 3 émulateurs supportés (LDPlayer recommandé) +
  note honnête « root requis, Google Play Games KO, mobile/autre émulateur pas encore supporté — roadmap »
  (le mobile reste l'item séparé « Support Mobile et émulateur »).
- **Étape finale** (`ReadyCard`, quand `ready`) : les **vraies next-steps** de capture (Arm capture →
  ouvrir Outerplane → lobby → Disarm pour codex/geas), au lieu de simplement « tout est vert ».
- **Accès fiable** : le bouton **Setup** (header, seul point d'entrée) ouvre désormais **toujours** sur
  l'onglet Setup (= le wizard), pas le dernier onglet. Pas de toggle dédié : l'auto-ouverture au lancement
  reste pilotée par `gs.onboarding.done` (réarmable via Settings → Data → « Reset onboarding prompt »).
  Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Garde-fou cartésien estimé AVANT le clic SOLVE

Le bandeau « ~X combinaisons » n'apparaissait qu'**après** le clic (les `poolSizes` venaient du
precompute au démarrage du solve) : on cliquait, on attendait, *puis* on apprenait que ce serait lent.
Désormais il s'affiche **avant**, et se met à jour à mesure qu'on règle les filtres.

- **Mécanisme** ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) : un
  `precomputeContext` **debounced (250 ms)** tourne sur le main thread quand le héros/filtres/mode
  changent **à l'idle** → `estimatePools`. `cartesianEstimate` lit le **live** `poolSizes` pendant un
  solve, l'**estimation** sinon. Réutilise exactement le precompute de l'orchestrator (mêmes pools).
- **Mode-aware** : le prune diffère (Score+sans-priorité = cartésien complet, CP = budget borné), donc
  l'estimation prépare les pools pour le **mode du bouton SOLVE qui va partir**. Le `solveMode` du split
  button a été **remonté** dans le corps du Builder (threadé `BuilderToolbar` → `SolveButton`).
- Helper `buildSolveFilters` extrait (reducer `SolverFilters` → engine `SolveFilters`), partagé solve +
  estimation. Estimation droppée hors-héros / pendant un solve. Build + 237 tests verts.

### Session 2026-06-28 — 🟢 Exclusion globale de pièces (Inventory → solver)

Clic-droit sur une pièce (Inventory) → **« exclure du solve »** (typiquement des rolls éclatés) → tous
les solves la sautent. Distinct du multi-select « Exclude equipped » (qui exclut le gear d'un *héros*) :
ici c'est une propriété de la **pièce**, account-wide.

- **Storage** ([`lib/storage/excludedPieces.ts`](../apps/renderer/src/lib/storage/excludedPieces.ts),
  `gs.solver.excludedPieces`, **durable** — « cette pièce est nulle » survit à la session), possédé par App.
- **Engine** : `excludedPieceUids` threadé comme `heroPriority` (SolveArgs → SolveRequest → worker) ;
  `allow()` rejette `excludedPieces.has(g.uid)` **en premier**, donc la pièce n'entre dans **aucun** pool
  (couche dure, phase 2 — compose proprement avec l'auto-prune mou phase 3).
- **UI Inventory** : **clic-droit** sur une tile (raccourci power-user) **+** bouton « Exclude from solver »
  dans le panneau de détail (surface découvrable). Tile exclue = liseré rose + icône dimmée + badge ⊘.
  Handler `toggleExclude` stable (`useCallback`, App) → le memo des `GearTile` reste effectif.
  `App.tsx` (state + wiring Inventory↔Builder), `InventoryScreen.tsx`, engine `types`/`orchestrator`/`engine`.
  Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Persistance des filtres par héros (Builder, session-scoped)

Changer de héros **résettait** les filtres (« j'avais mis quoi comme réglage ? »). Désormais les filtres
sont **mémorisés par héros** : on snapshot ceux du héros sortant et on restaure ceux de l'entrant.

- **Storage** ([`lib/storage/heroFilters.ts`](../apps/renderer/src/lib/storage/heroFilters.js),
  `gs.solver.heroFilters`, **sessionStorage** — reset au lancement, comme les autres états de vue ;
  distinct des **Filter presets** nommés/durables). Seul `excludedHeroes` (Set) est converti.
- **Mécanisme** (`BuilderScreen`) : `filtersRef` (miroir live, évite de re-déclencher l'effet à chaque
  édition), `prevHeroRef` (héros chargé), `heroFiltersRef` (map). Sur changement de héros : save sortant
  (`cloneFilters`) → `dispatch(loadPreset)` du snapshot entrant **ou** `resetAll` si aucun. **Les résultats**
  restent vidés (per-hero, stale autrement). Build + 237 tests verts.

### Session 2026-06-28 — 🔴 Fix mirroring : chance de contre affichée brute (« 187 » → « 18.7% »)

Le passif accessoire **Punishment** affichait « Has a **187** chance to Counterattack » au lieu de
**18.7%** (15/18.7/22.5/26.2/30% selon le tier). Vérifié en jeu : le client affiche bien le **%**, donc
c'est un **bug de mirroring chez nous** (et chez outerpedia-v2, qui a la même logique `_is_permille`).

- **Cause** : le buff de contre (`Type = BT_RUN_FIRST_SKILL_ON_TURN_END_DEFENDER`) stocke sa **chance de
  proc en permille** (1000 = 100% → 187 = 18.7%) mais porte `StatType ST_NONE` / `ApplyingType OAT_NONE`,
  donc aucune des règles `isPermille` de [`build.mjs`](../data/build.mjs) ne le captait → valeur brute.
- **Fix** : `isPermille` traite ce `Type` comme permille (tous ses buffs stockent une chance permille ;
  seul Punishment alimente un passif gear via `[Value]`). **Même fix appliqué en amont** dans le
  `_is_permille` d'outerpedia-v2 (on réimplémente la logique en JS depuis les tables brutes → les deux
  copies doivent le porter pour rester synchrones). `npm run data:build` régénère `equipment-passives.json`
  (+ `version.json`). Scan : 0 passif « [N] chance » brut restant.

### Session 2026-06-28 — 🟡 Home : chiffres du dashboard cliquables → Inventory filtré

Les chiffres du dashboard étaient du texte mort. Cliquer sur un facet **draille** désormais vers
l'onglet Inventory **pré-filtré** sur exactement ce sous-ensemble.

- **Cibles** ([`HomeScreen.tsx`](../apps/renderer/src/screens/HomeScreen.tsx)) : les **5 tiers de qualité**
  (« Poor · 150 » → quality=Poor), la répartition **par slot** (« Boots · 12 » → slots=boots), et les
  **top armor sets** (→ armorSets=set). Boutons (hover + tooltip « click to see… »), désactivés à count 0.
- **Mécanisme** : `HomeScreen.onDrill(facet)` → `App` pose un `invDrill` + bascule sur l'onglet Inventory →
  `InventoryScreen` **consomme** le drill (remplace les filtres par le seul facet — donc le grid montre
  exactement le compte cliqué —, reset tab « all », vide la sélection), puis `onDrillConsumed` le nettoie
  (un retour ultérieur ne ré-applique pas un filtre périmé). Type `InventoryDrill` exporté par l'Inventory.
- `App.tsx` (state `invDrill` + wiring Home↔Inventory). Build + 237 tests verts.

### Session 2026-06-28 — 🟡 Défauts solver alignés sur le jeu réel

`INITIAL_FILTERS` ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) — deux défauts
qui trompaient l'utilisateur lambda corrigés :

- **Reforge `disable` → `classic`** : chaque solve note le gear au **+10 endgame** (la norme ; le +15
  coûte des ressources rares), au lieu du gear **capturé** (+0/+9) — un classement sur un état jamais joué.
- **Equipped scope `all` → `lower`** : le solver ne pioche que chez les héros **strictement moins**
  prioritaires (auto-rangés par CP à la capture via `fillUnrankedByOrder`) → ne déshabille **jamais** un
  héros égal/supérieur. Sans ranking, dégrade en own+free (`isLowerPriority` ∞>∞ = false) — sûr partout.
  L'ancien `all` (vol silencieux possible) reste un choix **explicite**.
- **Badge Options recalé** sur la nouvelle baseline (`equippedScope !== "lower"`) → 0 par défaut, se lève
  sur `None`/`All`. Fallback d'affichage du segment → `"lower"`. Engine inchangé (fallbacks API intacts).
- Test de régression #7 ([solver.md](solver.md)) annoté : **Reforge Off** requis pour matcher la card Builds
  (le défaut Classic projette à +10). Tests verts (237 renderer + 22 core).

### Session 2026-06-28 — 🟢 Onglet Worklist (file de changements de gear inter-héros)

Ferme la boucle « optimise N héros → récap de quoi faire ». Nouveau **onglet Worklist**
([`screens/WorklistScreen.tsx`](../apps/renderer/src/screens/WorklistScreen.tsx)) + storage
([`lib/storage/worklist.ts`](../apps/renderer/src/lib/storage/worklist.ts), blob `gs.worklist`, possédé
par App). Bouton **« + Worklist »** dans le Builder (à côté d'Equip build) pousse le **diff par slot**
(slots changés only) du build sélectionné.

- **Cartes par héros**, chaque changement = **ligne cochable** (`fromName → toName`) + bouton
  **Apply locally** (`equipPieces` réécrit le snapshot local ; jamais d'écriture vers le jeu).
- **États dérivés live de l'inventaire** (rien n'est figé) : `applied` (pièce déjà sur le héros → vert),
  `stale` (toUid absent → grisé, exclu de l'apply), `conflict` (`claimCount` > 1 → deux builds réclament
  la même pièce). **Self-healing**.
- **Auto-prune à chaque refresh d'inventaire** (recapture/reload/apply/sync) : `reconcileWorklist` retire
  les changements faits pour de vrai (pièce désormais sur le héros) + les entrées vidées (App `useEffect[inv]`).
- **Libellés player-facing** (`toDesignSlot` : `ooparts`→Talisman, `shoes`→Boots) + **main stat affichée
  sur les lignes talisman** (`toMain`) pour lever l'ambiguïté des noms qui se ressemblent.
- `Shell.tsx` (onglet + `TabCounts.Worklist` = changements restants), `App.tsx` (state possédé + wiring),
  `BuilderScreen.tsx` (prop `onAddToWorklist` + handler + bouton). Build + typecheck verts.

### Session 2026-06-28 — 🟢 Diff avant/après par slot (Builder)

Répond à « qu'est-ce que je change, et ça vaut le coup ? » — la brique réutilisée par la Worklist.

- **StatsPanel** : **Δ numérique signé** par axe (`proj − current`, arrondi) en plus du tint vert/rouge.
- **BottomGearBand** : **liseré cyan** + ligne `← <pièce remplacée>` (ou `+ new slot`) sur chaque slot qui
  **change** vs l'équipé (définition alignée sur `upg` via une Map `currentLoadout` slot→pièce équipée).
- **Header de la band** : **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`, `currentCp` =
  `calcBattlePower` du loadout équipé ajouté à `composition`). Données déjà calculées → surtout du rendu.
  `BuilderScreen.tsx`. Typecheck vert.

### Session 2026-06-28 — Builder : déclencheur « Equip build »

Branchement de l'étape 3 de Equip/Unequip côté **Builder** (le core + endpoint writer + client
`src/equip.ts` étaient déjà livrés). Au-dessus du **bottom gear band** (le build sélectionné), bouton
**« Equip build → \<héros\> »** : applique les 8 pièces du build au héros sélectionné en réécrivant le
snapshot capturé.

- **Atomique** — nouveau `equipPieces(game, uids, charUid)` (client) : fetch du snapshot **1×**, fold de
  `equipItem` sur chaque uid, write **1×** (`POST /api/captured/user-item`). Pas de round-trip par pièce.
- **Plan d'équipement** (`equipPlan`, mémo) : ignore les pièces déjà sur ce héros (`moving`), compte celles
  actuellement sur un autre héros (`steal`, seraient « volées »).
- **Popup de confirmation** (`EquipConfirm`, même style que `RecoBuildPicker`) — au lieu d'un bouton 2-temps
  jaune ambigu : récap « moves N pieces onto \<héros\> », ⚠ ambre si `steal > 0`, **Cancel / Equip**.
  Pendant l'écriture → *Equipping…* (fermeture/Escape/clic-fond bloqués) ; échec/**409 (capture armée)** →
  message rose inline « disarm first » + **Retry**, la popup reste ouverte.
- **Succès** → `App.refreshInventory("Equipped build")` (barre de statut + ré-import ; le band repasse les
  pièces en « sur ce héros », le bouton se désactive). Désactivé quand rien ne bouge.

`equip.ts` (+`equipPieces`), `App.tsx` (prop `onAfterEquip`), `BuilderScreen.tsx` (prop, `equipPlan`,
`equipSelectedBuild`, `EquipBuildButton` + `EquipConfirm`). Typecheck vert (fichiers touchés).

### Session 2026-06-27 — ⚪ `version.json` idempotent (fini le dirty perpétuel) + committé au release

`data/derived/version.json` (`{hash, builtAt}`) était réécrit avec un nouveau `builtAt` à **chaque**
`data:build` / release → toujours dirty, et [`release.mjs`](../scripts/release.mjs) ne stageait que
`apps/desktop/package.json` (step 6) → le stamp de la release n'était **jamais** dans le commit.

- **Écriture idempotente** ([`build.mjs`](../data/build.mjs)) — on ne réécrit version.json **que si
  le hash de contenu change**. Le build étant déterministe, un rebuild sans changement de données
  laisse le fichier byte-identique → working tree propre. `builtAt` devient la **date du dernier vrai
  changement de données** (le millésime), pas l'heure d'horloge du build.
- **Release stage `data/derived`** (step 6) — le snapshot dérivé réellement buildé+publié atterrit
  dans le commit `chore: release vX.Y.Z` (no-op si rien n'a changé grâce à l'idempotence).

### Session 2026-06-27 — 🟠 Projection reforge ascended : passif de singularité manquant + visibilité des ticks

Deux trous sur le preview de mode reforge ([`engine.ts`](../apps/renderer/src/lib/solver/engine.ts) +
[`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) :

- **Passif de singularité absent** — la projection ascended basculait la pièce en `+15 · ascended`
  mais n'ajoutait **jamais** le passif inconditionnel de singularité (le bonus *définissant* de
  l'ascension). `addProjectedSingularity` l'ajoute désormais en mode ascended : DMG+ sur
  arme/accessoire, DMG- sur les 4 armures, à la **meilleure valeur** de `singularity-options.json`
  (DMG+ 50 %, DMG- 25 %). Route via `fromBuff` → compte dans **score + CP + carte**, pas juste
  l'affichage. Une pièce **déjà ascended** conserve son **vrai roll** (jamais écrasé par le plafond).
  +5 tests (slots DMG+/DMG-, classic = pas de passif, non-écrasement d'un vrai roll, Talisman/EE
  intouchés).
- **Visibilité des ticks de reforge** — sur une carte projetée, impossible de voir *quel* sub avait
  proc ni de *combien*. Le `BottomGearBand` calcule le **delta de ticks** (projeté − capturé, aligné
  1:1 car `simulateReforges` clone les subs dans l'ordre) → badge cyan `+N` par sub reforgé.

### Session 2026-06-27 — 🟡 UX Builder : état d'équipement sur les cartes, reset au changement de héros, save build+preset fusionnés

Trois nits UX sur le Builder ([`BuilderScreen.tsx`](../apps/renderer/src/screens/BuilderScreen.tsx)) :

- **État d'équipement sur les gear cards de résultat** — chaque carte du `BottomGearBand` affiche
  désormais un badge : 🟠 `[portrait] <nom>` quand la pièce est **équipée sur un autre héros**
  (appliquer le build la lui retirerait), 🟢 `equipped` si déjà sur le héros courant, `free` sinon.
  Résolu via une map `charsByUid` + `selfUid`, sur l'`equippedBy` de la pièce **originale** (pas le
  clone reforge). Le portrait à 14px (< `PORTRAIT_OVERLAY_MIN`) = face icon nue, propre.
- **Reset au changement de héros** — un effet sur `selectedUid` annule le solve en cours, remet les
  **filtres** à `INITIAL_FILTERS` (`resetAll`) et vide **tous les résultats** (table, sélection,
  displayFilter, reforge, progress, debug, mode). `useRef` skippe le mount initial. L'annulation
  empêche un `onResult` asynchrone de repeupler la table pour le mauvais héros.
- **Save build + filter preset fusionnés** — « Save build » persiste désormais **les deux** (SavedBuild
  + FilterPreset, même nom + `createdAt`) en une confirmation ; bouton + handler `saveCurrentPreset`
  séparés supprimés. Le panneau « Filter presets » reste pour charger/supprimer.

### Session 2026-06-27 — 🟡 unification des clés de stats (registre source-de-vérité)

**Le problème** : le même concept portait 2 noms selon la couche — ENGINE (`critRate`/`critDmg`/
`effRes`/`dmgReduce`/`critDmgReduce`, sur les rolls/gems/tokens/`ROLL_NORMS`) vs USER (`crc`/`chd`/
`res`/`dmgRed`/`critDmgRed`, sur `FinalStats`/`priority`/`STAT_NORMS`), pontés ad-hoc par
`STAT_TO_PRIORITY`. Rien ne **garantissait** que le pont couvrait toutes les clés → bug-surface
silencieux (une stat ajoutée pouvait no-op sans bruit).

**Le fix** — unification sur les noms ENGINE (le plus large) + **registre unique**
[`apps/renderer/src/lib/statRegistry.ts`](../apps/renderer/src/lib/statRegistry.ts) (`STAT_AXES`,
typé contre `StatType` de core) **d'où dérivent** `ROLL_NORMS`/`STAT_NORMS`/`STAT_TO_PRIORITY`/
`FINAL_STAT_KEYS` — plus de littéraux dupliqués (`ratings.ts` ré-exporte les dérivés). Les champs
`FinalStats` renommés (`crc→critRate`, `chd→critDmg`, `res→effRes`, `dmgRed→dmgReduce`,
`critDmgRed→critDmgReduce`) → le compilateur a guidé tous les lecteurs typés (cp, ratings, dmgValue,
buildAdvice, engine, Builds/Builder). `STAT_TO_PRIORITY` se réduit au seul repli flat/%→axe
(`atkPct→atk`…). La dualité `atk`/`atkPct` (flat vs %) **reste** (deux variants d'un axe). La
fusion `atk`/`atkPct` collapse toujours en `atk`.

**Hors périmètre (volontaire)** : le namespace **baseline** (`chc`/`dmgInc`) + `ScalingMap`
(`res`/`eff`) + la clé **data** `dmgSec.stat: "crc"` (dans `characters.json`, générée) restent —
mappés au bord (ex. `crc → s.critRate` dans `computeCheapRatings`), pour ne pas régénérer `data/derived`.

**Persistance migrée** (idempotent) : `filterPresets.fromSerialized` (priority + statFilters) et
`savedBuilds.loadSavedBuilds` (build.finalStats + reforge.priority) réécrivent les anciennes clés via
`renameLegacyStatKeys` → presets/builds sauvés avant l'unif continuent de marcher.

**Tests** : +`statRegistry.test.ts` (11 — FinalStats ↔ axes, couverture du pont, tokens, **snapshot
numérique** ROLL_NORMS/STAT_NORMS = parité, migration legacy). Suites existantes mises à jour.
219 → **232** (renderer) ; core 22 ; **254** total. Typecheck + CP 0-diff verts (renames purs).

### Session 2026-06-27 — 🟠 budget combos unifié (Score AVEC priorité n'était PAS borné) + instrumentation

**Le bug** (diagnostiqué via le nouveau « Copy Debug Info », cf. ci-dessous) : un solve **SOLVE (Score)
avec priorité** sur un vrai compte = **703 836 000 combos / 142 s**. Le budget-combos absolu n'existait
que pour le **mode CP sans priorité** ; toutes les autres branches passaient par `topPctPrunePreserving`,
un prune **en pourcentage par slot** qui **ne borne pas le PRODUIT** (30 % de sept pools ~40-50 = encore
~7e8 combos). Le ⏱ ne le montrait pas non plus (il démarrait au fan-out, masquant le precompute).

**Le fix** — `precomputeContext` ([engine.ts](../apps/renderer/src/lib/solver/engine.ts)) : le prune Top% est
**unifié sur `allocateComboBudget`** (`∏ keep ≤ COMBO_BUDGET × topPct/30`) pour **toutes** les branches ;
seul le **classement par slot** diffère :
- **priorité explicite** (Score ou CP) → `priorityScoreOf` (score par-roll pondéré, combat-only exclus) ;
- **CP sans priorité** → proxy CP (`cpEval` sur le build courant) + pin de la pièce équipée (inchangé) ;
- **Score sans priorité** → `magnitudeScoreOf` (magnitude brute des rolls) — pas d'objectif mais le produit
  doit rester borné (sinon cartésien complet).

`topPctPrune` / `topPctPrunePreserving` supprimés (morts) ; `CP_COMBO_BUDGET` → `COMBO_BUDGET` (général).
La protection des sets requis + le pin passent par `keepTopN` pour les trois objectifs identiquement.
**Effet attendu** : Score+priorité 142 s → ~1-2 s (budget 8 M @ Top% 30). +4 tests `cpPrune.test.ts`
(`priorityScoreOf`/`magnitudeScoreOf` : pondération, exclusion combat-only, magnitude). 237 → **241**.

**Instrumentation** (commit précédent, même session) : ⏱ honnête (démarre à l'entrée de `solve()`, inclut
le precompute) + bouton **« Copy Debug Info »** dans le footer Builder (visible si `gs.debug.solver`),
qui copie un snapshot JSON par solve : `precomputeMs` vs `searchMs`, mode, topPct, `hasPriority`,
`equippedScope`, tailles de pools, P/S, détail par worker, et (CP) top-CP vs CP équipé (`debugCurCp`).

### Session 2026-06-27 — Builds advice : lot restant (1)/(2) + tolérance crit cap

Trois affinages de `computeAdvice` (`lib/buildAdvice.ts`, module pur testé standalone) :

- **(1) Bruit Missing supprimé sur persos WIP** — `Missing: …` ne sort plus que quand le héros est
  **quasi-complet** (`≤ MISSING_ADVICE_MAX = 2` slots vides). Au-delà (banc / work-in-progress) la ligne
  reste silencieuse — lister 4-5 slots vides est du bruit, pas un conseil actionnable. Le reste des règles
  reste différé dès qu'une pièce manque (layout d'armure non figé).
- **(2) Pièces sous le cap d'enhance** — nouvelle ligne agrégée `N pieces below max enhance` (tone `info`),
  dans la boucle existante de la règle 6 (upgrade headroom). Cap = **+10** normal, **+15** une fois ascended
  (miroir du contrat `GearPiece.enhanceLevel` 0..10/10..15). Gear principal seulement (gemmes exemptées).
- **Tolérance crit cap (règle 4)** — le crit chance ne warn plus qu'au-delà de **102 %** (marge anti
  crit-resist : on overcap volontairement 1-2 pts, donc 100-102 % n'est pas gaspillé). PEN reste à 100 %.
  `capWaste` prend désormais le cap en paramètre ; le message reflète le seuil réel (`… over the 102% cap`).

`buildAdvice.test.ts` 11 → **16 tests** (missing quasi-complet vs WIP silencieux, under-enhance agrégé +
non-flag d'une pièce max, crit toléré à 101 / warn à 103.5). **Reste — (3) lot secondaire** (off-scaling
main vs `meta.dmgStat`, basse qualité, « 4pc dispo en inventaire ») : différé, nécessite de threader
`inventory.gear` + `meta.dmgStat` dans `AdviceInput`.

### Session 2026-06-27 — Home : vues Gear breakdown (Class / All sets / Talisman) + toggle

La carte **Gear breakdown** (Home) gagne un **toggle** segmenté 4 vues (`gearView`) : **Overview** (inchangé :
par slot + top 5 sets), **Class**, **All sets**, **Talisman**. Les compteurs d'état (Ascended / +15 / Locked)
restent épinglés en bas dans chaque vue. Tout est dérivé de `inventory` + `game` dans `computeStats` (aucun fetch).

- **Class** — par classe (Striker/Ranger/Mage/Defender/Healer), deux colonnes **arme / accessoire** (en-têtes =
  icônes d'onglet inventaire `SLOT_BY`), chaque cellule liste en chips les **effets de passif uniques**
  (icône `effectIcon`, badge de count si >1, hover = nom + description). **Catalogue complet** des effets *à
  restriction de classe* (séédé depuis `equipment.json`, count 0 superposé par l'inventaire) → un effet non
  possédé apparaît grisé, **count 0 en rouge**. Tri : possédés d'abord. Unicité par **nom de passif** (pas
  l'icône, réutilisée entre effets distincts).
- **All sets** — grille de **tous les sets d'armure existants** (21, depuis `equipment.json`, pas seulement le
  possédé), chips icône + count, triés par possédé d'abord, non possédés grisés / 0 rouge. Unicité par **nom de set**.
- **Talisman** — table croisée **type de talisman (lignes) × main-stat (colonnes)**. Lignes = catalogue des
  15 talismans (art de l'item `image` encadré du fond de rareté `TI_Slot_Unique` comme l'inventaire, hover =
  nom + nom de l'effet via `multiTierPassives`), colonnes = les **9 main-stats** ooparts (`atkPct/hpPct/defPct/
  critRate/critDmg/dmgUp/dmgReduce/eff/effRes`, en-têtes = icônes `STAT`). Cellules = count possédé (heatmap
  cyan, `·` si 0) + colonne `Σ` + ligne `Total` ; main-stat lue depuis `p.main`.

`HomeScreen.tsx` only (helpers `Segmented`, `EffectChipView`/`ChipWrap`, `ClassEffectRow`/`SlotHead`,
`OopartsTable`). Typecheck vert (HomeScreen).

### Session 2026-06-27 — 🔴 principe de priorité des héros (scope d'items « ≤ inférieure »)

Nouveau modèle de **priorité par héros** : un **entier unique** par perso (`HeroPriority` = `charUid → int`,
`gs.priority.rank`), **rank 1 = priorité la plus haute** (nombre plus petit = plus important), `null` par défaut
= non-classé = priorité la plus basse. Store pur `lib/storage/heroPriority.ts` : `setHeroRank` garantit
l'**unicité** (poser un rank déjà pris **échange** les deux héros), `rankOrder` (rank, +∞ si non-classé) /
`isLowerPriority` (strict ; deux non-classés ne se volent pas). +11 tests `heroPriority.test.ts`.

**Solveur** : le toggle binaire `includeEquippedOnOthers` devient un **scope 3-états** `equippedScope` (`none`
= héros seul + libre · `lower` = **+ héros strictement moins prioritaires** (jamais un égal/supérieur) · `all`
= tout, défaut legacy). `allow()` (`engine.ts`) et `buildGemPool` (`gems.ts`) lisent le scope + `heroPriority`
(porté dans `SolveRequest`). Presets migrés (`includeEquippedOnOthers` true/absent → `all`, false → `none`).
+1 test gem-pool « lower ».

**UI** : `App` possède `heroPriority` (persisté) et le passe à **Builds** (édition) + **Builder** (solve, live
car le Builder reste monté). **Builds** : colonne **Rank** à gauche du portrait — poignée de **drag-to-reorder**
(`⠿`, visible en tri `# Rank`) + champ éditable. Modèle **positionnel contigu 1..N** (`reorderRank` /
`moveRankBefore`) : taper N ou déposer une row place le héros en position N, tout se renumérote ; vider = non-classé.
Toggle **# Rank** dans la barre de filtres pour trier par priorité (rang 1 d'abord). **Normalisation hybride**
(`fillUnrankedByOrder`) : les rangs **manuels sont préservés** (compactés, sans trou) et les héros **non-classés
reçoivent un défaut par CP**, ajoutés à la suite (renumérotation contiguë 1..N). No-op si tout est déjà classé →
ne se déclenche qu'à la 1re utilisation ou après une nouvelle capture, sans jamais écraser un classement géré.
Marqueur d'insertion **cyan en haut de la row** survolée pendant un drag.
**Builder → Options** : contrôle segmenté **Equipped items** Aucun / ≤ Lower / Tous. Suite : 232 tests verts.

### Session 2026-06-27 — refonte de la toolbar Builder (2 lignes, SOLVE fusionné, portrait)

La toolbar (héros + actions + filtres) tenait sur **une seule ligne** qui wrappait. Repassée en **2 lignes** dans
le même cadre : **ligne 1** = portrait du héros sélectionné (`CharacterPortrait`) + recherche + action SOLVE +
Filter ; **ligne 2** = Reforge / Maxed only + popovers de filtres + reset. Les boutons **SOLVE / SOLVE CP fusionnés**
en un **split button** `SolveButton` : le bouton principal lance le mode mémorisé, le ▾ ouvre un menu (Score /
Combat Power) — choisir un mode le mémorise **et** lance le solve. Mode persistant (`gs.builder.solveMode`, défaut
CP) ; pendant un solve le bouton devient Cancel. Typecheck + 188 tests verts.

### Session 2026-06-27 — log de confirmation codex + geas/quirk au disarm

`capture.ps1` confirmait l'inventaire + les héros, mais le **codex** (`/archive/info`) et les **geas/quirk**
(`/gift/info`) — capturés *après* sa sortie (pipeline armé, le joueur ouvre les écrans Codex/Gift) — n'avaient
aucune confirmation côté app. `disarm.ps1` décode et résume maintenant ces deux catchs (best-effort python,
streamé dans le log au clic Disarm) : `codex captured + decoded: N reward tiers (levels …)` /
`geas/quirk captured + decoded: N gift nodes`, ou un message « NOT captured — ouvre l'écran … puis disarm » si
le fichier manque.

### Session 2026-06-27 — talisman inclus dans le budget combos CP (cut du dernier multiplicateur)

Après le budget combos sur les 6 slots gear, le **talisman restait non-capé** (mesuré sur D.Luna : pools gear
10-14 mais talisman **68/68** → cartésien `~3,4M × 68 ≈ 230M`, ~20 s). Le talisman était exempté car ses gemmes
viennent de l'alloc globale — mais en mode CP **tous les talismans du même nombre de slots reçoivent le même delta
de gemmes**, donc ils ne diffèrent quasi que par leur **main (ATK flat)** : les dominés sont droppables. `ooparts`
est maintenant inclus dans `allocateComboBudget` / le CP-prune (candidat = aussi l'arg ooparts de `cpEval` pour son
ooBp ; pin du talisman courant). Le cartésien repasse sous le budget (~8M, ~1 s). EE toujours exempt (1 pièce).
Tests verts (188).

### Session 2026-06-27 — CSP stricte sur le serveur prod (warning Electron)

Electron râlait en console (`Insecure Content-Security-Policy` / `unsafe-eval`) parce que le renderer
n'avait aucune CSP. En dev c'est purement Vite (HMR via `eval`) et c'est inévitable ; en **prod**, le
serveur HTTP embarqué (`apps/desktop/src/server.ts`) sert maintenant le document HTML avec une CSP
serrée au plus juste de la surface réelle :
- `script-src 'self'` (build prod = scripts externes, zéro inline/eval) → **le warning disparaît dans la
  build packagée**.
- `style-src`/`font-src` ouvrent **Google Fonts** (Geist + Geist Mono) ; `'unsafe-inline'` sur les styles
  couvre les `style={{…}}` de React.
- `img-src` autorise `https://outerpedia.com` pour le **302 de secours** de `/img/*` (img-cache.ts) — la
  CSP re-vérifie la cible du redirect — plus `data:`/`blob:` (canvas/capture).
- Tout le reste (gamedata, captured JSON, API reco/update, solver worker) est same-origin → `'self'`.
- Durcissement : `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'none'`.

En-tête posé uniquement sur les réponses `text/html` (root + fallback SPA), seul document que la CSP régit.

### Session 2026-06-27 — cartes de gear Builder (gems, passifs singularité, extrapolation)

Lot de lisibilité sur la `BottomGearBand` (`GearCard`) :
- **Gems en double supprimés** — les cartes Talisman/EE affichaient les gemmes **socketées** (en tant que
  « substats ») **ET** l'allocation recommandée du build → bruit. Désormais une seule section **Gems** = les
  gemmes que le build pose : la reco du solver (badge **swap** si différente) ou, s'il n'a pas réalloué, les
  socketées (label **current**). `GemRecommendation` → `GemsSection`.
- **Passif Singularité +15 affiché + labellisé** — les pièces ascensionnées portent un passif +15 qui
  n'apparaissait pas sur les cartes (seul le `GearDetail` Inventory le montrait). Rendu via les entrées `main`
  `source === "singularity"`. **Distinction conditionnel/appliqué** : l'inconditionnel « DMG Increase to target »
  (`BT_STAT_PREMIUM/NONE`, `combatOnly:false`) compte dans le sheet → **ambre** ; les variantes conditionnelles
  (« vs Earth » `TARGET_ELEMENT`, « vs singularity buff » `TARGET_HAS_BUFF`, `combatOnly:true`) sont exclues du
  calcul → affichées **grisées + tag `cond`** avec leur propre libellé, pour ne jamais être prises pour des stats
  appliquées (le calcul/CP, lui, les excluait déjà via `if (s.combatOnly) continue` — vérifié, pas un bug calc).
- **Extrapolation plus claire** — quand une pièce est projetée (reforge classic/ascended), badge **▲ projected /
  classic / ascended** sur la ligne d'enhance (au lieu d'un badge discret « Substats »), valeur de main stat en
  **cyan**, substats teintés cyan. Tooltip explicite « re-scalé / reforgé vers cette cible, pas tes rolls actuels ».
- **Vérifié (pas un bug)** : le panneau **Projected** tient déjà compte des stats extrapolées — `precomputeContext`
  projette le pool (`projectPieceForReforge`) **avant** le solve, donc `build.finalStats` est composé sur les pièces
  projetées. Talisman/EE non projetés (gems), cohérent côté carte.

### Session 2026-06-27 — 🔴 sets conditionnels (lost-HP) faussement aplatis en stats flat

**Bug** : les sets « comeback » dont le bonus scale avec les **PV perdus du porteur** étaient distillés en stat
plate et appliqués **inconditionnellement à leur valeur MAX** → Swiftness (19) doublait la SPD (`floor(base·100/100)`,
d'où le build à 338 SPD repéré en jeu), Revenge (15) ajoutait **+160% ATK** et Patience (16) **+160% DEF**. Tous les
trois passent par un buff de Type `BT_STAT_OWNER_LOST_HP_RATE` (L1) / `_HALF` (6★), `StatType=ATK/DEF/SPEED`,
`Value=1600/1000` — la valeur au max de PV manquants, pas un bonus garanti. **Fix** (`data/build.mjs`,
`resolveSetEffectEntry`) : ces Types conditionnels renvoient désormais `p2/p4 = null` (aucun bonus numérique, comme
les sets-effet booléens type Immunity) ; la prose « proportional to missing Health » porte le sens côté UI. Le moteur
n'a pas de modèle de PV en combat, donc on n'estime rien plutôt que de gonfler. `sets.json` régénéré (sets 15/16/19
→ p2/p4 null). Impacte le stat-sheet, le solver (plus de sur-valorisation de ces sets) **et** la tab Builds. Tests
verts (stat-locks inclus → aucun héros locké n'utilisait ces sets).

### Session 2026-06-26 — SOLVE CP jouable par défaut (auto-prune CP-pondéré + garde-fou)

**Diagnostic (vrai compte)** — un SOLVE CP sans réglage tournait >100 s pour **2,4 milliards** de combos,
`S ≈ P` (quasi aucun élagage). Cause : le Top% prune était gardé derrière `hasPriority && topPct < 100`, et le
défaut (Top% 100, pas de priorité) le sautait → cartésien complet. Le dominance prune (exact) ne mord pas sur un
inventaire Pareto-divers (presque aucune pièce dominée sur **tous** les axes).

**Auto-prune CP-pondéré + budget combos** (`engine.ts`) — en **SOLVE CP sans priorité**, chaque slot est
désormais classé par **le CP qu'une pièce donne posée dans le build courant du héros** (`cpEval(computeFinalStats(
baseline, scaling, [autres pièces équipées, candidat]))`). Le baseline = les pièces équipées des autres slots → la
chaîne crit/pen/spd qui scale l'ATK est réaliste (un baseline mono-pièce sous-classerait l'ATK). C'est la **forme
*soft* du dominance prune** (classer par un scalaire CP au lieu d'exiger ≥ sur tous les axes). **Correctif clé** :
un *pourcentage* ne borne pas le **produit** — 30 %/slot laissait encore **1,25 G** combos (mesuré sur vrai compte,
>100 s). Le cap se fait donc par **budget combos absolu** : `allocateComboBudget` water-fill un nombre de pièces à
garder par slot pour que `∏ ≤ budget` (petits slots entiers, surplus vers les gros slots armor), puis `keepTopN`
garde le top-K CP. Budget défaut `CP_COMBO_BUDGET = 8 M` (~1 s), scalé par le slider Top% (`8M × topPct/30` ;
`100` = exhaustif). Priorité explicite prioritaire ; SOLVE Score sans priorité inchangé (prune sauté) ; Talisman/EE
+ slots `keepCurrent` exemptés ; sets requis préservés. **Limite assumée** : notation *standalone*, un membre qui
ne brille qu'en complétant un set peut être sous-classé (monter Top% ou exiger le set). `keepTopN` /
`allocateComboBudget` exportés + testés. +12 tests `cpPrune.test.ts`.

**Pin du build courant + debug CP** — suite : un solve rendait un CP **inférieur** au build équipé (le cap top-K
pouvait élaguer une pièce actuelle). `keepTopN` accepte des `pinUids` : la pièce **actuellement équipée** de chaque
slot est désormais **toujours gardée** → le build courant reste atteignable, donc le solver ne peut jamais rendre
pire que l'équipé. Plus un bloc **debug** (`gs.debug.solver`) dans `precomputeContext` qui loggue `cp-current-build`
= le CP que **notre moteur** calcule pour le build équipé (gems socketés) + la survie de chaque pièce au prune ;
l'orchestrator loggue `topCp`/`topScore` du meilleur résultat. Tranche **recall** (pièce élaguée) vs **calc** (notre
CP ≠ celui du jeu).

**🔴 Scoring de gemmes CP-aware (la vraie cause du CP < équipé)** — le debug l'a prouvé : `curCp = 315 492` (= le
jeu, notre calc est juste) mais `topCp = 292 530` avec **toutes** les pièces actuelles dans le pool. Cause : en
SOLVE CP sans priorité, `scoreGemPool` rankait les gemmes par **`value / norm` brut** (magnitude), pas par leur
apport CP → l'allocateur préférait des gemmes **dmg-reduce / flat** (gros chiffres, ~0 CP) aux gemmes **atk/crit/pen**
qui font le CP, et **baissait l'ATK** du build (9819 → 8919) donc le CP réel. Fix : `cpStatWeights` calcule un poids
CP par stat (= ΔCP d'un bump ROLL_NORM de la stat, évalué **au build courant** — une stat déjà à son cap CP, ex.
CRC ~100 %, retombe à ~0) et sert de priorité aux gemmes en mode CP. Priorité utilisateur explicite toujours
prioritaire ; SOLVE Score sans priorité inchangé (fallback gems socketés). `cpStatWeights` exporté + 2 tests
(offensif ≫ dmg-reduce, poids ≥ 0). Suite : core 22 + renderer 188 = 210.

**Défaut Top% 100 → 30** (`INITIAL_FILTERS`) — le slider garde son sens (100 = garde tout = exhaustif), mais le
défaut élague à 30 %/slot. Warning du panneau Priority corrigé (le Top% mord en SOLVE CP même sans priorité).

**Garde-fou cartésien** (`BuilderScreen`) — estime `∏ poolSizes` (post-prune ; les `poolSizes` arrivent dès le
départ du solve, avant la recherche réelle) et affiche un bandeau ⚠ au-dessus de `CARTESIAN_WARN` (50 M) qui
propose de baisser Top% / poser une priorité / exiger un set. Non-bloquant.

### Session 2026-06-26 — Timer de solve dans le footer Builder

**Durée du dernier solve affichée** — l'orchestrator mesurait déjà le wall-clock (`startedAt` →
flush) mais ne le loggait que sous `gs.debug.solver`. Il le remonte maintenant à l'UI : `onResult`
gagne un `durationMs`, `BuilderScreen` le stocke (`lastSolveMs`, remis à null au lancement d'un solve),
et le `FilterFooter` affiche **⏱ N ms / N.NN s** une fois le run fini (caché pendant `solving…`). But :
donner une mesure exacte de la vitesse du solver (au lieu de chronométrer à la louche) pour décider si
le SOLVE CP demande encore du travail. Aucun changement de la logique de calcul.

### Session 2026-06-26 — Snapshot data versioning (stamp + expo)

**Stamp de version des données dérivées** — `data/build.mjs` accumule un hash de contenu (`sha256` sur
nom+corps de chaque fichier dérivé, ordre fixe) et écrit `data/derived/version.json` `{ hash, builtAt }`.
Le `hash` est **stable tant que la donnée est inchangée** (un re-build no-op ne le bouge pas) → base d'une
future invalidation de cache ; `builtAt` est informatif. Renderer : `loadDataVersion()` (`data.ts`) +
ligne read-only « Game data version » dans **Settings → Data** (`SettingsModal`). **Invalidation des
caches localStorage différée** (compare le hash au boot + élague les SavedBuild aux `pieceUids` disparus —
touche la couche storage Builder-adjacente, cf. « Snapshot data versioning » dans Reste à faire).

### Session 2026-06-26 — Equip/Unequip : méthodes core + plomberie

**`equipItem` / `unequipItem`** — module pur `packages/core/src/equip.ts` qui réécrit un
`RawUserItem` capturé (champ `CharUID`, `"0"` = libre) : equip pose l'owner + **déplace** la pièce
qui occupait le même slot du perso (un slot = une pièce) ; unequip remet à `"0"`. Immuables (jamais
de mutation de l'entrée), no-op clone sur item inconnu / non-gear / déjà dans l'état voulu. +11 tests
`equip.test.ts`.

**Plomberie de persistance** — endpoint writer `POST /api/captured/user-item` (`server.ts` prod +
miroir dev `vite.config.ts`) qui valide `{ ItemList[] }` et `writeFileSync` `out/user_item.json`
(refus 409 si pipeline armé, mirror du wipe). Le **transform tourne côté renderer** (déjà core + game
data chargée) → serveur writer bête, **pas de couplage desktop→core**. Client `apps/renderer/src/equip.ts`
(`equipPiece`/`unequipPiece`) : fetch raw → core transform → POST. **Reste** : le déclencheur UI
(Builder/Builds) + vérif round-trip live (cf. « Equip / Unequip » dans Reste à faire, étape 3).

### Session 2026-06-26 — Builds advice (lot prioritaire) + dedup reforge budget

**`computeAdvice` extrait + enrichi** — sorti de `BuildsScreen` vers le module pur `lib/buildAdvice.ts`
(testable standalone, mirror `subValue`/`dmgValue`), +11 tests `buildAdvice.test.ts`. Règles ajoutées :
caps gaspillés (`crc`/`pen` > 100), gem slots vides sur Talisman/EE (+ tip « reach +5 »), upgrade agrégé
(reforges non utilisés + 6★ non ascensionné). Le budget de reforge n'est plus dupliqué : `maxReforgesOf`
**exporté depuis le solver** `engine.ts` (extrait de `simulateReforges`, comportement inchangé) et importé
par l'advice. `ComposedEntry` satisfait structurellement `AdviceInput`.

### Session 2026-06-26 — view-state session-scoped + optims Inventory

**Reset des tris/filtres au lancement** — `useSessionState` (sessionStorage) ajouté à
`hooks/usePersistedState.ts`. Inventory (tab/sort/dir/filters) + Builds (roster filters) session-scoped :
stables au switch d'onglet, réinitialisés au lancement. `gs.builds.notes` reste durable.
**Optims Inventory** — `contentVisibility:auto` retiré (résidu pré-virtualisation) + 7 `useMemo`
d'availability fusionnés en une passe sur `scopedForStats`.

### Session 2026-06-26 — 🔴 exclusion de pièce par set (pré-filtrage du pool)

**Pré-filtrage du pool armor par set requis + setting « Allow broken sets »** — quand les sets contraignent
**entièrement** l'armor (ex. `2pc A + 2pc B` ou `4pc A` → 0 slot libre), les pièces hors-set étaient
quand même énumérées. Désormais `armorSetWhitelist` (`setPlans.ts`, pur) calcule la whitelist de sets
admissibles et `precomputeContext` élague les pools helmet/armor/gloves/boots avant le cartésien
(énorme réduction sur les recherches sets-contraintes). Un set requis seul (`2pc A`, slots libres)
n'élague rien par défaut — il faut de quoi compléter. Nouveau toggle **Options → « Allow broken sets »**
(`SolverOptions.allowBrokenSets`, défaut **true** = comportement legacy) : à **false**, chaque pièce
d'armor doit appartenir à un set complété (2pc/4pc, pas de singleton ni de pièce set-less), ce qui (a)
restreint la whitelist aux sets *formables* (présents dans ≥2 slots armor) + requis, et (b) ajoute un
check leaf `allSetsComplete(setCount)` à la profondeur boots. Les slots verrouillés par **Keep current**
sont exemptés de l'élagage. Rétro-compat presets (`allowBrokenSets ?? true`) + payloads worker. +13 tests
`setPlans.test.ts` (`planSlots`, `armorSetWhitelist` 8 cas, `allSetsComplete` 4 cas).

### Session 2026-06-26 — onglet Home + panneau d'inspection partagé

**Home — nouvel onglet landing (update center + dashboard)** (ports « Home Directions » de Claude Design,
direction A) — onglet par défaut (`gs.tab` → `"Home"`). **(1) Update center** : carte inline pilotée par
état (uptodate / checking / downloading % / downloaded→Install / offline→Retry) qui **remplace les 2
dialogs natifs** ; auto-download dans le main process, le renderer poll `/api/update/status` et n'expose
que l'action restante (« Install new version »). Nouveaux : `apps/desktop/src/updater.ts` (state machine
electron-updater, `autoDownload=true`, `autoInstallOnAppQuit=false`), routes `/api/update/{status,check,install}`
(`server.ts`), miroir statique dev (`vite.config.ts`, ne peut pas importer electron-updater), `lib/update.ts`.
**(2) Dashboard** dérivé de l'inventaire/game déjà chargés (aucun fetch sauf le poll) : Account snapshot
(2×2, héros×★ à côté de Heroes owned) · Library · System health · Gear quality distribution (hero,
couleurs `QUALITY_COLOR` partagées avec le filtre Inventory, tooltip par tier) · breakdowns Roster
(icônes élément/classe réelles) + Gear (slots / top armor sets via `armorSetIcon` / tuiles
Ascended·+15·Locked). Empty state = CTA capture seule (la carte update reste). `App.tsx` : handler
`syncGameData`, props passées à `<HomeScreen>`.

**Panneau d'inspection partagé `GearDetailBody`** (`fc927ec`→`4f9d5b5`) — extraction du panneau gauche de
l'Inventory dans `design/GearDetail.tsx` (exporte `GearDetailBody`, `QUALITY_TONE`, `computeQuality`), pour
que d'autres surfaces rendent un détail **identique** sans dupliquer. `InventoryScreen` consomme l'export
(helpers locaux supprimés) ; la tab **Builds** inspecte les pièces équipées au survol (`RichTooltip` +
`GearDetailBody`). Au passage : **fix doublon de gems** (EE/talisman affichaient subs ET gems → désormais
`gemSlots ? GemPanel : subs`, mutuellement exclusif) + ajout du **passif Singularity** et du **passif
d'item**. `GearTooltip.tsx` (intermédiaire) supprimé.

**`RichTooltip placement="right"`** (`a1355d4`) — popover à droite du curseur (flip à gauche + clamp
vertical en 2 passes rAF) pour les listes denses où un tooltip au-dessus/dessous masque les voisins.

**Builder monté en permanence entre onglets** (`0d0ccde`) — plus de démontage à chaque changement
d'onglet (caché en `display:none`) : résultats / filtres / héros sélectionné conservés et un solve
continue en fond. `initialHeroUid` consommé sur changement de prop (plus seulement au mount).

**Lisibilité globale** (`87c2b94`) — sweep app-wide : plus de texte gris sombre illisible sur le fond
très foncé (bump des tons `muted`/`zinc` vers des valeurs lisibles).

### Session 2026-06-26 — solver tuning, reforge/gems, settings, assets sync

**Settings — refonte left-rail à onglets + section Solver** (`85b8a86`) — onglets Setup · Solver · Data ·
Backup · Debug avec footer contextuel (Re-check sur Setup seulement). Section **Solver** : worker count
Auto/Manual (dispose+rebuild du pool au changement), result count (topN), per-worker depth (topK, derrière
« Show advanced » + warning recall), heatmap on/off. Réglages persistés App `usePersistedState`,
`resolveWorkerCount(override)` + footer réactif, topN/topK dans `startSolve`, heatmap gate `ResultsTable`
(`EMPTY_RANGES`). Brief design : `docs/design/settings-redesign-brief.md`.

**Solve sous-utilise le CPU → pool adaptatif + send-once** (`f532d42`, `2022df4`, `c8e93c4`) — plafond fixe
8 → `hardwareConcurrency − 1` (1 cœur pour l'UI, override `gs.solver.workerCount`, plafond dur 64) ;
`game` + inventaire envoyés à chaque worker **une fois** (`init`, cachés worker-side) au lieu d'à chaque
solve ; compteur « ⚙ N workers » dans le footer Builder.

**Reforge 3 modes + gems cap-reaching** (`20ab51e`) — `reforgeMode` disable / classic (+10, 6 ticks) /
ascended (+15, 9 ticks) remplace le bool `useReforged` ; projection complète = main re-scalé
(`projectMainToCeiling`, validé in-game) + substats (`simulateReforges` budget), centralisé dans
`projectPieceForReforge`. Gems étagées : cap CHC à 100 % d'abord (gems crit) puis priorité
(`allocateGemsReachingCap` / `gemDeltaEquals`).

**Images + game-data sourcés du repo `Sevih/outerpediaV2` (sync au lancement)** — déclencheur : 404 sur
`CT_Slot_Lock.png` → `/img/*` ne venait pas du projet (checkout local en dev, 302 outerpedia.com en prod,
bundle d'images cassé). Nouveau modèle : handler `/img/*` partagé (`img-cache.ts`)
checkout→cache disque→CDN jsDelivr/raw→fallback webp→302 ; `data-sync.ts` dual-mode (checkout mtime-gated /
download CDN SHA-gated via `api.github.com/commits/main`) ; `build.mjs` dirs via env ; `main.ts` seed
derived + pin SHA + préfetch fond ui/equipment ; coords centralisées `repo-source.ts` ; cache
`.cache/outerpedia` (dev) / `<userData>/outerpedia-cache` (prod). Refs `.png` → `.webp`. extraResources :
images cassées retirées, `build.mjs`/`calc-stats.mjs` shippés. → l'app suit les patchs **sans nouveau
build**, dépendance internet/site minimisée (1 fetch par asset à vie).

**Builder — table & filtres** — colonne Set par build (icône + tier 2/4) (`500fb26`) · colonnes arme +
accessoire (effet icône + nom) toggleables (`a08f9b6`) · menu « Columns » show/hide (stats/ratings/score/upg,
persistant, colonne filtrée forcée visible) (`c8808d4`) · tooltips d'en-tête (nom complet + def TextSystem)
(`5fa5037`) · abréviations stats alignées sur outerpedia + en-têtes en icônes (CDR→CDMG RED%) · bouton
« Filter » (re-filtre client-side sans re-solve) (`44170ae`) · filtre « Min quality » (seuils partagés
`lib/quality.ts`) (`d06f06f`).

**Builder — polish direction-B** — toggles Reforged/Maxed dé-dupliqués (`a4108db`) · popovers + header de
table opaques (`bg-elev-1`) (`a4108db`) · main-stat EE masquée dans la gear band (`a4108db`). Layout
direction B (toolbar + popovers) : brief `docs/design/builder-redesign-brief.md` ; logique
(reducer/solve/persistance) préservée.

### Session 2026-06-25 — gros chantiers (détail dans git)

**🔴 Stat de dégâts** (`fcfce9c`, `67996e4`) — `dmg/dmgs/mcd` scalent sur la vraie stat du héros
(main `dmgStat` def/hp + secondaires `dmgSec` `[{stat,ratio}]`), source = `damage-calc/buffs/{id}.json`
d'outerpedia ; Caren=DEF, D.Stella=ATK+HP×0.03.

**🔴 Overcap crit** (`5521258`) — alloc gemmes **par combo** consciente du cap : `allocateGemsCapped`
stop crit à 100 % CHC (overshoot ≤102), hot-loop fast/slow-path (slow uniquement si `fs.crc > 102`).

**🔴 Détection items / effets** (`216ebf5`, `2ed0d3c`, `d35031f`) — filtre d'effets sur `setId`
(identité unique, Recklessness × 5 distincts) ; `effectIcon` sourcé de `ItemSpecialOptionTemplet.IconName`
(complet, 645/645) ; placeholder à initiales si pas d'icône.

**SetPlan — sets OR-de-AND** (`e4ce42a`, `cb49a48`) — contrat `setPlans: SetPlan[]` + `excludedSets`,
moteur `setsFeasible`/`planFeasible`, **UI éditeur OR** (modes Require/Exclude, onglets de plans, résumé
« Match »), helpers purs + 13 tests. → on peut saisir « 4pc A OU (2pc A + 2pc B) ».

**Get Preset — import recos outerpedia** (`5e03232`, `cfdad7e`) — proxy `/api/reco/:id` (dev+prod),
`fetchReco`, traducteur pur `reco→RecoFilterPatch` (mains/effets/sets/priorité, 10 tests), action
`mergePreset` (overlay), bouton + `RecoBuildPicker`.

**Sync data au lancement + bouton** (`c1bdc94`) — `data-sync.ts` (port Node de `sync.ps1`), auto au
démarrage desktop (gardé par fraîcheur) + bouton « Sync game data » dans Settings.

**JSON backup** (`9040725`) — export/import des builds+presets en JSON (Settings), module pur
`transfer.ts` + 8 tests.

**Logger gaté** (`b2c0dd5`, `ccaba4d`) — `gs.debug.*` renderer (solver fan-out) + `GS_DEBUG` desktop
(lifecycle serveur/capture, `dwarn` toujours-on), toggle Settings.

**Builder polish** — colonnes tail-stats révélées quand filtrées (`c77ed1f`) · heatmap valeur affichée
+ gradient interpolé (`8be2c70`, `7216d77`) · a11y combobox (`3d27f1d`) · Top% no-op hint + slider de
hauteur de table (`299a400`) · empty state Builds (`f4543da`) · error boundary global (`6901f69`) ·
footgun filtre warn-once (`2bfb42a`).

### Session 2026-06-25 — antérieur (détail dans git)

**🔴 Correctness solver/UI** — recall filtre CP/upg in-loop (`a6aa67b`) · échecs silencieux +
`restoreBuild`/`solveError` (`2e6def2`) · gem allocation affichée (`20d3ce9`) · bandeau stats reforgées
(`8b1df0e`). **Trous Builds** — Optimize→ câblé (`6f0617b`) · roster « N equipped · M total » (`b832c7b`)
· `computeAdvice` data-driven (`7700456`). **Inventory** — recherche restaurée (`51a489e`).
**Perf solver** — workers idle cappés (`35bf809`) · table virtualisée (`197fc61`) · hoist
`computeSetBonuses` (`92e84ca`). **Desktop robustesse + sécu** — orphelin mitmdump, I/O, liveness
(`c0f039c`) · gardes Host/Origin, redirect `/img/*`, cap body (`9f8fefe`). **Perf Builds** (`87306fe`).
**Polish** — `useClickOutside` (`5f6bb79`) · modal Esc+autofocus (`4f0649a`) · Builds responsive
(`611c49f`) · footer (`8203c25`) · doc-comments (`a46ba66`). **Data** — split BuffID EE virgule, +50% CHD
d'Eris récupéré (`a6dfb16`). **Docs** — passe de cohérence (data-schema, reference, STATUS, solver,
roadmap, architecture, capture README).

### Antérieur (rappel — détail dans roadmap.md)

Solver M6.5 : cancel mid-solve · panneau Library (Save/Remove) · Exclude-equipped multi-select · colonne
Upg · simulation de reforge · tri de colonnes. — Persistence M7 : Save Build / Filter presets per hero. —
Tests : stat-lock · gem override · top-K heap. — Hygiène : stubs morts `solver.ts`/`score.ts` supprimés.
