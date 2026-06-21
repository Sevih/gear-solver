<#
  Outerplane gear-solver — one-shot capture.
  Arms the MITM pipeline, relaunches the game, and live-decodes the account data
  into .\out\ as clean JSON. Leaves the pipeline armed so any later in-game data
  fetch keeps decoding automatically. Run .\disarm.ps1 to tear everything down.

  Prereqs (one time):
    - LDPlayer 9 instance running, ADB debugging = Local connection.
    - LDPlayer Root toggle ON (needed to install the CA cert + iptables).
      The game launches fine with it on.
  Usage:
    powershell -ExecutionPolicy Bypass -File .\capture.ps1
    powershell -ExecutionPolicy Bypass -File .\capture.ps1 -NoRelaunch   # just arm, don't restart the game
#>
param(
  [string]$Device   = "127.0.0.1:5555",
  [string]$Adb      = "C:\LDPlayer\LDPlayer9\adb.exe",
  [string]$Mitmdump = "C:\Program Files\mitmproxy\bin\mitmdump.exe",
  [int]$TimeoutSec  = 150,
  [switch]$NoRelaunch
)
$ErrorActionPreference = "Stop"
$Root   = $PSScriptRoot
$Out    = Join-Path $Root "out"
$Pkg    = "com.smilegate.outerplane.stove.google"
$CertHashFile = "c8750f0d.0"   # mitmproxy CA, Android subject_hash_old name

function Adb { & $Adb -s $Device @args }
function Su($cmd) { & $Adb -s $Device shell "su -c '$cmd'" }

function Die($m) { Write-Host "[X] $m" -ForegroundColor Red; exit 1 }
function Ok($m)  { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[*] $m" -ForegroundColor Cyan }

# --- preflight ---
if (-not (Test-Path $Adb))      { Die "adb introuvable: $Adb" }
if (-not (Test-Path $Mitmdump)) { Die "mitmdump introuvable: $Mitmdump" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

Info "Connexion ADB..."
& $Adb connect $Device | Out-Null
$state = (Adb get-state) 2>$null
if ($state -ne "device") { Die "device $Device pas pret (etat=$state). Lance LDPlayer + active ADB." }
Ok "device $Device"

$id = Su "id" 2>$null
if ($id -notmatch "uid=0") { Die "Root indisponible (su a echoue). Active le toggle Root de LDPlayer (instance redemarree)." }
Ok "root disponible"

# --- 1. cert systeme (bind mount, idempotent) ---
$certPresent = Su "ls /system/etc/security/cacerts/$CertHashFile 2>/dev/null"
if ($certPresent -match $CertHashFile) {
  Ok "cert deja installe dans le store systeme"
} else {
  Info "Installation du cert (bind mount)..."
  Adb push (Join-Path $Root "cert\$CertHashFile") "/sdcard/$CertHashFile" | Out-Null
  Adb push (Join-Path $Root "scripts\bind_cert.sh") "/sdcard/bind_cert.sh" | Out-Null
  Su "sh /sdcard/bind_cert.sh" | Out-Null
  $certPresent = Su "ls /system/etc/security/cacerts/$CertHashFile 2>/dev/null"
  if ($certPresent -notmatch $CertHashFile) { Die "echec installation cert" }
  Ok "cert installe"
}

# --- 2. demarrer mitmproxy reverse + addon (live decode) ---
# kill un eventuel ancien daemon
$pidFile = Join-Path $Out ".mitm.pid"
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $Out ".captured") -ErrorAction SilentlyContinue

$env:OP_OUT = $Out
$log = Join-Path $Out "mitm.log"
$flows = Join-Path $Out "game.flows"
# Start-Process w/ -ArgumentList does NOT auto-quote args containing spaces on
# Windows PS 5.1 (see PowerShell/PowerShell#5576). Wrap any path arg whose
# value can contain whitespace (here: $Root, $flows) — else `mitmdump -s …\Projet perso\…\addon.py`
# is parsed as two args and mitmdump dies with "No such script".
function Quote($s) { if ($s -match '\s') { '"' + $s + '"' } else { $s } }
$mitmArgs = @(
  "--mode","reverse:https://glb-game.outerplane.vagames.co.kr:38001@9001",
  "--mode","reverse:https://glb-login.outerplane.vagames.co.kr:38002@9002",
  "--listen-host","0.0.0.0",
  "-s", (Quote (Join-Path $Root "addon.py")),
  "-w", (Quote $flows),
  "--set","flow_detail=0"
)
Info "Demarrage mitmproxy reverse (decode en direct)..."
$proc = Start-Process -FilePath $Mitmdump -ArgumentList $mitmArgs -PassThru -WindowStyle Hidden `
          -RedirectStandardOutput $log -RedirectStandardError "$log.err"
$proc.Id | Out-File -Encoding ascii $pidFile
Start-Sleep -Seconds 3
if ($proc.HasExited) { Die "mitmdump s'est arrete (voir $log.err)" }
Ok "mitmproxy actif (pid $($proc.Id)), ports 9001/9002"

# --- 3. tunnel + redirection iptables (idempotent) ---
Info "Tunnel adb + redirection iptables..."
Adb reverse tcp:9001 tcp:9001 | Out-Null
Adb reverse tcp:9002 tcp:9002 | Out-Null
Adb push (Join-Path $Root "scripts\redir.sh") "/sdcard/redir.sh" | Out-Null
Su "sh /sdcard/redir.sh" | Out-Null
# le jeu route les ports de jeu via le proxy : on neutralise un eventuel proxy http residuel
Adb shell settings put global http_proxy ":0" | Out-Null
Ok "pipeline arme (ports 38001->9001, 38002->9002)"

# --- 4. relancer le jeu pour declencher le fetch ---
if (-not $NoRelaunch) {
  Info "Relance du jeu..."
  Adb shell am force-stop $Pkg | Out-Null
  Adb shell "monkey -p $Pkg -c android.intent.category.LAUNCHER 1" | Out-Null
  # auto-tap 'TOUCH TO START' apres le chargement initial
  Start-Sleep -Seconds 12
  1..6 | ForEach-Object { Adb shell input tap 880 400 | Out-Null; Start-Sleep -Milliseconds 2500 }
}

# --- 5. attendre la capture de l'inventaire ---
Info "Attente de /user/item (max ${TimeoutSec}s)... joue jusqu'au lobby si besoin."
$captured = $false
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  if (Test-Path (Join-Path $Out ".captured")) { $captured = $true; break }
  Start-Sleep -Seconds 2
}

if (-not $captured) {
  Write-Host ""
  Write-Host "[!] Inventaire pas encore capture. Le pipeline reste ARME :" -ForegroundColor Yellow
  Write-Host "    entre simplement dans le jeu (lobby) et les donnees seront decodees dans .\out\." -ForegroundColor Yellow
  Write-Host "    Verifie l'etat avec: type `"$Out\mitm.log`"" -ForegroundColor Yellow
  exit 2
}

Ok "inventaire capture et decode."
# --- 6. resume ---
$summary = @"
import json,os
o=r'$Out'
def load(n):
  p=os.path.join(o,n)
  return json.load(open(p,encoding='utf-8')) if os.path.exists(p) else None
it=load('user_item.json'); ch=load('user_character.json')
if it:
  il=it['ItemList']; eq=[x for x in il if x['CharUID']!='0']
  print('  gear: %d pieces (%d equipees, %d libres)'%(len(il),len(eq),len(il)-len(eq)))
if ch:
  cl=ch.get('CharList',[]); print('  heros: %d'%len(cl))
print('  fichiers JSON: '+', '.join(sorted(f for f in os.listdir(o) if f.endswith('.json'))))
"@
$tmp = Join-Path $env:TEMP "op_summary.py"
$summary | Out-File -Encoding utf8 $tmp
Write-Host ""
Write-Host "=== Resultat (dans .\out\) ===" -ForegroundColor Green
python $tmp
Write-Host ""
Write-Host "Pipeline laisse ARME : toute nouvelle visite d'ecran rafraichit les JSON." -ForegroundColor Cyan
Write-Host "Pour tout retirer : .\disarm.ps1" -ForegroundColor Cyan
