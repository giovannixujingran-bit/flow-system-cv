[CmdletBinding()]
param(
  [ValidateSet("Auto", "Native")]
  [string]$RuntimeMode = "Auto",
  [string]$OwnerUserId = "user_admin",
  [string]$AgentName = "ADMIN-PC",
  [string]$BootstrapToken = "flow-bootstrap-local",
  [switch]$AutoRegister,
  [string]$PlatformApiBaseUrl = "http://127.0.0.1:4010",
  [string]$PlatformWebOrigin = "",
  [int]$UiPort = 38500,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "shared-runtime.ps1")

function Get-WebOriginFromApiBase {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl
  )

  try {
    $builder = [System.UriBuilder]::new($ApiBaseUrl)
    if ($builder.Port -eq 4010) {
      $builder.Port = 3000
    }
    $builder.Path = ""
    $builder.Query = ""
    $builder.Fragment = ""
    return $builder.Uri.GetLeftPart([System.UriPartial]::Authority)
  } catch {
    return "http://127.0.0.1:3000"
  }
}

if ([string]::IsNullOrWhiteSpace($PlatformWebOrigin)) {
  $PlatformWebOrigin = Get-WebOriginFromApiBase -ApiBaseUrl $PlatformApiBaseUrl
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtime = Get-FlowWindowsRuntime -RepoRoot $repoRoot
$agentAlias = Get-FlowAgentAlias -OwnerUserId $OwnerUserId
$serviceName = "local-agent-$agentAlias"
$flowRoot = Join-Path $runtime.RuntimeRoot ("agents\{0}" -f $agentAlias)
$overlayDataRoot = Join-Path $runtime.RuntimeRoot ("overlay-data\{0}" -f $agentAlias)
$logFile = Join-Path $runtime.LogsRoot ("{0}.log" -f $serviceName)
$pidFile = Join-Path $runtime.PidsRoot ("{0}.pid" -f $serviceName)
$bootstrapFile = Join-Path $runtime.BootstrapRoot ("{0}-native.cmd" -f $serviceName)
$probeUrl = "http://127.0.0.1:$UiPort/health"

Ensure-Directory -Path $flowRoot
Ensure-Directory -Path $overlayDataRoot

if ($Restart) {
  Stop-ManagedProcess -Name $serviceName -PidFile $pidFile -Port $UiPort
}

if ((-not $Restart) -and (Test-HttpReachable -Url $probeUrl)) {
  Write-Host ("[{0}] already reachable on http://127.0.0.1:{1}/" -f $serviceName, $UiPort)
  return
}

if (Test-PortOpen -Port $UiPort) {
  Stop-PortOccupants -Name $serviceName -Port $UiPort
}

Ensure-FlowWindowsRuntime -Runtime $runtime

$restartCommand = @(
  "powershell",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $repoRoot "scripts\start-flow-agent.ps1"),
  "-RuntimeMode",
  "Native",
  "-OwnerUserId",
  $OwnerUserId,
  "-AgentName",
  $AgentName,
  "-BootstrapToken",
  $BootstrapToken,
  "-PlatformApiBaseUrl",
  $PlatformApiBaseUrl,
  "-PlatformWebOrigin",
  $PlatformWebOrigin,
  "-UiPort",
  $UiPort,
  "-Restart"
) -join " "

if ($AutoRegister) {
  $restartCommand = $restartCommand + " -AutoRegister"
}

Clear-Content -LiteralPath $logFile -ErrorAction SilentlyContinue

$environment = Get-WindowsNodeEnvironment -Runtime $runtime -AdditionalEnvironment @{
  FLOW_AGENT_BOOTSTRAP_TOKEN = $BootstrapToken
  FLOW_AGENT_AUTO_REGISTER = $(if ($AutoRegister) { "1" } else { "0" })
  FLOW_AGENT_UI_PORT = [string]$UiPort
  FLOW_AGENT_NAME = $AgentName
  FLOW_AGENT_OWNER_USER_ID = $OwnerUserId
  FLOW_APP_ROOT = $repoRoot
  FLOW_AGENT_NODE_PATH = $runtime.NodeExe
  FLOW_AGENT_NPM_CLI_PATH = $runtime.NpmCliPath
  FLOW_AGENT_RESTART_COMMAND = $restartCommand
  FLOWCARD_ROOT = $flowRoot
  FLOW_OVERLAY_DATA_ROOT = $overlayDataRoot
  PLATFORM_API_BASE_URL = $PlatformApiBaseUrl
  FLOW_PLATFORM_WEB_ORIGIN = $PlatformWebOrigin
}

New-WindowsBootstrapScript -Path $bootstrapFile -WorkingDirectory $repoRoot -Environment $environment -CommandLine (
  ('"{0}" "{1}" run start:agent >> "{2}" 2>&1' -f
    (Convert-ToCmdValue -Value $runtime.NodeExe),
    (Convert-ToCmdValue -Value $runtime.NpmCliPath),
    (Convert-ToCmdValue -Value $logFile))
)

$process = Invoke-WindowsBootstrapScript -ScriptPath $bootstrapFile -Hidden
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

if (-not (Wait-ForService -Name $serviceName -ProbeUrl $probeUrl -ProcessId $process.Id -TimeoutSeconds 90)) {
  throw "Local agent did not become ready. Log: $logFile"
}

Write-Host ""
Write-Host "Flow agent is ready:"
Write-Host "  Runtime Mode : Native"
Write-Host "  Owner User ID: $OwnerUserId"
Write-Host "  Agent Name   : $AgentName"
Write-Host "  Local Agent  : http://127.0.0.1:$UiPort/"
Write-Host "  Platform Web : $PlatformWebOrigin/"
Write-Host "  Platform API : $PlatformApiBaseUrl/health"
Write-Host ("  OpenClaw     : {0}" -f (Get-FlowOpenClawStatusSummary -Status (Get-FlowOpenClawConnectionStatus -FlowRoot $flowRoot)))
Write-Host "  Logs         : $logFile"

$openClawStatus = Get-FlowOpenClawConnectionStatus -FlowRoot $flowRoot
if ($null -eq $openClawStatus -or [string]$openClawStatus.status_code -ne "ready") {
  Write-Warning "OpenClaw is not connected yet. Open the Agents page to complete or repair the OpenClaw connection."
}
