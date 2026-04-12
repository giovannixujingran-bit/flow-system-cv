[CmdletBinding()]
param(
  [ValidateSet("windows")][string]$HostMode = "windows",
  [string]$OwnerUserId = "user_admin",
  [int]$UiPort = 38500,
  [string]$PlatformWebOrigin = "http://127.0.0.1:3000",
  [switch]$Restart,
  [switch]$SkipAutostartRegistration
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Ensure-AutostartTask {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$HostMode,
    [Parameter(Mandatory = $true)][string]$OwnerUserId,
    [Parameter(Mandatory = $true)][int]$UiPort,
    [Parameter(Mandatory = $true)][string]$PlatformWebOrigin
  )

  $taskName = "Flow System Overlay - $OwnerUserId"
  $repoRoot = Split-Path -Parent (Split-Path -Parent $ScriptPath)
  $entryPoint = Join-Path $repoRoot "start-flow-overlay.cmd"
  $action = "cmd.exe /c `"`"$entryPoint`" -HostMode $HostMode -OwnerUserId $OwnerUserId -UiPort $UiPort -PlatformWebOrigin $PlatformWebOrigin -SkipAutostartRegistration`""
  schtasks.exe /Create /F /SC ONLOGON /TN $taskName /TR $action | Out-Null
}

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

function Start-WindowsOverlay {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$OwnerUserId,
    [Parameter(Mandatory = $true)][int]$UiPort,
    [Parameter(Mandatory = $true)][string]$PlatformWebOrigin,
    [Parameter(Mandatory = $true)][switch]$Restart
  )

  $runtimeRoot = Join-Path $RepoRoot "runtime"
  $logsRoot = Join-Path $runtimeRoot "logs"
  $pidsRoot = Join-Path $runtimeRoot "pids"
  $overlayAlias = ($OwnerUserId -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
  $overlayDataRoot = Join-Path $runtimeRoot "overlay-data\$overlayAlias"
  $logFile = Join-Path $logsRoot "desktop-overlay-$overlayAlias.log"
  $pidFile = Join-Path $pidsRoot "desktop-overlay-$overlayAlias.pid"
  $readyFile = Join-Path $overlayDataRoot "ready.json"
  $nativeHostScript = Join-Path $RepoRoot "apps\desktop-overlay-native\overlay-host.ps1"

  Ensure-Directory -Path $runtimeRoot
  Ensure-Directory -Path $logsRoot
  Ensure-Directory -Path $pidsRoot
  Ensure-Directory -Path $overlayDataRoot

  if ($Restart -and (Test-Path -LiteralPath $pidFile)) {
    Stop-NativeOverlayProcesses -OwnerUserId $OwnerUserId -NativeHostScript $nativeHostScript -PidFile $pidFile
  }

  Stop-NativeOverlayProcesses -OwnerUserId $OwnerUserId -NativeHostScript $nativeHostScript -PidFile $pidFile

  Remove-Item -LiteralPath $readyFile -ErrorAction SilentlyContinue
  Clear-Content -LiteralPath $logFile -ErrorAction SilentlyContinue

  $process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-STA",
    "-WindowStyle", "Hidden",
    "-File", $nativeHostScript,
    "-OwnerUserId", $OwnerUserId,
    "-UiPort", $UiPort,
    "-PlatformWebOrigin", $PlatformWebOrigin,
    "-OverlayDataRoot", $overlayDataRoot,
    "-ReadyFile", $readyFile,
    "-LogFile", $logFile
  ) -PassThru

  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
      throw "Windows native overlay exited before becoming ready. Log: $logFile"
    }
    if (Test-Path -LiteralPath $readyFile) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    throw "Windows native overlay did not become ready. Log: $logFile"
  }

  Write-Host ""
  Write-Host "Flow desktop overlay is running:"
  Write-Host "  Host Mode     : windows"
  Write-Host "  Owner User ID : $OwnerUserId"
  Write-Host "  Local Agent   : http://127.0.0.1:$UiPort/"
  Write-Host "  Overlay Data  : $overlayDataRoot"
  Write-Host "  Logs          : $logFile"
}

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SkipAutostartRegistration) {
  Ensure-AutostartTask -ScriptPath $PSCommandPath -HostMode $HostMode -OwnerUserId $OwnerUserId -UiPort $UiPort -PlatformWebOrigin $PlatformWebOrigin
}

Start-WindowsOverlay -RepoRoot $repoRoot -OwnerUserId $OwnerUserId -UiPort $UiPort -PlatformWebOrigin $PlatformWebOrigin -Restart:$Restart
