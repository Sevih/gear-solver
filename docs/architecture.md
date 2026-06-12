# Architecture

## Overview

Three independent layers, connected by plain JSON:

```
 LDPlayer (game)  ──HTTPS──▶  tools/capture (mitmproxy + PS)  ──JSON──▶  packages/core  ──▶  apps/web
   account data                 decrypts & writes out/*.json        parse + score + solve     UI
```

- **tools/capture** — external, runs only when you want to (re)import. Produces
  `out/user_item.json`, `user_character.json`, etc. Not coupled to the app.
- **packages/core** — pure TypeScript, no DOM, no Node APIs. The brain: wire types,
  parser (wire → domain model), stat resolution, scoring, combination solver. Reusable
  from a Web Worker, a CLI, or a future desktop wrapper.
- **apps/web** — Vite + React. Loads the JSON, drives the engine, renders results.
  Heavy solves run in a Web Worker importing `@gear-solver/core`.

## Why this split

- The risky/fragile part (capture) is isolated; if the game changes its protocol only
  `tools/capture` is affected.
- The engine is testable in isolation and portable (could back a Tauri desktop build
  later without rewrite).
- The UI stays thin.

## Data flow inside core

```
RawUserItem (raw.ts)
   └─ parseInventory() ──▶ Inventory { gear: GearPiece[], characters: Character[] }  (types.ts)
                              ├─ stat resolution via stats.ts (OptionID → value)   [PARTIAL]
                              └─ equipment meta via EquipmentLookup (Outerpedia DB) [TODO]

Inventory + weights/constraints
   └─ solve() (solver.ts) ──▶ SolveResult { builds: BuildResult[] }                 [STUB]
```

## Open dependencies

- **Stat map** (`stats.ts`): OptionID → stat + per-tick value. Datamine task.
- **Equipment DB** (`EquipmentLookup`): ItemID → slot/set/rarity/main stat. Comes from
  the Outerpedia equipment dataset the maintainer already owns.
- **Solver hot loop**: start with a straightforward pruned search in a Worker; only reach
  for flattened arrays / WASM if the search space demands it.
