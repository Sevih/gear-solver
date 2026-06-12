<#
  Refresh the raw game tables from the local Outerpedia checkout, then rebuild
  the distilled tables. Run after Outerpedia updates its data (game patch).

  Usage: powershell -ExecutionPolicy Bypass -File .\data\sync.ps1
#>
param(
  [string]$Source = "C:\Users\Sevih\Documents\dev\outerpedia\data\admin\json2"
)
$ErrorActionPreference = "Stop"
$dst = Join-Path $PSScriptRoot "game"

# Only the subset the engine needs (keeps the repo small).
$files = @(
  "ItemTemplet.json","ItemOptionTemplet.json","ItemSpecialOptionTemplet.json",
  "ItemOptionChangeTemplet.json","ItemBreakLimitTemplet.json","ItemEnchantTemplet.json",
  "ItemEnchantExpTemplet.json","ItemSmeltingTemplet.json","SingularityEquipEnchantTemplet.json",
  "SingularityGradeTemplet.json","SingularityOptionPopUpTemplet.json","SpecialEquipEnchantTemplet.json",
  "CharacterTemplet.json","CharacterEvolutionStatTemplet.json","GameConfigTemplet.json",
  "TextItem.json","TextCharacter.json","TextSystem.json"
)
if (-not (Test-Path $Source)) { Write-Host "[X] Source introuvable: $Source" -ForegroundColor Red; exit 1 }
$n = 0
foreach ($f in $files) {
  $src = Join-Path $Source $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $dst $f) -Force; $n++ }
  else { Write-Host "[!] manquant: $f" -ForegroundColor Yellow }
}
Write-Host "[OK] $n fichiers copies dans data/game" -ForegroundColor Green
Push-Location (Split-Path $PSScriptRoot -Parent)
node data/build.mjs
Pop-Location
