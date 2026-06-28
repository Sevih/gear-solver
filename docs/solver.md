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

Deux optimisations réduisent le coût par combo en SOLVE CP : (1) un **évaluateur CP
préparé** (`makeCpEvaluator`) capture les bonus constants (star/skill/EE/fusion) une
fois → plus d'allocation d'objet `CpArgs` ni de re-dérivation par combo, **bit-identique**
à `calcBattlePower` ; (2) les **cheap ratings sont différés** au `finalizeBuilds` (top-N
seulement) quand aucun filtre de rating n'est posé — symétrique au CP-lazy de SOLVE,
puisque le heap est trié par CP, pas par les ratings.

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
- exclu si `g.uid ∈ excludedPieceUids` (exclusion **globale** account-wide, clic-droit Inventory — vérifié en premier)
- exclu si `g.equippedBy ∈ excludedHeroes`
- exclu si `onlyMaxed && enhanceLevel < 15`
- exclu si `classLimit` ≠ classe du héros
- exclu si **main pick** actif pour ce slot et `g.main[0].stat ∉ picks`
- exclu si **effect chip** (weapon/accessory) marqué `excluded` ; ou marqué `required` et l'icône ne match pas
- exclu si `armorSetId ∈ excludedSets`

Toggle **`keepCurrent`** : si la pièce actuellement équipée par le héros existe pour ce slot, le pool est restreint à `[currentPiece]` (le solver ne touche pas au slot). Les slots ainsi verrouillés sont **exemptés** du set-prune ci-dessous.

**Set-prune du pool armor** (`armorSetWhitelist`, pur) : quand les sets contraignent
**entièrement** l'armor (un plan `2pc A + 2pc B` ou `4pc A` → `Σcount === 4`, aucun slot
libre), les pools helmet/armor/gloves/boots sont **élagués** aux seuls sets admissibles
**avant** le cartésien — énorme réduction sur les recherches sets-contraintes. Un set requis
**seul** (`2pc A`, slots libres) n'élague rien par défaut : il faut garder de quoi compléter.
Le toggle **Allow broken sets** (cf. § Options) renverse ça : à *false*, les slots libres
doivent eux aussi former un set complet → la whitelist se restreint aux sets requis + *formables*
(présents dans ≥2 slots armor) et un check leaf rejette les builds à singleton (cf. phase 4).

### Phase 3 — Prune par budget de combos (heuristique)
Tourne dès que `topPct < 100`. **Point clé** : le cap est un **budget de combos
ABSOLU**, pas un pourcentage par slot — un % ne borne pas le **produit** (30 % de
sept pools de ~40-50 = encore ~`7e8` ; mesuré : **703 M / 142 s** en mode Score
avec priorité). `allocateComboBudget` répartit (water-filling) un nombre de pièces
à garder **par slot** pour que `∏ keep ≤ budget` (slots petits gardés entiers, le
surplus va aux gros slots armor). Budget défaut `COMBO_BUDGET = 8 M` (≈ 1-2 s de
solve — Score est plus coûteux par combo que CP), **scalé par le slider Top%**
(`budget = 8M × topPct/30` ; `topPct = 100` rebascule en exhaustif). Talisman/EE
inclus ; slots `keepCurrent` exemptés.

Le budget s'applique à **toutes** les branches ; seule la **clé de ranking par
slot** (un `scoreOf` passé à `keepTopN`) diffère :

**a) Priorité explicite (SOLVE ou SOLVE CP)** — `priorityScoreOf` :
```
score(piece) = Σ_rolls priority[user_key] × (value / ROLL_NORMS[engine_key])
```
**Normalisation cruciale** : `ROLL_NORMS` (magnitude *par-roll*) — pas `STAT_NORMS`
(magnitude finale endgame) ; les deux échelles diffèrent ~100×. Sans elle, les
rolls flat à grosse magnitude écrasent les rolls % à priorité égale. Le mapping
engine→user (`STAT_TO_PRIORITY`) fait partager à `atkPct` et `atk` flat la même
bucket priority `atk`. Les main-options *combat-only* (+15 singularité conditionnels)
sont ignorées (pas sur la feuille de stats visée).

**b) SOLVE CP sans priorité** — `cpEval` : chaque candidat classé par **le CP qu'il
donne posé dans le build actuel du héros** (autres slots = pièces équipées), donc la
chaîne crit/pen/spd qui scale l'ATK est réaliste. **Forme *soft* du dominance prune**.
**Pin** de la pièce équipée → le solve ne rend jamais un CP < l'équipé. **Limite
assumée** : pièce notée *standalone* → un membre qui ne brille qu'en complétant un
set peut être sous-classé ; monter le Top% ou exiger le set.

**c) SOLVE (Score) sans priorité** — `magnitudeScoreOf` (magnitude brute des rolls) :
pas d'objectif (le score serait 0 partout), mais le produit **doit** rester borné
(sinon cartésien complet) → on garde les pièces les mieux rollées par slot.

Protection des sets requis (membres `req-2pc`/`req-4pc`) + pin : ré-ajoutés par
`keepTopN` hors budget pour les trois clés identiquement.

### Phase 4 — Cartesian + set-prune
Énumération nested loop : `weapon × helmet × armor × gloves × boots × accessory × ooparts`.
- **Partition** : un slot (le plus grand) est sliced en `chunkCount` parts ; chaque
  worker reçoit sa slice → embarrassingly parallel, aucune comm inter-worker.
- **Set tracking** : à chaque slot armor, `incSet(armorSetId)` au début de la pièce, `decSet` après l'inner loop.
- **Mid-tree pruning** : à chaque depth `D` (D armor slots itérés, `4-D` restants), pour chaque set requis (2pc ou 4pc) on vérifie qu'il reste assez de slots pour atteindre le seuil. Sinon, `continue` au prochain frère.
- **Leaf no-broken-set** : si **Allow broken sets** est *off*, à la profondeur boots (`remaining === 0`) on rejette aussi tout build dont le tally `setCount` n'est pas « complet » (`allSetsComplete` : tout set présent ≥2 ET 4 pièces armor toutes set-trackées → soit un 4pc, soit deux 2pc). Check leaf-only : un singleton mid-tree peut encore s'apparier plus bas.

### Phase 5 — Per-combo : compose + ratings + filtres + heap
Pour chaque combo qui passe phase 4 :

1. **Compose** : `computeFinalStats(baseline, scaling, pieces, game, gemDelta)`.
   - `pieces` est un array hoisted (mutée en place) pour éviter 10M+ allocations.
   - `gemDelta` est pré-agrégé (cf. § Gems).
2. **Stat filter** : si une `FinalStats[key]` est hors `[min, max]` user, `continue`.
3. **Cheap ratings** : 8 produits simples (HpS, Ehp, EhpS, Dmg, DmgS, Mcd, McdS, DmgH).
   Pour un héros **`noCrit`** (`meta.noCrit`, propagé dans le contexte), `computeCheapRatings`
   reçoit `noCrit=true` → `pCrit=0` (le terme CHD disparaît) et `mcd` retombe sur le hit
   non-crit : la CHC/CHD ne gonfle plus ses ratings. CP reste inchangé (miroir in-game fidèle).
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

**Mémoire de filtres par héros** (session-scoped) : changer de héros **snapshot** les filtres du héros
sortant et **restaure** ceux de l'entrant (`heroFilters.ts`, `gs.solver.heroFilters` sessionStorage), au
lieu de tout resetter — distinct des **Filter presets** nommés/durables. Les *résultats* restent vidés.

### Stats
Snapshot des `FinalStats` du build actuellement équipé sur le héros (col gauche)
vs le build sélectionné dans la table (col droite, em-dash tant qu'aucune ligne
n'est cliquée). Lecture pure, jamais éditable. La colonne projetée porte un **Δ
numérique signé** par axe (`proj − current`, arrondi) en plus du tint vert/rouge —
le « de combien », pas juste le sens.

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
- **Reforge** (`reforgeMode`, 3 états, **câblé**, **défaut Classic**) — projette chaque pièce
  du pool vers un plafond endgame **avant** le top-% prune (`projectPieceForReforge`). Défaut
  `classic` (+10) car c'est la norme endgame ; `Off` noterait le gear capturé (+0/+9), trompeur.
  - **Off** : gear tel que capturé.
  - **Classic** : projette à **+10 non-ascended** (main re-scalé via le mult de
    `scaleMain` côté core `projectMainToCeiling`, + substats max-rollés à **6 ticks**).
  - **Ascended** : projette à **+15 ascended** (override le flag réel → on suppose tout
    ascensionné ; **9 ticks**) **+ le passif de singularité inconditionnel** (`addProjectedSingularity` :
    DMG+ 50 % arme/accessoire, DMG- 25 % armures — meilleure valeur de la table). Une pièce déjà
    ascended garde son **vrai roll**. Ne *downgrade* jamais une pièce déjà au-dessus du plafond.

  Le re-scale du main passe par le ratio des multiplicateurs (`RolledStat` ne garde pas
  la valeur de base) — validé contre l'in-game (test `projectMainToCeiling` : 240 → 1380).
- **Only maxed gear** — filtre pool à `enhanceLevel === 15`.
- **Equipped items** (`equippedScope`, **défaut ≤ Lower**) — quelles pièces équipées sur
  d'**autres** héros le solver peut piocher. Défaut `lower` : seulement les héros **strictement
  moins** prioritaires (auto-rangés par CP à la capture) → ne déshabille jamais un héros
  égal/supérieur. Sans ranking, dégrade en own+free (`isLowerPriority` ∞>∞ = false). `None` = own
  + free, `All` = n'importe quelle pièce équipée (l'ancien défaut, vol silencieux possible).
- **Keep current** — verrouille les slots déjà équipés à leur pièce actuelle.
- **Allow broken sets** (`allowBrokenSets`, défaut **true**) — *true* : un set requis partiel
  (ex. un seul `2pc`) laisse n'importe quelle pièce remplir les slots armor libres (comportement
  legacy). *false* : chaque pièce d'armor doit compléter un set (2pc/4pc) → le solver élague en
  plus les pièces set-less/non-formables du pool et rejette les builds à singleton au leaf.
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
- Slider **Top %** : `5..100`, **défaut 30** (plus 100). Pilote la phase 3 prune.
  À 100 = exhaustif. Sans priorité, il mord quand même en SOLVE CP (auto-prune
  CP-pondéré, phase 3b) ; en SOLVE Score il faut une priorité.
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

Au-dessus de la gear band, deux boutons d'action sur le build sélectionné :
- **Equip build** — applique les pièces au héros en réécrivant le snapshot capturé
  (`equipPieces`, popup de confirmation, jamais d'écriture vers le jeu).
- **+ Worklist** — pousse le **diff par slot** (slots changés only) sur l'onglet **Worklist**
  (`screens/WorklistScreen.tsx`, storage `lib/storage/worklist.ts`) : une file inter-héros où
  chaque changement est une ligne cochable + un **Apply locally** (même `equipPieces`). États
  *applied / stale / conflict* **dérivés live** de l'inventaire (rien n'est figé) ; **auto-prune à
  chaque recapture** (`reconcileWorklist` retire les changements faits + entrées vidées). Désactivé
  quand aucun slot ne change (`equipPlan.moving === 0`).

Equip / Unequip **vers le jeu** restent absents (nécessitent une API jeu inexistante).
Le bouton **Optimize →** vit côté onglet Builds (ouvre le Builder sur le héros).

### FilterFooter (fixed en bas)
- Chips par slot avec **hit/total (%)** — alimentés par `poolSizes` du premier progress event de chaque worker.
- **P** : permutations totales explorées (somme across workers).
- **S** : permutations qui ont passé tous les filtres (scoring).
- **Results** : taille du top-N retourné.
- Indicateur `solving…` (cyan, animé) pendant un run ; une fois fini, **⏱ durée**
  du dernier solve (wall-clock fan-out→merge, `< 1 s` en ms sinon en s) — l'orchestrator
  remonte `durationMs` via `onResult`. Sert à jauger la vitesse du solver d'un coup d'œil.
- **⚙ N workers** : taille du pool de recherche résolu.

### ResultsTable
Heatmap rouge-vert par colonne (min/max relatifs au result set actuel). Colonnes :
sets, 8 stats principales, ratings (`TABLE_RATINGS`), **Score**, **Upg**, actions
(`Upg` = nb de slots différant du loadout actuel, triable + filtrable). Tri par clic
sur l'en-tête (null → desc → asc → null). Menu **Columns** (show/hide colonnes, persisté
`gs.builder.cols`) ouvrable par le bouton de la toolbar **ou par clic-droit sur n'importe
quel en-tête** (`ColumnsMenu` contrôlé, `onContextMenu` sur le `<tr>` d'en-tête). Click sur
une ligne → la `BottomGearBand` affiche les 8 pièces. État `solving…` / erreur / **état vide explicite** (un `emptyReason`
dérivé de `poolSizes` liste les slots tombés à 0 pièce après filtres).

### BottomGearBand
8 cartes (mirror compact de l'inventaire) — une par slot. Chaque carte montre nom,
enhance level, icône slot, main stat, subs (avec ticks). En plus :
- **Talisman / EE** : l'allocation de gemmes recommandée par le build (stat + valeur,
  badge **swap** si elle diffère des gemmes socketées).
- **Stats projetées** : si le mode Reforge ≠ Off, main + subs affichés sont la projection
  (`projectPieceForReforge` re-simulé côté main thread) + badge **classic** / **ascended**.
  La carte montre aussi l'enhance projeté (`+15 · ascended`) puisque la pièce projetée
  porte son `enhanceLevel`/`ascended` cible, le **passif de singularité** projeté (ascended), et
  un badge cyan **`+N`** par sub indiquant les ticks de reforge ajoutés par la projection
  (delta vs la pièce capturée).
- **État d'équipement** : badge par carte — 🟠 portrait + nom si la pièce est équipée sur un
  **autre héros** (l'appliquer la lui retire), 🟢 `equipped` si déjà sur le héros courant, `free` sinon.
- **Diff par slot** : une carte dont la pièce **diffère du loadout équipé** (même définition que
  `upg`) porte un **liseré cyan** + une ligne `← <pièce remplacée>` (ou `+ new slot` si le slot
  était vide). La pièce courante par slot vient de `currentLoadout` (Map slot→pièce équipée). Le
  header de la band résume le tout : **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`,
  `currentCp` = `calcBattlePower` du loadout équipé, calculé dans `composition`).

Em-dash quand aucun build n'est sélectionné.

---

## 5. Gems — sous-solver greedy

**Pool** : multiset des `gemSlots[]` non-nuls de tous les Talismans + EE de l'inventaire (les gems sont swappables in-game, donc on agrège globalement).

**Scoring** : pour chaque gem, `score = priority × (value / ROLL_NORMS)`. Normalisé pour la comparaison cross-stat. Triés desc. **En SOLVE CP sans priorité utilisateur**, la « priority » passée n'est pas vide mais les **poids CP** (`cpStatWeights` : ΔCP d'un bump ROLL_NORM de chaque stat, évalué au build courant). Sinon (rank par `value/norm` brut), l'allocateur préférait des gemmes dmg-reduce/flat (grosse magnitude, ~0 CP) aux gemmes atk/crit/pen → un solve CP pouvait rendre **moins** de CP que le build équipé. Une stat déjà à son cap CP (ex. CRC ~100 %) reçoit un poids ~0.

**Allocation (défaut, fast path)** : greedy, K = `talismanSlots + eeSlots` (4 ou 5 selon `enhanceLevel`). On prend les K premiers gems avec `score > 0`. Pré-calculé **une fois par variant talismanSlots** (4 ou 5) dans `prepareContext` — pas de re-calcul dans la hot loop.

**Cap-reaching CHC (slow path, par combo)** : quand l'utilisateur priorise `crc` **et** le pool a des gems crit (`wantCritCap`), l'allocation est **étagée** (`allocateGemsReachingCap`) :
1. **Étage 1** — dépenser des gems crit pour **atteindre** le cap CHC à 100 % (en priorité, même si l'atk score plus haut), overshoot ≤ un gem 3 %.
2. **Étage 2** — remplir le reste **par priorité** (en sautant tout gem crit, désormais gaspillé).

Le pré-gem CHC du combo est récupéré depuis `fs.crc − defaultCrcGem` (le crit rate est purement additif). On ne **recompose** que si le delta cap-aware diffère du greedy par défaut (`gemDeltaEquals`) — souvent identique quand les gems crit rankent déjà haut. Le cas sans priorité crc (ex. fallback SOLVE CP) garde l'ancien anti-overshoot (`allocateGemsCapped`, déclenché seulement si `fs.crc > 102`).

**Pré-agrégation** : la contribution gem est convertie en `{flat: {atk: 5, ...}, pct: {atkPct: 24, ...}}`. La compose ajoute juste ces deltas aux buckets après l'agrégation des pièces. Évite `resolveStat` × 10 gems × N combos.

**Fallback `null`** : en **SOLVE Score sans priorité**, la priority est vide (aucun gem n'a
un `score > 0`) → delta `null` → pas de `gemOverride` → la compose utilise les **gems
actuellement socketés** (via `piece.subs`). Sans intention utilisateur on respecte l'état du
joueur. (SOLVE CP n'y tombe plus : il utilise les poids CP ci-dessus.)

---

## 6. Heuristique Top-% — pourquoi c'est là

Inventaire typique : 150 pieces par slot × 7 slots = `150^7 ≈ 10^15` permutations. Inacessible.

Top-% prune ramène ça à `(150 × pct/100)^7` :
- 100% → 10^15 (inutilisable)
- 50% → ~10^13
- 30% → ~10^11
- 10% → ~10^8 (utilisable, 1-5s)
- 5% → ~10^6 (très rapide, mais peut zapper le build optimal)

Le hint du panneau le dit explicitement : *"Heuristic — too low a Top % drops optimal builds"*. C'est un trade-off pure recall vs vitesse. **Attention** : un Top% en *pourcentage* ne borne pas le **produit** — sur un vrai compte, 30 %/slot laisse encore ~`10^10` combos (mesuré : 1,25 G post-prune-30 %, toujours >100 s). C'est pourquoi le **mode CP sans priorité** ne dépend pas du % brut mais d'un **budget combos absolu** (phase 3b) qui borne `∏` directement → solve en ~1 s quel que soit le compte.

Avec `priority` vide : en **SOLVE Score** le prune est sauté (score 0 partout, ranking arbitraire → on garde tout). En **SOLVE CP**, plus de short-circuit : l'auto-prune CP-pondéré + budget combos (phase 3b) rend « max CP » jouable sans rien tuner.

**Garde-fou** : la BuilderScreen estime le cartésien (`∏ poolSizes`, post-prune ; les `poolSizes` arrivent dès le départ du solve, avant la recherche réelle). Au-dessus de `CARTESIAN_WARN` (50 M), un bandeau avertit que le solve sera lent et propose de baisser Top% / poser une priorité / exiger un set. Non-bloquant.

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

4b. **Accumulateur de buckets incrémental** — les 6 pièces invariantes
    (weapon..accessory) sont agrégées **1× par itération accessory**
    (`aggregatePrefixBuckets`) ; le talisman loop clone ce prefix et n'ajoute que
    talisman + EE + gems + sets (`computeFinalStatsFromPrefix`). **Bit-identique**
    au re-sum complet (ordre de slot préservé, prefix = somme partielle clonée),
    validé par un test d'équivalence dédié + le 0-diff end-to-end.

5. **Gem delta pré-agrégé** — la contribution gem ne se calcule qu'**une fois
   par variant talismanSlots** au lieu de N combos × 10 gems × resolveStat.
   Gain massif sur le hot path.

6. **Mid-tree set pruning** — `req-4pc Sharp` avec 1 helmet Sharp : on prune
   sans descendre dans armor × gloves × boots. Énorme sur les recherches
   sets-restreintes.

7. **CP paresseux en SOLVE** — CP est ~20× plus cher qu'un cheap rating. Calculé
   seulement pour le top-N final (~1000 vs des millions). En **SOLVE CP** (CP =
   sort key, calculé par combo), deux mitigations : (a) **évaluateur CP préparé**
   (`makeCpEvaluator`) — bonus constants capturés une fois, plus d'allocation
   `CpArgs` ni de re-dérivation par combo (bit-identique) ; (b) **cheap ratings
   différés** au finalize (top-N) quand aucun filtre de rating n'est posé — le
   heap trie par CP, donc les 8 produits ratings ne servent qu'à l'affichage.

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
- **Perf hot-path** : le rebuild des set bonuses par talisman est hoisté (§7.10), les
  6 pièces invariantes ne sont plus re-sommées par talisman (accumulateur de buckets
  incrémental bit-identique, §7.4b), et la table de résultats est virtualisée
  (`@tanstack/react-virtual`). Le **nombre de combos** est attaqué côté pool :
  défaut Top% 30 + auto-prune CP-pondéré (phase 3b) + dominance prune (§3) +
  set-prune (§armor). Reste optionnel : borne CP par upper-bound (branch-and-bound
  exact) — gain incertain vu `topK = 1000`/worker, à valider par un profilage sur
  vrai compte (footer ⏱ pour mesurer).
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
│   ├── composeBuild.ts            ← computeFinalStats(+FromPrefix) + aggregate(Gear/Prefix)Buckets (+ GemOverride)
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
7. **Comparaison régression** : SOLVE avec priority vide + Top 100% + Keep current + **Reforge Off**
   (le défaut Classic projette à +10 → ne matcherait pas la card) → le top-1 doit avoir les mêmes
   `FinalStats` que la card du même héros dans l'onglet Builds (à la réallocation gems près, qui en
   mode priority vide est fallback sur les gems actuels donc ✓ équivalence stricte attendue).
8. SOLVE CP → top-1 doit avoir le plus gros CP affiché. Comparer à un solve brute-force séparé sur petite slice.
