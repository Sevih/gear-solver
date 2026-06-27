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

Le jeu copie ses tables brutes dans `data/game/*.json` (29 fichiers).
`data/build.mjs` les distille en tables compactes consommables. La colonne
Source liste la table `data/game/` réellement chargée par `build.mjs` (plusieurs
cibles dérivent de la même table — `ItemSpecialOptionTemplet` notamment) :

| Source `data/game/`                  | Cible `data/derived/`     | Contenu                                                |
|--------------------------------------|---------------------------|--------------------------------------------------------|
| `ItemTemplet.json`                   | `equipment.json`          | ItemID → slot/grade/star/setId/armorSetId/name/image/effectIcon/class |
| `ItemOptionTemplet.json`             | `options.json`            | OptionID → StatOption (`{st, ap, v}`) OU IOT_BUFF reference |
| `BuffTemplet.json`                   | `buffs.json`              | BuffID → array of StatOption (per enhanceLevel)        |
| `ItemSpecialOptionTemplet.json` + curated (outerpedia) | `sets.json` | setId → levels[] → {p2, p4, p2_desc, p4_desc, name}  |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `equipment-passives.json` | ItemID → {name, textByTier[1..4]}            |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `multi-tier-passives.json`| ItemID → list of tier passives               |
| `ItemOptionTemplet.json` (IDs 15001..15054) | `gems.json`        | OptionID → {type, level, st, ap, v}                    |
| `ItemSpecialOptionTemplet.json` (groups 30000/31000) | `singularity-options.json`| OptionID → {st, ap, v, name, desc, combatOnly} |
| `ItemSpecialOptionTemplet.json` (EE groups) | `ee-passives.json` | ItemID → list of {st, ap, v, levelThreshold}           |
| `CharacterTemplet.json` etc.         | `characters.json`         | charId → {ingredients, cls, element, star, …}          |
| `ItemEnchantTemplet.json` + `SingularityEquipEnchantTemplet.json` | `enhance.json` | enhanceFactor, tierFactor, expCurves, singularity (fichier standalone) |
| `ExpCharacterTemplet.json`           | `exp-character.json`      | array idx 1..120 → cumulative XP                       |
| `CharacterMaxLevelTemplet.json`      | `char-level-max.json`     | `${star}|${step}` → {maxLevel, statModifierAfter100}   |
| `ArchiveBonusTemplet.json`           | `archive-bonus.json`      | `CompleteCount` → codex level (1..11)                  |
| `CharacterArchiveStatTemplet.json` (via `computeCharacterIngredients`) | `codex-curve.json` | codex level idx 0..11 → {atkPct, defPct, hpPct} |
| `ExpCharacterTemplet.json` (col TrustExp) + `TrustBuffTemplet.json` | `trust-character.json`, `trust-buffs.json` | trust system data |

Re-générer après un patch jeu : `npm run data:build` (ou `data/sync.ps1`
si on doit aussi recopier depuis Outerpedia).

`build.mjs` écrit aussi `data/derived/version.json` `{ hash, builtAt }` : `hash` est un
`sha256` du contenu de **tous** les fichiers dérivés (nom + corps, ordre d'émission fixe),
donc **stable tant que la donnée est inchangée** (un rebuild no-op ne le bouge pas). Lu côté
renderer par `loadDataVersion()` ([data.ts](../apps/renderer/src/data.ts)) et affiché en
lecture seule dans Settings → Data. C'est le crochet d'une future invalidation des caches
localStorage après un patch (comparer le `hash`, élaguer les SavedBuild aux `pieceUids` disparus).

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

### 1.7 Édition d'équipement (`packages/core/src/equip.ts`)

L'app ne parle jamais au jeu : déplacer une pièce = **réécrire le JSON capturé**. Le owner
d'une pièce est `RawItem.CharUID` (`"0"` = libre, même convention qu'au parse).

- `equipItem(raw, game, itemUid, charUid)` — pose `CharUID = charUid` sur la pièce et **déplace**
  vers `"0"` celle qui occupait le même slot du perso (un slot = une pièce ; slot résolu via
  `game.equipment[ItemID].slot`). No-op (clone inchangé) si item inconnu / non-gear / déjà sur ce
  perso ; `charUid "0"` délègue à `unequipItem`. **Immuable** — l'entrée n'est jamais mutée.
- `unequipItem(raw, itemUid)` — `CharUID = "0"` ; no-op clone si absent / déjà libre.

Persistance : le **renderer** applique le transform (il a core + la game data chargée), puis POST
le snapshot complet à `POST /api/captured/user-item` (writer bête : valide `{ ItemList[] }` +
`writeFileSync` `out/user_item.json`, refus 409 si pipeline armé). Client :
[apps/renderer/src/equip.ts](../apps/renderer/src/equip.ts) (`equipPiece`/`unequipPiece`). Le
déclencheur UI (Builder/Builds) reste à câbler.

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

**Hot path SOLVE CP** : `makeCpEvaluator(consts)` pré-capture les bonus additifs
constants par solve (`starBonus`, `skillSum`, `eeBp`, `fusionBp` — tous entiers
exacts) et retourne une closure `(stats, talisman) → cp`. Évite l'allocation d'un
objet `CpArgs` et la re-dérivation des constantes à chaque combo. **Bit-identique**
à `calcBattlePower` : les constantes hoistées sont des entiers (sommation sans perte)
et l'ordre de la somme finale est préservé. Test d'identité dédié.

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
skillSum  = Σ max(0, level − 1) over {first, second, ultimate, chainPassive}
eeBp      = ee ? ee.enhanceLevel × 100 + 300 : 0
ooBp      = ooparts ? ooparts.enhanceLevel × 100 + (ooparts.star ?? 0) × 50 : 0
fusionBp  = fused ? 5000 : 0

CP = floor(atkPart + defPart + starBonus + skillSum × 100 + eeBp + ooBp + fusionBp)
```

**`max(0, level − 1)` par skill** : les 4 skills débutent à Lv1 in-game (max
Lv5), donc chacun compte `(niveau − 1) × 100` et un perso tout-Lv1 ajoute 0.
Vérifié sur Flamberge (6★ lv5) : S1 Lv1/2/3 → CP in-game 6085/6185/6285, et sa
fiche tout-Lv1 ne retombe sur 6085 que si `skillSum = 0`. Le clamp ≥0 protège
d'une capture partielle (niveau 0). (Ancienne formule `max(0, first − 4)` :
supposait à tort un baseline Lv4 pour S1 — le cas tout-Lv1 n'était jamais testé.)

**ECDR (`critDmgRed`)** : exposé dans `FinalStats.critDmgRed` (sommé depuis
les substats / mains `critDmgReduce` via `composeBuild`). Convention ×10
(comme les autres rate inputs), additionné à `dmgredRaw` dans `defR`. Un
build qui stacke de la CDR voyait sa CP sous-estimée avant le fix (defR
ignorait la contribution ECDR).

### 2.3 Cheap ratings (`ratings.ts::computeCheapRatings`)

Produits purs de `FinalStats`, ~10 ns/call. Aucune dépendance externe.
**Formules alignées sur la math reverse-engineered de
[`docs/damage-calc/binary-formulas-1.4.9.md`](../../outerpedia-v2/docs/damage-calc/binary-formulas-1.4.9.md)**
(adresses `CFormula.<CalcDamage>g__CalcDamage|17_0` + `CheckDamageRate`),
réduites à un contexte build-trait (pas de defender connu côté solveur).

**Pipeline damage (extrait du doc §1 + §3) appliqué aux ratings offensifs** :

```
pCrit    = min(CRC, 100) / 100
chdMult  = CHD / 100
dmgUpMod = dmgUp / 100                     ← rate += attacker.DMGBoost (§3.2)
drFactor = max(0.3, 1 + pCrit × (chdMult − 1) + dmgUpMod)   ← E[DR]/1000, floor 30% (§3.2 cap)
mcdFactor= max(0.3, chdMult + dmgUpMod)                     ← suppose pCrit = 1
penPct   = min(PEN, 100) / 100             ← PPR cappe à 100% (§1.2)
effDef   = TARGET_DEF × (1 − penPct)
penMult  = (TARGET_DEF + 1000) / (effDef + 1000)            ← ratio mitigation
```

**Côté défensif** (`ehp`) — `dmgRed` est une stat **defender** (`rate -=
defender.DMGReduceRate` §3.2), pas attaquant. Elle réduit le damage que MON
build SUBIT, pas celui qu'il INFLIGE :

```
dmgTaken = max(0.3, 1 − dmgRed/100)        ← inverse du DR rate, floor 30%
ehp      = HP × (1 + DEF/1000) / dmgTaken  ← combine mit DEF + dmgRed defender
```

**`TARGET_DEF = 2000`** — constante. Référence DEF cible : PvE midgame
boss. Avec cette valeur PEN 50% → ×1.5, PEN 100% → ×3.0. Le choix shifte
seulement le poids relatif du PEN vs autres stats ; un build sans PEN
ranke pareil pour n'importe quel `TARGET_DEF`.

| Rating | Formula                                | Sémantique                              |
|--------|----------------------------------------|-----------------------------------------|
| `hps`  | `HP × SPD`                             | Bulky-and-fast composite (proxy)        |
| `ehp`  | `HP × (1 + DEF/1000) / dmgTaken`       | Effective HP — mit DEF + dmgRed defender |
| `ehps` | `EHP × SPD`                            | Tanky-and-fast                          |
| `dmg`  | `ATK × drFactor × penMult`             | Expected damage par hit vs DEF=2000     |
| `dmgs` | `dmg × SPD`                            | DPS                                     |
| `mcd`  | `ATK × mcdFactor × penMult`            | Max crit (assume 100% CHC, raid-buffs)  |
| `mcds` | `mcd × SPD`                            | Max DPS                                 |
| `dmgh` | `HP × drFactor × penMult`              | Damage HP-scaling (Aer S3, Caren, …)    |

Conventions :
- `CRC` et `CHD` sont en **DISPLAY percent** (35 = 35%) ; le diviseur /100 les
  rend décimaux pour les produits.
- **CRC cappée à 100%** in-game — overflow wasted. La valeur brute reste
  dans `FinalStats.crc` pour l'affichage UI.
- **PEN cappée à 100%** — `PPR` (PiercePowerRate) cappe à 1000‰ in-game (§1.2).
  Le `PiercePower` flat n'est pas modélisé (rare sur les builds).
- **Plancher 30% du DR** — `CheckDamageRate` clampe `rate = Max(rate, 300)`
  (§3.2), empêche les ratings dmg/dmgh de descendre à 0 sur stacks
  de defender DMGReduce extrêmes.

**Héros `noCrit`** (Rhona / K.Tamamo / G.Nella — leurs skills ne peuvent jamais
crit) : `computeCheapRatings(fs, dmgStat, dmgSec, noCrit=true)` force `pCrit = 0`
→ le terme crit disparaît de tous les ratings offensifs, et `mcd` (« assume 100%
CHC ») retombe sur le hit non-crit (`mcdFactor === drFactor`) puisqu'il n'y a pas
de plafond crit à atteindre. Sans ça le solveur récompensait de la CHC/CHD qu'un
no-crit ne peut jamais encaisser. `noCrit` vient de `meta.noCrit`, propagé via le
contexte de solve comme `dmgStat`/`dmgSec`. **CP non affecté** : `calcBattlePower`
reste un miroir fidèle de l'in-game (qui utilise le crc brut), donc SOLVE CP
optimise bien le nombre CP réel du jeu.

**Pas inclus** dans les ratings (defender-dependent, hors scope build-trait) :
Element (×0.8/×1.0/×1.2), Mark (×1.15), EnemyCriticalDamageReduce, MISS
multiplier, `FinalDamageReduce` buff chain. Le PEN est l'exception : modélisé
contre un `TARGET_DEF` constant pour permettre le ranking PEN-vs-autres-stats.

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

**Accumulateur incrémental (hot path solver)** : `aggregateGearBuckets` re-somme
les 8 pièces à chaque combo. Le solver évite le re-sum des 6 pièces invariantes
(weapon..accessory) par talisman : `aggregatePrefixBuckets` les agrège **1× par
itération accessory**, puis `computeFinalStatsFromPrefix` clone ce prefix et n'ajoute
que talisman → EE → gemOverride → setBonuses. **Bit-identique** au full-array :
l'addition flottante est associative à gauche, le prefix cloné est la même somme
partielle, et l'ordre de slot est préservé (l'EE, à l'index 7 après le talisman,
est ré-ajouté par talisman plutôt que pré-sommé — sinon l'ordre casserait). Les
helpers `addPieceToBuckets`/`addGemOverride`/`addSetBonuses` sont partagés entre les
deux chemins → identité par construction. Critique car `Math.trunc` dans
`composeMultStat` ne pardonne pas une dérive ULP ; couvert par un test d'équivalence
dédié + le test solveChunk 0-diff end-to-end.

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

**Pré-filtrage du pool armor** (`armorSetWhitelist`, `precomputeContext`) — complémentaire
au mid-tree. Quand les plans contraignent **entièrement** l'armor (`Σcount === ARMOR_SLOTS`
sur un plan → 0 slot libre, ex. `2pc A + 2pc B` ou `4pc A`), les pools helmet/armor/gloves/boots
sont élagués aux seuls sets admissibles (union des conds des plans pleins) **avant** d'entrer
dans le cartésien. Un plan partiel (slots libres) sous `allowBrokenSets=true` n'élague rien
(un filler peut être n'importe quoi → `null` = pas de prune). Sous `allowBrokenSets=false`, les
slots libres doivent compléter un set → la whitelist = sets requis ∪ *sets formables* (présents
dans ≥2 slots armor, `computeFormableSets`), et un check leaf `allSetsComplete(setCount)`
(profondeur boots, `remaining===0`) rejette les builds à singleton/pièce set-less (formes valides :
un 4pc OU deux 2pc). Slots **Keep current** verrouillés exemptés. Helpers purs testés isolément.

### 2.11 Combat Power + Upg filters (appliqués in-loop quand posés)

CP est cher (~20× cheap rating) et `upg` dépend du current loadout du héros,
donc aucun des deux ne peut être un `FilterSpec` compilé du hot loop. MAIS
quand un filtre `cp`/`upg` est **posé**, il est appliqué **dans la boucle**,
y compris en SOLVE — sinon le heap se remplit du top-K **par score** puis
`finalizeBuilds` retire a posteriori les builds hors-filtre, évinçant des
builds valides classés juste hors top-K (perte de recall / sous-retour ; c'était
le bug corrigé en `a6aa67b`, cf. solver.md §2/§5).

- **CP / SOLVE CP** : CP calculé in-loop (sort key), filtre `ratingFilters.cp`
  appliqué tout de suite.
- **CP / SOLVE** : si `cpFilter` est posé, CP est calculé in-loop et le filtre
  rejette tôt ; sinon CP reste lazy (calculé pour le top-N à l'affichage seulement).
- **Upg** : `equippedUids` est résolu en amont ; quand `upgFilter` est posé,
  `upg` est calculé in-loop et filtré avant le push.
- **Finalize** : `finalizeBuilds` (re)calcule CP/upg pour l'affichage et
  ré-applique les filtres — devenus des **no-op idempotents** puisque déjà
  appliqués in-loop. `compileFilterSpecs` skip `cp`/`upg` (gérés à part).

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
fetch runtime côté renderer). Rafraîchies **au lancement** par `data-sync.ts`
(`apps/desktop/src`) en deux modes :
- **checkout** (dev / machine mainteneur) — copie depuis un checkout local
  d'outerpedia, gardé par mtime, zéro réseau ;
- **repo** (build packagé) — télécharge les 29 tables + inputs de build depuis
  le repo public `Sevih/outerpediaV2` via le CDN jsDelivr, gaté sur le SHA du
  dernier commit (`api.github.com/.../commits/main`), puis relance `build.mjs`.
  Permet de suivre les patchs **sans publier de nouveau build**. Dégrade
  proprement hors-ligne (utilise le `data/derived` déjà en cache).

`build.mjs` lit ses dirs via env (`OUTERPEDIA_GAME_DIR` / `OUTERPEDIA_SYNC_DIR`
/ `OUTERPEDIA_DERIVED_DIR`) — défauts = `data/game` + `data/derived` + checkout.

`sub-ticks.json` (dérivé) : valeurs par tick des subs ATK/DEF/HP flat+% par étoile
(5★/6★), extraites de `subStatPools` (outerpedia `data/equipment/item-stats-detail.json`
— les **subs**, à ne pas confondre avec les mains de `statRanges.json`). Alimente
l'encadré Builder "Sub tick value" (rentabilité flat vs %, `lib/subValue.ts`). Le 2ᵉ
encadré "Damage / +1%" (`lib/dmgValue.ts`) compare le gain de dégâts de +1% des stats
de scaling/CHD/DMG inc via `computeCheapRatings` (modèle dégâts RE binaire 1.4.9).

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
ces locks verts. 9 héros couverts aujourd'hui :
- Flamberge (2000050)
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
| `packages/core/test/parse.test.ts` | 11 tests — parser substats/main/talisman/EFF flat, scaling enchant, singularity |
| `packages/core/test/equip.test.ts` | 11 tests — `equipItem`/`unequipItem` : pose sur slot vide, **déplacement** du slot occupé (même perso), no-op (déjà équipé / item inconnu / non-gear), `charUid "0"` = unequip, scope du déplacement (autre perso/autre slot intacts), **immutabilité** de l'entrée |
| `apps/renderer/test/solver.test.ts`     | 74 tests — gem pool/score/alloc/delta (+ eligibility filter), gem override equivalence, **set-bonus hoist equivalence**, cheap ratings (+ CRC clamp, **damage-stat scaling atk/def/hp + secondary additive**, **noCrit heroes**), score normalization (+ CRC clamp), reforge sim (+ 6★ ascended budget, Talisman/EE rejection), top-K heap, STAT_TO_PRIORITY mapping, CP clamps (skills.first, ECDR), **`makeCpEvaluator` bit-identity vs `calcBattlePower`**, **incremental bucket accumulator equivalence** (`computeFinalStatsFromPrefix` vs full-array) |
| `apps/renderer/test/gemsCapped.test.ts` | 16 tests — `allocateGemsCapped` : parité sans gemme crit, accept jusqu'à CHC 100 (overshoot ≤102), stop pile à 100, skip total au cap, split talisman/EE, delta null si rien d'utile, score ≤0 jamais pris |
| `apps/renderer/test/workerCount.test.ts` | 7 tests — `resolveWorkerCount` : défaut `hardwareConcurrency-1`, override `gs.solver.workerCount`, clamp ≥1, plafond dur 64 |
| `apps/renderer/test/transfer.test.ts`   | 8 tests — backup round-trip (snapshot fidélité, maps vides), import merge (dédup par `id`, collision garde l'existant), replace (overwrite), validation du bundle (kind/version/maps) |
| `apps/renderer/test/solveChunk.test.ts` | 3 tests — end-to-end `solveChunk` (hand-built `SolveContext`, no hero fixture) : **mid-tree set prune** (req-4pc → 1 combo scoré vs 16 brute-force ; insatisfiable → 0), **solver↔Builds 0-diff** (`finalizeBuilds` builds vs independent `computeFinalStats` + `calcBattlePower`, + deferred-ratings recompute) |
| `apps/renderer/test/setPlans.test.ts`   | 26 tests — expansion des chips (`setPicksToPlans`), `planSetIds`, `planSlots`, `planFeasible` (somme multi-cond), `setsFeasible` OR + leaf-validation à `remaining 0`, parité mono-plan req-4pc, **`armorSetWhitelist`** (prune plein vs partiel × broken on/off, OR union, plan infaisable), **`allSetsComplete`** (4pc / 2×2pc / singleton / filler set-less) |
| `apps/renderer/test/translateReco.test.ts` | 10 tests — reco→patch : mains (OR-union), effets (icônes required, null skip+warn), sets (combo→plan 1:1, combo non-résolu droppé entier), priorité substats (tiers→poids, collision de bucket, clé inconnue) |
| `apps/renderer/test/subValue.test.ts` | 5 tests — `flatVsPctTick` : verdict des deux côtés de la bascule, équivalent-flat exact, égalité pile à la bascule, garde tick %=0 |
| `apps/renderer/test/dmgValue.test.ts` | 4 tests — `dmgTickGains` : tri décroissant, monotonie delta→gain, CHC nul si crit-cap, base 0 → vide |
| `apps/renderer/test/buildAdvice.test.ts` | 16 tests — `computeAdvice` (Builds) : no-gear silencieux, missing quasi-complet (≤2) vs WIP silencieux (early-return), sets (singleton / 3-of-4), caps gaspillés — crit toléré ≤102 / PEN >100 (seuil arrondi >0), gem slots vides Talisman/EE + tip +5, upgrade agrégé (reforges non utilisés / 6★ non ascensionné / sous cap d'enhance), singularier/pluraliser |

Run : `npm test --workspaces --if-present`. **Total : 186 tests** (core 22 : parse 11 + equip 11 · renderer 164 : solver 74, solveChunk 3, gemsCapped 16, setPlans 26, transfer 8, translateReco 10, workerCount 7, subValue 5, dmgValue 4, buildAdvice 11).

### 3.4 Reverse engineering — libil2cpp.so

Formules clés viennent du dump libil2cpp.so (1.4.9 build, decompilé via
Ghidra/IDA). Adresses connues :
- `CFormula::CalcFinalStat` — RVA `0x2C59E48`
- `CFormula::CalcBattlePower` — RVA `0x2C59EE4` (approximative, voir
  [game_combat_power_formula.md](../../../.claude/projects/c--Users-Sevih-Documents-Projet-perso-outerpedia-v2/memory/game_combat_power_formula.md))

### 3.5 Sources externes

- **outerpedia-v2** (repo public `Sevih/outerpediaV2`) — source des images ET
  des tables de jeu. Le handler `/img/*` partagé (`img-cache.ts`, utilisé par
  le middleware Vite **et** le serveur Electron prod) résout en cascade :
  checkout local (dev, via `OUTERPEDIA_PATH`) → **cache disque** persistant →
  **CDN GitHub** (jsDelivr → raw.githubusercontent) + écriture en cache →
  fallback `.png`→`.webp` → 302 vers `outerpedia.com` en dernier recours.
  Chaque asset n'est donc fetché qu'une fois. Cache : `.cache/outerpedia` en
  dev (gitignoré), `<userData>/outerpedia-cache` en prod. Le préfetch fond
  (prod) réchauffe le subset `ui/` + `equipment/` (webp) une fois par SHA.
  Coordonnées repo + SHA + CDN centralisés dans `repo-source.ts`.
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
│   ├── composeBuild.ts            ← computeFinalStats(+FromPrefix) + aggregate(Gear/Prefix)Buckets (+ GemOverride)
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
