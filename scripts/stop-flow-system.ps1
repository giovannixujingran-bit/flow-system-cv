[CmdletBinding()]
param(
)

$ErrorActionPreference = "Stop"

function Test-PortOpen {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

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
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $pids = Get-ListeningProcessIds -Port $Port
  foreach ($listenerPid in $pids) {
    $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }
    Write-Host ("[{0}] stopping port occupant pid {1} ({2})" -f $Name, $listenerPid, $process.ProcessName)
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }

  if ($pids.Count -gt 0) {
    Start-Sleep -Seconds 1
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

$services = @(
  @{ Name = "platform-api"; Port = 4010; PidFile = Join-Path $pidsRoot "platform-api.pid" },
  @{ Name = "platform-web"; Port = 3000; PidFile = Join-Path $pidsRoot "platform-web.pid" },
  @{ Name = "local-agent-admin"; Port = 38500; PidFile = Join-Path $pidsRoot "local-agent-admin.pid" },
  @{ Name = "local-agent-owner"; Port = 38500; PidFile = Join-Path $pidsRoot "local-agent-owner.pid" },
  @{ Name = "local-agent-member"; Port = 38501; PidFile = Join-Path $pidsRoot "local-agent-member.pid" },
  @{ Name = "local-agent-admin-demo"; Port = 38502; PidFile = Join-Path $pidsRoot "local-agent-admin.pid" }
)

foreach ($service in $services) {
  $managedPid = Read-Pid -PidFile $service.PidFile
  if ($managedPid) {
    $process = Get-Process -Id $managedPid -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host ("[{0}] stopping pid {1}" -f $service.Name, $managedPid)
      Stop-Process -Id $managedPid -Force
    } else {
      Write-Host ("[{0}] pid file exists but process {1} is already gone" -f $service.Name, $managedPid)
    }
    Remove-Item -LiteralPath $service.PidFile -ErrorAction SilentlyContinue
  } else {
    Write-Host ("[{0}] no managed pid file" -f $service.Name)
  }

  if (Test-PortOpen -Port $service.Port) {
    Stop-PortOccupants -Name $service.Name -Port $service.Port
  }
}

Start-Sleep -Seconds 1

foreach ($service in $services) {
  if (Test-PortOpen -Port $service.Port) {
    Write-Warning ("[{0}] port {1} is still open. It may be an older unmanaged process." -f $service.Name, $service.Port)
  } else {
    Write-Host ("[{0}] stopped" -f $service.Name)
  }
}
