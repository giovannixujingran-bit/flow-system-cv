[CmdletBinding()]
param(
  [string]$OwnerUserId = "",
  [string]$AgentName = "",
  [string]$HostIp = "192.168.40.105",
  [int]$UiPort = 38500,
  [switch]$Restart,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-flow-agent.ps1"

if ([string]::IsNullOrWhiteSpace($OwnerUserId)) {
  $OwnerUserId = (Read-Host "Enter your OwnerUserId").Trim()
}

if ([string]::IsNullOrWhiteSpace($OwnerUserId)) {
  throw "OwnerUserId is required."
}

if ([string]::IsNullOrWhiteSpace($AgentName)) {
  $defaultAgentName = $env:COMPUTERNAME
  $agentInput = Read-Host ("Enter AgentName [{0}]" -f $defaultAgentName)
  $AgentName = if ([string]::IsNullOrWhiteSpace($agentInput)) { $defaultAgentName } else { $agentInput.Trim() }
}

if (-not $PSBoundParameters.ContainsKey("HostIp")) {
  $hostInput = Read-Host ("Enter shared host IP [{0}]" -f $HostIp)
  if (-not [string]::IsNullOrWhiteSpace($hostInput)) {
    $HostIp = $hostInput.Trim()
  }
}

$platformWebOrigin = "http://{0}:3000" -f $HostIp
$platformApiBaseUrl = "http://{0}:4010" -f $HostIp

Write-Host ("[flow-system] Connecting this PC to shared host {0}" -f $HostIp)

& $startScript `
  -OwnerUserId $OwnerUserId `
  -AgentName $AgentName `
  -AutoRegister `
  -BootstrapToken "" `
  -PlatformApiBaseUrl $platformApiBaseUrl `
  -PlatformWebOrigin $platformWebOrigin `
  -UiPort $UiPort `
  -Restart:$Restart

Write-Host ""
Write-Host "Next steps:"
Write-Host ("  1. Open {0}/login" -f $platformWebOrigin)
Write-Host "  2. Sign in with your Flow System account"
Write-Host "  3. Open the Agents page and connect OpenClaw for this PC"

if (-not $NoOpen) {
  Start-Process ("{0}/login" -f $platformWebOrigin) | Out-Null
}
