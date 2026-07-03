# data/

Static game data the engine needs, independent of any account.

## Pipeline

```
outerpedia-v2 admin dump (data/admin/json2)
  └─ sync.ps1       →  data/game/*.json      raw game tables (subset the engine needs)
      └─ build.mjs  →  data/derived/*.json   compact lookup tables, committed
```

- **`sync.ps1`** — copies the raw tables from the local outerpedia-v2 checkout into
  `data/game/`, then rebuilds. Run after a game patch.
- **`build.mjs`** — distills `data/game/` into `data/derived/` (`npm run data:build`).
  Also stamps `data/derived/version.json` `{ hash, builtAt }` — the hash only changes
  when the derived content actually changed.
- **`data/derived/*.json`** — versioned and committed; consumed by `packages/core`
  via the `GameData` interface (`packages/core/src/gamedata.ts`).

## Key derived files

- **`equipment.json`** — `ItemID` → `{ slot, grade, star, classLimit, setId,
  armorSetId, name, mainGroup, subGroup, image, effectIcon, armorSetIcon, class }`.
  Primary source is the raw game `ItemTemplet.json`; the curated Outerpedia
  equipment dataset is only an icon-enrichment fallback. Main stats are **not**
  stored here — they're resolved at parse time from the item's `OptionList` via
  `options.json` / `buffs.json` / `enhance.json`.
- **`options.json`** — `OptionID` → stat type + per-tick value (IOT_STAT), or a
  `buffId` indirection (IOT_BUFF) resolved per enhance level through `buffs.json`.
- **`enhance.json`** — main-stat scaling constants + per-(slot, grade, star)
  cumulative Exp curves.
- Plus sets, gems, passives (equipment / multi-tier / EE / singularity),
  characters, and the exp / trust / codex curves.

Field semantics: [../docs/data-schema.md](../docs/data-schema.md).
