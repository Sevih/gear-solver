# Data Schema (captured)

*Mirror of `docs/data-schema.md` (translated to English) — see the repo for the authoritative source.*

Decoding of the Outerplane server responses (`glb-game…:38001`).
Capture/decryption pipeline: [Capture Pipeline](Capture-Pipeline).
All responses: `{"msg":"<hex>"}` → hex → repeating-XOR
(`ASLDKGFJASPODIFJSOWEI`) → UTF-8 JSON.

For the **OptionID/ItemID/CharID → derived tables mapping** and the
**formulas** that consume this data: [Engine Reference](Engine-Reference).

---

## `/user/item` → `ItemList[]`

| Field | Semantics |
|-------|------------|
| `ItemUID` | unique instance id (string) |
| `CharUID` | UID of the equipped hero; `"0"` = free. Rewritten **locally** by the equipment-editing methods (`equipItem`/`unequipItem`, `packages/core/src/equip.ts` — see [Engine Reference §1.7](Engine-Reference#17-equipment-editing-packagescoresrcequipts)); nothing is sent to the game |
| `ItemID` | template id → `data/derived/equipment.json` (slot, set, rarity, image, effectIcon, classLimit) |
| `BreakLimitLevel` | breakthrough T0–T4 |
| `SmeltingCount` | number of reforges already spent |
| `SingularityLevel` / `Step` / `OptionID` | Singularity Ascension (+11→+15) |
| `IsLock` | 1 = locked piece |
| `Exp` | accumulated XP — resolved into `enhanceLevel` via the `ItemEnchantTemplet` curve |
| `OptionList[]` | main stat OptionIDs (1-2 entries) |
| `SubOptionList[]` | substats: `{OptionID, Level, BaseLevel}` |

**Gear vs stackable item**: `isGear(item, game)` returns true iff
`game.equipment[ItemID]` exists (i.e. the template is known as an
equipment piece). Stackables (orbs / materials) are dropped.

### Substats / gems

- `Level` = number of procs **above** the initial tick; total ticks = `Level + 1`,
  displayed in-game as `LV (Level + 1)` (validated: Surefire +15 `L3` → `LV4` = 4 ticks;
  Fine Sword +0 `L0` → `LV1` = 1 tick — cf. `parse.ts` `totalTicks = Level + 1`).
- `BaseLevel` = initial yellow ticks. **Reforge ticks = `Level − BaseLevel`.**
- Resolved value = `(Level + 1) × per-tick value` (from `ItemOptionTemplet.v`,
  divided by 10 if percent display).
- `OptionID = 0` = padding (skipped).
- **For Talisman/EE**: `SubOptionList[i]` = OptionID of the gem socketed at
  slot `i`. Convention `gemSlots: number[]` length 5 (`0` = empty slot,
  5th gated by `enhanceLevel ≥ 5` in-game).

### Main stat

`OptionList[]` carries 1-2 OptionIDs. Resolved via `resolveStat(optionId, 1, game.options)`:
- IOT_STAT (direct option) → flat or percent depending on `ap` (OAT_ADD vs OAT_RATE)
  and the stat (CRC/CHD/DMG are percent even in OAT_ADD).
- IOT_BUFF (Talisman) → indirection via `BuffTemplet[buffId][enhanceLevel]`
  to get the row matching the piece's level.
- Singularity (`SingularityOptionID`) → added as `fromBuff: true, source: "singularity"`.
- EE level-gated passives (`game.eePassives[ItemID]`) → added when
  `enhanceLevel >= levelThreshold`, `source: "eePassive"`.

Main scaling for non-talisman pieces: see [Engine Reference §1.3](Engine-Reference#13-parse-packagescoresrcparsets).

---

## `/user/character` → `CharList[]`

Per character: `CharUID, CharID, TransStar (stars), CostumeID, LevelMaxStep,
IsLock, Exp, FusionCharID`. The skill levels are **flat top-level
fields**: `First, Second, Ultimate, ChainPassive` (no `Skills` wrapper,
cf. `parse.ts` which reads `c.First` … `c.ChainPassive`).

**Equipped slots**: `SlotList` exists in the payload but its **shape is TBD
(undated)** and is **never read** — "equipped-by" is derived directly
from each item's `CharUID` (`parse.ts`: `equippedBy = CharUID === "0" ? null : CharUID`).

**Presets**: `PresetList` lives in **`/user/item`** (not `/user/character`) —
an array of `{PresetType, Num, Name (base64), ItemUIDList[8], Favorites}` (full shape
in `raw.ts` `RawPreset`; the parser today only reads `Name` + `ItemUIDList`).
Order of the 8 slots: Weapon, Accessory, Helmet, Armor, Gloves, Boots, EE, Talisman.
Names are base64-encoded UTF-8 (cf. `decodeBase64Utf8` in `parse.ts`).

---

## Other captured endpoints

`/user/asset` (currencies), `/user/info`, `/user/lobby`, `/user/etc`,
`/item/customInfo`, `/archive/info` (codex level), `/gift/info` (geas
node levels per account).

---

## Re-capture cycle after a game patch

1. `data/sync.ps1` re-copies `data/game/*.json` from the outerpedia-v2 checkout.
2. `npm run data:build` regenerates the `data/derived/*.json` consumed by the engine (and
   rewrites `data/derived/version.json` `{ hash, builtAt }` — the `hash` only changes if the
   data actually moved). Shown in Settings → Data.
3. Re-capture the account if the version has changed (`tools/capture/capture.ps1`).
4. Green tests (`npm test --workspaces`).
5. Re-validate the stat-locks via the app's debug toggle, refresh the
   snapshots in `data/stat-locks.json` if necessary.

The `version.json` `hash` is the hook for a future automatic localStorage cache invalidation;
pruning SavedBuilds with vanished `pieceUids` is still to be wired (cf.
`todo.md` "Snapshot data versioning").
