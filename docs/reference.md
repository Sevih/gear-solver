# Reference — traitements, calculs, sources

Doc dense unifiée pour quiconque doit reprendre le moteur à froid. Couvre :
1. **Le pipeline complet** (capture → parse → compose → solve), avec les
   fonctions et fichiers qui font chaque étape.
2. **Les formules** (compose final stat, CP, ratings, score, gems, reforge,
   prune par budget de combos) avec leur conventions d'unités et leur validation.
3. **Les sources** (tables jeu → tables dérivées → consommateurs, plus
   références aux dumps libil2cpp.so).

> Pour le pipeline UI du solver (panneaux, états, UX), voir [solver.md](solver.md).
> Pour le découpage des couches, voir [architecture.md](architecture.md).

---

## 1. Traitements

### 1.1 Capture (`tools/capture-steam/`)

Plugin BepInEx chargé par le client Steam (Unity Mono). Copie les réponses du serveur Outerplane
au moment où le jeu les a déchiffrées :
- Endpoints : `glb-game.outerplane.vagames.co.kr:38001` (compte/inventaire) +
  `glb-login…:38002`, via Unity BestHTTP/2.
- Encodage sur le fil : `{"msg":"<hex>"}` → hex → **XOR clé répétée
  `ASLDKGFJASPODIFJSOWEI`** → UTF-8 JSON. Le plugin n'a rien à déchiffrer : postfix sur
  `CWebManager.Log2InternalWeb` (JSON clair + path), fallback `DecryptMsg` par forme.
- Sortie : `<dossier de capture>/{user_item,user_character,…}.json` (`.cache/capture-out` en dev,
  `<userData>/capture-out` packagé). L'import manuel lit les mêmes fichiers.
- Déplacements de pièces faits en jeu (plugin 0.2.0) : le jeu ne renvoie `/user/item` qu'au lobby,
  mais chaque déplacement répond `/item/equip` ou `/item/equipAll` ; le plugin les ajoute à
  `equip-events.ndjson` (une ligne `{ seq, at, path, res }` par réponse, vidé à chaque `/user/item`),
  et l'app les plie dans `user_item.json` à chaque `GET /api/capture/status` (sondé toutes les 5 s)
  — `foldEquipEvents` d'[equip-events.ts](../apps/desktop/src/equip-events.ts), par uid seulement ;
  ce qu'elle a déjà plié est noté dans `.equip-events.applied`.

Fichiers : [Plugin.cs](../tools/capture-steam/src/Plugin.cs),
[steam-capture.ts](../apps/desktop/src/steam-capture.ts) (install + statut côté app).

### 1.2 Tables dérivées (datagen outerpedia → `data/derived/`)

La distillation vit dans le **repo outerpedia** (`datagen/generators/solver.ts`,
port fidèle de l'ancien `build.mjs` local) : elle lit les tables brutes du jeu et
émet les tables compactes consommables à `data/generated/solver/`, mirrorées ici
dans `data/derived/`. La colonne Source liste la table brute réellement chargée (plusieurs
cibles dérivent de la même table — `ItemSpecialOptionTemplet` notamment) :

| Source (table brute du jeu)          | Cible `data/derived/`     | Contenu                                                |
|--------------------------------------|---------------------------|--------------------------------------------------------|
| `ItemTemplet.json`                   | `equipment.json`          | ItemID → slot/grade/star/setId/armorSetId/name/image/effectIcon/class |
| `ItemOptionTemplet.json`             | `options.json`            | OptionID → StatOption (`{st, ap, v}`) OU IOT_BUFF reference |
| `BuffTemplet.json`                   | `buffs.json`              | BuffID → array of StatOption (per enhanceLevel)        |
| `ItemSpecialOptionTemplet.json` + curated (outerpedia) | `sets.json` | setId → levels[] → {p2, p4, p2_desc, p4_desc, breakLimitCounts, ignoreLowSet, combatEffects}, name |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `equipment-passives.json` | ItemID → {name, textByTier[1..4], statsByTier?} |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `multi-tier-passives.json`| ItemID → list of tier passives               |
| `ItemOptionTemplet.json` (IDs 15001..15054) | `gems.json`        | OptionID → {type, level, st, ap, v}                    |
| `ItemSpecialOptionTemplet.json` (groups 30000/31000) | `singularity-options.json`| OptionID → {st, ap, v, name, desc, combatOnly} |
| `ItemSpecialOptionTemplet.json` (EE groups) | `ee-passives.json` | ItemID → list of {st, ap, v, levelThreshold}           |
| `CharacterTemplet.json` etc.         | `characters.json`         | charId → {ingredients, cls, element, star, …}          |
| `ItemEnchantTemplet.json` + `SingularityEquipEnchantTemplet.json` | `enhance.json` | enhanceFactor, tierFactor, expCurves, singularity, gemSlots, reforge (fichier standalone ; `gemSlots` / `reforge` lus par `gameRulesOf`, `packages/core/src/rules.ts`) |
| `CharacterEvolutionTemplet.json`     | `progression.json`        | `evoUnlockLevel` : EvolutionLevel → niveau de déblocage (`gameRulesOf`) |
| `ExpCharacterTemplet.json`           | `exp-character.json`      | array idx 1..120 → cumulative XP                       |
| `CharacterMaxLevelTemplet.json`      | `char-level-max.json`     | `${star}|${step}` → {maxLevel, statModifierAfter100}   |
| `ArchiveBonusTemplet.json`           | `archive-bonus.json`      | `CompleteCount` → codex level (1..11)                  |
| `CharacterArchiveStatTemplet.json` (via `computeCharacterIngredients`) | `codex-curve.json` | codex level idx 0..11 → {atkPct, defPct, hpPct} |
| `ExpCharacterTemplet.json` (col TrustExp) + `TrustBuffTemplet.json` | `trust-character.json`, `trust-buffs.json` | trust system data ; `trust-buffs.json` synchronisé avec le contrat mais jamais chargé par le renderer (buffs de combat, absents de la fiche) |
| `datagen/lib/stat-keys.ts` (outerpedia ; règle `CUtilUI.IsPercentStat` / `GetStatValue` du client) | `stat-keys.json` | `ST_*` → `OAT_*` → {key (vocabulaire du contrat : `atk`, `atkPct`, `chc`, `resRate`…), percent, abbr} ; lu par un test seulement (`packages/core/test/stat-keys.test.ts`), `GAME_STAT` reste la table d'exécution |

Rafraîchir après un patch jeu : `npm run data:sync` (une fois le
`datagen:build` + `promote` d'outerpedia passés).

Le generator écrit aussi `data/derived/version.json` `{ schema, resVersion, hash, builtAt }` : `hash` est un
`sha256` du contenu de **tous** les fichiers dérivés (nom + corps, ordre d'émission fixe),
donc **stable tant que la donnée est inchangée** (un rebuild no-op ne le bouge pas). Lu côté
renderer par `loadDataVersion()` ([data.ts](../apps/renderer/src/data.ts)) et affiché en
lecture seule dans Settings → Data, précédé de `resVersion` (« game 1.11.408 · … », la version
des tables chargées ; absent d'un cache ancien). Le `hash` ne couvre pas `resVersion` : à
`hash` égal, la sync réécrit le seul `version.json` quand son corps diffère. Au changement de
`hash`, `reconcileDataHash` (`lib/storage/dataHash.ts`) élague des presets et des filtres par héros les sets et
effets que la donnée ne connaît plus (cf. [data-schema.md](data-schema.md#cycle-de-re-capture-après-patch-jeu)).


### 1.3 Parse (`packages/core/src/parse.ts`)

`parseInventory(rawUserItem, rawUserChar, game)` consomme les JSON capturés
et produit un `Inventory` typé. Chaque `GearPiece` :
- Identité : `uid, itemId, slot, setId, armorSetId, rarity, star, name, classLimit`.
- État : `breakthrough, reforgeCount, enhanceLevel, singularityLevel, ascended, locked, equippedBy`.
- Stats résolues : `main: RolledStat[]` (option + singularity + eePassive + uniquePassive)
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
- Passif unique d'arme / d'accessoire sur la fiche (`equipmentPassives[id].statsByTier`,
  palier `min(breakthrough, longueur − 1)`) : `fromBuff: true, source: "uniquePassive"`,
  écarté de l'UI comme `eePassive` (Phantasm Necrosis SPD −30 %, Briareos's Ambition
  RES +20 → +40 %).
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
7. **Skill passives** user-leveled (S1/S2/S3) + Core Fusion (Skill_23), pris
   au palier de fusion capturé (`fusionLevel`) dans `corePassiveByFusion` ;
   palier inconnu (absent ou 0) → le plus haut, comme les niveaux de skill ;
   cache sans ce champ → l'ancien `corePassive` (un bloc au max, vitesse cuite
   en plat), repli des seuls caches d'avant le 22/10/2026 (le format 2 du
   contrat ne l'émet plus). Sa vitesse en taux (`spdPct`, Snow / Lisha fusionnées +4,3 %)
   multiplie la vitesse totale, en dernier : `trunc(total × (1000 + taux‰) / 1000)`.
8. **Limit Break** modifier (CharacterMaxLevelTemplet, amplifie l'interp lv>100).

Output : `{noGearStats, intrinsicStats, scaling}` où `scaling` carry les
ingrédients per-axe (ATK/DEF/HP/EFF/RES) pour permettre l'ajout de gear
plus tard via `composeMultStat`, et `scaling.spd` = `{ value, rateBase, buffPct }`,
la vitesse avant son taux, la part qu'un taux d'équipement multiplie (base + évo +
éveil IOT_STAT, sans les buffs OAT_ADD) et le taux (`noGearStats.spd` l'a déjà
appliqué).

### 1.5 Compose final stats (`apps/renderer/src/lib/composeBuild.ts`)

`computeFinalStats(baseline, scaling, pieces, game, gemOverride?)` ajoute
le gear par-dessus le no-gear baseline. Couvre :

1. `aggregateGearBuckets(pieces, game, gemOverride?)` — agrège mains/subs/sets
   en quatre buckets : `flat`, `pct`, puis les `fromBuff` en taux (`buffPct`) et
   en plat (`buffFlat`) — séparation in-game CalcFinalStat (`BuffValueRate`,
   `BuffValue`).
2. Per-axe compound via `composeMultStat(scaling, gearFlat, gearPct, gearBuffPct,
   gearBuffFlat)` pour ATK/DEF/HP/EFF/RES : un appel au `calcFinalStat` du core
   (une seule copie de la formule), `gearBuffFlat` ajouté au `buffValue`.
3. Additive simple pour CHC/CHD/PEN/DMG±/CritDmgRed ; CHC bornée à [0, 100] comme
   la fiche du client (`CStatValue.SetFinalValue`, [0, 1000] brut), la somme non
   bornée gardée dans `critRateUncapped` pour la réallocation crit-cap des gemmes
   (`CRC_OVERSHOOT_CEIL`) et le conseil « wasted over the cap ». SPD : vitesse avant
   taux (`scaling.spd.value`) + gear plat + plat de buff (`buffFlat.spd`, mains
   d'EE) + set % (`floor(scaling.spd.rateBase × pct / 100)` : le taux d'objet
   multiplie base + évo + éveil, pas le +10 SPD du Skill_8), puis le taux de buff
   appliqué une fois à ce total (`applySpdRate`, même règle que le no-gear) :
   `scaling.spd.buffPct` (héros) + `buffPct.spdRate` (vitesse en taux d'un
   `fromBuff` d'équipement, Phantasm Necrosis −30 %), soit
   `trunc(total × (1000 + héros‰ + équipement‰) / 1000)` ; additive simple quand
   le taux est nul. La RES en taux d'un `fromBuff` (Briareos's Ambition) arrive
   dans `buffPct.effRes`, lu en `gearBuffPct` ; un `fromBuff` plat (ATK, EFF en
   OAT_ADD) dans `buffFlat`, lu en `gearBuffFlat`.
4. **Gem override** (solver uniquement) : skip les subs des Talisman/EE et
   ajoute les deltas `{flat, pct}` pré-agrégés à la place. Voir §2.4.

Fichier : [composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts).

### 1.6 Solver (`apps/renderer/src/lib/solver/`)

Pipeline détaillé dans [solver.md](solver.md). Résumé :

- **Orchestrator** (main thread) — pool de Web Workers, partition, fan-out/in.
- **Worker** — instance d'engine, calcul d'un chunk.
- **Engine** — `prepareContext + solveChunk + finalizeBuilds`. Phases 1-6 :
  précompute → pools → prune budget → cartesian + set-prune → compose + ratings + heap → CP.

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
`writeFileSync` du `user_item.json` capturé, refus 409 si le plugin Steam est actif dans le jeu : l'app
suit alors seule les déplacements faits en jeu, cf. §1.1). Client :
[apps/renderer/src/equip.ts](../apps/renderer/src/equip.ts) (`equipPieces` pour l'« Equip build » du
Builder et l'Apply locally de la Worklist, `equipAssignments` pour son Apply all).

---

## 2. Calculs

### 2.1 CalcFinalStat (`composeMultStat` + `composeCharStats::calcStat`)

Reverse-engineered de `CFormula::CalcFinalStat` (libil2cpp.so 1.4.9, RVA
`0x2C59E48`). Validé 0-diff sur 11/11 ATK/DEF/HP stats × 5 chars + EFF/RES
sur G.Beth/Notia (core fusion +50% EFF baseline 120 → 255 in-game).
Re-vérifié sur le dump 1.4.14 (2026-08-21) : même signature, même taille de
fonction (0x9C), RVA déplacée à `0x2CB1C6C`.

La signature binaire porte 13 paramètres, dont deux couches **absentes du
modèle** (toujours 0 côté app) : `_nSpawnAdvantageRate` (bonus de spawn des
monstres de donjon, jamais côté joueur) et `_nMonadEnchantValue` /
`_nMonadEnchantValueRate` (nœuds "Monad Enhancement" du mode Monad Gate,
`MonadGateEnchantNodeTemplet` — bonus %/flat ATK/DEF/HP/CRC/CHD/… portés par
`CCharacterData.MonadGateEnchantNodeList`, présumés actifs uniquement dans ce
mode ; à re-valider contre une fiche in-game si un lock dérive).

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
| awakValue    | sum_flat             | geas IOT_STAT flat adds (seule source d'éveil, tous axes) |
| awakPct      | sum_rate             | geas IOT_STAT % bonuses                                 |
| transcendPct | sum_rate             | TranscendByStar.{atkPct,defPct,hpPct} row matching star |
| gearPct      | sum_rate             | aggregated `pct.{atkPct,defPct,hpPct}` from gear        |
| gearFlat     | combined             | aggregated `flat.{atk,def,hp}` from gear                |
| buffValue    | combined             | OAT_ADD buffs (classe, skill_8, geas IOT_BUFF, passifs de skill / noyau : +EFF de classe, geas [141] +50 EFF ; 0 en ATK/DEF/HP dans la donnée actuelle) + gear `buffFlat.*` |
| buffPct      | part2 (outermost)    | classPassive + skill_8 + geas IOT_BUFF + skill passives + gear `buffPct.*` |
| codexPct    | codex term, baseValue| archive bonus                                           |

**SPD** (`scaling.spd`) : le taux d'objet (set Vitesse, OAT_RATE) multiplie
`rateBase` = base + évo + éveil IOT_STAT, le `sum_flat` du client — les buffs
OAT_ADD (Skill_8 +10 SPD de Claire, Faenan, Delta…) restent dans `combined` :
Claire en 4P Vitesse = `trunc(99 × 1,25)` + 10 = 133, pas `trunc(109 × 1,25)` = 136.
Puis l'étage externe —
`final = trunc((vitesse avant taux + gear) × (1000 + buffPct) / 1000)`, où
`buffPct` est la somme des taux de vitesse de la fiche (le passif de noyau au palier
de fusion, Snow / Lisha fusionnées 43 ‰, plus l'équipement `buffPct.spdRate`,
Phantasm Necrosis −300 ‰ : Snow fusionnée l'arme en main = `trunc(total × 0,743)`). Snow lv1 = `trunc(133 × 1,043)`
= 138, pas 133 + 6 ; avec +40 SPD plats à lv100, `trunc(189 × 1,043)` = 197.

Fichier : [compose-stats.ts](../packages/core/src/compose-stats.ts) +
[composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts) (gear-side).

### 2.2 CalcBattlePower (CP)

Reverse-engineered de `CalcBattlePower` (libil2cpp.so 1.4.9, RVA `0x2C59EE4` ;
`0x2CB1D08` en 1.4.14, signature inchangée), validé 0-diff
sur 5 chars (LB0/1/2/3). Implémentation : [cp.ts](../apps/renderer/src/lib/solver/cp.ts).

**Float32** : le client calcule en `float` ; chaque opération est portée telle
quelle, dans son ordre, sous `Math.fround`, constantes comprises (`1.7f`, `1.05f`,
`0.15f`, `0.25f`, `0.001f`), comme `calcNoGearBattlePower` d'outerpedia (0 écart
avec lui sur 200 000 fiches tirées). Les entrées brutes (affiché × 10) sont
arrondies à l'entier, comme côté client. En double, ±1 sur ~0,5 % des fiches.

**Hot path SOLVE CP** : `makeCpEvaluator(consts)` pré-capture les bonus additifs
constants par solve (`starBonus`, `skillSum`, `eeBp`, `fusionBp` — tous entiers
exacts) et retourne une closure `(stats, talisman) → cp`. Évite l'allocation d'un
objet `CpArgs` et la re-dérivation des constantes à chaque combo. **Bit-identique**
à `calcBattlePower` : même `cpFrom`, les constantes hoistées sont des entiers
(exacts en float32). Test d'identité dédié.

**Conventions critiques** :
- **CRC capped at 100%** AVANT entrée dans la formule.
- CRC/CHD/PEN/DMGup/DMGRed/ECDR : valeurs RAW (× 10 du % affiché).
  Le code reçoit le display value et multiplie par 10 en interne.
- EFF/RES : entier display direct.

**Formule** (chaque pas arrondi en float32, voir plus haut) :
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

CP = floor(((((atkPart + defPart) + (starBonus + skillSum × 100)) + eeBp) + ooBp) + fusionBp)
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
[`docs/damage-calc/binary-formulas-1.4.9.md`](../../legacy/outerpedia/docs/damage-calc/binary-formulas-1.4.9.md)**
(checkout legacy d'outerpedia, `dev/legacy/outerpedia`)
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
skillFactor = bestSkill.factor / 1000      ← meilleur skill du perso (S1/S2/S3 niveau max, bursts inclus) ; 1 si donnée absente
turnFactor  = rotation.factorPerTurn / 1000 ← facteur moyen par tour de la rotation par cooldowns ; skillFactor si absente
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
| `dmg`  | `ATK × drFactor × penMult × skillFactor` | Hit attendu du MEILLEUR skill vs DEF=2000 |
| `dmgs` | `ATK × drFactor × penMult × turnFactor × SPD` | DPS sur la rotation par cooldowns (S3/S2/S1) |
| `mcd`  | `ATK × mcdFactor × penMult × skillFactor` | Max crit du meilleur skill (assume 100% CHC) |
| `mcds` | `ATK × mcdFactor × penMult × turnFactor × SPD` | Max DPS sur la rotation par cooldowns |
| `dmgh` | `HP × drFactor × penMult`              | Damage HP-scaling (Aer S3, Caren, …) — SANS skillFactor (référence 100 %) |

Conventions :
- `CRC` et `CHD` sont en **DISPLAY percent** (35 = 35%) ; le diviseur /100 les
  rend décimaux pour les produits.
- **CRC cappée à 100%** in-game — overflow wasted. `FinalStats.critRate` est
  déjà bornée à [0, 100] (fiche, affichage, filtres, scaling secondaire `crc` de
  Regina) ; la somme brute est dans `critRateUncapped` (crit-cap des gemmes,
  conseil « wasted over the cap »).
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
reste un miroir fidèle de l'in-game (CHC de la fiche, bornée à 100 %), donc SOLVE CP
optimise bien le nombre CP réel du jeu.

**Pas inclus** dans les ratings (defender-dependent, hors scope build-trait) :
Element (×0.8/×1.0/×1.2), Mark (×1.15), EnemyCriticalDamageReduce, MISS
multiplier, `FinalDamageReduce` buff chain. Le PEN est l'exception : modélisé
contre un `TARGET_DEF` constant pour permettre le ranking PEN-vs-autres-stats.

**Facteur de skill (`skillFactor`, 2026-09-05)** — la colonne Dmg n'est plus « un hit à
facteur 100 % » mais **le hit attendu du skill le plus puissant du perso** : `dmg`,
`dmgs`, `mcd`, `mcds` sont multipliés par `bestSkill.factor / 1000` (`characters.json`,
émis par le générateur solver d'outerpedia depuis son moteur damage : max sur S1/S2/S3
**au niveau max**, états burst 1..3 inclus quand ils remplacent le skill burstable, d'un
facteur = `DamageFactor` du niveau × facteur total de l'état — Σ des events des clips
résolus, sinon Σ tables comblée à 1000 ‰ sous 990 ; **multi-hit = somme des hits**).
Le facteur est une **constante par perso** : le classement d'un solve mono-perso ne bouge
pas d'un iota — la valeur ajoutée est le nombre affiché et la comparaison inter-persos.
Il s'applique APRÈS `dmgStat`/`dmgSec`/`noCrit` (il multiplie toute la base) ; `dmgh` reste
la référence HP à facteur 100 %. Repli EXPLICITE : perso sans `bestSkill` (donnée
absente / snapshot antérieur au champ) → ×1,00 **et** tooltip + badge ambre « ×1 » dans
l'en-tête de colonne (`lib/dmgSkill.ts`) — jamais un 0 silencieux. Le gagnant (S1/S2/S3,
« B1..B3 » = burst) est affiché en badge dans l'en-tête Dmg/DmgS et dans les tooltips
(`ratingTitle`), avec la mention « approximate » si sa chaîne de hits est irrésolue
(`unresolvedHits`). **Assumé, non modélisé** : les DoT (un perso dont le vrai « meilleur
hit » est un DoT — Gnosis Beth — est sous-estimé par un facteur de hit direct), les buffs
et chaînes. Validé contre le
damage calculator d'outerpedia (`buildSkillReport`, mêmes stats, DEF 2000, crit 0 %) :
Rhona S3 ×1,67, K S2-burst 1 ×2,39, Primine S1 ×0,86 — exacts.

**Rotation par cooldowns (`turnFactor`, 2026-10-22)** — les colonnes PAR TOUR `dmgs` et
`mcds` (dégât × SPD) ne prennent plus le meilleur hit mais `rotation.factorPerTurn / 1000`
(`characters.json`, émis par outerpedia à côté de `bestSkill`) : le facteur moyen par tour
quand le perso lance à chaque tour le skill prêt le plus fort (S3 > S2 > S1, cooldowns
`Cool`/`StartCool` du jeu, sans burst, AP ni DoT), sur un cycle de `cycle` tours. Les
colonnes PAR HIT `dmg` et `mcd` gardent `skillFactor`. Appliqué au même endroit que
`skillFactor` (`computeCheapRatings(…, skillFactor, turnFactor)`, `turnFactor` vaut
`skillFactor` par défaut) ; constante par perso, le classement mono-perso ne bouge pas.
Repli : snapshot sans `rotation` → le facteur du meilleur skill (`turnSkillFactor`,
`lib/dmgSkill.ts`), signalé dans l'infobulle. L'infobulle DmgS/McdS donne la séquence
(« S3 ×1, S2 ×2, S1 ×1 over 4 turns ») et « approx » quand `rotation.approx` ; le badge
d'en-tête reste le skill gagnant. Ex. Tamamo-no-Mae : ×1,735 par tour contre ×2,004 pour
son meilleur hit (S2).

### 2.4 Score (`ratings.ts::computeScore`)

```
Score = Σ over priority[key] × (effective(finalStats[key]) / STAT_NORMS[key]) × 100
  where effective(v) = key === "critRate" ? min(v, 100) : v
```

- `priority` : keyed par clés engine (`atk`, `critRate`, `critDmg`, …), valeurs `-1..3`.
- `STAT_NORMS` : valeurs de référence endgame (atk=4000, hp=30000, critRate=100, …).
- Normalisation rend les stats de magnitude différentes (HP en milliers vs
  CHC en pourcents) comparables.
- Échelle ×100 pour rendre les Scores lisibles (~50-500 typique).
- **Non arrondi** : c'est la clé de tri (heap + merge, ex aequo départagés par
  `pieceUids`) ; la table et la bibliothèque l'arrondissent à l'affichage seulement.
- Score négatif possible (priority -1 sur stat élevée).
- **CRC clampée à 100%** : l'overflow ne compte pas dans le score (cohérent
  avec le cap in-game et avec le clamp dans `computeCheapRatings`).

### 2.5 Per-roll scoring (`ROLL_NORMS`)

**Constante séparée** de `STAT_NORMS` (qui sert à Score sur final stats).
Utilisée par `priorityScoreOf`/`magnitudeScoreOf` (prune par budget de combos)
et `scoreGemPool` qui scorent des **rolls individuels**, pas des totaux endgame.

```
roll_score = priority[user_key] × (roll.value / ROLL_NORMS[roll.engine_key])
```

Sized pour un max-roll sur un sub de +15 T4 :
- Flats : `atk=300, def=100, hp=1500, spd=20, eff=50, res=50`
- Percents : `atkPct=40, defPct=40, hpPct=40, critRate=20, critDmg=40, …`

Sans cette séparation, scorer un roll d'ATK% (24% raw → ~2.4 display) avec
`STAT_NORMS.atk=4000` donnerait un score 50× plus petit qu'un roll de CHC
+3% scoré avec `STAT_NORMS.critRate=100`. Bug réel attrapé par les tests.

**Source de vérité unique** : `ROLL_NORMS`/`STAT_NORMS`/`STAT_TO_PRIORITY` sont
**dérivés** d'un registre unique [`statRegistry.ts`](../apps/renderer/src/lib/statRegistry.ts)
(`STAT_AXES`, typé contre `StatType`), `ratings.ts` ne fait que les ré-exporter. Les clés
sont désormais **unifiées** sur les noms ENGINE (plus de `crc`/`chd`/`res`/`dmgRed`/`critDmgRed`
côté `FinalStats`/`priority` — c'est `critRate`/`critDmg`/`effRes`/`dmgReduce`/`critDmgReduce`),
donc `STAT_TO_PRIORITY` ne fait plus que le **repli flat/%→axe** (`atkPct → atk`, `defPct → def`,
`hpPct → hp`) ; tout le reste est identité. Un test (`statRegistry.test.ts`) verrouille la
couverture + la parité numérique.

### 2.6 Set bonuses (`composeBuild.ts::computeSetBonuses`)

Pour chaque armorSetId présent ≥ 2× dans les pieces, les lignes lues viennent de
`wornSetRows` (`packages/core/src/set-level.ts`, la seule fonction de niveau de set,
aussi lue par le panneau Effects du Builder et par la clé de dominance). La règle est
celle du contrat (outerpedia en est la source, en-tête de son `datagen/generators/solver.ts` ;
client `CStatValue.SetSetItemValue`, `CItem.SetOptionLevel`) :
- Niveau d'une pièce (`pieceSetLevel`) = la ligne de `levels[]` dont `breakLimitCounts`
  contient son breakthrough (aujourd'hui niveau 1 = BT0-3, niveau 2 = BT4).
- Le 2pc (count ≥ 2) lit la ligne du niveau **minimum des 2 meilleures** pièces, le 4pc
  (count ≥ 4) celle du **minimum des 4 meilleures** : `[4,4,3]` → 2pc niveau 2 ;
  `[4,4,3,3]` → 2pc niveau 2 + 4pc niveau 1.
- `ignoreLowSet` : si la ligne du 4pc le porte, le 2pc est retiré quand il porte la même
  stat (le client compare stat par stat), ou, pour un effet de combat sans stat, quand le
  4pc de cette ligne en est un aussi (`combatEffects.p4`, `p4_desc` pour un cache sans). Aujourd'hui Pénétration, Vitesse et Explosion au
  niveau 1 (2pc vide, le 4pc vaut tout le bonus), Fortification au niveau 2 (4pc vide,
  rien n'est retiré). Vitesse `[4,4,3,3]` → 25 %, pas 13 + 25.
- Skip si `p2`/`p4` est nul ou `ST_NONE` (effet de combat, ex. Counterattack qui stocke
  son effet en `desc` plutôt qu'en stat) : rien ne compte sans `st`.
- **Repli** (cache synchronisé avant que le contrat porte `breakLimitCounts` /
  `ignoreLowSet`, ou breakthrough qu'aucune ligne ne liste) : l'ancienne règle exacte,
  niveau 2 seulement si toutes les pièces du set sont BT4, pour le 2pc comme le 4pc, sans
  `ignoreLowSet`. Jamais la règle par pièce sans `ignoreLowSet` : Vitesse `[4,4,3,3]`
  vaudrait 38 %.

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
inclus ; le gear équipé sur un autre héros est gaté par `equippedScope`
(`none` = exclu, `lower` = seulement si le porteur est strictement plus bas
dans le ranking de priorité via `isLowerPriority`, `all` = inclus) ; le gear
sur un héros exclu n'est jamais compté. Sans ce gating, le solver pouvait
proposer des gemmes qui exigent physiquement de désé­quiper le Talisman/EE
d'un héros que l'utilisateur venait juste d'exclure.

**Scoring** : `score = priority[user_key] × (value / ROLL_NORMS[engine_key])`.
Trié desc.

**Allocation greedy** : top-K pour `K = talismanSlots + eeSlots` (4 ou 5 selon
`enhanceLevel ≥ 5`). D'abord les gemmes de `score > 0` dans leur ordre, puis
les **remplissages** : les gemmes de score **exactement 0** (stat hors priorité ;
jamais une priorité négative, jamais une stat sous un `max` de `statFilters`),
triées par le gain relatif de `dmg` qu'elles apportent au build équipé
(`gemDmgGains`, `computeCheapRatings` avec `dmgStat`/`dmgSec`/`noCrit`, pesé une
fois par solve), puis par `value / ROLL_NORMS`. Clé portée par `ScoredGem.fill`,
même parcours (`pickOrder`) dans les quatre allocateurs ; une gemme crit de
remplissage suit le même saut au cap CHC. Pas de remplissage sans aucune
priorité (fallback ci-dessous).

**Pré-agrégation** : `allocateGems(scored, ts, ee)` retourne la répartition
affichée et son `{flat, pct}`, directement consommable par `aggregateGearBuckets`. Évite N×10
appels `resolveStat` dans le hot loop.

**Fallback selon le mode** :
- **SOLVE** + priority vide → tous les scores collapsent à 0 →
  `allocateGems` retourne un delta `null` → `computeFinalStats` sans override →
  fallback sur les `subs` des pieces (= gems actuellement socketés).
  Préserve la stat in-game-équivalente quand le joueur n'a pas exprimé d'intention.
- **SOLVE CP** + priority vide → l'engine passe à `scoreGemPool` le vecteur
  de poids CP `cpStatWeights(...)` (ΔCP pour un bump d'un ROLL_NORM de chaque
  stat, évalué sur le build courant) en guise de priorité, qui ordonne le pool ;
  l'allocation passe ensuite par `allocateGemsByCp` : gemme par gemme, celle
  qui monte le plus le CP du build équipé avec les gemmes déjà posées
  (réévalué à chaque pas, plafond CHC compris ; une gemme sans apport de CP
  seulement une fois les utiles épuisées), une fois par variant et par solve. Nécessaire parce que "max CP"
  sous-entend "use the best gems available" — préserver les gems actuels désactiverait silencieusement
  l'optimisation gem pour le cas d'usage typique du mode CP.
- **N'importe quel mode** + priority non-vide → `priority × value / norm`
  pour les deux modes (la priorité utilisateur domine, les poids CP ne servent pas).

### 2.8 Prune par budget de combos (`engine.ts`, dans `precomputeContext`)

Heuristique pour borner la search space. **Crucial** : un prune *en pourcentage*
par slot ne borne PAS le produit (30 % de sept pools ~40-50 = encore ~7e8 combos,
mesuré : 703 M / 142 s en mode Score avec priorité). On utilise donc un **budget
de combos absolu** : `allocateComboBudget` water-fill les keep-counts par slot pour
que `∏ keep ≤ COMBO_BUDGET × topPct/30` (petits slots gardés entiers, le surplus
coule vers les gros slots d'armure). Le slider Top% scale le budget ; à 100 % on
court-circuite vers exhaustif.

Le budget s'applique à **toutes** les branches ; seul le **classement par slot**
diffère (un `scoreOf` passé à `keepTopN`) :
1. **priorité explicite** (Score ou CP) → `priorityScoreOf` : `Σ priority × value /
   ROLL_NORMS` sur les rolls non combat-only (et hors mains en % d'un axe sans variante %,
   `isPctRollWithoutNorm` ; idem en 3).
2. **CP sans priorité** → proxy CP (`cpEval` de la pièce dans le build courant). En SOLVE CP,
   avec ou sans priorité (branches 1 et 2), **pin** de la pièce équipée (le solve ne peut
   jamais rendre un CP < l'équipé).
3. **Score sans priorité** → `magnitudeScoreOf` (magnitude brute des rolls) : pas
   d'objectif, mais le produit doit rester borné.

**Protection des sets requis** + **pin** : `keepTopN` rajoute le **meilleur membre**
(top-score) de chaque set `req-2pc`/`req-4pc` manquant à la slice, plus les UID pinnés
(SOLVE CP uniquement), même hors budget. Rajouter TOUS les membres (l'ancien
comportement) explosait le budget de combos. Sans cette protection, une pièce
low-score membre d'un set requis serait éliminée → `checkSetsFeasible` tuerait
silencieusement chaque combo ("no builds" sans indice). Le pool effectif peut
donc dépasser la part du budget d'au plus une pièce par set requis — intentionnel.

### 2.9 Reforge simulation (`engine.ts::simulateReforges`)

Budget de reforges par pièce :
- 1★→6★ non ascended : `star` reforges (1..6).
- **6★ ascended (Singularity)** : `star + 3 = 9` reforges. Le +3 est
  exclusif aux 6★ Singularity ; les autres rangs n'ont pas d'ascension.

Pour chaque pièce avec `remaining = maxReforges - reforgeCount > 0`,
distribue les reforges restantes greedy par `poids × per-tick value`.
Le poids est la priorité de la stat ; sans priorité, le poids CP par unité du sub
(`reforgeTickWeights` : ΔCP d'un roll de taille `ROLL_NORMS` ajouté au build équipé du
héros, divisé par cette norme), ou à défaut `1 / ROLL_NORMS`. Jamais la valeur brute
entre stats (180 PV plats contre 4 % gagnaient tous les ticks).
Cap à **LV6 ticks par sub** (observé en réel). Tie-break sur le tick normalisé
(`per-tick / ROLL_NORMS`).

Mutations contenues sur un clone — l'inventaire original n'est jamais
modifié.

**Projection de mode reforge (`projectPieceForReforge`)** — le preview Builder
projette chaque pièce vers un plafond endgame : rescale du main
(`projectMainToCeiling`) + ticks de reforge (`simulateReforges`). Le plafond est
celui de la **pièce dans le mode** (`pieceReforgePlan`, min des deux) : seule une
**6★ `unique`** ascende (`CItem.IsSingularityActivate`) et va au plafond du mode
(+10 R6 classic, +10 R9 ascended10, +15 R9 ascended) ; une pièce **sous 6★, ou
une 6★ non `unique`**, s'arrête à **+10**, à **son nombre de reforges**
(`maxReforgesOf` : l'étoile sous 6★, 6 pour une 6★), **sans passif**, quel que
soit le mode. En mode **ascended uniquement** (et sur une pièce qui ascende), on ajoute aussi le
**passif de singularité inconditionnel** (`addProjectedSingularity`) — DMG+
sur arme/accessoire (`ST_DMG_BOOST`), DMG- sur les 4 armures
(`ST_DMG_REDUCE_RATE`) — à la **meilleure valeur** de `singularity-options.json`
(DMG+ 50 %, DMG- 25 %, cohérence verrouillée par test). Route via
`fromBuff` → `buffPct.dmgUp`/`dmgReduce`, donc compte dans le score ET la CP, pas
juste l'affichage. Une pièce **déjà ascended** garde son **vrai roll** (jamais
écrasé par le plafond). Talisman/EE intouchés (pas d'ascension).

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

Les tables brutes vivent dans le datamine d'outerpedia ; l'app ne voit que les
21 artefacts dérivés. Rafraîchis **au lancement** par `data-sync.ts`
(`apps/desktop/src`) en deux modes :
- **checkout** (dev / machine mainteneur) — copie depuis un checkout local
  d'outerpedia (`data/generated/solver/`), gardé par le hash de version.json
  (à hash égal, seul un version.json différent est recopié), zéro réseau ;
  les 21 fichiers sont lus avant toute écriture : un artefact absent ou
  illisible refuse la synchro et garde le cache, comme `data/sync.mjs` (même
  liste, `apps/desktop/src/solver-files.json`) ;
- **repo** (build packagé) — télécharge les 21 artefacts depuis le repo public
  `Sevih/outerpedia` via le CDN jsDelivr, gaté sur le SHA du dernier commit
  (`api.github.com/.../commits/main`). Permet de suivre les patchs **sans
  publier de nouveau build**. Chaque artefact téléchargé doit se parser en
  JSON, sinon rien n'est écrit. Dégrade proprement hors-ligne (utilise le
  `data/derived` déjà en cache, s'il est complet).

Dans les deux modes, un cache ne compte que si les 21 fichiers y sont ;
l'écriture se fait en deux temps (tous les `.tmp`, puis les renommages,
version.json en dernier) et un échec d'écriture rend un statut `error` qui
nomme le fichier ; une seule synchro à la fois (un appel pendant qu'une
synchro tourne reçoit sa promesse).

`sub-ticks.json` (dérivé) : valeurs par tick des subs ATK/DEF/HP flat+% par étoile
(5★/6★), recomposées par le generator solver d'outerpedia depuis `ItemOptionTemplet`
(les **subs**, à ne pas confondre avec les mains de `statRanges.json`). Alimente
l'encadré Builder "Sub tick value" (rentabilité flat vs %, `lib/subValue.ts`). Le 2ᵉ
encadré "Damage / +1%" (`lib/dmgValue.ts`) compare le gain de dégâts de +1% des stats
de scaling/CHD/DMG inc via `computeCheapRatings` (modèle dégâts RE binaire 1.4.9).

**Tables critiques pour la math** :
- `CharacterTemplet.json` — base stats, skill blocks, class passive
- `CharacterEvolutionStatTemplet.json` — evolution rows
- `CharacterTranscendentTemplet.json` — transcend % bonuses
- `CharacterMaxLevelTemplet.json` — LB modifiers
- `ArchiveBonusTemplet.json` — codex bonuses
- `CharacterAwakeningNodeTemplet.json` + `CharacterAwakeningLevelTemplet.json` — geas (nœuds + paliers)
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
| `packages/core/test/ee-passive.test.ts` | 4 tests — passifs d'EE sur le vrai `ee-passives.json` : Eclipse de Fatal (2000078) sans main `eePassive` à +0, CHD +30 % `fromBuff` à +10 ; entrée `levelThreshold: 1` d'Edelweiss (2000072, PV +35 %) dès +0 ; garde-fou de contrat (chaque clé = item `exclusive` d'`equipment.json`, entrées `st`/`ap`/`v`/`levelThreshold` typées) |
| `apps/renderer/test/solver.test.ts`     | 117 tests — gem pool/score/alloc/delta (+ eligibility filter), gem override equivalence, **set-bonus hoist equivalence**, cheap ratings (+ CRC clamp, **damage-stat scaling atk/def/hp + secondary additive**, **noCrit heroes**), score normalization (+ CRC clamp, **PEN clamp 100 %**), reforge sim (+ 6★ ascended budget, Talisman/EE rejection), **projection ascended du passif de singularité** (DMG+/DMG- par slot, classic = absent, non-écrasement d'un vrai roll, Talisman/EE intouchés), top-K heap, STAT_TO_PRIORITY mapping, CP clamps (skills.first, ECDR), **`makeCpEvaluator` bit-identity vs `calcBattlePower`**, **incremental bucket accumulator equivalence** (`computeFinalStatsFromPrefix` vs full-array), **worklist claims** (pièce FREE réclamée par un héros mieux classé = exclue, réclamée par le héros lui-même = conservée), **plancher "Maxed only"** (`maxedFloorOf` / `meetsMaxedFloor` : off / +10R6 / +10R9 / +15R9, plafond de la pièce — 5★ à +10 R5, 6★ non `unique` à +10 R6, sans étoile = plancher du mode —, talisman gaté sur l'enhance seul), **`collapseTalismanVariants`** (≤ k builds par signature 6-gear, ordre trié, k ≤ 0 = off) |
| `apps/renderer/test/gemsCapped.test.ts` | 16 tests — `allocateGemsCapped` : parité sans gemme crit, accept jusqu'à CHC 100 (overshoot ≤102), stop pile à 100, skip total au cap, split talisman/EE, delta null si rien d'utile, score ≤0 jamais pris |
| `apps/renderer/test/workerCount.test.ts` | 12 tests — `resolveWorkerCount` : défaut `hardwareConcurrency-1`, override `gs.solver.workerCount` ramené aux cœurs, clamp ≥1, plafond dur 64 ; `clampWorkerCount` (la règle partagée avec Settings) |
| `apps/renderer/test/transfer.test.ts`   | 8 tests — backup round-trip (snapshot fidélité, maps vides), import merge (dédup par `id`, collision garde l'existant), replace (overwrite), validation du bundle (kind/version/maps) |
| `apps/renderer/test/solveChunk.test.ts` | 4 tests — end-to-end `solveChunk` (hand-built `SolveContext`, no hero fixture) : **mid-tree set prune** (req-4pc → 1 combo scoré vs 16 brute-force ; insatisfiable → 0), **solver↔Builds 0-diff** (`finalizeBuilds` builds vs independent `computeFinalStats` + `calcBattlePower`, + deferred-ratings recompute), **équivalence de partition** (union de N chunks = run mono-chunk, aucun combo perdu/dupliqué) |
| `apps/renderer/test/solveChunkCritCap.test.ts` | 3 tests — chemin crit-cap de `solveChunk` (priorité `critRate` + gemmes crit) : chaque build a les gemmes d'`allocateGemsReachingCap` sur son CHC avant gemmes, fiche + CP = recomposition indépendante, allocation par défaut gardée (même objet) quand le delta est égal, sous / sur / au-dessus du plafond, talismans 4 et 5 slots ; union de 2 chunks = mono-chunk |
| `apps/renderer/test/orchestratorFlow.test.ts` | 10 tests — `SolverOrchestrator` avec un faux `Worker` (`vi.mock` du `?worker`) : un seul `onResult` quand tous les chunks dispatchés ont répondu (moins de chunks que de workers compris), sortie périmée d'un solve remplacé ignorée (`solveId`), `cancel`, crash `onerror` (pendant un solve / au repos), estimation (réponse périmée ignorée, `null` sur précompute en échec, crash sans bannière, annulée par un solve) |
| `apps/renderer/test/setPlans.test.ts`   | 26 tests — expansion des chips (`setPicksToPlans`), `planSetIds`, `planSlots`, `planFeasible` (somme multi-cond), `setsFeasible` OR + leaf-validation à `remaining 0`, parité mono-plan req-4pc, **`armorSetWhitelist`** (prune plein vs partiel × broken on/off, OR union, plan infaisable), **`allSetsComplete`** (4pc / 2×2pc / singleton / filler set-less) |
| `apps/renderer/test/translateReco.test.ts` | 16 tests — reco→patch : mains (OR-union, clé hors registre skip+warn), effets (icônes required, null skip+warn), talismans (`preferred`, non résolu skip+warn, toute la famille sur le vrai `equipment.json`), sets (combo→plan 1:1, combo non-résolu droppé entier), priorité substats (tiers→poids, collision de bucket, clé inconnue) |
| `apps/renderer/test/subValue.test.ts` | 5 tests — `flatVsPctTick` : verdict des deux côtés de la bascule, équivalent-flat exact, égalité pile à la bascule, garde tick %=0 |
| `apps/renderer/test/dmgValue.test.ts` | 4 tests — `dmgTickGains` : tri décroissant, monotonie delta→gain, CHC nul si crit-cap, base 0 → vide |
| `apps/renderer/test/buildAdvice.test.ts` | 24 tests — `computeAdvice` (Builds) : no-gear silencieux, missing quasi-complet (≤2) vs WIP silencieux (early-return), sets (singleton / 3-of-4 ; pièce libre du set en inventaire vs portée par un autre vs absente vs réservée par la Worklist pour un autre héros / pour lui), qualité `poor` listée en une ligne, caps gaspillés — crit toléré ≤102 / PEN >100 (seuil arrondi >0), gem slots vides Talisman/EE + tip +5, upgrade agrégé (reforges non utilisés / 6★ non ascensionné / sous cap d'enhance), singularier/pluraliser |
| `apps/renderer/test/cpPrune.test.ts` | 23 tests — budget-combos & scorers : `keepTopN`/`keepTopPct` (top-N, préservation set requis, pin de la pièce équipée), `priorityScoreOf`/`magnitudeScoreOf` (pondération, exclusion combat-only), `allocateComboBudget` (produit borné, petits slots entiers, ordre d'entrée), proxy CP qui classe le gear fort, `cpStatWeights` (offensif ≫ dmg-reduce, poids ≥ 0) |
| `apps/renderer/test/heroPriority.test.ts` | 21 tests — store priorité par héros : `rankOrder` / `isLowerPriority` (non-classé < classé, unicité, strict), `reorderRank` / `moveRankBefore` (insertion positionnelle contiguë 1..N, drag, clamp, immutabilité), `fillUnrankedByOrder` (préserve les rangs manuels, complète les non-classés par CP, compacte les trous, ignore les uid périmés) |
| `apps/renderer/test/sheetMinors.test.ts` | 14 tests — mineurs de fiche (revue 2026-10) : set Vitesse sur base + évo + éveil (Claire 133, Faenan 137, Delta 146), CHC bornée et `critRateUncapped` (Regina `crc`, conseil, réallocation crit-cap de `solveChunk`), CP float32 (trois fiches à ±1 en double), plats de `fromBuff` en `buffFlat` (ATK, EFF OAT_ADD, dominance), `composeMultStat` = `calcFinalStat` exact (héros × codex × valeurs) |
| `apps/renderer/test/dominance.test.ts` | 10 tests — `pruneDominatedForCp` : drop strict, ties/Pareto/groupes gardés, projection reforge, équivalence top-CP end-to-end via `solveChunk` |
| `apps/renderer/test/statRegistry.test.ts` | 13 tests — registre de stats : `PCT_ROLL_KEYS` = les variantes `pct`, `magnitudeScoreOf` ignore un main en % sur un axe plat seulement (Phantasm), `FINAL_STAT_KEYS` ↔ champs `FinalStats` (aucune clé legacy crc/chd/res…), pont `STAT_TO_PRIORITY` (couvre chaque variante `ROLL_NORMS`, cibles = vrais axes, identité hors collapses flat/%), tokens design complets, snapshot numérique `ROLL_NORMS`/`STAT_NORMS`, migration des clés legacy (idempotente, ordre préservé, entrée nullish) |
| `apps/renderer/test/worklist.test.ts` | 25 tests — `upsertWorklistEntry` (remplace par `heroUid`, garde l'ordre des autres, coches comprises), `loadWorklist` (entrée stockée sans `kind` lue comme pièce, deux entrées d'un héros → la première), lignes gemme (`worklistChangesFor` : build qui ne change qu'une gemme, `fromGem`, 0 ignorés, pièces puis gemmes ; appliquée = pièce sur le héros + bonne gemme, `remainingChangeCount`, `worklistClaims` et `planWorklist` les ignorent, `reconcileWorklist` + `appliedNotice`), issue d'Apply par cause (`equipAssignments` / `equipPieces`, `EQUIP_FAILURE`), toasts (store à timers factices, rendu de la pile) |
| `apps/renderer/test/worklistPlan.test.ts` | 20 tests — `planWorklist` (planification de transaction) : plan vide sans inventaire/entrées, entrées indépendantes (pas de deps), ordre **free-before-use** (l'entrée qui libère une pièce passe d'abord), **contention** (une copie voulue par deux héros) flaggée — même héros ×2 ≠ contention, plus de `superseded` (une entrée par héros), le repli `equipAssignments` rend `"ok"` et donne la pièce au héros, cycles free/need marqués mais applicables atomiquement (seuls les membres du cycle ; une entrée qui en dépend s'ordonne après), exclusion des changes applied (déjà équipé) / stale (disparu de l'inventaire) ; `worklistClaims` (réservations solveur) : cible de chaque change non appliqué → héros réclamant, changes déjà appliqués ignorés, double-claim = l'entrée la plus récente gagne, map vide sans inventaire |
| `apps/renderer/test/presets.test.ts` | 18 tests — onglet Presets : `presetRows` (ordre par numéro, EE jamais dans le preset, porteur exact malgré une autre EE / une pièce de différence → pas porteur, pièce absente avec son slot du fil, pièce partagée flaggée des deux côtés, preset vide), `presetSignature` ; `evaluatePresetFor` (pièces du preset + l'EE du héros, pas celle du preset : −200 ATK d'une arme connue), `loss` 0 quand preset = meilleure tenue, null sans priorité ; `bestKnownFor` (build sauvegardée la plus récente > tenue actuelle, re-notée avec la priorité courante) ; store `gs.presetHeroes` (aller-retour, uid hors roster ignoré, un rôle par héros, stockage illisible) |
| `apps/renderer/test/presetsGems.test.ts` | 12 tests — onglet Presets, réglage : `bestEeGemsFor` sur la table de gemmes réelle (jamais les gemmes du Talisman du preset, même libre, ni de l'EE d'un autre héros, ni du Talisman du héros ; gemme sertie gardée à sa place ; null sans priorité ou quand l'EE a déjà le meilleur ; score avec les gemmes proposées > tel que serti ; `eeGems` = gemmes serties compose comme l'EE), `alignToSockets` ; `presetWorklistFor` (pièces qui diffèrent puis lignes gemme de l'EE seules, pièce absente exclue, porteur sans rien à régler → rien, remplacement de l'entrée du héros) ; `presetPriorityOf` (session > build sauvegardée la plus récente > null, priorité sans poids ignorée) ; `gs.presetHeroes` dans la sauvegarde (aller-retour, l'entrée locale gagne, sauvegarde sans le champ) |
| `apps/renderer/test/deltaCp.test.ts` | 2 tests — `deltaCpLabel` : reforge `Off` → `ΔCP ±X` nu sans infobulle ; mode actif → `vs equipped (build at <mode>)` + infobulle |
| `apps/renderer/test/talismanPreferred.test.ts` | 8 tests — `talismanEffectPicks` sur le vrai contrat (`precomputeContext`) : préféré possédé → pool réduit à lui (variantes comprises ; famille du conseil : seul un 5★ possédé → lui, aucun membre → pool entier), non possédé ou écarté par un autre filtre (classe, portée « equipped ») → pool entier, `required` non possédé → pool vide, `excluded`, keep current verrouillé, champ absent → pool entier |
| `apps/renderer/test/heroTracker.test.ts` | 11 tests — `buildHeroTrackerExport` (export hero-tracker outerpedia) : enveloppe versionnée clé = id héros de base, niveau/affinité résolus depuis les courbes XP (plancher lv5 / aff 1), niveau d'EE pris sur l'EE possédé (meilleure copie, gear non-EE ignoré), héros fusionné sous son id de base + bloc `core_fusion` (absent si non fusionné, tier 1 si niveau manquant), clamp `transcend_star` à la rareté de base et des valeurs hors domaine, héros inconnu de la game data exporté quand même |

Run : `npm test --workspaces --if-present`. **Total : 300 tests** (core 22 : parse 11 + equip 11 · renderer 278 : solver 95, solveChunk 4, gemsCapped 16, setPlans 26, transfer 8, translateReco 10, workerCount 7, subValue 5, dmgValue 4, buildAdvice 16, cpPrune 23, heroPriority 21, dominance 10, statRegistry 11, worklistPlan 11, heroTracker 11).

### 3.4 Reverse engineering — libil2cpp.so

Formules clés viennent du dump libil2cpp.so (1.4.9 build, decompilé via
Ghidra/IDA). Adresses connues (1.4.9 → 1.4.14, dump du 2026-08-21 dans
`outerpedia-v3/.gamedata/apk/dumped/`) :
- `CFormula::CalcFinalStat` — RVA `0x2C59E48` → `0x2CB1C6C`
- `CFormula::CalcBattlePower` — RVA `0x2C59EE4` → `0x2CB1D08`

Les signatures C# (`dump.cs`) sont identiques entre les deux builds ; seules
les adresses bougent. Un nouveau dump se vérifie en cherchant
`static int CalcFinalStat(` dans `dump.cs`.

### 3.5 Sources externes

- **outerpedia** (repo public `Sevih/outerpedia`) — source des tables de jeu
  (artefacts `data/generated/solver/`). Les **images** viennent du bucket R2
  `img.outerpedia.com`. Le handler `/img/*` partagé (`img-cache.ts`, utilisé
  par le middleware Vite **et** le serveur Electron prod) résout en cascade :
  sprites bundlés (`apps/renderer/public/img`, les `ui/inven/*` absents de R2)
  → checkout local (dev, `.assets-staging/images` via `OUTERPEDIA_PATH`) →
  **cache disque** persistant → **R2** + écriture en cache → fallback
  `.png`→`.webp`. Alias de namespace : `ui/effect/*` → `equipment/*` (layout
  V2 → R2). Chaque asset n'est donc fetché qu'une fois. Cache :
  `.cache/outerpedia` en dev (gitignoré), `<userData>/outerpedia-cache` en
  prod. Le préfetch fond (prod) réchauffe les icônes d'équipement référencées
  par la donnée dérivée, une fois par hash de version. Coordonnées repo + SHA
  centralisés dans `repo-source.ts`.
- **Notes de RE historiques** — les dérivations détaillées (CalcFinalStat, CP,
  EE/Transcend inhérents, workflow des locks) vivaient dans la mémoire Claude du
  projet outerpedia-v2, aujourd'hui supprimée. Ce qui reste : le présent
  document (§2), les commentaires de tête de `compose-stats.ts` / `cp.ts` /
  `ratings.ts`, et le dossier `dev/legacy/outerpedia/docs/damage-calc/`
  (formules de dégâts 1.4.9).

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
│   ├── presets/
│   │   ├── presetRows.ts           ← presets du jeu : pièces, porteurs, pièces absentes / partagées
│   │   ├── evaluate.ts             ← evaluatePresetFor + bestKnownFor + presetLoss + presetPriorityOf (preset noté sur un héros)
│   │   ├── eeGems.ts               ← bestEeGemsFor (gemmes d'EE par héros, pièces fixées)
│   │   └── presetWorklist.ts       ← presetWorklistFor (entrée Worklist d'un héros du preset)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← localStorage per-hero saved builds
│   │   ├── presetHeroes.ts         ← localStorage référence + associés par preset
│   │   └── filterPresets.ts        ← localStorage per-hero filter snapshots
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool de Web Workers, fan-out/in, merge top-N
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + simulateReforges + TopKHeap
│       ├── setPlans.ts             ← setsFeasible + armorSetWhitelist + allSetsComplete (set OR-of-AND model)
│       ├── builderFilters.ts       ← SolverFilters + reducer du Builder + INITIAL_FILTERS + buildSolveFilters
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + allocateGems + allocateGemsByCp + gemSlotsOf
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + ROLL_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower + makeCpEvaluator
├── workers/
│   └── solver.worker.ts            ← IPC adapter, MessageChannel yield
└── screens/
    ├── inventory/                  ← InventoryScreen.tsx (gear table) + filters.ts, FilterModal, VirtualGearGrid, ItemDetail…
    ├── BuildsScreen.tsx            ← per-hero current build cards (uses calcBattlePower)
    ├── presets/PresetsScreen.tsx   ← onglet Presets : preset noté sur la référence et les associés, gemmes d'EE, + Worklist
    └── builder/                    ← BuilderScreen.tsx (useReducer(SolverFilters) + mise en page) + useSolverSession.ts
                                      (orchestrator wiring) + un module par panneau, ResultsTable, RightSidebar (Library)…

packages/core/src/
├── types.ts                       ← GearPiece, Character, Inventory, StatType, RolledStat
├── raw.ts                         ← RawUserItem / RawUserCharacter / RawPreset (capture JSON shapes)
├── gamedata.ts                    ← GameData + tous les *Table types
├── stats.ts                       ← resolveStat (OptionID → ResolvedStat)
├── parse.ts                       ← parseInventory (raw → Inventory)
├── compose-stats.ts               ← composeCharStats (no-gear stats per hero)
├── rules.ts                       ← gameRulesOf / DEFAULT_RULES (gemmes, reforges, évolutions lues du contrat)
└── index.ts                       ← re-exports publics
```
