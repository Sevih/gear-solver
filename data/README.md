# data/

Static game data the engine needs, independent of any account.

## Pipeline

The distillation pipeline lives in the **outerpedia repo** (`datagen/generators/solver.ts`,
a faithful port of the old local `build.mjs` + `calc-stats.mjs`): outerpedia reads the raw
game tables and emits the 19 compact solver artifacts at `data/generated/solver/*.json`
(committed there, promoted with the rest of `data/generated/`).

```
outerpedia datagen (solver generator)
  └─ <outerpedia>/data/generated/solver/*.json     19 ready-to-consume tables
      ├─ data/sync.mjs   →  data/derived/*.json    committed mirror (this repo)
      └─ data-sync.ts    →  app runtime cache      packaged app, via GitHub CDN
```

- **`sync.mjs`** — copies the artifacts from the local outerpedia checkout into
  `data/derived/` (`npm run data:sync`), re-serialized compact. Run after a game patch
  (once outerpedia's `datagen:build` + `promote` ran).
- **`data/derived/*.json`** — versioned and committed; consumed by `packages/core`
  via the `GameData` interface (`packages/core/src/gamedata.ts`). Ships in the
  installer as the first-launch seed; the packaged app then re-downloads the same
  artifacts from the public `Sevih/outerpedia` repo at launch (SHA-gated, see
  `apps/desktop/src/data-sync.ts`) so it follows game patches without a new build.
- **`version.json`** — `{ hash, builtAt }` stamped by the generator; the hash only
  changes when the derived content actually changed (cache-invalidation key,
  shown in Settings → Data).

## Key derived files

- **`equipment.json`** — `ItemID` → `{ slot, grade, star, classLimit, setId,
  armorSetId, name, mainGroup, subGroup, image, effectIcon, armorSetIcon, class }`.
  Main stats are **not** stored here — they're resolved at parse time from the
  item's `OptionList` via `options.json` / `buffs.json` / `enhance.json`.
- **`options.json`** — `OptionID` → stat type + per-tick value (IOT_STAT), or a
  `buffId` indirection (IOT_BUFF) resolved per enhance level through `buffs.json`.
- **`enhance.json`** — main-stat scaling constants + per-(slot, grade, star)
  cumulative Exp curves.
- **`characters.json`** — per-hero identity, stat ingredients and the damage-model
  hints: `dmgStat` / `dmgSec` / `noCrit`, plus `bestSkill` = the strongest S1/S2/S3 hit's
  total factor (‰, max level, bursts included) that scales the Builder's Dmg columns.
- Plus sets, gems, passives (equipment / multi-tier / EE / singularity),
  characters, and the exp / trust / codex curves.

Field semantics: [../docs/data-schema.md](../docs/data-schema.md).
