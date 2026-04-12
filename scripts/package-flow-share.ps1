[CmdletBinding()]
param(
  [string]$OutputRoot,
  [switch]$KeepStage
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Invoke-Robocopy {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirectories = @()
  )

  Ensure-Directory -Path $Destination

  $arguments = @(
    $Source,
    $Destination,
    "/E",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP"
  )

  if ($ExcludeDirectories.Count -gt 0) {
    $arguments += "/XD"
    $arguments += $ExcludeDirectories
  }

  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE for $Source"
  }
}

function Get-ZipSampleEntries {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [int]$Take = 20
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    return @($archive.Entries | Select-Object -First $Take -ExpandProperty FullName)
  } finally {
    $archive.Dispose()
  }
}

function Get-RepoVersion {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $packageJsonPath = Join-Path $RepoRoot "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    return "0.1.0"
  }

  try {
    $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
    if ($packageJson.version) {
      return [string]$packageJson.version
    }
  } catch {
    return "0.1.0"
  }

  return "0.1.0"
}

function Write-BundleCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Action
  )

  $content = @"
@echo off
setlocal
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%flow-system\scripts\manage-flow-system-distribution.ps1"

if not exist "%SCRIPT%" (
  echo [flow-system] Script not found: "%SCRIPT%"
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action $Action -LocalSourceRoot "%ROOT%flow-system" %*
if errorlevel 1 (
  echo.
  echo [flow-system] $Action failed.
  pause
  exit /b 1
)

echo.
echo [flow-system] $Action completed.
echo Restart the Flow System using the startup script you normally use on this PC.
pause
exit /b 0
"@

  Set-Content -LiteralPath $Path -Value $content -Encoding ascii
}

function Write-BundleReadme {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Version
  )

  $content = @"
Flow System Offline Bundle
Version: $Version

What this bundle is for:
- Share this zip with another Windows PC.
- It updates that PC to the exact Flow System source snapshot inside this bundle.

How to use it:
1. Extract the zip.
2. If Flow System is already installed on that PC, double-click update-flow-system-from-bundle.cmd
3. If Flow System is not installed yet, double-click install-flow-system-from-bundle.cmd
4. After the script finishes, restart Flow System using the startup script normally used on that PC.

Notes:
- The default install path is %USERPROFILE%\OpenClawProjects\flow-system
- Update keeps local runtime and storage data based on flow-system-distribution.config.json
- Repo-local skills inside flow-system\skills are synced during install/update
"@

  Set-Content -LiteralPath $Path -Value $content -Encoding ascii
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
$openclawRoot = Split-Path -Parent $workspaceRoot
$repoVersion = Get-RepoVersion -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $openclawRoot "release"
}

$flowSource = $repoRoot

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundleName = "flow-system-share-v$repoVersion-$timestamp"
$stageRoot = Join-Path $OutputRoot $bundleName
$zipPath = Join-Path $OutputRoot "$bundleName.zip"

Ensure-Directory -Path $OutputRoot

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$bundleRepoRoot = Join-Path $stageRoot "flow-system"
Ensure-Directory -Path $bundleRepoRoot

Invoke-Robocopy -Source $flowSource -Destination $bundleRepoRoot -ExcludeDirectories @(
  (Join-Path $flowSource ".git"),
  (Join-Path $flowSource "node_modules"),
  (Join-Path $flowSource "runtime"),
  (Join-Path $flowSource "storage"),
  (Join-Path $flowSource "release"),
  (Join-Path $flowSource "apps\platform-web\.next"),
  (Join-Path $flowSource "apps\platform-web\.next-dev")
)

Write-BundleCommand -Path (Join-Path $stageRoot "update-flow-system-from-bundle.cmd") -Action "update"
Write-BundleCommand -Path (Join-Path $stageRoot "install-flow-system-from-bundle.cmd") -Action "install"
Write-BundleReadme -Path (Join-Path $stageRoot "README-OFFLINE-BUNDLE.txt") -Version $repoVersion

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force

$zipInfo = Get-Item -LiteralPath $zipPath
$result = [pscustomobject]@{
  zip_path = $zipInfo.FullName
  size_mb = [math]::Round($zipInfo.Length / 1MB, 2)
  keep_stage = [bool]$KeepStage
  stage_path = if ($KeepStage) { $stageRoot } else { $null }
  sample_entries = Get-ZipSampleEntries -ZipPath $zipPath
}

if (-not $KeepStage -and (Test-Path -LiteralPath $stageRoot)) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

$result | ConvertTo-Json -Depth 5
