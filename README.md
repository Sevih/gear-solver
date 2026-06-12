# gear-solver

Gear optimizer for **OUTERPLANE** — Fribbels-style. Capture your account's gear and
characters, then solve for optimal builds per hero.

> Status: **data capture proven & automated** (one button). Engine parses real data with
> resolved stats; web auto-imports. Solver + UI are next.
>
> **Reprendre le projet → [docs/STATUS.md](docs/STATUS.md).**

## Monorepo layout

```
gear-solver/
├─ apps/
│  └─ web/            React + Vite UI (loads captured JSON, runs the solver)
├─ packages/
│  └─ core/           Stack-agnostic engine: wire types, parser, scoring, solver
├─ tools/
│  └─ capture/        Data acquisition pipeline (mitmproxy + LDPlayer, one-button PS)
├─ data/             Static game data (equipment DB, stat maps) — TBD
└─ docs/             Architecture & data-schema notes
```

## Getting the data

See [tools/capture/README.md](tools/capture/README.md). Short version (LDPlayer running,
ADB on, Root toggle on):

```powershell
cd tools/capture
powershell -ExecutionPolicy Bypass -File .\capture.ps1   # writes decoded JSON to out/
```

## Developing

```bash
npm install            # installs all workspaces
npm test               # runs core engine tests
npm run dev            # starts the web UI on http://localhost:5173
```

Load `tools/capture/out/user_item.json` (+ `user_character.json`) in the UI to see the
parsed inventory.

## Roadmap

1. ~~Prove we can capture & decode account data~~ ✅
2. ~~One-button capture pipeline~~ ✅
3. Map stat `OptionID`s → stat name + per-tick value (see [docs/data-schema.md](docs/data-schema.md)).
4. Wire the Outerpedia equipment DB (ItemID → slot/set/rarity/main stat).
5. Implement the pruned combination solver + Web Worker.
6. Build the solver UI (per-hero filters, sets, min/max, results table).
