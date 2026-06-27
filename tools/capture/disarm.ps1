<#
  Tear down the capture pipeline: stop mitmproxy, remove the iptables redirect,
  the adb reverse tunnels, and the residual proxy setting. The system-store
  cert (bind mount) persists until the emulator instance reboots; the LDPlayer
  Root toggle can be turned off after if you want.
#>
param(
  [string]$Device   = "127.0.0.1:5555",
  [string]$Adb      = "C:\LDPlayer\LDPlayer9\adb.exe",
  # The four args below are unused here - they exist for arg-shape parity
  # with capture.ps1 so the same extraArgs array can drive either script
  # from the Electron prod server without branching.
  [string]$Mitmdump    = $null,
  [string]$MitmConfDir = $null,
  [string]$CertDir     = $null,
  # Where the previously-armed pipeline left its .mitm.pid file. Same
  # default story as capture.ps1.
  [string]$Out         = $null
)
$ErrorActionPreference = "SilentlyContinue"
$Root = $PSScriptRoot
if (-not $Out) { $Out = Join-Path $Root "out" }

# Silence-by-default adb wrapper - all the teardown adb calls below are
# advisory (the device may already be in the target state) and their stdout
# is uninteresting noise. Same NativeCommandError dance as capture.ps1's
# MuteAdb: local $EAP=SilentlyContinue swallows the wrapped stderr records.
function MuteAdb {
  $ErrorActionPreference = "SilentlyContinue"
  & $script:Adb -s $Device @args 2>$null | Out-Null
}

Write-Host ">  Stopping mitmproxy..." -ForegroundColor Cyan
$pidFile = Join-Path $Out ".mitm.pid"
if (Test-Path $pidFile) {
  $procId = Get-Content $pidFile
  if ($procId) { Stop-Process -Id $procId -Force }
  Remove-Item $pidFile
}
# Safety net: also kill any orphan mitmdump that wasn't tracked via .mitm.pid
# (older arm sessions, manual launches, ...).
Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host ">  Removing iptables + tunnels + proxy..." -ForegroundColor Cyan
& $Adb -s $Device shell "su -c 'iptables -t nat -D OUTPUT -p tcp --dport 38001 -j REDIRECT --to-ports 9001 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 38002 -j REDIRECT --to-ports 9002 2>/dev/null'" 2>$null | Out-Null
MuteAdb reverse --remove tcp:9001
MuteAdb reverse --remove tcp:9002
MuteAdb shell settings delete global http_proxy
MuteAdb shell settings put global http_proxy ":0"

# --- codex + geas summary -------------------------------------------------
# These two land only AFTER capture.ps1 exits (the pipeline stays armed so the
# user can open the Hero Archive / Codex and Gift screens in-game). capture.ps1
# already confirmed inventory + heroes; disarm is the natural moment to confirm
# the codex (/archive/info) and geas/quirk (/gift/info) catch, mirroring that
# summary. Best-effort via python (may be absent in a packaged build).
Write-Host ">  Codex + geas summary:" -ForegroundColor Cyan
$summary = @"
import json,os
o=r'$Out'
def load(n):
  p=os.path.join(o,n)
  return json.load(open(p,encoding='utf-8')) if os.path.exists(p) else None
ar=load('user_archive.json'); gf=load('user_gift.json')
if ar:
  r=ar.get('ArchiveItemRewardInfo',[]); lv=[x.get('RewardLevel') for x in r]
  print('   codex captured + decoded: %d reward tiers (levels %s)'%(len(r),lv))
else:
  print('   codex NOT captured - open the Hero Archive (Codex) screen in-game, then disarm')
if gf:
  print('   geas/quirk captured + decoded: %d gift nodes'%len(gf.get('GiftList',[])))
else:
  print('   geas/quirk NOT captured - open the Gift screen in-game, then disarm')
"@
$tmp = Join-Path $env:TEMP "op_disarm_summary.py"
$summary | Out-File -Encoding utf8 $tmp
try { & python $tmp 2>$null } catch {}

Write-Host "v  Pipeline disarmed. Game traffic is back to normal (system cert persists until emulator reboot)." -ForegroundColor Green
