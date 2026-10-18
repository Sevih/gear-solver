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
| `ItemID` | template id → `data/derived/equipment.json` (slot, setId, grade, image, effectIcon, classLimit, …) — the domain field `GearPiece.rarity` is mapped from `grade` by `parse.ts` |
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
  `levelThreshold <= 1 || enhanceLevel >= levelThreshold` (a threshold-1
  passive is always on once equipped, even at +0 — cf. `parse.ts`),
  `source: "eePassive"`.
- Weapon / accessory unique passive that hits the sheet
  (`game.equipmentPassives[ItemID].statsByTier`) → the tier
  `min(breakthrough, length − 1)`, each entry resolved by `resolveOption`, added as
  `fromBuff: true, source: "uniquePassive"` (hidden from the display: the passive
  text already says it).

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
in `raw.ts` `RawPreset`; the parser today reads `Num` (→ `Preset.num`), `Name` and
`ItemUIDList` — only `PresetType` and `Favorites` remain unread).
Order of the 8 slots: Weapon, Accessory, Helmet, Armor, Gloves, Boots, EE, Talisman.
Names are base64-encoded UTF-8 (cf. `decodeBase64Utf8` in `parse.ts`).

---

## Other captured endpoints

`/user/asset` (currencies), `/user/info`, `/user/lobby`, `/user/etc`,
`/item/customInfo`, `/archive/info` (codex level), `/gift/info` (geas
node levels per account).

---

## Re-capture cycle after a game patch

1. Outerpedia side: `datagen:build` + `promote` regenerate `data/generated/solver/*.json`
   (the `solver` generator there carries the old local `build.mjs`/`calc-stats.mjs` distillation).
2. `npm run data:sync` copies those artifacts into `data/derived/*.json` (including
   `version.json` `{ hash, builtAt }` — the `hash` only changes if the
   data actually moved). Shown in Settings → Data.
3. Re-capture the account if the version has changed (play to the lobby with the plugin).
4. Green tests (`npm test --workspaces`).
5. Re-validate the stat-locks via the app's debug toggle, refresh the
   snapshots in `data/stat-locks.json` if necessary.

**Core passive per tier (`characters.json`).** Each fused character's `ingredients`
carry `corePassiveByFusion` (added by outerpedia, `schema` still 1):
`{ "1": …, "5": … }`, all five keys always present, each block a `StatBlock` plus
`spdPct` (the `OAT_RATE` speed in raw % points, 4.3 = +4.3%; `spd` there is flat only),
zeroed when the tier has no sheet buff. `composeCharStats` takes the captured tier's key
(`Character.fusionLevel`), the highest when the tier is unknown, and applies `spdPct` as a
rate on the total speed (cf.
[Engine Reference §1.4](Engine-Reference#14-compose-no-gear-packagescoresrccompose-statsts)).
Typed optional in `CharacterIngredients`: an older cache lacks it and the composer then
falls back to the legacy `corePassive` (a single block at max level, speed pre-baked as
flat), which contract format 2 drops.

**Set levels (`sets.json`).** Each `levels[]` entry carries, next to `p2` / `p4` /
`p2_desc` / `p4_desc`, two fields added by outerpedia (`schema` still 1):
`breakLimitCounts` (`number[]`, the breakthroughs that give a piece this level; today
`[0,1,2,3]` at level 1, `[4]` at level 2, `[]` on unique-option groups) and
`ignoreLowSet` (`boolean`, true when this row, read for the 4pc, drops the 2pc). Typed
optional in `SetLevel` (`core/gamedata.ts`): an older cache lacks them and `wornSetRows`
(`core/set-level.ts`) then falls back to the former rule (cf.
[Engine Reference §2.6](Engine-Reference#26-set-bonuses-composebuildtscomputesetbonuses)).

**Unique passive stats (`equipment-passives.json`).** Next to `textByTier`, a weapon or
accessory entry with a buff that hits the sheet (sheet buffs, hidden ones included)
carries `statsByTier` (added by outerpedia, `schema` still 1): indexed like `textByTier`
(index = breakthrough 0 to 4, the client takes the buff at level 1 + breakthrough), each
tier a list of raw `{ st, ap?, v }` (`OAT_RATE` in ‰, sign kept). Today 16 items:
Phantasm Necrosis (`ST_SPEED OAT_RATE −300` on all five tiers) and Briareos's Ambition
(`ST_BUFF_RESIST OAT_RATE` 200 → 400). Typed optional in `EquipmentPassive`
(`core/gamedata.ts`): when absent the piece keeps its mains; read by `parseGearPiece`
(cf. [Engine Reference §1.3](Engine-Reference#13-parse-packagescoresrcparsets)).

The `version.json` `hash` is the hook for a future automatic localStorage cache invalidation;
pruning SavedBuilds with vanished `pieceUids` is still to be wired (cf.
`todo.md` "Snapshot data versioning").
