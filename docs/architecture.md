# Architecture

## Overview

Four layers, connected by plain JSON:

```
 Steam client (game) ─BepInEx─▶ tools/capture-steam (plugin) ─┐
   account data                  copies decoded JSON as it flows │
                                                                ├─JSON─▶ packages/core ─▶ apps/renderer ◀─hosts─ apps/desktop
 LDPlayer (game) ─HTTPS─▶ tools/capture (mitmproxy + PS) ───────┘         parse + score + solve     UI         Electron shell
   account data            decrypts & writes out/*.json
```

- **tools/capture-steam** — the Steam source: a BepInEx plugin the app installs into the
  Steam game folder (`/api/steam/install`). It hooks the game's own HTTP layer and writes
  the same `user_item.json` / `user_character.json` / … into the capture folder while you
  play — no emulator, root or proxy. See [tools/capture-steam/README.md](../tools/capture-steam/README.md).
- **tools/capture** — the emulator source: external, runs only when you want to (re)import.
  Produces `out/user_item.json`, `user_character.json`, etc. Not coupled to the app.
- **packages/core** — pure TypeScript, no DOM, no Node APIs. The brain: wire types,
  parser (wire → domain model), stat resolution, character stat composition. Reusable
  from a Web Worker, a CLI, or the desktop shell. (The combination solver itself lives
  in `apps/renderer/src/lib/solver/`, not in core.)
- **apps/renderer** — Vite + React. Loads the JSON, drives the engine, renders results.
  Screens: **Home** (account dashboard + gear-quality distribution + update center),
  **Inventory** (table + per-piece detail), **Builds** (equipped/composed roster + Optimize→),
  **Builder** (the solver), **Worklist** (cross-hero queue of gear changes — the Builder's
  "+ Worklist" pushes a build's per-slot diff here as a checklist, `equipPieces` applies it
  locally), plus a tabbed **Settings** modal. The gear detail panel
  (`design/GearDetail.tsx`) is shared between Inventory and the Builds hover tooltip.
  Heavy solves fan out across a **pool of Web Workers** (size = `hardwareConcurrency - 1`,
  override `gs.solver.workerCount`, hard cap 64) that import the pure engine modules in
  `apps/renderer/src/lib/solver/`. See [solver.md](solver.md) for the solver pipeline + UI
  panels, and [reference.md](reference.md) for the full formula + data-pipeline reference.
- **apps/desktop** — Electron shell that hosts the renderer. `main.ts` boots a local
  server (`server.ts`) that serves `data/derived` + the capture output, exposes the
  capture/emulator HTTP endpoints (`/api/capture/*`, `/api/emulators`, and `/api/steam/*` for the
  Steam source via `steam-capture.ts` — there is no Electron IPC/preload, the renderer talks plain HTTP), and accepts a `POST /api/captured/user-item` write-back (the renderer
  rewrites the captured snapshot for equip/unequip edits — the transform itself lives in core,
  so the server stays a dumb writer); in dev the Vite middleware covers the same role. At launch it
  **syncs the derived game data from the public `Sevih/outerpedia` repo** (`data-sync.ts`
  dual-mode checkout/repo, SHA-gated download of the 19 `data/generated/solver/*.json`
  artifacts emitted by outerpedia's datagen ; shared `/img/*` handler `img-cache.ts`
  cascading bundled sprites→checkout→disk cache→R2 bucket `img.outerpedia.com`) so the
  app follows game patches **without a new build**.
  Packaging is live: `scripts/release.mjs` builds and publishes the installer via
  electron-builder (`--publish always`, `extraResources` for `data/`), and packaged builds
  auto-update in production (`updater.ts` / `setupAutoUpdate`). The installer bundles `adb`
  but **not** the mitmproxy binaries (AV heuristics flag them as a PUA): `mitm-provision.ts`
  downloads the official checksum-pinned `mitmdump.exe` into `<userData>/bin/mitmproxy/` on the
  first capture instead.

## Why this split

- The risky/fragile part (capture) is isolated; if the game changes its protocol only
  `tools/capture` / `tools/capture-steam` are affected — both write the same files, so the
  engine and UI don't know which source produced a snapshot.
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
