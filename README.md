# gear-solver

![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)

Gear optimizer for **OUTERPLANE** — Fribbels-style. Captures your account's gear and
characters from the game, then solves for the best builds per hero with a parallelized
in-renderer Web Worker pool.

Packaged as an Electron desktop app (Windows installer, Linux AppImage). Not a web service.

## 🎮 Just want to use it?

**[⬇️ Download the latest release](https://github.com/Sevih/gear-solver/releases/latest)** (the
`Setup` `.exe` on Windows, the `.AppImage` on Linux), then
follow the **[Getting Started guide](https://github.com/Sevih/gear-solver/wiki/Getting-Started)** —
install, import your account, optimize a hero. No build step, no command line. The
**[player wiki](https://github.com/Sevih/gear-solver/wiki)** (Getting Started · Using the App ·
FAQ) walks through everything.

> Needs Windows or Linux (Steam + Proton) + OUTERPLANE on **Steam** — the app installs a small
> capture plugin into the game (no root, no proxy). See the guide for the why and how.

### 🐧 Linux (AppImage)

Make the file executable (`chmod +x Outerpedia-Gear-Solver-*.AppImage`, or Properties →
Permissions in your file manager) and run it. Installing the capture plugin needs `unzip`
(`sudo dnf install unzip` / `sudo apt install unzip`), and the game must be launched with the
Steam launch option `WINEDLLOVERRIDES="winhttp=n,b" %command%` (Settings → Setup shows the
line). The app updates itself as on Windows as long as the AppImage sits in a folder you can
write to (e.g. `~/Applications`): the new version lands next to it under its new name and the
old file is removed — rename the file without its version number to keep a fixed name. From a
read-only place the Home update card says so and you download the new AppImage by hand.

### ⚠️ Antivirus / SmartScreen warnings

The installer is **not code-signed** (a certificate costs money the project doesn't spend), so
Windows SmartScreen shows an "unknown publisher" prompt — click **More info → Run anyway**. A few
antivirus engines may also flag it. This is expected for an unsigned Electron app, and specifically
the app writes a [BepInEx](https://github.com/BepInEx/BepInEx) loader (downloaded from its official
release, checksum-verified) + a small plugin into the game folder — a read-only hook on the game's
HTTP layer. See [tools/capture-steam/README.md](tools/capture-steam/README.md).

**Verify your download:** every [release](https://github.com/Sevih/gear-solver/releases) publishes
the SHA-256 of the installer and of the AppImage. Check it with
`Get-FileHash .\Outerpedia-Gear-Solver-Setup-*.exe -Algorithm SHA256` (Windows) or
`sha256sum Outerpedia-Gear-Solver-*.AppImage` (Linux).
The full source is here and the build is reproducible via `npm run release`.

## 🔧 Building / contributing?

Read on. The rest of this README plus [docs/](docs) cover the stack, build, and internals:

> **Reprendre le projet → [docs/STATUS.md](docs/STATUS.md).**
> **Comprendre le moteur (pipeline, formules, sources) → [docs/reference.md](docs/reference.md).**
> **Comprendre le solver (panneaux, optims) → [docs/solver.md](docs/solver.md).**

---

## What it does

- **Captures** your account data via a BepInEx plugin inside the Steam client: it copies
  the game's own decrypted server responses as you play (or import the JSON files by
  hand). See [tools/capture-steam/README.md](tools/capture-steam/README.md).
- **Parses** the captured JSON into a typed inventory (gear, characters, presets)
  with resolved stat values matching in-game display.
- **Composes** each hero's full stat sheet — mirror of in-game `CFormula::CalcFinalStat`
  (reverse-engineered, validated 0-diff against the in-game character sheet for 9 chars
  spanning LB0/1/2/3 and lv 100–120, see `data/stat-locks.json`).
- **Solves** the optimal gear allocation per hero in a Web Worker pool: pruned cartesian
  search with mid-tree set feasibility checks, per-slot top-% prune, greedy gem
  sub-solver with pre-aggregated `{flat, pct}` delta, fixed-size top-K min-heap.
  Two modes: SOLVE (priority-weighted Score) and SOLVE CP (in-game Combat Power).
- **Library** of saved builds + filter presets per hero (localStorage).
- **Edits** equip assignments locally by rewriting the captured snapshot — `equipItem`/
  `unequipItem` (core) + a `POST /api/captured/user-item` write-back, triggered from the
  Builder's "Equip build → hero" button (confirmation popup) and the Worklist's per-entry /
  Apply-all actions. Changes only touch the local captured snapshot — nothing is ever
  pushed to the game.

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
│  └─ capture-steam/    Data acquisition: BepInEx plugin for the Steam client
├─ data/
│  ├─ derived/          Distilled tables consumed by the engine (committed; synced from outerpedia's solver artifacts by sync.mjs, stamped with version.json)
│  └─ stat-locks.json   Per-hero regression snapshots validated against in-game
├─ scripts/             Release tooling (release.mjs)
├─ docs/                STATUS, architecture, reference, solver, data-schema, roadmap, todo (open tasks), changelog (delivered)
└─ wiki/                English wiki sources — auto-published to the GitHub wiki by a CI workflow
```

> The GitHub wiki is **auto-published from `wiki/`** (`.github/workflows/publish-wiki.yml`, on
> pushes to `main` that touch `wiki/**`). Edit `wiki/*.md` in a PR — never the wiki UI. The
> French `docs/` stay the maintainer's authoritative source.

---

## Building from source (devs)

> Just want to *run* it? Grab the [installer](https://github.com/Sevih/gear-solver/releases/latest)
> instead — see [🎮 Just want to use it?](#-just-want-to-use-it) above. This section is for
> building from source.

```bash
# Prereqs: Node ≥ 20; for the capture plugin, OUTERPLANE on Steam + the .NET SDK.

npm install                   # all workspaces

# Dev (concurrent Vite + Electron, HMR through the renderer):
npm run desktop:dev

# Production build (renderer bundle → bundled inside Electron → installer):
npm run desktop:build
npm --workspace @gear-solver/desktop run dist                 # current OS
npm --workspace @gear-solver/desktop run dist -- --linux      # AppImage (release/)
npm --workspace @gear-solver/desktop run dist -- --win        # NSIS installer (Wine on Linux)
```

Dev mode reads game data (`npm run data:sync`, the in-app sync) and images from a local
[outerpedia](https://github.com/Sevih/outerpedia) checkout when one is found: `OUTERPEDIA_PATH`
from the environment, else from a gitignored `.env.local` at the repo root
(`OUTERPEDIA_PATH=/path/to/outerpedia`), else an `outerpedia` folder next to this repo. The
packaged app only honors the environment variable and otherwise downloads from GitHub.

Renderer-only dev (without the Electron shell — useful for UI iteration; note that the
root `npm run dev` is an alias for `desktop:dev`, so target the workspace explicitly):

```bash
npm run dev -w @gear-solver/renderer   # http://localhost:5173
```

Capture plugin (build once, then install it from the app: Settings → Setup → Install plugin):

```bash
npm run capture-steam:build   # dotnet build tools/capture-steam → dist/GearSolverCapture.dll
```

Play to the lobby: the renderer imports the snapshot on its own, and the latest one on launch.

---

## Testing, type-check & lint

```bash
npm run typecheck             # all workspaces (strict + noUnusedLocals/Parameters)
npm run lint                  # ESLint, whole repo (eslint.config.js, no type info)
npm test                      # core (22 tests) + renderer (251 tests) = 273
```

The core suite covers the inventory parser and the equip/unequip captured-JSON rewrite
(`equipItem`/`unequipItem`). The renderer suite covers the gem pool / scoring / allocation /
delta aggregation (incl. the incremental prefix-bucket equivalence), gem-override equivalence
in `aggregateGearBuckets`, the 8 cheap ratings (+ damage-stat scaling, no-crit) + Score
normalization, reforge simulation, set-plan feasibility + armor-set whitelist, sub-tick & damage
value panels, Builds advice rules, reco→filter translation, the top-K min-heap, worker-count
resolution, JSON backup round-trip, and the engine↔user stat key mapping.

---

## Architecture in one diagram

```
Steam client (game) ──BepInEx──▶ tools/capture-steam ───────JSON──▶ packages/core ──▶ apps/renderer
  account data                  copies decoded JSON          parse + compose + types     React UI + Web Worker pool

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

Data capture, parser, stat composer, solver, the Home dashboard, Inventory/Builds/Builder/
Worklist screens, the tabbed Settings modal, persistence (saved builds + filter presets) and
JSON backup import/export are all live. Session-scoped view state (Inventory/Builds
sorts+filters reset each launch), Builds advice rules, the equip/unequip captured-JSON rewrite
methods + write-back endpoint with their trigger UI (Builder "Equip build" + Worklist apply —
local snapshot only), the production build path for `data/` (bundled `extraResources` +
first-launch seed of the writable cache), packaged releases with auto-update, and a
`data/derived` version stamp (surfaced in Settings → Data) have landed. Backlog (localStorage
cache invalidation on a data-version change, CP-equivalence + mid-tree-pruning validation
tests) is tracked in [docs/todo.md](docs/todo.md).
