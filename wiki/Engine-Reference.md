# Engine Reference — pipeline & formulas

*Mirror of `docs/reference.md` (translated to English) — see the repo for the authoritative source.*

Dense unified doc for anyone who has to pick up the engine cold. Covers:
1. **The full pipeline** (capture → parse → compose → solve), with the
   functions and files that handle each step.
2. **The formulas** (compose final stat, CP, ratings, score, gems, reforge,
   top-%) with their unit conventions and their validation.
3. **The sources** (game tables → derived tables → consumers, plus
   references to the libil2cpp.so dumps).

> For the solver UI pipeline (panels, states, UX), see [Solver](Solver).
> For the layer breakdown, see [Architecture](Architecture).

---

## 1. Processing

### 1.1 Capture (`tools/capture-steam/`)

BepInEx plugin loaded by the Steam client (Unity Mono). Copies Outerplane server responses
once the game has decrypted them:
- Endpoints: `glb-game.outerplane.vagames.co.kr:38001` (account/inventory) +
  `glb-login…:38002`, via Unity BestHTTP/2.
- Wire encoding: `{"msg":"<hex>"}` → hex → **repeated-key XOR
  `ASLDKGFJASPODIFJSOWEI`** → UTF-8 JSON. The plugin has nothing to decrypt: postfix on
  `CWebManager.Log2InternalWeb` (clear JSON + path), shape-based `DecryptMsg` fallback.
- Output: `<capture folder>/{user_item,user_character,…}.json` (`.cache/capture-out` in dev,
  `<userData>/capture-out` packaged). The manual import reads the same files.
- Changes made in-game (plugin 0.2.0 for gear moves, 0.3.0 for gems and substats, 0.4.0 for
  upgrades, 0.5.0 for selling and locking, 0.5.1 for dissolving): the game only re-sends `/user/item` at the lobby, but every move answers `/item/equip`
  or `/item/equipAll`, socketing, removing or rerolling a gem or changing substats (reforge,
  Transistone) answers `/item/gemInsert`, `/item/gemRemove`, `/item/gemChangeOption` or
  `/item/subOptionChange`, and an upgrade answers `/item/enchant`, `/item/enchantReset`,
  `/item/breakLimit`, `/item/smelting`, `/item/smeltingReset`, `/item/merge` or `/item/craft`; the
  plugin appends those to `equip-events.ndjson` (one `{ seq, at, path, res }` line per response,
  emptied on every `/user/item`) — a sale `/item/sell`, a dissolve `/item/dissolve` and a lock
  toggle `/item/lock` go in with the client's request, which their response doesn't repeat (one
  `{ seq, at, path, req, res }` line per gesture, written from `CWebRES_ItemSell.OnApply` /
  `CWebRES_ItemDissolve.OnApply` / `CWebRES_ItemLock.OnApply`, the response seen for that path as
  `res`) —, and the app folds them into `user_item.json` on every
  `GET /api/capture/status` (polled every 5 s) — `foldEquipEvents` in
  [equip-events.ts](https://github.com/Sevih/gear-solver/blob/main/apps/desktop/src/equip-events.ts),
  by uid: moves rewrite `CharUID`; the others carry, per the `ITEM_FIELDS` table (by path), whole
  items (`WSItemData`, the fields of `RawItem`), which replace the entry of the same uid or join the
  end of the list (the gem item `gemRemove` puts back into the inventory, the pieces `breakLimit` or
  `craft` create), and "simple" entries (uid + new `Quantity`: materials consumed or given back),
  which only rewrite `Quantity`, the entry being removed at 0 as the client's
  `CItemInventory.UpdateItem` does (the piece an enhance eats no longer exists) — and its uid becomes
  0 in the `ItemUIDList` of every preset holding it, as `CItemInventory.RemoveItem`
  (`DeletePresetEquipUID`) does, without waiting for the lobby. The gem stack
  `gemInsert` consumes isn't in its response: it stays as is until the next lobby. A sale or a
  dissolve folds each uid of `req.ItemList` as a simple entry at 0 (removed, presets included) —
  the `item/dissolve` response only carries the materials received (`RewardList`, `ItemUID` 0),
  which aren't pieces and aren't folded —, a lock sets the `IsLock` of the `req.ItemUID` entry to 1
  or 0 from `req.IsLock`; such a line without `req` is skipped (so a dissolve journaled by a 0.5.0
  plugin waits for the lobby). `item/sell/consumable` and Custom Gear aren't
  followed. What the app already folded is noted in
  `.equip-events.applied`.

Files: [Plugin.cs](https://github.com/Sevih/gear-solver/blob/main/tools/capture-steam/src/Plugin.cs),
[steam-capture.ts](https://github.com/Sevih/gear-solver/blob/main/apps/desktop/src/steam-capture.ts) (app-side install + status).

See also: [Capture Pipeline](Capture-Pipeline).

### 1.2 Derived tables (outerpedia datagen → `data/derived/`)

The distillation lives in the **outerpedia repo** (`datagen/generators/solver.ts`,
a faithful port of the old local `build.mjs`): it reads the raw game tables and
emits the compact, consumable tables at `data/generated/solver/`, mirrored here
in `data/derived/`. The Source column lists the raw game table actually loaded
(several targets derive from the same table — `ItemSpecialOptionTemplet` in
particular):

| Source (raw game table)              | Target `data/derived/`     | Content                                                |
|--------------------------------------|---------------------------|--------------------------------------------------------|
| `ItemTemplet.json`                   | `equipment.json`          | ItemID → slot/grade/star/setId/armorSetId/name/image/effectIcon/class; optional: `canSell`, `sellPrice` (gold), `canDissolve`, `dissolve` (`{ assets: [{type, min, max}], items: [{id, min, max}] }` or null, `AT_GOLD` = gold) |
| `ItemOptionTemplet.json`             | `options.json`            | OptionID → StatOption (`{st, ap, v}`) OR IOT_BUFF reference |
| `BuffTemplet.json`                   | `buffs.json`              | BuffID → array of StatOption (per enhanceLevel)        |
| `ItemSpecialOptionTemplet.json` + curated (outerpedia) | `sets.json` | setId → levels[] → {p2, p4, p2_desc, p4_desc, breakLimitCounts, ignoreLowSet, combatEffects}, name |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `equipment-passives.json` | ItemID → {name, textByTier[1..4], statsByTier?} |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `multi-tier-passives.json`| ItemID → list of tier passives               |
| `ItemOptionTemplet.json` (IDs 15001..15054) | `gems.json`        | OptionID → {type, level, st, ap, v}                    |
| `ItemSpecialOptionTemplet.json` (groups 30000/31000) | `singularity-options.json`| OptionID → {st, ap, v, name, desc, combatOnly} |
| `ItemSpecialOptionTemplet.json` (EE groups) | `ee-passives.json` | ItemID → list of {st, ap, v, levelThreshold}           |
| `CharacterTemplet.json` etc.         | `characters.json`         | charId → {ingredients, cls, element, star, …}          |
| `ItemEnchantTemplet.json` + `SingularityEquipEnchantTemplet.json` | `enhance.json` | enhanceFactor, tierFactor, expCurves, singularity, gemSlots, reforge (standalone file; `gemSlots` / `reforge` read by `gameRulesOf`, `packages/core/src/rules.ts`) |
| `CharacterEvolutionTemplet.json`     | `progression.json`        | `evoUnlockLevel`: EvolutionLevel → unlock level (`gameRulesOf`) |
| `ExpCharacterTemplet.json`           | `exp-character.json`      | array idx 1..120 → cumulative XP                       |
| `CharacterMaxLevelTemplet.json`      | `char-level-max.json`     | `${star}|${step}` → {maxLevel, statModifierAfter100}   |
| `ArchiveBonusTemplet.json`           | `archive-bonus.json`      | `CompleteCount` → codex level (1..11)                  |
| `CharacterArchiveStatTemplet.json` (via `computeCharacterIngredients`) | `codex-curve.json` | codex level idx 0..11 → {atkPct, defPct, hpPct} |
| `ExpCharacterTemplet.json` (col TrustExp) + `TrustBuffTemplet.json` | `trust-character.json`, `trust-buffs.json` | trust system data; `trust-buffs.json` is synced with the contract but never loaded by the renderer (combat buffs, absent from the stat sheet) |
| `ItemTemplet.json` (non-gear items, outerpedia A83) | `items.json` | ItemID → {name, icon, itemType, itemSubType, grade, canSell, sellPrice}; **optional** (`solver-files-optional.json`): skipped until outerpedia publishes it, loaded as `game.items` (`{}` otherwise), read by `itemNameOf` / `itemLabel` (`data.ts`) to name items |
| `datagen/lib/stat-keys.ts` (outerpedia; client rule `CUtilUI.IsPercentStat` / `GetStatValue`) | `stat-keys.json` | `ST_*` → `OAT_*` → {key (contract vocabulary: `atk`, `atkPct`, `chc`, `resRate`…), percent, abbr}; read by a test only (`packages/core/test/stat-keys.test.ts`), `GAME_STAT` stays the runtime table |

Refresh after a game patch: `npm run data:sync` (`data/sync.mjs`, once
outerpedia's `datagen:build` + `promote` have run).

The generator also writes `version.json` `{ schema, resVersion, hash, builtAt }`: `hash` is a `sha256`
over the content of **every** derived file (name + body, fixed emit order), so it stays
**stable as long as the data is unchanged** (a no-op rebuild keeps it identical). Read by
`loadDataVersion()` (`apps/renderer/src/data.ts`) and shown read-only in Settings › Data & updates, after
`resVersion` ("game 1.11.408 · …", the version of the loaded tables; absent from an old cache).
The `hash` doesn't cover `resVersion`: at an unchanged `hash`, the sync rewrites version.json
alone when its body differs. On a `hash`
change, `reconcileDataHash` (`lib/storage/dataHash.ts`) prunes the keys the `lib/storage/keys.ts`
registry marks `prune: true` (the filter sets and per-hero filters) of the sets and effects the data no longer knows (cf. [Data Schema](Data-Schema#re-capture-cycle-after-a-game-patch)).


### 1.3 Parse (`packages/core/src/parse.ts`)

`parseInventory(rawUserItem, rawUserChar, game)` consumes the captured JSON
and produces a typed `Inventory`. Each `GearPiece`:
- Identity: `uid, itemId, slot, setId, armorSetId, rarity, star, name, classLimit`.
- State: `breakthrough, reforgeCount, enhanceLevel, singularityLevel, ascended, locked, equippedBy`.
- Resolved stats: `main: RolledStat[]` (option + singularity + eePassive + uniquePassive)
  and `subs: RolledStat[]` (substats, OR for Talisman/EE the **socketed gems** —
  same `SubOptionList` on the API side).
- `gemSlots?: number[]` (Talisman/EE only) — array of 5 OptionIDs
  kept raw for display.

Key conventions:
- Sub `Level = totalTicks - 1` (the ticks shown in-game are `Level + 1`).
- Reforge ticks = `Level - BaseLevel` (the orange ticks).
- Sub OptionID 0 = padding, skipped.
- Talisman main goes through `BuffTemplet` (`resolveBuffMain`) — IOT_BUFF.
- Singularity option: `BT_STAT_PREMIUM` permanent unconditional, `fromBuff: true`.
- EE level-gated passives: added to `main` when `enhanceLevel >= levelThreshold`.
- Weapon / accessory unique passive on the sheet (`equipmentPassives[id].statsByTier`,
  tier `min(breakthrough, length − 1)`): `fromBuff: true, source: "uniquePassive"`,
  hidden from the UI like `eePassive` (Phantasm Necrosis SPD −30%, Briareos's Ambition
  RES +20 → +40%).
- Combat-only options (`BuffConditionType ≠ NONE`) kept but `combatOnly: true`
  → ignored by the stat aggregators but displayed in the UI.

Files: [parse.ts](../packages/core/src/parse.ts),
[stats.ts](../packages/core/src/stats.ts) (OptionID → stat resolution).

### 1.4 Compose no-gear (`packages/core/src/compose-stats.ts`)

`composeCharStats(ingredients, codexCurve, options)` computes the hero's stats
**without** their gear. Covers the layers:

1. **Base** (per-level interpolation from `CharacterTemplet`).
2. **Evolutions** (sum of rows `EvolutionLevel ≤ min(transStar, 6+lbStep)`).
3. **Class passive** (Skill_22).
4. **Skill_8** (transcend passive — goes through `BuffValueRate`).
5. **Geas** (per node, split IOT_STAT [white] vs IOT_BUFF [yellow]).
6. **Codex** (archive bonus, +N% on baseValue only).
7. **Skill passives** user-leveled (S1/S2/S3) + Core Fusion (Skill_23), taken
   at the captured fusion tier (`fusionLevel`) in `corePassiveByFusion`;
   unknown tier (missing or 0) → the highest, like the skill levels; cache
   without that field → the legacy `corePassive` (one block at max, speed
   pre-baked as flat), a fallback for caches synced before 22/10/2026 only
   (contract format 2 no longer emits it). Its speed rate (`spdPct`, fused Snow / Lisha +4.3%)
   multiplies the total speed, last: `trunc(total × (1000 + rate‰) / 1000)`.
8. **Limit Break** modifier (CharacterMaxLevelTemplet, amplifies the interp lv>100).

Output: `{noGearStats, intrinsicStats, scaling}` where `scaling` carries the
per-axis ingredients (ATK/DEF/HP/EFF/RES) to allow adding gear later via
`composeMultStat`, and `scaling.spd` = `{ value, rateBase, buffPct }`, the speed
before its rate, the part a gear rate multiplies (base + evo + IOT_STAT awakening,
without the OAT_ADD buffs) and the rate (`noGearStats.spd` has already applied it).

### 1.5 Compose final stats (`apps/renderer/src/lib/composeBuild.ts`)

`computeFinalStats(baseline, scaling, pieces, game, gemOverride?)` adds the
gear on top of the no-gear baseline. Covers:

1. `aggregateGearBuckets(pieces, game, gemOverride?)` — aggregates mains/subs/sets
   into four buckets: `flat`, `pct`, then the `fromBuff` rates (`buffPct`) and
   flats (`buffFlat`) — matching the in-game CalcFinalStat separation
   (`BuffValueRate`, `BuffValue`).
2. Per-axis compound via `composeMultStat(scaling, gearFlat, gearPct, gearBuffPct,
   gearBuffFlat)` for ATK/DEF/HP/EFF/RES: a call to core's `calcFinalStat` (one copy
   of the formula), `gearBuffFlat` added to `buffValue`.
3. Simple additive for CHC/CHD/PEN/DMG±/CritDmgRed; CHC bounded to [0, 100] like the
   client's sheet (`CStatValue.SetFinalValue`, [0, 1000] raw), the unbounded sum kept
   in `critRateUncapped` for the crit-cap gem reallocation (`CRC_OVERSHOOT_CEIL`) and
   the "wasted over the cap" advice. SPD: speed before rate (`scaling.spd.value`) +
   gear flat + buff flat (`buffFlat.spd`, EE mains) + set %
   (`floor(scaling.spd.rateBase × pct / 100)`: the item rate multiplies base + evo +
   awakening, not the Skill_8 +10 SPD), then the buff rate applied once to that total
   (`applySpdRate`, same rule as no-gear): `scaling.spd.buffPct` (hero) +
   `buffPct.spdRate` (the speed rate of a gear `fromBuff`, Phantasm Necrosis −30%),
   i.e. `trunc(total × (1000 + hero‰ + gear‰) / 1000)`; simple additive when the rate
   is zero. The RES rate of a `fromBuff` (Briareos's Ambition) lands in
   `buffPct.effRes`, read as `gearBuffPct`; a flat `fromBuff` (ATK, OAT_ADD EFF) in
   `buffFlat`, read as `gearBuffFlat`.
4. **Gem override** (solver only): skip the subs of Talisman/EE and add the
   pre-aggregated `{flat, pct}` deltas in their place. See §2.4.

File: [composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts).

### 1.6 Solver (`apps/renderer/src/lib/solver/`)

Pipeline detailed in [Solver](Solver). Summary:

- **Orchestrator** (main thread) — pool of Web Workers, partition, fan-out/in;
  runs `precomputeContext` (phases 1-3) once and broadcasts it to the workers.
- **Worker** — engine instance, computes one chunk (phases 4-6; recomputes 1-3
  only as a fallback when the precompute is absent).
- **Engine** — `prepareContext + solveChunk + finalizeBuilds`. Phases 1-6:
  precompute → pools → combo-budget prune → cartesian + set-prune → compose + ratings + heap → CP.
- **Pool rules** (`allow()` in `precomputeContext`, stacked): pieces excluded by hand
  (`excludedPieceUids`), **in-game presets** (below), then the effective owner (Worklist
  reservation ?? `equippedBy`) gated by `equippedScope` + hero ranks and `excludedHeroes`, then the
  *Maxed only* floor, quality, class, mains, effects, sets.
- **In-game presets** (`lib/presets/presetHolds.ts`, `SolveRequest.presetHolds` + `targetPresetNum`):
  each preset has a **unique rank** (`gs.presets.rank`, key = `num`, 1 = most important, unranked =
  lowest, the same operations as the heroes through `lib/storage/rankPriority.ts`, default rank =
  the in-game order `comparePresets`) and a **lock** (`gs.presets.locked`). A piece held by a preset
  P (`itemUids`, EE and empty slots left out) leaves the pool when (a) P is locked and isn't the
  targeted preset, or (b) a preset Q is targeted ("Optimize preset →") and P isn't **strictly** lower
  priority than Q (`isLowerPriority`, P ≠ Q). Without a target preset (a hero solve), only (a)
  counts, the hero's own worn pieces included. A piece held by several presets: the most
  restrictive wins. The table is built once per solve (`presetBlockedUids`), for the piece pool
  only: the gem pool ignores it (§2.7; a lock holds pieces, not gems). Local presets (`gs.presets.local`, kept in GS) never enter it: they hold no
  piece.

### 1.7 Equipment editing (`packages/core/src/equip.ts`)

The app never talks back to the game, so moving a piece means **rewriting the captured JSON**.
A piece's owner is `RawItem.CharUID` (`"0"` = free, same convention as the parser).

- `equipItem(raw, game, itemUid, charUid)` — sets `CharUID = charUid` on the piece and
  **displaces** to `"0"` whoever held that character's same slot (one piece per slot; slot
  resolved via `game.equipment[ItemID].slot`). No-op clone (input untouched) when the item is
  unknown / non-gear / already on that char; `charUid "0"` delegates to `unequipItem`. **Immutable.**
- `unequipItem(raw, itemUid)` — `CharUID = "0"`; no-op clone when absent / already free.

Persistence: the **renderer** runs the transform (it already holds core + the loaded game data
for the slot lookup), then POSTs the full rewritten snapshot to `POST /api/captured/user-item`
(a dumb writer: validates `{ ItemList[] }` + `writeFileSync`s the captured `user_item.json`, refuses
with 409 while the Steam plugin is live in a running game: the app then follows in-game moves by
itself, see §1.1). Client: `apps/renderer/src/equip.ts`
(`equipPieces` for the Optimizer's "Apply to snapshot" and the Worklist's Apply locally, `equipAssignments`
for its Apply all).

---

## 2. Calculations

### 2.1 CalcFinalStat (`composeMultStat` + `composeCharStats::calcStat`)

Reverse-engineered from `CFormula::CalcFinalStat` (libil2cpp.so 1.4.9, RVA
`0x2C59E48`). Validated 0-diff on 11/11 ATK/DEF/HP stats × 5 chars + EFF/RES
on G.Beth/Notia (core fusion +50% EFF baseline 120 → 255 in-game).
Re-checked against the 1.4.14 dump (2026-08-21): same signature, same function
size (0x9C), RVA moved to `0x2CB1C6C`.

The binary signature carries 13 parameters, two of which are **outside the
model** (always 0 app-side): `_nSpawnAdvantageRate` (dungeon monster spawn
bonus, never player-side) and `_nMonadEnchantValue` / `_nMonadEnchantValueRate`
("Monad Enhancement" nodes of the Monad Gate mode, `MonadGateEnchantNodeTemplet`
— %/flat ATK/DEF/HP/CRC/CHD/… bonuses carried by
`CCharacterData.MonadGateEnchantNodeList`, assumed active only inside that mode;
re-validate against an in-game sheet if a stat lock ever drifts).

**Formula** (rates in per-mille, flats as integers):
```
sum_flat = baseValue + evoValue + awakValue
sum_rate = awakPct + transcendPct + gearPct           (per-mille)
part1    = trunc(sum_flat × (1000 + sum_rate) / 1000)
combined = part1 + gearFlat + buffValue
part2    = trunc(combined × (1000 + buffPct) / 1000)
codex    = trunc(baseValue × codexPct / 1000)
final    = max(0, part2 + codex)
```

`Math.trunc` (not `floor`) — mirrors the signed-magic-divide-by-1000 ARM64,
diverges from floor on negative intermediates (rare but real on debuffs).

**Layer allocation** (per `scaling.{atk,def,hp,eff,res}`):
| Layer        | On what               | Source                                                  |
|--------------|----------------------|---------------------------------------------------------|
| baseValue    | sum_flat             | per-level base interpolation                            |
| evoValue     | sum_flat             | sum of evolution rows                                   |
| awakValue    | sum_flat             | geas IOT_STAT flat adds (the only awakening source, every axis) |
| awakPct      | sum_rate             | geas IOT_STAT % bonuses                                 |
| transcendPct | sum_rate             | TranscendByStar.{atkPct,defPct,hpPct} row matching star |
| gearPct      | sum_rate             | aggregated `pct.{atkPct,defPct,hpPct}` from gear        |
| gearFlat     | combined             | aggregated `flat.{atk,def,hp}` from gear                |
| buffValue    | combined             | OAT_ADD buffs (class, skill_8, geas IOT_BUFF, skill / core passives: class +EFF, geas [141] +50 EFF; 0 on ATK/DEF/HP in today's data) + gear `buffFlat.*` |
| buffPct      | part2 (outermost)    | classPassive + skill_8 + geas IOT_BUFF + skill passives + gear `buffPct.*` |
| codexPct    | codex term, baseValue| archive bonus                                           |

**SPD** (`scaling.spd`): the item rate (Speed set, OAT_RATE) multiplies
`rateBase` = base + evo + IOT_STAT awakening, the client's `sum_flat` — the OAT_ADD
buffs (Skill_8 +10 SPD of Claire, Faenan, Delta…) stay in `combined`: Claire in 4P
Speed = `trunc(99 × 1.25)` + 10 = 133, not `trunc(109 × 1.25)` = 136. Then the outer
stage — `final = trunc((speed before rate + gear) × (1000 + buffPct) / 1000)`, where
`buffPct` is the sum of the sheet's speed rates (the core passive at the fusion tier,
fused Snow / Lisha 43‰, plus the gear's `buffPct.spdRate`, Phantasm Necrosis −300‰:
fused Snow holding the weapon = `trunc(total × 0.743)`). Snow lv1 = `trunc(133 × 1.043)` = 138,
not 133 + 6; with +40 flat SPD at lv100, `trunc(189 × 1.043)` = 197.

File: [compose-stats.ts](../packages/core/src/compose-stats.ts) +
[composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts) (gear-side).

### 2.2 CalcBattlePower (CP)

Reverse-engineered from `CalcBattlePower` (libil2cpp.so 1.4.9, RVA `0x2C59EE4`;
`0x2CB1D08` in 1.4.14, signature unchanged), validated 0-diff
on 5 chars (LB0/1/2/3). Implementation: [cp.ts](../apps/renderer/src/lib/solver/cp.ts).

**Float32**: the client computes in `float`; every operation is ported as is, in its
order, under `Math.fround`, constants included (`1.7f`, `1.05f`, `0.15f`, `0.25f`,
`0.001f`), like outerpedia's `calcNoGearBattlePower` (0 difference with it over 200,000
drawn sheets). The raw inputs (display × 10) are rounded to integers, as on the client.
In double, ±1 on ~0.5% of the sheets.

**SOLVE CP hot path**: `makeCpEvaluator(consts)` pre-captures the per-solve constant
additive bonuses (`starBonus`, `skillSum`, `eeBp`, `fusionBp` — all exact integers) and
returns a closure `(stats, talisman) → cp`. Avoids the per-combo `CpArgs` object allocation
and the constant re-derivation. **Bit-identical** to `calcBattlePower`: same `cpFrom`, the
hoisted constants are integers (exact in float32). Dedicated identity test.

**Critical conventions**:
- **CRC capped at 100%** BEFORE entering the formula.
- CRC/CHD/PEN/DMGup/DMGRed/ECDR: RAW values (× 10 of the displayed %).
  The code receives the display value and multiplies by 10 internally.
- EFF/RES: integer display direct.

**Formula** (each step rounded to float32, see above):
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

**`max(0, level − 1)` per skill**: the 4 skills start at Lv1 in-game (max
Lv5), so each counts `(level − 1) × 100` and an all-Lv1 hero adds 0.
Verified on Flamberge (6★ lv5): S1 Lv1/2/3 → in-game CP 6085/6185/6285, and its
all-Lv1 sheet only falls back to 6085 if `skillSum = 0`. The ≥0 clamp protects
against a partial capture (level 0). (Old formula `max(0, first − 4)`:
wrongly assumed an Lv4 baseline for S1 — the all-Lv1 case was never tested.)

**ECDR (`critDmgRed`)**: exposed in `FinalStats.critDmgRed` (summed from the
substats / mains `critDmgReduce` via `composeBuild`). ×10 convention (like the
other rate inputs), added to `dmgredRaw` in `defR`. A build that stacks CDR
had its CP underestimated before the fix (defR ignored the ECDR contribution).

### 2.3 Cheap ratings (`ratings.ts::computeCheapRatings`)

Pure products of `FinalStats`, ~10 ns/call. No external dependency.
**Formulas aligned on the reverse-engineered math of the damage-calc binary
formulas (1.4.9)** (addresses `CFormula.<CalcDamage>g__CalcDamage|17_0` +
`CheckDamageRate`), reduced to a build-trait context (no known defender on the
solver side). Source: outerpedia damage-calc note `binary-formulas-1.4.9.md`
(legacy outerpedia checkout, `docs/damage-calc/`).

**Damage pipeline (extract from doc §1 + §3) applied to the offensive ratings**:

```
pCrit    = min(CRC, 100) / 100
chdMult  = CHD / 100
dmgUpMod = dmgUp / 100                     ← rate += attacker.DMGBoost (§3.2)
drFactor = max(0.3, 1 + pCrit × (chdMult − 1) + dmgUpMod)   ← E[DR]/1000, floor 30% (§3.2 cap)
mcdFactor= max(0.3, chdMult + dmgUpMod)                     ← assumes pCrit = 1
penPct   = min(PEN, 100) / 100             ← PPR caps at 100% (§1.2)
effDef   = TARGET_DEF × (1 − penPct)
penMult  = (TARGET_DEF + 1000) / (effDef + 1000)            ← mitigation ratio
skillFactor = bestSkill.factor / 1000      ← the hero's best skill (S1/S2/S3 at max level, bursts included); 1 when missing
turnFactor  = rotation.factorPerTurn / 1000 ← average factor per turn of the cooldown rotation; skillFactor when missing
```

**Defensive side** (`ehp`) — `dmgRed` is a **defender** stat (`rate -=
defender.DMGReduceRate` §3.2), not attacker. It reduces the damage MY build
TAKES, not the damage it DEALS:

```
dmgTaken = max(0.3, 1 − dmgRed/100)        ← inverse of the DR rate, floor 30%
ehp      = HP × (1 + DEF/1000) / dmgTaken  ← combines mit DEF + dmgRed defender
```

**`TARGET_DEF = 2000`** — constant. Reference target DEF: PvE midgame
boss. With this value PEN 50% → ×1.5, PEN 100% → ×3.0. The choice only shifts
the relative weight of PEN vs other stats; a build without PEN ranks the same
for any `TARGET_DEF`.

| Rating | Formula                                | Semantics                               |
|--------|----------------------------------------|-----------------------------------------|
| `hps`  | `HP × SPD`                             | Bulky-and-fast composite (proxy)        |
| `ehp`  | `HP × (1 + DEF/1000) / dmgTaken`       | Effective HP — mit DEF + dmgRed defender |
| `ehps` | `EHP × SPD`                            | Tanky-and-fast                          |
| `dmg`  | `ATK × drFactor × penMult × skillFactor` | Expected hit of the BEST skill vs DEF=2000 |
| `dmgs` | `ATK × drFactor × penMult × turnFactor × SPD` | DPS over the cooldown rotation (S3/S2/S1) |
| `mcd`  | `ATK × mcdFactor × penMult × skillFactor` | Max crit of the best skill (assume 100% CHC) |
| `mcds` | `ATK × mcdFactor × penMult × turnFactor × SPD` | Max DPS over the cooldown rotation |
| `dmgh` | `HP × drFactor × penMult`              | Damage HP-scaling (Aer S3, Caren, …) — NO skillFactor (100 % reference) |

Conventions:
- `CRC` and `CHD` are in **DISPLAY percent** (35 = 35%); the /100 divisor makes
  them decimal for the products.
- **CRC capped at 100%** in-game — overflow wasted. `FinalStats.critRate` is
  already bounded to [0, 100] (sheet, display, filters, Regina's `crc` secondary
  scaling); the raw sum is in `critRateUncapped` (crit-cap gems, "wasted over the
  cap" advice).
- **PEN capped at 100%** — `PPR` (PiercePowerRate) caps at 1000‰ in-game (§1.2).
  The `PiercePower` flat is not modeled (rare on builds).
- **30% DR floor** — `CheckDamageRate` clamps `rate = Max(rate, 300)`
  (§3.2), prevents the dmg/dmgh ratings from dropping to 0 on extreme
  defender DMGReduce stacks.

**`noCrit` heroes** (Rhona / K.Tamamo / G.Nella — their skills can never crit):
`computeCheapRatings(fs, dmgStat, dmgSec, noCrit=true)` forces `pCrit = 0` → the crit
term drops out of every offensive rating, and `mcd` ("assume 100% CHC") falls back to the
non-crit hit (`mcdFactor === drFactor`) since there's no crit ceiling to reach. Without
this the solver rewarded CHC/CHD a no-crit hero can never cash in. `noCrit` comes from
`meta.noCrit`, propagated through the solve context like `dmgStat`/`dmgSec`. **CP is not
affected**: `calcBattlePower` stays a faithful in-game mirror (the sheet's CHC, bounded at 100%), so
SOLVE CP still maximizes the game's real CP number.

**Not included** in the ratings (defender-dependent, out of build-trait scope):
Element (×0.8/×1.0/×1.2), Mark (×1.15), EnemyCriticalDamageReduce, MISS
multiplier, `FinalDamageReduce` buff chain. PEN is the exception: modeled
against a constant `TARGET_DEF` to allow PEN-vs-other-stats ranking.

**Skill factor (`skillFactor`, 2026-09-05)** — the Dmg column is no longer "a hit at a
100 % factor" but **the expected hit of the hero's strongest skill**: `dmg`, `dmgs`,
`mcd`, `mcds` are multiplied by `bestSkill.factor / 1000` (`characters.json`, emitted by
outerpedia's solver generator from its damage engine: max over S1/S2/S3 **at max level**,
burst states 1..3 included when they replace the burstable skill, each skill's factor =
the level's `DamageFactor` × the state's total hit factor — Σ of the resolved clip events,
else Σ tables filled to 1000 ‰ under 990; **multi-hit = sum of the hits**). The factor is
a **per-hero constant**: a single-hero solve's ranking does not move at all — the value is
the displayed number and the cross-hero comparison. It applies AFTER `dmgStat`/`dmgSec`/
`noCrit` (it multiplies the whole base); `dmgh` stays the 100 %-factor HP reference.
EXPLICIT fallback: a hero without `bestSkill` (missing data / snapshot older than the
field) → ×1.00 **and** a tooltip + amber "×1" badge in the column header
(`lib/dmgSkill.ts`) — never a silent 0. The winner (S1/S2/S3, "B1..B3" = burst) shows as
a badge in the Dmg/DmgS headers and in the tooltips (`ratingTitle`), marked "approximate"
when its hit chain is unresolved (`unresolvedHits`). **Assumed, not modeled**: DoTs (a hero
whose real "biggest hit" is a DoT — Gnosis Beth — is under-estimated by a direct-hit
factor), buffs and chains. Validated against
outerpedia's damage calculator (`buildSkillReport`, same stats, DEF 2000, 0 % crit):
Rhona S3 ×1.67, K S2-burst 1 ×2.39, Primine S1 ×0.86 — exact.

**Cooldown rotation (`turnFactor`, 2026-10-22)** — the PER-TURN columns `dmgs` and `mcds`
(damage × SPD) no longer take the best hit but `rotation.factorPerTurn / 1000`
(`characters.json`, emitted by outerpedia next to `bestSkill`): the average factor per turn
when the hero casts the strongest ready skill every turn (S3 > S2 > S1, the game's
`Cool`/`StartCool` cooldowns, no bursts, AP or DoTs), over a `cycle`-turn cycle. The
PER-HIT columns `dmg` and `mcd` keep `skillFactor`. Applied at the same place as
`skillFactor` (`computeCheapRatings(…, skillFactor, turnFactor)`, `turnFactor` defaults to
`skillFactor`); a per-hero constant, a single-hero ranking does not move. Fallback: a
snapshot without `rotation` → the best-skill factor (`turnSkillFactor`, `lib/dmgSkill.ts`),
flagged in the tooltip. The DmgS/McdS tooltip gives the sequence ("S3 ×1, S2 ×2, S1 ×1 over
4 turns") and "approx" when `rotation.approx`; the header badge stays the winning skill.
E.g. Tamamo-no-Mae: ×1.735 per turn vs ×2.004 for her best hit (S2).

### 2.4 Score (`ratings.ts::computeScore`)

```
Score = Σ over priority[key] × (effective(finalStats[key]) / STAT_NORMS[key]) × 100
  where effective(v) = key === "critRate" ? min(v, 100) : v
```

- `priority`: keyed by user keys (`atk`, `critRate`, `critDmg`, …), values `-1..3`.
- `STAT_NORMS`: endgame reference values (atk=4000, hp=30000, critRate=100, …).
- Normalization makes stats of different magnitude (HP in thousands vs CHC in
  percents) comparable.
- ×100 scaling to make the Scores readable (~50-500 typical).
- **Unrounded**: it is the sort key (heap + merge, ties broken by `pieceUids`);
  the table and the library round it for display only.
- Negative Score possible (priority -1 on a high stat).
- **CRC clamped at 100%**: overflow doesn't count in the score (consistent with
  the in-game cap and with the clamp in `computeCheapRatings`).

### 2.5 Per-roll scoring (`ROLL_NORMS`)

**Separate constant** from `STAT_NORMS` (which serves Score on final stats).
Used by `priorityScoreOf`/`magnitudeScoreOf` (combo-budget prune) and
`scoreGemPool` which score **individual rolls**, not endgame totals.

```
roll_score = priority[user_key] × (roll.value / ROLL_NORMS[roll.engine_key])
```

Sized for a max-roll on a +15 T4 sub:
- Flats: `atk=300, def=100, hp=1500, spd=20, eff=50, res=50`
- Percents: `atkPct=40, defPct=40, hpPct=40, critRate=20, critDmg=40, …`

Without this separation, scoring an ATK% roll (24% raw → ~2.4 display) with
`STAT_NORMS.atk=4000` would give a score 50× smaller than a CHC +3% roll scored
with `STAT_NORMS.critRate=100`. Real bug caught by the tests.

**Single source of truth**: `ROLL_NORMS` / `STAT_NORMS` / `STAT_TO_PRIORITY` are
**derived** from one registry, `apps/renderer/src/lib/statRegistry.ts` (`STAT_AXES`,
typed against `StatType`); `ratings.ts` only re-exports them. The keys are now
**unified** on the ENGINE names — the former user keys `crc`/`chd`/`res`/`dmgRed`/
`critDmgRed` are gone (it's `critRate`/`critDmg`/`effRes`/`dmgReduce`/`critDmgReduce`
on `FinalStats`/`priority` too). So `STAT_TO_PRIORITY` is now just the flat/%→axis
collapse (`atkPct → atk`, `defPct → def`, `hpPct → hp`); everything else is identity.
`statRegistry.test.ts` locks the coverage + a numeric parity snapshot.

### 2.6 Set bonuses (`composeBuild.ts::computeSetBonuses`)

For each armorSetId present ≥ 2× among the pieces, the rows read come from
`wornSetRows` (`packages/core/src/set-level.ts`, the single set-level function, also
read by the Optimizer's Effects panel and by the dominance key). The rule is the
contract's (outerpedia is its source, header of its `datagen/generators/solver.ts`;
client `CStatValue.SetSetItemValue`, `CItem.SetOptionLevel`):
- A piece's level (`pieceSetLevel`) = the `levels[]` row whose `breakLimitCounts`
  holds its breakthrough (today level 1 = BT0-3, level 2 = BT4).
- The 2pc (count ≥ 2) reads the row of the **minimum level of the 2 best** pieces, the
  4pc (count ≥ 4) the row of the **minimum of the 4 best**: `[4,4,3]` → 2pc level 2;
  `[4,4,3,3]` → 2pc level 2 + 4pc level 1.
- `ignoreLowSet`: when the 4pc row carries it, the 2pc is dropped if it carries the same
  stat (the client compares stat by stat), or, for a combat effect without a stat, if
  that row's 4pc is one too (`combatEffects.p4`, `p4_desc` for a cache without it). Today Penetration, Speed and Bursting at level 1 (empty
  2pc, the 4pc holds the whole bonus), Fortification at level 2 (empty 4pc, nothing
  dropped). Speed `[4,4,3,3]` → 25 %, not 13 + 25.
- Skip if `p2`/`p4` is null or `ST_NONE` (combat effect, e.g. Counterattack which
  stores its effect in `desc` rather than in a stat): nothing counts without a `st`.
- **Fallback** (cache synced before the contract carried `breakLimitCounts` /
  `ignoreLowSet`, or a breakthrough no row lists): the former rule exactly, level 2
  only when every piece of the set is BT4, for both the 2pc and the 4pc, no
  `ignoreLowSet`. Never the per-piece rule without `ignoreLowSet`: Speed `[4,4,3,3]`
  would be 38 %.

Values routed to `flat` or `pct` via `setBonusStatKey(st, isRate)`.

**Incremental accumulator (solver hot path)**: `aggregateGearBuckets` re-sums all 8
pieces per combo. The solver skips re-summing the 6 invariant pieces (weapon..accessory)
per talisman: `aggregatePrefixBuckets` aggregates them **once per accessory iteration**,
then `computeFinalStatsFromPrefix` clones that prefix and only adds talisman → EE →
gemOverride → setBonuses. **Bit-identical** to the full-array path: float addition is
left-associative, the cloned prefix is the same partial sum, and the slot order is
preserved (the EE, at index 7 after the talisman, is re-folded per talisman rather than
pre-summed — pre-summing would break the order). The `addPieceToBuckets` /
`addGemOverride` / `addSetBonuses` helpers are shared by both paths → identity by
construction. Critical because `Math.trunc` in `composeMultStat` is unforgiving of ULP
drift; covered by a dedicated equivalence test + the end-to-end solveChunk 0-diff test.

### 2.7 Gem sub-solver (`gems.ts`)

**Pool**: multiset of the OptionIDs (15001..15054) socketed on the eligible
Talisman + EE of the inventory. **Eligibility mirrors the piece selection**
(`allow()` on the engine side): the current hero's gear is always included;
gear equipped on another hero is gated by `equippedScope` (`none` excludes all,
`lower` keeps only strictly-lower-priority heroes via `heroPriority`, `all`
keeps everything); gear on an excluded hero is never counted. The in-game presets play no part: a
Talisman a locked or better-ranked preset keeps out of the piece pool (`presetBlocked`, §1.6) leaves
its gems in the pool (a lock holds pieces, not gems). Without this
gating, the solver could propose gems that physically require unequipping the
Talisman/EE of a hero the user just excluded or outranks.

**Scoring**: `score = priority[user_key] × (value / ROLL_NORMS[engine_key])`.
Sorted desc.

**Greedy allocation**: top-K for `K = talismanSlots + eeSlots` (4 or 5 depending
on `enhanceLevel ≥ 5`). First the gems with `score > 0` in their order, then the
**fillers**: gems scoring **exactly 0** (a stat outside the priority; never a
negative priority, never a stat under a `statFilters` `max`), sorted by the
relative `dmg` gain they bring the equipped build (`gemDmgGains`,
`computeCheapRatings` with `dmgStat`/`dmgSec`/`noCrit`, weighed once per solve),
then by `value / ROLL_NORMS`. Key carried by `ScoredGem.fill`, same walk
(`pickOrder`) in all four allocators; a filler crit gem follows the same skip at
the CHC cap. No filling without any priority (fallback below).

**Pre-aggregation**: `allocateGems(scored, ts, ee)` returns the displayed split
and its `{flat, pct}`, directly consumable by `aggregateGearBuckets`. Avoids N×10 `resolveStat` calls
in the hot loop.

**Fallback by mode**:
- **SOLVE** + empty priority → all scores collapse to 0 →
  `allocateGems` returns a `null` delta → `computeFinalStats` without override →
  fallback on the pieces' `subs` (= currently socketed gems).
  Preserves the in-game-equivalent stat when the player has expressed no intent.
- **SOLVE CP** + empty priority → the "priority" passed to `scoreGemPool` is the
  **CP-weight vector** `cpStatWeights(...)`: ΔCP from a ROLL_NORM-sized bump of
  each stat, evaluated at the hero's current build (a stat already at its CP cap,
  e.g. CRC ~100%, weighs ~0), which orders the pool; the allocation then goes
  through `allocateGemsByCp`: gem by gem, the one that raises most the CP of the
  equipped build with the gems already placed (re-weighed at each step, CHC cap
  included; a gem that adds no CP only once the useful ones are exhausted), once
  per variant per solve. Necessary because "max CP" implies "use the best gems available" —
  ranking by raw magnitude favored big-number dmg-reduce/flat gems that barely
  move CP, and preserving the current gems would silently disable gem
  optimization for the typical CP-mode use case.
- **Any mode** + non-empty priority → `priority × value / norm`
  for both modes (the user priority dominates, the CP weights are unused).

### 2.8 Combo-budget prune (`engine.ts`, inside `precomputeContext`)

Heuristic to bound the search space. **Crucial**: a *percentage* prune per slot
does NOT bound the product (30% of seven ~40-50 pools is still ~7e8 combos —
measured: 703M / 142s in Score mode with a priority set). So we use an **absolute
combo budget**: `allocateComboBudget` water-fills per-slot keep-counts so
`∏ keep ≤ COMBO_BUDGET × topPct/30` (small slots kept whole, the surplus flowing to
the big armor slots). The Top% slider scales the budget; at 100% it short-circuits
to exhaustive.

The budget applies to **every** branch; only the per-slot **ranking** differs (a
`scoreOf` passed to `keepTopN`):
1. **explicit priority** (Score or CP) → `priorityScoreOf`: `Σ priority × value /
   ROLL_NORMS` over the non-combat-only rolls (minus the % mains on an axis with no % variant,
   `isPctRollWithoutNorm`; same in 3).
2. **CP, no priority** → CP proxy (`cpEval` of the piece in the current build). In SOLVE CP,
   with or without a priority (branches 1 and 2), **pin** the equipped piece (the solve can
   never return a CP below the equipped one).
3. **Score, no priority** → `magnitudeScoreOf` (raw roll magnitude): no objective,
   but the product still has to be bounded.

**Required-set protection** + **pin**: for each `req-2pc`/`req-4pc` set not already
represented in the budget slice, `keepTopN` re-adds its **single top-scoring member**
outside the budget (one member per slot is enough to form the set; re-adding ALL
members — the old behavior — blew the budget back to the full pre-prune pools).
Pinned UIDs (the equipped piece — SOLVE CP only) are also always
re-added. Without the set guard, a low-score member of a required set would be
eliminated → `checkSetsFeasible` would silently kill every combo ("no builds"
without a clue). The effective pool can thus slightly exceed the budget share —
intentional.

### 2.9 Reforge simulation (`engine.ts::simulateReforges`)

Reforge budget per piece:
- 1★→6★ non ascended: `star` reforges (1..6).
- **6★ ascended (Singularity)**: `star + 3 = 9` reforges. The +3 is
  exclusive to 6★ Singularity; the other ranks have no ascension.

For each piece with `remaining = maxReforges - reforgeCount > 0`, distributes
the remaining reforges greedy by `weight × per-tick value`. The weight is the stat's
priority; without a priority, the sub's CP weight per unit (`reforgeTickWeights`: ΔCP of a
`ROLL_NORMS`-sized roll added to the hero's equipped build, divided by that norm), else
`1 / ROLL_NORMS`. Raw values are never compared across stats (180 flat HP against 4 % used
to win every tick). Cap at **LV6 ticks per sub** (observed in real data). Tie-break on the
normalized tick (`per-tick / ROLL_NORMS`).

Mutations contained on a clone — the original inventory is never modified.

**Reforge-mode projection (`projectPieceForReforge`)** — each piece is projected to
the ceiling of the **piece in the mode** (`pieceReforgePlan`, the min of both): only
a **6★ `unique`** piece ascends (`CItem.IsSingularityActivate`) and reaches the
mode's ceiling (+10 R6 classic, +10 R9 ascended10, +15 R9 ascended, the Singularity
passive in ascended only); a piece **under 6★, or a 6★ that isn't `unique`**, stops
at **+10**, at **its own reforge count** (`maxReforgesOf`: its star under 6★, 6 for
a 6★), **with no passive**, whatever the mode.
With the **Transistone potential** option (`reroll = true`), the reroll potential
(`applyRerollPotential`, `lib/solver/reroll.ts`: one line of a 6★ `unique` piece with
4 substats raised to base stage 4 — to stage 3 when the piece already has a stage-4
line —, reforges kept, LV6 cap) goes
**before** the reforges; it also applies in `disable` mode.

**Talisman slot (ooparts) and EE (exclusive) explicitly excluded**: their
`subs` is actually the list of socketed gems (the parser stores
`SubOptionList[i]` resolved to a gem in `subs`). Gems are not "reforgeable"
in-game — we swap them via the gem allocator, we don't add ticks on them. If we
applied `simulateReforges` to a talisman, we'd inflate the gem values → wrong
CP/stats when the gemOverride is null (SOLVE + empty priority case). Double
safeguard: the caller (`prepareContext`) filters the slot list, AND
`simulateReforges` rejects ooparts/exclusive in an early-return.

### 2.10 Mid-tree set pruning (`engine.ts::solveChunk`)

At each depth `D` of the armor loop (helmet=1, armor=2, gloves=3, boots=4):
- `remainingSlots = 4 - D`
- For each required set (req-2pc or req-4pc), if
  `(need = target - setCount[id]) > remainingSlots` → infeasible, skip this
  subtree.

Huge gain on `req-4pc Sharp` searches when few Sharp helmets exist.

**Armor pool pre-filter** (`armorSetWhitelist`, `precomputeContext`) — complements
the mid-tree prune. When the plans **fully** constrain the armor (`Σcount === ARMOR_SLOTS`
on a plan → 0 free slot, e.g. `2pc A + 2pc B` or `4pc A`), the helmet/armor/gloves/boots
pools are pruned to the admissible sets only (union of the full plans' conds) **before**
entering the cartesian. A partial plan (free slots) under `allowBrokenSets=true` prunes
nothing (a filler can be anything → `null` = no prune). Under `allowBrokenSets=false`, the
free slots must complete a set → the whitelist = required sets ∪ *formable sets* (present in
≥2 armor slots, `computeFormableSets`), and a leaf check `allSetsComplete(setCount)` (boots
depth, `remaining===0`) rejects singleton / set-less builds (valid shapes: one 4pc OR two
2pc). **Keep current** locked slots are exempt. Pure helpers tested in isolation.

### 2.11 Combat Power + Swaps (`upg`) filters (applied in-loop when set)

CP is expensive (~20× a cheap rating) and `upg` depends on the hero's current
loadout, so neither can be a `FilterSpec` compiled into the hot loop. BUT when a
`cp`/`upg` filter is **set**, it is applied **in the loop**, including in
SOLVE — otherwise the heap fills with the top-K **by score** then
`finalizeBuilds` removes out-of-filter builds after the fact, evicting valid
builds ranked just outside the top-K (recall loss / under-return; this was the
bug fixed in `a6aa67b`, cf. solver.md §2/§5).

- **CP / SOLVE CP**: CP computed in-loop (sort key), `ratingFilters.cp` filter
  applied immediately.
- **CP / SOLVE**: if `cpFilter` is set, CP is computed in-loop and the filter
  rejects early; otherwise CP stays lazy (computed for the top-N at display only).
- **Upg**: `equippedUids` is resolved upstream; when `upgFilter` is set,
  `upg` is computed in-loop and filtered before the push.
- **Finalize**: `finalizeBuilds` (re)computes CP/upg for display and
  re-applies the filters — which became **idempotent no-ops** since already
  applied in-loop. `compileFilterSpecs` skips `cp`/`upg` (handled separately).

### 2.12 Top-K min-heap (`engine.ts::TopKHeap`)

Fixed-capacity min-heap keyed by `score` (SOLVE) or `cp` (SOLVE CP).
`push()` drops the min if full+better. `toSorted()` returns a sorted desc.
`null cp` ranks as `-Infinity` → never in the top.

### 2.13 Generation tracking (`solver.worker.ts` + `orchestrator.ts`)

Avoids corruption on re-submission of a solve (user re-clicks SOLVE, or switches
SOLVE → SOLVE CP while a computation is running).

- **Orchestrator**: `solveId` monotonic incremented at each `solve()`,
  embedded in `SolveRequest` then echoed by every `WorkerOutput`
  (`progress`/`result`/`error`). `handle()` drops any event whose
  `solveId !== currentSolveId`.
- **Worker**: `currentGen` monotonic, incremented at each `solve`/`cancel`
  message. Each `runSolve(req, myGen)` captures `myGen`, checks
  `myGen === currentGen` before each post (progress / result / error). If stale,
  bails without posting.
- **MessageChannel per run**: each `runSolve` creates its own MessageChannel +
  local `pendingResolve`. Prevents two concurrent runs from clobbering each
  other's resolver (otherwise: OLD's resolver lost → await never resolved →
  coroutine + its `solveCtx` leak).

Without these 3 safeguards, OLD's stale `result` arrived after the orchestrator
reset `active = true` for NEW → builds mixed into `buf`, `workersDone`
incremented wrongly, premature flush.

---

## 3. Sources & validation

### 3.1 In-game tables referenced

The raw source tables live in outerpedia's datamine; the app only ever sees
the 22 derived artifacts, one of them optional (`items.json`, see below). Refreshed **at launch** by `data-sync.ts`
(`apps/desktop/src`) in two modes:
- **checkout** (dev / maintainer machine) — copy from a local outerpedia
  checkout (`data/generated/solver/`), guarded by the version.json hash
  (at an unchanged hash, only a differing version.json is copied), zero network;
  all 22 files are read before anything is written: a missing or unreadable
  artifact refuses the sync and keeps the cache, like `data/sync.mjs` (same
  list, `apps/desktop/src/solver-files.json`);
- **repo** (packaged build) — downloads the 22 artifacts from the public repo
  `Sevih/outerpedia` via the jsDelivr CDN, gated on the SHA of the latest
  commit (`api.github.com/.../commits/main`). Allows following patches
  **without publishing a new build**. Every downloaded artifact must parse as
  JSON, else nothing is written. Degrades gracefully offline (uses the
  already-cached `data/derived`, when complete).

In both modes a cache counts only if all 21 required files are there; writes go in two
steps (every `.tmp`, then the renames, version.json last) and a write failure
is an `error` status naming the file; one sync at a time (a call while a sync
runs gets its promise).

Exception: the **optional** artifacts (`solver-files-optional.json`, today
`items.json`), listed before outerpedia publishes them. Absent from the source
(file missing from the checkout, 404 in repo mode — any other failure refuses
the sync as for a required table), they are skipped: the other tables are
delivered, the sync message (hence the `data sync:` log line) adds
"items.json not published yet, skipped", a copy already cached stays in place;
`data/sync.mjs` does the same with a log line. Present, they are delivered and
refused (broken JSON) like the others.

`data/sync.mjs` (the dev-time copy) finds the outerpedia checkout via the
`OUTERPEDIA_PATH` env var, then `OUTERPEDIA_PATH` in `.env.local`, then the
sibling `../outerpedia` checkout, and exits non-zero
if the checkout or any of the 21 required artifacts is missing, or any
artifact is not JSON, before writing anything.

`sub-ticks.json` (derived): per-tick values of the ATK/DEF/HP flat+% subs per
star (5★/6★), recomposed by outerpedia's solver generator from `ItemOptionTemplet`
(the **subs**, not to be confused with
the mains of `statRanges.json`). Feeds the Optimizer "Sub tick value" box
(flat vs % profitability, `lib/subValue.ts`). The 2nd box "Damage / +1%"
(`lib/dmgValue.ts`) compares the damage gain of +1% of the scaling/CHD/DMG inc
stats via `computeCheapRatings` (binary RE damage model 1.4.9).

**Critical tables for the math**:
- `CharacterTemplet.json` — base stats, skill blocks, class passive
- `CharacterEvolutionStatTemplet.json` — evolution rows
- `CharacterTranscendentTemplet.json` — transcend % bonuses
- `CharacterMaxLevelTemplet.json` — LB modifiers
- `ArchiveBonusTemplet.json` — codex bonuses
- `CharacterAwakeningNodeTemplet.json` + `CharacterAwakeningLevelTemplet.json` — geas (nodes + tiers)
- `ItemEnchantTemplet.json` — enhance/tier/singularity scaling factors
- `ItemOptionTemplet.json` — base values for substats + gems
- `BuffTemplet.json` — Talisman main scaling per enhanceLevel

### 3.2 Regression locks (`data/stat-locks.json`)

Per-character snapshots (charId × level × LB) with in-game-validated final
stats. Committable file — formula maintenance must keep these locks green.
9 heroes covered today:
- Flamberge (2000050)
- Aer (2000055) lv100, no LB
- Core Fusion Notia (2000056) lv100
- Gnosis Beth (2000092) lv120 LB3
- Caren (2000089) lv120
- Gnosis Dahlia (2000090) lv120
- Demiurge Luna (2000119) lv120
- Mystic Sage Ame (2000110) lv105 LB1
- Midnight Rush Skadi (2000114) lv110 LB2

The `gs.debug.statLocks` toggle in Settings › Advanced (declared in `lib/settings.ts`, like every setting of Settings › Solver, › Display and › Advanced) shows the locks vs computed on the
Heroes tab, with a "drift" badge when a stat diverges.

### 3.3 Automated tests

| File | Coverage |
|---------|------------|
| `packages/core/test/parse.test.ts` | 18 tests — parser substats/main/talisman/EFF flat, scaling enchant, singularity; presets: `PresetOrderList` read by `Num` (absent, missing fields → 0), `comparePresets` (type, favorites, order descending, number) |
| `packages/core/test/equip.test.ts` | 11 tests — `equipItem`/`unequipItem`: set on empty slot, **displace** the occupied slot (same char), no-op (already equipped / unknown item / non-gear), `charUid "0"` = unequip, displacement scope (other char/other slot untouched), input **immutability** |
| `packages/core/test/compose-stats.test.ts` | 56 tests — **stat-lock captures** reproducible without gear (Flamberge 8/8, Core Fusion Notia EFF, Aer 6/8, M.S.Ame white ATK/DEF/HP/EFF), `baseAtLevel` (lv1 = Min / lv100 = Max, LB tiers 105/110/120, independent floors, monotonicity), `sumEvoUpTo` (level gates 20…120, `min(TransStar, 6 + LB)` cap, monotonicity), `calcFinalStat` (two-stage trunc, codex on base only, trunc toward 0 + clamp, monotonicity), `composeCharStats` lv1→120 monotonicity over the committed roster, **term-by-term check against the client `CFormula.CalcFinalStat`** (exact-integer reference on 20 000 inputs, white sheet = base/evo/awakening only), data guards for the client terms the composer does not model, **Core Fusion**: passive at the captured fusion tier (Notia EFF at tiers 1 / 4 / 5, unknown tier = max, format 2 without `corePassive`), SPD rate applied last in agreement with the client at every level (Snow 138 / 141 / 144 / 148, Lisha 124), legacy `corePassive` fallback pinned |
| `apps/renderer/test/solver.test.ts`     | 117 tests — gem pool/score/alloc/delta (+ eligibility filter), gem override equivalence, **set-bonus hoist equivalence**, cheap ratings (+ CRC clamp, **damage-stat scaling atk/def/hp + secondary additive**, **noCrit heroes**), score normalization (+ CRC clamp, **PEN clamp at 100%**), reforge sim (+ 6★ ascended budget, Talisman/EE rejection), top-K heap, STAT_TO_PRIORITY mapping, CP clamps (skills.first, ECDR), **`makeCpEvaluator` bit-identity**, **incremental bucket accumulator equivalence**, **worklist claims** (a FREE piece claimed by a higher-rank hero is excluded, claimed by the solving hero itself stays in), **"Maxed only" floor** (`maxedFloorOf` / `meetsMaxedFloor`: off / +10R6 / +10R9 / +15R9, the piece's own ceiling — a 5★ at +10 R5, a non-`unique` 6★ at +10 R6, no star = the mode's floor —, talisman gated on enhance only), **`collapseTalismanVariants`** (≤ k builds per 6-gear signature, sorted order, k ≤ 0 = off) |
| `apps/renderer/test/gemsCapped.test.ts` | 16 tests — `allocateGemsCapped`: parity without crit gem, accept up to CHC 100 (overshoot ≤102), stop exactly at 100, total skip at cap, talisman/EE split, null delta if nothing useful, score ≤0 never taken |
| `apps/renderer/test/workerCount.test.ts` | 12 tests — `resolveWorkerCount`: default `hardwareConcurrency-1`, override `gs.solver.workerCount` (read by `readSetting`) brought back to the core count, clamp ≥1, hard ceiling 64; `clampWorkerCount` (the rule shared with Settings) |
| `apps/renderer/test/settings.test.ts` | 19 tests — `lib/settings.ts` registry (one declaration per setting of Settings › Solver, › Display and › Advanced, plus the Presets loss threshold and `gs.settings.pane`): unique keys and current defaults, `appliesNextSolve` flag (workers, topN, topK only); `clampSetting` (bounds, rounding to the step, workers bounded by the cores and 64, result rows 5–15, an old pane mapped through `legacy`); `readSetting` (default when absent, invalid or localStorage unavailable, stored value otherwise; read by `lib/log.ts`); Settings › Solver Reset through the registry (its five settings); static render: the Solver pane holds the « applies next solve » settings and no Display group, Display the heatmap, compact cards and result rows, Settings reopens on the last pane (a stored Debug on Advanced) except before onboarding is done |
| `apps/renderer/test/settingsPanes.test.ts` | 9 tests — the six Settings panes (U12): `gs.settings.pane` migration (« debug » / « logs » → Advanced, « data » kept, unknown → Setup); static render of `SettingsModal`: the rail in the order Setup, Data & updates, Solver, Display, Backup, Advanced; Solver without display setting nor loss threshold; Display with heatmap, compact cards, result rows; Advanced with both debug toggles, Reset onboarding prompt and the journal; Data & updates with the update card and the game data version; `resetSolverSettings` / `resetDisplaySettings` (five and three setters); Gear › Overview (`OverviewView`, ex-Home) without the update card |
| `apps/renderer/test/reforgeDefaults.test.ts` | 9 tests — hero defaults of Settings › Solver (D5): `gs.solver.reforgeMode` / `gs.solver.rerollPotential`, `classic` / `false` out of the box, the modes of `REFORGE_MODES`, a value outside them back to `classic`; the pane's Reset puts back five settings; `legacyReforgeMode` (the one `useReforged` → `reforgeMode` migration, saved builds and filter presets); `filterDefaults` only swaps the mode and Transistone of `INITIAL_FILTERS`; `filtersForHero` serves the defaults to a hero with no kept filters, their own to a hero who has some; `resetAll` goes back to the given defaults; static render of `SolverPane`: « Hero defaults », Off / +10R6 / +10R9 / +15R9, « Transistone potential by default » |
| `apps/renderer/test/transfer.test.ts`   | 28 tests — backup v2: export → import round-trip of a localStorage holding every `backup: true` key (the app's own state stays home), a key never written left out, re-importing the same file writes nothing; v1 file (five blocks under their keys, optional blocks absent); each merge rule (per-hero lists: the stored entry wins; Gear filter sets on id or name; local presets; preset heroes; maps by id: the imported entry replaces — notes, per-hero filters, columns; ranks renumbered 1..N; id lists merged as a union; worklist by hero; settings bounded, wrong type ignored); unknown key ignored; validation (kind, version, v1 blocks, v2 container before any write); mounted screen reloaded after import (also when a write fails halfway); static render of Settings › Backup (what leaves, never the capture) and import status by label |
| `apps/renderer/test/keys.test.ts`       | 7 tests — `lib/storage/keys.ts` registry: unique keys, every `"gs.` literal of the code in the registry and back, owner module exists, settings composed from `SETTINGS`, `backup: false` localStorage exceptions limited to `gs.tab`, `gs.onboarding.done`, `gs.settings.pane`, `gs.data.hash`, `gs.*.seen` and no session key backed up, pruned keys = filter sets + per-hero filters, each with its pruner, list labels unique |
| `apps/renderer/test/solveChunk.test.ts` | 4 tests — end-to-end `solveChunk` (hand-built `SolveContext`): **mid-tree set prune** (req-4pc → 1 scored combo vs 16 brute-force; infeasible → 0), **solver↔Heroes 0-diff**, **chunk partition equivalence** (union of N chunks = single-chunk run, no combo lost or duplicated) |
| `apps/renderer/test/solveChunkCritCap.test.ts` | 3 tests — `solveChunk` crit-cap path (`critRate` priority + crit gems): each build gets `allocateGemsReachingCap`'s gems for its pre-gem CHC, sheet + CP = independent recompose, default allocation kept (same object) when the delta is equal, below / on / above the cap, 4- and 5-slot talismans; union of 2 chunks = single chunk |
| `apps/renderer/test/orchestratorFlow.test.ts` | 10 tests — `SolverOrchestrator` with a fake `Worker` (`vi.mock` of the `?worker` import): one `onResult` once every dispatched chunk answered (fewer chunks than workers included), stale output of a superseded solve dropped (`solveId`), `cancel`, `onerror` crash (during a solve / idle), estimate (stale response dropped, `null` on a failed precompute, crash without a banner, superseded by a solve) |
| `apps/renderer/test/setPlans.test.ts`   | 26 tests — chip expansion (`setPicksToPlans`), `planSetIds`, `planSlots`, `planFeasible` (multi-cond sum), `setsFeasible` OR + leaf-validation at `remaining 0`, mono-plan req-4pc parity, **`armorSetWhitelist`** (full vs partial prune × broken on/off), **`allSetsComplete`** |
| `apps/renderer/test/translateReco.test.ts` | 16 tests — reco→patch: mains (OR-union, key outside the registry skip+warn), effects (icons required, null skip+warn), talismans (`preferred`, unresolved skip+warn, whole family on the real `equipment.json`), sets (combo→plan 1:1, unresolved combo dropped entirely), substat priority (tiers→weights, bucket collision, unknown key) |
| `apps/renderer/test/subValue.test.ts` | 5 tests — `flatVsPctTick`: verdict on both sides of the crossover, exact flat-equivalent, equality exactly at the crossover, %=0 tick guard |
| `apps/renderer/test/dmgValue.test.ts` | 4 tests — `dmgTickGains`: descending sort, delta→gain monotonicity, CHC null if crit-cap, base 0 → empty |
| `apps/renderer/test/buildAdvice.test.ts` | 24 tests — `computeAdvice` (Heroes): no-gear silent, missing on a near-complete hero (≤2) vs silent WIP (early-return), sets (singleton / 3-of-4; free piece of the set in the inventory vs worn by another hero vs none vs reserved by the Worklist for another hero / for this one), `poor` quality listed in one line, wasted caps — crit tolerated ≤102 / PEN >100 (rounded threshold >0), empty gem slots Talisman/EE + reach-+5 tip, aggregated upgrade (unused reforges / 6★ not ascended / below enhance cap), singular/plural wording |
| `apps/renderer/test/cpPrune.test.ts` | 23 tests — combo-budget & scorers: `keepTopN`/`keepTopPct`/`keepTopUnion` (top-N, required-set preservation, equipped-piece pin, min-stat floor retention), `priorityScoreOf`/`magnitudeScoreOf` (weighting, combat-only exclusion), `allocateComboBudget` (product bound, small slots kept whole, input order), CP proxy ranking high-CP gear, `cpStatWeights` (offensive ≫ dmg-reduce, weight ≥ 0) |
| `apps/renderer/test/heroPriority.test.ts` | 21 tests — per-hero priority store: `rankOrder` / `isLowerPriority` (unranked < ranked, uniqueness, strict), `reorderRank` / `moveRankBefore` (contiguous 1..N positional insert, drag, clamp, immutability), `fillUnrankedByOrder` (keeps manual ranks, fills unranked by CP, compacts gaps, ignores stale uids) |
| `apps/renderer/test/weights.test.ts` | 6 tests — a hero's priority weights (`lib/heroPriority/weights.ts`): `hasPriority` / `effectivePriority` (empty, absent, only zeros → none; one weight → the priority itself); `priorityOf` (kept filters with a weight → `"filters"`, kept filters without one or none + a saved build → the most recent one, `"saved"`, nothing → null) |
| `apps/renderer/test/rankDefaults.test.ts` | 9 tests — default ranks set by App on import (`useRankDefaults`): `rankDefaults` (a fresh inventory ranked in the given order, a second pass with nothing new → `changed` false and the same objects, a newcomer at the next rank without moving the others, a key seen but unranked never re-ranked), `heroRankOrder` (CP desc on the real contract, an unresolved CP last, without game data the roster order), `presetRankOrder` (= `presetGameOrder`); `BuildsScreen` / `PresetsScreen` sources without `gs.priority.seen` / `gs.presets.seen` or `fillUnrankedByOrder` |
| `apps/renderer/test/sheetMinors.test.ts` | 14 tests — sheet minors (2026-10 review): Speed set on base + evo + awakening (Claire 133, Faenan 137, Delta 146), bounded CHC and `critRateUncapped` (Regina `crc`, advice, `solveChunk` crit-cap reallocation), float32 CP (three sheets ±1 in double), `fromBuff` flats in `buffFlat` (ATK, OAT_ADD EFF, dominance), `composeMultStat` = `calcFinalStat` exactly (heroes × codex × values) |
| `apps/renderer/test/dominance.test.ts` | 10 tests — `pruneDominatedForCp`: strict drop, ties/Pareto/groups kept, reforge projection, end-to-end top-CP equivalence via `solveChunk` |
| `apps/renderer/test/statRegistry.test.ts` | 13 tests — stat registry (`STAT_AXES`): `PCT_ROLL_KEYS` = the `pct` variants, `magnitudeScoreOf` ignores a % main on a flat-only axis (Phantasm), FinalStats coverage, `STAT_TO_PRIORITY` flat/%→axis bridge, design-token completeness, numeric parity snapshot, legacy-key migration |
| `apps/renderer/test/worklist.test.ts` | 40 tests — `upsertWorklistEntry` (replaces by `heroUid`, keeps the others' order, ticks included), `loadWorklist` (an entry stored without `kind` reads as a piece line, two entries of one hero → the first), gem lines (`worklistChangesFor`: a build changing only a gem, `fromGem`, zeros ignored, pieces then gems, `toCount` = copies kept + rank; applied = piece on the hero + enough copies of the gem, in any socket — a copy already kept doesn't tick the line for a second one, two lines for one id where the second waits for its copy once the first is pruned, rank-in-entry fallback without `toCount`; `remainingChangeCount`, `worklistClaims` and `planWorklist` ignore them, `reconcileWorklist` + `appliedNotice`), target read from the current snapshot (`worklistTarget`: the present piece's name and main, falling back on the stored `toName` / `toMain` when it's missing, screen render), gone piece (a *stale* line, out of `remainingChangeCount`'s count and of `worklistClaims`' reservations, `reconcileWorklist` keeps it and reports it once, on the snapshot that loses it, `goneNotice` counts pieces rather than lines, the screen says "piece gone" without calling the card applied), apply outcome per cause (`equipAssignments` / `equipPieces`, `EQUIP_FAILURE`), toasts (fake-timer store, stack render), the screen's links out (a card's hero and a line's wearer → "Optimize →", "in Gear" → Gear, with their `aria-label`; plain text without the callbacks) and the reservation line (`RESERVATION_NOTE`, shown for a non-empty queue, absent otherwise) |
| `apps/renderer/test/worklistPlan.test.ts` | 20 tests — `planWorklist` transaction planning: free-before-use ordering, contention flags (one copy wanted twice), no `superseded` any more (one entry per hero), the `equipAssignments` fold returns `"ok"` and hands the piece over, cycles applicable atomically (only the cycle's members; an entry depending on one is ordered after it), applied/stale changes excluded, empty plan; `worklistClaims` (solver reservations): each unapplied change's target → claiming hero, already-applied changes skipped, newest entry wins a double-claim, empty map without inventory |
| `apps/renderer/test/presets.test.ts` | 31 tests — Presets tab: `presetRows` (the game editor's order: favorites, player's order, number, Master League last; number otherwise, EE never in the preset, exact wearer despite another EE / one piece off → not a wearer, missing piece with its wire slot, shared piece flagged on both sides, empty preset), `presetSignature`; `presetClasses` (restricted weapon, restricted accessory, two classes kept, fallback reference → wearers → associated, unknown); `arrangePresets` (filter, empty / unknown cards hidden, class sort with and without a filter, priority sort: rank 1 first, the unranked last in the game's order); `evaluatePresetFor` (the preset's pieces + the hero's EE, not the preset's: −200 ATK from a known weapon), `loss` 0 when the preset is the best outfit, null without a priority; `bestKnownFor` (most recent saved build over the current gear, recomposed from its pieces despite wrong stored `finalStats`, with the EE gems it allocated, re-scored with the current priority; a piece missing from the inventory → current gear); `gs.presetHeroes` store (round-trip, uid outside the roster ignored, one role per hero, unreadable storage) |
| `apps/renderer/test/presetHolds.test.ts` | 18 tests — in-game presets in the pool: `presetHolds` (each preset's pieces, EE and empty slots left out), `presetBlockedUids` (a locked preset out of every pool but its own, target rank 3 without ranks 1 and 2 but with rank 4 and the unranked, rank 1 takes everything, an unranked target takes nothing of another, without a target only the locks, a piece held by two presets → the most restrictive), `presetHoldersOf` (holders other than the target, best-ranked first), default rank = the game's order (`presetGameOrder` + `fillUnrankedByOrder`, a cleared rank stays cleared); `allow()` on the real contract (`precomputeContext`): no target / a target / the locked preset targeted, a request without the table, stacked with `excludedPieceUids` and `worklistClaims`, a piece the hero wears; gem pool unaffected by locks (`buildGemPool` keeps a locked preset's Talisman gems; through `precomputeContext`, the Talisman leaves the piece pool, its gems stay in `scoredGems`) |
| `apps/renderer/test/presetsGems.test.ts` | 13 tests — Presets tab, tuning: `bestEeGemsFor` on the real gem table (never the gems of the preset's Talisman, even free, nor another hero's EE, nor the hero's own Talisman; a free EE the Worklist reserves for another hero out of the pool, for this hero in it; a socketed gem kept in place; null without a priority or when the EE already holds the best; score with the proposed gems > as socketed; `eeGems` = the socketed gems composes like the EE), `alignToSockets`; `presetWorklistFor` (the differing pieces then the EE gem lines alone, missing piece left out, a wearer with nothing to tune → nothing, the hero's entry replaced); `priorityOf` (kept Optimizer filters > most recent saved build > null, a weightless priority skipped); `gs.presetHeroes` in the backup (round-trip, the local entry wins, a backup without the field) |
| `apps/renderer/test/presetLossRealRolls.test.ts` | 6 tests — Presets loss in real rolls on both sides: a preset made of the saved build's very pieces loses 0 (± 1e-9) despite wrong stored `finalStats`, a weaker piece loses, a saved-build piece missing → `source: "current"`, the allocated gems replace the socketed ones (empty allocation = socketed gems kept), `gemAllocationOverride` on Talisman + EE (buckets, slot left out = socketed gems, `eeGemOverride` = the EE-only case), `buildGemPool` without a preset option (`@ts-expect-error` on `presetBlocked`) keeps a locked Talisman's gems |
| `apps/renderer/test/sessionViewState.test.ts` | 7 tests — view state kept across a tab switch: codecs `jsonStringSet` (a list of uids round-trips, non-string entries dropped, a non-list refused) and `jsonOneOf` (a known value read, an unknown one refused → the hook's default); the sources of `GearScreen` (`gs.gear.view`), `InventoryScreen` (`gs.inv.selected` / `.selection` / `.selectMode`, `gs.gear.scrap.filters` / `.selectMode`), `PresetsScreen` (`gs.presets.classFilter` / `.sort` / `.forced` / `.open`) and `OverviewView` (`gs.gear.breakdownView`) read through `useSessionState` |
| `apps/renderer/test/recoPriority.test.ts` | 12 tests — default priority from the reco (U6): `recoPriorityOf` (a one-build reco → tiers 3/2/1, several → the first, the priority alone without mains or sets, no reco / no build / an empty priority or unknown key → null); `solveDecision` (`score` with the hero's priority, `score-with-reco`, `cp-fallback`, `cp` in CP mode); `samePriority` (a missing stat = 0, an edited weight or an added/removed stat → different); `fetchReco` stubbed (first build read from `/api/reco/:id`, 404 and a network failure → CP fallback) |
| `apps/renderer/test/priorityBanner.test.ts` | 9 tests — static render of the Optimizer toolbar (a Score \| CP segment then a single "Solve", no ▾ menu nor "Solve CP", the current mode's segment pressed, "Loading reco…" disabled, Cancel while solving, the banner under the hero row with the popovers closed) and of `PriorityBanner` (no priority: Load reco / Set priority / Use CP; no reco: Set priority / Use CP; CP mode without Use CP; the reco's priority: Edit / Clear) |
| `apps/renderer/test/gearCard.test.ts` | 11 tests — one piece card (U10b): static render of `GearCardBody`, the same piece, not projected, gives the same body for Gear and the Optimizer (a zero projection included), only the wearer line differs; rarity / slot line, lock, horizontal gradient, +15 title and `w-30` column on both sides; full header (G107): the name on two lines at most (`line-clamp-2`, no more `truncate`), slot and class as two `span`s; Quality block (title, help, score, reachable, tier, bar) on both sides; `effects="card"` renders the weapon passive and the 2 / 4-pc set bonuses, `effects="none"` neither, and the EE as image + gems; projection: cyan ticks and `T+n`, without it `LV n (base + reforges)`; `compact` keeps the compact card |
| `apps/renderer/test/gearDetailWearer.test.ts` | 6 tests — static render of the piece card: the wearer's portrait as an "Optimize ‹hero› →" button with `onOptimizeWearer`, a plain portrait without it and in a tooltip (`inTooltip`), nothing without a wearer; `ItemDetail`: "Optimize wearer →" next to "Never use", greyed out on a free piece, absent without the link |
| `apps/renderer/test/headerU8.test.ts` | 8 tests — one header (U8): `captureBadge` (each Steam state → label and tone, one vocabulary, never "Steam ·"; `title` with the game folder and the live plugin's version), `updateBadge` ("vX ready" once downloaded, "vX available" while downloading or by hand, nothing when up to date / checking / offline), `dataVersionLabel` (game version · hash · build date, no game version on an older stamp, "—" without a stamp); static render of `GsHeader` (one capture pill, update badge present or absent, its `title` pointing to Settings › Data & updates) and of the first-capture steps `FirstCapture` (point to the header button and Setup, no action button) |
| `apps/renderer/test/heroPicker.test.ts` | 12 tests — one hero picker (U10a): static render of `HeroPicker` in `single` (the picked hero's displayed name, closed; open, one row per hero with a portrait, a Core Fusion hero's fused portrait, the picked one `aria-selected`) and in `multi` (label, "N selected" and ✕ only once something is ticked; open, checkboxes ticked for the picked heroes, portraits); `heroSearchHaystack` / `heroMatches` (a fused hero found under its displayed name and its base sheet's nickname, "fusion", empty query, no data); `heroListOrder` (rank then CP then capture, unranked after ranked, no CP after those with one, stable ties, CP only, input left untouched) |
| `apps/renderer/test/tabs.test.ts` | 5 tests — tab names (U11, U13): `parseTab` (a stored `gs.tab` "Builds" / "Builder" / "Inventory" / "Home" → Heroes / Optimizer / Gear / Heroes, a current tab unchanged, `null` / "nope" / "Debug" / `42` / "toString" → Heroes); static render of `GsHeader`: the five labels in order Heroes, Optimizer, Presets, Worklist, Gear, none of the former ones nor "Home" |
| `apps/renderer/test/gearScreen.test.ts` | 6 tests — Gear tab (U13), static render of `GearScreen`: without an inventory the first-capture steps ("No account captured yet") whatever the view; with a two-piece inventory, the bar Overview, Pieces, Scrap in order, Overview with "Gear quality distribution", Roster and Gear breakdown but no "Account snapshot", "Library" nor "System health"; Pieces with All / Gear / Special Gear; Scrap with the "Scrap candidates" link and the line for tables without scrap prices; `scrapDefaultFilters()` equal to `SCRAP_CANDIDATES`' filters; `BuildsScreen` without an inventory shows `FirstCapture` |
| `apps/renderer/test/overviewSets.test.ts` | 2 tests — Gear › Overview (`computeStats` of `lib/gear/overviewStats.ts`): the top sets and the catalog carry the numeric `armorSetId` (the click to Pieces filters on it), with or without game data |
| `apps/renderer/test/overviewQualityBar.test.ts` | 3 tests — Gear › Overview quality bar (G107, `QualityBar`): five `button`s with the tier buttons' proportions, colors and `title`, inert at `count === 0`, a click calls `onDrill({ quality })` for its slice; without `onDrill` all inert, the `title` reduced to the hint |
| `apps/renderer/test/builderToolbar.test.ts` | 3 tests — Optimizer toolbar rows (G107): row 1 in `flex-wrap`, Score \| CP, Solve, Filter (and ✕) then the seven popovers in an `ml-auto` group; row 2 Reforge, Maxed only, Transistone potential and reset filters, no popover |
| `apps/renderer/test/presetOptimize.test.ts` | 9 tests — "Optimize preset →": `presetOptimizePatch` (the weapon's, accessory's and talisman's effects `required`, the talisman widened to its family; a piece missing or without an effect → slot left open and a note; substats from the outfit alone 4+/3/2 pieces → 3/2/1, talisman and EE aside; merged with the reco, max of the weights, reco first then piece count, cut at 5; empty outfit without a reco → no priority; mains from the reco only, empty `setPlans`; merged by `mergePreset`: bands kept, sets open); `presetOptimizeNote` (with and without a reco) |
| `apps/renderer/test/presetsOvercap.test.ts` | 9 tests — wasted caps: `overcapOf` (the rule shared by Heroes / Presets: nothing under the caps, nothing at 102 crit exactly nor at 100 PEN, raw crit 142 with `critRate` bounded at 100 → 40 wasted and the Heroes text, fallback on `critRate` without the raw sum, PEN 120 → 20, two axes crit first); `presetOvercap` (warning tone from `OVERCAP_WARN_PTS`, no evaluation → nothing, the proposed EE gems' share vs as socketed) |
| `apps/renderer/test/critCell.test.ts` | 7 tests — raw crit past 100 in the Optimizer: `critCellParts` (raw 142 → `{ shown: 100, over: 42 }`, 100 exactly and under the bound → `over` 0, rounded to 0.1, fallback on `critRate` without the raw sum); `critCellTitle` (142 → 40 wasted over the 102 tolerance, 101.5 → within the buffer, nothing under 100); `computeColumnRanges` (crit heatmap range read on the raw sum: 80 → 142) |
| `apps/renderer/test/deltaCp.test.ts` | 2 tests — `deltaCpLabel`: reforge `Off` → bare `ΔCP ±X`, no tooltip; active mode → `vs equipped (build at <mode>)` + tooltip |
| `apps/renderer/test/talismanPreferred.test.ts` | 8 tests — `talismanEffectPicks` on the real contract (`precomputeContext`): owned preferred → pool narrowed to it (variants included; the advice's family: only a 5★ owned → it, no member → whole pool), not owned or dropped by another filter (class, "equipped" scope) → whole pool, unowned `required` → empty pool, `excluded`, keep current locked, absent field → whole pool |
| `apps/renderer/test/heroTracker.test.ts` | 11 tests — `buildHeroTrackerExport` (outerpedia hero-tracker export): versioned envelope keyed by base hero id, level/affinity resolved from the XP curves (floors lv5 / aff 1), EE level taken from the owned EE item (best copy, non-EE gear ignored), fused hero under its base id + nested `core_fusion` block (omitted when unfused, tier 1 when the level is missing), `transcend_star` clamped to base rarity and out-of-range values clamped, unknown hero still exported |

Run: `npm test --workspaces --if-present`. **Total: 300 tests** (core 22: parse 11 + equip 11 · renderer 278: solver 95, solveChunk 4, gemsCapped 16, setPlans 26, transfer 8, translateReco 10, workerCount 7, worklistPlan 11, subValue 5, dmgValue 4, buildAdvice 16, cpPrune 23, heroPriority 21, dominance 10, statRegistry 11, heroTracker 11).

### 3.4 Reverse engineering — libil2cpp.so

Key formulas come from the libil2cpp.so dump (1.4.9 build, decompiled via
Ghidra/IDA). Known addresses (1.4.9 → 1.4.14, dump of 2026-08-21 in
`outerpedia-v3/.gamedata/apk/dumped/`):
- `CFormula::CalcFinalStat` — RVA `0x2C59E48` → `0x2CB1C6C`
- `CFormula::CalcBattlePower` — RVA `0x2C59EE4` → `0x2CB1D08`

The C# signatures (`dump.cs`) are identical across both builds; only the
addresses move. Check a new dump by searching `static int CalcFinalStat(` in
`dump.cs`.

### 3.5 External sources

- **outerpedia** (public repo `Sevih/outerpedia`) — source of the game tables
  (`data/generated/solver/` artifacts). **Images** come from the R2 bucket
  `img.outerpedia.com`. The shared `/img/*` handler (`img-cache.ts`, used by
  both the Vite middleware **and** the prod Electron server) resolves in
  cascade: bundled sprites (`apps/renderer/public/img`, the `ui/inven/*` set
  absent from R2) → local checkout (dev, `.assets-staging/images` via
  `OUTERPEDIA_PATH`) → persistent **disk cache** → **R2** + cache write →
  fallback `.png`→`.webp`. Namespace alias: `ui/effect/*` → `equipment/*`
  (V2 layout → R2). Each asset is therefore fetched only once. Cache:
  `.cache/outerpedia` in dev (gitignored), `<userData>/outerpedia-cache` in
  prod. The background prefetch (prod) warms the equipment icons referenced by
  the derived data, once per version hash. Repo coordinates + SHA centralized
  in `repo-source.ts`.
- **Historical RE notes** — the detailed derivations (CalcFinalStat, CP,
  inherent EE/Transcend, locks workflow) lived in the Claude memory of the
  outerpedia-v2 project, since deleted. What remains: this document (§2), the
  header comments of `compose-stats.ts` / `cp.ts` / `ratings.ts`, and the
  `dev/legacy/outerpedia/docs/damage-calc/` folder (1.4.9 damage formulas).

### 3.6 Stat coding conventions

| Stat                | Internal storage   | Display                  | Notes                              |
|---------------------|--------------------|--------------------------|------------------------------------|
| ATK / DEF / HP      | flat integer       | integer                  | `*Pct` variants for the %          |
| SPD                 | integer            | integer                  | no percent variant                 |
| CRC / CHD / DMGup / DMGRed / PEN | per-mille (×10) | percent display (÷10) | `ItemOptionValueRate` per-mille    |
| EFF / RES           | integer OR per-mille| **context-dependent**    | OAT_ADD flat on acc/armor, OAT_RATE % on EE/Talisman |
| CritDmgRed          | gear-only (not char baseline) | percent       | E_CRI_DMG_REDUCE                   |

For EE/Talisman: the in-game passives store as OAT_RATE → routed to `buffPct.*`
on the compose side to amplify via `BuffValueRate` (vs a flat prebake that only
matches if baseForRate ≈ 100).

---

## 4. Engine module map

```
apps/renderer/src/
├── lib/
│   ├── composeBuild.ts            ← computeFinalStats(+FromPrefix) + aggregate(Gear/Prefix)Buckets (+ GemOverride)
│   ├── overcap.ts                 ← overcapOf + overcapText (wasted CRC 102 / PEN 100 caps, Heroes, Presets and the Optimizer's crit tooltip)
│   ├── heroPriority/
│   │   └── weights.ts              ← hasPriority + effectivePriority + priorityOf (a hero's priority weights, one source: Optimizer, Presets, solver)
│   ├── heroes/
│   │   ├── heroName.ts             ← displayNameOf + heroSearchHaystack + heroMatches (the displayed name and search of every hero list, fused sheet included)
│   │   └── heroListOrder.ts        ← heroListOrder (the one sort of hero lists: rank, CP, capture order)
│   ├── presets/
│   │   ├── presetRows.ts           ← in-game presets: pieces, wearers, missing / shared pieces, class, filter / sort
│   │   ├── presetHolds.ts          ← presetHolds + presetBlockedUids (pieces of better-ranked / locked presets out of the pool)
│   │   ├── evaluate.ts             ← evaluatePresetFor + bestKnownFor + presetLoss + presetOvercap (a preset scored on one hero)
│   │   ├── eeGems.ts               ← bestEeGemsFor (EE gems per hero, pieces fixed)
│   │   ├── presetWorklist.ts       ← presetWorklistFor (the Worklist entry of one hero of the preset)
│   │   └── optimize.ts             ← presetOptimizePatch + presetOptimizeNote ("Optimize preset →": effects required, priority substats)
│   ├── storage/
│   │   ├── keys.ts                 ← `gs.*` key registry: store, backup, prune, label, owner, import merge rule
│   │   ├── transfer.ts             ← backup v2 (buildBackup / applyBackup, a v1 file still imports)
│   │   ├── importSignal.ts         ← onBackupImported (screens and usePersistedState reload after an import)
│   │   ├── savedBuilds.ts          ← localStorage per-hero saved builds
│   │   ├── presetHeroes.ts         ← localStorage reference + associated heroes per preset
│   │   ├── localPresets.ts         ← localStorage local presets (kept in GS, never sent to the game)
│   │   ├── rankPriority.ts         ← shared rank model (heroes, presets): rankOrder, isLowerPriority, reorderRank, …
│   │   ├── presetPriority.ts       ← localStorage rank + lock per preset
│   │   ├── rankDefaults.ts         ← rankDefaults + heroRankOrder + presetRankOrder (default ranks set by App on import, `hooks/useRankDefaults.ts`)
│   │   ├── heroFilters.ts          ← localStorage filters kept per hero (owned by App, written by the Optimizer at every change)
│   │   └── filterPresets.ts        ← localStorage per-hero filter snapshots
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool of Web Workers, fan-out/in, merge top-N
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + simulateReforges + TopKHeap
│       ├── setPlans.ts             ← setsFeasible + armorSetWhitelist + allSetsComplete (set OR-of-AND model)
│       ├── builderFilters.ts       ← SolverFilters + Optimizer reducer + INITIAL_FILTERS + filterDefaults (hero defaults of Settings › Solver) + buildSolveFilters
│       ├── reforge.ts              ← REFORGE_MODES (toolbar + Settings › Solver) + ReforgeContext + legacyReforgeMode / migrateReforge (the one `useReforged` migration)
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + allocateGems + allocateGemsByCp + gemSlotsOf
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + ROLL_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower + makeCpEvaluator
├── workers/
│   └── solver.worker.ts            ← IPC adapter, MessageChannel yield
├── design/
│   ├── GearCard.tsx                ← the one piece card: `GearCardBody` (Gear, Heroes / Presets tooltips, Optimizer; `effects`, `projection`, `compact`), `GearCardPanel`, `ResultPairDetail`
│   ├── gearCardText.ts             ← the card's pure helpers: `statLong`, `pickSetLevel`, `QUALITY_TONE`, `QUALITY_HELP`, compact labels, `singularityGrade` / `singularityShortLabel`
│   └── HeroPicker.tsx              ← the one hero picker, `single` / `multi` (Optimizer, Don't take from…, Presets Reference / Associated)
└── screens/
    ├── FirstCapture.tsx            ← first-capture steps (Heroes and Gear without an inventory)
    ├── gear/                       ← GearScreen.tsx (Overview / Pieces / Scrap sub-tabs) + OverviewView.tsx (ex-Home) + overview/ (cards, icons, primitives)
    ├── inventory/                  ← InventoryScreen.tsx (Gear › Pieces and › Scrap, `mode`) + filters.ts, FilterModal, VirtualGearGrid, ItemDetail…
    ├── BuildsScreen.tsx            ← per-hero current build cards (uses calcBattlePower)
    ├── presets/PresetsScreen.tsx   ← Presets tab: game order, class filter / sort by class or priority, rank + lock per preset, in-game grid, a preset scored on its reference and associated heroes, EE gems, overcap, + Worklist, Optimize → / Optimize preset →
    └── builder/                    ← BuilderScreen.tsx (useReducer(SolverFilters) + layout) + useSolverSession.ts
                                      (orchestrator wiring) + one module per panel, ResultsTable, RightSidebar (Library)…

packages/core/src/
├── types.ts                       ← GearPiece, Character, Inventory, StatType, RolledStat
├── raw.ts                         ← RawUserItem / RawUserCharacter / RawPreset (capture JSON shapes)
├── gamedata.ts                    ← GameData + all the *Table types
├── stats.ts                       ← resolveStat (OptionID → ResolvedStat)
├── parse.ts                       ← parseInventory (raw → Inventory)
├── compose-stats.ts               ← composeCharStats (no-gear stats per hero)
├── rules.ts                       ← gameRulesOf / DEFAULT_RULES (gem slots, reforges, evolutions read from the contract)
└── index.ts                       ← public re-exports
```
