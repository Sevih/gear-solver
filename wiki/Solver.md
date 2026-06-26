# Solver — internals & UI

*Mirror of `docs/solver.md` (translated to English) — see the repo for the authoritative source.*

This doc describes the **gear-solver** (Builder tab), its UI panels,
its internal pipeline, and the architectural choices behind it.

> General repo architecture: [Architecture](Architecture).
> All the formulas (compose, CP, ratings, score, gems, reforge, top-%,
> heap) + their validations: [Engine Reference](Engine-Reference).

---

## 1. Bird's-eye view

```
BuilderScreen.tsx (React, main thread)
  │
  ├─ useReducer(SolverFilters)   ← 19 actions, 10 panels + sidebar/footer controlled
  │
  ├─ SolverOrchestrator           ← Web Worker pool (hardwareConcurrency-1, override gs.solver.workerCount)
  │     │
  │     │  fan-out (postMessage)
  │     ▼
  │  ┌─────────────────────────────────────────────┐
  │  │ solver.worker.ts × W   (parallel, no IPC)   │
  │  │   └─ engine.ts                              │
  │  │       phases 1-2 : prepareContext           │
  │  │       phase 3   : top-% prune              │
  │  │       phase 4   : cartesian + set-prune    │
  │  │       phase 5   : compose + ratings + heap │
  │  │       phase 6   : finalize CP (top-N)      │
  │  └─────────────────────────────────────────────┘
  │     │  fan-in  (result + progress)
  │     ▼
  └─ results table + bottom gear band + footer (P/S/Results)
```

A single **orchestrator** lives for the entire lifetime of the screen. The **workers**
are created on the first solve and kept between runs (starting a Worker
costs ~30 ms + transferring the inventory + gameData, which is worth amortizing).

---

## 2. Modes: SOLVE vs SOLVE CP

| Button    | Goal                    | Sort key                          | Hot-path cost |
|-----------|-------------------------|-----------------------------------|---------------|
| **SOLVE**    | Maximizes a **Score** weighted by the user priorities (`Σ priority × final / norm`). Useful when you know which stat profile to target. | `score`             | `compose + cheap ratings` |
| **SOLVE CP** | Maximizes the in-game **Combat Power** (`CalcBattlePower` reverse-engineered). Single-objective. | `cp` (computed in the loop) | `compose + cheap ratings + cp` |

CP is expensive: by default it is computed **only for the top-N** in SOLVE
(lazily, in `finalizeBuilds`, just for display) and **for every combo**
in SOLVE CP (the sort key requires it).

Two optimizations cut the per-combo cost in SOLVE CP: (1) a **prepared CP
evaluator** (`makeCpEvaluator`) captures the constant bonuses (star/skill/EE/fusion)
once → no per-combo `CpArgs` allocation and no constant re-derivation, **bit-identical**
to `calcBattlePower`; (2) the **cheap ratings are deferred** to `finalizeBuilds` (top-N
only) when no rating filter is set — symmetric to SOLVE's lazy CP, since the heap is
sorted by CP, not by the ratings.

The user CP filter (`cp min/max`) is applied **in the loop** as soon as it
is active — including in SOLVE mode, where CP is then computed per combo. This is required
for correctness: deferring the filter to `finalizeBuilds` let the heap fill up
with the top-K **by score** and then removed out-of-CP builds after the fact, evicting
valid builds ranked just outside the top-K (recall loss / under-return). Same for the
`upg` filter (resolved upfront from the equipped loadout, applied in-loop). The re-checks
at finalize become idempotent no-ops.

---

## 3. Detailed pipeline (1 worker, on its chunk)

### Phase 1 — Hero precompute
- `composeCharStats(hero)` → `baseline` (no-gear stats) + `scaling` (per-axis CalcFinalStat ingredients for ATK/DEF/HP/EFF/RES). Reused for every combo.
- Retrieves the EE equipped on the hero (fixed — the solver does not enumerate it).
- The character's skills (first/second/ultimate/chainPassive) for CP.

### Phase 2 — Pools per slot
For each slot ∈ {weapon, helmet, armor, gloves, boots, accessory, ooparts}:
filters the inventory pieces:
- `g.slot === slot`
- excluded if `includeEquippedOnOthers === false` and equipped on another hero
- excluded if `g.equippedBy ∈ excludedHeroes`
- excluded if `onlyMaxed && enhanceLevel < 15`
- excluded if `classLimit` ≠ the hero's class
- excluded if **main pick** is active for this slot and `g.main[0].stat ∉ picks`
- excluded if **effect chip** (weapon/accessory) marked `excluded`; or marked `required` and the icon does not match
- excluded if `armorSetId ∈ excludedSets`

**`keepCurrent`** toggle: if the piece currently equipped by the hero exists for this slot, the pool is restricted to `[currentPiece]` (the solver does not touch the slot). Such locked slots are **exempt** from the set-prune below.

**Armor pool set-prune** (`armorSetWhitelist`, pure): when the set requirements
**fully** constrain the armor (a plan `2pc A + 2pc B` or `4pc A` → `Σcount === 4`, no
free slot), the helmet/armor/gloves/boots pools are **pruned** to admissible sets only
**before** the cartesian — a huge reduction on set-constrained searches. A **single**
required set (`2pc A`, free slots) prunes nothing by default: you must keep filler to
complete the build. The **Allow broken sets** toggle (cf. § Options) flips this: when
*false*, the free slots must also form a complete set → the whitelist narrows to required
+ *formable* sets (present in ≥2 armor slots) and a leaf check rejects singleton builds (cf. phase 4).

### Phase 3 — Top-% prune (heuristic)
If the user has set at least one non-zero priority AND `topPct < 100`:
score each piece of the pool by
```
score(piece) = Σ_rolls priority[user_key] × (value / STAT_NORMS[user_key])
```
sort desc, keep the `⌈N × pct / 100⌉` best. **Normalization is crucial**:
without it, high-magnitude pieces (HP +200) always crush crit pieces
(CHC +5) at equal priority.

The engine→user mapping (`STAT_TO_PRIORITY` in `ratings.ts`) guarantees that
`atkPct` rolls and `atk` flats share the same priority bucket `atk`.

### Phase 4 — Cartesian + set-prune
Nested-loop enumeration: `weapon × helmet × armor × gloves × boots × accessory × ooparts`.
- **Partition**: one slot (the largest) is sliced into `chunkCount` parts; each
  worker receives its slice → embarrassingly parallel, no inter-worker communication.
- **Set tracking**: at each armor slot, `incSet(armorSetId)` at the start of the piece, `decSet` after the inner loop.
- **Mid-tree pruning**: at each depth `D` (D armor slots iterated, `4-D` remaining), for each required set (2pc or 4pc) we verify that enough slots remain to reach the threshold. Otherwise, `continue` to the next sibling.
- **Leaf no-broken-set**: when **Allow broken sets** is *off*, at boots depth (`remaining === 0`) we also reject any build whose `setCount` tally isn't "complete" (`allSetsComplete`: every present set ≥2 AND all 4 armor pieces set-tracked → a 4pc or two 2pc). Leaf-only: a mid-tree singleton may still pair up deeper.

### Phase 5 — Per-combo: compose + ratings + filters + heap
For each combo that passes phase 4:

1. **Compose**: `computeFinalStats(baseline, scaling, pieces, game, gemDelta)`.
   - `pieces` is a hoisted array (mutated in place) to avoid 10M+ allocations.
   - `gemDelta` is pre-aggregated (cf. § Gems).
2. **Stat filter**: if a `FinalStats[key]` is outside the user `[min, max]`, `continue`.
3. **Cheap ratings**: 8 simple products (HpS, Ehp, EhpS, Dmg, DmgS, Mcd, McdS, DmgH).
   For a **`noCrit`** hero (`meta.noCrit`, propagated into the context), `computeCheapRatings`
   gets `noCrit=true` → `pCrit=0` (the CHD term drops out) and `mcd` falls back to the
   non-crit hit: CHC/CHD no longer inflate its ratings. In SOLVE CP with no rating filter,
   the 8 products are **deferred** to `finalizeBuilds` (top-N only) — the heap sorts by CP.
   CP itself stays a faithful in-game mirror (its formula uses raw crc).
4. **Score**: `Σ priority × (final / STAT_NORMS) × 100`.
5. **Rating filter**: same as the stat filter, on ratings + score.
6. **CP / upg**: CP is computed in SOLVE CP, OR in SOLVE as soon as a CP filter is set
   (the filter then rejects early). If an `upg` filter is set, it is also evaluated here
   (from the pre-resolved equipped loadout). Both filter **before** the push, so the
   heap contains only valid builds.
7. **Push** into a fixed-size min-heap (`TopKHeap`, K=1000 by default) keyed by `score` or `cp` depending on the mode.

### Phase 6 — Finalize (worker side)
- SOLVE CP: the top-K is already sorted on CP, returned as-is.
- SOLVE: CP is computed for each build of the top-K **for display** (lazy) when no
  CP filter was active; otherwise CP is already carried by the build. `upg` is (re)computed for
  the column. Since the CP/upg filters were already applied in-loop, the re-checks here are
  idempotent no-ops.

### Orchestrator side
- Receives `{builds, permutations, searched}` from each worker.
- Merges the top-Ks into a global buffer, final sort, slices the top-N (1000 by default), forwards to React.
- Aggregates `permutations` + `searched` for the footer (sum of the per-worker counters).

---

## 4. The UI panels

The top panels (Hero, Stats, Sub tick value / Damage info, Options, filters,
priority, mains, sets, effects) + the Actions/Library sidebar + the pinned footer. Each filter panel
pushes its state into the `SolverFilters` reducer (`apps/renderer/src/screens/BuilderScreen.tsx`).

### Hero
Picker (searchable combobox) + portrait + 4 action buttons.
- **SOLVE**: launches score mode (disabled if there is no hero or a solve is in progress).
- **SOLVE CP**: launches CP mode.
- **Cancel**: interrupts the solve (workers return their partial heap, the orchestrator merges what we have).
- **Reset filters**: `dispatch({type: "resetAll"})` — clears the entire reducer.

### Stats
Snapshot of the `FinalStats` of the build currently equipped on the hero (left column)
vs the build selected in the table (right column, em-dash as long as no row
is clicked). Read-only, never editable.

### Sub tick value & Damage / +1% (per-hero help boxes)
Two read-only info panels (right column, under Stats), recomputed on
hero / level / awakening change:
- **Sub tick value** (`lib/subValue.ts`) — for ATK/DEF/HP, the value of one tick of
  a 6★ sub in **flat** vs in **%** (≈ flat equivalent), winner in cyan. A % tick scales
  on `base+evo+awak` (gear-independent — flat gear is added after the ×%, the
  `(1+buffRate)` cancels out) → the verdict depends only on the hero's base. Per-tick values
  from `sub-ticks.json` (derived from outerpedia `subStatPools`).
- **Damage / +1%** (`lib/dmgValue.ts`) — expected damage gain for **+1%** of each
  relevant stat: the hero's scaling stat(s) (ATK/DEF/HP/**SPD** via `dmgStat` +
  secondaries `dmgSec`, SPD/EFF/CHC included) vs **CHD** vs **DMG inc**, ranked, best in
  cyan. **Computed at 100% crit** (crit cap = endgame baseline). Reuses `computeCheapRatings`
  (RE 1.4.9 damage model). **No-crit** heroes (`noCrit`, e.g. 2000086/2000091/2000008)
  force `crc=0` and hide CHD.

### Options
The **Reforge** segmented control (toolbar) + toggles + the Exclude multi-select:
- **Reforge** (`reforgeMode`, 3 states, **wired**) — projects each piece of the pool
  to an endgame ceiling **before** the top-% prune (`projectPieceForReforge`):
  - **Off**: gear as captured.
  - **Classic**: projects to **+10 non-ascended** (main re-scaled via the `scaleMain` mult
    on the core side `projectMainToCeiling`, + substats max-rolled at **6 ticks**).
  - **Ascended**: projects to **+15 ascended** (overrides the real flag → we assume everything
    ascended; **9 ticks**). Never *downgrades* a piece already above the ceiling.

  The main re-scale goes through the ratio of the multipliers (`RolledStat` does not keep
  the base value) — validated against in-game (test `projectMainToCeiling`: 240 → 1380).
- **Only maxed gear** — filters the pool to `enhanceLevel === 15`.
- **Equipped items** — includes pieces equipped on other heroes.
- **Keep current** — locks the already-equipped slots to their current piece.
- **Allow broken sets** (`allowBrokenSets`, default **true**) — *true*: a partial set
  requirement (e.g. a single `2pc`) lets any gear fill the free armor slots (legacy
  behavior). *false*: every armor piece must complete a 2pc/4pc → the solver also prunes
  set-less / non-formable pieces from the pool and rejects singleton builds at the leaf.
- **Exclude equipped** — **wired**: `ExcludeHeroesPicker` (multi-select) writes into
  `excludedHeroes` via `toggleHeroExcluded` / `clearExcludedHeroes`.

### Stat filters
Min/max per final stat (12 stats). Applied after compose, combo rejected if a stat goes outside the band. Empty inputs = no bound.

### Rating filters
Min/max on the derived ratings + Score. `cp` and `upg` are treated specially
(applied in-loop when set, cf. § 2 / phase 5) — not via the compiled `FilterSpec[]`
because they depend on the equipped loadout / a costly computation not available at compile time.

### Substat priority
- Per-stat slider (12 stats): integer value `-1..3`. Stored in `priority` (user keys: `atk`, `crc`, `chd`, ...).
- **Top %** slider: `5..100`. Drives the phase 3 prune.
- **(clear)** button: `dispatch({type: "clearPriority"})`.

When priority is uniformly 0: the pool is not pruned and the **gems
are not reallocated** (fallback on the gems currently socketed — cf. § Gems).

### Main stats
Three rows (Weapon / Accessory / Talisman). Each row shows the mains
actually present in the inventory for that slot (icon chips). Click to
OR-allow. The pool is excluded if none of the piece's mains match.

The other slots (helmet/armor/gloves/boots) do not appear: their main is
fixed in-game.

### Sets
Armor-set icon chips, gated by feasibility (`canForm2pc / canForm4pc`
computed from the inventory). Click cycles:
```
off → req-2pc → req-4pc → excluded → off
```
skipping impossible transitions. Totally unusable sets (no
reachable 2pc/4pc bonus) are not shown. 3-section tooltip: name + (N owned) / 2pc desc / 4pc desc / state.

### Weapons & accessories
Two groups of effect-icon chips (Weapons / Accessories), filtered by the hero's class (gated by `classLimit`). Click cycles `off → required → excluded → off`. Tooltip: name + (N owned) / T4 desc / state.

### RightSidebar — Library
Three **wired** sections (localStorage, per hero):
- **Save / Remove build** — bookmarks the selected build (`storage/savedBuilds.ts`).
  A saved build also carries its reforge context to re-project its substats on
  restore.
- **Filter presets** — saves / loads / deletes a filter snapshot
  (`storage/filterPresets.ts`, `loadPreset`).
- **Restore** — re-pushes a saved build into the table + bottom band.

Equip / Unequip **to the game** remain absent (they require a non-existent game API).
The **Optimize →** button lives on the Builds tab side (opens the Builder on the hero).

### FilterFooter (pinned at the bottom)
- Per-slot chips with **hit/total (%)** — fed by the `poolSizes` of the first progress event of each worker.
- **P**: total permutations explored (sum across workers).
- **S**: permutations that passed all filters (scoring).
- **Results**: size of the returned top-N.
- `solving…` indicator (cyan, animated) during a run.

### ResultsTable
Red-green heatmap per column (min/max relative to the current result set). Columns:
sets, 8 main stats, ratings (`TABLE_RATINGS`), **Score**, **Upg**, actions
(`Upg` = number of slots differing from the current loadout, sortable + filterable). Sort by clicking
the header (null → desc → asc → null). The **Columns** menu (show/hide columns, persisted
`gs.builder.cols`) opens from the toolbar button **or by right-clicking any column header**
(`ColumnsMenu` controlled, `onContextMenu` on the header `<tr>`). Click on a row → the `BottomGearBand`
shows the 8 pieces. `solving…` / error / **explicit empty state** (an `emptyReason`
derived from `poolSizes` lists the slots that fell to 0 pieces after filters).

### BottomGearBand
8 cards (compact mirror of the inventory) — one per slot. Each card shows name,
enhance level, slot icon, main stat, subs (with ticks). In addition:
- **Talisman / EE**: the gem allocation recommended by the build (stat + value,
  **swap** badge if it differs from the socketed gems).
- **Projected stats**: if the Reforge mode ≠ Off, the displayed main + subs are the projection
  (`projectPieceForReforge` re-simulated on the main thread side) + **classic** / **ascended** badge.
  The card also shows the projected enhance (`+15 · ascended`) since the projected piece
  carries its target `enhanceLevel`/`ascended`.

Em-dash when no build is selected.

---

## 5. Gems — greedy sub-solver

**Pool**: multiset of the non-null `gemSlots[]` of all Talismans + EE in the inventory (gems are swappable in-game, so we aggregate globally).

**Scoring**: for each gem, `score = priority × (value / STAT_NORMS)`. Normalized to allow cross-stat comparison. Sorted desc.

**Allocation (default, fast path)**: greedy, K = `talismanSlots + eeSlots` (4 or 5 depending on `enhanceLevel`). We take the K first gems with `score > 0`. Pre-computed **once per talismanSlots variant** (4 or 5) in `prepareContext` — no re-computation in the hot loop.

**Cap-reaching CHC (slow path, per combo)**: when the user prioritizes `crc` **and** the pool has crit gems (`wantCritCap`), the allocation is **staged** (`allocateGemsReachingCap`):
1. **Stage 1** — spend crit gems to **reach** the 100% CHC cap (as a priority, even if atk scores higher), overshoot ≤ one 3% gem.
2. **Stage 2** — fill the rest **by priority** (skipping any crit gem, now wasted).

The combo's pre-gem CHC is recovered from `fs.crc − defaultCrcGem` (crit rate is purely additive). We only **recompose** if the cap-aware delta differs from the default greedy (`gemDeltaEquals`) — often identical when crit gems already rank high. The case without a crc priority (e.g. SOLVE CP fallback) keeps the old anti-overshoot (`allocateGemsCapped`, triggered only if `fs.crc > 102`).

**Pre-aggregation**: the gem contribution is converted into `{flat: {atk: 5, ...}, pct: {atkPct: 24, ...}}`. The compose just adds these deltas to the buckets after the piece aggregation. Avoids `resolveStat` × 10 gems × N combos.

**`null` fallback**: if the priority is empty (no gem has a `score > 0`),
the delta is `null` → the solver does not pass a `gemOverride` → the compose
uses the **gems currently socketed on the Talisman + EE** (via `piece.subs`).
This is intentional: without user intent, we respect the player's state
rather than estimate 0 gems and under-value CP.

---

## 6. Top-% heuristic — why it's there

A typical inventory: 150 pieces per slot × 7 slots = `150^7 ≈ 10^15` permutations. Inaccessible.

The top-% prune brings this down to `(150 × pct/100)^7`:
- 100% → 10^15 (unusable)
- 50% → ~10^13
- 30% → ~10^11
- 10% → ~10^8 (usable, 1-5s)
- 5% → ~10^6 (very fast, but may skip the optimal build)

The panel hint says so explicitly: *"Heuristic — too low a Top % drops optimal builds"*. It's a pure recall vs speed trade-off.

With empty `priority`, the score is arbitrary — the prune is **disabled**
automatically (each piece scores 0, random ranking, so we keep everything).

---

## 7. Key optimizations (and why)

1. **Pure engine, no React** (`engine.ts`, `gems.ts`, `ratings.ts`, `cp.ts`) — importable from any worker or test, no DOM or Suspense to drag around.

2. **Worker pool = `hardwareConcurrency − 1`** (`resolveWorkerCount`, override
   `gs.solver.workerCount`, hard cap 64) — one core left to the UI, the rest to
   the search. The old fixed cap of 8 left many-core machines
   under-employed (8 workers / 32 threads = 25% CPU); the postMessage clone
   of inventory/game per worker is a *fixed* cost per solve, amortized over a solve
   of several seconds — so scaling with the machine is the right default. The
   `solver` debug log (`pool`) shows the resolved count + `hardwareConcurrency`.

3. **Embarrassingly parallel partition** — each worker takes a slice of the
   largest slot. No inter-worker communication, final merge O(W × K). The number
   of workers actually used is capped to the partitioned pool size
   (`chunkCount = clamp(1, W, maxPoolHit)`) — no point sending an empty slice to
   a worker when the pool has fewer items than workers.

4. **Hoisted `pieces` array + mutated in place** — avoids 10M+ allocations in
   the inner loop. Safe because `computeFinalStats` does not keep the reference.

4b. **Incremental bucket accumulator** — the 6 invariant pieces (weapon..accessory)
    are aggregated **once per accessory iteration** (`aggregatePrefixBuckets`); the
    talisman loop clones that prefix and only adds talisman + EE + gems + sets
    (`computeFinalStatsFromPrefix`). **Bit-identical** to the full re-sum (slot order
    preserved, prefix = a cloned running partial sum), validated by a dedicated
    equivalence test + the end-to-end 0-diff test.

5. **Pre-aggregated gem delta** — the gem contribution is computed only **once
   per talismanSlots variant** instead of N combos × 10 gems × resolveStat.
   Massive gain on the hot path.

6. **Mid-tree set pruning** — `req-4pc Sharp` with 1 Sharp helmet: we prune
   without descending into armor × gloves × boots. Huge on set-restricted
   searches.

7. **Lazy CP in SOLVE** — CP is ~20× more expensive than a cheap rating. Computed
   only for the final top-N (~1000 vs millions). In **SOLVE CP** (CP is the sort key,
   computed per combo), two mitigations: (a) a **prepared CP evaluator**
   (`makeCpEvaluator`) — constant bonuses captured once, no per-combo `CpArgs`
   allocation nor constant re-derivation (bit-identical); (b) **deferred cheap ratings**
   to finalize (top-N) when no rating filter is set — the heap sorts by CP, so the 8
   ratings products only feed the display.

8. **Responsive cancel via MessageChannel** — `solveChunk` is async, yields at each
   tick (~4096 combos) via a `MessageChannel.postMessage` round-trip (<1ms vs 4ms
   for `setTimeout(0)` throttled in workers). A mid-solve cancel propagates
   in ≤ tickEvery × t_combo ≈ 20-50ms.

9. **Compiled `FilterSpec[]`** — `Object.keys` + `for...in` replaced by a flat
   array iterated by index. Minor but accumulated over millions of combos.

10. **Hoisted set bonuses** — `computeSetBonuses` (Map rebuild + lookups) is computed
    1× per accessory combo and passed to `aggregateGearBuckets`, not recomputed per talisman.
    Bit-identical (invariant over the talisman loop since the talisman has no `armorSetId`).

11. **Top-K min-heap** — `O(N log K)` instead of `O(N log N)` if we sorted
    the whole set. K=1000 → log K ≈ 10.

12. **`init` send-once** — `game` + inventory (constant, heavy graphs) are
    sent to each worker **once** (`init` message, cached worker-side) instead
    of being re-cloned on each fan-out. Re-broadcast only when the ref changes (re-capture).
    The solve only sends the lightened payload (`SolveRequestMsg` = `SolveRequest`
    minus game/inventory) + the pool precompute. The worker re-merges the cached
    constants → full `SolveRequest`, so **the engine is unchanged**. Essential for
    worker-count scaling (§7.2): without it, N clones of `game` per solve would dominate.

---

## 8. Known limitations

(nothing blocking today — see the backlog.)
- **Equip / Unequip to the game**: absent — they require a non-existent game API
  (the capture pipeline is read-only for now).
- **Hot-path perf**: the per-talisman set bonus rebuild is hoisted (§7.10), the 6
  invariant pieces are no longer re-summed per talisman (incremental bit-identical
  bucket accumulator, §7.4b), and the results table is virtualized
  (`@tanstack/react-virtual`). What remains is structural: cutting the **number** of
  combos that reach compose/CP (pool pre-filter, CP upper-bound).
- **Worker init = W × game/inventory**: `game` + inventory are structured-cloned
  to each worker **only once** (`init` message, cached worker-side;
  re-broadcast only on a re-capture). Each solve only sends the lightened payload
  (filters + pool precompute), not the big constant graphs — which makes
  scaling to many workers viable (otherwise N clones of `game` per solve would dominate
  the fan-out). The initial W× copy remains: for huge inventories (>50 MB), the next
  step is SharedArrayBuffer (needs COOP/COEP + binary flatten of the data).

---

## 9. File map

```
apps/renderer/src/
├── workers/
│   └── solver.worker.ts          ← thin adapter IPC ↔ engine
├── lib/
│   ├── composeBuild.ts            ← computeFinalStats(+FromPrefix) + aggregate(Gear/Prefix)Buckets (+ GemOverride)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← per-hero build bookmarks (localStorage)
│   │   └── filterPresets.ts        ← per-hero filter snapshots (localStorage)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── orchestrator.ts         ← Web Worker pool, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap + simulateReforges
│       ├── setPlans.ts             ← setsFeasible + armorSetWhitelist + allSetsComplete (set OR-of-AND model)
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + aggregateGemDelta + allocateGems
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower + makeCpEvaluator (reverse-engineered)
└── screens/
    ├── BuilderScreen.tsx           ← SolverFilters reducer + all panels + orchestrator wiring
    └── BuildsScreen.tsx            ← equipped/composed roster + computeAdvice + Optimize →
```

Bonus:
- `data/stat-locks.json`: stat-regression snapshots to validate the compose
  formula (cf. `project-gear-solver-stat-locks` memory).

---

## 10. How to test end-to-end

1. Launch the app (`npm run dev`).
2. Builder tab → choose an equipped hero.
3. Click **SOLVE** with no filter/priority → the table should fill, P/S increment.
4. Click a row → the bottom band shows the 8 pieces.
5. Set `Crc min = 90` then re-SOLVE → all returned builds satisfy the bound.
6. Enable `Sharp 4pc required` → the builds' helmet/armor/gloves/boots are all Sharp.
7. **Regression comparison**: SOLVE with empty priority + Top 100% + Keep current → the top-1 must have the same `FinalStats` as the card of the same hero in the Builds tab (modulo gem reallocation, which in empty-priority mode falls back on the current gems, so ✓ strict equivalence is expected).
8. SOLVE CP → the top-1 must have the highest CP displayed. Compare against a separate brute-force solve on a small slice.
