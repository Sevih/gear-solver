# Capture Pipeline

*Summary of `tools/capture-steam/README.md` — see the repo for the authoritative source.*

How the gear solver reads your account inventory/character data from OUTERPLANE: a
**BepInEx plugin inside the Steam (PC) client** — no root, no proxy, no certificate.
**Status: working end-to-end** (validated in-game 2026-09-05). Players without the Steam
client can import the same JSON files by hand in the app.

## How it works

- The Steam build is Unity 2022.3 **Mono**, so the game's C# can be patched at runtime by
  Harmony (bundled with BepInEx).
- The game talks to its servers through the Unity **BestHTTP/2** client:
  | Host | Port | Role |
  |------|------|------|
  | `glb-login.outerplane.vagames.co.kr` | 38002 | login / version check |
  | `glb-game.outerplane.vagames.co.kr`  | 38001 | **account, inventory, characters** |
- Response bodies are JSON shaped `{"msg":"<hex>"}`. The hex decodes to bytes that are
  **repeating-key XOR** encrypted with the 21-byte ASCII key **`ASLDKGFJASPODIFJSOWEI`**.
  The game decrypts them itself (`CWebManager.DecryptMsg`), so the plugin never has to.
- Two read-only Harmony **postfixes**: `CWebManager.Log2InternalWeb` (primary — the decrypted
  JSON + its path, e.g. `/user/item`) and `CWebManager.DecryptMsg` (fallback, identifies the
  payload by its top-level keys — a `GiftList` next to `TicketData`/`CharList`/`ItemList` is the
  PvP opponent's and is skipped). Nothing is sent to the server, gameplay is untouched.
- The hooks only enqueue: one background thread writes the files, in arrival order, each one
  atomically (`.tmp` + replace).

## Install (what the app does on "Install plugin")

1. Finds the game through the Steam library folders (no path to type).
2. If the game has no BepInEx yet, downloads the pinned **BepInEx 5** release from its official
   GitHub page (SHA-256 checked) into the game folder. The game must be closed.
3. Copies `GearSolverCapture.dll` to `BepInEx/plugins/GearSolverCapture/` and points the plugin
   config (`OutDir`) at the app's capture folder (`%APPDATA%\Outerpedia Gear Solver\capture-out`).

Then launch the game from Steam and reach the lobby: the app re-imports on its own — whenever
`user_item.json`, `user_character.json`, `user_gift.json` or `user_archive.json` changes (a hero
or geas level gained without a new inventory is picked up too).

### Linux (Steam + Proton)

The game runs as its Windows build under Proton, and the same plugin works there. The app finds
Steam under your home folder (`~/.local/share/Steam`, `~/.steam/steam`, `~/.steam/root`, or the
Flatpak's `~/.var/app/com.valvesoftware.Steam/…`), unzips BepInEx with `unzip` (install it if
missing), and writes the plugin's `OutDir` as the game sees it through Wine
(`Z:\home\<you>\.config\Outerpedia Gear Solver\capture-out`). One manual step: Wine must load
BepInEx's `winhttp.dll` instead of its own, so set the game's launch option in Steam
(OUTERPLANE → Properties → General → Launch Options) to

```
WINEDLLOVERRIDES="winhttp=n,b" %command%
```

then restart Steam. Settings → Setup shows whether it's set, and the line to paste when it isn't.

## Output (the app's capture folder)

| File | Source | Notes |
|------|--------|-------|
| `user_item.json`, `user_character.json`, `user_asset.json`, `user_info.json`, `user_lobby.json`, `user_etc.json`, `item_customInfo.json`, `user_archive.json`, `user_gift.json` | `/user/item`, `/user/character`, … `/archive/info`, `/gift/info` | Rewritten on every fetch (lobby load, screen open). |
| `.captured` | after `/user/item` | Sentinel the app's status endpoint reports. |
| `equip-events.ndjson` | `/item/equip`, `/item/equipAll`, `/item/gemInsert`, `/item/gemRemove`, `/item/gemChangeOption`, `/item/subOptionChange`, `/item/enchant`, `/item/enchantReset`, `/item/breakLimit`, `/item/smelting`, `/item/smeltingReset`, `/item/merge`, `/item/craft`, `/item/dissolve`, `/item/sell`, `/item/lock` | Gear moved in-game (plugin 0.2.0+), gems socketed / removed / rerolled and substat changes (plugin 0.3.0+), upgrades — enhance, reset, limit break, smelting, merge, craft (plugin 0.4.0+), one line per response; sales and lock toggles (plugin 0.5.0+) and dissolves (plugin 0.5.1+), one line per gesture carrying the client's request too (`req`); the app folds it into `user_item.json` within 5 s, no lobby needed. Emptied on every `/user/item`. |
| `.equip-events.applied` | written by the app | What the app already folded from the journal. |
| `.steam-plugin.json` | plugin start + every capture | Heartbeat the app reads to show **Live**. |
| `_unknown/<path>.json`, `seen-paths.log` | any other endpoint | Discovery of new game endpoints. |

The app's **Settings → Data → Wipe captured data** empties the whole folder — refused (409)
while the plugin is loaded in a running game, like the equip write-back.

## Key endpoints (POST, on `glb-game …:38001`)

| Path | Contents |
|------|----------|
| `/user/item` | **gear inventory** (`ItemList`, ~1549 entries) |
| `/user/character` | owned characters (`CharList`, skills, stars, trust) + `SlotList` |
| `/user/asset` | currencies |
| `/user/info`, `/user/lobby`, `/user/etc` | account meta |
| `/item/customInfo` | crafting/custom option info |

### Gear item schema (`/user/item` → `ItemList[]`)

```
ItemUID              unique id (string)
CharUID              equipped character UID ("0" = unequipped)
ItemID               equipment DB id → maps to Outerpedia equipment data (set/slot/rarity/base main stat)
BreakLimitLevel      breakthrough tier T0–T4
SmeltingCount        reforge count
SingularityLevel/Step/OptionID   Singularity Ascension (+11→+15)
IsLock               locked flag
OptionList[]         main stat option id(s)
SubOptionList[]      substats: { OptionID, Level (procs above the initial tick), BaseLevel (initial yellow ticks) }
                     total ticks = Level + 1 (in-game shows LV (Level + 1)) ; reforge ticks = Level - BaseLevel
```
- Substat `OptionID`s observed: `160001`–`160013` (13 stat types).
- Main-stat `OptionList` patterns: `(5024,5048)`, `(4024,0)`, `(3024,0)`, `(6024,6048)`, `(24,94/95/96)` …
- `OptionID` → stat name + per-tick value mapping is **done**: outerpedia's solver generator
  distills it into `data/derived/options.json`, consumed at runtime via `resolveStat(optionId, ticks, game.options)`.
  Cross-checked against in-game display (e.g. a weapon read ATK 61.8% / Crit Chance 12% / Crit
  DMG 24% / DMG Increase 8% / Speed 9).

See also: [Data Schema](Data-Schema) for the decoded JSON field reference.
