# Outerplane — Steam capture plugin (BepInEx)

The gear solver's capture source, for the **Steam (PC) client** of OUTERPLANE (released
2026-08-27): a **plugin that runs inside the game** — no root, no proxy, no certificate. The
game decrypts its own server responses; the plugin copies the decoded JSON to the app's
capture folder as they arrive. Players without the Steam client can still import the same
JSON files by hand in the app.

**Status: working end-to-end** (validated in-game 2026-09-05, see "Validation" below).

## How it works

The Steam build is Unity 2022.3 **Mono** (not IL2CPP), so the game's C# is plain .NET the
Harmony library can patch at runtime. It talks to `glb-game…:38001` / `glb-login…:38002`
exactly like the Android build (same hosts, ports, endpoints, XOR key — the `Hosts` file
lives in `%LOCALAPPDATA%Low\com_vagames\OUTERPLANE\`). The networking class is `CWebManager`:

```
HTTPRequest callback (BestHTTP/2)
  └─ CheckResponse(_response)            // status / error code
  └─ Content = DecryptMsg(DataAsText)    // {"msg":"<hex>"} → XOR("ASLDKGFJASPODIFJSOWEI") → JSON
  └─ Log2InternalWeb(Content, _request.CurrentUri.LocalPath)   // EMPTY stub left by the devs
```

Two Harmony **postfixes**, both read-only (`src/Plugin.cs`):

| Hook | Role |
|------|------|
| `CWebManager.Log2InternalWeb(string message, string cmd, bool request)` | **Primary.** Called on every successful response with the decrypted JSON and the path (`/user/item`). Path → file name (the files the renderer reads). `request == true` (outgoing) is skipped. |
| `CWebManager.DecryptMsg(string)` (static) | **Fallback.** The stub above is tiny and Mono's JIT may inline it into its caller, in which case the patch never fires. `DecryptMsg` is too big to inline; its postfix identifies the payload by its **top-level keys** (`ItemList`+`PresetList` → `user_item`, `CharList`+`SlotList` → `user_character`, …) and stays silent once the primary hook has fired. `GiftList` alone is `user_gift` (`CWebRES_GiftInfo`); the PvP start response (`CWebRES_PVPStart`) carries the opponent's `GiftList` next to `TicketData`/`CharList`/`ItemList` and is skipped. |

Both targets are resolved **by name at runtime** (`AccessTools.TypeByName`, no reference to
`Assembly-CSharp.dll`), so a game update that renames them logs an error instead of crashing
the plugin. Every hook body is wrapped in try/catch: a plugin bug can never bubble into the
game's network callback.

Gear moved **in-game** never re-sends `/user/item` (only the lobby does), but each move comes back
through the same primary hook as `/item/equip` (one piece: `CharUID`, `ToEquipUID`, `ToInvenUID`,
`UnEquipCharUID`) or `/item/equipAll` (`CharUID`, `ToEquipList`, `ToInvenList`, `UnEquipList`).
Since 0.2.0 the plugin appends those two to a journal, `equip-events.ndjson`, and the app folds it
into `user_item.json` on its 5 s status poll (`apps/desktop/src/equip-events.ts`): the inventory
follows the moves live, no lobby needed. A new `/user/item` truncates the journal before its
snapshot is written (the snapshot is the truth again). The shape fallback has no path, so it
can't journal: with only the fallback active, moves still wait for the lobby. The hooks only enqueue; disk writes happen on one background writer
thread (a 5 MB inventory would otherwise hitch a frame), in arrival order (two close
`/user/item` responses can't swap), atomically (`.tmp` + replace) so the app never reads a
half file.

## Output

| File | Source | Notes |
|------|--------|-------|
| `user_item.json`, `user_character.json`, `user_asset.json`, `user_info.json`, `user_lobby.json`, `user_etc.json`, `item_customInfo.json`, `user_archive.json`, `user_gift.json` | `/user/item`, `/user/character`, … `/archive/info`, `/gift/info` | Rewritten on every fetch (lobby load, screen open). |
| `.captured` | after `/user/item` | Sentinel the app's status endpoint reports. |
| `equip-events.ndjson` | `/item/equip`, `/item/equipAll` | One line per response, appended: `{"seq":n,"at":"<ISO UTC>","path":"/item/equip","res":{…response as is…}}`, `seq` monotone since game start. Emptied whenever `/user/item` lands. |
| `.equip-events.applied` | written by the **app** | What the app already folded (`first`/`last` seq + the snapshot mtime it left), so a restart doesn't rewrite the snapshot for nothing. |
| `.steam-plugin.json` | plugin start + every capture | Heartbeat: `{version, pid, startedAt, pathHook, captures, lastPath, lastCaptureAt, outDir}`. The app matches `pid` against the running `OUTERPLANE.exe` to show **Live**. |
| `_unknown/<path>.json`, `seen-paths.log` | any other endpoint | `KeepUnknown` config (not for the two journaled paths); `/account/*` and `/server/*` are ignored. |

## Install (what the app does on "Install plugin")

`apps/desktop/src/steam-capture.ts`, driven by `POST /api/steam/install` (Settings → Setup,
or the header button):

1. Find the game: registry `HKCU\Software\Valve\Steam\SteamPath` → `steamapps/libraryfolders.vdf`
   → `appmanifest_4247320.acf` → `<lib>/steamapps/common/OUTERPLANE`.
2. If `winhttp.dll` + `BepInEx/core/BepInEx.dll` are absent, download **BepInEx 5.4.23.5
   win x64** from the official GitHub release (SHA-256 pinned in `steam-capture.ts`) and copy
   the zip over the game folder. Needs the game closed (winhttp.dll is mapped by the process).
3. Copy `dist/GearSolverCapture.dll` to `BepInEx/plugins/GearSolverCapture/`. Allowed while the
   game runs as long as the plugin isn't loaded yet (it loads on the next launch); refused when
   the heartbeat says it's live (file locked).
4. Write `BepInEx/config/outerpedia.gearsolver.capture.cfg` with `OutDir = <the app's capture
   folder>` (`.cache/capture-out` in dev, `<userData>/capture-out` packaged).

Manual equivalent: same three files. Config keys (`[Capture]`): `Enabled` (bool), `OutDir`
(string, empty = `%APPDATA%\Outerpedia Gear Solver\capture-out`), `KeepUnknown` (bool).

Steam's folder ACL lets the current user write there without elevation (that's how Steam
itself installs), so no UAC prompt.

## Build

```powershell
npm run capture-steam:build        # = dotnet build tools/capture-steam -c Release  →  dist/GearSolverCapture.dll
```

Needs the **.NET SDK** (8+) and the game installed: references (`BepInEx.dll`, `0Harmony.dll`,
`UnityEngine*.dll`, `Newtonsoft.Json.dll`) are read from the game folder so we compile against
exactly what it loads. `GameDir` is auto-detected; override with `-p:GameDir=…`. BepInEx must
already be in the game for the build (the app installs it; or unzip the release by hand).

Packaging: `apps/desktop/scripts/fetch-binaries.mjs` builds the plugin and stages it under
`apps/desktop/resources/capture-steam/`, which electron-builder ships as
`<resources>/capture-steam/GearSolverCapture.dll`. BepInEx itself is **not** bundled.

## Validation

- [x] Builds (14 KB DLL), typechecks, app-side detection returns the real install (build 24947556, BepInEx 5.4.23.5 present).
- [x] Installed into the game folder through `installSteamPlugin()`.
- [x] **In-game** (2026-09-05, build 24947556): `LogOutput.log` shows both hooks applied, then
      `/user/info`, `/user/asset`, `/user/character`, `/user/item` (618 881 chars), `/user/etc`,
      `/user/lobby`, `/item/customInfo`, `/gift/info`, `/archive/info` → all nine files written.
      Heartbeat: `"pathHook": true, "captures": 9` — the **primary** hook fired, the stub was
      NOT inlined by Mono's JIT; the shape fallback stayed silent as designed.
- [x] Lobby reached → the app re-imported on its own (5 s poll on `user_item.json` mtime).
      Codex + Gift screens also imported without any click.

## Caveats

- **Game updates.** A patch that renames `CWebManager` / the two methods breaks the hooks
  (soft failure, logged). The game ships the Beebyte obfuscator but leaves the network
  classes unobfuscated (`[Skip]`); if that changes, this plugin needs a rebuild against the
  new assembly — the same exposure as any BepInEx plugin for this game.
- **Read-only, still a mod.** Nothing is sent to the server and gameplay is untouched, but it
  is a third-party DLL loaded into the client.
- **Account.** The Steam client uses the same account system (link via the in-game account
  menu); whether an existing mobile account can be played on Steam is MAJOR9's policy, see
  their Steam FAQ — not something the plugin changes.
