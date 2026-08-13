# Data schema (captured)

Décodage des réponses du serveur Outerplane (`glb-game…:38001`).
Pipeline de capture/déchiffrement : [tools/capture/README.md](../tools/capture/README.md).
Toutes les réponses : `{"msg":"<hex>"}` → hex → repeating-XOR
(`ASLDKGFJASPODIFJSOWEI`) → UTF-8 JSON.

Pour le **mapping OptionID/ItemID/CharID → tables dérivées** et les
**formules** qui consomment ces données : [reference.md](reference.md).

---

## `/user/item` → `ItemList[]`

| Champ | Sémantique |
|-------|------------|
| `ItemUID` | id d'instance unique (string) |
| `CharUID` | UID du héros équipé ; `"0"` = libre. Réécrit **localement** par les méthodes d'édition d'équipement (`equipItem`/`unequipItem`, `packages/core/src/equip.ts`) — voir [reference.md §1.7](reference.md#17-édition-déquipement-packagescoresrcequipts) ; rien n'est envoyé au jeu |
| `ItemID` | template id → `data/derived/equipment.json` (slot, setId, grade, image, effectIcon, classLimit, …) — le champ domaine `GearPiece.rarity` est mappé depuis `grade` par `parse.ts` |
| `BreakLimitLevel` | breakthrough T0–T4 |
| `SmeltingCount` | nombre de reforges déjà spent |
| `SingularityLevel` / `Step` / `OptionID` | Singularity Ascension (+11→+15) |
| `IsLock` | 1 = pièce verrouillée |
| `Exp` | XP cumulée — résolue en `enhanceLevel` via la courbe `ItemEnchantTemplet` |
| `OptionList[]` | OptionIDs du main stat (1-2 entrées) |
| `SubOptionList[]` | substats : `{OptionID, Level, BaseLevel}` |

**Gear vs item stackable** : `isGear(item, game)` retourne vrai ssi
`game.equipment[ItemID]` existe (i.e. la template est connue comme une
pièce d'équipement). Les stackables (orbes / matériaux) sont droppés.

### Substats / gems

- `Level` = nombre de procs **au-dessus** du tick initial ; total ticks = `Level + 1`,
  affiché in-game `LV (Level + 1)` (validé : Surefire +15 `L3` → `LV4` = 4 ticks ;
  Fine Sword +0 `L0` → `LV1` = 1 tick — cf. `parse.ts` `totalTicks = Level + 1`).
- `BaseLevel` = initial yellow ticks. **Reforge ticks = `Level − BaseLevel`.**
- Valeur résolue = `(Level + 1) × per-tick value` (de `ItemOptionTemplet.v`,
  divisé par 10 si percent display).
- `OptionID = 0` = padding (skippé).
- **Pour Talisman/EE** : `SubOptionList[i]` = OptionID du gem socketé au
  slot `i`. Convention `gemSlots: number[]` length 5 (`0` = empty slot,
  5e gated par `enhanceLevel ≥ 5` en jeu).

### Main stat

`OptionList[]` carries 1-2 OptionIDs. Résolu via `resolveStat(optionId, 1, game.options)` :
- IOT_STAT (option directe) → flat ou percent selon `ap` (OAT_ADD vs OAT_RATE)
  et la stat (CRC/CHD/DMG sont percent même en OAT_ADD).
- IOT_BUFF (Talisman) → indirection via `BuffTemplet[buffId][enhanceLevel]`
  pour avoir le row matching le niveau de la pièce.
- Singularity (`SingularityOptionID`) → ajouté en `fromBuff: true, source: "singularity"`.
- EE level-gated passives (`game.eePassives[ItemID]`) → ajoutés quand
  `levelThreshold <= 1 || enhanceLevel >= levelThreshold` (un passif à seuil 1
  est toujours actif dès qu'équipé, même à +0 — cf. `parse.ts`),
  `source: "eePassive"`.

Scaling main pour pièces non-talisman : voir [reference.md §1.3](reference.md#13-parse-packagescoresrcparsets).

---

## `/user/character` → `CharList[]`

Par character : `CharUID, CharID, TransStar (stars), CostumeID, LevelMaxStep,
IsLock, Exp, FusionCharID, FusionLevel`. Les niveaux de skill sont des **champs
plats au top-level** : `First, Second, Ultimate, ChainPassive` (pas de wrapper
`Skills`, cf. `parse.ts` qui lit `c.First` … `c.ChainPassive`).

**`TransStar` est bien la transcendance courante**, pas un plafond : c'est
l'étoile **interne** (`CharacterTranscendentTemplet`), qui démarre à la rareté de
base du héros (un 3★ non transcendé vaut 3, jamais 0) et monte à 9. Mapping vers
l'affichage in-game : `1..4 → 1★..4★`, `5 → 4★+1`, `6 → 5★`, `7 → 5★+1`,
`8 → 5★+2`, `9 → 6★` (dérivable de `showUIStar`/`starPlus` dans
`characters.json` → `ingredients.transcendByStar`). Un compte end-game peut
légitimement afficher 9 partout — vérifié sur une capture réelle où les decks
d'adversaires PvP du même payload portaient 3, 5 et 9.

**Une seule entrée par héros, toujours sous l'ID de base** : un héros core-fusé
n'a pas de ligne `27xxxxx` dans `CharList`, il porte `FusionCharID` (l'id de la
variante) et `FusionLevel` (palier 1..5). Les EE se retrouvent dans
`/user/item` par `ItemID` = l'id du personnage (base `20xxxxx`, fusionné
`27xxxxx`).

**Slots équipés** : `SlotList` existe dans le payload mais sa **shape est TBD
(non datae)** et n'est **jamais lue** — l'« équipé-par » est dérivé directement
du `CharUID` de chaque item (`parse.ts` : `equippedBy = CharUID === "0" ? null : CharUID`).

**Presets** : `PresetList` vit dans **`/user/item`** (pas `/user/character`) —
array de `{PresetType, Num, Name (base64), ItemUIDList[8], Favorites}` (shape complète
dans `raw.ts` `RawPreset` ; le parser lit aujourd'hui `Num` (→ `Preset.num`), `Name` et
`ItemUIDList` — seuls `PresetType` et `Favorites` restent non lus).
Ordre des 8 slots : Weapon, Accessory, Helmet, Armor, Gloves, Boots, EE, Talisman.
Les noms sont base64-encoded UTF-8 (Cf. `decodeBase64Utf8` dans parse.ts).

---

## Export « hero-tracker » (Home → Roster → Export)

Document d'échange consommé par le planificateur externe. **Progression
uniquement** : ni gear, ni stats, ni awakening, ni inventaire — il chiffre un
*besoin*, pas un manque. Construit par `apps/renderer/src/lib/heroTracker.ts`.

```json
{ "format": "outerpedia:hero-tracker", "version": 1,
  "heroes": { "2000043": {
    "owned": true, "level": 100,
    "skills": { "s1": 5, "s2": 5, "s3": 4, "chain_passive": 3 },
    "affinity": 10, "transcend_star": 6, "ee": 10,
    "core_fusion": { "level": 5, "ee": 0 } } } }
```

| champ | plage | source capture |
|---|---|---|
| `owned` | `true` | seuls les héros possédés sont émis |
| `level` | 5..120 | `Exp` via `exp-character.json` |
| `skills.s1/s2/s3/chain_passive` | 1..5 | `First/Second/Ultimate/ChainPassive` |
| `affinity` | 1..100 | `TrustExp` via `trust-character.json` |
| `transcend_star` | rareté de base..9 | `TransStar` |
| `ee` | 0..10 | niveau d'enhance de l'EE `ItemID == CharID` (0 = pas d'EE) |
| `core_fusion` | absent ou objet | présent ssi `FusionCharID ≠ 0` |
| `core_fusion.level` | 1..5 | `FusionLevel` (posséder le fusionné = palier 1 payé) |
| `core_fusion.ee` | 0..10 | EE de la variante `27xxxxx` |

Clé = **l'ID de base**, jamais celui du fusionné. Chaque valeur est clampée dans
le domaine du jeu (`transcend_star` a pour plancher la rareté de base) pour
qu'une capture partielle ne puisse pas injecter une valeur hors-domaine chez
l'importateur. L'enveloppe `format` + `version` est obligatoire côté import.

---

## Autres endpoints captés

`/user/asset` (currencies), `/user/info`, `/user/lobby`, `/user/etc`,
`/item/customInfo`, `/archive/info` (codex level), `/gift/info` (geas
node levels par account).

---

## Cycle de re-capture après patch jeu

1. Côté outerpedia : `datagen:build` + `promote` régénèrent `data/generated/solver/*.json`
   (le generator `solver` y porte l'ancienne distillation locale `build.mjs`/`calc-stats.mjs`).
2. `npm run data:sync` copie ces artefacts dans `data/derived/*.json` (y compris
   `version.json` `{ hash, builtAt }` — le `hash` ne change que si la donnée a
   réellement bougé). Affiché dans Settings → Data.
3. Re-capture le compte si la version a changé (`tools/capture/capture.ps1`).
4. Tests verts (`npm test --workspaces`).
5. Re-validate les stat-locks via le toggle debug de l'app, refresh des
   snapshots dans `data/stat-locks.json` si nécessaire.

Le `hash` de `version.json` est le crochet d'une future invalidation auto des caches localStorage ;
l'élagage des SavedBuild aux `pieceUids` disparus reste à brancher (cf.
[todo.md](todo.md) "Snapshot data versioning").
