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
  ├─ useReducer(SolverFilters)   ← 11 actions, 10 panneaux contrôlés
  │
  ├─ SolverOrchestrator           ← pool de Web Workers (hardwareConcurrency-1, capped 8)
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

CP est cher : il est calculé **uniquement pour le top-N** en SOLVE (paresseux,
dans `finalizeBuilds`) et **pour chaque combo** en SOLVE CP (sort key oblige).
Le filtre CP utilisateur (`cp min/max`) est appliqué :
- en SOLVE CP : dans la boucle (rejette tôt) ;
- en SOLVE    : dans `finalizeBuilds` après calcul (peut réduire le top-N final).

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
6. **CP** : calculé seulement en SOLVE CP (puis filtre CP).
7. **Push** dans un min-heap fixed-size (`TopKHeap`, K=1000 par défaut) keyed par `score` ou `cp` selon mode.

### Phase 6 — Finalize (worker side)
- SOLVE CP : top-K déjà trié sur CP, on retourne tel quel.
- SOLVE : on calcule CP pour chaque build du top-K (lazy), on applique le filtre CP user, on retourne ce qui reste.

### Côté orchestrator
- Reçoit `{builds, permutations, searched}` de chaque worker.
- Merge des top-K en un buffer global, sort final, slice top-N (1000 par défaut), forward à React.
- Aggregate `permutations` + `searched` pour le footer (somme des compteurs per-worker).

---

## 4. Les panneaux de l'UI

Les 9 panneaux du haut + sidebar Actions + footer fixé. Chaque panneau pousse
son state dans le reducer `SolverFilters` ([BuilderScreen.tsx](../apps/renderer/src/screens/BuilderScreen.tsx)).

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

### Options
4 toggles + un placeholder Exclude :
- **Use reforged stats** — *non câblé* (toggle visuel, le solver ne simule pas le reforge).
- **Only maxed gear** — filtre pool à `enhanceLevel === 15`.
- **Equipped items** — inclut les pièces équipées sur d'autres héros.
- **Keep current** — verrouille les slots déjà équipés à leur pièce actuelle.
- **Exclude equipped** (pill) — placeholder ; la liste `excludedHeroes` existe dans le reducer mais aucun multi-select n'est branché.

### Stat filters
Min/max par stat finale (12 stats). Appliqué après compose, rejet du combo si une stat sort de la bande. Inputs vides = pas de borne.

### Rating filters
Min/max sur les ratings dérivés + Score. `cp` est traité spécialement (cf. § 2).
`upg` est informatif, jamais filtré.

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

### RightSidebar — Actions
Boutons placeholder (Equip / Unequip / Save Build / Remove Build / Select All / Deselect All). **Aucun n'est câblé** au moteur ; à brancher dans un futur milestone.

### FilterFooter (fixed en bas)
- Chips par slot avec **hit/total (%)** — alimentés par `poolSizes` du premier progress event de chaque worker.
- **P** : permutations totales explorées (somme across workers).
- **S** : permutations qui ont passé tous les filtres (scoring).
- **Results** : taille du top-N retourné.
- Indicateur `solving…` (cyan, animé) pendant un run.

### ResultsTable
Heatmap rouge-vert par colonne (min/max relatifs au result set actuel).
Colonnes : sets, 8 stats principales, 6 ratings (HpS/Ehp/EhpS/Dmg/DmgS/Cp), Score, actions.
Click sur une ligne → la `BottomGearBand` affiche les 8 pièces du build.
État `solving…` / message d'erreur / état vide (pas de héros) gérés dans le header.

### BottomGearBand
8 cartes (mirror compact de l'inventaire) — une par slot : weapon, exclusive, helmet, armor, accessory, talisman, gloves, boots. Chaque carte montre nom, enhance level, icône slot, main stat, subs (avec ticks). Em-dash quand aucun build n'est sélectionné.

---

## 5. Gems — sous-solver greedy

**Pool** : multiset des `gemSlots[]` non-nuls de tous les Talismans + EE de l'inventaire (les gems sont swappables in-game, donc on agrège globalement).

**Scoring** : pour chaque gem, `score = priority × (value / STAT_NORMS)`. Normalisé pour permettre la comparaison cross-stat. Triés desc.

**Allocation** : greedy, K = `talismanSlots + eeSlots` (4 ou 5 selon `enhanceLevel`). On prend les K premiers gems avec `score > 0`. Pré-calculé **une fois par variant talismanSlots** (4 ou 5) dans `prepareContext` — pas de re-calcul dans la hot loop.

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

2. **Worker pool ≤ 8** — au-delà, l'overhead postMessage + sérialisation
   inventaire/game dépasse le gain CPU.

3. **Partition embarrassingly parallel** — chaque worker prend une slice du
   slot le plus grand. Aucune comm inter-worker, merge final O(W × K).

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

8. **`FilterSpec[]` compilé** — `Object.keys` + `for...in` remplacés par un
   tableau plat itéré par index. Mineur mais cumulé sur des millions de combos.

9. **Min-heap top-K** — `O(N log K)` au lieu de `O(N log N)` si on triait
   l'ensemble. K=1000 → log K ≈ 10.

---

## 8. Limites connues

(rien de bloquant aujourd'hui — voir [todo.md](todo.md) pour le backlog.)
- **`Upg` column** : pas calculée (toujours vide). Spec utilisateur originale.
- **Exclude equipped multi-select** : pill placeholder ; `excludedHeroes`
  existe dans le reducer mais aucun UI n'écrit dedans.
- **Action buttons (Equip / Save Build / …)** : tous non câblés.
- **Worker init = 8 × game/inventory** : chaque worker reçoit une copie par
  postMessage. Pour des inventaires énormes (>50 MB) ça pourrait pincer.
  Alternative future : SharedArrayBuffer (besoin COOP/COEP headers).

---

## 9. Carte des fichiers

```
apps/renderer/src/
├── workers/
│   └── solver.worker.ts          ← thin adapter IPC ↔ engine
├── lib/
│   ├── composeBuild.ts            ← computeFinalStats + aggregateGearBuckets (+ GemOverride)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool de Web Workers, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + aggregateGemDelta + allocateGems
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower (reverse-engineered)
└── screens/
    └── BuilderScreen.tsx           ← reducer SolverFilters + tous les panneaux + orchestrator wiring
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
