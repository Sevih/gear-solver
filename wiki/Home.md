# gear-solver wiki

Gear optimizer for **OUTERPLANE** — Fribbels-style. It captures your account's gear and
characters from the game, then solves for the best builds per hero with a parallelized
in-renderer Web Worker pool. Packaged as an Electron desktop app (Windows). Not a web service.

> **This wiki is auto-published from the [`wiki/`](https://github.com/Sevih/gear-solver/tree/main/wiki)
> directory in the repo** (English) by a GitHub Action on every push to `main`. Edit the files
> there via a PR — **don't edit pages in the GitHub wiki UI**, the next publish would overwrite them.
> The French [`docs/`](https://github.com/Sevih/gear-solver/tree/main/docs) remain the
> maintainer's authoritative source.

## What it does

- **Captures** your account data via a mitmproxy pipeline against the mobile client
  running in LDPlayer (one-button PowerShell). No certificate pinning; XOR key recovered.
  → [Capture Pipeline](Capture-Pipeline)
- **Parses** the captured JSON into a typed inventory (gear, characters, presets) with
  resolved stat values matching the in-game display. → [Data Schema](Data-Schema)
- **Composes** each hero's full stat sheet — a mirror of the in-game `CFormula::CalcFinalStat`
  (reverse-engineered, validated 0-diff against the character sheet for 9 chars). →
  [Engine Reference](Engine-Reference)
- **Solves** the optimal gear allocation per hero in a Web Worker pool: pruned cartesian
  search, mid-tree set feasibility checks, per-slot top-% prune, greedy gem sub-solver,
  fixed-size top-K min-heap. Two modes: SOLVE (priority-weighted Score) and SOLVE CP
  (in-game Combat Power). → [Solver](Solver)
- **Library** of saved builds + filter presets per hero (localStorage).
- **Edits** equip assignments locally by rewriting the captured snapshot — `equipItem`/
  `unequipItem` (core) + a `POST /api/captured/user-item` write-back (no game writes; a
  Builder/Builds trigger UI is the remaining step). → [Engine Reference](Engine-Reference)

## Pages

| Page | What's in it |
|------|--------------|
| [Architecture](Architecture) | The four layers (capture → core → renderer → desktop) and why the split |
| [Solver](Solver) | Solver pipeline, SOLVE vs SOLVE CP, UI panels, gems, optimizations, file map |
| [Engine Reference](Engine-Reference) | Full pipeline + formulas (parse, compose, set bonuses, ratings, score, CP, gems, reforge), tests, reverse-engineering notes |
| [Data Schema](Data-Schema) | Captured-server JSON schema (`/user/item`, `/user/character`, presets, endpoints) |
| [Capture Pipeline](Capture-Pipeline) | mitmproxy + LDPlayer acquisition: servers, XOR decrypt, output files, steps |
| [Roadmap](Roadmap) | Milestones M0–M8, what's done, what's next, guardrails |

## One-diagram overview

```
LDPlayer (game) ──HTTPS──▶ tools/capture (mitmproxy + PS) ──JSON──▶ packages/core ──▶ apps/renderer
  account data              decrypts & writes out/*.json     parse + compose + types     React UI + Web Worker pool

                                                                                        │
                                                                        packaged via    ▼
                                                                                  apps/desktop
                                                                                  (Electron shell)
```
