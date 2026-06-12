# Roadmap

**North star:** for a chosen hero, find the best gear combinations from *your* inventory
under stat constraints and set requirements — fast, in the browser, from auto-imported data.

Stay focused: every feature should serve that sentence. Defer anything that doesn't.

---

## Done ✅

- **M0 — Capture.** One-button pipeline (`tools/capture`) decrypts the game server and
  writes account JSON. No pinning; XOR key recovered.
- **M1 — Data foundation.** Game tables copied to `data/game`, distilled to `data/derived`
  (`data/build.mjs`). Mappings ItemID→equipment, OptionID→stat (validated vs in-game),
  CharID→character. Engine parses a real inventory with resolved stats.
- **M2 — Auto-import.** Web app loads game data + latest capture automatically (Vite
  middleware serves `data/derived` and `tools/capture/out`).

## Next

### M3 — Inventory UX (read-only)
- Gear table: sort/filter by slot, set, rarity, stat, equipped/locked.
- Per-piece detail (main, subs with ticks, reforge, breakthrough, singularity).
- Substat score per piece (weighted), gear-quality indicator.
- *Exit criteria:* you can browse and rank your whole inventory.

### M4 — Stat model completeness
- Resolve **main stat** scaling with enhancement (`ItemEnchantTemplet`) + breakthrough
  (`ItemBreakLimitTemplet`, +5%/tier) + singularity.
- Resolve **set bonuses** (`sets.json`) and surface set names/effects.
- Character **base stats** (`CharacterTemplet`/`CharacterEvolutionStatTemplet`) so a build's
  totals are the real in-game numbers.
- *Exit criteria:* a built hero's displayed totals match the game.

### M5 — Solver core
- Implement the pruned cartesian search in `solver.ts`: candidate prefilter per slot
  (main stat, required set, top-% substats), incremental stat accumulation, set bitmask,
  min/max constraints, top-N by score.
- Run it in a **Web Worker**; report evaluated/pruned counts and timing.
- *Exit criteria:* solve a real hero in <1s for a reasonable filtered space.

### M6 — Solver UX
- Per-hero panel: pick hero, set weights, min/max constraints, required sets, locked pieces.
- Results table: build totals, score, set icons, swap-from-current diff; apply/compare.
- Save/load build presets per hero.
- *Exit criteria:* end-to-end "pick hero → get ranked builds → compare".

### M7 — Polish & sharing
- Persist inventory locally (IndexedDB); manual JSON import/export.
- Production build path for `data` (bake derived + a chosen snapshot).
- Optional: package as Tauri desktop if a native capture button is wanted.

---

## Guardrails (don't scope-creep)

- **One game, one job.** No team-builder, damage sim, or PvP meta — just gear optimization.
- **Engine stays pure.** No DOM/Node in `packages/core`; data comes in as plain objects.
- **Capture stays external.** The app consumes JSON; it never embeds the MITM stack.
- **Derived data is generated.** Never hand-edit `data/derived`; change `data/build.mjs`.
- **Validate against reality.** New stat/formula work ships with a test pinned to a real
  captured item vs its in-game display.
