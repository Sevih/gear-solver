# gear-solver

Gear optimizer for **OUTERPLANE** — Fribbels-style. Captures your account's gear and
characters from the game, then solves for the best builds per hero with a parallelized
in-renderer Web Worker pool.

Packaged as an Electron desktop app (Windows). Not a web service.

> **Reprendre le projet → [docs/STATUS.md](docs/STATUS.md).**
> **Comprendre le moteur (pipeline, formules, sources) → [docs/reference.md](docs/reference.md).**
> **Comprendre le solver (panneaux, optims) → [docs/solver.md](docs/solver.md).**

---

## What it does

- **Captures** your account data via a mitmproxy pipeline against the mobile client
  running in LDPlayer (one-button PowerShell). No certificate pinning; XOR key
  recovered. See [tools/capture/README.md](tools/capture/README.md).
- **Parses** the captured JSON into a typed inventory (gear, characters, presets)
  with resolved stat values matching in-game display.
- **Composes** each hero's full stat sheet — mirror of in-game `CFormula::CalcFinalStat`
  (reverse-engineered, validated 0-diff against the in-game character sheet for 8 chars
  spanning LB0/1/2/3 and lv 100–120, see `data/stat-locks.json`).
- **Solves** the optimal gear allocation per hero in a Web Worker pool: pruned cartesian
  search with mid-tree set feasibility checks, per-slot top-% prune, greedy gem
  sub-solver with pre-aggregated `{flat, pct}` delta, fixed-size top-K min-heap.
  Two modes: SOLVE (priority-weighted Score) and SOLVE CP (in-game Combat Power).
- **Library** of saved builds + filter presets per hero (localStorage).

---

## Monorepo layout

```
gear-solver/
├─ apps/
│  ├─ renderer/         React + Vite — the Electron renderer process (UI, Web Workers)
│  └─ desktop/          Electron main process + bundled HTTP server (mirrors Vite dev middleware)
├─ packages/
│  └─ core/             Stack-agnostic engine: raw types, parser, stat resolution, no-gear composer
├─ tools/
│  └─ capture/          Data acquisition pipeline (mitmproxy + LDPlayer, one-button PS)
├─ data/
│  ├─ game/             Game tables (copy of Outerplane templates)
│  ├─ derived/          Distilled tables consumed by the engine (gitignored output of build.mjs)
│  └─ stat-locks.json   Per-hero regression snapshots validated against in-game
└─ docs/                STATUS, architecture, reference, solver, data-schema, roadmap, todo, design-prompt
```

---

## Getting started

```bash
# Prereqs: Node ≥ 20, LDPlayer rooted with the Outerplane mobile client installed.

npm install                   # all workspaces

# Dev (concurrent Vite + Electron, HMR through the renderer):
npm run desktop:dev

# Production build (renderer bundle → bundled inside Electron → installer):
npm run desktop:build
npm --workspace @gear-solver/desktop run dist
```

Renderer-only dev (without the Electron shell — useful for UI iteration):

```bash
npm run dev                   # http://localhost:5173
```

Capture (run once you have a fresh account state to import):

```powershell
cd tools/capture
powershell -ExecutionPolicy Bypass -File .\capture.ps1
```

The renderer auto-imports the latest capture on launch.

---

## Testing & type-check

```bash
npm run typecheck             # all workspaces (strict + noUnusedLocals/Parameters)
npm test                      # core (7 tests) + renderer (35 tests)
```

The renderer test suite covers the gem pool / scoring / allocation / delta aggregation,
gem-override equivalence in `aggregateGearBuckets`, the 8 cheap ratings + Score
normalization, reforge simulation, top-K min-heap, and the engine↔user stat key mapping.

---

## Architecture in one diagram

```
LDPlayer (game) ──HTTPS──▶ tools/capture (mitmproxy + PS) ──JSON──▶ packages/core ──▶ apps/renderer
  account data              decrypts & writes out/*.json     parse + compose + types     React UI + Web Worker pool

                                                                                          │
                                                                          packaged via    ▼
                                                                                    apps/desktop
                                                                                    (Electron shell)
```

The engine modules under `apps/renderer/src/lib/` are pure TS (no React, no DOM) so the
Web Worker bundle stays light and the math is testable standalone. The Electron main
process hosts an in-process HTTP server that mirrors the Vite middleware in prod, so
the renderer code is identical across dev and packaged builds.

See [docs/architecture.md](docs/architecture.md) for the layer split rationale, and
[docs/reference.md](docs/reference.md) for the full pipeline + formulas reference.

---

## Status

Data capture, parser, stat composer, solver, Builder UI and persistence are all live.
Backlog (validation tests for CP equivalence + mid-tree pruning, JSON import/export,
production build path for `data/`, reforge-aware ticks heuristic refinements,
Electron packaging polish) is tracked in [docs/todo.md](docs/todo.md).
