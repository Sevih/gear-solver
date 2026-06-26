# Solver — fonctionnement & UI

Ce doc décrit le **gear-solver** (onglet Builder), ses panneaux d'interface,
son pipeline interne, et les choix d'architecture qui le sous-tendent.

> Architecture générale du repo : [architecture.md](architecture.md).
> Toutes les formules (compose, CP, ratings, score, gems, reforge, top-%,
> heap) + leurs validations : [reference.md](reference.md).

---

## 1. Vue d'avion

```
BuilderScreen.tsx (React, main thread)
  │
  ├─ useReducer(SolverFilters)   ← 19 actions, 10 panneaux + sidebar/footer contrôlés
  │
  ├─ SolverOrchestrator           ← pool de Web Workers (hardwareConcurrency-1, override gs.solver.workerCount)
  │     │
  │     │  fan-out (postMessage)
  │     ▼
  │  ┌─────────────────────────────────────────────┐
  │  │ solver.worker.ts × W   (parallèle, sans IPC)│
  │  │   └─ engine.ts                              │
  │  │       phases 1-2 : prepareContext           │
  │  │       phase 3   : top-% prune              │
  │  │       phase 4   : cartesian + set-prune    │
  │  │       phase 5   : compose + ratings + heap │
  │  │       phase 6   : finalize CP (top-N)      │
  │  └─────────────────────────────────────────────┘
  │     │  fan-in  (result + progress)
  │     ▼
  └─ table résultats + bottom gear band + footer (P/S/Results)
```

Un seul **orchestrator** vit pour toute la durée de l'écran. Les **workers**
sont créés à la première solve et conservés entre runs (le démarrage d'un
Worker coûte ~30 ms + transfert de l'inventaire + gameData, à amortir).

---

## 2. Modes : SOLVE vs SOLVE CP

| Bouton    | Objectif                | Sort key                          | Coût hot-path |
|-----------|-------------------------|-----------------------------------|---------------|
| **SOLVE**    | Maximise un **Score** pondéré par les priorités utilisateur (`Σ priority × final / norm`). Utile quand on sait quel profil de stats viser. | `score`             | `compose + cheap ratings` |
| **SOLVE CP** | Maximise le **Combat Power** in-game (`CalcBattlePower` reverse-engineered). Mono-objectif. | `cp` (calculé dans la boucle) | `compose + cheap ratings + cp` |

CP est cher : par défaut il est calculé **uniquement pour le top-N** en SOLVE
(paresseux, dans `finalizeBuilds`, juste pour l'affichage) et **pour chaque combo**
en SOLVE CP (sort key oblige).

Le filtre CP utilisateur (`cp min/max`) est appliqué **dans la boucle** dès qu'il
est actif — y compris en mode SOLVE, où CP est alors calculé par combo. C'est requis
pour la justesse : différer le filtre à `finalizeBuilds` laissait le heap se remplir
du top-K **par score** puis retirait a posteriori les builds hors-CP, évinçant des
builds valides classés juste hors top-K (perte de recall / sous-retour). Idem pour le
filtre `upg` (résolu en amont depuis le loadout équipé, appliqué in-loop). Les re-checks
au finalize deviennent des no-op idempotents.

---

## 3. Pipeline détaillé (1 worker, sur son chunk)

### Phase 1 — Précompute hero
- `composeCharStats(hero)` → `baseline` (no-gear stats) + `scaling` (per-axis CalcFinalStat ingredients pour ATK/DEF/HP/EFF/RES). Réutilisé pour chaque combo.
- Récupère l'EE équipé sur le héros (fixe — le solver ne l'énumère pas).
- Skills du perso (first/second/ultimate/chainPassive) pour CP.

### Phase 2 — Pools par slot
Pour chaque slot ∈ {weapon, helmet, armor, gloves, boots, accessory, ooparts} :
filtre les pièces de l'inventaire :
- `g.slot === slot`
- exclu si `includeEquippedOnOthers === false` et équipé sur un autre héros
- exclu si `g.equippedBy ∈ excludedHeroes`
- exclu si `onlyMaxed && enhanceLevel < 15`
- exclu si `classLimit` ≠ classe du héros
- exclu si **main pick** actif pour ce slot et `g.main[0].stat ∉ picks`
- exclu si **effect chip** (weapon/accessory) marqué `excluded` ; ou marqué `required` et l'icône ne match pas
- exclu si `armorSetId ∈ excludedSets`

Toggle **`keepCurrent`** : si la pièce actuellement équipée par le héros existe pour ce slot, le pool est restreint à `[currentPiece]` (le solver ne touche pas au slot).

### Phase 3 — Top-% prune (heuristique)
Si l'utilisateur a posé au moins une priorité non-nulle ET `topPct < 100` :
score chaque pièce du pool par
```
score(piece) = Σ_rolls priority[user_key] × (value / STAT_NORMS[user_key])
```
tri desc, garde les `⌈N × pct / 100⌉` meilleurs. **Normalisation cruciale** :
sans elle, les pièces à grosse magnitude (HP +200) écrasent toujours les
pièces crit (CHC +5) à priorité égale.

Le mapping engine→user (`STAT_TO_PRIORITY` dans `ratings.ts`) garantit que
`atkPct` rolls et `atk` flats partagent la même bucket priority `atk`.

### Phase 4 — Cartesian + set-prune
Énumération nested loop : `weapon × helmet × armor × gloves × boots × accessory × ooparts`.
- **Partition** : un slot (le plus grand) est sliced en `chunkCount` parts ; chaque
  worker reçoit sa slice → embarrassingly parallel, aucune comm inter-worker.
- **Set tracking** : à chaque slot armor, `incSet(armorSetId)` au début de la pièce, `decSet` après l'inner loop.
- **Mid-tree pruning** : à chaque depth `D` (D armor slots itérés, `4-D` restants), pour chaque set requis (2pc ou 4pc) on vérifie qu'il reste assez de slots pour atteindre le seuil. Sinon, `continue` au prochain frère.

### Phase 5 — Per-combo : compose + ratings + filtres + heap
Pour chaque combo qui passe phase 4 :

1. **Compose** : `computeFinalStats(baseline, scaling, pieces, game, gemDelta)`.
   - `pieces` est un array hoisted (mutée en place) pour éviter 10M+ allocations.
   - `gemDelta` est pré-agrégé (cf. § Gems).
2. **Stat filter** : si une `FinalStats[key]` est hors `[min, max]` user, `continue`.
3. **Cheap ratings** : 8 produits simples (HpS, Ehp, EhpS, Dmg, DmgS, Mcd, McdS, DmgH).
4. **Score** : `Σ priority × (final / STAT_NORMS) × 100`.
5. **Rating filter** : pareil que stat filter, sur ratings + score.
6. **CP / upg** : CP est calculé en SOLVE CP, OU en SOLVE dès qu'un filtre CP est posé
   (le filtre rejette alors tôt). Si un filtre `upg` est posé, il est aussi évalué ici
   (depuis le loadout équipé pré-résolu). Les deux filtrent **avant** le push, donc le
   heap ne contient que des builds valides.
7. **Push** dans un min-heap fixed-size (`TopKHeap`, K=1000 par défaut) keyed par `score` ou `cp` selon mode.

### Phase 6 — Finalize (worker side)
- SOLVE CP : top-K déjà trié sur CP, on retourne tel quel.
- SOLVE : on calcule CP pour chaque build du top-K **pour l'affichage** (lazy) quand aucun
  filtre CP n'était actif ; sinon CP est déjà porté par le build. `upg` est (re)calculé pour
  la colonne. Les filtres CP/upg ayant déjà été appliqués in-loop, les re-checks ici sont
  des no-op idempotents.

### Côté orchestrator
- Reçoit `{builds, permutations, searched}` de chaque worker.
- Merge des top-K en un buffer global, sort final, slice top-N (1000 par défaut), forward à React.
- Aggregate `permutations` + `searched` pour le footer (somme des compteurs per-worker).

---

## 4. Les panneaux de l'UI

Les panneaux du haut (Hero, Stats, Sub tick value / Damage info, Options, filtres,
priorité, mains, sets, effets) + sidebar Actions/Library + footer fixé. Chaque panneau
de filtre pousse son state dans le reducer `SolverFilters` ([BuilderScreen.tsx](../apps/renderer/src/screens/BuilderScreen.tsx)).

### Hero
Picker (combobox searchable) + portrait + 4 boutons d'action.
- **SOLVE** : lance le mode score (désactivé si pas de héros ou solve en cours).
- **SOLVE CP** : lance le mode CP.
- **Cancel** : interrompt la solve (les workers retournent leur heap partiel, l'orchestrator merge ce qu'on a).
- **Reset filters** : `dispatch({type: "resetAll"})` — vide tout le reducer.

### Stats
Snapshot des `FinalStats` du build actuellement équipé sur le héros (col gauche)
vs le build sélectionné dans la table (col droite, em-dash tant qu'aucune ligne
n'est cliquée). Lecture pure, jamais éditable.

### Sub tick value & Damage / +1% (encadrés d'aide par héros)
Deux panneaux d'info en lecture seule (col droite, sous Stats), recalculés au
changement de héros / niveau / awakening :
- **Sub tick value** (`lib/subValue.ts`) — pour ATK/DEF/HP, la valeur d'un tick de
  sub 6★ en **flat** vs en **%** (≈ équivalent flat), gagnant en cyan. Un tick % scale
  sur `base+evo+awak` (gear-indépendant — le flat gear est ajouté après le ×%, le
  `(1+buffRate)` s'annule) → le verdict ne dépend que de la base du héros. Valeurs par
  tick depuis `sub-ticks.json` (dérivé de `subStatPools` outerpedia).
- **Damage / +1%** (`lib/dmgValue.ts`) — gain de dégâts attendu pour **+1%** de chaque
  stat pertinente : la/les stat(s) de scaling du héros (ATK/DEF/HP/**SPD** via `dmgStat` +
  secondaires `dmgSec`, SPD/EFF/CHC inclus) vs **CHD** vs **DMG inc**, classé, meilleur en
  cyan. **Calculé à 100% crit** (crit cap = baseline endgame). Réutilise `computeCheapRatings`
  (modèle dégâts RE 1.4.9). Les héros **no-crit** (`noCrit`, ex. 2000086/2000091/2000008)
  forcent `crc=0` et masquent CHD.

### Options
Le segmented control **Reforge** (toolbar) + toggles + le multi-select Exclude :
- **Reforge** (`reforgeMode`, 3 états, **câblé**) — projette chaque pièce du pool
  vers un plafond endgame **avant** le top-% prune (`projectPieceForReforge`) :
  - **Off** : gear tel que capturé.
  - **Classic** : projette à **+10 non-ascended** (main re-scalé via le mult de
    `scaleMain` côté core `projectMainToCeiling`, + substats max-rollés à **6 ticks**).
  - **Ascended** : projette à **+15 ascended** (override le flag réel → on suppose tout
    ascensionné ; **9 ticks**). Ne *downgrade* jamais une pièce déjà au-dessus du plafond.

  Le re-scale du main passe par le ratio des multiplicateurs (`RolledStat` ne garde pas
  la valeur de base) — validé contre l'in-game (test `projectMainToCeiling` : 240 → 1380).
- **Only maxed gear** — filtre pool à `enhanceLevel === 15`.
- **Equipped items** — inclut les pièces équipées sur d'autres héros.
- **Keep current** — verrouille les slots déjà équipés à leur pièce actuelle.
- **Exclude equipped** — **câblé** : `ExcludeHeroesPicker` (multi-select) écrit dans
  `excludedHeroes` via `toggleHeroExcluded` / `clearExcludedHeroes`.

### Stat filters
Min/max par stat finale (12 stats). Appliqué après compose, rejet du combo si une stat sort de la bande. Inputs vides = pas de borne.

### Rating filters
Min/max sur les ratings dérivés + Score. `cp` et `upg` sont traités spécialement
(appliqués in-loop quand posés, cf. § 2 / phase 5) — pas via le `FilterSpec[]` compilé
car ils dépendent du loadout équipé / d'un calcul coûteux non disponible à la compile.

### Substat priority
- Slider par stat (12 stats) : valeur entière `-1..3`. Stockée dans `priority` (clés user : `atk`, `crc`, `chd`, ...).
- Slider **Top %** : `5..100`. Pilote la phase 3 prune.
- Bouton **(clear)** : `dispatch({type: "clearPriority"})`.

Quand priority est uniformément 0 : le pool n'est pas pruné et les **gems
ne sont pas réalloués** (fallback sur les gems actuellement socketés — cf. § Gems).

### Main stats
Trois lignes (Weapon / Accessory / Talisman). Chaque ligne montre les mains
réellement présents dans l'inventaire pour ce slot (chips icône). Click pour
OR-allow. Pool exclu si aucune main de la pièce ne match.

Les autres slots (helmet/armor/gloves/boots) n'apparaissent pas : leur main est
fixe en jeu.

### Sets
Chips icône d'armor-set, gates par feasibility (`canForm2pc / canForm4pc`
calculés depuis l'inventaire). Click cycle :
```
off → req-2pc → req-4pc → excluded → off
```
en sautant les transitions impossibles. Sets totalement inutilisables (aucun
bonus 2pc/4pc atteignable) ne s'affichent pas. Tooltip 3-sections : nom + (N owned) / desc 2pc / desc 4pc / state.

### Weapons & accessories
Deux groupes de chips effect-icon (Weapons / Accessories), filtrés par class du héros (gated par `classLimit`). Click cycle `off → required → excluded → off`. Tooltip : nom + (N owned) / desc T4 / state.

### RightSidebar — Library
Trois sections **câblées** (localStorage, par héros) :
- **Save / Remove build** — bookmark le build sélectionné (`storage/savedBuilds.ts`).
  Un build sauvé porte aussi son contexte reforge pour reprojeter ses substats à la
  restauration.
- **Filter presets** — sauve / charge / supprime un snapshot de filtres
  (`storage/filterPresets.ts`, `loadPreset`).
- **Restore** — repush un build sauvé dans la table + bottom band.

Equip / Unequip **vers le jeu** restent absents (nécessitent une API jeu inexistante).
Le bouton **Optimize →** vit côté onglet Builds (ouvre le Builder sur le héros).

### FilterFooter (fixed en bas)
- Chips par slot avec **hit/total (%)** — alimentés par `poolSizes` du premier progress event de chaque worker.
- **P** : permutations totales explorées (somme across workers).
- **S** : permutations qui ont passé tous les filtres (scoring).
- **Results** : taille du top-N retourné.
- Indicateur `solving…` (cyan, animé) pendant un run.

### ResultsTable
Heatmap rouge-vert par colonne (min/max relatifs au result set actuel). Colonnes :
sets, 8 stats principales, ratings (`TABLE_RATINGS`), **Score**, **Upg**, actions
(`Upg` = nb de slots différant du loadout actuel, triable + filtrable). Tri par clic
sur l'en-tête (null → desc → asc → null). Click sur une ligne → la `BottomGearBand`
affiche les 8 pièces. État `solving…` / erreur / **état vide explicite** (un `emptyReason`
dérivé de `poolSizes` liste les slots tombés à 0 pièce après filtres).

### BottomGearBand
8 cartes (mirror compact de l'inventaire) — une par slot. Chaque carte montre nom,
enhance level, icône slot, main stat, subs (avec ticks). En plus :
- **Talisman / EE** : l'allocation de gemmes recommandée par le build (stat + valeur,
  badge **swap** si elle diffère des gemmes socketées).
- **Stats projetées** : si le mode Reforge ≠ Off, main + subs affichés sont la projection
  (`projectPieceForReforge` re-simulé côté main thread) + badge **classic** / **ascended**.
  La carte montre aussi l'enhance projeté (`+15 · ascended`) puisque la pièce projetée
  porte son `enhanceLevel`/`ascended` cible.

Em-dash quand aucun build n'est sélectionné.

---

## 5. Gems — sous-solver greedy

**Pool** : multiset des `gemSlots[]` non-nuls de tous les Talismans + EE de l'inventaire (les gems sont swappables in-game, donc on agrège globalement).

**Scoring** : pour chaque gem, `score = priority × (value / STAT_NORMS)`. Normalisé pour permettre la comparaison cross-stat. Triés desc.

**Allocation (défaut, fast path)** : greedy, K = `talismanSlots + eeSlots` (4 ou 5 selon `enhanceLevel`). On prend les K premiers gems avec `score > 0`. Pré-calculé **une fois par variant talismanSlots** (4 ou 5) dans `prepareContext` — pas de re-calcul dans la hot loop.

**Cap-reaching CHC (slow path, par combo)** : quand l'utilisateur priorise `crc` **et** le pool a des gems crit (`wantCritCap`), l'allocation est **étagée** (`allocateGemsReachingCap`) :
1. **Étage 1** — dépenser des gems crit pour **atteindre** le cap CHC à 100 % (en priorité, même si l'atk score plus haut), overshoot ≤ un gem 3 %.
2. **Étage 2** — remplir le reste **par priorité** (en sautant tout gem crit, désormais gaspillé).

Le pré-gem CHC du combo est récupéré depuis `fs.crc − defaultCrcGem` (le crit rate est purement additif). On ne **recompose** que si le delta cap-aware diffère du greedy par défaut (`gemDeltaEquals`) — souvent identique quand les gems crit rankent déjà haut. Le cas sans priorité crc (ex. fallback SOLVE CP) garde l'ancien anti-overshoot (`allocateGemsCapped`, déclenché seulement si `fs.crc > 102`).

**Pré-agrégation** : la contribution gem est convertie en `{flat: {atk: 5, ...}, pct: {atkPct: 24, ...}}`. La compose ajoute juste ces deltas aux buckets après l'agrégation des pièces. Évite `resolveStat` × 10 gems × N combos.

**Fallback `null`** : si la priority est vide (aucun gem n'a un `score > 0`),
le delta est `null` → le solver ne passe pas de `gemOverride` → la compose
utilise les **gems actuellement socketés sur le Talisman + EE** (via `piece.subs`).
C'est volontaire : sans intention utilisateur, on respecte l'état du joueur
plutôt que d'estimer 0 gems et sous-évaluer CP.

---

## 6. Heuristique Top-% — pourquoi c'est là

Inventaire typique : 150 pieces par slot × 7 slots = `150^7 ≈ 10^15` permutations. Inacessible.

Top-% prune ramène ça à `(150 × pct/100)^7` :
- 100% → 10^15 (inutilisable)
- 50% → ~10^13
- 30% → ~10^11
- 10% → ~10^8 (utilisable, 1-5s)
- 5% → ~10^6 (très rapide, mais peut zapper le build optimal)

Le hint du panneau le dit explicitement : *"Heuristic — too low a Top % drops optimal builds"*. C'est un trade-off pure recall vs vitesse.

Avec `priority` vide, le score est arbitraire — le prune est **désactivé** automatiquement (chaque pièce score 0, ranking aléatoire, donc on garde tout).

---

## 7. Optimisations clés (et pourquoi)

1. **Engine pur, sans React** (`engine.ts`, `gems.ts`, `ratings.ts`, `cp.ts`) — importable depuis n'importe quel worker ou test, pas de DOM ni de Suspense à se trimballer.

2. **Worker pool = `hardwareConcurrency − 1`** (`resolveWorkerCount`, override
   `gs.solver.workerCount`, plafond dur 64) — un cœur laissé à l'UI, le reste à
   la recherche. L'ancien plafond fixe à 8 laissait les machines many-core
   sous-employées (8 workers / 32 threads = 25 % CPU) ; le clone postMessage
   inventaire/game par worker est un coût *fixe* par solve, amorti sur un solve
   de plusieurs secondes — scaler avec la machine est donc le bon défaut. Le log
   debug `solver` (`pool`) affiche le nombre résolu + `hardwareConcurrency`.

3. **Partition embarrassingly parallel** — chaque worker prend une slice du
   slot le plus grand. Aucune comm inter-worker, merge final O(W × K). Le nombre
   de workers réellement sollicités est cappé à la taille du pool partitionné
   (`chunkCount = clamp(1, W, maxPoolHit)`) — inutile d'envoyer une slice vide à
   un worker quand le pool a moins d'items que de workers.

4. **`pieces` array hoisted + mutée en place** — évite 10M+ allocations dans
   la boucle inner. Sûr car `computeFinalStats` ne garde pas la référence.

5. **Gem delta pré-agrégé** — la contribution gem ne se calcule qu'**une fois
   par variant talismanSlots** au lieu de N combos × 10 gems × resolveStat.
   Gain massif sur le hot path.

6. **Mid-tree set pruning** — `req-4pc Sharp` avec 1 helmet Sharp : on prune
   sans descendre dans armor × gloves × boots. Énorme sur les recherches
   sets-restreintes.

7. **CP paresseux en SOLVE** — CP est ~20× plus cher qu'un cheap rating. Calculé
   seulement pour le top-N final (~1000 vs des millions).

8. **Cancel responsive via MessageChannel** — `solveChunk` est async, yield à chaque
   tick (~4096 combos) via un `MessageChannel.postMessage` round-trip (<1ms vs 4ms
   pour `setTimeout(0)` throttlé dans les workers). Cancel mid-solve se propage
   en ≤ tickEvery × t_combo ≈ 20-50ms.

9. **`FilterSpec[]` compilé** — `Object.keys` + `for...in` remplacés par un
   tableau plat itéré par index. Mineur mais cumulé sur des millions de combos.

10. **Set bonuses hoistés** — `computeSetBonuses` (rebuild de Map + lookups) est calculé
    1× par combo accessory et passé à `aggregateGearBuckets`, pas recalculé par talisman.
    Bit-identique (invariant sur la boucle talisman puisque le talisman n'a pas d'`armorSetId`).

11. **Min-heap top-K** — `O(N log K)` au lieu de `O(N log N)` si on triait
    l'ensemble. K=1000 → log K ≈ 10.

12. **`init` send-once** — `game` + inventaire (graphes constants, lourds) sont
    envoyés à chaque worker **une fois** (message `init`, cachés worker-side) au lieu
    d'être re-clonés à chaque fan-out. Re-broadcast seulement quand la ref change (re-capture).
    Le solve n'envoie plus que le payload allégé (`SolveRequestMsg` = `SolveRequest`
    moins game/inventory) + le précalcul des pools. Le worker re-fusionne les constantes
    cachées → `SolveRequest` complet, donc **le moteur est inchangé**. Indispensable au
    scaling worker-count (§7.2) : sans ça, N clones de `game` par solve domineraient.

---

## 8. Limites connues

(rien de bloquant aujourd'hui — voir [todo.md](todo.md) pour le backlog.)
- **Equip / Unequip vers le jeu** : absents — nécessitent une API jeu inexistante
  (le pipeline de capture est read-only pour l'instant).
- **Perf hot-path** : le rebuild des set bonuses par talisman est hoisté (§7.10) et la
  table de résultats est virtualisée (`@tanstack/react-virtual`). Reste que
  `aggregateGearBuckets` re-somme les 6+EE pièces invariantes à chaque talisman — un
  accumulateur incrémental (en préservant l'ordre flottant) est au backlog.
- **Worker init = W × game/inventory** : `game` + inventaire sont structured-clonés
  vers chaque worker **une seule fois** (message `init`, mis en cache worker-side ;
  re-broadcast seulement à une re-capture). Chaque solve n'envoie plus que le payload
  allégé (filtres + précalcul des pools), pas les gros graphes constants — ce qui rend
  le scaling à beaucoup de workers viable (sinon N clones de `game` par solve domineraient
  le fan-out). Reste la copie initiale W× : pour des inventaires énormes (>50 MB), l'étape
  suivante est SharedArrayBuffer (besoin COOP/COEP + flatten binaire des données).

---

## 9. Carte des fichiers

```
apps/renderer/src/
├── workers/
│   └── solver.worker.ts          ← thin adapter IPC ↔ engine
├── lib/
│   ├── composeBuild.ts            ← computeFinalStats + aggregateGearBuckets (+ GemOverride)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← bookmark de builds par héros (localStorage)
│   │   └── filterPresets.ts        ← snapshots de filtres par héros (localStorage)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool de Web Workers, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap + simulateReforges
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + aggregateGemDelta + allocateGems
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower (reverse-engineered)
└── screens/
    ├── BuilderScreen.tsx           ← reducer SolverFilters + tous les panneaux + orchestrator wiring
    └── BuildsScreen.tsx            ← roster équipé/composé + computeAdvice + Optimize →
```

Bonus :
- `data/stat-locks.json` : snapshots stat-régression pour valider la compose
  formula (cf. [project-gear-solver-stat-locks](../../../.claude/projects/c--Users-Sevih-Documents-Projet-perso-outerpedia-v2/memory/project_gear_solver_stat_locks.md) memory).

---

## 10. Comment tester end-to-end

1. Lancer l'app (`npm run dev`).
2. Onglet Builder → choisir un héros équipé.
3. Cliquer **SOLVE** sans aucun filtre/priority → la table doit se remplir, P/S incrémentent.
4. Cliquer une ligne → bottom band affiche les 8 pièces.
5. Mettre `Crc min = 90` puis re-SOLVE → tous les builds retournés satisfont la borne.
6. Activer `Sharp 4pc required` → helmet/armor/gloves/boots des builds sont tous Sharp.
7. **Comparaison régression** : SOLVE avec priority vide + Top 100% + Keep current → le top-1 doit avoir les mêmes `FinalStats` que la card du même héros dans l'onglet Builds (à la réallocation gems près, qui en mode priority vide est fallback sur les gems actuels donc ✓ équivalence stricte attendue).
8. SOLVE CP → top-1 doit avoir le plus gros CP affiché. Comparer à un solve brute-force séparé sur petite slice.
