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
  │     │  phases 1-3 : precomputeContext (main thread, 1×)
  │     │               précompute héros + pools + prune budget
  │     │  fan-out (postMessage, précalcul broadcast via req.precomputed)
  │     ▼
  │  ┌─────────────────────────────────────────────┐
  │  │ solver.worker.ts × W   (parallèle, sans IPC)│
  │  │   └─ engine.ts                              │
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
seulement) quand aucun filtre de rating **hors Score** n'est posé (un band Score ne
désactive pas le différé — le Score dérive des `FinalStats`, pas des ratings) —
symétrique au CP-lazy de SOLVE, puisque le heap est trié par CP, pas par les ratings.

Le filtre CP utilisateur (`cp min/max`) est appliqué **dans la boucle** dès qu'il
est actif — y compris en mode SOLVE, où CP est alors calculé par combo. C'est requis
pour la justesse : différer le filtre à `finalizeBuilds` laissait le heap se remplir
du top-K **par score** puis retirait a posteriori les builds hors-CP, évinçant des
builds valides classés juste hors top-K (perte de recall / sous-retour). Idem pour le
filtre `upg` (résolu en amont depuis le loadout équipé, appliqué in-loop). Les re-checks
au finalize deviennent des no-op idempotents.

---

## 3. Pipeline détaillé

Les phases 1-3 (`precomputeContext`) tournent **une fois sur le main thread**
(orchestrator) et le résultat est broadcast aux workers via
`SolveRequest.precomputed` — un worker ne les recalcule (fallback, même code)
que si le précalcul est absent. Les phases 4-6 tournent **dans chaque worker,
sur son chunk**.

### Phase 1 — Précompute hero
- `composeCharStats(hero)` → `baseline` (no-gear stats) + `scaling` (per-axis CalcFinalStat ingredients pour ATK/DEF/HP/EFF/RES). Réutilisé pour chaque combo.
- Récupère l'EE équipé sur le héros (fixe — le solver ne l'énumère pas).
- Skills du perso (first/second/ultimate/chainPassive) pour CP.

### Phase 2 — Pools par slot
Pour chaque slot ∈ {weapon, helmet, armor, gloves, boots, accessory, ooparts} :
filtre les pièces de l'inventaire :
- `g.slot === slot`
- exclu selon `equippedScope` (`none`/`lower`/`all`) si équipé sur un **autre** héros — `lower` gate via `isLowerPriority(heroPriority, …)` (cf. § Options, Equipped items). Le « propriétaire » est le **claim worklist s'il existe, sinon `equippedBy`** : une pièce réservée par le build en attente d'un autre héros (`worklistClaims`, uid → héros réclamant, changes non appliqués seulement) est traitée comme équipée sur lui — le scope + rank s'appliquent aux réservations comme au gear réel
- exclu si `g.uid ∈ excludedPieceUids` (exclusion **globale** account-wide, clic-droit Inventory — vérifié en premier)
- exclu si `g.equippedBy ∈ excludedHeroes` (idem via le propriétaire effectif)
- exclu si sous le **plancher « Maxed only »** (`meetsMaxedFloor`) : le toggle = **zéro extrapolation** — le plafond de chaque pièce dans le mode reforge (`pieceReforgePlan`, celui de la projection) devient son plancher d'investissement (pièces **déjà** à leur plafond ou mieux, notées sur leurs vrais rolls, projection sautée). Off → aucun gate ; 6★ `unique` : +10R6 → enhance ≥ 10 & reforges ≥ 6 ; +10R9 → ≥ 10 & ≥ 9 ; +15R9 → ≥ 15 & ≥ 9 ; pièce qui ne s'élève pas (sous 6★, ou 6★ non `unique`) : +10 & son propre budget (son étoile, 6 pour une 6★) quel que soit le mode ; pièce sans étoile (absente du contrat) : plancher du mode. Talisman : plancher enhance seul (pas de reforge sur gemmes), borné à son plafond +10 (`enhance.maxEnhanceLevel` : pas de singularité, un plancher +15 vidait le pool)
- exclu si `classLimit` ≠ classe du héros
- exclu si l'une de ses mains d'option (hors `combatOnly`) est une **main exclue** du slot (`mainExcludes`), avant le test des acceptables ; le nombre de pièces ainsi écartées remonte dans `poolSizes[slot].mainExcluded`
- exclu si **main pick** actif pour ce slot et qu'aucune de ses mains d'option n'est dans les picks
- exclu si **effect chip** (weapon/accessory) marqué `excluded` ; ou marqué `required` et le `setId` de la pièce (identité d'effet `UniqueOptionID`) ne match pas — la comparaison est **délibérément** sur `setId`, pas sur `effectIcon` (des effets distincts partagent une icône, ex. la famille Recklessness)
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
surplus va aux gros slots armor). Budget de référence `COMBO_BUDGET = 8 M` à Top% 30 (≈ 1-2 s de
solve — Score est plus coûteux par combo que CP), **scalé par le slider Top%**
(`budget = 8M × topPct/30`, ~16 M au défaut 60 ; `topPct = 100` rebascule en exhaustif). Talisman
inclus, l'**EE jamais** (pas de pool EE — pièce équipée unique, toujours
exempte) ; slots `keepCurrent` exemptés.

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
sont ignorées (pas sur la feuille de stats visée), comme un main en % sur un axe sans
variante % (le −30 % SPD de Phantasm : pas de norme de roll, `isPctRollWithoutNorm` de
`statRegistry.ts`, au lieu d'être compté −1,5 jet comme −30 SPD plats). Même règle en (c).

**b) SOLVE CP sans priorité** — `cpEval` : chaque candidat classé par **le CP qu'il
donne posé dans le build actuel du héros** (autres slots = pièces équipées), donc la
chaîne crit/pen/spd qui scale l'ATK est réaliste. **Forme *soft* du dominance prune**.
**Pin** de la pièce équipée → le solve ne rend jamais un CP < l'équipé. **Limite
assumée** : pièce notée *standalone* → un membre qui ne brille qu'en complétant un
set peut être sous-classé ; monter le Top% ou exiger le set.

**c) SOLVE (Score) sans priorité** — `magnitudeScoreOf` (magnitude brute des rolls) :
pas d'objectif (le score serait 0 partout), mais le produit **doit** rester borné
(sinon cartésien complet) → on garde les pièces les mieux rollées par slot.

Protection des sets requis : pour chaque set `req-2pc`/`req-4pc` non représenté
dans la slice budget, `keepTopN` ré-ajoute hors budget **son seul meilleur
membre** (au score) — identique pour les trois clés. Ré-ajouter *tous* les
membres (ancien comportement) refaisait exploser le budget. Le **pin** de la
pièce équipée vaut pour tout SOLVE CP, branche (a) avec priorité comme branche (b) :
le classement change, pas la garantie « jamais sous le CP équipé ». SOLVE (Score)
n'épingle rien.

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
   Dmg/Mcd sont multipliés par le **facteur du meilleur skill** du héros
   (`meta.bestSkill` → `ctx.skillFactor`, ×1 si absent), DmgS/McdS par le **facteur moyen
   par tour de sa rotation** (`meta.rotation` → `ctx.turnFactor`, meilleur skill si absente)
   — constantes par solve, le classement ne change pas (cf. reference.md § 2.3).
   Pour un héros **`noCrit`** (`meta.noCrit`, propagé dans le contexte), `computeCheapRatings`
   reçoit `noCrit=true` → `pCrit=0` (le terme CHD disparaît) et `mcd` retombe sur le hit
   non-crit : la CHC/CHD ne gonfle plus ses ratings. CP reste inchangé (miroir in-game fidèle).
4. **Score** : `Σ priority × (final / STAT_NORMS) × 100`, **non arrondi** (clé de tri ; la table
   l'arrondit à l'affichage seulement — arrondi, deux builds proches tombaient ex aequo).
5. **Rating filter** : pareil que stat filter, sur ratings + score.
6. **CP / upg** : CP est calculé en SOLVE CP, OU en SOLVE dès qu'un filtre CP est posé
   (le filtre rejette alors tôt). Si un filtre `upg` est posé, il est aussi évalué ici
   (depuis le loadout équipé pré-résolu). Les deux filtrent **avant** le push, donc le
   heap ne contient que des builds valides.
7. **Push** dans un min-heap fixed-size (`TopKHeap`, K=1000 par défaut) keyed par `score` ou `cp` selon mode,
   ex aequo départagés par `pieceUids` (`compareBuilds`, le même ordre qu'au merge : un même résultat
   quel que soit le découpage entre workers). Le heap plafonne aussi les **variantes de talisman** :
   au plus 3 builds par signature 6-gear (`TALISMAN_VARIANTS_KEPT`), un build dont la signature est
   pleine ne remplace que la pire de ses variantes — sinon le top-K d'un worker se remplissait d'un
   même gear × talismans et perdait des candidats distincts avant le merge.
   Si **Allow broken sets** est off, le worker compte aussi les loadouts armor rejetés par cette
   seule règle (`brokenSetsRejected`).

### Phase 6 — Finalize (worker side)
- SOLVE CP : top-K déjà trié sur CP, on retourne tel quel.
- SOLVE : on calcule CP pour chaque build du top-K **pour l'affichage** (lazy) quand aucun
  filtre CP n'était actif ; sinon CP est déjà porté par le build. `upg` est (re)calculé pour
  la colonne. Les filtres CP/upg ayant déjà été appliqués in-loop, les re-checks ici sont
  des no-op idempotents.

### Côté orchestrator
- Reçoit `{builds, permutations, searched, brokenSetsRejected}` de chaque worker.
- Merge des top-K en un buffer global, sort final (`compareBuilds`), **collapse des variantes talisman**
  (`collapseTalismanVariants` : max 3 builds par signature 6-gear — les gemmes étant une allocation
  globale, les talismans d'un même gear ne diffèrent quasi que par leur main et noyaient le top-N ;
  chaque heap applique déjà le même plafond, ce passage couvre une signature répartie sur plusieurs
  workers quand le talisman est l'axe de partition), slice top-N (1000 par défaut), forward à React.
- Solve complet vide, aucune combinaison atteinte (`permutations` 0) et des loadouts rejetés par
  « Allow broken sets » off → `onResult` porte la cause `"brokenSets"` (`SolveEmptyCause`), que la table
  affiche (cf. § ResultsTable).
- **Erreur d'un worker** (message `error` ou crash `onerror`) : tous les workers sont stoppés et les
  builds des workers déjà finis **jetés** — ils ne couvrent que leurs slices et s'afficheraient comme
  le résultat de toute la recherche. `onError` seul, pas d'`onResult` : la table reste vide sous l'erreur.
- Aggregate `permutations` + `searched` pour le footer (somme des compteurs per-worker).
- Les événements progress sont **throttlés globalement (~10 Hz)** avant `onProgress` — chaque worker
  poste ~toutes les 100 ms, donc un pool de 30 workers poussait jusqu'à ~300 setState/s. Les compteurs
  sont cumulatifs (rien n'est perdu en sautant des émissions) et le flush final émet les totaux exacts.
- Porte aussi un **worker d'estimation dédié** (hors pool) pour le garde-fou pré-solve — cf. § Top-%.

---

## 4. Les panneaux de l'UI

Les panneaux du haut (Hero, Stats, Sub tick value / Damage info, Options, filtres,
priorité, mains, sets, effets) + sidebar Actions/Library + footer fixé. Chaque panneau
de filtre pousse son state dans le reducer `SolverFilters` ([builderFilters.ts](../apps/renderer/src/lib/solver/builderFilters.ts), branché par [BuilderScreen.tsx](../apps/renderer/src/screens/builder/BuilderScreen.tsx)).

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
le « de combien », pas juste le sens. La ligne crit lit la somme brute (`critRawOf` =
`critRateUncapped ?? critRate`, `screens/builder/critCell.ts`) pour le Δ et le tint, et au-delà
de la borne de 100 affiche « 100% ⁺42 » (exposant ambre, `critCellParts`) de chaque côté, avec
en tooltip la valeur brute et le gaspillage (`critCellTitle`, voir **Overcap** plus bas).

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
- **Reforge** (`reforgeMode`, **4 états**, **câblé**, **défaut +10R6**) — projette chaque pièce
  du pool vers un plafond endgame **avant** le prune par budget de combos (phase 3) (`projectPieceForReforge`). Défaut
  `classic` (+10R6) car c'est la norme endgame ; `Off` noterait le gear capturé (+0/+9), trompeur.
  Libellés = enhancement + nombre de reforges (R) :
  - **Off** : gear tel que capturé.
  - **+10R6** (`classic`) : projette à **+10 non-ascended** (main re-scalé via `projectMainToCeiling`,
    + substats max-rollés à **6 ticks**).
  - **+10R9** (`ascended10`) : **exactement le même plafond +10 que +10R6** mais **9 ticks** — l'ascension
    (50 chips) donne les **+3 reforges** et débloque le +15, sans rien d'autre. **Pas de passif**, main stat
    inchangé. Le palier rentable : on saute le coûteux +10→+15 (chips à 90/80/70/60/40 %).
  - **+15R9** (`ascended`) : projette à **+15 ascended** (override le flag réel ; **9 ticks**) **+ le passif
    de singularité inconditionnel** (`addProjectedSingularity` : DMG+ 50 % arme/accessoire, DMG- 25 %
    armures — meilleure valeur de la table). **Passif et steps de main +11→+15 = +15 uniquement.** Une pièce
    déjà ascended garde son **vrai roll**. Ne *downgrade* jamais une pièce déjà au-dessus du plafond.
  **Chaque pièce s'arrête à son propre plafond** (`pieceReforgePlan`, min du mode et de la pièce) : seule
  une **6★ `unique`** ascende (`CItem.IsSingularityActivate`) ; une pièce **sous 6★, ou une 6★ non
  `unique`**, s'arrête à **+10**, à **son nombre de reforges** (`maxReforgesOf` : l'étoile sous 6★, 6 pour
  une 6★ — 9 seulement pour une 6★ `unique` dans un mode qui ascende), **sans passif**, quel que soit le
  mode. Une 5★ en +15R9 reste donc +10 R5. Les labels des modes sont le plafond d'une 6★ `unique`.
  Ticks : par la priorité ; **sans priorité, par poids CP** (`reforgeTickWeights`, évalué sur le build
  équipé du héros) — renvoyés avec le contexte (`onResult`) et sauvés avec le build, pour que les gear
  cards reprojettent les mêmes ticks.

  Le re-scale du main repart de la valeur +0 de la table (`rawBase`, posée par le parseur) et
  refait la chaîne float32 du jeu (`scaleMain`) — mêmes chiffres qu'en jeu (test `projectMainToCeiling` :
  240 → 1380) ; une pièce sans `rawBase` retombe sur le ratio des multiplicateurs.
- **Maxed only** (`onlyMaxed`) — **zéro extrapolation** : le plafond de chaque pièce dans le mode
  reforge devient son **plancher d'investissement** et la projection est **sautée** (pièces notées
  sur leurs vrais rolls, y compris sur les gear cards — le contexte d'affichage est snapshoté en
  `disable`). Planchers (`maxedFloorOf`/`meetsMaxedFloor`, sur `pieceReforgePlan`) : Off → aucun
  (pièces telles quelles, peu importe le niveau) · 6★ `unique` : +10R6 → enhance ≥ 10 & ≥ 6
  reforges · +10R9 → ≥ 10 & ≥ 9 · +15R9 → +15 & ≥ 9 · pièce qui ne s'élève pas (sous 6★, ou 6★ non
  `unique`) : +10 & son propre budget (une 5★ +10 R5 est maxée), quel que soit le mode · pièce sans
  étoile (absente du contrat) : plancher du mode, une pièce inconnue n'est pas maxée par défaut. « Ou mieux » garde
  ses meilleurs rolls (une +15R9 dans un solve +10R6 n'est pas redescendue au plafond +10). Talisman :
  enhance seul, +10 au plus (son plafond) ; l'EE du héros n'est jamais filtré. (Remplace l'ancien cut plat `enhanceLevel < 15`,
  aveugle au mode.)
- **Transistone potential** (`rerollPotential`, toggle de la toolbar à côté de Maxed only, **défaut
  off**) — projette le potentiel de reroll Transistone (`lib/solver/reroll.ts`, règle lue dans le
  client en tête du module) : une 6★ Légendaire à 4 sous-stats **sans ligne au palier 4** monte UNE
  ligne jusqu'au palier de base 4 (+1 à +3 ticks, reforges conservées, valeur plafonnée à LV6) ; une
  pièce qui a **déjà** une ligne au palier 4 n'en reçoit pas de deuxième mais monte une ligne jusqu'au
  palier 3 (4/4/3/2 → 4/4/3/3 ; 4/3/3/3 et 4/4/3/3 n'ont rien à gagner). La
  ligne : la sous-stat de plus forte priorité du héros (jamais une priorité négative), sans priorité
  ou à égalité la plus grande valeur normalisée (`ROLL_NORMS`). Appliqué par
  `projectPieceForReforge` **avant** les reforges, avec ou sans mode reforge, **jamais sous Maxed
  only** ; snapshoté dans le contexte d'affichage et sauvé avec le build, les gear cards marquent
  la ligne (`T+n`, titre « Transistone »). C'est un plafond : en jeu le palier 4 est un tirage à 5 %.
- **Equipped items** (`equippedScope`, **défaut ≤ Lower**) — quelles pièces équipées sur
  d'**autres** héros le solver peut piocher. Défaut `lower` : seulement les héros **strictement
  moins** prioritaires (auto-rangés par CP à la capture) → ne déshabille jamais un héros
  égal/supérieur. Sans ranking, dégrade en own+free (`isLowerPriority` ∞>∞ = false). `None` = own
  + free, `All` = n'importe quelle pièce équipée (l'ancien défaut, vol silencieux possible).
  Le scope s'applique au **propriétaire effectif** = claim worklist ?? `equippedBy` : une pièce
  réservée par le build en attente d'un autre héros compte comme équipée sur lui (une entrée
  appliquée/retirée libère ses claims — dérivés live par `worklistClaims`). Le **gem pool**
  (`buildGemPool`) suit la même règle.
  Les **presets du jeu** s'y ajoutent, quel que soit le scope (`presetHolds`, cf. reference.md §1.6) :
  les pièces d'un preset **verrouillé** ne sortent jamais, sauf pour « Optimize preset → » sur ce preset ;
  « Optimize preset → » ne prend pas les pièces d'un preset de rang égal ou meilleur. Le Builder le dit
  dans la Library (« Optimizing preset ‹nom› (rank N) — … », perdu au changement de héros) et les gear
  cards nomment le preset d'où vient une pièce (« from preset ‹nom› »).
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
- Slider **Top %** : `5..100`, **défaut 60** (retour terrain : à 30 le vrai meilleur build se trouvait
  régulièrement juste au-delà de la tranche élaguée — budget ~16 M combos à 60, quelques secondes).
  Pilote la phase 3 prune ; `100` = exhaustif.
  À 100 = exhaustif. Sans priorité, il mord quand même dans les **deux** modes :
  auto-prune CP-pondéré en SOLVE CP (phase 3b), magnitude brute des rolls
  (`magnitudeScoreOf`) en SOLVE Score (phase 3c).
- Bouton **(clear)** : `dispatch({type: "clearPriority"})`.

Quand priority est uniformément 0 : le pool est **quand même pruné** (phases
3b/3c, même budget de combos). Côté gems : en SOLVE CP ils **sont réalloués**
par apport de CP marginal sur le build équipé (`allocateGemsByCp` — cf. § Gems) ;
seul SOLVE Score garde les gems actuellement socketés (pas de réallocation).

### Main stats
Trois lignes (Weapon / Accessory / Talisman). Chaque ligne montre les mains
réellement présents dans l'inventaire pour ce slot (chips icône). Click cycle
off → **allowed** (cyan, OR-allow : pièce exclue si aucune de ses mains ne match)
→ **excluded** (rose, ✕ : une pièce qui porte cette main ne rentre jamais dans le
pool, testée avant les acceptables) → off. Une main n'est jamais les deux à la fois
(`toggleMainPick` / `toggleMainExclude` effacent l'autre état). Cas d'usage : le
Talisman, dont les mains sont partagées dans l'équipe et ne se cumulent pas —
exclure ATK quand un coéquipier en porte déjà un. Le compteur du bouton « Mains »
compte acceptées + exclues ; le reco ne touche pas aux exclusions.

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

### Weapons, accessories & talismans
Trois groupes de chips effect-icon (Weapons / Accessories / Talismans), filtrés par class du héros (gated par `classLimit`), clés sur le `setId` de la pièce. Click cycle `off → required → excluded → off`. Tooltip : nom + (N owned) / desc T4 / state.
Un talisman conseillé par **Get preset** (`Talisman` de `/api/reco`, `translateReco.ts`) arrive, avec toute sa
famille (les talismans de même `name` dans `equipment.json` : le conseil désigne le 6★, les 4★/5★ ont leur propre
`setId`, `talismanFamilyKeys`), en état **`preferred`** (contour pointillé, badge `~`) : si au moins une pièce du pool talisman — après tous les filtres
d'`allow()` — porte l'un des `setId` préférés, le pool est restreint à celles-là ; sinon il reste ouvert, comme sans
conseil (jamais 0 build à cause d'un talisman préféré, contrairement à `required`). En « keep current », le talisman
porté reste verrouillé. Un clic le fait passer en `required`. Le statut de Get preset signale quand aucun membre
des familles conseillées n'est possédé.

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
- **+ Worklist** — pousse le **diff par slot** (slots changés only) **et les gemmes à sertir** sur le
  Talisman / EE du build (`gemAllocation` vs `gemSlots` de la pièce du build, `lib/worklist/changes.ts`) sur
  l'onglet **Worklist** (`screens/WorklistScreen.tsx`, storage `lib/storage/worklist.ts`) : une file
  inter-héros, **une entrée par héros** (un nouveau build **remplace** l'entrée du héros,
  `upsertWorklistEntry` ; le bouton dit alors « Replace in worklist »), où chaque changement est une ligne
  cochable + un **Apply locally** (même `equipPieces` ; les gemmes ne sont pas serties par l'app, elles se
  sertissent en jeu). États *applied / stale / conflict* **dérivés live** de l'inventaire (rien n'est figé :
  nom et main de la pièce lus dans le snapshot courant, `worklistTarget`, les `toName` / `toMain` stockés
  n'étant qu'un repli pour une pièce disparue ; une ligne *stale* — pièce mangée, vendue ou dissoute en jeu —
  dit « piece gone » en ambre, ne compte ni dans le badge ni dans les réservations, et un toast le dit au
  snapshot qui la perd ;
  une ligne gemme est *applied* quand sa pièce est sur le héros et porte assez d'exemplaires de la gemme,
  quel que soit l'emplacement — `toCount`, posé à la mise en Worklist : exemplaires gardés par la build + rang
  de la ligne parmi celles de cet id, le jeu sertissant dans le premier emplacement libre) ;
  **auto-prune à chaque recapture** et à chaque déplacement suivi en jeu (`reconcileWorklist` retire les
  changements faits + entrées vidées, un toast le dit). Désactivé quand rien ne change (ni pièce ni gemme).

Equip / Unequip **vers le jeu** restent absents (nécessitent une API jeu inexistante).
Le bouton **Optimize →** vit côté onglet Builds (ouvre le Builder sur le héros) ; **Optimize preset →**
(onglet Presets) y ajoute un patch de filtres (`initialPatch`, voir l'onglet Presets).

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
Heatmap rouge-vert par colonne (min/max relatifs au result set actuel, `computeColumnRanges`). Colonnes :
sets, 8 stats principales, ratings (`TABLE_RATINGS`), **Score**, **Swaps**, actions
(`Swaps`, clé `upg` = nb de slots qui changent par rapport au loadout actuel — pas des améliorations à faire ;
triable + filtrable). Tri par clic
sur l'en-tête (null → desc → asc → null). Menu **Columns** (show/hide colonnes, persisté
`gs.builder.cols`) ouvrable par le bouton de la toolbar **ou par clic-droit sur n'importe
quel en-tête** (`ColumnsMenu` contrôlé, `onContextMenu` sur le `<tr>` d'en-tête). **Clic-droit
sur une cellule** de stat, de rating ou de CP → menu « Min ≥ v » / « Max ≤ v » (v telle qu'affichée) :
pose la borne (`setStatFilter` / `setRatingFilter`, l'autre borne gardée), que les panneaux de filtres
montrent, et relance le solve dans le mode du dernier solve (`CellMenu`, `onThreshold`). Pas de menu sur
score, swaps, effets. **Crit au-delà de 100** : la cellule CHC affiche la valeur de la fiche (« 100% ») suivie
d'un exposant ambre « +42 » (`critCellParts` : `critRateUncapped − critRate`, `round1`), tooltip « Crit rate
142% raw — capped at 100% in-game, 40% wasted over the 102% tolerance » (règle `overcapOf` ; entre 100 et 102,
« within the 2% buffer ») ; la heatmap et le tri de la colonne lisent la somme brute (`critRawOf`), ce que dit
le tooltip d'en-tête (`statHeaderTooltip`) ; le menu de seuil garde la valeur de la fiche. Click sur une ligne → la `BottomGearBand` affiche les 8 pièces. État `solving…` / erreur / **état vide explicite** (un `emptyReason`
dérivé de `poolSizes` liste les slots tombés à 0 pièce après filtres, EE exceptée : un héros sans EE solve sans elle ;
un slot vidé (aussi) par une main exclue le dit, « (N dropped: main stat excluded) » ;
un « Filter » client qui ne garde aucun build affiche « No build passes the current filter. » ; aucun slot vide
mais « Allow broken sets » off a rejeté chaque loadout armor (cause `"brokenSets"` de l'orchestrateur) → la
table le dit et propose de le rallumer ou de monter le Top %). L'en-tête « N slots change » du build sélectionné
est relu sur l'inventaire courant (`buildDiff`), pas sur l'`upg` du solve : après Equip il tombe à 0. La colonne
Swaps (cellule et tri) et l'`upg` de l'entrée « + Worklist » lisent le même diff vivant.

### BottomGearBand
8 cartes (mirror compact de l'inventaire) — une par slot, dans l'ordre de l'écran d'équipement du jeu
(`GAME_GEAR_GRID`, partagé avec Builds et Presets) : grille 4 × 2 Arme | EE | Tête | Torse / Accessoire |
Talisman | Gants | Bottes dès 1616 px de fenêtre (quatre cartes `w-80` à côté de la colonne `w-72`), sinon
le même ordre passe à la ligne. Chaque carte montre nom,
enhance level, icône slot, main stat, subs (avec ticks). En plus :
- **Mode compact** (Settings › Solver › Compact result cards, `gs.builder.compactCards`, éteint par défaut) :
  cartes `w-64` — la grille démarre alors à 1360 px (4 × 256 + 3 × 8 + 288 + 8 + 16) —, en-tête =
  `compactName` (« EE », le nom du set pour une armure, le nom de la pièce sinon, sans « - [Singularity] »
  mais avec le dégradé), mains et subs en icône + valeur (niveau du sub en petit badge, base + reforges en
  `title`), effets sur une ligne tronquée (texte complet en `title`). Gemmes inchangées ; l'Inventaire et
  les tooltips (`GearDetailBody`) ne bougent pas.
- **Talisman / EE** : l'allocation de gemmes recommandée par le build (stat + valeur,
  badge **swap** si elle diffère des gemmes socketées).
- **Stats projetées** : si le mode Reforge ≠ Off, main + subs affichés sont la projection
  (`projectPieceForReforge` re-simulé côté main thread) + badge **+10R6** / **+10R9** / **+15R9**.
  La carte montre aussi l'enhance projeté puisque la pièce projetée porte son `enhanceLevel`/`ascended`
  cible, le **passif de singularité** projeté (**+15R9 uniquement**), et un badge cyan **`+N`** par sub
  indiquant les ticks de reforge ajoutés par la projection (delta vs la pièce capturée).
- **État d'équipement** : badge par carte — 🟠 portrait + nom si la pièce est équipée sur un
  **autre héros** (l'appliquer la lui retire), 🟢 `equipped` si déjà sur le héros courant, `free` sinon.
- **Diff par slot** : une carte dont la pièce **diffère du loadout équipé** (même définition que
  `upg`) porte un **liseré cyan** + une ligne `← <pièce remplacée>` (ou `+ new slot` si le slot
  était vide). Pièce proposée, pièce portée et « slot changé » viennent d'une seule fonction,
  `diffBuildVsLoadout` (`lib/buildDiff.ts`), que lisent aussi Equip et + Worklist. Le
  header de la band résume le tout : **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`,
  `currentCp` = `calcBattlePower` du loadout équipé, calculé dans `composition`). Le build est
  compté dans le mode de reforge des résultats, l'équipement tel qu'il est : hors `Off`, le libellé
  dit la base (`ΔCP +X vs equipped (build at +10R6)`, infobulle d'une phrase — `deltaCpLabel`,
  `lib/deltaCp.ts`), puisqu'un build identique à l'équipement y affiche un ΔCP positif.

Em-dash quand aucun build n'est sélectionné.

### Onglet Presets
Onglet entre Builds et Builder (`screens/presets/PresetsScreen.tsx`), une carte par preset d'équipement du
jeu (`Inventory.presets`, jusqu'à 30) : numéro, nom, favori ★, les 7 pièces (weapon, accessory, helmet,
armor, gloves, boots, talisman — l'EE n'en fait **jamais** partie, le slot EE de `ItemUIDList` est ignoré)
avec la tuile et le détail au survol de l'inventaire, et les **porteurs actuels** : héros dont l'équipement
hors EE est exactement le preset (`presetSignature`, la même règle que le nom de preset des cartes Builds).
Le modèle est pur et testé (`lib/presets/presetRows.ts` → `presetRows(inventory)`) : pièce absente de
l'inventaire (slot repris de la position sur le fil) et pièce présente dans **deux** presets (« shared with
<preset> » — deux presets peuvent jouer le même combat) sont marquées sur la tuile et dans un bandeau. Un
preset vide est listé replié.

**Disposition.** Les pièces suivent la grille 4 × 2 de l'écran d'équipement du jeu (`GAME_GEAR_GRID` de `design/tokens.ts`, en slots moteur) :
Arme, EE, Tête, Torse / Accessoire, Talisman, Gants, Bottes ; `PRESET_SLOTS` garde ses 7 slots (signature,
worklist, tests), seule la grille d'affichage change, et une pièce de slot inconnu suit la grille. La case EE
montre l'EE que porte aujourd'hui le héros de référence de la carte (`referenceUid`, ou le porteur unique
proposé, `eeOf`), atténuée, tooltip « EE isn't part of a preset — each hero keeps their own » ; sans
référence (ou sans EE), une case vide en pointillé. Au-delà de 1280 px (`xl`), une carte ouverte passe en
deux colonnes : la grille à gauche (largeur fixe), les lignes Reference / Associated à droite ; en dessous,
empilées. Les métriques d'une ligne de héros ont une largeur minimale (alignées d'une ligne à l'autre) et
s'étalent sur la place disponible. L'onglet Worklist n'a plus de largeur maximale : en-tête de transaction
pleine largeur, puis les cartes en grille à deux colonnes au-delà de 1280 px, chacune à sa hauteur.

**Ordre, filtre et tri par classe.** Les cartes suivent l'ordre de l'éditeur de presets du jeu :
`comparePresets` (core, `parse.ts`) reproduit le `CEquipPresetData.SortPreset` du client — type croissant
(les presets Master League après les autres), favoris d'abord, puis l'ordre du joueur
(`Preset.sortOrder`, lu dans `PresetOrderList` par `Num`, 0 sans entrée) décroissant, puis `num`. Le
`#num` reste affiché. La barre du haut porte les cinq chips de classe (`CLASSES` de `lib/homeStats.ts`,
multi-sélection), un sélecteur « Sort: In-game · Class » et « Clear ». La classe d'un preset
(`presetClasses`) vient de ses pièces (arme ou accessoire restreint à une classe, `GearPiece.classLimit` ;
deux classes différentes sont gardées toutes deux), à défaut du héros de référence, des porteurs, puis des
associés ; sinon elle est inconnue. Un filtre garde une carte dont l'une des classes est cochée et masque
les cartes vides ou de classe inconnue ; « Class » trie par la première classe dans l'ordre des chips
(cochées seulement quand un filtre est actif), inconnues à la fin, l'ordre du jeu dans une classe
(`arrangePresets`). L'icône de classe s'affiche à côté du nom ; la pastille ajoute « · K shown » quand
des cartes sont masquées. État du composant, perdu au changement d'onglet.

Un preset = la tenue d'**un perso de référence**, portée telle quelle par des **persos associés** qui se
règlent par les gemmes de leur propre EE. Les groupes se font à la main (sélecteur de héros ; un porteur
actuel unique est proposé comme référence), stockés app-local dans `gs.presetHeroes`
(`lib/storage/presetHeroes.ts`, par numéro de preset `{ referenceUid, associatedUids }`, un uid sorti du
roster ignoré à la lecture ; le blob entre dans l'export / import de sauvegarde, un preset qui a déjà des
héros ici gardant les siens). Pour la référence et chaque associé, `evaluatePresetFor`
(`lib/presets/evaluate.ts`) compose le héros avec les pièces du preset + **son** EE actuelle par
`computeFinalStats`, puis `computeCheapRatings` (facteurs de skill du héros) et `computeScore` avec sa
priorité ; la carte montre Score, Dmg et DmgS.

**Gemmes d'EE par héros.** Le Talisman et ses gemmes font partie du preset (partagés, jamais réglés par
héros) ; ce que chaque héros règle, ce sont les gemmes de **son** EE. `bestEeGemsFor`
(`lib/presets/eeGems.ts`) les choisit comme le moteur, pièces fixées : `buildGemPool` restreint aux gemmes
de l'EE du héros et à celles des Talismans / EE que personne ne porte (jamais celles des pièces du preset,
même libres, ni d'une pièce portée par un autre héros, ni d'une pièce libre que la Worklist réserve à un
autre héros — `worklistClaims`, la même valeur que le Builder et Builds —, ni du Talisman du héros, qui
part quand le preset arrive), `scoreGemPool` avec la priorité du héros (remplissage par gain de `dmg` sur la tenue,
`gemDmgGains`), `allocateGemsCapped` sur les seuls emplacements de l'EE (`gemSlotsOf`, CHC sans les gemmes
d'EE pour le plafond). Une gemme déjà sertie garde son emplacement (`alignToSockets`, le moins de lignes de
Worklist) et un emplacement laissé vide garde sa gemme (le jeu n'en retire pas seul). Pas de proposition
(null) sans priorité, sans EE ou sans gemme, ou quand le choix ne note pas plus haut que les gemmes telles
que serties. `evaluatePresetFor(…, eeGems)` compose alors l'EE avec ces gemmes par le `gemOverride` du
composeur (`eeGemOverride` : il saute les subs des deux pièces à gemmes, celles du Talisman y sont
replacées) ; la ligne dit « EE gems: <liste> », le score et la perte **avec** ces gemmes, et entre
parenthèses le score tel que serti quand il diffère.

**+ Worklist**, sur la ligne de la référence et de chaque associé : l'entrée du héros
(`presetWorklistFor`, `lib/presets/presetWorklist.ts`) = les pièces du preset qu'il ne porte pas
(`diffBuildVsLoadout`, la règle du Builder) + les lignes de gemmes de son EE (`worklistChangesFor`,
`gemAllocation = { talisman: [], ee }`), `mode: "preset"` (« Preset » sur la carte de la Worklist, sans
CP) ; `upsertWorklistEntry` remplace l'entrée du héros, toast « Added to / Replaced in worklist — <Nom> ».
Une pièce absente de l'inventaire est exclue, et le toast le dit. Bouton grisé quand il n'y a rien à
changer. **Optimize →**, à côté, sur la ligne d'un associé : ouvre le Builder sur le héros, comme une
carte de Builds.

**Optimize preset →**, sur la ligne de la référence : ouvre le Builder sur le héros avec un patch de filtres
(`presetOptimizePatch`, `lib/presets/optimize.ts`, pur) superposé à ses filtres mémorisés par
`mergePreset` (bornes et options gardées). Effets : le `setId` de l'arme, de l'accessoire et du talisman
de la tenue, en `required` (le talisman élargi à sa famille par `talismanFamilyKeys`, chaque clé
`required` — les mêmes effets, pas « preferred ») ; pièce absente de la tenue ou sans `setId` → slot
ouvert, une note. Sous-stats : au plus 5 clés de priorité, poids = max(reco, tenue) — la reco
(`fetchRecoForHero`, première build, `SubstatPrio` en 3/2/1 comme « Get preset »), la tenue par le nombre
de pièces (talisman et EE à part) qui portent la clé en sous-stat (4+ → 3, 3 → 2, 2 → 1) ; ordre poids,
puis présence dans la reco, puis nombre de pièces ; les autres clés hors du patch. Mains : celles de la
reco pour l'arme et l'accessoire. Sets : aucun plan (`setPlans: []` → un plan vide, sets ouverts ; « Get
preset » reste là pour la reco complète). Sans reco (404, erreur, hors ligne) : la tenue seule. Le
Builder reçoit le patch avec `initialHeroUid` (`initialPatch`) et le fusionne après avoir chargé les
filtres du héros — jamais sur ceux du héros sortant ; la ligne de statut dit « Optimizing preset #<num>
<name> — same weapon / accessory / talisman effects required, N priority substats from the outfit +
outerpedia's "<build>" reco. » (ou « from the outfit », suivi des notes).

**Priorité.** `presetPriorityOf` lit, dans l'ordre, la priorité du Builder de la session
(`gs.solver.heroFilters`, sessionStorage : gardée au rechargement de la fenêtre, perdue à chaque
lancement ; écrite quand le Builder quitte un héros pour un autre, si bien que le héros ouvert dans le
Builder compte avec le jeu qu'il avait la dernière fois qu'on l'a quitté, ou pas du tout), puis
`reforge.priority` de la build sauvegardée la plus récente du héros, puis rien ; une priorité sans poids
passe à la source suivante. La ligne dit « priority from saved build » dans le second cas. Un héros sans
build sauvegardée ni priorité laissée dans le Builder depuis le lancement n'a pas de score.
Un associé est comparé à sa **meilleure tenue connue** (`bestKnownFor` : sa build sauvegardée la plus
récente, re-notée avec la priorité **courante**, sinon son équipement actuel) : `loss = 1 − score(preset) /
score(best)`, affichée en % « vs saved build » / « vs current gear » ; au-delà du seuil (15 % par défaut,
Settings → Solver, `gs.solver.presetLossWarn`) la ligne passe en orange avec « <Nom> loses 23 % vs their
saved build ». Sans priorité : « no priority set for <Nom> — set one in the Builder », pas de score. Rien
n'est écrit vers le jeu.

**Overcap.** La feuille borne `critRate` à 100 (`computeFinalStats`) et garde la somme brute dans
`critRateUncapped` ; `pen` n'est pas borné. La règle des caps gaspillés vit dans `lib/overcap.ts` (pure,
partagée avec la règle 4 de `buildAdvice` et le tooltip crit du Builder, `critCellTitle`) : `overcapOf(finalStats)` → `{ key, label, value, cap, waste }`
par axe en dépassement — crit lu sur `critRateUncapped ?? critRate` contre 102 (tolérance contre la
résistance aux critiques), pénétration contre 100, `waste = round1(value − cap)` gardé si > 0 ;
`overcapText` écrit « Crit rate 142% — 40% wasted over the 102% cap ». `presetOvercap(evalPreset,
asSocketed)` (`lib/presets/evaluate.ts`) l'applique à l'évaluation affichée (gemmes d'EE proposées), sur la
référence comme sur les associés : un badge par axe, orange avec la ligne au ton d'avertissement (le même
que la perte) dès `OVERCAP_WARN_PTS = 10` points gaspillés (constante, pas un réglage), ambre seul en
dessous ; quand le dépassement est plus fort qu'avec les gemmes telles que serties, le tooltip du badge dit
qu'il vient des gemmes d'EE proposées.

---

## 5. Gems — sous-solver greedy

**Pool** : multiset des `gemSlots[]` non-nuls des Talismans + EE **éligibles** de l'inventaire (les gems sont swappables in-game). L'éligibilité (`buildGemPool`) reflète la règle des pools de pièces : gear du héros courant toujours inclus ; gear équipé sur un autre héros gated par `equippedScope` (`none`/`lower`/`all`) ; héros exclus jamais comptés. Sans ce gate, le solver proposerait des gems qui exigent de déséquiper le Talisman/EE d'un héros hors périmètre.

**Scoring** : pour chaque gem, `score = priority × (value / ROLL_NORMS)`. Normalisé pour la comparaison cross-stat. Triés desc. **En SOLVE CP sans priorité utilisateur**, la « priority » passée n'est pas vide mais les **poids CP** (`cpStatWeights` : ΔCP d'un bump ROLL_NORM de chaque stat, évalué au build courant). Sinon (rank par `value/norm` brut), l'allocateur préférait des gemmes dmg-reduce/flat (grosse magnitude, ~0 CP) aux gemmes atk/crit/pen → un solve CP pouvait rendre **moins** de CP que le build équipé. Une stat déjà à son cap CP (ex. CRC ~100 %) reçoit un poids ~0. Ces poids sont linéaires (un bump par stat, l'ATK % pesé sur un bump d'ATK plat) : ils ordonnent le pool, mais l'allocation SOLVE CP elle-même passe par le CP marginal (ci-dessous).

**Allocation (défaut, fast path)** : greedy, K = `talismanSlots + eeSlots` (4 ou 5 selon `enhanceLevel`). On prend les K premiers gems avec `score > 0`, puis, s'il reste des emplacements, les **gemmes de remplissage**. Un seul allocateur, `allocateGems`, rend la répartition affichée **et** le delta composé. Pré-calculé **une fois par variant talismanSlots** (4 ou 5) dans `prepareContext` — pas de re-calcul dans la hot loop.

**SOLVE CP sans priorité — par CP marginal** (`allocateGemsByCp`) : le CP n'est pas linéaire dans les stats (l'ATK compose, le CHC plafonne à 100 %), donc l'ordre des poids CP se trompait (cinq gemmes de réduction de dégâts, 34 643 CP, contre 3 ATK % + 2 réduction, 35 044, sur Ame). Les gemmes sont posées une à une : à chaque emplacement, celle qui monte le plus le CP du **build équipé** (la composition de référence de `cpStatWeights`) avec les gemmes déjà posées — réévalué après chaque gemme, plafonds crit compris. Candidates : celles de `pickOrder` (pas de priorité négative, pas de remplissage sous un `max`) ; les copies d'un même id ne sont pesées qu'une fois par étape ; à égalité, l'ordre de `pickOrder`. Une gemme sans apport de CP n'est posée qu'une fois les gemmes utiles épuisées, dans l'ordre de `pickOrder`. Coût : (emplacements × ids distincts) compositions, une fois par variant et par solve — pas par combo. Une priorité explicite en SOLVE CP garde l'allocation par priorité.

**Remplissage par la stat utile du héros** : avec une priorité partielle (ex. `{ critDmg: 3 }`), les gemmes d'une stat sans priorité valent `score = 0` ; elles ne sont plus jetées mais complètent les emplacements libres — une gemme posée n'enlève rien à la fiche, un emplacement vide si. Seules les gemmes de score **exactement 0** remplissent (une stat à priorité négative n'est jamais posée, ni une stat qui porte un `max` dans `statFilters` : elle ferait sortir le build de la bande). Ordre : le gain relatif de `dmg` qu'apporte la gemme (`gemDmgGains`, modèle de `computeCheapRatings` avec `dmgStat` / `dmgSec` / `noCrit` — celui du panneau « DMG per 1 % »), **pesé une fois par solve sur le build équipé** ; à gain nul (stat hors du modèle, CHC au cap, CHC/CHD d'un héros `noCrit`), par magnitude brute `value / ROLL_NORMS`. Porté par `ScoredGem.fill`, posé par `scoreGemPool` et lu par les quatre allocateurs (`pickOrder` : les priorités dans leur ordre, puis les remplissages) — la répartition affichée et le delta composé ne divergent pas. Inchangé : SOLVE Score sans aucune priorité (fallback `null` ci-dessous) et le score du build (`computeScore` ne lit que la priorité) ; en SOLVE CP sans priorité, les gemmes à poids CP nul remplissent par la même règle.

**Cap-reaching CHC (slow path, par combo)** : quand l'utilisateur priorise `crc` **et** le pool a des gems crit (`wantCritCap`), l'allocation est **étagée** (`allocateGemsReachingCap`) :
1. **Étage 1** — dépenser des gems crit pour **atteindre** le cap CHC à 100 % (en priorité, même si l'atk score plus haut), overshoot ≤ un gem 3 %.
2. **Étage 2** — remplir le reste **par priorité puis par remplissage** (en sautant tout gem crit une fois le cap atteint, désormais gaspillé — une gemme crit de remplissage suit le même saut).

Le pré-gem CHC du combo est récupéré depuis `fs.critRateUncapped − defaultCrcGem` (le crit rate est purement additif ; la somme non bornée, la CHC de la fiche étant bornée à 100). On ne **recompose** que si le delta cap-aware diffère du greedy par défaut (`gemDeltaEquals`) — souvent identique quand les gems crit rankent déjà haut. Le cas sans priorité crc (ex. fallback SOLVE CP, ou des gemmes crit de remplissage) garde l'ancien anti-overshoot (`allocateGemsCapped`, déclenché seulement si `fs.critRateUncapped > 102`) — lui aussi gated par `gemDeltaEquals` avant recompose.

Les deux allocateurs sont **mémoïsés par `(talismanSlots, preGemCrc)`** (`capAllocCache`, par run
`solveChunk`) : purs en (pool, slots, preGemCrc) avec pool + slots EE constants par solve, et le CHC
pré-gemme (compose `round1` moins une constante par variant) ne prend qu'une poignée de valeurs
distinctes sur des millions de combos — le slow path ne re-parcourt donc plus le pool par combo.

**Bornes minimales des filtres de stats (slow path, par combo)** : un filtre est une contrainte dure, une
priorité un ordre de préférence — les gemmes servent donc les `min` de `statFilters` **avant** la priorité.
L'allocation par défaut (ou cap-aware) ne regarde que la priorité : avec `atk ≥ 12 000` et une priorité
ailleurs, les gemmes ATK serties du héros cédaient la place et tous les combos tombaient sous la borne.
Seulement quand `passesSpecs` échoue, qu'une borne `min` est manquée et qu'un delta de gemmes a été
appliqué (`serveMinFilters` dans `solveChunk`) : manque par stat (`min − fs[key]`, arrondi vers le haut à
10 sur ATK / DEF / HP, 0,1 sur les stats en %, 1 ailleurs), le plus grand en proportion de sa borne
d'abord ; `allocateGemsServingMins` pose les gemmes de chaque stat manquée (tout le pool, même de score 0
ou négatif, plus gros gain d'abord) jusqu'à couvrir le manque — gain estimé par `rollGainOnSheet`
(`composeMultStat` avec la gemme seule moins sans elle sur ATK / DEF / HP / EFF / RES, la valeur ailleurs)
— puis le reste par la règle courante (cap CHC si `wantCritCap`, sinon `pickOrder` sans dépasser le cap) ;
recompose si l'allocation diffère, reteste. Échec (ou allocation inchangée) : reteste avec les gemmes
**serties** (compose sans `gemOverride`) ; si ça passe, le build est gardé avec une allocation vide
(« garde les gemmes de la pièce », comme sans priorité), sinon écarté. SOLVE CP sans priorité garde son
allocation par CP et n'a que ce repli. Mémo en trie de clés entières (`(talismanSlots, preGemCrc)` puis
`indice de spec × 2^21 + manque arrondi` par borne manquée) : une allocation par valeur distincte, pas par
combo ; les combos qui passent du premier coup ne paient rien.

**Pré-agrégation** : la contribution gem est convertie en `{flat: {atk: 5, ...}, pct: {atkPct: 24, ...}}`, rendue par l'allocateur avec la répartition (`GemAllocation`). La compose ajoute juste ces deltas aux buckets après l'agrégation des pièces. Évite `resolveStat` × 10 gems × N combos.

**Fallback `null`** : en **SOLVE Score sans priorité**, la priority est vide (aucun gem n'a
un `score > 0`) → delta `null` → pas de `gemOverride` → la compose utilise les **gems
actuellement socketés** (via `piece.subs`). Sans intention utilisateur on respecte l'état du
joueur. (SOLVE CP n'y tombe plus : il alloue par CP marginal, ci-dessus.)

---

## 6. Heuristique Top-% — pourquoi c'est là

Inventaire typique : 150 pieces par slot × 7 slots = `150^7 ≈ 10^15` permutations. Inacessible.

Le slider Top% pilote un **budget de combos absolu** (phase 3) : `budget = 8M × topPct/30`,
water-fillé par slot (`allocateComboBudget`) pour que `∏ keep ≤ budget` :
- 100% → exhaustif (short-circuit, aucun prune)
- 60% (défaut) → ~16 M de combos
- 30% → 8 M de combos (~1-2 s ; l'ancien défaut, référence de la normalisation)
- 10% → ~2,7 M
- 5% → ~1,3 M (très rapide, mais peut zapper le build optimal)

Le hint du panneau le dit explicitement : *"Top % scales an absolute combo budget (100 = exhaustive) […] Heuristic — too low a Top % drops optimal builds"*. C'est un trade-off pure recall vs vitesse. **Attention** : un Top% en *pourcentage par slot* ne bornerait pas le **produit** — sur un vrai compte, 30 %/slot laisse encore ~`10^10` combos (mesuré : 1,25 G post-prune-30 %, toujours >100 s). C'est pourquoi le budget borne `∏` directement, **quel que soit le mode** → solve en ~1-2 s quel que soit le compte.

Avec `priority` vide, le budget mord quand même : en **SOLVE Score** le ranking retombe sur la magnitude brute des rolls (`magnitudeScoreOf`, phase 3c) — résultats arbitraires faute d'objectif, mais le solve ne pend pas. En **SOLVE CP**, l'auto-prune CP-pondéré (phase 3b) rend « max CP » jouable sans rien tuner.

**Garde-fou** : la BuilderScreen estime le cartésien (`∏ poolSizes`, post-prune). L'estimation est
calculée **avant le clic** : un `precomputeContext` **debounced (250 ms)** tourne sur le **worker
d'estimation dédié de l'orchestrateur** (message `estimate`, hors cycle de solve, réponses périmées
droppées par id ; un échec rend `null` → bandeau masqué, jamais d'erreur pour un calcul de fond — sur
gros inventaire le précompute CP coûte 100 ms+, ce qui jankait le main thread à chaque édition de
filtre) quand héros/filtres/mode changent (`estimatePools`), **pour le mode du bouton SOLVE qui partira**
(le prune diffère Score/CP — d'où le `solveMode` remonté du split button). Pendant un solve, les
`poolSizes` **live** priment. Au-dessus de `CARTESIAN_WARN` (50 M), un bandeau avertit que le solve sera
lent et propose de baisser Top% / poser une priorité / exiger un set. Non-bloquant.

---

## 7. Optimisations clés (et pourquoi)

1. **Engine pur, sans React** (`engine.ts`, `gems.ts`, `ratings.ts`, `cp.ts`) — importable depuis n'importe quel worker ou test, pas de DOM ni de Suspense à se trimballer.

2. **Worker pool = `hardwareConcurrency − 1`** (`resolveWorkerCount`, override
   `gs.solver.workerCount` ramené à [1, min(cœurs, 64)] par `clampWorkerCount`, la même
   règle que la saisie de Settings) — un cœur laissé à l'UI, le reste à
   la recherche. L'ancien plafond fixe à 8 laissait les machines many-core
   sous-employées (8 workers / 32 threads = 25 % CPU) ; le clone postMessage
   inventaire/game par worker est un coût *fixe* par solve, amorti sur un solve
   de plusieurs secondes — scaler avec la machine est donc le bon défaut. Le log
   debug `solver` (`pool`) affiche le nombre résolu + `hardwareConcurrency`.

3. **Partition embarrassingly parallel** — chaque worker prend une slice du
   **slot le plus externe dont le pool est confortablement plus grand que le
   nombre de workers** (≥ 4×, pour des slices ⌈N/W⌉ équilibrées à ≤ 25 % près) ;
   fallback : le plus gros pool (l'ancien choix, meilleures slices quand rien
   n'est assez grand). Trancher un slot externe donne à chaque worker son
   sous-arbre disjoint ; trancher le slot **interne** (talisman — souvent le
   plus gros pool) faisait re-parcourir tout l'arbre weapon..accessory à chaque
   worker et re-payer ×W le travail hoisté par nœud accessory (set tallies,
   `computeSetBonuses`, `aggregatePrefixBuckets`), amorti sur ⌈N/W⌉ feuilles au
   lieu de N. Aucune comm inter-worker, merge final O(W × K). Le nombre de
   workers réellement sollicités est cappé à la taille du plus gros pool
   (`chunkCount = clamp(1, W, maxPoolHit)`) — inutile d'envoyer une slice vide à
   un worker quand le pool a moins d'items que de workers. Test d'équivalence
   union-des-chunks == mono-chunk dans `solveChunk.test.ts`.

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
   différés** au finalize (top-N) quand aucun filtre de rating hors Score n'est
   posé (un band Score ne compte pas — il dérive des `FinalStats`) — le
   heap trie par CP, donc les 8 produits ratings ne servent qu'à l'affichage.

8. **Cancel responsive via MessageChannel** — `solveChunk` est async, yield à chaque
   tick (~4096 unités de travail : feuilles talisman **+ nœuds boots**, pour que les
   sous-arbres armor massivement élagués — qui n'atteignent jamais la feuille —
   drainent quand même la file de messages) via un `MessageChannel.postMessage`
   round-trip (<1ms vs 4ms pour `setTimeout(0)` throttlé dans les workers). Cancel
   mid-solve se propage en ≤ tickEvery × t_combo ≈ 20-50ms.

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

13. **Alloc gem cap-aware mémoïsée par `preGemCrc`** — cf. § Gems : le slow path
    crit-cap / anti-overshoot ne réalloue plus par combo, il lit un cache keyed
    par `(talismanSlots, preGemCrc)` (une poignée de valeurs distinctes sur des
    millions de combos).

14. **Clé de heap en cache** — `TopKHeap` calcule `heapKey` une fois au push et
    stocke `{key, build}` ; chaque comparaison de sift lit un nombre au lieu de
    re-brancher sur le mode × log K.

---

## 8. Limites connues

(rien de bloquant aujourd'hui — voir [todo.md](todo.md) pour le backlog.)
- **Equip / Unequip vers le jeu** : absents — nécessitent une API jeu inexistante
  (le pipeline de capture est read-only pour l'instant).
- **Perf hot-path** : le rebuild des set bonuses par talisman est hoisté (§7.10), les
  6 pièces invariantes ne sont plus re-sommées par talisman (accumulateur de buckets
  incrémental bit-identique, §7.4b), et la table de résultats est virtualisée
  (`@tanstack/react-virtual`). Le **nombre de combos** est attaqué côté pool :
  défaut Top% 60 + auto-prune CP-pondéré (phase 3b) + dominance prune (§3) +
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
│   ├── overcap.ts                 ← overcapOf + overcapText (caps CRC 102 / PEN 100 gaspillés, Builds et Presets)
│   ├── presets/
│   │   ├── presetRows.ts           ← presets du jeu : pièces, porteurs (presetSignature), pièces absentes / partagées, classe, filtre / tri
│   │   ├── evaluate.ts             ← evaluatePresetFor + bestKnownFor + presetLoss + heroBases + presetPriorityOf + presetOvercap (onglet Presets)
│   │   ├── eeGems.ts               ← bestEeGemsFor : gemmes d'EE par héros, pièces du preset fixées
│   │   ├── presetWorklist.ts       ← presetWorklistFor : l'entrée Worklist d'un héros du preset
│   │   └── optimize.ts             ← presetOptimizePatch + presetOptimizeNote : « Optimize preset → » (effets requis, sous-stats prioritaires)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← bookmark de builds par héros (localStorage)
│   │   ├── presetHeroes.ts         ← référence + associés par preset (localStorage)
│   │   └── filterPresets.ts        ← snapshots de filtres par héros (localStorage)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── builderFilters.ts       ← SolverFilters + reducer du Builder + INITIAL_FILTERS + buildSolveFilters
│       ├── orchestrator.ts         ← pool de Web Workers, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap + simulateReforges
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + allocateGems + allocateGemsByCp
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower (reverse-engineered)
└── screens/
    ├── builder/
    │   ├── BuilderScreen.tsx       ← useReducer(SolverFilters) + mise en page + changement de héros + builds/presets/reco
    │   ├── useSolverSession.ts     ← orchestrator wiring : solve/cancel, estimation pré-solve, progression, résultats
    │   ├── BuilderToolbar.tsx      ← héros · Solve · toggles + popovers (un fichier par panneau : OptionsPanel, SetsPanel…)
    │   ├── ResultsTable.tsx        ← table virtualisée, tri, heatmap, menu des colonnes
    │   ├── BottomGearBand.tsx · RightSidebar.tsx · FilterFooter.tsx · StatsPanel.tsx · …
    │   └── catalogs.ts · statColumns.ts ← catalogues tirés de l'inventaire, tables stats/ratings
    ├── presets/PresetsScreen.tsx   ← onglet Presets : cartes par preset (ordre du jeu, filtre / tri par classe), grille du jeu, référence, associés, gemmes d'EE, perte, overcap, + Worklist, Optimize → / Optimize preset →
    └── BuildsScreen.tsx            ← roster équipé/composé + computeAdvice + Optimize →
```

Bonus :
- `data/stat-locks.json` : snapshots stat-régression pour valider la compose
  formula (cf. [reference.md § 3.2](reference.md#32-locks-de-régression-datastat-locksjson)).

---

## 10. Comment tester end-to-end

1. Lancer l'app (`npm run dev`).
2. Onglet Builder → choisir un héros équipé.
3. Cliquer **SOLVE** sans aucun filtre/priority → la table doit se remplir, P/S incrémentent.
4. Cliquer une ligne → bottom band affiche les 8 pièces.
5. Mettre `Crc min = 90` puis re-SOLVE → tous les builds retournés satisfont la borne.
6. Activer `Sharp 4pc required` → helmet/armor/gloves/boots des builds sont tous Sharp.
7. **Comparaison régression** : SOLVE avec priority vide + Top 100% + Keep current + **Reforge Off**
   (le défaut +10R6 projette à +10 → ne matcherait pas la card) → le top-1 doit avoir les mêmes
   `FinalStats` que la card du même héros dans l'onglet Builds (à la réallocation gems près, qui en
   mode priority vide est fallback sur les gems actuels donc ✓ équivalence stricte attendue).
8. SOLVE CP → top-1 doit avoir le plus gros CP affiché. Comparer à un solve brute-force séparé sur petite slice.
