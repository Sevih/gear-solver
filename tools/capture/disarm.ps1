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

Write-Host "v  Pipeline disarmed. Game traffic is back to normal (system cert persists until emulator reboot)." -ForegroundColor Green
