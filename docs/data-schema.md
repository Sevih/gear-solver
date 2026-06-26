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
| `CharUID` | UID du héros équipé ; `"0"` = libre |
| `ItemID` | template id → `data/derived/equipment.json` (slot, set, rarity, image, effectIcon, classLimit) |
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
  `enhanceLevel >= levelThreshold`, `source: "eePassive"`.

Scaling main pour pièces non-talisman : voir [reference.md §1.3](reference.md#13-parse-packagescoresrcparsets).

---

## `/user/character` → `CharList[]`

Par character : `CharUID, CharID, TransStar (stars), CostumeID, LevelMaxStep,
IsLock, Exp, FusionCharID`. Les niveaux de skill sont des **champs plats au
top-level** : `First, Second, Ultimate, ChainPassive` (pas de wrapper `Skills`,
cf. `parse.ts` qui lit `c.First` … `c.ChainPassive`).

**Slots équipés** : `SlotList` existe dans le payload mais sa **shape est TBD
(non datae)** et n'est **jamais lue** — l'« équipé-par » est dérivé directement
du `CharUID` de chaque item (`parse.ts` : `equippedBy = CharUID === "0" ? null : CharUID`).

**Presets** : `PresetList` vit dans **`/user/item`** (pas `/user/character`) —
array de `{PresetType, Num, Name (base64), ItemUIDList[8], Favorites}` (shape complète
dans `raw.ts` `RawPreset` ; le parser ne lit aujourd'hui que `Name` + `ItemUIDList`).
Ordre des 8 slots : Weapon, Accessory, Helmet, Armor, Gloves, Boots, EE, Talisman.
Les noms sont base64-encoded UTF-8 (Cf. `decodeBase64Utf8` dans parse.ts).

---

## Autres endpoints captés

`/user/asset` (currencies), `/user/info`, `/user/lobby`, `/user/etc`,
`/item/customInfo`, `/archive/info` (codex level), `/gift/info` (geas
node levels par account).

---

## Cycle de re-capture après patch jeu

1. `data/sync.ps1` re-copie `data/game/*.json` depuis le checkout outerpedia-v2.
2. `npm run data:build` régénère `data/derived/*.json` consommés par le moteur.
3. Re-capture le compte si la version a changé (`tools/capture/capture.ps1`).
4. Tests verts (`npm test --workspaces`).
5. Re-validate les stat-locks via le toggle debug de l'app, refresh des
   snapshots dans `data/stat-locks.json` si nécessaire.

Stale-detection est manuelle pour l'instant (cf.
[todo.md](todo.md) "Snapshot data versioning").
