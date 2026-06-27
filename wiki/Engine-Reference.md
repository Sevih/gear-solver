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

### 1.1 Capture (`tools/capture/`)

mitmproxy + PowerShell pipeline. Captures Outerplane server responses:
- Endpoints: `glb-game.outerplane.vagames.co.kr:38001` (account/inventory) +
  `glb-login…:38002`. Non-standard ports via Unity BestHTTP/2 → bypasses the
  system proxy, so an iptables redirect is required.
- Encoding: `{"msg":"<hex>"}` → hex → **repeated-key XOR
  `ASLDKGFJASPODIFJSOWEI`** → UTF-8 JSON. No certificate pinning.
- Output: `tools/capture/out/{user_item,user_character,…}.json`.

Files: [capture.ps1](../tools/capture/capture.ps1),
[disarm.ps1](../tools/capture/disarm.ps1),
[addon.py](../tools/capture/addon.py).

See also: [Capture Pipeline](Capture-Pipeline).

### 1.2 Derived tables (`data/build.mjs` → `data/derived/`)

The game copies its raw tables into `data/game/*.json` (29 files).
`data/build.mjs` distills them into compact, consumable tables. The Source
column lists the `data/game/` table actually loaded by `build.mjs` (several
targets derive from the same table — `ItemSpecialOptionTemplet` in particular):

| Source `data/game/`                  | Target `data/derived/`     | Content                                                |
|--------------------------------------|---------------------------|--------------------------------------------------------|
| `ItemTemplet.json`                   | `equipment.json`          | ItemID → slot/grade/star/setId/armorSetId/name/image/effectIcon/class |
| `ItemOptionTemplet.json`             | `options.json`            | OptionID → StatOption (`{st, ap, v}`) OR IOT_BUFF reference |
| `BuffTemplet.json`                   | `buffs.json`              | BuffID → array of StatOption (per enhanceLevel)        |
| `ItemSpecialOptionTemplet.json` + curated (outerpedia) | `sets.json` | setId → levels[] → {p2, p4, p2_desc, p4_desc, name}  |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `equipment-passives.json` | ItemID → {name, textByTier[1..4]}            |
| `ItemTemplet.json` + `ItemSpecialOptionTemplet.json` | `multi-tier-passives.json`| ItemID → list of tier passives               |
| `ItemOptionTemplet.json` (IDs 15001..15054) | `gems.json`        | OptionID → {type, level, st, ap, v}                    |
| `ItemSpecialOptionTemplet.json` (groups 30000/31000) | `singularity-options.json`| OptionID → {st, ap, v, name, desc, combatOnly} |
| `ItemSpecialOptionTemplet.json` (EE groups) | `ee-passives.json` | ItemID → list of {st, ap, v, levelThreshold}           |
| `CharacterTemplet.json` etc.         | `characters.json`         | charId → {ingredients, cls, element, star, …}          |
| `ItemEnchantTemplet.json` + `SingularityEquipEnchantTemplet.json` | `enhance.json` | enhanceFactor, tierFactor, expCurves, singularity (standalone file) |
| `ExpCharacterTemplet.json`           | `exp-character.json`      | array idx 1..120 → cumulative XP                       |
| `CharacterMaxLevelTemplet.json`      | `char-level-max.json`     | `${star}|${step}` → {maxLevel, statModifierAfter100}   |
| `ArchiveBonusTemplet.json`           | `archive-bonus.json`      | `CompleteCount` → codex level (1..11)                  |
| `CharacterArchiveStatTemplet.json` (via `computeCharacterIngredients`) | `codex-curve.json` | codex level idx 0..11 → {atkPct, defPct, hpPct} |
| `ExpCharacterTemplet.json` (col TrustExp) + `TrustBuffTemplet.json` | `trust-character.json`, `trust-buffs.json` | trust system data |

Regenerate after a game patch: `npm run data:build` (or `data/sync.ps1`
if you also need to re-copy from Outerpedia).

`build.mjs` also writes `data/derived/version.json` `{ hash, builtAt }`: `hash` is a `sha256`
over the content of **every** derived file (name + body, fixed emit order), so it stays
**stable as long as the data is unchanged** (a no-op rebuild keeps it identical). Read by
`loadDataVersion()` (`apps/renderer/src/data.ts`) and shown read-only in Settings → Data — the
hook for a future localStorage cache invalidation after a patch (compare the `hash`, prune saved
builds referencing vanished `pieceUids`).

File: [data/build.mjs](../data/build.mjs).

### 1.3 Parse (`packages/core/src/parse.ts`)

`parseInventory(rawUserItem, rawUserChar, game)` consumes the captured JSON
and produces a typed `Inventory`. Each `GearPiece`:
- Identity: `uid, itemId, slot, setId, armorSetId, rarity, star, name, classLimit`.
- State: `breakthrough, reforgeCount, enhanceLevel, singularityLevel, ascended, locked, equippedBy`.
- Resolved stats: `main: RolledStat[]` (option + singularity + eePassive)
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
7. **Skill passives** user-leveled (S1/S2/S3) + Core Fusion (Skill_23).
8. **Limit Break** modifier (CharacterMaxLevelTemplet, amplifies the interp lv>100).

Output: `{noGearStats, intrinsicStats, scaling}` where `scaling` carries the
per-axis ingredients (ATK/DEF/HP/EFF/RES) to allow adding gear later via
`composeMultStat`.

### 1.5 Compose final stats (`apps/renderer/src/lib/composeBuild.ts`)

`computeFinalStats(baseline, scaling, pieces, game, gemOverride?)` adds the
gear on top of the no-gear baseline. Covers:

1. `aggregateGearBuckets(pieces, game, gemOverride?)` — aggregates mains/subs/sets
   into three buckets: `flat`, `pct`, `buffPct` (matching the in-game CalcFinalStat
   separation).
2. Per-axis compound via `composeMultStat(scaling, gearFlat, gearPct, gearBuffPct)`
   for ATK/DEF/HP/EFF/RES.
3. Simple additive for SPD/CHC/CHD/PEN/DMG±/CritDmgRed.
4. **Gem override** (solver only): skip the subs of Talisman/EE and add the
   pre-aggregated `{flat, pct}` deltas in their place. See §2.4.

File: [composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts).

### 1.6 Solver (`apps/renderer/src/lib/solver/`)

Pipeline detailed in [Solver](Solver). Summary:

- **Orchestrator** (main thread) — pool of Web Workers, partition, fan-out/in.
- **Worker** — engine instance, computes one chunk.
- **Engine** — `prepareContext + solveChunk + finalizeBuilds`. Phases 1-6:
  precompute → pools → top-% → cartesian + set-prune → compose + ratings + heap → CP.

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
(a dumb writer: validates `{ ItemList[] }` + `writeFileSync`s `out/user_item.json`, refuses with
409 while the capture pipeline is armed). Client: `apps/renderer/src/equip.ts`
(`equipPiece`/`unequipPiece`). A Builder/Builds trigger UI is the remaining step.

---

## 2. Calculations

### 2.1 CalcFinalStat (`composeMultStat` + `composeCharStats::calcStat`)

Reverse-engineered from `CFormula::CalcFinalStat` (libil2cpp.so 1.4.9, RVA
`0x2C59E48`). Validated 0-diff on 11/11 ATK/DEF/HP stats × 5 chars + EFF/RES
on G.Beth/Notia (core fusion +50% EFF baseline 120 → 255 in-game).

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
| awakValue    | sum_flat             | geas IOT_STAT flat adds                                 |
| awakPct      | sum_rate             | geas IOT_STAT % bonuses                                 |
| transcendPct | sum_rate             | TranscendByStar.{atkPct,defPct,hpPct} row matching star |
| gearPct      | sum_rate             | aggregated `pct.{atkPct,defPct,hpPct}` from gear        |
| gearFlat     | combined             | aggregated `flat.{atk,def,hp}` from gear                |
| buffValue    | combined             | OAT_ADD buffs (class passive +EFF, geas [141] +50 EFF, …) |
| buffPct      | part2 (outermost)    | classPassive + skill_8 + geas IOT_BUFF + skill passives + gear `buffPct.*` |
| codexPct    | codex term, baseValue| archive bonus                                           |

File: [compose-stats.ts](../packages/core/src/compose-stats.ts) +
[composeBuild.ts](../apps/renderer/src/lib/composeBuild.ts) (gear-side).

### 2.2 CalcBattlePower (CP)

Reverse-engineered from `CalcBattlePower` (libil2cpp.so 1.4.9), validated 0-diff
on 5 chars (LB0/1/2/3). Implementation: [cp.ts](../apps/renderer/src/lib/solver/cp.ts).

**SOLVE CP hot path**: `makeCpEvaluator(consts)` pre-captures the per-solve constant
additive bonuses (`starBonus`, `skillSum`, `eeBp`, `fusionBp` — all exact integers) and
returns a closure `(stats, talisman) → cp`. Avoids the per-combo `CpArgs` object allocation
and the constant re-derivation. **Bit-identical** to `calcBattlePower`: the hoisted
constants are integers (lossless summation) and the final sum order is preserved. Dedicated
identity test.

**Critical conventions**:
- **CRC capped at 100%** BEFORE entering the formula.
- CRC/CHD/PEN/DMGup/DMGRed/ECDR: RAW values (× 10 of the displayed %).
  The code receives the display value and multiplies by 10 internally.
- EFF/RES: integer display direct.

**Formula**:
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
solver side). Source: outerpedia damage-calc note `binary-formulas-1.4.9.md`.

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
| `dmg`  | `ATK × drFactor × penMult`             | Expected damage per hit vs DEF=2000     |
| `dmgs` | `dmg × SPD`                            | DPS                                     |
| `mcd`  | `ATK × mcdFactor × penMult`            | Max crit (assume 100% CHC, raid-buffs)  |
| `mcds` | `mcd × SPD`                            | Max DPS                                 |
| `dmgh` | `HP × drFactor × penMult`              | Damage HP-scaling (Aer S3, Caren, …)    |

Conventions:
- `CRC` and `CHD` are in **DISPLAY percent** (35 = 35%); the /100 divisor makes
  them decimal for the products.
- **CRC capped at 100%** in-game — overflow wasted. The raw value stays in
  `FinalStats.crc` for the UI display.
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
affected**: `calcBattlePower` stays a faithful in-game mirror (which uses raw crc), so
SOLVE CP still maximizes the game's real CP number.

**Not included** in the ratings (defender-dependent, out of build-trait scope):
Element (×0.8/×1.0/×1.2), Mark (×1.15), EnemyCriticalDamageReduce, MISS
multiplier, `FinalDamageReduce` buff chain. PEN is the exception: modeled
against a constant `TARGET_DEF` to allow PEN-vs-other-stats ranking.

### 2.4 Score (`ratings.ts::computeScore`)

```
Score = round(Σ over priority[key] × (effective(finalStats[key]) / STAT_NORMS[key]) × 100)
  where effective(v) = key === "crc" ? min(v, 100) : v
```

- `priority`: keyed by user keys (`atk`, `crc`, `chd`, …), values `-1..3`.
- `STAT_NORMS`: endgame reference values (atk=4000, hp=30000, crc=100, …).
- Normalization makes stats of different magnitude (HP in thousands vs CHC in
  percents) comparable.
- ×100 scaling to make the Scores readable (~50-500 typical).
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
with `STAT_NORMS.crc=100`. Real bug caught by the tests.

Engine-key → user-key mapping (`STAT_TO_PRIORITY`): `atkPct → atk`,
`critRate → crc`, `effRes → res`, etc.

### 2.6 Set bonuses (`composeBuild.ts::computeSetBonuses`)

For each armorSetId present ≥ 2× among the pieces:
- Counts total pieces + those with `breakthrough >= 4`.
- If all pieces of the set are BT4 → tier 4 row (`level === 2`),
  otherwise tier 1.
- The 2pc applies as soon as count ≥ 2; the 4pc as soon as count ≥ 4.
- Skip if `p2.st === "ST_NONE"` (narrative effect only, e.g. Counterattack
  which stores its effect in `desc` rather than in a stat).

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
gear equipped on another hero is only counted if `includeEquippedOnOthers` is
on; gear on an excluded hero is never counted. Without this gating, the solver
could propose gems that physically require unequipping the Talisman/EE of a
hero the user just excluded.

**Scoring**: `score = priority[user_key] × (value / ROLL_NORMS[engine_key])`.
Sorted desc.

**Greedy allocation**: top-K for `K = talismanSlots + eeSlots` (4 or 5 depending
on `enhanceLevel ≥ 5`). Stops at `score ≤ 0`.

**Pre-aggregation**: `aggregateGemDelta(scored, ts, ee)` returns a `{flat, pct}`
directly consumable by `aggregateGearBuckets`. Avoids N×10 `resolveStat` calls
in the hot loop.

**Fallback by mode**:
- **SOLVE** + empty priority → all scores collapse to 0 →
  `aggregateGemDelta` returns `null` → `computeFinalStats` without override →
  fallback on the pieces' `subs` (= currently socketed gems).
  Preserves the in-game-equivalent stat when the player has expressed no intent.
- **SOLVE CP** + empty priority → `scoreGemPool` receives `allowZeroPriority: true`
  → switches to `score = value / ROLL_NORMS[engine_key]` (raw per-roll
  magnitude). The greedy then picks the best gems regardless of stats.
  Necessary because "max CP" implies "use the best gems available" —
  preserving the current gems would silently disable gem optimization for the
  typical CP-mode use case.
- **Any mode** + non-empty priority → `priority × value / norm`
  for both modes (the user priority dominates, the CP flag is ignored).

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
   ROLL_NORMS` over the non-combat-only rolls.
2. **CP, no priority** → CP proxy (`cpEval` of the piece in the current build) +
   **pin** the equipped piece (the solve can never return a CP below the equipped one).
3. **Score, no priority** → `magnitudeScoreOf` (raw roll magnitude): no objective,
   but the product still has to be bounded.

**Required-set protection** + **pin**: `keepTopN` always re-adds pieces belonging to
a `req-2pc`/`req-4pc` set (and pinned UIDs), even outside the budget. Without it, a
low-score member of a required set would be eliminated → `checkSetsFeasible` would
silently kill every combo ("no builds" without a clue). The effective pool can thus
slightly exceed the budget share — intentional.

### 2.9 Reforge simulation (`engine.ts::simulateReforges`)

Reforge budget per piece:
- 1★→6★ non ascended: `star` reforges (1..6).
- **6★ ascended (Singularity)**: `star + 3 = 9` reforges. The +3 is
  exclusive to 6★ Singularity; the other ranks have no ascension.

For each piece with `remaining = maxReforges - reforgeCount > 0`, distributes
the remaining reforges greedy by `priority × per-tick value`. Cap at **LV6 ticks
per sub** (observed in real data). Tie-break on per-tick raw.

Mutations contained on a clone — the original inventory is never modified.

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

### 2.11 Combat Power + Upg filters (applied in-loop when set)

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

All source tables live in `data/game/` (local copy, no runtime fetch on the
renderer side). Refreshed **at launch** by `data-sync.ts` (`apps/desktop/src`)
in two modes:
- **checkout** (dev / maintainer machine) — copy from a local outerpedia
  checkout, guarded by mtime, zero network;
- **repo** (packaged build) — downloads the 29 tables + build inputs from the
  public repo `Sevih/outerpediaV2` via the jsDelivr CDN, gated on the SHA of
  the latest commit (`api.github.com/.../commits/main`), then re-runs
  `build.mjs`. Allows following patches **without publishing a new build**.
  Degrades gracefully offline (uses the already-cached `data/derived`).

`build.mjs` reads its dirs via env (`OUTERPEDIA_GAME_DIR` / `OUTERPEDIA_SYNC_DIR`
/ `OUTERPEDIA_DERIVED_DIR`) — defaults = `data/game` + `data/derived` + checkout.

`sub-ticks.json` (derived): per-tick values of the ATK/DEF/HP flat+% subs per
star (5★/6★), extracted from `subStatPools` (outerpedia
`data/equipment/item-stats-detail.json` — the **subs**, not to be confused with
the mains of `statRanges.json`). Feeds the Builder "Sub tick value" box
(flat vs % profitability, `lib/subValue.ts`). The 2nd box "Damage / +1%"
(`lib/dmgValue.ts`) compares the damage gain of +1% of the scaling/CHD/DMG inc
stats via `computeCheapRatings` (binary RE damage model 1.4.9).

**Critical tables for the math**:
- `CharacterTemplet.json` — base stats, skill blocks, class passive
- `CharacterEvolutionStatTemplet.json` — evolution rows
- `TranscendStatTemplet.json` — transcend % bonuses
- `CharacterMaxLevelTemplet.json` — LB modifiers
- `ArchiveBonusTemplet.json` — codex bonuses
- `GiftTemplet.json` + nodes — geas
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

The `gs.debug.statLocks` toggle in Settings shows the locks vs computed on the
Builds tab, with a "drift" badge when a stat diverges.

### 3.3 Automated tests

| File | Coverage |
|---------|------------|
| `packages/core/test/parse.test.ts` | 11 tests — parser substats/main/talisman/EFF flat, scaling enchant, singularity |
| `packages/core/test/equip.test.ts` | 11 tests — `equipItem`/`unequipItem`: set on empty slot, **displace** the occupied slot (same char), no-op (already equipped / unknown item / non-gear), `charUid "0"` = unequip, displacement scope (other char/other slot untouched), input **immutability** |
| `apps/renderer/test/solver.test.ts`     | 75 tests — gem pool/score/alloc/delta (+ eligibility filter), gem override equivalence, **set-bonus hoist equivalence**, cheap ratings (+ CRC clamp, **damage-stat scaling atk/def/hp + secondary additive**, **noCrit heroes**), score normalization (+ CRC clamp), reforge sim (+ 6★ ascended budget, Talisman/EE rejection), top-K heap, STAT_TO_PRIORITY mapping, CP clamps (skills.first, ECDR), **`makeCpEvaluator` bit-identity**, **incremental bucket accumulator equivalence** |
| `apps/renderer/test/gemsCapped.test.ts` | 16 tests — `allocateGemsCapped`: parity without crit gem, accept up to CHC 100 (overshoot ≤102), stop exactly at 100, total skip at cap, talisman/EE split, null delta if nothing useful, score ≤0 never taken |
| `apps/renderer/test/workerCount.test.ts` | 7 tests — `resolveWorkerCount`: default `hardwareConcurrency-1`, override `gs.solver.workerCount`, clamp ≥1, hard ceiling 64 |
| `apps/renderer/test/transfer.test.ts`   | 8 tests — backup round-trip (snapshot fidelity, empty maps), import merge (dedup by `id`, collision keeps the existing), replace (overwrite), bundle validation (kind/version/maps) |
| `apps/renderer/test/solveChunk.test.ts` | 3 tests — end-to-end `solveChunk` (hand-built `SolveContext`): **mid-tree set prune** (req-4pc → 1 scored combo vs 16 brute-force; infeasible → 0), **solver↔Builds 0-diff** |
| `apps/renderer/test/setPlans.test.ts`   | 26 tests — chip expansion (`setPicksToPlans`), `planSetIds`, `planSlots`, `planFeasible` (multi-cond sum), `setsFeasible` OR + leaf-validation at `remaining 0`, mono-plan req-4pc parity, **`armorSetWhitelist`** (full vs partial prune × broken on/off), **`allSetsComplete`** |
| `apps/renderer/test/translateReco.test.ts` | 10 tests — reco→patch: mains (OR-union), effects (icons required, null skip+warn), sets (combo→plan 1:1, unresolved combo dropped entirely), substat priority (tiers→weights, bucket collision, unknown key) |
| `apps/renderer/test/subValue.test.ts` | 5 tests — `flatVsPctTick`: verdict on both sides of the crossover, exact flat-equivalent, equality exactly at the crossover, %=0 tick guard |
| `apps/renderer/test/dmgValue.test.ts` | 4 tests — `dmgTickGains`: descending sort, delta→gain monotonicity, CHC null if crit-cap, base 0 → empty |
| `apps/renderer/test/buildAdvice.test.ts` | 16 tests — `computeAdvice` (Builds): no-gear silent, missing on a near-complete hero (≤2) vs silent WIP (early-return), sets (singleton / 3-of-4), wasted caps — crit tolerated ≤102 / PEN >100 (rounded threshold >0), empty gem slots Talisman/EE + reach-+5 tip, aggregated upgrade (unused reforges / 6★ not ascended / below enhance cap), singular/plural wording |
| `apps/renderer/test/cpPrune.test.ts` | 20 tests — combo-budget & scorers: `keepTopN`/`keepTopPct` (top-N, required-set preservation, equipped-piece pin), `priorityScoreOf`/`magnitudeScoreOf` (weighting, combat-only exclusion), `allocateComboBudget` (product bound, small slots kept whole, input order), CP proxy ranking high-CP gear, `cpStatWeights` (offensive ≫ dmg-reduce, weight ≥ 0) |
| `apps/renderer/test/heroPriority.test.ts` | 21 tests — per-hero priority store: `rankOrder` / `isLowerPriority` (unranked < ranked, uniqueness, strict), `reorderRank` / `moveRankBefore` (contiguous 1..N positional insert, drag, clamp, immutability), `fillUnrankedByOrder` (keeps manual ranks, fills unranked by CP, compacts gaps, ignores stale uids) |
| `apps/renderer/test/dominance.test.ts` | 10 tests — `pruneDominatedForCp`: strict drop, ties/Pareto/groups kept, reforge projection, end-to-end top-CP equivalence via `solveChunk` |

Run: `npm test --workspaces --if-present`. **Total: 243 tests** (core 22: parse 11 + equip 11 · renderer 221: solver 75, solveChunk 3, gemsCapped 16, setPlans 26, transfer 8, translateReco 10, workerCount 7, subValue 5, dmgValue 4, buildAdvice 16, cpPrune 20, heroPriority 21, dominance 10).

### 3.4 Reverse engineering — libil2cpp.so

Key formulas come from the libil2cpp.so dump (1.4.9 build, decompiled via
Ghidra/IDA). Known addresses:
- `CFormula::CalcFinalStat` — RVA `0x2C59E48`
- `CFormula::CalcBattlePower` — RVA `0x2C59EE4` (approximate, see Claude memory
  note `game_combat_power_formula`)

### 3.5 External sources

- **outerpedia-v2** (public repo `Sevih/outerpediaV2`) — source of the images
  AND the game tables. The shared `/img/*` handler (`img-cache.ts`, used by both
  the Vite middleware **and** the prod Electron server) resolves in cascade:
  local checkout (dev, via `OUTERPEDIA_PATH`) → persistent **disk cache** →
  **GitHub CDN** (jsDelivr → raw.githubusercontent) + cache write → fallback
  `.png`→`.webp` → 302 to `outerpedia.com` as a last resort.
  Each asset is therefore fetched only once. Cache: `.cache/outerpedia` in dev
  (gitignored), `<userData>/outerpedia-cache` in prod. The background prefetch
  (prod) warms the `ui/` + `equipment/` (webp) subset once per SHA.
  Repo coordinates + SHA + CDN centralized in `repo-source.ts`.
- **User memory (Claude)** — detailed formulas + validation history. Not in the
  repo, accessible via the Claude notes:
  - `game_stat_compose_formula` — detailed CalcFinalStat derivation
  - `game_combat_power_formula` — CP derivation
  - `game_ee_transcend_inherent` — EE/Transcend always active
  - `project_gear_solver_stat_locks` — locks workflow
  - `equipment_ascend_name_gradient` — Singularity ascended design
  - `equipment_icon_overlay_specs` — +N/T1-T4 overlays

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
│   ├── storage/
│   │   ├── savedBuilds.ts          ← localStorage per-hero saved builds
│   │   └── filterPresets.ts        ← localStorage per-hero filter snapshots
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← pool of Web Workers, fan-out/in, merge top-N
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + simulateReforges + TopKHeap
│       ├── setPlans.ts             ← setsFeasible + armorSetWhitelist + allSetsComplete (set OR-of-AND model)
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + aggregateGemDelta + allocateGems + gemSlotsOf
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + ROLL_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower + makeCpEvaluator
├── workers/
│   └── solver.worker.ts            ← IPC adapter, MessageChannel yield
└── screens/
    ├── InventoryScreen.tsx         ← gear table + detail
    ├── BuildsScreen.tsx            ← per-hero current build cards (uses calcBattlePower)
    └── BuilderScreen.tsx           ← reducer SolverFilters + all panels + orchestrator wiring + Library sidebar

packages/core/src/
├── types.ts                       ← GearPiece, Character, Inventory, StatType, RolledStat
├── raw.ts                         ← RawUserItem / RawUserCharacter / RawPreset (capture JSON shapes)
├── gamedata.ts                    ← GameData + all the *Table types
├── stats.ts                       ← resolveStat (OptionID → ResolvedStat)
├── parse.ts                       ← parseInventory (raw → Inventory)
├── compose-stats.ts               ← composeCharStats (no-gear stats per hero)
└── index.ts                       ← public re-exports
```
