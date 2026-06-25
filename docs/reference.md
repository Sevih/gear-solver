# Reference — traitements, calculs, sources

Doc dense unifiée pour quiconque doit reprendre le moteur à froid. Couvre :
1. **Le pipeline complet** (capture → parse → compose → solve), avec les
   fonctions et fichiers qui font chaque étape.
2. **Les formules** (compose final stat, CP, ratings, score, gems, reforge,
   top-%) avec leur conventions d'unités et leur validation.
3. **Les sources** (tables jeu → tables dérivées → consommateurs, plus
   références aux dumps libil2cpp.so).

> Pour le pipeline UI du solver (panneaux, états, UX), voir [solver.md](solver.md).
> Pour le découpage des couches, voir [architecture.md](architecture.md).

---

## 1. Traitements

### 1.1 Capture (`tools/capture/`)

Pipeline mitmproxy + PowerShell. Capture les réponses du serveur Outerplane :
- Endpoints : `glb-game.outerplane.vagames.co.kr:38001` (compte/inventaire) +
  `glb-login…:38002`. Ports non-standard via Unity BestHTTP/2 → bypasse
  proxy système, donc redirect iptables nécessaire.
- Encodage : `{"msg":"<hex>"}` → hex → **XOR clé répétée
  `ASLDKGFJASPODIFJSOWEI`** → UTF-8 JSON. Pas de certificate pinning.
- Sortie : `tools/capture/out/{user_item,user_character,…}.json`.

Fichiers : [capture.ps1](../tools/capture/capture.ps1),
[disarm.ps1](../tools/capture/disarm.ps1),
[addon.py](../tools/capture/addon.py).

### 1.2 Tables dérivées (`data/build.mjs` → `data/derived/`)

Le jeu copie ses tables brutes dans `data/game/*.json` (18 fichiers).
`data/build.mjs` les distille en tables compactes consommables :

| Source `data/game/`                  | Cible `data/derived/`     | Contenu                                                |
|--------------------------------------|---------------------------|--------------------------------------------------------|
| `ItemTemplet.json`                   | `equipment.json`          | ItemID → slot/grade/star/setId/armorSetId/name/image/effectIcon/class |
| `ItemOptionTemplet.json`             | `options.json`            | OptionID → StatOption (`{st, ap, v}`) OU IOT_BUFF reference |
| `BuffTemplet.json`                   | `buffs.json`              | BuffID → array of StatOption (per enhanceLevel)        |
| `SetTemplet.json` + curated          | `sets.json`               | setId → levels[] → {p2, p4, p2_desc, p4_desc, name}    |
| `EquipmentEffectTemplet.json`        | `equipmentPassives.json`  | ItemID → {name, textByTier[1..4]}                      |
| `MultiTierPassiveTemplet.json`       | `multiTierPassives.json`  | ItemID → list of tier passives                         |
| `EquipmentEffectTemplet.json` (sub)  | `gems.json`               | OptionID 15001..15054 → {type, level, st, ap, v}       |
| `SingularityOptionTemplet.json`      | `singularityOptions.json` | OptionID → {st, ap, v, name, desc, combatOnly}         |
| `EquipmentEffectTemplet.json` (EE)   | `eePassives.json`         | ItemID → list of {st, ap, v, levelThreshold}           |
| `CharacterTemplet.json` etc.         | `characters.json`         | charId → {ingredients, cls, element, star, …}          |
| `ItemEnchantTemplet.json`            | (intégré dans `equipment`)| enhanceFactor, tierFactor, expCurves, singularity      |
| `ExpCharacterTemplet.json`           | `expCharacter.json`       | array idx 1..120 → cumulative XP                       |
| `CharacterMaxLevelTemplet.json`      | `charLevelMax.json`       | `${star}|${step}` → {maxLevel, statModifierAfter100}   |
| `ArchiveBonusTemplet.json`           | `codexCurve.json`         | array idx 0..11 → {atkPct, defPct, hpPct}              |
| `ArchiveTemplet.json`                | `archiveBonus.json`       | curve archive reward → level                           |
| `TrustExpTemplet.json` + buffs       | `trustCharacter.json`, `trustBuffs.json` | trust system data                       |

Re-générer après un patch jeu : `npm run data:build` (ou `data/sync.ps1`
si on doit aussi recopier depuis Outerpedia).

Fichier : [data/build.mjs](../data/build.mjs).

### 1.3 Parse (`packages/core/src/parse.ts`)

`parseInventory(rawUserItem, rawUserChar, game)` consomme les JSON capturés
et produit un `Inventory` typé. Chaque `GearPiece` :
- Identité : `uid, itemId, slot, setId, armorSetId, rarity, star, name, classLimit`.
- État : `breakthrough, reforgeCount, enhanceLevel, singularityLevel, ascended, locked, equippedBy`.
- Stats résolues : `main: RolledStat[]` (option + singularity + eePassive)
  et `subs: RolledStat[]` (substats, OU pour Talisman/EE les **gems socketés** —
  même `SubOptionList` côté API).
- `gemSlots?: number[]` (Talisman/EE uniquement) — array de 5 OptionIDs
  conservé brut pour l'affichage.

Conventions clés :
- Sub `Level = totalTicks - 1` (les ticks affichés en jeu sont `Level + 1`).
- Reforge ticks = `Level - BaseLevel` (les ticks orange).
- Sub OptionID 0 = padding, skippé.
- Talisman main passe par `BuffTemplet` (`resolveBuffMain`) — IOT_BUFF.
- Singularity option : `BT_STAT_PREMIUM` permanent unconditional, `fromBuff: true`.
- EE level-gated passives : ajoutés à `main` quand `enhanceLevel >= levelThreshold`.
- Combat-only options (`BuffConditionType ≠ NONE`) gardées mais `combatOnly: true`
  → ignorées par les aggregators de stats mais affichées dans l'UI.

Fichiers : [parse.ts](../packages/core/src/parse.ts),
[stats.ts](../packages/core/src/stats.ts) (résolution OptionID → stat).

### 1.4 Compose no-gear (`packages/core/src/compose-stats.ts`)

`composeCharStats(ingredients, codexCurve, options)` calcule les stats du
héros **sans** son gear. Couvre les couches :

1. **Base** (per-level interpolation depuis `CharacterTemplet`).
2. **Évolutions** (sum des rows `EvolutionLevel ≤ min(transStar, 6+lbStep)`).
3. **Class passive** (Skill_22).
4. **Skill_8** (transcend passive — passe via `BuffValueRate`).
5. **Geas** (par node, split IOT_STAT [white] vs IOT_BUFF [yellow]).
6. **Codex** (archive bonus, +N% sur baseValue uniquement).
7. **Skill passives** user-leveled (S1/S2/S3) + Core Fusion (Skill_23).
8. **Limit Break** modifier (CharacterMaxLevelTemplet, amplifie l'interp lv>100).

Output : `{noGearStats, intrinsicStats, scaling}` où `scaling` carry les
ingrédients per-axe (ATK/DEF/HP/EFF/RES) pour permettre l'ajout de gear
plus tard via `composeMultStat`.

### 1.5 Compose final stats (`apps/renderer/src/lib/composeBuild.ts`)

`computeFinalStats(baseline, scaling, pieces, game, gemOverride?)` ajoute
le gear par-dessus le no-gear baseline. Couvre :

1. `aggregateGearBuckets(pieces, game, gemOverride?)` — agrège mains/subs/sets
   en trois buckets : `flat`, `pct`, `buffPct` (séparation in-game CalcFinalStat).
2. Per-axe compound via `composeMultStat(scaling, gearFlat, gearPct, gearBuffPct)`
   pour ATK/DEF/HP/EFF/RES.
3. Additive simple pour SPD/CHC/CHD/PEN/DMG±/CritDmgRed.
4. **Gem override** (solver uniquement) : skip les subs des Talisman/EE et
   ajoute les deltas `{flat, pct}` pré-agrégés à la place. Voir §2.4.

Fichier : [composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts).

### 1.6 Solver (`apps/renderer/src/lib/solver/`)

Pipeline détaillé dans [solver.md](solver.md). Résumé :

- **Orchestrator** (main thread) — pool de Web Workers, partition, fan-out/in.
- **Worker** — instance d'engine, calcul d'un chunk.
- **Engine** — `prepareContext + solveChunk + finalizeBuilds`. Phases 1-6 :
  précompute → pools → top-% → cartesian + set-prune → compose + ratings + heap → CP.

---

## 2. Calculs

### 2.1 CalcFinalStat (`composeMultStat` + `composeCharStats::calcStat`)

Reverse-engineered de `CFormula::CalcFinalStat` (libil2cpp.so 1.4.9, RVA
`0x2C59E48`). Validé 0-diff sur 11/11 ATK/DEF/HP stats × 5 chars + EFF/RES
sur G.Beth/Notia (core fusion +50% EFF baseline 120 → 255 in-game).

**Formule** (rates en per-mille, flats en entiers) :
```
sum_flat = baseValue + evoValue + awakValue
sum_rate = awakPct + transcendPct + gearPct           (per-mille)
part1    = trunc(sum_flat × (1000 + sum_rate) / 1000)
combined = part1 + gearFlat + buffValue
part2    = trunc(combined × (1000 + buffPct) / 1000)
codex    = trunc(baseValue × codexPct / 1000)
final    = max(0, part2 + codex)
```

`Math.trunc` (pas `floor`) — mirror le signed-magic-divide-by-1000 ARM64,
diverge de floor sur intermédiaires négatifs (rares mais réels sur debuffs).

**Allocation des couches** (per `scaling.{atk,def,hp,eff,res}`) :
| Couche       | Sur quoi             | Source                                                  |
|--------------|----------------------|---------------------------------------------------------|
| baseValue    | sum_flat             | per-level base interpolation                            |
| evoValue     | sum_flat             | sum des evolution rows                                  |
| awakValue    | sum_flat             | geas IOT_STAT flat adds                                 |
| awakPct      | sum_rate             | geas IOT_STAT % bonuses                                 |
| transcendPct | sum_rate             | TranscendByStar.{atkPct,defPct,hpPct} row matching star |
| gearPct      | sum_rate             | aggregated `pct.{atkPct,defPct,hpPct}` from gear        |
| gearFlat     | combined             | aggregated `flat.{atk,def,hp}` from gear                |
| buffValue    | combined             | OAT_ADD buffs (class passive +EFF, geas [141] +50 EFF, …) |
| buffPct      | part2 (outermost)    | classPassive + skill_8 + geas IOT_BUFF + skill passives + gear `buffPct.*` |
| codexPct    | codex term, baseValue| archive bonus                                           |

Fichier : [compose-stats.ts](../packages/core/src/compose-stats.ts) +
[composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts) (gear-side).

### 2.2 CalcBattlePower (CP)

Reverse-engineered de `CalcBattlePower` (libil2cpp.so 1.4.9), validé 0-diff
sur 5 chars (LB0/1/2/3). Implémentation : [cp.ts](../apps/renderer/src/lib/solver/cp.ts).

**Conventions critiques** :
- **CRC capped at 100%** AVANT entrée dans la formule.
- CRC/CHD/PEN/DMGup/DMGRed/ECDR : valeurs RAW (× 10 du % affiché).
  Le code reçoit le display value et multiplie par 10 en interne.
- EFF/RES : entier display direct.

**Formule** :
```
critF =  sumCd < 2001 ? sumCd / 1000
                      : 2.0 × (1 − (1 − x)²) + 2.5  where x = min((sumCd-2000)/2500, 1)
  with sumCd = dmgupRaw + chdRaw

crcF   = (crcRaw + 1000) / 1000
penF   = (penRaw × 1.5 + 1000) / 1000
spdF   = 1 + SPD / 50
effF   = 1.7 × EFF / (EFF + 130)
hdF    = 44000 / (HP + DEF + 44000)
defF   = hdF × 0.15 + 1.05
resR   = 1 + 0.25 × RES / (RES + 200)
defR   = 1 + 0.25 × (ecdrRaw + dmgredRaw) / ((ecdrRaw + dmgredRaw) + 200)

chain   = (1 + effF) × crcF × critF × penF × spdF
atkPart = 0.125 × ATK × (1 + chain)
defPart = (HP + DEF) × defF × defR × resR
starBonus = showUIStar × 500 + starPlus × 120
skillSum  = max(0, first − 4) + second + ultimate + chainPassive
eeBp      = ee ? ee.enhanceLevel × 100 + 300 : 0
ooBp      = ooparts ? ooparts.enhanceLevel × 100 + (ooparts.star ?? 0) × 50 : 0
fusionBp  = fused ? 5000 : 0

CP = floor(atkPart + defPart + starBonus + skillSum × 100 + eeBp + ooBp + fusionBp)
```

**`max(0, first − 4)`** : clamp défensif. S1 démarre à 4 in-game (toujours-on),
donc `first - 4` représente la délta utilisateur. Une capture normale a
`first ≥ 4`, mais un parse glitch retournant 0 soustrairait 400 CP en
silence — le clamp empêche ça.

**ECDR (`critDmgRed`)** : exposé dans `FinalStats.critDmgRed` (sommé depuis
les substats / mains `critDmgReduce` via `composeBuild`). Convention ×10
(comme les autres rate inputs), additionné à `dmgredRaw` dans `defR`. Un
build qui stacke de la CDR voyait sa CP sous-estimée avant le fix (defR
ignorait la contribution ECDR).

### 2.3 Cheap ratings (`ratings.ts::computeCheapRatings`)

Produits purs de `FinalStats`, ~10 ns/call. Aucune dépendance externe.

| Rating | Formula                          | Sémantique                              |
|--------|----------------------------------|-----------------------------------------|
| `hps`  | `HP × SPD`                       | Bulky-and-fast composite                |
| `ehp`  | `HP × (DEF/300 + 1)`             | Effective HP, scaling linéaire DEF      |
| `ehps` | `EHP × SPD`                      | Tanky-and-fast                          |
| `dmg`  | `ATK × (CRC/100) × (CHD/100)`    | Crit-weighted average damage            |
| `dmgs` | `dmg × SPD`                      | DPS                                     |
| `mcd`  | `ATK × (CHD/100)`                | Max crit dmg (suppose 100% CHC)         |
| `mcds` | `mcd × SPD`                      | Max DPS                                 |
| `dmgh` | `HP × (CHD/100)`                 | Bruiser burst (HP-scaling)              |

Conventions : `CRC` et `CHD` sont en **DISPLAY percent** (35 = 35%), donc
on divise par 100 pour avoir décimal dans les produits. **CRC est cappée à
100%** dans `dmg`/`dmgs`/`mcd` (`Math.min(s.crc, 100) / 100`) — l'overflow
est wasted in-game, ne pas le créditer dans les ratings. La valeur brute
reste dans `FinalStats.crc` pour l'affichage UI.

EHP utilise le scaling DEF linéaire `HP × (DEF/300 + 1)`, plus lisible
pour filtrer que la formule HD non-linéaire du CP.

### 2.4 Score (`ratings.ts::computeScore`)

```
Score = round(Σ over priority[key] × (effective(finalStats[key]) / STAT_NORMS[key]) × 100)
  where effective(v) = key === "crc" ? min(v, 100) : v
```

- `priority` : keyed par user keys (`atk`, `crc`, `chd`, …), valeurs `-1..3`.
- `STAT_NORMS` : valeurs de référence endgame (atk=4000, hp=30000, crc=100, …).
- Normalisation rend les stats de magnitude différentes (HP en milliers vs
  CHC en pourcents) comparables.
- Échelle ×100 pour rendre les Scores lisibles (~50-500 typique).
- Score négatif possible (priority -1 sur stat élevée).
- **CRC clampée à 100%** : l'overflow ne compte pas dans le score (cohérent
  avec le cap in-game et avec le clamp dans `computeCheapRatings`).

### 2.5 Per-roll scoring (`ROLL_NORMS`)

**Constante séparée** de `STAT_NORMS` (qui sert à Score sur final stats).
Utilisée par `topPctPrune` et `scoreGemPool` qui scorent des **rolls
individuels**, pas des totaux endgame.

```
roll_score = priority[user_key] × (roll.value / ROLL_NORMS[roll.engine_key])
```

Sized pour un max-roll sur un sub de +15 T4 :
- Flats : `atk=300, def=100, hp=1500, spd=20, eff=50, res=50`
- Percents : `atkPct=40, defPct=40, hpPct=40, critRate=20, critDmg=40, …`

Sans cette séparation, scorer un roll d'ATK% (24% raw → ~2.4 display) avec
`STAT_NORMS.atk=4000` donnerait un score 50× plus petit qu'un roll de CHC
+3% scoré avec `STAT_NORMS.crc=100`. Bug réel attrapé par les tests.

Mapping engine-key → user-key (`STAT_TO_PRIORITY`) : `atkPct → atk`,
`critRate → crc`, `effRes → res`, etc.

### 2.6 Set bonuses (`composeBuild.ts::computeSetBonuses`)

Pour chaque armorSetId présent ≥ 2× dans les pieces :
- Compte les pieces totales + celles avec `breakthrough >= 4`.
- Si toutes les pieces du set sont BT4 → tier 4 row (`level === 2`),
  sinon tier 1.
- Le 2pc s'applique dès count ≥ 2 ; le 4pc dès count ≥ 4.
- Skip si `p2.st === "ST_NONE"` (effet narratif uniquement, ex: Counterattack
  qui stocke son effet en `desc` plutôt qu'en stat).

Valeurs routées vers `flat` ou `pct` via `setBonusStatKey(st, isRate)`.

### 2.7 Gem sub-solver (`gems.ts`)

**Pool** : multiset des OptionIDs (15001..15054) socketés sur les Talisman
+ EE éligibles de l'inventaire. **Éligibilité miroir de la sélection des
pièces** (`allow()` côté engine) : le gear du héros courant est toujours
inclus ; le gear équipé sur un autre héros n'est compté que si
`includeEquippedOnOthers` est on ; le gear sur un héros exclu n'est jamais
compté. Sans ce gating, le solver pouvait proposer des gemmes qui exigent
physiquement de désé­quiper le Talisman/EE d'un héros que l'utilisateur
venait juste d'exclure.

**Scoring** : `score = priority[user_key] × (value / ROLL_NORMS[engine_key])`.
Trié desc.

**Allocation greedy** : top-K pour `K = talismanSlots + eeSlots` (4 ou 5 selon
`enhanceLevel ≥ 5`). Stoppe à `score ≤ 0`.

**Pré-agrégation** : `aggregateGemDelta(scored, ts, ee)` retourne un
`{flat, pct}` directement consommable par `aggregateGearBuckets`. Évite N×10
appels `resolveStat` dans le hot loop.

**Fallback selon le mode** :
- **SOLVE** + priority vide → tous les scores collapsent à 0 →
  `aggregateGemDelta` retourne `null` → `computeFinalStats` sans override →
  fallback sur les `subs` des pieces (= gems actuellement socketés).
  Préserve la stat in-game-équivalente quand le joueur n'a pas exprimé d'intention.
- **SOLVE CP** + priority vide → `scoreGemPool` reçoit `allowZeroPriority: true`
  → bascule sur `score = value / ROLL_NORMS[engine_key]` (magnitude per-roll
  brute). Le greedy pick alors les meilleurs gems indépendamment des stats.
  Nécessaire parce que "max CP" sous-entend "use the best gems available" —
  préserver les gems actuels désactiverait silencieusement l'optimisation
  gem pour le cas d'usage typique du mode CP.
- **N'importe quel mode** + priority non-vide → `priority × value / norm`
  pour les deux modes (la priorité utilisateur domine, le flag CP est ignoré).

### 2.8 Top-% prune (`engine.ts::topPctPrune`)

Heuristique pour réduire la search space. Pour chaque slot :
1. Score chaque pièce isolément (mêmes ROLL_NORMS qu'au-dessus).
2. Trie desc.
3. Garde les `⌈N × topPct / 100⌉` premières.

Désactivé automatiquement quand `priority` est vide (rang arbitraire → on
garde tout). Si actif avec topPct=30 sur 7 slots de 150 pièces chacun :
`150^7 ≈ 10^15` → `45^7 ≈ 10^11` permutations (réduction 10⁴×).

**Protection des sets requis** (`topPctPrunePreserving`) : les pièces
appartenant à un set `req-2pc` ou `req-4pc` survivent toujours, même si
leur score de priorité ne les classerait pas dans le top-%. Sans cette
garde, une pièce low-priority membre d'un set requis serait éliminée du
pool → `checkSetsFeasible` tuerait silencieusement chaque combo et
l'utilisateur verrait "no builds" sans indice. Les pièces protégées
s'ajoutent au top-% (déduplication par UID), donc le pool effectif peut
légèrement dépasser `⌈N × pct/100⌉` — intentionnel.

### 2.9 Reforge simulation (`engine.ts::simulateReforges`)

Budget de reforges par pièce :
- 1★→6★ non ascended : `star` reforges (1..6).
- **6★ ascended (Singularity)** : `star + 3 = 9` reforges. Le +3 est
  exclusif aux 6★ Singularity ; les autres rangs n'ont pas d'ascension.

Pour chaque pièce avec `remaining = maxReforges - reforgeCount > 0`,
distribue les reforges restantes greedy par `priority × per-tick value`.
Cap à **LV6 ticks par sub** (observé en réel). Tie-break sur per-tick raw.

Mutations contenues sur un clone — l'inventaire original n'est jamais
modifié.

**Slot Talisman (ooparts) et EE (exclusive) explicitement exclus** : leur
`subs` est en réalité la liste des gems socketés (le parser stocke
`SubOptionList[i]` résolu en gem dans `subs`). Les gems ne sont pas
"reforgeable" in-game — on les swap via le gem allocator, on n'ajoute pas
de ticks dessus. Si on appliquait `simulateReforges` à un talisman, on
gonflerait les valeurs des gems → CP/stats faux quand le gemOverride est
null (cas SOLVE + priority vide). Double garde-fou : le caller
(`prepareContext`) filtre la liste des slots, ET `simulateReforges`
rejette ooparts/exclusive en early-return.

### 2.10 Mid-tree set pruning (`engine.ts::solveChunk`)

À chaque depth `D` de la boucle armor (helmet=1, armor=2, gloves=3, boots=4) :
- `remainingSlots = 4 - D`
- Pour chaque set requis (req-2pc ou req-4pc), si
  `(need = target - setCount[id]) > remainingSlots` → infeasible, skip ce
  sous-arbre.

Énorme gain sur les recherches `req-4pc Sharp` quand peu de helmets Sharp.

### 2.11 Combat Power + Upg filters (deferred to finalize)

CP est trop cher à calculer dans le hot loop SOLVE (~20× cheap rating)
et `upg` dépend du current loadout du héros (uniquement disponible côté
`finalizeBuilds` via `ctx.req.inventory`). Les deux filters sont donc
appliqués dans `finalizeBuilds` (helper `inMinMax`) :

- **CP / SOLVE CP** : CP calculé in-loop, filtre `ratingFilters.cp`
  appliqué tout de suite.
- **CP / SOLVE** : CP non calculé in-loop → filtre `ratingFilters.cp`
  appliqué dans `finalizeBuilds` après calcul lazy du top-N (peut
  réduire la liste finale en-dessous de topN).
- **Upg** : `upg` (nombre de slots différents du current loadout) calculé
  dans `finalizeBuilds`, filtre `ratingFilters.upg` appliqué immédiatement
  après. `compileFilterSpecs` skip `cp` et `upg` au moment de la
  compilation pour éviter qu'ils soient évalués dans le hot loop avec des
  valeurs encore nulles.

### 2.12 Top-K min-heap (`engine.ts::TopKHeap`)

Fixed-capacity min-heap keyed par `score` (SOLVE) ou `cp` (SOLVE CP).
`push()` drop le min si full+meilleur. `toSorted()` retourne un sorted desc.
`null cp` ranke comme `-Infinity` → jamais dans le top.

### 2.13 Generation tracking (`solver.worker.ts` + `orchestrator.ts`)

Évite la corruption à la re-soumission d'un solve (utilisateur reclique
SOLVE, ou passe SOLVE → SOLVE CP pendant qu'un calcul tourne).

- **Orchestrator** : `solveId` monotone incrémenté à chaque `solve()`,
  embarqué dans `SolveRequest` puis échoé par tous les `WorkerOutput`
  (`progress`/`result`/`error`). `handle()` drop tout event dont
  `solveId !== currentSolveId`.
- **Worker** : `currentGen` monotone, incrémenté à chaque message
  `solve`/`cancel`. Chaque `runSolve(req, myGen)` capture `myGen`,
  vérifie `myGen === currentGen` avant chaque post (progress / result /
  error). Si stale, bail sans poster.
- **MessageChannel par run** : chaque `runSolve` crée son propre
  MessageChannel + `pendingResolve` local. Empêche deux runs concurrents
  de s'écraser mutuellement le resolver (sinon : OLD's resolver perdu →
  await jamais résolu → coroutine + son `solveCtx` leak).

Sans ces 3 garde-fous, OLD's stale `result` arrivait après que
l'orchestrator ait remis `active = true` pour NEW → builds mélangés
dans `buf`, `workersDone` incrémenté à tort, flush prématuré.

---

## 3. Sources & validation

### 3.1 Tables in-game référencées

Toutes les tables sources vivent dans `data/game/` (copie locale, pas de
fetch runtime). Re-copiées via `data/sync.ps1` depuis un checkout d'outerpedia-v2.

**Tables critiques pour la math** :
- `CharacterTemplet.json` — base stats, skill blocks, class passive
- `CharacterEvolutionStatTemplet.json` — evolution rows
- `TranscendStatTemplet.json` — transcend % bonuses
- `CharacterMaxLevelTemplet.json` — LB modifiers
- `ArchiveBonusTemplet.json` — codex bonuses
- `GiftTemplet.json` + nodes — geas
- `ItemEnchantTemplet.json` — enhance/tier/singularity scaling factors
- `ItemOptionTemplet.json` — base values for substats + gems
- `BuffTemplet.json` — Talisman main scaling per enhanceLevel

### 3.2 Locks de régression (`data/stat-locks.json`)

Snapshots per-character (charId × level × LB) avec final stats validés
in-game. Fichier committable — la maintenance des formules doit garder
ces locks verts. 8 héros couverts aujourd'hui :
- Aer (2000055) lv100, no LB
- Core Fusion Notia (2000056) lv100
- Gnosis Beth (2000092) lv120 LB3
- Caren (2000089) lv120
- Gnosis Dahlia (2000090) lv120
- Demiurge Luna (2000119) lv120
- Mystic Sage Ame (2000110) lv105 LB1
- Midnight Rush Skadi (2000114) lv110 LB2

Le toggle `gs.debug.statLocks` dans Settings affiche les locks vs computed
sur l'onglet Builds, avec un badge "drift" quand un stat diverge.

### 3.3 Tests automatisés

| Fichier | Couverture |
|---------|------------|
| `packages/core/test/parse.test.ts` | 7 tests — parser substats/main/talisman/EFF flat, scaling enchant, singularity |
| `apps/renderer/test/solver.test.ts`     | 50 tests — gem pool/score/alloc/delta (+ eligibility filter), gem override equivalence, cheap ratings (+ CRC clamp), score normalization (+ CRC clamp), reforge sim (+ 6★ ascended budget, Talisman/EE rejection), top-K heap, STAT_TO_PRIORITY mapping, CP clamps (skills.first, ECDR) |

Run : `npm test --workspaces --if-present`.

### 3.4 Reverse engineering — libil2cpp.so

Formules clés viennent du dump libil2cpp.so (1.4.9 build, decompilé via
Ghidra/IDA). Adresses connues :
- `CFormula::CalcFinalStat` — RVA `0x2C59E48`
- `CFormula::CalcBattlePower` — RVA `0x2C59EE4` (approximative, voir
  [game_combat_power_formula.md](../../../.claude/projects/c--Users-Sevih-Documents-Projet-perso-outerpedia-v2/memory/game_combat_power_formula.md))

### 3.5 Sources externes

- **outerpedia-v2** (sibling repo) — sert les images via `/img/*` (Vite
  middleware en dev, fetch direct ou bundle en prod). Path autodétecté
  depuis `OUTERPEDIA_PATH` env ou checkouts connus.
- **Mémoire user (Claude)** — formules détaillées + historique de
  validation. Pas dans le repo, accessible via les notes Claude :
  - `game_stat_compose_formula` — derivation détaillée CalcFinalStat
  - `game_combat_power_formula` — derivation CP
  - `game_ee_transcend_inherent` — EE/Transcend toujours actifs
  - `project_gear_solver_stat_locks` — workflow des locks
  - `equipment_ascend_name_gradient` — design des Singularity ascended
  - `equipment_icon_overlay_specs` — overlays +N/T1-T4

### 3.6 Conventions de codage des stats

| Stat                | Stockage interne   | Display                  | Notes                              |
|---------------------|--------------------|--------------------------|------------------------------------|
| ATK / DEF / HP      | entier flat        | entier                   | `*Pct` variants pour les %         |
| SPD                 | entier             | entier                   | pas de variant percent              |
| CRC / CHD / DMGup / DMGRed / PEN | per-mille (×10) | percent display (÷10) | `ItemOptionValueRate` per-mille    |
| EFF / RES           | entier OU per-mille| **context-dependent**    | OAT_ADD flat sur acc/armor, OAT_RATE % sur EE/Talisman |
| CritDmgRed          | gear-only (pas baseline char) | percent       | E_CRI_DMG_REDUCE                   |

Pour les EE/Talisman : les passives in-game stockent en OAT_RATE → routées
en `buffPct.*` côté compose pour amplifier via `BuffValueRate` (vs un
prebake en flat qui ne match que si baseForRate ≈ 100).

---

## 4. Carte des modules engine

```
apps/renderer/src/
├── lib/
│   ├── composeBuild.ts            ← computeFinalStats + aggregateGearBuckets (+ GemOverride)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← localStorage per-hero saved builds
│   │   └── filterPresets.ts        ← localStorage per-hero filter snapshots
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool de Web Workers, fan-out/in, merge top-N
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + simulateReforges + TopKHeap
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + aggregateGemDelta + allocateGems + gemSlotsOf
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + ROLL_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower
├── workers/
│   └── solver.worker.ts            ← IPC adapter, MessageChannel yield
└── screens/
    ├── InventoryScreen.tsx         ← gear table + detail
    ├── BuildsScreen.tsx            ← per-hero current build cards (uses calcBattlePower)
    └── BuilderScreen.tsx           ← reducer SolverFilters + tous les panneaux + orchestrator wiring + Library sidebar

packages/core/src/
├── types.ts                       ← GearPiece, Character, Inventory, StatType, RolledStat
├── raw.ts                         ← RawUserItem / RawUserCharacter / RawPreset (capture JSON shapes)
├── gamedata.ts                    ← GameData + tous les *Table types
├── stats.ts                       ← resolveStat (OptionID → ResolvedStat)
├── parse.ts                       ← parseInventory (raw → Inventory)
├── compose-stats.ts               ← composeCharStats (no-gear stats per hero)
└── index.ts                       ← re-exports publics
```
