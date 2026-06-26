# Architecture

## Overview

Four layers, connected by plain JSON:

```
 LDPlayer (game) ─HTTPS─▶ tools/capture (mitmproxy + PS) ─JSON─▶ packages/core ─▶ apps/renderer ◀─hosts─ apps/desktop
   account data            decrypts & writes out/*.json       parse + score + solve     UI         Electron shell
```

- **tools/capture** — external, runs only when you want to (re)import. Produces
  `out/user_item.json`, `user_character.json`, etc. Not coupled to the app.
- **packages/core** — pure TypeScript, no DOM, no Node APIs. The brain: wire types,
  parser (wire → domain model), stat resolution, character stat composition. Reusable
  from a Web Worker, a CLI, or the desktop shell. (The combination solver itself lives
  in `apps/renderer/src/lib/solver/`, not in core.)
- **apps/renderer** — Vite + React. Loads the JSON, drives the engine, renders results.
  Heavy solves fan out across a **pool of Web Workers** (size = `hardwareConcurrency - 1`,
  override `gs.solver.workerCount`, hard cap 64) that import the pure engine modules in
  `apps/renderer/src/lib/solver/`. See [solver.md](solver.md) for the solver pipeline + UI
  panels, and [reference.md](reference.md) for the full formula + data-pipeline reference.
- **apps/desktop** — Electron shell that hosts the renderer. `main.ts` boots a local
  server (`server.ts`) that serves `data/derived` + the capture output and exposes the
  capture/emulator IPC; in dev the Vite middleware covers the same role. At launch it
  **syncs images + game data from the public `Sevih/outerpediaV2` repo** (`data-sync.ts`
  dual-mode checkout/repo, SHA-gated ; shared `/img/*` handler `img-cache.ts` cascading
  checkout→disk cache→CDN→302) so the app follows game patches **without a new build**.
  Packaging (electron-builder `extraResources` for `data/`, `setupAutoUpdate`) is wired but
  not yet verified end-to-end on a real packaged build.

## Why this split

- The risky/fragile part (capture) is isolated; if the game changes its protocol only
  `tools/capture` is affected.
- The engine is testable in isolation and portable — it already backs both the web
  renderer and the Electron desktop shell without a rewrite.
- The UI stays thin.

## Data flow inside core

```
RawUserItem (raw.ts)
   └─ parseInventory() ──▶ Inventory { gear: GearPiece[], characters: Character[] }  (types.ts)
                              ├─ stat resolution via stats.ts (OptionID → value)
                              └─ equipment meta via gamedata.ts (slot/set/rarity/main/passive)

Inventory + filters + hero
   └─ apps/renderer/src/lib/solver/orchestrator.ts (main thread, fan-out)
        └─ apps/renderer/src/workers/solver.worker.ts × W (fan-in top-K → merged top-N)
             └─ apps/renderer/src/lib/solver/engine.ts (pure compute: prepareContext + solveChunk + finalizeBuilds)
                  ├─ composeBuild.ts (computeFinalStats, mirror in-game CalcFinalStat)
                  ├─ solver/cp.ts (calcBattlePower, mirror in-game CalcBattlePower)
                  ├─ solver/ratings.ts (8 cheap ratings + Score)
                  └─ solver/gems.ts (gem sub-solver greedy)
```

## Open dependencies

- **Engine vs UI boundary** : engine modules under `apps/renderer/src/lib/solver/` are pure
  TS (no React, no DOM) so the worker bundle stays light and the modules are testable
  standalone. `composeBuild.ts` lives one folder up because it's shared between BuildsScreen
  and the solver.
- **Stat regression locks** : `data/stat-locks.json` snapshots per-hero final stats — any
  change to `compose-stats.ts` / `composeBuild.ts` must keep these green.
