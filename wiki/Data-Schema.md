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
in `raw.ts` `RawPreset`; the parser reads `Num` (→ `Preset.num`), `Name`, `ItemUIDList`, `Favorites`
(≠ 0 → `Preset.favorite`, the Presets tab's ★) and `PresetType` (→ `Preset.presetType`, 1 = Master League)).
`PresetOrderList`, next to it, carries the order the player gave in the game's editor:
`[{ PresetType, SortOrder: [{ Num, SortOrder }] }]` (`RawPresetOrder`, shape read from the decompiled client,
not seen in a capture yet) → `Preset.sortOrder` (0 without an entry), sorted by `comparePresets`.
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
   `version.json` `{ schema, resVersion, hash, builtAt }` — the `hash` only changes if the
   data actually moved; `resVersion` is the game tables' version). Shown in Settings → Data.
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

**Skill factors (`characters.json`).** `bestSkill` `{ slot, burst?, factor,
unresolvedHits? }`: the strongest skill hit (S1/S2/S3 at max level, bursts included),
`factor` in ‰ of the damage stat; it scales the per-hit ratings `dmg`/`mcd`. Next to it,
`rotation` `{ factorPerTurn, cycle, uses: { S1, S2, S3 }, approx? }` (added by outerpedia,
additive, `schema` unchanged): the per-turn average, in ‰, of the factor played when the
hero casts the strongest ready skill every turn (S3 > S2 > S1, the game's
`Cool`/`StartCool` cooldowns, no bursts, AP or DoTs), over a `cycle`-turn cycle in which
each skill is cast `uses[S]` times; `approx` when a hit chain is unresolved. It scales the
per-turn ratings `dmgs`/`mcds` (cf. [Engine Reference §2.3](Engine-Reference#23-cheap-ratings-ratingstscomputecheapratings)). Typed
optional in `CharacterDef`: an older cache lacks it and the app then falls back to
`bestSkill`.

**Set levels (`sets.json`).** Each `levels[]` entry carries, next to `p2` / `p4` /
`p2_desc` / `p4_desc`, two fields added by outerpedia (`schema` still 1):
`breakLimitCounts` (`number[]`, the breakthroughs that give a piece this level; today
`[0,1,2,3]` at level 1, `[4]` at level 2, `[]` on unique-option groups) and
`ignoreLowSet` (`boolean`, true when this row, read for the 4pc, drops the 2pc). Typed
optional in `SetLevel` (`core/gamedata.ts`): an older cache lacks them and `wornSetRows`
(`core/set-level.ts`) then falls back to the former rule (cf.
[Engine Reference §2.6](Engine-Reference#26-set-bonuses-composebuildtscomputesetbonuses)).

**Set combat effects (`sets.json`).** Each `levels[]` entry also carries
`combatEffects: { p2, p4 }` (added by outerpedia, `schema` still 1), always present:
`null` when the tier has no `IOT_BUFF` effect, otherwise a list of
`{ buffId, type, st?, ap?, v?, target, cond? }` in the game's raw enums (`v` raw and
signed, ‰ for a rate; absent on `BT_IMMUNE`). The client puts them in
`m_ItemSetBuffTempletList`, off the sheet: **display only**, never read by the sheet nor
the CP (Fortification, Revenge, Patience, Pulverization, Immunity, Swiftness, Weakness,
Augmentation). Typed `SetCombatEffect`, optional in `SetLevel` (`core/gamedata.ts`): an
older cache lacks it. The app shows it as a "combat" pill after the prose (Builder
Effects panel, piece detail), worded by `combatEffectLines`
(`renderer/src/lib/setCombatEffects.ts`); `wornSetRows` reads on it the combat-effect 4pc
of the `ignoreLowSet` rule (`p4_desc` as fallback without the field).

**Unique passive stats (`equipment-passives.json`).** Next to `textByTier`, a weapon or
accessory entry with a buff that hits the sheet (sheet buffs, hidden ones included)
carries `statsByTier` (added by outerpedia, `schema` still 1): indexed like `textByTier`
(index = breakthrough 0 to 4, the client takes the buff at level 1 + breakthrough), each
tier a list of raw `{ st, ap?, v }` (`OAT_RATE` in ‰, sign kept). Today 16 items:
Phantasm Necrosis (`ST_SPEED OAT_RATE −300` on all five tiers) and Briareos's Ambition
(`ST_BUFF_RESIST OAT_RATE` 200 → 400). Typed optional in `EquipmentPassive`
(`core/gamedata.ts`): when absent the piece keeps its mains; read by `parseGearPiece`
(cf. [Engine Reference §1.3](Engine-Reference#13-parse-packagescoresrcparsets)).

When the data loads (`refreshInventory`, `App.tsx`), the `version.json` `hash` is compared to the
last one seen (`gs.data.hash`, localStorage): on a change, `reconcileDataHash`
(`apps/renderer/src/lib/storage/dataHash.ts`) removes from the filter presets and the per-hero filters
the set ids and effect keys the new data no longer knows, deleting nothing else; saved builds are
left untouched.

**Optional table `items.json`.** The non-gear items (materials, currencies, consumables…):
`{ "<ItemID>": { name, icon, itemType, itemSubType, grade, canSell, sellPrice } }` (`name` /
`icon` null when the game gives none, `itemType` / `itemSubType` / `grade` the raw game enums,
`sellPrice` in gold). Listed in `solver-files.json` and in `solver-files-optional.json`
(`apps/desktop/src/`): until outerpedia publishes it, the app's sync (checkout or repo, a 404
only) and `data/sync.mjs` skip it with a log line and deliver the other tables; once
published it is delivered, and refused, like the others (broken JSON, any other download
failure). A cache without it still counts as complete. The renderer loads it as `game.items`
(`ItemsTable`, `core/gamedata.ts`), `{}` on a 404; `itemNameOf(game, id)` /
`itemLabel(game, id)` (`apps/renderer/src/data.ts`) return the name, or null / `item <id>`.
