[CmdletBinding()]
param(
  [string]$OwnerUserId = "user_admin",
  [int]$UiPort = 38500
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "shared-runtime.ps1")

function Get-ListeningProcessIds {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $connections) {
    return @()
  }

  return @(
    $connections |
      Select-Object -ExpandProperty OwningProcess -Unique |
      Where-Object { $_ -is [int] -and $_ -gt 0 }
  )
}

function Stop-PortOccupants {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $pids = Get-ListeningProcessIds -Port $Port
  foreach ($listenerPid in $pids) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }
}

function Read-Pid {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PidFile
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    return $null
  }

  $raw = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $parsed = 0
  if ([int]::TryParse($raw, [ref]$parsed)) {
    return $parsed
  }
  return $null
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidsRoot = Join-Path (Join-Path $repoRoot "runtime") "pids"
$agentAlias = Get-FlowAgentAlias -OwnerUserId $OwnerUserId
$pidFile = Join-Path $pidsRoot "local-agent-$agentAlias.pid"

$managedPid = Read-Pid -PidFile $pidFile
if ($managedPid) {
  Stop-Process -Id $managedPid -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

Stop-PortOccupants -Port $UiPort

Write-Host "Flow agent stopped for $OwnerUserId on port $UiPort."
