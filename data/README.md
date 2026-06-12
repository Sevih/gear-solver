# data/

Static game data the engine needs, independent of any account:

- **Equipment DB** — `ItemID` → slot, set, rarity, base main stat. Sourced from the
  Outerpedia equipment dataset.
- **Stat tables** — `OptionID` → stat type + per-tick value (see
  [../docs/data-schema.md](../docs/data-schema.md)).

These will be committed here as versioned JSON once extracted/normalized, and consumed by
`packages/core` (e.g. via the `EquipmentLookup` interface in `parse.ts`).
