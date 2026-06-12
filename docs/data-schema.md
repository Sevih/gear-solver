# Data schema (captured)

Decoded from the Outerplane game server (`glb-game…:38001`). Capture/decode details:
[tools/capture/README.md](../tools/capture/README.md). All bodies are
`{"msg":"<hex>"}` → hex → repeating-XOR (`ASLDKGFJASPODIFJSOWEI`) → UTF-8 JSON.

## `/user/item` → `ItemList[]` (gear & items)

| field | meaning |
|-------|---------|
| `ItemUID` | unique instance id (string) |
| `CharUID` | equipped character UID; `"0"` = unequipped |
| `ItemID` | template id → **Outerpedia equipment DB** (slot, set, rarity, base main stat) |
| `BreakLimitLevel` | breakthrough tier T0–T4 |
| `SmeltingCount` | reforge count |
| `SingularityLevel` / `Step` / `OptionID` | Singularity Ascension (+11→+15) |
| `IsLock` | 1 = locked |
| `OptionList[]` | main stat option id(s) — encoding TBD |
| `SubOptionList[]` | substats: `{ OptionID, Level, BaseLevel }` |

A row is **gear** iff `SubOptionList` is non-empty (stackables have it empty).

### Substats

- `Level` = total ticks (yellow initial + orange reforge).
- `BaseLevel` = initial yellow ticks. **Reforge ticks = Level − BaseLevel.**
- Value = ticks × per-tick value (per-tick TBD).
- Observed `OptionID`s: **160001–160013** (13 stat types). A trailing `{OptionID:0}` line
  is padding and is dropped.

### Main stat (`OptionList`) — encoding to decode

Observed combos and frequency from one account:
`(5024,5048)`, `(0,0)`, `(4024,0)`, `(3024,0)`, `(6024,6048)`, `(24,94)`, `(24,95)`, `(24,96)`.
Hypothesis: `<statClass>024` / `<statClass>048` encode stat type + tier; `(24, 94|95|96)`
a different family. **TODO: confirm.**

## `/user/character` → `CharList[]` (+ `SlotList`, `CharPieceList`, `DeckList`)

Per character: `CharUID`, `CharID`, `TransStar` (stars), `CostumeID`, skill levels
(`First`/`Second`/`Ultimate`/`ChainPassive`), `TrustExp`, `LevelMaxStep`, `IsLock`.
`SlotList` likely maps character → equipped item UIDs (**shape TBD — datamine**).

## Other endpoints

`/user/asset` (currencies), `/user/info`, `/user/lobby`, `/user/etc`, `/item/customInfo`.

## OPEN TASK — `OptionID` → stat table

Cross-check captured items against the in-game display to fill `stats.ts`. Reference point:
the equipped weapon "Surefire Greatsword [Singularity]" displayed
**ATK 61.8% / Crit Chance 12% / Crit DMG 24% / DMG Increase 8% / Speed 9**, whose
`SubOptionList` OptionIDs give the mapping anchor.
