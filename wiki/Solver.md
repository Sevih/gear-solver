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
  │     │  phases 1-3 : precomputeContext (main thread, 1×)
  │     │               hero precompute + pools + budget prune
  │     │  fan-out (postMessage, precompute broadcast via req.precomputed)
  │     ▼
  │  ┌─────────────────────────────────────────────┐
  │  │ solver.worker.ts × W   (parallel, no IPC)   │
  │  │   └─ engine.ts                              │
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
only) when no rating-band filter **other than Score** is set (a Score band does not
disable the deferral — Score derives from `FinalStats`, not the ratings) — symmetric
to SOLVE's lazy CP, since the heap is sorted by CP, not by the ratings.

The user CP filter (`cp min/max`) is applied **in the loop** as soon as it
is active — including in SOLVE mode, where CP is then computed per combo. This is required
for correctness: deferring the filter to `finalizeBuilds` let the heap fill up
with the top-K **by score** and then removed out-of-CP builds after the fact, evicting
valid builds ranked just outside the top-K (recall loss / under-return). Same for the
`upg` filter (resolved upfront from the equipped loadout, applied in-loop). The re-checks
at finalize become idempotent no-ops.

---

## 3. Detailed pipeline

Phases 1-3 (`precomputeContext`) run **once on the main thread** (orchestrator)
and the result is broadcast to the workers via `SolveRequest.precomputed` — a
worker only recomputes them (fallback, same code) when the precompute is absent.
Phases 4-6 run **inside each worker, on its chunk**.

### Phase 1 — Hero precompute
- `composeCharStats(hero)` → `baseline` (no-gear stats) + `scaling` (per-axis CalcFinalStat ingredients for ATK/DEF/HP/EFF/RES). Reused for every combo.
- Retrieves the EE equipped on the hero (fixed — the solver does not enumerate it).
- The character's skills (first/second/ultimate/chainPassive) for CP.

### Phase 2 — Pools per slot
For each slot ∈ {weapon, helmet, armor, gloves, boots, accessory, ooparts}:
filters the inventory pieces:
- `g.slot === slot`
- excluded per `equippedScope` (`none`/`lower`/`all`) if equipped on **another** hero — `lower` gated via `isLowerPriority(heroPriority, …)` (cf. § Options, Equipped items). The "owner" is the **worklist claim if any, else `equippedBy`**: a piece reserved by another hero's queued build (`worklistClaims`, uid → claiming hero, unapplied changes only) is treated as equipped on that hero — the scope + rank rules apply to reservations exactly like to real equipment
- excluded if `g.equippedBy ∈ excludedHeroes` (likewise via the effective owner)
- excluded if below the **"Maxed only" investment floor** (`meetsMaxedFloor`): the toggle = **zero extrapolation** — each piece's ceiling in the reforge mode (`pieceReforgePlan`, the projection's) becomes its floor (only pieces **already** at their ceiling or better, scored on their real rolls, projection skipped). Off → no gate; 6★ `unique`: +10R6 → enhance ≥ 10 & reforges ≥ 6; +10R9 → ≥ 10 & ≥ 9; +15R9 → ≥ 15 & ≥ 9; a piece that can't ascend (under 6★, or a non-`unique` 6★): +10 & its own budget (its star, 6 for a 6★) whatever the mode; a piece with no star (absent from the contract): the mode's floor. Talisman: enhance floor only (gems replace reforge), capped at its +10 ceiling (`enhance.maxEnhanceLevel`: no Singularity — a +15 floor emptied the pool)
- excluded if `classLimit` ≠ the hero's class
- excluded if one of its option mains (not `combatOnly`) is an **excluded main** for the slot (`mainExcludes`), before the acceptables are checked; the number of pieces dropped this way is reported in `poolSizes[slot].mainExcluded`
- excluded if **main pick** is active for this slot and none of its option mains is among the picks
- excluded if **effect chip** (weapon/accessory) marked `excluded`; or marked `required` and the piece's `setId` (the `UniqueOptionID` effect identity) does not match — the comparison is **deliberately** on `setId`, not `effectIcon` (distinct effects can share an icon, e.g. the Recklessness family)
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

### Phase 3 — Combo-budget prune (heuristic)
Runs whenever `topPct < 100`. **Key point**: the cap is an **ABSOLUTE combo
budget**, not a per-slot percentage — a % does not bound the **product** (30% of
seven ~40-50-piece pools is still ~`7e8`; measured: **703M / 142s** in Score mode
with a priority set). `allocateComboBudget` distributes (water-filling) a keep
count **per slot** so that `∏ keep ≤ budget` (small slots kept whole, the surplus
flows to the big armor slots). Reference budget `COMBO_BUDGET = 8M` at Top% 30 (≈ 1-2 s of
solve — Score is more expensive per combo than CP), **scaled by the Top% slider**
(`budget = 8M × topPct/30`, ~16M at the default 60; `topPct = 100` short-circuits back to exhaustive).
Talisman included, the **EE never** (no EE pool — single equipped piece, always
exempt); `keepCurrent` slots exempt.

The budget applies to **every** branch; only the **per-slot ranking key** (a
`scoreOf` passed to `keepTopN`) differs:

**a) Explicit priority (SOLVE or SOLVE CP)** — `priorityScoreOf`:
```
score(piece) = Σ_rolls priority[user_key] × (value / ROLL_NORMS[engine_key])
```
**Normalization is crucial**: `ROLL_NORMS` (*per-roll* magnitude) — not
`STAT_NORMS` (endgame final magnitude); the two scales differ ~100×. Without it,
high-magnitude flat rolls always crush % rolls at equal priority. The engine→user
mapping (`STAT_TO_PRIORITY`) makes `atkPct` rolls and `atk` flats share the same
priority bucket `atk`. *Combat-only* main options (conditional +15 singularity)
are ignored (not on the targeted stat sheet), and so is a % main on an axis with no
% variant (Phantasm's −30 % SPD: no roll norm, `isPctRollWithoutNorm` in
`statRegistry.ts`, instead of counting as −1.5 rolls like −30 flat SPD). Same rule in (c).

**b) SOLVE CP without priority** — `cpEval`: each candidate is ranked by **the CP
it yields dropped into the hero's current build** (other slots = the equipped
pieces), so the crit/pen/spd chain that scales ATK is realistic. **A *soft* form
of the dominance prune.** The equipped piece is **pinned** → the solve never
returns a CP below the equipped one. **Known limitation**: pieces are scored
*standalone* — a member that only shines by completing a set can be under-ranked;
raise Top% or require the set.

**c) SOLVE (Score) without priority** — `magnitudeScoreOf` (raw roll magnitude):
no objective (the score would be 0 everywhere), but the product **must** stay
bounded (else full cartesian) → we keep the fullest-rolled pieces per slot.

Required-set protection: for each `req-2pc`/`req-4pc` set not already represented
in the budget slice, `keepTopN` re-adds **its single top-scoring member** outside
the budget — identically for all three keys. Re-adding *all* members (the old
behavior) blew the budget back up. The equipped-piece **pin** applies to every
SOLVE CP, branch (a) with a priority as well as branch (b): the ranking differs,
not the "never below the equipped CP" guarantee. SOLVE (Score) pins nothing.

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
   Dmg/Mcd are multiplied by the hero's **best-skill factor**
   (`meta.bestSkill` → `ctx.skillFactor`, ×1 when missing), DmgS/McdS by the **average
   factor per turn of its rotation** (`meta.rotation` → `ctx.turnFactor`, best skill when
   missing) — constants per solve, the ranking does not change (cf. Engine-Reference § 2.3).
   For a **`noCrit`** hero (`meta.noCrit`, propagated into the context), `computeCheapRatings`
   gets `noCrit=true` → `pCrit=0` (the CHD term drops out) and `mcd` falls back to the
   non-crit hit: CHC/CHD no longer inflate its ratings. In SOLVE CP with no rating-band
   filter other than Score, the 8 products are **deferred** to `finalizeBuilds` (top-N
   only) — the heap sorts by CP. CP itself stays a faithful in-game mirror (the sheet's CHC, bounded at 100%).
4. **Score**: `Σ priority × (final / STAT_NORMS) × 100`, **unrounded** (it is the sort key; the
   table rounds it for display only — rounded, two close builds used to tie).
5. **Rating filter**: same as the stat filter, on ratings + score.
6. **CP / upg**: CP is computed in SOLVE CP, OR in SOLVE as soon as a CP filter is set
   (the filter then rejects early). If an `upg` filter is set, it is also evaluated here
   (from the pre-resolved equipped loadout). Both filter **before** the push, so the
   heap contains only valid builds.
7. **Push** into a fixed-size min-heap (`TopKHeap`, K=1000 by default) keyed by `score` or `cp` depending on the mode,
   ties broken by `pieceUids` (`compareBuilds`, the same order as the merge: one result whatever the
   split across workers). The heap also caps **talisman variants**: at most 3 builds per 6-gear
   signature (`TALISMAN_VARIANTS_KEPT`); a build whose signature is full only replaces the worst of its
   variants — otherwise a worker's top-K filled up with one gear × talismans and lost distinct
   candidates before the merge. With **Allow broken sets** off, the worker also counts the armor
   loadouts that rule alone rejected (`brokenSetsRejected`).

### Phase 6 — Finalize (worker side)
- SOLVE CP: the top-K is already sorted on CP, returned as-is.
- SOLVE: CP is computed for each build of the top-K **for display** (lazy) when no
  CP filter was active; otherwise CP is already carried by the build. `upg` is (re)computed for
  the column. Since the CP/upg filters were already applied in-loop, the re-checks here are
  idempotent no-ops.

### Orchestrator side
- Receives `{builds, permutations, searched, brokenSetsRejected}` from each worker.
- Merges the top-Ks into a global buffer, final sort (`compareBuilds`), **collapses talisman variants**
  (`collapseTalismanVariants`: at most 3 builds per 6-gear signature — gems are a global
  allocation, so same-gear talismans differ almost only by their main and used to drown the
  top-N; each heap already applies the same cap, this pass covers a signature spread over several
  workers when the talisman is the partition axis), slices the top-N (1000 by default), forwards to React.
- A complete solve that is empty, with no combo reached (`permutations` 0) and loadouts rejected by
  "Allow broken sets" off → `onResult` carries the cause `"brokenSets"` (`SolveEmptyCause`), shown by
  the table (cf. § ResultsTable).
- **A worker error** (`error` message or `onerror` crash): every worker is stopped and the builds of
  the workers that already finished are **dropped** — they only cover their slices and would show as
  the result of the whole search. `onError` only, no `onResult`: the table stays empty under the error.
- Aggregates `permutations` + `searched` for the footer (sum of the per-worker counters).

---

## 4. The UI panels

The top panels (Hero, Stats, Sub tick value / Damage info, Options, filters,
priority, mains, sets, effects) + the Actions/Library sidebar + the pinned footer. Each filter panel
pushes its state into the `SolverFilters` reducer (`apps/renderer/src/lib/solver/builderFilters.ts`, wired by `apps/renderer/src/screens/builder/BuilderScreen.tsx`).

### Hero
Picker (searchable combobox) + portrait + 4 action buttons.
- **SOLVE**: launches score mode (disabled if there is no hero or a solve is in progress).
- **SOLVE CP**: launches CP mode.
- **Cancel**: interrupts the solve (workers return their partial heap, the orchestrator merges what we have).
- **Reset filters**: `dispatch({type: "resetAll"})` — clears the entire reducer.

### Stats
Snapshot of the `FinalStats` of the build currently equipped on the hero (left column)
vs the build selected in the table (right column, em-dash as long as no row
is clicked). Read-only, never editable. The crit row reads the raw sum (`critRawOf` =
`critRateUncapped ?? critRate`, `screens/builder/critCell.ts`) for its delta and tint, and past the 100
bound shows "100% ⁺42" (amber exponent, `critCellParts`) on either side, the tooltip giving the raw value
and the waste (`critCellTitle`, see **Overcap** below).

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
- **Reforge** (`reforgeMode`, **4 states**, **wired**, **default +10R6**) — projects each piece of
  the pool to an endgame ceiling **before** the combo-budget prune (phase 3) (`projectPieceForReforge`). Labels =
  enhancement + reforge count (R):
  - **Off**: gear as captured.
  - **+10R6** (`classic`): projects to **+10 non-ascended** (main re-scaled via `projectMainToCeiling`,
    + substats max-rolled at **6 ticks**).
  - **+10R9** (`ascended10`): the **exact same +10 ceiling as +10R6** but **9 ticks** — ascending
    (50 chips) grants the **+3 reforges** and unlocks +15, nothing else. **No passive**, main stat
    unchanged. The cost-conscious tier: skips the steep +10→+15 enhancement (chips at 90/80/70/60/40%).
  - **+15R9** (`ascended`): projects to **+15 ascended** (overrides the real flag; **9 ticks**) **+ the
    unconditional Singularity passive** (`addProjectedSingularity`: DMG+ 50% on weapon/accessory, DMG-
    25% on armor — the table's best value). **Passive and the +11→+15 main-stat steps are +15-only.** An
    already-ascended piece keeps its **real roll**. Never *downgrades* a piece already above the ceiling.
  **Each piece stops at its own ceiling** (`pieceReforgePlan`, the min of the mode and the piece): only a
  **6★ `unique`** piece ascends (`CItem.IsSingularityActivate`); a piece **under 6★, or a 6★ that isn't
  `unique`**, stops at **+10**, at **its own reforge count** (`maxReforgesOf`: its star under 6★, 6 for a
  6★ — 9 only for a 6★ `unique` in a mode that ascends), **with no passive**, whatever the mode. A 5★ in
  +15R9 thus stays +10 R5. The mode labels are the ceiling of a 6★ `unique` piece.
  Ticks: by the priority; **without a priority, by CP weight** (`reforgeTickWeights`, evaluated on the
  hero's equipped build) — returned with the context (`onResult`) and saved with the build, so the gear
  cards re-project the same ticks.

  The main re-scale starts again from the table's +0 value (`rawBase`, set by the parser) and
  re-runs the game's float32 chain (`scaleMain`) — the same numbers as in-game (test
  `projectMainToCeiling`: 240 → 1380); a piece without `rawBase` falls back to the multiplier ratio.
- **Maxed only** (`onlyMaxed`) — **zero extrapolation**: each piece's ceiling in the reforge
  mode becomes its **investment floor** and the projection is **skipped** (pieces scored on
  their real rolls, gear cards included — the display context is snapshotted to `disable`).
  Floors (`maxedFloorOf`/`meetsMaxedFloor`, on `pieceReforgePlan`): Off → none (any piece
  as-is) · 6★ `unique`: +10R6 → enhance ≥ 10 & ≥ 6 reforges · +10R9 → ≥ 10 & ≥ 9 · +15R9 →
  +15 & ≥ 9 · a piece that can't ascend (under 6★, or a non-`unique` 6★): +10 & its own
  budget (a 5★ at +10 R5 is maxed), whatever the mode · a piece with no star (absent from the
  contract): the mode's floor, an unknown piece is not maxed by default. "Or better" keeps its better rolls
  (a +15R9 piece in a +10R6 solve is not scaled down to the +10 ceiling). Talisman: enhance
  only, +10 at most (its ceiling); the hero's own EE is never filtered. (Replaces the old mode-blind flat
  `enhanceLevel < 15` cut.)
- **Transistone potential** (`rerollPotential`, toolbar toggle next to Maxed only, **default
  off**) — projects the Transistone reroll potential (`lib/solver/reroll.ts`, the rule read from the
  client at the top of the module): a 6★ Legendary with 4 substats and **no stage-4 line** raises ONE
  line to base stage 4 (+1 to +3 ticks, reforges kept, value capped at LV6). The line: the hero's
  highest-priority substat (never a negative priority), without a priority or on a tie the largest
  normalized value (`ROLL_NORMS`). Applied by `projectPieceForReforge` **before** the reforges, with
  or without a reforge mode, **never under Maxed only**; snapshotted in the display context and
  saved with the build, the gear cards mark the line (`T+n`, titled "Transistone"). It is a
  ceiling: in-game stage 4 is a 5 % draw.
- **Equipped items** (`equippedScope`, **3 states**, **default ≤ Lower**) — which pieces
  equipped on **other** heroes the solver may pull. Default `lower`: only heroes of
  **strictly lower** priority (auto-ranked by CP at capture, via `isLowerPriority`) → never
  strips an equal/higher hero. Without a ranking it degrades to own+free (`isLowerPriority`
  ∞>∞ = false). `None` = own + free, `All` = any equipped piece (the old default, silent
  stealing possible).
  The scope applies to the **effective owner** = worklist claim ?? `equippedBy`: a piece
  reserved by another hero's queued build counts as equipped on that hero (applying or
  removing the entry lifts its claims — derived live by `worklistClaims`). The **gem pool**
  (`buildGemPool`) follows the same rule.
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
- **Top %** slider: `5..100`, **default 60** (field feedback: at 30 the true best build regularly
  sat just past the pruned slice — ~16M-combo budget at 60, still a few seconds). Drives the
  phase 3 prune; `100` = exhaustive.
  At 100 = exhaustive. Without a priority, it still bites in **both** modes:
  CP-weighted auto-prune in SOLVE CP (phase 3b), raw roll magnitude
  (`magnitudeScoreOf`) in SOLVE Score (phase 3c).
- **(clear)** button: `dispatch({type: "clearPriority"})`.

When priority is uniformly 0: the pool is **still pruned** (phases 3b/3c, same
combo budget). Gems: in SOLVE CP they **are reallocated** by marginal CP gain on
the equipped build (`allocateGemsByCp` — cf. § Gems); only SOLVE Score keeps the currently socketed
gems (no reallocation).

### Main stats
Three rows (Weapon / Accessory / Talisman). Each row shows the mains
actually present in the inventory for that slot (icon chips). Click cycles
off → **allowed** (cyan, OR-allow: a piece is excluded if none of its mains match)
→ **excluded** (rose, ✕: a piece carrying that main never enters the pool, checked
before the acceptables) → off. A main is never both at once (`toggleMainPick` /
`toggleMainExclude` clear the other state). Use case: the Talisman, whose mains are
shared by the team and don't stack — rule out ATK when a teammate already brings one.
The "Mains" button counter counts allowed + excluded; a reco never touches exclusions.

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

### Weapons, accessories & talismans
Three groups of effect-icon chips (Weapons / Accessories / Talismans), filtered by the hero's class (gated by `classLimit`), keyed on the piece's `setId`. Click cycles `off → required → excluded → off`. Tooltip: name + (N owned) / T4 desc / state.
A talisman advised by **Get preset** (`Talisman` from `/api/reco`, `translateReco.ts`) arrives, with its whole
family (the talismans sharing its `name` in `equipment.json`: the advice names the 6★, the 4★/5★ carry their own
`setId`, `talismanFamilyKeys`), as **`preferred`** (dashed outline, `~` badge): if at least one piece of the talisman pool — after every `allow()`
filter — carries one of the preferred `setId`s, the pool is narrowed to those; otherwise it stays open, as without
advice (never 0 builds because of a preferred talisman, unlike `required`). Under "keep current" the worn talisman
stays locked. A click turns it into `required`. The Get preset status says when no member of the advised families
is owned.

### RightSidebar — Library
Three **wired** sections (localStorage, per hero):
- **Save / Remove build** — bookmarks the selected build (`storage/savedBuilds.ts`).
  A saved build also carries its reforge context to re-project its substats on
  restore.
- **Filter presets** — saves / loads / deletes a filter snapshot
  (`storage/filterPresets.ts`, `loadPreset`).
- **Restore** — re-pushes a saved build into the table + bottom band.

Equip / Unequip **to the game** remain absent (they require a non-existent game API).
The **Optimize →** button lives on the Builds tab side (opens the Builder on the hero); **Optimize preset →**
(Presets tab) adds a filter patch to it (`initialPatch`, see the Presets tab).

### FilterFooter (pinned at the bottom)
- Per-slot chips with **hit/total (%)** — fed by the `poolSizes` of the first progress event of each worker.
- **P**: total permutations explored (sum across workers).
- **S**: permutations that passed all filters (scoring).
- **Results**: size of the returned top-N.
- `solving…` indicator (cyan, animated) during a run.

### ResultsTable
Red-green heatmap per column (min/max relative to the current result set, `computeColumnRanges`). Columns:
sets, 8 main stats, ratings (`TABLE_RATINGS`), **Score**, **Swaps**, actions
(`Swaps`, key `upg` = number of slots that change vs the current loadout — not upgrades to do;
sortable + filterable). Sort by clicking
the header (null → desc → asc → null). The **Columns** menu (show/hide columns, persisted
`gs.builder.cols`) opens from the toolbar button **or by right-clicking any column header**
(`ColumnsMenu` controlled, `onContextMenu` on the header `<tr>`). **Right-click a stat, rating
or CP cell** → a "Min ≥ v" / "Max ≤ v" menu (v as displayed): sets that bound (`setStatFilter` /
`setRatingFilter`, the other bound kept), which the filter panels show, and re-solves in the last solve's
mode (`CellMenu`, `onThreshold`). No menu on score, swaps, effects. **Crit past 100**: the CHC cell shows the sheet's value
("100%") followed by an amber "+42" exponent (`critCellParts`: `critRateUncapped − critRate`, `round1`),
tooltip "Crit rate 142% raw — capped at 100% in-game, 40% wasted over the 102% tolerance" (the `overcapOf`
rule; between 100 and 102, "within the 2% buffer"); the column's heatmap and sort read the raw sum
(`critRawOf`), as the header tooltip says (`statHeaderTooltip`); the threshold menu keeps the sheet's
value. Click on a row → the `BottomGearBand`
shows the 8 pieces. `solving…` / error / **explicit empty state** (an `emptyReason`
derived from `poolSizes` lists the slots that fell to 0 pieces after filters, the EE aside: a hero without one solves
without it; a slot emptied (also) by an excluded main says so, "(N dropped: main stat excluded)"; a client "Filter" that keeps no build shows "No build passes the current filter."; no slot empty
but "Allow broken sets" off rejected every armor loadout (the orchestrator's `"brokenSets"` cause) → the table
says so and suggests turning it back on or raising Top %). The selected build's "N slots change" header is
re-read off the current inventory (`buildDiff`), not the solve-time `upg`: after Equip it drops to 0. The
Swaps column (cell and sort) and the "+ Worklist" entry's `upg` read the same live diff.

### BottomGearBand
8 cards (compact mirror of the inventory) — one per slot, in the game's equipment screen order
(`GAME_GEAR_GRID`, shared with Builds and Presets): a 4 × 2 grid Weapon | EE | Helmet | Armor / Accessory |
Talisman | Gloves | Boots from a 1616 px window (four `w-80` cards beside the `w-72` column), otherwise the
same order wraps. Each card shows name,
enhance level, slot icon, main stat, subs (with ticks). In addition:
- **Compact mode** (Settings › Solver › Compact result cards, `gs.builder.compactCards`, off by default):
  `w-64` cards — the grid then starts at 1360 px (4 × 256 + 3 × 8 + 288 + 8 + 16) —, header =
  `compactName` (« EE », the set name for armor, the item name otherwise, no « - [Singularity] » but the
  gradient stays), mains and subs as icon + value (sub level in a small badge, base + reforges in the
  `title`), one-line truncated effects (full text in the `title`). Gems unchanged; Inventory and tooltips
  (`GearDetailBody`) untouched.
- **Talisman / EE**: the gem allocation recommended by the build (stat + value,
  **swap** badge if it differs from the socketed gems).
- **Projected stats**: if the Reforge mode ≠ Off, the displayed main + subs are the projection
  (`projectPieceForReforge` re-simulated on the main thread side) + **+10R6** / **+10R9** / **+15R9** badge.
  The card also shows the projected enhance since the projected piece carries its target
  `enhanceLevel`/`ascended`, the projected **Singularity passive** (**+15R9 only**), and a cyan **`+N`**
  badge per sub showing the reforge ticks the projection added (delta vs the captured piece).
- **Equip state**: per-card badge — 🟠 portrait + name if the piece is equipped on **another hero**
  (applying steals it), 🟢 `equipped` if already on the current hero, `free` otherwise.
- **Per-slot diff**: a card whose piece **differs from the equipped loadout** (same definition as
  `upg`) gets a **cyan edge** + a `← <replaced piece>` line (or `+ new slot` if the slot was empty).
  Proposed piece, worn piece and "slot changed" come from one function, `diffBuildVsLoadout`
  (`lib/buildDiff.ts`), which Equip and + Worklist read too. The band header sums it up: **`N slots change`** + **`ΔCP ±X`** (`build.cp − currentCp`,
  `currentCp` = `calcBattlePower` of the equipped loadout). The build is counted in the results'
  reforge mode, the equipped gear as it is: outside `Off` the label names the base
  (`ΔCP +X vs equipped (build at +10R6)`, one-sentence tooltip — `deltaCpLabel`, `lib/deltaCp.ts`),
  since a build identical to the loadout shows a positive ΔCP there.

Em-dash when no build is selected.

### Presets tab
A tab between Builds and Builder (`screens/presets/PresetsScreen.tsx`), one card per in-game equipment
preset (`Inventory.presets`, up to 30): number, name, favorite ★, the 7 pieces (weapon, accessory, helmet,
armor, gloves, boots, talisman — the EE is **never** part of it, the EE slot of `ItemUIDList` is skipped)
with the inventory's tile and hover detail, and the **current wearers**: heroes whose gear, EE aside, is
exactly the preset (`presetSignature`, the same rule as the preset name on the Builds cards). The model is
pure and tested (`lib/presets/presetRows.ts` → `presetRows(inventory)`): a piece missing from the inventory
(slot taken from its wire position) and a piece held by **two** presets ("shared with <preset>" — two
presets may play the same fight) are flagged on the tile and in a banner. An empty preset is listed
collapsed.

**Layout.** The pieces follow the 4 × 2 grid of the game's equipment screen (`GAME_GEAR_GRID` from `design/tokens.ts`, in engine slots):
Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots; `PRESET_SLOTS` keeps its 7 slots (signature,
worklist, tests), only the display grid changes, and a piece of unknown slot follows the grid. The EE cell
shows the EE the card's reference hero wears today (`referenceUid`, or the proposed unique wearer, `eeOf`),
dimmed, tooltip "EE isn't part of a preset — each hero keeps their own"; without a reference (or an EE), an
empty dashed cell. Past 1280 px (`xl`), an open card goes two-column: the grid on the left (fixed width), the
Reference / Associated lines on the right; below that, stacked. A hero line's metrics have a minimum width
(aligned from one line to the next) and spread over the room available. The Worklist tab has no maximum
width anymore: the transaction header full width, then the cards on a two-column grid past 1280 px, each at
its own height.

**Order, class filter and sort.** The cards follow the in-game preset editor's order: `comparePresets`
(core, `parse.ts`) mirrors the client's `CEquipPresetData.SortPreset` — type ascending (Master League
presets after the others), favorites first, then the player's order (`Preset.sortOrder`, read from
`PresetOrderList` by `Num`, 0 without an entry) descending, then `num`. The `#num` stays on the card. The
top bar carries the five class chips (`CLASSES` from `lib/homeStats.ts`, multi-select), a
"Sort: In-game · Class" selector and "Clear". A preset's class (`presetClasses`) comes from its pieces (a
weapon or accessory restricted to a class, `GearPiece.classLimit`; two different classes are both kept),
else from the reference hero, the wearers, then the associated heroes; otherwise it is unknown. A filter
keeps a card with one of its classes ticked and hides empty or unknown-class cards; "Class" sorts by the
card's first class in chip order (only the ticked ones while filtering), unknown last, the game's order
within a class (`arrangePresets`). The class icon shows next to the name; the pill adds "· K shown" when
cards are hidden. Component state, lost on a tab switch.

A preset = the outfit of **one reference hero**, worn as-is by **associated heroes** who tune themselves
through their own EE gems. Groups are made by hand (hero picker; a unique current wearer is proposed as the
reference), stored app-local in `gs.presetHeroes` (`lib/storage/presetHeroes.ts`, per preset number
`{ referenceUid, associatedUids }`, a uid that left the roster ignored on read; the blob is part of the backup
export / import, a preset that already has heroes here keeping its own). For the reference and each
associated hero, `evaluatePresetFor` (`lib/presets/evaluate.ts`) composes the hero with the preset's pieces
+ **their own** current EE through `computeFinalStats`, then `computeCheapRatings` (the hero's skill
factors) and `computeScore` with their priority; the card shows Score, Dmg and DmgS.

**EE gems per hero.** The Talisman and its gems are part of the preset (shared, never tuned per hero); what
each hero tunes is the gems of **their own** EE. `bestEeGemsFor` (`lib/presets/eeGems.ts`) picks them like
the engine does, pieces fixed: `buildGemPool` restricted to the gems of the hero's EE and those of the
Talismans / EEs nobody wears (never the preset's pieces, even free, nor a piece another hero wears, nor a
free piece the Worklist reserves for another hero — `worklistClaims`, the same value as the Builder and
Builds —, nor the hero's own Talisman, which comes off when the preset goes on), `scoreGemPool` with the hero's priority
(fillers by `dmg` gain on the outfit, `gemDmgGains`), `allocateGemsCapped` on the EE's slots alone
(`gemSlotsOf`, CHC without the EE gems for the cap). A gem already socketed keeps its socket
(`alignToSockets`, the fewest Worklist lines) and a socket the pick leaves empty keeps its gem (the game
never removes one by itself). No proposal (null) without a priority, an EE or a gem, or when the pick scores
no higher than the gems as socketed. `evaluatePresetFor(…, eeGems)` then composes the EE with those gems
through the composer's `gemOverride` (`eeGemOverride`: it skips the subs of both gem-bearing pieces, the
Talisman's are put back in); the line shows "EE gems: <list>", the score and the loss **with** those gems,
and in brackets the score as socketed when it differs.

**+ Worklist**, on the reference's line and each associated hero's: the hero's entry (`presetWorklistFor`,
`lib/presets/presetWorklist.ts`) = the preset's pieces they don't wear (`diffBuildVsLoadout`, the Builder's
rule) + the gem lines of their EE (`worklistChangesFor`, `gemAllocation = { talisman: [], ee }`),
`mode: "preset"` ("Preset" on the Worklist card, no CP); `upsertWorklistEntry` replaces the hero's entry,
toast "Added to / Replaced in worklist — <Name>". A piece missing from the inventory is left out, and the
toast says so. The button is greyed out when there is nothing to change. **Optimize →**, next to it on an
associated hero's line: opens the Builder on the hero, like a Builds card.

**Optimize preset →**, on the reference's line: opens the Builder on the hero with a filter patch
(`presetOptimizePatch`, `lib/presets/optimize.ts`, pure) overlaid on their remembered filters by
`mergePreset` (bands and options kept). Effects: the `setId` of the outfit's weapon, accessory and
talisman, `required` (the talisman widened to its family by `talismanFamilyKeys`, every key `required` —
the same effects, not "preferred"); a piece missing from the outfit or without a `setId` → slot left open,
a note. Substats: at most 5 priority keys, weight = max(reco, outfit) — the reco (`fetchRecoForHero`,
first build, `SubstatPrio` as 3/2/1 like "Get preset"), the outfit by the number of pieces (talisman and EE
aside) rolling the key as a substat (4+ → 3, 3 → 2, 2 → 1); ordered by weight, then presence in the reco,
then piece count; other keys left out of the patch. Mains: the reco's for the weapon and accessory. Sets: no
plan (`setPlans: []` → one empty plan, sets open; "Get preset" remains the way to the full reco). Without
a reco (404, error, offline): the outfit alone. The Builder receives the patch with `initialHeroUid`
(`initialPatch`) and merges it once the hero's filters are loaded — never onto the outgoing hero's; the
status line says "Optimizing preset #<num> <name> — same weapon / accessory / talisman effects required, N
priority substats from the outfit + outerpedia's "<build>" reco." (or "from the outfit", then the notes).

**Priority.** `presetPriorityOf` reads, in order, the Builder priority of the session
(`gs.solver.heroFilters`, sessionStorage: kept over a window reload, gone at each launch; written when the
Builder switches from one hero to another, so the hero open in the Builder counts with the set they had when
last left, or not at all), then `reforge.priority`
of the hero's most recent saved build, then nothing; a priority without any weight falls through to the next
source. The line says "priority from saved build" in the second case. A hero with no saved build and no
priority left in the Builder since launch has no score. An associated hero is compared to their **best known outfit** (`bestKnownFor`:
their most recent saved build, re-scored with the **current** priority, else their current gear):
`loss = 1 − score(preset) / score(best)`, shown in % "vs saved build" / "vs current gear"; past the
threshold (15 % by default, Settings → Solver, `gs.solver.presetLossWarn`) the line turns orange with
"<Name> loses 23 % vs their saved build". Without a priority: "no priority set for <Name> — set one in the
Builder", no score. Nothing is written to the game.

**Overcap.** The sheet bounds `critRate` at 100 (`computeFinalStats`) and keeps the raw sum in
`critRateUncapped`; `pen` isn't bounded. The wasted-cap rule lives in `lib/overcap.ts` (pure, shared with
`buildAdvice`'s rule 4 and the Builder's crit tooltip, `critCellTitle`): `overcapOf(finalStats)` → `{ key, label, value, cap, waste }` per axis over its cap —
crit read on `critRateUncapped ?? critRate` against 102 (a buffer against crit resistance), penetration
against 100, `waste = round1(value − cap)` kept when > 0; `overcapText` writes "Crit rate 142% — 40% wasted
over the 102% cap". `presetOvercap(evalPreset, asSocketed)` (`lib/presets/evaluate.ts`) applies it to the
displayed evaluation (proposed EE gems), on the reference as on the associated heroes: one badge per axis,
orange with the line in the warning tone (the loss's) from `OVERCAP_WARN_PTS = 10` points wasted (a
constant, not a setting), amber alone below; when the overflow is larger than with the gems as socketed, the
badge's tooltip says it comes from the proposed EE gems.

---

## 5. Gems — greedy sub-solver

**Pool**: multiset of the non-null `gemSlots[]` of the **eligible** Talismans + EE in the inventory (gems are swappable in-game). Eligibility (`buildGemPool`) mirrors the piece-pool rule: the current hero's gear is always in; gear equipped on another hero is gated by `equippedScope` (`none`/`lower`/`all`); gear on an excluded hero is never counted. Without this gate, the solver would propose gems that require unequipping the Talisman/EE of an out-of-scope hero.

**Scoring**: for each gem, `score = priority × (value / ROLL_NORMS)`. Normalized to allow cross-stat comparison. Sorted desc. **In SOLVE CP without a user priority**, the "priority" passed is not empty but the **CP weights** (`cpStatWeights`: ΔCP of a ROLL_NORM-sized bump of each stat, evaluated at the current build). Otherwise (raw `value/norm` ranking), the allocator preferred dmg-reduce/flat gems (big magnitude, ~0 CP) over atk/crit/pen gems → a CP solve could return **less** CP than the equipped build. A stat already at its CP cap (e.g. CRC ~100%) gets a ~0 weight. These weights are linear (one bump per stat, ATK% weighed on a flat ATK bump): they order the pool, but the SOLVE CP allocation itself goes by marginal CP (below).

**Allocation (default, fast path)**: greedy, K = `talismanSlots + eeSlots` (4 or 5 depending on `enhanceLevel`). We take the K first gems with `score > 0`, then, if slots are left, the **filler gems**. A single allocator, `allocateGems`, returns the displayed split **and** the composed delta. Pre-computed **once per talismanSlots variant** (4 or 5) in `prepareContext` — no re-computation in the hot loop.

**SOLVE CP without a priority — by marginal CP** (`allocateGemsByCp`): CP is not linear in the stats (ATK compounds, CHC caps at 100%), so the CP-weight order got it wrong (five DMG-reduce gems, 34,643 CP, vs 3 ATK% + 2 DMG-reduce, 35,044, on Ame). The gems are placed one at a time: each slot takes the gem that raises most the CP of the **equipped build** (the reference composition of `cpStatWeights`) with the gems already placed — re-weighed after each gem, crit cap included. Candidates: those of `pickOrder` (no negative priority, no filler under a `max`); copies of one id are weighed once per step; a tie keeps the `pickOrder` one. A gem that adds no CP is placed only once the useful gems are exhausted, in `pickOrder`. Cost: (slots × distinct ids) composes, once per variant per solve — not per combo. An explicit priority in SOLVE CP keeps the priority allocation.

**Filling by the hero's useful stat**: with a partial priority (e.g. `{ critDmg: 3 }`), the gems of a stat without priority score `0`; they're no longer dropped but fill the free slots — a socketed gem takes nothing off the sheet, an empty slot does. Only gems scoring **exactly 0** fill (a negatively-prioritized stat is never socketed, nor a stat carrying a `max` in `statFilters`: it would push the build out of its band). Order: the relative `dmg` gain the gem brings (`gemDmgGains`, the `computeCheapRatings` model with `dmgStat` / `dmgSec` / `noCrit` — the one behind the "DMG per 1 %" panel), **weighed once per solve on the equipped build**; at zero gain (stat outside the model, CHC at the cap, CHC/CHD for a `noCrit` hero), by raw magnitude `value / ROLL_NORMS`. Carried by `ScoredGem.fill`, set by `scoreGemPool` and read by all four allocators (`pickOrder`: the priority gems in their order, then the fillers) — the displayed split and the composed delta can't diverge. Unchanged: SOLVE Score with no priority at all (`null` fallback below) and the build score (`computeScore` only reads the priority); in SOLVE CP without a priority, the gems with a zero CP weight fill by the same rule.

**Cap-reaching CHC (slow path, per combo)**: when the user prioritizes `crc` **and** the pool has crit gems (`wantCritCap`), the allocation is **staged** (`allocateGemsReachingCap`):
1. **Stage 1** — spend crit gems to **reach** the 100% CHC cap (as a priority, even if atk scores higher), overshoot ≤ one 3% gem.
2. **Stage 2** — fill the rest **by priority, then by filler** (skipping any crit gem once the cap is reached, now wasted — a filler crit gem follows the same skip).

The combo's pre-gem CHC is recovered from `fs.critRateUncapped − defaultCrcGem` (crit rate is purely additive; the unbounded sum, the sheet's CHC being bounded at 100). We only **recompose** if the cap-aware delta differs from the default greedy (`gemDeltaEquals`) — often identical when crit gems already rank high. The case without a crc priority (e.g. SOLVE CP fallback, or filler crit gems) keeps the old anti-overshoot (`allocateGemsCapped`, triggered only if `fs.critRateUncapped > 102`).

**Pre-aggregation**: the gem contribution is converted into `{flat: {atk: 5, ...}, pct: {atkPct: 24, ...}}`, returned by the allocator along with the split (`GemAllocation`). The compose just adds these deltas to the buckets after the piece aggregation. Avoids `resolveStat` × 10 gems × N combos.

**`null` fallback**: in **SOLVE Score without a priority**, the priority is empty
(no gem has a `score > 0`) → the delta is `null` → no `gemOverride` → the compose
uses the **gems currently socketed on the Talisman + EE** (via `piece.subs`).
This is intentional: without user intent, we respect the player's state.
(SOLVE CP no longer falls into this: it allocates by marginal CP, above.)

---

## 6. Top-% heuristic — why it's there

A typical inventory: 150 pieces per slot × 7 slots = `150^7 ≈ 10^15` permutations. Inaccessible.

The Top% slider drives an **absolute combo budget** (phase 3): `budget = 8M × topPct/30`,
water-filled per slot (`allocateComboBudget`) so that `∏ keep ≤ budget`:
- 100% → exhaustive (short-circuit, no prune)
- 60% (default) → ~16M combos
- 30% → 8M combos (~1-2 s; the former default, the normalization reference)
- 10% → ~2.7M
- 5% → ~1.3M (very fast, but may skip the optimal build)

The panel hint says so explicitly: *"Top % scales an absolute combo budget (100 = exhaustive) […] Heuristic — too low a Top % drops optimal builds"*. It's a pure recall vs speed trade-off. **Caution**: a *per-slot percentage* Top% would not bound the **product** — on a real account, 30%/slot still leaves ~`10^10` combos (measured: 1.25G post-30%-prune, still >100 s). That's why the budget bounds `∏` directly, **whatever the mode** → a ~1-2 s solve on any account.

With empty `priority`, the budget still bites: in **SOLVE Score** the ranking
falls back to raw roll magnitude (`magnitudeScoreOf`, phase 3c) — results are
arbitrary without an objective, but the solve doesn't hang. In **SOLVE CP**, the
CP-weighted auto-prune (phase 3b) makes "max CP" playable with nothing tuned.

---

## 7. Key optimizations (and why)

1. **Pure engine, no React** (`engine.ts`, `gems.ts`, `ratings.ts`, `cp.ts`) — importable from any worker or test, no DOM or Suspense to drag around.

2. **Worker pool = `hardwareConcurrency − 1`** (`resolveWorkerCount`, override
   `gs.solver.workerCount` brought to [1, min(cores, 64)] by `clampWorkerCount`, the same
   rule as the Settings input) — one core left to the UI, the rest to
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
   to finalize (top-N) when no rating-band filter other than Score is set (a Score band
   doesn't count — it derives from `FinalStats`) — the heap sorts by CP, so the 8
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
│   ├── overcap.ts                 ← overcapOf + overcapText (wasted CRC 102 / PEN 100 caps, Builds and Presets)
│   ├── presets/
│   │   ├── presetRows.ts           ← in-game presets: pieces, wearers (presetSignature), missing / shared pieces, class, filter / sort
│   │   ├── evaluate.ts             ← evaluatePresetFor + bestKnownFor + presetLoss + heroBases + presetPriorityOf + presetOvercap (Presets tab)
│   │   ├── eeGems.ts               ← bestEeGemsFor: EE gems per hero, the preset's pieces fixed
│   │   ├── presetWorklist.ts       ← presetWorklistFor: the Worklist entry of one hero of the preset
│   │   └── optimize.ts             ← presetOptimizePatch + presetOptimizeNote: "Optimize preset →" (effects required, priority substats)
│   ├── storage/
│   │   ├── savedBuilds.ts          ← per-hero build bookmarks (localStorage)
│   │   ├── presetHeroes.ts         ← reference + associated heroes per preset (localStorage)
│   │   └── filterPresets.ts        ← per-hero filter snapshots (localStorage)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── builderFilters.ts       ← SolverFilters + Builder reducer + INITIAL_FILTERS + buildSolveFilters
│       ├── orchestrator.ts         ← Web Worker pool, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap + simulateReforges
│       ├── setPlans.ts             ← setsFeasible + armorSetWhitelist + allSetsComplete (set OR-of-AND model)
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + allocateGems + allocateGemsByCp
│       ├── ratings.ts              ← computeCheapRatings + computeScore + STAT_NORMS + STAT_TO_PRIORITY
│       └── cp.ts                   ← calcBattlePower + makeCpEvaluator (reverse-engineered)
└── screens/
    ├── builder/
    │   ├── BuilderScreen.tsx       ← useReducer(SolverFilters) + layout + hero switch + builds/presets/reco
    │   ├── useSolverSession.ts     ← orchestrator wiring: solve/cancel, pre-solve estimate, progress, results
    │   ├── BuilderToolbar.tsx      ← hero · Solve · toggles + popovers (one file per panel: OptionsPanel, SetsPanel…)
    │   ├── ResultsTable.tsx        ← virtualized table, sorting, heatmap, columns menu
    │   ├── BottomGearBand.tsx · RightSidebar.tsx · FilterFooter.tsx · StatsPanel.tsx · …
    │   └── catalogs.ts · statColumns.ts ← inventory-driven catalogs, stat/rating tables
    ├── presets/PresetsScreen.tsx   ← Presets tab: cards per preset (game order, class filter / sort), in-game grid, reference, associated heroes, EE gems, loss, overcap, + Worklist, Optimize → / Optimize preset →
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
7. **Regression comparison**: SOLVE with empty priority + Top 100% + Keep current + **Reforge Off**
   (the default +10R6 projects to +10 → would not match the card) → the top-1 must have the same
   `FinalStats` as the card of the same hero in the Builds tab (modulo gem reallocation, which in
   empty-priority mode falls back on the current gems, so ✓ strict equivalence is expected).
8. SOLVE CP → the top-1 must have the highest CP displayed. Compare against a separate brute-force solve on a small slice.
