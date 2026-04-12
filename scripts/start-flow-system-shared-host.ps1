[CmdletBinding()]
param(
  [string]$LanIp = "",
  [switch]$Restart,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

function Test-PrivateIpv4 {
  param([string]$Address)

  return $Address -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
}

function Test-VirtualInterfaceName {
  param([string]$InterfaceAlias)

  if ([string]::IsNullOrWhiteSpace($InterfaceAlias)) {
    return $false
  }

  return $InterfaceAlias -match 'vEthernet|WSL|Hyper-V|Virtual|VMware|VirtualBox|Tailscale|Clash|SSTAP|VPN|Loopback'
}

function Get-PreferredLanIp {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -and
      (Test-PrivateIpv4 -Address $_.IPAddress) -and
      $_.IPAddress -notlike '127.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Sort-Object InterfaceMetric, SkipAsSource

  $preferred = $candidates | Where-Object { -not (Test-VirtualInterfaceName -InterfaceAlias $_.InterfaceAlias) } | Select-Object -First 1
  if ($preferred) {
    return $preferred.IPAddress
  }

  $fallback = $candidates | Select-Object -First 1
  if ($fallback) {
    return $fallback.IPAddress
  }

  throw "No private LAN IPv4 address was found on this machine."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-flow-system.ps1"

if ([string]::IsNullOrWhiteSpace($LanIp)) {
  $LanIp = Get-PreferredLanIp
}

$platformWebOrigin = "http://{0}:3000" -f $LanIp
$platformApiBaseUrl = "http://{0}:4010" -f $LanIp

Write-Host ("[flow-system] Starting shared host mode on {0}" -f $LanIp)

& $startScript `
  -BindHost "0.0.0.0" `
  -AllowLanAutoRegister `
  -EnableLanProxy `
  -PlatformWebOrigin $platformWebOrigin `
  -PlatformApiBaseUrl $platformApiBaseUrl `
  -Restart:$Restart `
  -NoOpen:$NoOpen

Write-Host ""
Write-Host "Share these URLs with other users:"
Write-Host ("  Platform Web : {0}/login" -f $platformWebOrigin)
Write-Host ("  Platform API : {0}/health" -f $platformApiBaseUrl)
