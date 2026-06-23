<#
  Retire le pipeline de capture : arrete mitmproxy, enleve la redirection iptables,
  les tunnels adb reverse et le proxy. Le cert systeme (bind mount) reste jusqu'au
  prochain redemarrage de l'instance. Tu peux ensuite recouper le Root LDPlayer si tu veux.
#>
param(
  [string]$Device   = "127.0.0.1:5555",
  [string]$Adb      = "C:\LDPlayer\LDPlayer9\adb.exe",
  # The four args below are unused here — they exist for arg-shape parity
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

function Adb { & $Adb -s $Device @args }

Write-Host "[*] Arret de mitmproxy..." -ForegroundColor Cyan
$pidFile = Join-Path $Out ".mitm.pid"
if (Test-Path $pidFile) {
  $procId = Get-Content $pidFile
  if ($procId) { Stop-Process -Id $procId -Force }
  Remove-Item $pidFile
}
# filet de securite : tuer tout mitmdump restant
Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "[*] Retrait iptables + tunnels + proxy..." -ForegroundColor Cyan
& $Adb -s $Device shell "su -c 'iptables -t nat -D OUTPUT -p tcp --dport 38001 -j REDIRECT --to-ports 9001 2>/dev/null; iptables -t nat -D OUTPUT -p tcp --dport 38002 -j REDIRECT --to-ports 9002 2>/dev/null'" | Out-Null
Adb reverse --remove tcp:9001 | Out-Null
Adb reverse --remove tcp:9002 | Out-Null
Adb shell settings delete global http_proxy | Out-Null
Adb shell settings put global http_proxy ":0" | Out-Null

Write-Host "[OK] Pipeline retire. Jeu en etat normal (cert systeme persiste jusqu'au reboot)." -ForegroundColor Green
