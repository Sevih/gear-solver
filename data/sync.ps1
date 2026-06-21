<#
  Refresh the raw game tables from the local Outerpedia checkout, then rebuild
  the distilled tables. Run after Outerpedia updates its data (game patch).

  Usage: powershell -ExecutionPolicy Bypass -File .\data\sync.ps1
#>
# Auto-detect the Outerpedia checkout — the path differs across the maintainer's
# two machines. Override explicitly with `-Source <path>` if needed.
param(
  [string]$Source
)
$ErrorActionPreference = "Stop"
$dst = Join-Path $PSScriptRoot "game"

if (-not $Source) {
  $candidates = @(
    "C:\Users\Sevih\Documents\Projet perso\outerpedia-v2\data\admin\json2",
    "C:\Users\Sevih\Documents\dev\outerpedia\data\admin\json2"
  )
  $Source = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

# Only the subset the engine needs (keeps the repo small).
$files = @(
  "ItemTemplet.json","ItemOptionTemplet.json","ItemSpecialOptionTemplet.json",
  "ItemOptionChangeTemplet.json","ItemBreakLimitTemplet.json","ItemEnchantTemplet.json",
  "ItemEnchantExpTemplet.json","ItemSmeltingTemplet.json","SingularityEquipEnchantTemplet.json",
  "SingularityGradeTemplet.json","SingularityOptionPopUpTemplet.json","SpecialEquipEnchantTemplet.json",
  "CharacterTemplet.json","CharacterEvolutionStatTemplet.json","GameConfigTemplet.json",
  "CharacterArchiveStatTemplet.json","ArchiveBonusTemplet.json","CharacterTranscendentTemplet.json",
  "CharacterSkillLevelTemplet.json","CharacterAwakeningLevelTemplet.json",
  "CharacterAwakeningNodeTemplet.json","CharacterFusionTemplet.json",
  "CharacterMaxLevelTemplet.json","ExpCharacterTemplet.json",
  "BuffTemplet.json","TrustBuffTemplet.json",
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
