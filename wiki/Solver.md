# Solver — internals & UI

*Mirror of `docs/solver.md` (translated to English) — see the repo for the authoritative source.*

This doc describes the **gear-solver** (Optimizer tab), its UI panels,
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

| Mode (Score \| CP, then Solve) | Goal                    | Sort key                          | Hot-path cost |
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
- excluded per `equippedScope` (`none`/`lower`/`all`) if equipped on **another** hero — `lower` gated via `isLowerPriority(heroPriority, …)` (cf. § 4, Options popover, Equipped items). The "owner" is the **worklist claim if any, else `equippedBy`**: a piece reserved by another hero's queued build (`worklistClaims`, uid → claiming hero, unapplied changes only) is treated as equipped on that hero — the scope + rank rules apply to reservations exactly like to real equipment
- excluded if `g.equippedBy ∈ excludedHeroes` (likewise via the effective owner)
- excluded if below the **"Maxed only" investment floor** (`meetsMaxedFloor`): the toggle = **zero extrapolation** — each piece's ceiling in the reforge mode (`pieceReforgePlan`, the projection's) becomes its floor (only pieces **already** at their ceiling or better, scored on their real rolls, projection skipped). Off → no gate; 6★ `unique`: +10R6 → enhance ≥ 10 & reforges ≥ 6; +10R9 → ≥ 10 & ≥ 9; +15R9 → ≥ 15 & ≥ 9; a piece that can't ascend (under 6★, or a non-`unique` 6★): +10 & its own budget (its star, 6 for a 6★) whatever the mode; a piece with no star (absent from the contract): the mode's floor. Talisman: enhance floor only (gems replace reforge), capped at its +10 ceiling (`enhance.maxEnhanceLevel`: no Singularity — a +15 floor emptied the pool)
- excluded if `classLimit` ≠ the hero's class
- excluded if under the **`minQuality` gate** (Options › Min quality): the piece's quality tier (`QUALITY_TIERS`) is below the chosen tier; Talisman / EE (no quality, null tier) are never dropped; `minQuality` null = no gate
- excluded if one of its option mains (not `combatOnly`) is an **excluded main** for the slot (`mainExcludes`), before the acceptables are checked; the number of pieces dropped this way is reported in `poolSizes[slot].mainExcluded`
- excluded if **main pick** is active for this slot and none of its option mains is among the picks
- excluded if **effect chip** (weapon/accessory) marked `excluded`; or marked `required` and the piece's `setId` (the `UniqueOptionID` effect identity) does not match — the comparison is **deliberately** on `setId`, not `effectIcon` (distinct effects can share an icon, e.g. the Recklessness family)
- excluded by the **+15 passives** (`passivePicks`, per group: weapon, accessory, the four armor pieces — `passiveGroupOf`): the family of the passive the piece already carries (its `source === "singularity"` main, the Singularity option's name; grade = the letter its `desc` opens with, `C < B < A < S < S+`) is `excluded` in its group, at any grade; or the group has at least one `required` and the piece carries none of them at its `minGrade` or better (OR between the `required`; a piece without a passive, below +15, or with an unreadable grade is dropped). The passive the +15 mode projects (`addProjectedSingularity`) is added after this filter and doesn't count; the number of pieces dropped this way is reported in `poolSizes[slot].passiveExcluded`. **Requested passive counted** (G116): after the pool projection (and under Only maxed or Off too, the passive being a real roll), a piece whose conditional passive (`combatOnly`: vs an element, within Dimensional Singularity, Ultimate Skill) is a `required` family of its group enters the pool as a **clone** whose `singularity` entry turns `combatOnly: false` (`withRequestedPassiveCounted`, `lib/singularityPassives.ts`; the inventory is never mutated): `composeBuild` routes it through `fromBuff` to `dmgUp` (weapons, accessories) or `dmgReduce` (armor), hence into the column, the ratings, the Stat filters and the prune ranking — asking for "DS DMG+ ≥ A" is building for the Singularity. The 15 families of `singularity-options.json` all resolve to `ST_DMG_BOOST` or `ST_DMG_REDUCE_RATE` (`OAT_ADD`); an `excluded`, off or unconditional family (already on the sheet) is left alone
- excluded if `armorSetId ∈ excludedSets`

**`keepCurrent`** toggle: if the piece currently equipped by the hero exists for this slot, the pool is restricted to `[currentPiece]` (the solver does not touch the slot). Such locked slots are **exempt** from the set-prune below.

**Armor pool set-prune** (`armorSetWhitelist`, pure): when the set requirements
**fully** constrain the armor (a plan `2pc A + 2pc B` or `4pc A` → `Σcount === 4`, no
free slot), the helmet/armor/gloves/boots pools are **pruned** to admissible sets only
**before** the cartesian — a huge reduction on set-constrained searches. A **single**
required set (`2pc A`, free slots) prunes nothing by default: you must keep filler to
complete the build. The **Allow broken sets** toggle (cf. § 4, Options popover) flips this: when
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

The budget applies to **every** branch; only the **per-slot ranking key** (the
objective) differs. Every branch calls
`keepTopUnion(pool, objective, floorScorers, keep, requiredSetIds, pin)`:

**Min retention** (`floorScorers`): a stat filter with a **min** bound is a hard constraint; ranking by the
objective alone could prune the pieces the bound needs, and the solve returned 0 builds though a feasible build
existed (reproduced: priority spd + chc + eff, min eff 570). Hence one scorer per min-bounded stat
(`priorityScoreOf({ [stat]: 1 })`, the magnitude of its own rolls), and `keepTopUnion` keeps the **union** of the
objective's slice and one slice per scorer, the slot's budget split evenly (`⌈keep / (k + 1)⌉` each), so the union
stays ≤ `keep` and the ∏ budget holds. A **max** bound doesn't enter (the in-loop filter holds it). With no min
bound, `keepTopUnion` = `keepTopN` by the objective.

**a) Explicit priority (SOLVE or SOLVE CP)** — `priorityScoreOf`:
```
score(piece) = Σ_rolls priority[STAT_TO_PRIORITY[roll.stat]] × (value / ROLL_NORMS[roll.stat])
```
**Normalization is crucial**: `ROLL_NORMS` (*per-roll* magnitude) — not
`STAT_NORMS` (endgame final magnitude); the two scales differ ~100×. Without it,
high-magnitude flat rolls always crush % rolls at equal priority. The roll → axis
mapping (`STAT_TO_PRIORITY`, derived from `lib/statRegistry.ts`) makes `atkPct` rolls and `atk` flats share the
same priority key `atk`; the other keys are the engine names themselves (`critRate`, `critDmg`, `effRes`…). *Combat-only* main options (conditional +15 singularity)
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
bounded (else full cartesian) → we keep the fullest-rolled pieces per slot. The
Optimizer's Solve button no longer leads here (the reco's priority, else CP, § 4, toolbar row 1);
the branch remains the pre-solve estimate's and the engine's when called without weights.

Required-set protection: for each required set (a plan's 2pc / 4pc) not already represented
in the budget slice, `keepTopN` re-adds **its single top-scoring member** outside
the budget — identically for all three keys and for each slice of `keepTopUnion`. Re-adding *all* members (the old
behavior) blew the budget back up. The equipped-piece **pin** applies to every
SOLVE CP, branch (a) with a priority as well as branch (b): the ranking differs,
not the "never below the equipped CP" guarantee. SOLVE (Score) pins nothing.

**CP dominance prune** (`pruneDominatedForCp`, SOLVE CP only, after the budget — whether it ran or not, Top % 100
included — and every other step, on the exact pools the cartesian iterates): CP is monotone in every gear stat, so
a piece whose contribution (`aggregatePrefixBuckets([piece])`, on the axes the compose reads only) is ≤ another's
on every axis and < on one can never give a better CP — it leaves before the cartesian. Compared **within one
group**: same effect (`setId`) for weapon and accessory, same armor set for helmet / armor / gloves / boots;
Talisman and EE are never pruned (their gems come from the global allocation, and the per-combo crit-cap reroute
breaks monotonicity). Disabled as soon as a constraint could make a weaker build the only feasible one: a stat
**max** bound, or **any** rating / CP / Swaps (`upg`) bound. Stat min bounds stay compatible (the dominator holds
them whenever the dominated does). `keepCurrent` slots are exempt.

### Phase 4 — Cartesian + set-prune
Nested-loop enumeration: `weapon × helmet × armor × gloves × boots × accessory × ooparts`.
- **Partition**: one slot (the largest) is sliced into `chunkCount` parts; each
  worker receives its slice → embarrassingly parallel, no inter-worker communication.
- **Set tracking**: at each armor slot, `incSet(armorSetId)` at the start of the piece, `decSet` after the inner loop.
- **Mid-tree pruning**: at each depth `D` (D armor slots iterated, `4-D` remaining), for each required set (2pc or 4pc) we verify that enough slots remain to reach the threshold. Otherwise, `continue` to the next sibling.
- **Leaf no-broken-set**: when **Allow broken sets** is *off*, at boots depth (`remaining === 0`) we also reject any build whose `setCount` tally isn't "complete" (`allSetsComplete`: every present set ≥2 AND all 4 armor pieces set-tracked → a 4pc or two 2pc). Leaf-only: a mid-tree singleton may still pair up deeper.

### Phase 5 — Per-combo: compose + ratings + filters + heap
For each combo that passes phase 4:

1. **Compose**: `computeFinalStatsFromPrefix(baseline, scaling, prefixBuckets, talisman, ee, gemDelta, setBonuses)`.
   - `prefixBuckets` = `aggregatePrefixBuckets(pieces.slice(0, 6))`, the six weapon..accessory pieces summed
     **once per accessory node**; the talisman loop clones that prefix and only adds the talisman, the EE, the gems
     and the set bonuses, in slot order — **bit-identical** to the full re-sum (`computeFinalStats`, which stays
     the compose of the out-of-loop paths: heroes, cards, presets).
   - `setBonuses` = `computeSetBonuses(pieces, …)`, also computed once per accessory node (the talisman carries no
     `armorSetId`).
   - `pieces` is a hoisted array (mutated in place) to avoid 10M+ allocations.
   - `gemDelta` is pre-aggregated (cf. § Gems); the slow paths (crit cap, stat mins) recompose through the same
     function with another delta.
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
  the table (cf. § 4, results table).
- **A worker error** (`error` message or `onerror` crash): every worker is stopped and the builds of
  the workers that already finished are **dropped** — they only cover their slices and would show as
  the result of the whole search. `onError` only, no `onResult`: the table stays empty under the error.
- Aggregates `permutations` + `searched` for the footer (sum of the per-worker counters).

---

## 4. The UI panels

Same plan as the Optimizer section of the manual ([Using the App](Using-the-App#optimizer--optimize-a-hero)):
the toolbar (two rows, with the priority banner between them), the filter popovers, the table, the right
column, the selected build, its cards, the footer. Every filter control sends an action to the `SolverFilters`
reducer (`solverFiltersReducer`, `apps/renderer/src/lib/solver/builderFilters.ts`, 21 actions), held by the
`useReducer` of `apps/renderer/src/screens/builder/BuilderScreen.tsx`; the controls that aren't filters (mode,
solve, build selection) live in the screen's state or in `useSolverSession.ts`. The files named below are under
`apps/renderer/src/`.

**Per-hero filter memory** (durable): every change to the open hero's filters is written to
`gs.solver.heroFilters` (`lib/storage/heroFilters.ts`, localStorage, owned by App and passed to the Optimizer and
to Presets), and opening a hero **restores** their kept set (`loadPreset`) instead of resetting everything — on a
hero switch as on a relaunch; distinct from the named **Filter sets**. A hero with no kept set starts from
`filterDefaults` (the default reforge mode and Transistone of Settings › Solver) with the priority from
`priorityOf` (`lib/heroPriority/weights.ts`: their most recent saved build's, if any), the same one Presets
scores them with. The *results* start empty on each hero switch.

### Toolbar, row 1 — hero and Solve (`screens/builder/BuilderToolbar.tsx`)

- **Hero** — portrait (the fusion's for a fused hero, `effectiveCharacter`) and a `HeroPicker` in
  `mode="single"` (`design/HeroPicker.tsx`: "Search hero…" on the name shown, the nickname, the base name or the
  id — `lib/heroes/heroName.ts` —, Heroes rank order then capture order — `lib/heroes/heroListOrder.ts` —,
  ↑/↓ + Enter). No reducer action: a hero switch cancels the running solve, empties the results and loads the
  incoming hero's filters (`loadPreset`, then `mergePreset` when an "Optimize preset →" patch is waiting).
- **Score | CP** (`SolveModeControl`) — a segmented control that picks the mode (the screen's `solveMode`, Score
  at each launch) without solving.
- **Solve** (`SolveButton`) — runs the current mode (disabled with no hero); labeled "Solve" in both modes.
  **Default priority**: in Score with no weight at all (`hasPriority` false), Solve fetches the hero's outerpedia
  reco (`fetchRecoForHero`, the Load reco path; the button reads "Loading reco…") and sets only the priority of
  its **first** build (`recoPriorityOf`, `lib/reco/recoPriority.ts`: `SubstatPrio` as 3/2/1, no mains, effects,
  sets nor picker), through the hero's filters (so kept, and read by Presets), then solves with it. Without a
  reco (network failure, hero with no reco, reco with no weights) the solve goes **by CP this once** (the mode
  doesn't change) and a toast says so. The decision is the pure helper `solveDecision` (`"cp"` / `"score"` /
  `"score-with-reco"` / `"cp-fallback"`). A hero without a reco is remembered for the session (no new call); a
  network failure is retried on the next Solve.
- **Cancel** — while a solve runs, the Solve button **becomes** Cancel (same spot): it aborts the solve (a
  cancelled worker exits without posting; the orchestrator merges the results of workers that already finished).
- **Filter / ✕** — post-solve client filter: re-applies the Stat filters and Ratings bands to the kept results
  without re-solving (`applyClientFilter` → the screen's `displayFilter`; enabled once there are results and a
  band, amber while it filters); **✕** removes it. No reducer action.

### Priority banner (`screens/builder/PriorityBanner.tsx`)

Under row 1, visible with the popovers closed, while the hero has no weights of their own
(`PriorityBannerState`):
- `none`: "No priority set — Solve will use the outerpedia reco's weights" with **Load reco** (the whole reco,
  as in the Library: `mergePreset`), **Set priority** (opens the Priority popover) and **Use CP** (switches to CP
  and solves, `solveByCp`); in CP mode the text says CP needs none and Use CP disappears;
- `no-reco`: "No priority set and no outerpedia reco for this hero — Solve will use Combat Power", Set priority
  and Use CP;
- `from-reco`: "Priority from outerpedia reco · Edit · Clear" as long as the weights Solve set aren't edited;
  Edit opens the popover, Clear sends `clearPriority` (every weight to 0).

### Toolbar, row 2 — reforge and quick toggles (`BuilderToolbar.tsx`, `lib/solver/reforge.ts`)

At the head of the row, the **Options** popover (see Filter popovers; its panel opens under the row from its left
edge), then:

- **Reforge** (`ReforgeModeControl`, `reforgeMode`, **4 states**, action `setReforgeMode`, **default +10R6**, set
  in Settings › Solver — `gs.solver.reforgeMode`, +10R6 out of the box; the choice made for a hero stays with
  their filters; labels and tooltips: `REFORGE_MODES`) — projects every pool piece to an endgame ceiling
  **before** the combo-budget prune (phase 3) (`projectPieceForReforge`). Default `classic` (+10R6) because it's
  the endgame norm; `Off` would score the captured gear (+0/+9), misleading. Labels = enhancement + number of
  reforges (R):
  - **Off**: gear as captured.
  - **+10R6** (`classic`): projects to **+10 non-ascended** (main re-scaled via `projectMainToCeiling`,
    + substats max-rolled at **6 ticks**).
  - **+10R9** (`ascended10`): **exactly the same +10 ceiling as +10R6** but **9 ticks** — ascension (50 chips)
    gives the **+3 reforges** and unlocks +15, nothing else. **No passive**, main stat unchanged. The
    cost-effective tier: skip the expensive +10→+15 (chips at 90/80/70/60/40 %).
  - **+15R9** (`ascended`): projects to **+15 ascended** (overrides the real flag; **9 ticks**) **+ the
    unconditional singularity passive** (`addProjectedSingularity`: DMG+ 50 % weapon/accessory, DMG- 25 % armor
    — the table's best value). **Passive and the +11→+15 main steps = +15 only.** An already-ascended piece keeps
    its **real roll**. Never *downgrades* a piece already above the ceiling.
  **Each piece stops at its own ceiling** (`pieceReforgePlan`, min of the mode and the piece): only a **6★
  `unique`** ascends (`CItem.IsSingularityActivate`); a piece **under 6★, or a non-`unique` 6★**, stops at
  **+10**, at **its own number of reforges** (`maxReforgesOf`: the star under 6★, 6 for a 6★ — 9 only for a
  `unique` 6★ in an ascending mode), **with no passive**, whatever the mode. So a 5★ under +15R9 stays +10 R5.
  The mode labels are a `unique` 6★'s ceiling. Ticks: by the priority; **with no priority, by CP weight**
  (`reforgeTickWeights`, evaluated on the hero's equipped build) — returned with the context (`onResult`) and
  saved with the build, so the gear cards re-project the same ticks.

  The main re-scale starts from the table's +0 value (`rawBase`, set by the parser) and replays the game's
  float32 chain (`scaleMain`) — the same numbers as in-game (test `projectMainToCeiling`: 240 → 1380); a piece
  without `rawBase` falls back to the multiplier ratio.
- **Maxed only** (`onlyMaxed`, `setOption`) — **zero extrapolation**: each piece's ceiling in the reforge mode
  becomes its **investment floor** and the projection is **skipped** (pieces scored on their real rolls, gear
  cards included — the display context is snapshotted as `disable`). Floors (`maxedFloorOf`/`meetsMaxedFloor`,
  on `pieceReforgePlan`): Off → none (pieces as-is, whatever the level) · `unique` 6★: +10R6 → enhance ≥ 10 & ≥ 6
  reforges · +10R9 → ≥ 10 & ≥ 9 · +15R9 → +15 & ≥ 9 · a piece that doesn't ascend (under 6★, or a non-`unique`
  6★): +10 & its own budget (a 5★ +10 R5 is maxed), whatever the mode · a piece with no star (missing from the
  contract): the mode's floor, an unknown piece isn't maxed by default. "Or better" keeps its best rolls (a
  +15R9 piece in a +10R6 solve isn't brought back down to the +10 ceiling). Talisman: enhance only, +10 at most
  (its ceiling); the hero's EE is never filtered. (Replaces the old flat `enhanceLevel < 15` cut, blind to the
  mode.)
- **Transistone potential** (`rerollPotential`, `setOption`, **default off**, set in Settings › Solver —
  `gs.solver.rerollPotential`, off out of the box; the choice made for a hero stays with their filters) —
  projects the Transistone reroll potential (`lib/solver/reroll.ts`, rule read from the client at the top of the
  module): a 4-substat 6★ Legendary **with no tier-4 line** raises ONE line up to base tier 4 (+1 to +3 ticks,
  reforges kept, value capped at LV6); a piece that **already** has a tier-4 line gets no second one but raises a
  line up to tier 3 (4/4/3/2 → 4/4/3/3; 4/3/3/3 and 4/4/3/3 have nothing to gain). The line: the hero's
  highest-priority substat (never a negative priority), with no priority or on a tie the largest normalized
  value (`ROLL_NORMS`). Applied by `projectPieceForReforge` **before** the reforges, with or without a reforge
  mode, **never under Maxed only**; snapshotted in the display context and saved with the build, the gear cards
  mark the line (`T+n`, title "Transistone"). It's a ceiling: in-game tier 4 is a 5 % draw.

### Filter popovers (`BuilderToolbar.tsx`, `PopoverButton`)

Nine buttons on one line on the right of row 1 (an `ml-auto flex-wrap` group: in a window too narrow for it, it
drops below the hero, still flush right), in the bar's order: Stat filters, Ratings, Priority, Mains, Sets,
Weapons, Accessories, Talismans, +15 passives; the tenth, **Options**, opens row 2, ahead of Reforge (all at
`h-6`, 10.5 px text, like Reforge and the toggles of row 2). Talismans and +15 passives open their panel from
their right edge (`align="right"`) so it stays inside the toolbar's width; the other seven, and Options, from
their left edge (measured at 1280 px: Accessories, the rightmost of the seven, ends 68 px from the edge without
badges; Talismans opened from the left overflowed by 36). The group fits to the right of the hero from a window of
about 1350 px without badges (774 px of buttons); at 1280 px it drops below the hero. One popover
open at a time (outside click or Esc closes it); a button's badge counts the constraints it holds (Options:
those off the defaults, plus the heroes ticked in Don't take from…). Each popover is a `Panel` component
(`screens/builder/Panel.tsx`), described here in the manual's order.

#### Priority (`screens/builder/SubstatPriorityPanel.tsx`)
- A slider per stat (the 12 of `SOLVER_STATS`, `statColumns.ts`): integer value `-1..3`, action `setPriority`.
  Stored in `priority`, keyed by the registry's **engine names** (`critRate`, `critDmg`, `effRes`, `dmgReduce`,
  `critDmgReduce`… — `lib/statRegistry.ts`, the single source of the stat vocabulary); the old keys (`crc`,
  `chd`, `res`, `dmgRed`, `critDmgRed`) of blobs saved before the unification are rewritten on read
  (`LEGACY_STAT_KEY_RENAME`, `renameLegacyStatKeys`).
- **Top %** slider (`setTopPct`): `5..100`, **default 60** (field feedback: at 30 the true best build regularly
  sat just past the pruned slice — a ~16 M-combo budget at 60, a few seconds). Drives the phase 3 prune; `100` =
  exhaustive. With no priority it still bites in **both** modes: CP-weighted auto-prune in SOLVE CP (phase 3b),
  raw roll magnitude (`magnitudeScoreOf`) in SOLVE Score (phase 3c). Past `CARTESIAN_WARN` estimated
  combinations, an amber banner under the toolbar suggests lowering Top %, setting a priority or requiring a set.
- **(clear)** button: `clearPriority`. With no weight, a line points to the priority banner.

When priority is uniformly 0: the pool is **still pruned** (phases 3b/3c, same combo budget). Gems: in SOLVE CP
they **are re-allocated** by marginal CP contribution on the equipped build (`allocateGemsByCp` — cf. § Gems);
only SOLVE Score keeps the currently socketed gems (no re-allocation).

#### Sets (`screens/builder/SetsPanel.tsx`)
A **Require / Exclude** switch at the top of the panel (the panel's local state), over the same grid of armor-set
chips (`SetIconChip`, gated by feasibility: `has2pc` / `has4pc` / `canForm2pc` / `canForm4pc` computed from the
inventory; sets with no reachable 2pc / 4pc bonus aren't shown; tooltip name + (N owned) / 2pc desc / 4pc desc /
state).
- **Require** — edits the **active plan** of `setPlans`: a row of tabs "Plan 1", "Plan 2"…; a plan is an AND group
  (e.g. 2pc A + 2pc B), a build passes if **any** plan holds. Clicking a set = `cycleSetInPlan`
  (`nextPlanCount`):
  ```
  off → 2pc → 4pc → off
  ```
  per plan, skipping the steps the inventory can't form and those that would exceed the plan's 4 armor slots (the
  tooltip then says "plan full" instead of a click doing nothing). **+ OR** = `addPlan` (one more alternative,
  which becomes the active plan), a tab's ✕ = `removePlan` (when more than one is left). A "Match:" line sums up
  the whole constraint (`A ×2 + B ×2  OR  C ×4`); a plan over 4 pieces (arrived through a filter set or a reco)
  is flagged in red, it can never match.
- **Exclude** — a click = `toggleExcludedSet`: the global `excludedSets` list, orthogonal to the plans (an
  excluded set enters no build).

#### Mains (`screens/builder/AccessoryMainStatsPanel.tsx`)
Three rows (`MAIN_STAT_SLOTS`: Weapon / Accessory / Talisman). Each row shows the mains actually present in the
inventory for that slot (icon chips, the screen's `mainStatCatalogs`). A click cycles off → **allowed** (cyan,
`toggleMainPick`; OR-allow: a piece is dropped if none of its mains match) → **excluded** (rose, ✕,
`toggleMainExclude`: a piece carrying that main never enters the pool, tested before the acceptable ones) → off.
A main is never both (`toggleMainPick` / `toggleMainExclude` clear the other state). Use case: the Talisman,
whose mains are shared by the team and don't stack — exclude ATK when a teammate already wears one. The "Mains"
button counter counts allowed + excluded; the reco doesn't touch exclusions.

The other slots (helmet/armor/gloves/boots) don't appear: their main is fixed in-game.

#### Weapons, Accessories, Talismans (`screens/builder/EffectPanel.tsx`)
Three buttons, three panels (`EffectPanel`, parameterized by `group`: `weapon` / `accessory` / `talisman`) of
effect chips, filtered by the hero's class (gated by `classLimit`), keyed on the piece's `setId`. A click =
`cycleEffectPick` (`nextChipState`): `off → required → excluded → off`. Tooltip: name + (N owned) / T4 desc /
state. A chip's icon (`EffectIconChip`, `iconKind`): the effect icon for Weapons and Accessories
(`EffectEntry.icon`), the item's art for Talismans (`iconKind="item"`, `EffectEntry.image`: the art of the first
owned piece of that `setId`, `effectCatalogFromInventory`, served at `/img/equipment/<image>.webp`, on that piece's
rarity plate, `EffectEntry.rarity` → `raritySlotBg`, as the Gear tiles paint it); no image → the effect's initials. Each button's badge counts the picks of its group.
A talisman advised by **Load reco** (`Talisman` of `/api/reco`, `translateReco.ts`) arrives, with its whole
family (the talismans of the same `name` in `equipment.json`: the advice names the 6★, the 4★/5★ have their own
`setId`, `talismanFamilyKeys`), in the **`preferred`** state (dashed outline, `~` badge): if at least one piece
of the talisman pool — after every `allow()` filter — carries one of the preferred `setId`s, the pool is narrowed
to those; otherwise it stays open, as with no advice (never 0 builds because of a preferred talisman, unlike
`required`). Under "keep current", the worn talisman stays locked. A click turns it into `required`. The Load
reco status says when no member of the advised families is owned.

#### +15 passives (`screens/builder/PassivesPanel.tsx`)
Three groups, **Weapon**, **Accessory** and **Armor** (the four armor pieces): one text chip per Singularity
passive family the inventory carries on that group (`passiveCatalogFromInventory`, in the order of the 15
families of `singularity-options.json`, labelled by `singularityShortLabel`), plus any picked family no piece
carries any more; "no +15 passive" when a group has none. A click = `cyclePassivePick`: `off → required (grade C)
→ excluded → off`; a `required` chip carries the minimum grade picker on its right (`setPassiveMinGrade`):
`GradePicker` (`design/GradePicker.tsx`, `role="radiogroup"`), the five letters C B A S S+ in bold, each in the
color a piece's card shows it in (`singularityGradeColor`, the `<color=#…>` of the table's first option with that
grade, else the table's five constants), the chosen letter filled (`white/10` background, border in its color),
the others at 55 % and clickable. The same component serves Gear › Filter › +15 passive
(`aria-label="Minimum passive grade"`, disabled with no pill ticked). State `passivePicks` (per group, family →
`{ state, minGrade }`), handed as-is to the engine (`allow()`, above); the +15 passives button's badge counts these
picks (`passivePickCount`).

#### Stat filters (`screens/builder/StatFiltersPanel.tsx`)
Min/max per final stat (the 12 of `SOLVER_STATS`), action `setStatFilter`. Applied after compose, the combo is
rejected if a stat leaves the band. Empty inputs = no bound; min > max in red. A min bound also retains pieces at
the prune (`floorScorers`, phase 3) and is served by the gems before the priority (§ 5).

#### Ratings (`screens/builder/RatingFiltersPanel.tsx`)
Min/max on the derived ratings (`SOLVER_RATINGS`: Cp, HpS, Ehp, EhpS, Dmg, DmgS, Mcd, McdS, DmgH) + **Score** +
**Swaps** (key `upg`), action `setRatingFilter`. `cp` and `upg` are handled specially (applied in-loop when set,
cf. § 2 / phase 5) — not through the compiled `FilterSpec[]`, since they depend on the equipped loadout / an
expensive computation not available at compile time.

#### Options (`screens/builder/OptionsPanel.tsx`)
- **Equipped items** (`equippedScope`, action `setEquippedScope`, **default ≤ Lower**) — which pieces equipped on
  **other** heroes the solver may draw from. Default `lower`: only heroes ranked **strictly lower** (auto-ranked
  by CP on import, by App, without opening Heroes: `useRankDefaults`) → never strips an equal/higher hero.
  Without a ranking it degrades to own+free (`isLowerPriority` ∞>∞ = false). `None` = own + free, `All` = any
  equipped piece (the old default, silent stealing possible). The scope applies to the **effective owner** =
  worklist claim ?? `equippedBy`: a piece reserved by another hero's queued build counts as equipped on that hero
  (an applied/removed entry frees its claims — derived live by `worklistClaims`). The **gem pool**
  (`buildGemPool`) follows the same rule. The **in-game presets** add to it, whatever the scope (`presetHolds`,
  cf. Engine Reference §1.6): the pieces of a **locked** preset never come out, except for "Optimize preset →" on
  that preset; "Optimize preset →" doesn't take the pieces of a preset of equal or better rank. Pieces only: the
  gems of a locked or better-ranked preset's Talisman stay in the gem pool (a lock holds pieces, not gems; they
  change freely). The Optimizer says so in the Library ("Optimizing preset ‹name› (rank N) — …", lost on a hero
  switch) and the gear cards name the preset a piece comes from ("from preset ‹name›").
- **Keep current** (`keepCurrent`, `setOption`) — locks the already-equipped slots to their current piece (gems
  are still re-allocated).
- **Allow broken sets** (`allowBrokenSets`, `setOption`, default **true**) — *true*: a partial required set
  (e.g. a single `2pc`) lets any piece fill the free armor slots (legacy behavior). *false*: every armor piece
  must complete a set (2pc/4pc) → the solver also prunes set-less/non-formable pieces from the pool and rejects
  singleton builds at the leaf.
- **Min quality** (`minQuality`, `setMinQuality`, "Any" by default) — drops the pieces below a quality tier from
  the pool (the phase 2 gate); Talisman / EE, with no quality, are always kept.
- **Don't take from…** — a `HeroPicker` in `mode="multi"` (`design/HeroPicker.tsx`, the same picker as the hero
  one, with portraits, ↑/↓ + Enter to tick, "N selected") writes `excludedHeroes` through `toggleHeroExcluded` /
  `clearExcludedHeroes`.

#### reset filters
The link at the end of row 2 sends `resetAll` with `to: filterDefaults(defaultReforgeMode,
defaultRerollPotential)`: it **restores the defaults** — `INITIAL_FILTERS` with the default reforge mode and
Transistone of Settings › Solver — and doesn't empty the reducer (Top % back to 60, Equipped items to ≤ Lower,
Allow broken sets to true). The "Never use" pieces (`excludedPieceUids`, global) and the preset locks aren't
filters: it leaves them alone.

### Results table (`screens/builder/ResultsTable.tsx`)
Red-green heatmap per column (min/max relative to the current result set, `computeColumnRanges`; turned off by
Settings › Display, `gs.builder.heatmap`). Columns: sets (`wpn` / `acc` effects), the stats, ratings
(`TABLE_RATINGS`), **Score**, **Swaps** (key `upg` = the number of slots that change vs the current loadout — not
upgrades to do; sortable + filterable), **to do** (G116, key `todo`, sortable, hidden with reforge `Off`: the gear
pieces — talisman and EE apart — still to enhance, reforge or ascend to reach the build, `buildTodoOf` of
`screens/builder/buildTodo.ts` over `pieceReforgePlan` in the **solve's** mode; a piece counts when
`enhanceLevel < ceiling.enhanceLevel`, `reforgeCount < budget` or, not `ascended`, when its plan goes through the
ascension — `ceiling.ascended` or `budget > maxReforgesOf(piece, false, rules)` (G121: in +10R9 the ceiling keeps
`ascended: false`, but a 6★ `unique`'s 3 reforges past R6 take the ascension bonus, so it's listed too; a piece
that can't ascend never is); tooltip "3 pieces — 2 to enhance (+10 → +15), 5 reforges, 1 to ascend", 0 = reached
as is). The **DMG UP%** and **DMG RED%** cells of a
build where a piece carries a counted requested passive (above) carry a cyan "+15" exponent, tooltip
"+120% DS DMG+ (A) · …" (`countedPassivesOfBuild` over the **solve's** `passivePicks`, kept in the results' and the
saved builds' `ReforgeContext`). Sort by clicking the header (null → desc → asc → null). **columns** menu
(show/hide columns, persisted `gs.builder.cols`, controlled `ColumnsMenu`) opened by the table bar's button **or
by right-clicking any header** (`onContextMenu` on the header `<tr>`). The **height** slider of the same bar sets
`resultRows` (5 to 15 rows, `gs.builder.resultRows`, the value of Settings › Display › Result rows); the table is
virtualized and scrolls past it. **Right-clicking a cell** of a stat, a rating or CP → a "Min ≥ v" / "Max ≤ v"
menu (v as displayed): sets the bound (`setStatFilter` / `setRatingFilter`, the other bound kept), which the
popovers show, and re-runs the solve in the last solve's mode (`CellMenu`, `onThreshold`). No threshold on
score, swaps, effects. **Pin for compare** (G128): the same menu, opened from any cell of a row (the `<tr>`'s
`onContextMenu`, skipped when a value cell already handled the event), carries a "Pin for compare" entry
(`menuitemcheckbox`; on the pinned row "📌 Unpin compare"); the pinned row shows a 📌 in its first cell while it
survives the table's filters. The pin lives in `BuilderScreen` (`pin`, a `SolveBuild` ref plus the `solveResults`
array it came from: a new solve brings a new array and drops it), session only. **Compare** panel
(`screens/builder/ComparePanel.tsx`) above the piece cards, in their scroll area: the pinned build (left) vs the
selected row, or the current loadout ("vs loadout" toggle, forced when no row is selected or on the pinned row
itself — the loadout's stats are `composition.current` as captured, its ratings `computeCheapRatings` with the
hero's damage profile, its score `computeScore` in the solve's priority, its CP `currentCp`). Logic in
`lib/solver/compareBuilds.ts`: `compareBuilds(a, b, pieceByUid)` → per axis (`SOLVER_STATS`, crit on its raw
sum; `TABLE_RATINGS` but CP; score; CP) both values and `b − a` (null when a side is unknown), and per slot (engine
order) both pieces, `differs` by uid (an empty slot on one side differs). Each side shows its eight slots in
`GAME_GEAR_GRID` (two rows of four `SlotMini` tiles, 48 px, 36 px under Compact result cards), the differing ones
outlined in amber, the others dimmed; the header line reads "N pieces differ, M swaps vs loadout" (M = the
right-hand build's live swaps, `diffBuildVsLoadout`; the pinned one's against the loadout). × closes and unpins.
**Crit past 100**: the CHC cell shows the sheet's value ("100%") followed by an amber "+42"
exponent (`critCellParts`: `critRateUncapped − critRate`, `round1`), tooltip "Crit rate 142% raw — capped at 100%
in-game, 40% wasted over the 102% tolerance" (rule `overcapOf`; between 100 and 102, "within the 2% buffer"); the
column's heatmap and sort read the raw sum (`critRawOf`), which the header tooltip says (`statHeaderTooltip`);
the threshold menu keeps the sheet's value. Clicking a row → the selected build (the first row is selected after
a solve). `solving…` / error / **explicit empty state** (an `emptyReason` derived from `poolSizes` lists the
slots that dropped to 0 pieces after filtering, EE excepted: a hero without an EE solves without it; a slot
emptied (also) by an excluded main says so, "(N dropped: main stat excluded)", by the +15 passive filter too,
"(N dropped: +15 passive filter)"; a client "Filter" that keeps no
build shows "No build passes the current filter."; no empty slot but "Allow broken sets" off rejected every armor
loadout (the orchestrator's `"brokenSets"` cause) → the table says so and offers to turn it back on or raise
Top %).

### Right column (`StatsPanel.tsx`, `BuildEffectsPanel.tsx`, `SubValuePanel.tsx`, `DmgPer1PctPanel.tsx`, `RightSidebar.tsx`)
Full height, next to the table and the cards, in this order:
- **Current → Projected** (`screens/builder/StatsPanel.tsx`) — `FinalStats` and CP of the hero's current loadout
  (left column) vs the selected build's (right column, em-dash until a row is clicked). Read-only. The projected
  column carries a **signed numeric Δ** per axis (`proj − current`, rounded) on top of the green/red tint — the
  "by how much", not just the direction. The crit row reads the raw sum (`critRawOf` = `critRateUncapped ??
  critRate`, `screens/builder/critCell.ts`) for the Δ and the tint, and past the 100 bound shows "100% ⁺42"
  (amber exponent, `critCellParts`) on both sides, with the raw value and the waste in the tooltip
  (`critCellTitle`, see **Overcap** below).
- **Effects** (`screens/builder/BuildEffectsPanel.tsx`) — the selected build's weapon / accessory passives and
  set bonuses, taken off the piece cards.
- **Sub tick value** and **Damage / +1%** — two read-only help boxes, recomputed on hero / level / awakening
  change:
  - **Sub tick value** (`SubValuePanel.tsx`, `lib/subValue.ts`) — for ATK/DEF/HP, the value of a 6★ sub tick as
    **flat** vs as **%** (≈ flat equivalent), the winner in cyan. A % tick scales on `base+evo+awak`
    (gear-independent — gear flat is added after the ×%, the `(1+buffRate)` cancels out) → the verdict depends only
    on the hero's base. Per-tick values from `sub-ticks.json` (derived from outerpedia's `subStatPools`).
  - **Damage / +1%** (`DmgPer1PctPanel.tsx`, `lib/dmgValue.ts`) — expected damage gain for **+1%** of each
    relevant stat: the hero's scaling stat(s) (ATK/DEF/HP/**SPD** via `dmgStat` + secondary `dmgSec`, SPD/EFF/CHC
    included) vs **CHD** vs **DMG inc**, ranked, best in cyan. **Computed at 100% crit** (crit cap = endgame
    baseline). Reuses `computeCheapRatings` (RE 1.4.9 damage model). **No-crit** heroes (`noCrit`, e.g.
    2000086/2000091/2000008) force `critRate = 0` and hide CHD.
- **Library** (`screens/builder/RightSidebar.tsx`, localStorage, per hero):
  - **Load reco** — the hero's outerpedia reco (`fetchRecoForHero`, `/api/reco`) translated into a filter patch
    (`translateReco.ts`: mains, sets, effects, priority) and merged by `mergePreset`; several builds →
    `RecoBuildPicker`; the status line gives the outcome (nothing for this hero, network failure, warnings).
  - **Save build + filter set** — a `PromptDialog` for the name, then bookmarks the selected build
    (`lib/storage/savedBuilds.ts`; it carries its reforge context to re-project its substats on restore) **and**
    the filter set that produced it under the same name (`lib/storage/filterPresets.ts`).
  - **Save as local preset…** — an inline field (12 characters, `LOCAL_PRESET_NAME_MAX`): the build's 7 pieces,
    without the EE, become a local preset (`lib/storage/localPresets.ts`), the hero as reference.
  - The "Optimize preset →" status line (`presetStatus`: "Optimizing preset ‹name› (rank N) — pieces of
    higher-ranked and locked presets excluded").
  - **Saved builds** — a click = `restoreBuild` (the build comes back in the table and on the cards); ✕ deletes it.
  - **Filter sets** — a click = `loadPreset` of the named set; ✕ deletes it.

### Selected build (`BuilderScreen.tsx`, `EquipBuildButton.tsx`)
The line above the cards: "Selected build" (or "No build selected"), **N slots change** and **ΔCP**, then two
actions.
- **N slots change** is read off the current inventory (`buildDiff`, `diffBuildVsLoadout` of `lib/buildDiff.ts`),
  not off the solve's `upg`: after Apply to snapshot it drops to 0. The Swaps column (cell and sort) and the `upg`
  of the "+ Worklist" entry read the same live diff.
- **ΔCP ±X** (`build.cp − currentCp`, `currentCp` = `calcBattlePower` of the equipped loadout, computed in
  `composition`). The build is counted in the results' reforge mode, the equipped gear as it is: outside `Off` the
  label names the base (`ΔCP +X vs equipped (build at +10R6)`, one-sentence tooltip — `deltaCpLabel`,
  `lib/deltaCp.ts`), since a build identical to the loadout shows a positive ΔCP there.
- **+ Worklist** — pushes the **per-slot diff** (changed slots only) **and the gems to socket** on the build's
  Talisman / EE (`gemAllocation` vs the build piece's `gemSlots`, `lib/worklist/changes.ts`) to the **Worklist**
  tab (`screens/WorklistScreen.tsx`, storage `lib/storage/worklist.ts`): a cross-hero queue, **one entry per hero**
  (a new build **replaces** the hero's entry, `upsertWorklistEntry`; the button then reads "Replace in worklist"),
  where each change is a checkable line + an **Apply to snapshot** (same `equipPieces`; gems aren't socketed by the
  app, they're socketed in-game). *applied / stale / conflict* states **derived live** from the inventory (nothing
  frozen: the piece's name and main read from the current snapshot, `worklistTarget`, the stored `toName` /
  `toMain` being only a fallback for a vanished piece; a *stale* line — a piece eaten, sold or dissolved in-game —
  says "piece gone" in amber, counts neither in the badge nor in the reservations, and a toast says so on the
  snapshot that loses it; a gem line is *applied* once its piece is on the hero and holds enough copies of the gem,
  whatever the socket — `toCount`, set when queued: copies the build keeps + the line's rank among those of that
  id, the game socketing into the first free slot); **auto-prune on every recapture** and on every move followed
  in-game (`reconcileWorklist` removes done changes + emptied entries, a toast says so). Disabled when nothing
  changes (neither piece nor gem).
- **Apply to snapshot** (`screens/builder/EquipBuildButton.tsx`) — applies the pieces to the hero by rewriting
  the captured snapshot (`equipPieces`, an "Apply this build to the snapshot?" confirmation that counts the pieces
  moved and those taken off another hero, never a write to the game); greyed out ahead, the reason as its `title`,
  while the plugin runs in the game (`applyBlockedReason`, `equip.ts`), the 409 refusal staying the safety net.
  After success, App re-imports ("Applied to snapshot").

Equip / Unequip **to the game** remain absent (they'd need a game API that doesn't exist). The **Optimize →**
button lives on the Heroes tab (opens the Optimizer on the hero); **Optimize preset →** (Presets tab) adds a
filter patch (`initialPatch`, see the Presets tab). The same links lead back to the Optimizer from the Worklist
(a card's hero portrait and name, a line's "on ‹hero›" = the piece's current wearer) and from Gear's piece card
(the wearer's portrait, "Optimize wearer →"): `optimizeHero` in `App.tsx`, no patch. A Worklist line's "in Gear"
opens Gear on the piece (`InventoryDrill.pieceUid`). The Worklist states what it reserves at the top of the list
(`RESERVATION_NOTE`, the `worklistClaims` behavior above).

### Piece cards (`screens/builder/BottomGearBand.tsx`, `design/GearCard.tsx`)
8 cards — one per slot, in the game's equipment-screen order (`GAME_GEAR_GRID`, shared with Heroes and Presets):
a fluid grid (`repeat(auto-fit, minmax(…, 1fr))`) of four columns at most, 4 × 2 Weapon | EE | Helmet | Armor /
Accessory | Talisman | Gloves | Boots when the band allows it, each column at least 320 px wide (and at least a
quarter of the band less its three 8 px gutters), each card as wide as its column (`GearCardPanel`'s `fluid`:
`w-full`); narrower, the same order wraps. Outside the band (Gear › Pieces, tooltips, presets) the card keeps its
fixed width (`w-80`, `w-56` compact). The name runs on two lines at most (`line-clamp-2`) and the slot and the
class ("Striker Exclusive") are two `span`s that wrap under each other rather than under the wearer's portrait.
Each card shows name (with **Never use** at the
top right of its row), enhance level, slot icon, then beside the icon the rarity / slot line and the main stat(s)
(12 px, a long name cut with its `title`, so a weapon's two mains fit the icon's height), subs (with ticks). It's Gear's piece card (`design/GearCard.tsx`: `GearCardPanel` around
`GearCardBody`, `effects="none"`): same rarity / slot line, same Quality block (title, hover help, bar), same
"Active Effect at +15 Enhancement"; the weapon / accessory passive and the set bonuses aren't there (the right
column's "Effects" panel shows them), the EE shows only its image and gems, and the projection marks its ticks
(`+n` cyan, `T+n` violet) on a substat column as wide as Gear's. An empty card says "No weapon in this build" (or
"No weapon yet" before any selection, "Solve, then pick a build in the table."). On top:
- **Compact mode** (Settings › Display › Compact result cards, `gs.builder.compactCards`, off by default):
  columns at least 224 px wide, the EE and the talisman in ONE card
  (`ResultPairDetail`: EE on top, talisman below, a rule between them, each with its own exclude action), so seven
  cells as 4 + 3 in the `COMPACT_GEAR_GRID` order (Weapon | EE + Talisman | Helmet | Armor / Accessory | Gloves |
  Boots), each card at its own content height (no stretching to the row's tallest); no piece icon; header =
  `compactName` ("EE", the set name for an armor piece, the piece name otherwise, without "- [Singularity]" but with
  the gradient, on two lines when the column is narrow), with on its right two right-aligned lines: the stars and
  the breakthrough (`6★ | T2`, `6★` alone without breakthrough) then the enhance (`+15`);
  main(s) as icon + value on one line; subs in a 2 × 2 grid, icon + value only (LV, base + reforges and the
  Transistone mark in the `title`; value in cyan when projected ticks enter it, violet when it's the Transistone,
  amber at the cap); gems as one row of five icons (detail in the `title`); quality on one line (`14/20 →17 Exc.`);
  Singularity effects on one line (icon + signed value; the +15 bonus as colored grade + icon + short label +
  value, `S+ DS DMG+ +12%`, through `singularityShortLabel` / `singularityGrade`; or short name); the talisman's
  multi-tier passive not rendered, its text (visible tiers, active first, separated by "·") in the name's
  `title`; the exclude / include icon (`CardActions`) at the top right, after the portrait (`headerAction`), one per
half in the pair card, no footer. Gear and the tooltips (the
  same `GearCardBody`, never compact) don't change.
- **Talisman / EE**: the build's recommended gem allocation (stat + value, **swap** badge if it differs from the
  socketed gems).
- **Projected stats**: if the Reforge mode ≠ Off, the main + subs shown are the projection
  (`projectPieceForReforge` re-simulated on the main thread) + a **+10R6** / **+10R9** / **+15R9** badge. The card
  also shows the projected enhance since the projected piece carries its target `enhanceLevel`/`ascended`, the
  projected **singularity passive** (**+15R9 only**), and a cyan **`+N`** badge per sub with the reforge ticks the
  projection added (delta vs the captured piece).
- **Equip state**: a badge per card — 🟠 portrait + name if the piece is equipped on **another hero** (applying
  takes it off them), 🟢 `equipped` if already on the current hero, `free` otherwise; "from preset ‹name›" when
  another in-game preset holds it (`presetHoldersOf`, best-ranked first).
- **Per-slot diff**: a card whose piece **differs from the equipped loadout** (same definition as `upg`) gets a
  **cyan border** + a `← <replaced piece>` line (or `+ new slot` if the slot was empty). Proposed piece, worn piece
  and "slot changed" come from a single function, `diffBuildVsLoadout` (`lib/buildDiff.ts`), which Apply to
  snapshot and + Worklist read too.
- **Never use** (`onToggleExclude` → App's `toggleExclude`, `gs.solver.excludedPieces`) — keeps the piece out of
  every solve, like a right-click on its tile in Gear; not a reducer action. A small ⊘ button at the card's top
  right, in the name's row (`GearCardBody`'s `headerAction`, given by `GearCardPanel`), rose and pressed once
  excluded ("Never used — click to allow"); the card has no footer in the Optimizer (Gear's keeps "Optimize
  wearer →").
- **"Why this piece?"** (`lib/solver/pieceDelta.ts`, `screens/builder/PieceDeltaTooltip.tsx`): hovering a card (or
  one half of the compact pair card), after 400 ms, or keyboard focus on the card, opens a `HoverCard` (`delayMs`,
  no `?` cursor) explaining what the build's piece brings **over the piece worn** in that slot (`SlotDiff.worn`).
  `pieceDelta(candidate, worn | null, priority, ctx)` values each piece ALONE on the hero's sheet
  (`computeFinalStats(noGearStats, scaling, [piece])` minus the gearless sheet, `SelectedComposition.sheet`) on
  every axis of `FINAL_STAT_KEYS` (= `SOLVER_STATS`, same order): a % counts in final-stat units, as the composer
  folds it. Both pieces are projected as the solve scored them (`projectPieceForReforge`, same mode, ticks and
  Transistone), the candidate Talisman / EE with the build's gem allocation (`gemAllocationOverride`; the worn one
  with its socketed gems; an empty allocation = its own gems, the engine's fallback). The delta is weighted by
  `computeScore` itself (one axis at a time: Δ / `STAT_NORMS` × weight × 100), in the solve's priority
  (`resultsReforge.priority`). The sheet being linear in the gear buckets, the sum equals the difference of the
  `computeScore` of the two builds that differ only by this slot, up to the composer's truncations (±1 per
  compound axis) and outside the 100 % caps of CHC / PEN (the test checks it). Set bonuses aren't counted (they
  depend on the other pieces): a "Set bonus: see the Effects panel" line when the piece changes the slot's
  `armorSetId`. Render: a lead sentence ("+12.4 score vs the worn piece", "vs the empty slot" on an empty slot,
  "−3.1 score — kept for its set / effect" in amber when the total is negative: the solver took it for a set, a
  required effect, a main stat; "No stat is weighted in this solve's priority." without a priority), a "Stat ·
  Worn → this · Δ · Weight · Δ×w" table of the weighted stats either piece carries only, the others folded into
  "+N stats not weighted", the total in bold. Same piece as the worn one → "Already equipped — the build keeps
  this piece.". Compact and full size: the same hover.

### Pinned footer (`screens/builder/FilterFooter.tsx`)
- Per-slot chips with **hit/total (%)** — fed by `poolSizes` of the precompute (`precomputeContext`, main thread).
- **P**: total permutations explored (sum across workers).
- **S**: permutations that passed every filter (scored).
- **Results**: size of the returned top-N (or of what the client Filter keeps).
- A `solving…` indicator (cyan, animated) during a run; once done, the last solve's **⏱ duration** (wall-clock of
  the whole `solve()`, precompute included, `< 1 s` in ms otherwise in s) — the orchestrator reports `durationMs`
  through `onResult`. A glance at the solver's speed.
- **⚙ N workers**: the resolved search pool size (Settings › Solver › Worker threads).
- **Copy Debug Info**: only with Settings › Advanced › Solver fan-out logging (`gs.debug.solver`) — copies the
  last solve's diagnostic (precompute vs search, pool sizes, P/S, top vs current CP) as JSON.

### Presets tab
A tab between Optimizer and Worklist (`screens/presets/PresetsScreen.tsx`), one card per in-game equipment
preset (`Inventory.presets`, up to 30): number, name, favorite ★, the 7 pieces (weapon, accessory, helmet,
armor, gloves, boots, talisman — the EE is **never** part of it, the EE slot of `ItemUIDList` is skipped)
with the inventory's tile and hover detail, and the **current wearers**: heroes whose gear, EE aside, is
exactly the preset (`presetSignature`, the same rule as the preset name on the Heroes cards). The model is
pure and tested (`lib/presets/presetRows.ts` → `presetRows(inventory)`): a piece missing from the inventory
(slot taken from its wire position) and a piece held by **two** presets ("shared with <preset>" — two
presets may play the same fight) are flagged on the tile and in a banner. An empty preset is listed
collapsed.

**Layout.** The pieces follow the 4 × 2 grid of the game's equipment screen (`GAME_GEAR_GRID` from `design/tokens.ts`, in engine slots):
Weapon, EE, Helmet, Armor / Accessory, Talisman, Gloves, Boots; `PRESET_SLOTS` keeps its 7 slots (signature,
worklist, tests), only the display grid changes, and a piece of unknown slot follows the grid. The EE cell
shows the EE the card's reference hero wears today (`referenceUid`, or the proposed unique wearer, `eeOf`),
dimmed, tooltip "EE isn't part of a preset — each hero keeps their own"; without a reference (or an EE), an
empty dashed cell. Under each tile, the icon and value of the main that tells something for its slot
(`presetTileMain`, `lib/presets/presetQuality.ts`): on the weapon the first main that isn't the flat ATK
every weapon carries (nothing otherwise), on the accessory and the talisman their first main, nothing on
helmet, armor, gloves, boots and EE; hovering lists every main, and the set name stays under the armor
pieces. Between the grid and the hero lines, a column of three lines: **Quality** `X / 138`, the
rolled ticks of the six pieces weapon, accessory, helmet, armor, gloves, boots (`gearPieceQuality`) against a
fixed 6 × 23 cap (ascended + fully reforged), the cap for the current investment in the tooltip;
**Offensive** `S / A`, the +15 (Singularity) roll grades of the weapon and accessory (`singularityGrade`);
**Defensive** `A / B / C / S`, those of helmet, armor, gloves, boots — by slot, a "–" for a piece that isn't
ascended or is absent, each letter in the game's color. Past 1280 px (`xl`), an open card goes into columns: the grid on the left (fixed width), the
quality column, then the Reference / Associated lines on the right; below that, stacked in that order. A hero line's metrics have a minimum width
(aligned from one line to the next) and spread over the room available. The Worklist tab has no maximum
width anymore: the transaction header full width, then the cards on a two-column grid past 1280 px, each at
its own height.

**Order, class filter and sort.** The cards follow the in-game preset editor's order: `comparePresets`
(core, `parse.ts`) mirrors the client's `CEquipPresetData.SortPreset` — type ascending (Master League
presets after the others), favorites first, then the player's order (`Preset.sortOrder`, read from
`PresetOrderList` by `Num`, 0 without an entry) descending, then `num`. The `#num` stays on the card. The
top bar carries the five class chips (`CLASSES` from `lib/gear/overviewStats.ts`, multi-select), a
"Sort: In-game · Class · Rank" selector and "Clear". A preset's class (`presetClasses`) comes from its pieces (a
weapon or accessory restricted to a class, `GearPiece.classLimit`; two different classes are both kept),
else from the reference hero, the wearers, then the associated heroes; otherwise it is unknown. A filter
keeps a card with one of its classes ticked and hides empty or unknown-class cards; "Class" sorts by the
card's first class in chip order (only the ticked ones while filtering), unknown last, the game's order
within a class (`arrangePresets`). The class icon shows next to the name; the pill adds "· K shown" when
cards are hidden. The chips, the sort, the last "Expand all / Collapse all" and each card's open state are
view state: kept across a tab switch (sessionStorage, `gs.presets.classFilter`, `gs.presets.sort`,
`gs.presets.forced`, `gs.presets.open`), not across a relaunch.

**Rank and lock.** Each in-game preset has a **rank** (`gs.presets.rank`, `lib/storage/presetPriority.ts`, a
positional 1..N model like the heroes': `RankInput` + the ⠿ handle under "Sort: Rank", `reorderRank` /
`moveRankBefore`) and a **Lock** / 🔒 **Locked** button (`gs.presets.locked`, `toggleLocked`, amber outline). The
default ranks are no longer set when the screen mounts: App sets them **on every import**
(`hooks/useRankDefaults.ts` → `rankDefaults` of `lib/storage/rankDefaults.ts`, in the game's order, below the
ranks already set; a preset whose rank was cleared stays unranked), as for the heroes — so the Optimizer reads
ranked presets without the tab ever being opened. The solver reads them through `presetHolds`
(`lib/presets/presetHolds.ts`, cf. § 4, Options popover): "Optimize preset →" takes no piece from a preset of
equal or better rank, and a locked preset's pieces come out in no solve but its own. **The lock holds pieces,
never gems**: neither the Optimizer's gem pool nor the EE gems proposed here take it into account (see below).

**Local presets.** Under the in-game presets, a "Local presets" section (`lib/storage/localPresets.ts`): a name
(12 characters, the game's limit) + 7 pieces, no EE, made by the Optimizer's "Save as local preset…" or an in-game
card's "Copy as local preset". Same card with a **Local** badge, the reference hero's line (score, Optimize →); no
rank, lock, associated heroes, Worklist nor "Optimize preset →"; **Rename** in place, **Delete** in two clicks
("Delete?"). They hold no piece away from a solve.

A preset = the loadout of **one reference hero**, worn as-is by **associated heroes** who tune themselves
through their own EE gems. Groups are made by hand (hero picker; a unique current wearer is proposed as the
reference), stored app-local in `gs.presetHeroes` (`lib/storage/presetHeroes.ts`, per preset number
`{ referenceUid, associatedUids }`, a uid that left the roster ignored on read; the blob is part of the backup
export / import, a preset that already has heroes here keeping its own). For the reference and each
associated hero, `evaluatePresetFor` (`lib/presets/evaluate.ts`) composes the hero with the preset's pieces
+ **their own** current EE through `computeFinalStats`, then `computeCheapRatings` (the hero's skill
factors) and `computeScore` with their priority; the card shows Score, Dmg and DmgS, each with its tooltip
(the final stats weighted by the Optimizer priority; the strongest hit vs DEF 2000, crit and PEN included;
Dmg × SPD at the rotation's average factor). On an in-game preset's card the reference's line shows the
portrait only: the name is already in the Reference picker right above (a local preset's card, without a
picker, keeps it).

**EE gems per hero.** The Talisman and its gems are part of the preset (shared, never tuned per hero); what
each hero tunes is the gems of **their own** EE. `bestEeGemsFor` (`lib/presets/eeGems.ts`) picks them like
the engine does, pieces fixed: `buildGemPool` restricted to the gems of the hero's EE and those of the
Talismans / EEs nobody wears (never the preset's pieces, even free, nor a piece another hero wears, nor a
free piece the Worklist reserves for another hero — `worklistClaims`, the same value as the Optimizer and
Heroes —, nor the hero's own Talisman, which comes off when the preset goes on; another preset's lock or
rank plays no part, as in the Optimizer: the gems of a locked preset's free Talisman are on offer), `scoreGemPool` with the hero's priority
(fillers by `dmg` gain on the preset, `gemDmgGains`), `allocateGemsCapped` on the EE's slots alone
(`gemSlotsOf`, CHC without the EE gems for the cap). A gem already socketed keeps its socket
(`alignToSockets`, the fewest Worklist lines) and a socket the pick leaves empty keeps its gem (the game
never removes one by itself). No proposal (null) without a priority, an EE or a gem, or when the pick scores
no higher than the gems as socketed. `evaluatePresetFor(…, eeGems)` then composes the EE with those gems
through the composer's `gemOverride` (`eeGemOverride`: it skips the subs of both gem-bearing pieces, the
Talisman's are put back in); the line shows "EE gems: <list>", the score and the loss **with** those gems,
and in brackets the score as socketed when it differs.

**+ Worklist**, on the reference's line and each associated hero's: the hero's entry (`presetWorklistFor`,
`lib/presets/presetWorklist.ts`) = the preset's pieces they don't wear (`diffBuildVsLoadout`, the Optimizer's
rule) + the gem lines of their EE (`worklistChangesFor`, `gemAllocation = { talisman: [], ee }`),
`mode: "preset"` ("Preset" on the Worklist card, no CP); `upsertWorklistEntry` replaces the hero's entry,
toast "Added to / Replaced in worklist — <Name>". A piece missing from the inventory is left out, and the
toast says so. The button is greyed out when there is nothing to change. **Optimize →**, next to it on an
associated hero's line: opens the Optimizer on the hero, like a Heroes card.

**Optimize preset →**, on the reference's line: opens the Optimizer on the hero with a filter patch
(`presetOptimizePatch`, `lib/presets/optimize.ts`, pure) overlaid on their remembered filters by
`mergePreset` (bands and options kept). Effects: the `setId` of the preset's weapon, accessory and
talisman, `required` (the talisman widened to its family by `talismanFamilyKeys`, every key `required` —
the same effects, not "preferred"); a piece missing from the preset or without a `setId` → slot left open,
a note. Substats: at most 5 priority keys, weight = max(reco, preset) — the reco (`fetchRecoForHero`,
first build, `SubstatPrio` as 3/2/1 like "Load reco"), the preset by the number of pieces (talisman and EE
aside) rolling the key as a substat (4+ → 3, 3 → 2, 2 → 1); ordered by weight, then presence in the reco,
then piece count; other keys left out of the patch. Mains: the reco's for the weapon and accessory. Sets: no
plan (`setPlans: []` → one empty plan, sets open; "Load reco" remains the way to the full reco). Without
a reco (404, error, offline): the preset alone. The Optimizer receives the patch with `initialHeroUid`
(`initialPatch`) and merges it once the hero's filters are loaded — never onto the outgoing hero's; the
status line (`presetOptimizeNote`) names the preset, says the same weapon / accessory / talisman effects are
required and gives the number of priority substats and their source — the preset's pieces plus the named
outerpedia reco build, or the pieces alone —, then the notes.

**Priority.** `priorityOf` (`lib/heroPriority/weights.ts`, the same source as the Optimizer) reads, in order,
the priority the Optimizer keeps for the hero (`gs.solver.heroFilters`, localStorage, written at every change
and read live from App: a weight changed in the Optimizer counts at the next render), then `reforge.priority`
of the hero's most recent saved build, then nothing; a priority without any weight falls through to the next
source (`hasPriority`, the one "at least one non-zero weight" predicate). The line says "priority from saved
build" in the second case. A hero with no saved build and no priority in the Optimizer has no score. An associated hero is compared to their **best known build** (`bestKnownFor`:
their most recent saved build, re-scored with the **current** priority, else their loadout), **in real
rolls on both sides**: the saved build is recomposed from its pieces (`build.pieceUids`) as captured today
(actual rolls and enhance — never its stored `finalStats`, projected to +10R6 / +15R9 / Transistone by the
solve), with the gems it allocated on the Talisman and the EE (`gemAllocationOverride`; an allocation without
a gem keeps the socketed gems, as the solve did); if one of its pieces left the inventory (sold, dissolved),
it no longer counts and the comparison is against their loadout ("vs loadout"):
`loss = 1 − score(preset) / score(best)`, shown in % "vs saved build" / "vs loadout"; past the
threshold (15 % by default, set by the stepper at the top of the Presets screen,
`gs.solver.presetLossWarn`) the line turns orange with
"<Name> loses 23 % vs their saved build". Without a priority: "no priority set for <Name> — set one in the
Optimizer", no score. Nothing is written to the game.

**Overcap.** The sheet bounds `critRate` at 100 (`computeFinalStats`) and keeps the raw sum in
`critRateUncapped`; `pen` isn't bounded. The wasted-cap rule lives in `lib/overcap.ts` (pure, shared with
`buildAdvice`'s rule 4 and the Optimizer's crit tooltip, `critCellTitle`): `overcapOf(finalStats)` → `{ key, label, value, cap, waste }` per axis over its cap —
crit read on `critRateUncapped ?? critRate` against 102 (a buffer against crit resistance), penetration
against 100, `waste = round1(value − cap)` kept when > 0; `overcapText` writes "Crit rate 142% — 40% wasted
over the 102% cap". `presetOvercap(evalPreset, asSocketed)` (`lib/presets/evaluate.ts`) applies it to the
displayed evaluation (proposed EE gems), on the reference as on the associated heroes: one badge per axis,
orange with the line in the warning tone (the loss's) from `OVERCAP_WARN_PTS = 10` points wasted (a
constant, not a setting), amber alone below; when the overflow is larger than with the gems as socketed, the
badge's tooltip says it comes from the proposed EE gems.

---

## 5. Gems — greedy sub-solver

**Pool**: multiset of the non-null `gemSlots[]` of the **eligible** Talismans + EE in the inventory (gems are swappable in-game). Eligibility (`buildGemPool`) mirrors the piece-pool rule: the current hero's gear is always in; gear equipped on another hero is gated by `equippedScope` (`none`/`lower`/`all`); gear on an excluded hero is never counted. The in-game presets play no part: the gems of a locked or better-ranked preset's Talisman stay in the pool (a lock holds pieces, not gems). Without this gate, the solver would propose gems that require unequipping the Talisman/EE of an out-of-scope hero.

**Scoring**: for each gem, `score = priority × (value / ROLL_NORMS)`. Normalized to allow cross-stat comparison. Sorted desc. **In SOLVE CP without a user priority**, the "priority" passed is not empty but the **CP weights** (`cpStatWeights`: ΔCP of a ROLL_NORM-sized bump of each stat, evaluated at the current build). Otherwise (raw `value/norm` ranking), the allocator preferred dmg-reduce/flat gems (big magnitude, ~0 CP) over atk/crit/pen gems → a CP solve could return **less** CP than the equipped build. A stat already at its CP cap (e.g. CRC ~100%) gets a ~0 weight. These weights are linear (one bump per stat, ATK% weighed on a flat ATK bump): they order the pool, but the SOLVE CP allocation itself goes by marginal CP (below).

**Allocation (default, fast path)**: greedy, K = `talismanSlots + eeSlots` (4 or 5 depending on `enhanceLevel`). We take the K first gems with `score > 0`, then, if slots are left, the **filler gems**. A single allocator, `allocateGems`, returns the displayed split **and** the composed delta. Pre-computed **once per talismanSlots variant** (4 or 5) in `prepareContext` — no re-computation in the hot loop.

**SOLVE CP without a priority — by marginal CP** (`allocateGemsByCp`): CP is not linear in the stats (ATK compounds, CHC caps at 100%), so the CP-weight order got it wrong (five DMG-reduce gems, 34,643 CP, vs 3 ATK% + 2 DMG-reduce, 35,044, on Ame). The gems are placed one at a time: each slot takes the gem that raises most the CP of the **equipped build** (the reference composition of `cpStatWeights`) with the gems already placed — re-weighed after each gem, crit cap included. Candidates: those of `pickOrder` (no negative priority, no filler under a `max`); copies of one id are weighed once per step; a tie keeps the `pickOrder` one. A gem that adds no CP is placed only once the useful gems are exhausted, in `pickOrder`. Cost: (slots × distinct ids) composes, once per variant per solve — not per combo. An explicit priority in SOLVE CP keeps the priority allocation.

**Filling by the hero's useful stat**: with a partial priority (e.g. `{ critDmg: 3 }`), the gems of a stat without priority score `0`; they're no longer dropped but fill the free slots — a socketed gem takes nothing off the sheet, an empty slot does. Only gems scoring **exactly 0** fill (a negatively-prioritized stat is never socketed, nor a stat carrying a `max` in `statFilters`: it would push the build out of its band). Order: the relative `dmg` gain the gem brings (`gemDmgGains`, the `computeCheapRatings` model with `dmgStat` / `dmgSec` / `noCrit` — the one behind the "DMG per 1 %" panel), **weighed once per solve on the equipped build**; at zero gain (stat outside the model, CHC at the cap, CHC/CHD for a `noCrit` hero), by raw magnitude `value / ROLL_NORMS`. Carried by `ScoredGem.fill`, set by `scoreGemPool` and read by all four allocators (`pickOrder`: the priority gems in their order, then the fillers) — the displayed split and the composed delta can't diverge. Unchanged: SOLVE Score with no priority at all (`null` fallback below) and the build score (`computeScore` only reads the priority); in SOLVE CP without a priority, the gems with a zero CP weight fill by the same rule.

**Cap-reaching CHC (slow path, per combo)**: when the user prioritizes `critRate` **and** the pool has crit gems (`wantCritCap`), the allocation is **staged** (`allocateGemsReachingCap`):
1. **Stage 1** — spend crit gems to **reach** the 100% CHC cap (as a priority, even if atk scores higher), overshoot ≤ one 3% gem.
2. **Stage 2** — fill the rest **by priority, then by filler** (skipping any crit gem once the cap is reached, now wasted — a filler crit gem follows the same skip).

The combo's pre-gem CHC is recovered from `fs.critRateUncapped − defaultCrcGem` (crit rate is purely additive; the unbounded sum, the sheet's CHC being bounded at 100). We only **recompose** if the cap-aware delta differs from the default greedy (`gemDeltaEquals`) — often identical when crit gems already rank high. The case without a `critRate` priority (e.g. SOLVE CP fallback, or filler crit gems) keeps the old anti-overshoot (`allocateGemsCapped`, triggered only if `fs.critRateUncapped > 102`).

**Stat filter minimums (slow path, per combo)**: a filter is a hard constraint, a priority an order of preference — so the gems serve the `min` bounds of `statFilters` **before** the priority. The default (or cap-aware) allocation only looks at the priority: with `atk ≥ 12,000` and a priority elsewhere, the hero's socketed ATK gems gave way and every combo fell under the bound. Only when `passesSpecs` fails, a `min` bound is missed and a gem delta was applied (`serveMinFilters` in `solveChunk`): shortfall per stat (`min − fs[key]`, rounded up to 10 on ATK / DEF / HP, 0.1 on the percent stats, 1 elsewhere), the largest in proportion of its bound first; `allocateGemsServingMins` places each missed stat's gems (the whole pool, even score 0 or negative, largest gain first) until the shortfall is covered — gain estimated by `rollGainOnSheet` (`composeMultStat` with the gem alone minus without it on ATK / DEF / HP / EFF / RES, the value elsewhere) — then the rest by the usual rule (CHC cap if `wantCritCap`, else `pickOrder` without overshooting the cap); recompose if the allocation differs, retest. On failure (or an unchanged allocation): retest with the **socketed** gems (compose without `gemOverride`); if that passes, the build is kept with an empty allocation ("keep the piece's gems", as without a priority), else dropped. SOLVE CP without a priority keeps its CP allocation and only gets that fallback. Memo as a trie of integer keys (`(talismanSlots, preGemCrc)` then `spec index × 2^21 + rounded shortfall` per missed bound): one allocation per distinct value, not per combo; combos that pass first time pay nothing.

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
   the inner loop. Safe because neither `aggregatePrefixBuckets` nor `computeFinalStatsFromPrefix` keeps the reference.

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
    1× per accessory combo and passed to `computeFinalStatsFromPrefix`, not recomputed per talisman.
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
│   ├── settings.ts                ← settings registry (key, default, bounds, label, help): Settings, App and the non-React readers
│   ├── statRegistry.ts            ← the one stat vocabulary (engine names): ROLL_NORMS, STAT_NORMS, STAT_TO_PRIORITY, LEGACY_STAT_KEY_RENAME
│   ├── composeBuild.ts            ← computeFinalStats(+FromPrefix) + aggregate(Gear/Prefix)Buckets (+ GemOverride)
│   ├── overcap.ts                 ← overcapOf + overcapText (wasted CRC 102 / PEN 100 caps, Heroes and Presets)
│   ├── deltaCp.ts                 ← deltaCpLabel: the selected build's "ΔCP … vs equipped (build at +10R6)"
│   ├── buildDiff.ts               ← diffBuildVsLoadout: changed slots, read by N slots change, Swaps, Apply to snapshot, + Worklist
│   ├── heroPriority/
│   │   └── weights.ts              ← hasPriority + effectivePriority + priorityOf: a hero's priority, one source (Optimizer, Presets, solver)
│   ├── heroes/
│   │   ├── heroName.ts             ← a hero's display name + search (nickname, base name, id, "fusion")
│   │   └── heroListOrder.ts        ← the one hero-list order (rank, CP when asked, capture): HeroPicker, Heroes
│   ├── gear/
│   │   └── overviewStats.ts        ← Gear › Overview statistics (quality, breakdown, classes, CLASSES)
│   ├── reco/
│   │   ├── fetchReco.ts            ← fetchRecoForHero (/api/reco)
│   │   ├── translateReco.ts        ← reco → filter patch (Load reco)
│   │   └── recoPriority.ts         ← recoPriorityOf: the priority alone, set by Solve with no weights
│   ├── presets/
│   │   ├── presetRows.ts           ← in-game presets: pieces, wearers (presetSignature), missing / shared pieces, class, filter / sort
│   │   ├── presetHolds.ts          ← preset ranks + locks → held pieces (solver, "from preset ‹name›")
│   │   ├── evaluate.ts             ← evaluatePresetFor + bestKnownFor + presetLoss + heroBases + presetOvercap (Presets tab)
│   │   ├── eeGems.ts               ← bestEeGemsFor: per-hero EE gems, the preset's pieces fixed
│   │   ├── presetWorklist.ts       ← presetWorklistFor: the Worklist entry of a preset's hero
│   │   └── optimize.ts             ← presetOptimizePatch + presetOptimizeNote: "Optimize preset →" (required effects, priority substats)
│   ├── storage/
│   │   ├── keys.ts                 ← registry of the gs.* keys (store, backup, merge on import): Backup's Export / Import
│   │   ├── savedBuilds.ts          ← per-hero build bookmarks (localStorage)
│   │   ├── presetHeroes.ts         ← reference + associated heroes per preset (localStorage)
│   │   ├── presetPriority.ts       ← preset ranks and locks (localStorage)
│   │   ├── rankDefaults.ts         ← default hero and preset ranks, set by App on every import
│   │   ├── localPresets.ts         ← local presets (localStorage)
│   │   ├── heroFilters.ts          ← per-hero kept filters (localStorage, written on every change)
│   │   └── filterPresets.ts        ← per-hero filter sets (localStorage)
│   └── solver/
│       ├── types.ts                ← SolveRequest / SolveBuild / WorkerOutput / SolveFilters
│       ├── builderFilters.ts       ← SolverFilters + the Optimizer reducer (21 actions) + INITIAL_FILTERS + filterDefaults + buildSolveFilters
│       ├── reforge.ts              ← REFORGE_MODES (labels, tooltips) + the useReforged → reforgeMode migration
│       ├── reroll.ts               ← Transistone potential (rerollPotential)
│       ├── orchestrator.ts         ← Web Worker pool, fan-out/fan-in, top-N merge
│       ├── engine.ts               ← prepareContext + solveChunk + finalizeBuilds + TopKHeap + keepTopUnion + pruneDominatedForCp + simulateReforges
│       ├── gems.ts                 ← buildGemPool + scoreGemPool + allocateGems + allocateGemsByCp
│       ├── ratings.ts              ← computeCheapRatings + computeScore
│       └── cp.ts                   ← calcBattlePower (reverse-engineered)
├── design/
│   ├── Shell.tsx                   ← header: tabs, capture pill, action button, Reload, update badge, Settings
│   ├── GearCard.tsx                ← the one piece card (Gear, Heroes, Presets, Optimizer results, compact or not)
│   ├── HeroPicker.tsx              ← the one hero picker, single (Optimizer, Reference) or multi (Don't take from…, Associated)
│   └── settings/                   ← SettingsModal + the six panes (SteamSetupPane, DataPane + UpdateCard, SolverPane, DisplayPane, BackupPane, AdvancedPane + LogsPane)
└── screens/
    ├── BuildsScreen.tsx            ← Heroes tab: equipped/composed roster, rank, notes, computeAdvice, Optimize →
    ├── FirstCapture.tsx            ← first-install empty state (Heroes and Gear)
    ├── builder/                    ← Optimizer tab
    │   ├── BuilderScreen.tsx       ← useReducer(SolverFilters) + layout + hero switch + builds/presets/reco + selected build
    │   ├── useSolverSession.ts     ← orchestrator wiring: solve/cancel, pre-solve estimate, progress, results
    │   ├── BuilderToolbar.tsx      ← row 1 (hero, Score | CP, Solve / Cancel, Filter, the nine filter popovers on the right, on one line) + row 2 (Options, Reforge, toggles, reset filters)
    │   ├── PriorityBanner.tsx      ← the "No priority set" / "Priority from outerpedia reco" banner
    │   ├── SubstatPriorityPanel.tsx · SetsPanel.tsx · AccessoryMainStatsPanel.tsx · EffectPanel.tsx · PassivesPanel.tsx
    │   ├── StatFiltersPanel.tsx · RatingFiltersPanel.tsx · OptionsPanel.tsx   ← the ten popovers
    │   ├── ResultsTable.tsx        ← virtualized table, sort, heatmap, columns menu, height, threshold and pin menu
    │   ├── ComparePanel.tsx        ← Compare panel: pinned build vs selected or loadout (lib/solver/compareBuilds.ts)
    │   ├── StatsPanel.tsx · BuildEffectsPanel.tsx · SubValuePanel.tsx · DmgPer1PctPanel.tsx · RightSidebar.tsx   ← right column
    │   ├── EquipBuildButton.tsx    ← Apply to snapshot (confirmation, greyed-out reason)
    │   ├── BottomGearBand.tsx · FilterFooter.tsx   ← the selected build's cards, pinned footer
    │   ├── PieceDeltaTooltip.tsx   ← "why this piece?" on a card's hover (lib/solver/pieceDelta.ts)
    │   └── catalogs.ts · statColumns.ts ← catalogs from the inventory, stats/ratings tables
    ├── presets/PresetsScreen.tsx   ← Presets tab: per-preset cards (game order, class or rank filter / sort), game grid, reference, associated, EE gems, loss, overcap, rank and lock, local presets, + Worklist, Optimize → / Optimize preset →
    ├── WorklistScreen.tsx          ← Worklist tab: per-hero cards, reservations, Apply to snapshot / Apply all, Remove
    ├── gear/                       ← Gear tab (formerly the Inventory and Home tabs): GearScreen.tsx (Overview / Pieces / Scrap sub-tabs), OverviewView.tsx + overview/
    └── inventory/                  ← the grid of Gear › Pieces and › Scrap: InventoryScreen, FilterModal, ScrapCard, ItemDetail, VirtualGearGrid
```

Bonus:
- `data/stat-locks.json`: stat-regression snapshots to validate the compose
  formula (cf. `project-gear-solver-stat-locks` memory).

---

## 10. How to test end-to-end

1. Launch the app (`npm run dev`).
2. Optimizer tab → choose an equipped hero.
3. Click **SOLVE** with no filter/priority → the table should fill, P/S increment.
4. Click a row → the bottom band shows the 8 pieces.
5. Set CHC min = 90 (Stat filters popover) then re-SOLVE → all returned builds satisfy the bound.
6. Enable `Sharp 4pc required` → the builds' helmet/armor/gloves/boots are all Sharp.
7. **Regression comparison**: SOLVE with empty priority + Top 100% + Keep current + **Reforge Off**
   (the default +10R6 projects to +10 → would not match the card) → the top-1 must have the same
   `FinalStats` as the card of the same hero in the Heroes tab (modulo gem reallocation, which in
   empty-priority mode falls back on the current gems, so ✓ strict equivalence is expected).
8. SOLVE CP → the top-1 must have the highest CP displayed. Compare against a separate brute-force solve on a small slice.
