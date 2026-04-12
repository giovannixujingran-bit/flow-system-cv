[CmdletBinding()]
param(
  [ValidateSet("windows", "all")][string]$HostMode = "all",
  [string]$OwnerUserId = "user_admin"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidsRoot = Join-Path (Join-Path $repoRoot "runtime") "pids"
$overlayAlias = ($OwnerUserId -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
$pidFile = Join-Path $pidsRoot "desktop-overlay-$overlayAlias.pid"
$nativeHostScript = Join-Path $repoRoot "apps\desktop-overlay-native\overlay-host.ps1"

function Stop-NativeOverlayProcesses {
  param(
    [Parameter(Mandatory = $true)][string]$OwnerUserId,
    [Parameter(Mandatory = $true)][string]$NativeHostScript,
    [string]$PidFile
  )

  $candidateIds = New-Object System.Collections.Generic.HashSet[int]
  if ($PidFile -and (Test-Path -LiteralPath $PidFile)) {
    $raw = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed)) {
      [void]$candidateIds.Add($parsed)
    }
  }

  $escapedScript = [Regex]::Escape($NativeHostScript)
  $escapedOwner = [Regex]::Escape($OwnerUserId)
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "powershell.exe" -and
    $_.CommandLine -match $escapedScript -and
    $_.CommandLine -match ("-OwnerUserId\s+" + $escapedOwner + "(\s|$)")
  }

  foreach ($process in $processes) {
    [void]$candidateIds.Add([int]$process.ProcessId)
  }

  foreach ($processId in $candidateIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }

  if ($PidFile) {
    Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
  }
}

if ($HostMode -in @("windows", "all")) {
  Stop-NativeOverlayProcesses -OwnerUserId $OwnerUserId -NativeHostScript $nativeHostScript -PidFile $pidFile
}

Write-Host "Flow desktop overlay stopped for $OwnerUserId."
