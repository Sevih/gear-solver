# Outerplane — Data Capture Pipeline

Proven method to recover the full account inventory/character data from OUTERPLANE
(`com.smilegate.outerplane.stove.google`) for the gear solver. **Status: working end-to-end.**

## Quick start (one button)

Prereqs once: LDPlayer 9 running with **ADB debugging = Local connection** and the
**Root toggle ON** (the game launches fine with it on).

```powershell
cd tools/capture
powershell -ExecutionPolicy Bypass -File .\capture.ps1     # arms + relaunches + live-decodes
powershell -ExecutionPolicy Bypass -File .\disarm.ps1      # tears everything down
```

`capture.ps1` installs the CA cert if needed, starts the MITM pipeline, relaunches the
game, and writes decoded JSON to `out/` (`user_item.json`, `user_character.json`, …). It
leaves the pipeline armed: the game stays fully playable and every later data fetch keeps
decoding into `out/`. Everything below is the manual explanation of what the script does.

## Summary of findings

- The game **splits its traffic**:
  - Asset/patch CDN over standard HTTPS (port 443) — *honors* the Android system proxy.
    Hosts: `kr-patch.outerplane.vagames.co.kr`, `glb-patch.outerplane.vagames.co.kr`.
  - **Game data** over HTTPS on **non-standard ports** via the Unity **BestHTTP/2** client,
    which **ignores** the system proxy. This is where account/inventory data lives.
- Game servers (from `…/files/Hosts` in the app's external storage):
  | Host | Port | Role |
  |------|------|------|
  | `glb-login.outerplane.vagames.co.kr` | 38002 | login / version check |
  | `glb-game.outerplane.vagames.co.kr`  | 38001 | **account, inventory, characters** |
  | `glb-chat.outerplane.vagames.co.kr`  | 38003 | chat (HTTPS + WSS) |
- **No certificate pinning.** A CA cert trusted by the system store is enough to MITM.
- Response bodies are JSON shaped `{"msg":"<hex>"}`. The hex decodes to bytes that are
  **repeating-key XOR** encrypted with the 21-byte ASCII key **`ASLDKGFJASPODIFJSOWEI`**.
  Decoded result is plain UTF-8 JSON. Same key for every endpoint.

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
SubOptionList[]      substats: { OptionID, Level (total ticks), BaseLevel (initial yellow ticks) }
                     orange/reforge ticks = Level - BaseLevel
```
- Substat `OptionID`s observed: `160001`–`160013` (13 stat types).
- Main-stat `OptionList` patterns: `(5024,5048)`, `(4024,0)`, `(3024,0)`, `(6024,6048)`, `(24,94/95/96)` …
- **TODO:** map `OptionID` → stat name + per-tick value (datamine the equipment DB / cross-check
  against in-game display, e.g. the equipped weapon read ATK 61.8% / Crit Chance 12% / Crit DMG 24% /
  DMG Increase 8% / Speed 9).

## Environment

- Emulator: **LDPlayer 9**, instance 0, **Android 9 (API 28)**, game targetSdk 35.
- `adb` bundled at `C:\LDPlayer\LDPlayer9\adb.exe`, device `127.0.0.1:5555`.
- `mitmproxy` 12.x at `C:\Program Files\mitmproxy\bin\mitmdump.exe`.
- Host LAN IP example: `192.168.1.204`. Game UID example: `10060` (varies).

## Reproduce (one-time setup)

1. **Enable ADB** in LDPlayer settings → ADB debugging = *Local connection*.
   `adb connect 127.0.0.1:5555`.
2. **Install the mitmproxy CA into the system store.** `adb root` is blocked on LDPlayer
   (production adbd) and `/system` is a read-only rootfs, so use a **bind mount** (needs the
   LDPlayer Root toggle ON temporarily — game closed; can be turned off after, but the bind
   mount is non-persistent and must be re-applied after any reboot):
   - Compute Android cert name: `openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.pem` → `<hash>.0`.
   - Push to `/sdcard`, then run `scripts/bind_cert.sh` as root (copies system certs + ours into
     `/data/local/tmp/cacerts`, then `mount --bind` over `/system/etc/security/cacerts`).
3. The game launches fine with the cert installed (and even with LDPlayer root on — no root
   detection blocked it in testing).

## Reproduce (each capture)

`capture.ps1` does it all (preferred):

```powershell
powershell -ExecutionPolicy Bypass -File .\capture.ps1
```

Manual equivalent:

1. Start mitmdump with the addon (decodes live, no `.flows` file needed):
   ```
   mitmdump -s addon.py \
     --mode "reverse:https://glb-game.outerplane.vagames.co.kr:38001@9001" \
     --mode "reverse:https://glb-login.outerplane.vagames.co.kr:38002@9002" \
     --listen-host 0.0.0.0
   ```
2. Tunnel + redirect on the device (`scripts/redir.sh` as root):
   ```
   adb reverse tcp:9001 tcp:9001 ; adb reverse tcp:9002 tcp:9002
   # device: iptables nat OUTPUT REDIRECT dport 38001→9001, 38002→9002 (route_localnet=1)
   ```
3. Force-stop + relaunch the game, tap "TOUCH TO START". `addon.py` writes
   `out/user_item.json`, `out/user_character.json` etc. on the fly and drops
   a `out/.captured` sentinel once `/user/item` is seen.

## Files

- `capture.ps1` / `disarm.ps1` — one-shot orchestration (arm + relaunch +
  live-decode / tear down). Vite dev server's "Arm capture" button wraps
  these via `/api/capture/run|disarm`.
- `addon.py` — mitmproxy addon: live XOR-decode of every `{"msg":"<hex>"}`
  body. Known endpoints land in `out/<name>.json`; unknown ones get
  written to `out/_unknown/` plus logged to `out/seen-paths.log` so new
  game endpoints are easy to discover after navigating the menus.
- `cert/c8750f0d.0` — mitmproxy CA in Android `subject_hash_old` format,
  pushed to the device by `capture.ps1`.
- `scripts/bind_cert.sh` — install CA via bind mount (run as root).
- `scripts/redir.sh` — iptables redirect of game ports to local
  reverse-proxy ports (run as root).
- `out/` — decoded capture snapshot.
