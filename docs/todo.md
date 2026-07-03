# TODO — backlog gear-solver

> **Tâches ouvertes uniquement.** Ce qui est **livré** vit dans [changelog.md](changelog.md)
> (journal de session + items clôturés) et l'historique git ; les jalons dans [roadmap.md](roadmap.md).
> Priorités : 🔴 casse la confiance / fonctionnel · 🟠 perf · 🟡 UX-cohérence ·
> 🟢 feature / amélioration (non-bloquant) · ⚪ nit.
>
> `[ ]` = à faire · `[~]` = partiellement fait (le détail livré est dans le changelog).
> **2 🔴 ouverts** (audit Builder 2026-07-03).

---

## Reste à faire

### 🔴 Bugs — audit Builder (2026-07-03)
- [ ] 🔴 **Deadlock UI : changer `workerCount` pendant un solve** — l'effet
      `useEffect([workerCount])` (`BuilderScreen.tsx:721-726`) fait `dispose()` +
      `orchestratorRef.current = null` sans `setSolving(false)` ni flush : `onResult` ne
      viendra jamais, l'écran reste en « solving… » et le bouton Cancel est un no-op
      (`orchestratorRef.current?.cancel()` sur ref nulle). Seul un changement de héros
      débloque. **Fix** : reset `solving`/progress dans cet effet.
- [ ] 🔴 **`computeScore` ne clampe pas PEN à 100 %** — `ratings.ts:162-164` clampe CHC
      mais pas PEN, alors que le registre marque `pen` `capAt100: true` et que
      `SCORE_CAP_100` (`statRegistry.ts:90`) est exporté **mais jamais utilisé**. Le modèle
      de dégâts (`computeCheapRatings`) plafonne bien PEN (PPR §1.2) → un build à 115 % PEN
      gagne du score fantôme et peut être classé devant un build strictement meilleur.
      **Fix** : `const effective = SCORE_CAP_100.has(key) ? Math.min(v, 100) : v;`.

### 🟡/⚪ Cas limites — audit Builder (2026-07-03)
- [ ] 🟡 **Cancel non réactif dans les sous-arbres massivement élagués** — le tick
      (`permutations % tickEvery`) n'incrémente qu'à la feuille talisman
      (`engine.ts:1319-1320`) ; les itérations d'armor rejetées mid-tree / au leaf
      « no broken sets » ne tickent jamais → sur de gros pools armor quasi-tous rejetés
      (ex. `allowBrokenSets=false` sans plan), le worker peut ignorer Cancel plusieurs
      secondes. **Fix** : compter aussi les nœuds visités (pas seulement les feuilles).
- [ ] 🟡 **Plan de sets infaisable (> 4 slots) créable dans l'UI** — `cycleSetInPlan` ne
      borne pas `Σ count` d'un plan (`2pc A + 2pc B + 2pc C` = 6 slots) ; le moteur le
      skippe correctement (`setPlans.ts:101`) et les pools se vident, mais `emptyReason`
      accuse « les filtres » au lieu du plan impossible. **Fix** : garde dans le reducer ou
      badge rouge sur l'onglet du plan.
- [ ] ⚪ **`worker.onerror` non filtré par `solveId`** — `orchestrator.ts:200` : un crash
      tardif d'un run périmé peut afficher une bannière d'erreur sur le run courant (les
      messages `error` structurés passent, eux, par le check `solveId`).

### 🟠 Perf — audit Builder (2026-07-03)
- [ ] 🟠 **Mémoïser `allocateGemsReachingCap` par `preGemCrc`** — dans le chemin
      `wantCritCap` (`engine.ts:1338-1348`), chaque combo alloue tableaux +
      `Array(scored.length)` et re-parcourt le pool, alors que le résultat ne dépend que
      d'un scalaire (`preGemCrc`, pool constant). Un cache
      `Map<preGemCrc quantisé, CappedAllocation>` éliminerait quasi tout le slow path
      (des millions de combos partagent une poignée de valeurs).
- [ ] 🟠 **Sortir l'estimation pré-solve du main thread** — le `precomputeContext`
      debounced (`BuilderScreen.tsx:956-990`) fait, en mode CP : reforge-sim de tout le
      pool + `computeFinalStats` + CP **par pièce candidate** + dominance O(n²) → 100 ms+
      de jank par changement de filtre sur gros inventaire. Pousser dans un worker, ou ne
      calculer que les tailles de pools sans le prune CP.
- [ ] 🟠 **`pickPartitionSlot` : préférer un slot externe** — si le plus gros pool est le
      talisman (boucle la plus interne, fréquent), chaque worker re-parcourt tout le
      cartésien externe et re-paye ×W le travail hoisté (set tracking,
      `computeSetBonuses`, `aggregatePrefixBuckets`). Préférer le plus gros pool parmi
      weapon/helmet/armor quand il est ≥ au nombre de workers.
- [ ] 🟠 **Throttle global du progress côté orchestrateur** — chaque worker poste toutes
      les ~100 ms et chaque message déclenche `setSolveProgress`
      (`orchestrator.ts:368-375`) : à 15-30 workers → 150-300 re-renders/s de l'écran
      pendant un solve. Agréger à ~10 Hz dans `handle()`.
- [ ] 🟠 **Anti-overshoot : comparer avant de recomposer** — la branche
      `fs.critRate > 102` (`engine.ts:1349-1356`) recompose sans `gemDeltaEquals`,
      contrairement au chemin `wantCritCap` ; quand `preGemCrc < 100` l'allocation cappée
      rend souvent le même delta → compose gaspillée. Le check est une ligne.
- [ ] ⚪ **Nits** : `keepTopPct` n'a plus d'appelant hors tests (`engine.ts:897-904`) —
      supprimer ou marquer test-only · `talisman.enhanceLevel >= 5 ? 5 : 4` duplique
      `gemSlotsOf` dans la hot loop · `TopKHeap` pourrait mettre en cache la clé au push.

### 🟢 Tests manquants — audit Builder (2026-07-03)
- [ ] 🟢 **Crit-cap slow path de bout en bout** — rien ne teste le trigger `wantCritCap`
      + recompose dans `solveChunk` (le chemin par-combo `allocateGemsReachingCap` +
      `gemDeltaEquals`).
- [ ] 🟢 **Flux orchestrateur** — cancel / supersede / `solveId` anti-stale /
      `workersDone === activeChunks` : aucun test, et c'est là que vivent les deux bugs
      🔴/⚪ ci-dessus.

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
- [ ] Bake prod du `data/` (`extraResources` → `process.resourcesPath`) · `electron build`/installeur
      lance serveur local + renderer · auto-update contre release signée + feed réels · bouton capture
      natif en packagé (sans `npm run dev`).
- [ ] **Vérif sync repo en prod packagé** (plumbing posé, items 5-10 du plan asset-sync) — 1er lancement
      online : seed `data/derived` bundlé → sync SHA → download tables+buffs → rebuild ; images peuplent
      le cache à la demande + préfetch `ui/`+`equipment/`. Vérifier `/img/*` ne tape jsDelivr/raw que sur
      miss (127.0.0.1 ensuite, 302 outerpedia.com seulement si CDN down) · 2e lancement SHA inchangé =
      instantané · simuler un patch (`OUTERPEDIA_REF` autre branche) · offline cold-cache = pas de crash.

---

> ✅ **À NE PAS toucher (Inventory)** : virtualisation par lignes + reflow `ResizeObserver`, indexation
> `charsByUid` en `Map`, auto-prune des chips indisponibles, `memo` sur `GearTile` (callback stable),
> re-seed du draft à l'ouverture de la modal.
