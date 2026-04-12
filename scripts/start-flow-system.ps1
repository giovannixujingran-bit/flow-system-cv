[CmdletBinding()]
param(
  [ValidateSet("Auto", "Native")]
  [string]$RuntimeMode = "Auto",
  [ValidateSet("memory", "postgres")]
  [string]$StorageMode = "memory",
  [string]$DatabaseUrl = "",
  [bool]$RunMigrations = $false,
  [bool]$ImportCurrentState = $false,
  [bool]$FailIfDbEmptyAndNoImport = $true,
  [string]$BootstrapToken = "flow-bootstrap-local",
  [string]$BindHost = "127.0.0.1",
  [string]$PlatformWebOrigin = "http://127.0.0.1:3000",
  [string]$PlatformApiBaseUrl = "http://127.0.0.1:4010",
  [switch]$EnableDemoData,
  [switch]$EnableDemoAgents,
  [switch]$AllowSelfSetup,
  [switch]$AllowLanAutoRegister,
  [switch]$EnableLanProxy,
  [switch]$NoOpen,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "shared-runtime.ps1")

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtime = Get-FlowWindowsRuntime -RepoRoot $repoRoot
$storageRoot = Join-Path $repoRoot "storage"
$platformStateSnapshotFile = Join-Path $storageRoot "platform-state.json"
$managedUsersFile = Join-Path $repoRoot "account-management\managed-users.json"
$managedUsersSummaryFile = Join-Path $repoRoot "account-management\accounts-summary.txt"
$platformApiInternalBaseUrl = if ($BindHost -eq "0.0.0.0") { "http://127.0.0.1:4010" } else { $PlatformApiBaseUrl }
$platformApiProbePath = if ($StorageMode -eq "postgres") { "/ready" } else { "/health" }
$platformApiProbeUrl = if ($BindHost -eq "0.0.0.0") { "http://127.0.0.1:4010$platformApiProbePath" } else { "$PlatformApiBaseUrl$platformApiProbePath" }
$platformWebProbeUrl = if ($BindHost -eq "0.0.0.0") { "http://127.0.0.1:3000/login" } else { "{0}/login" -f $PlatformWebOrigin.TrimEnd("/") }

function Invoke-FlowWorkspaceScript {
  param(
    [hashtable]$Environment,
    [string]$ScriptName
  )

  $previous = @{}
  foreach ($entry in $Environment.GetEnumerator()) {
    $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }

  try {
    $output = & $runtime.NodeExe $runtime.NpmCliPath --silent run $ScriptName --workspace @flow-system/platform-api
    if ($LASTEXITCODE -ne 0) {
      throw ("Workspace script failed: {0}" -f $ScriptName)
    }
    return $output
  } finally {
    foreach ($entry in $Environment.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $previous[$entry.Key], "Process")
    }
  }
}

$agentRuntimes = @(
  @{
    Alias = "admin"
    Name = "local-agent-admin"
    UiPort = 38500
    AgentName = "ADMIN-PC"
    OwnerUserId = "user_admin"
  }
)

if ($EnableDemoAgents) {
  $agentRuntimes = @(
    @{
      Alias = "owner"
      Name = "local-agent-owner"
      UiPort = 38500
      AgentName = "OWNER-PC"
      OwnerUserId = "user_owner"
    },
    @{
      Alias = "member"
      Name = "local-agent-member"
      UiPort = 38501
      AgentName = "MEMBER-PC"
      OwnerUserId = "user_member"
    },
    @{
      Alias = "admin"
      Name = "local-agent-admin"
      UiPort = 38502
      AgentName = "ADMIN-PC"
      OwnerUserId = "user_admin"
    }
  )
}

$platformApiEnvironment = Get-WindowsNodeEnvironment -Runtime $runtime -AdditionalEnvironment @{
  PORT = "4010"
  HOST = $BindHost
  APP_ORIGIN = $PlatformWebOrigin
  STORAGE_ROOT = $storageRoot
  PLATFORM_STATE_SNAPSHOT_FILE = $platformStateSnapshotFile
  MANAGED_USERS_FILE = $managedUsersFile
  MANAGED_USERS_SUMMARY_FILE = $managedUsersSummaryFile
  FLOW_SEED_MODE = $(if ($EnableDemoData) { "demo" } elseif ($AllowSelfSetup) { "empty" } else { "managed" })
  ALLOW_LAN_AUTO_REGISTER = $AllowLanAutoRegister.ToString().ToLowerInvariant()
  STORAGE_MODE = $StorageMode
  DATABASE_URL = $DatabaseUrl
  RUN_MIGRATIONS = $RunMigrations.ToString().ToLowerInvariant()
  IMPORT_CURRENT_STATE = $ImportCurrentState.ToString().ToLowerInvariant()
  FAIL_IF_DB_EMPTY_AND_NO_IMPORT = $FailIfDbEmptyAndNoImport.ToString().ToLowerInvariant()
}

$services = @(
  @{
    Name = "platform-api"
    Script = "dev:api"
    Port = 4010
    ProbeUrl = $platformApiProbeUrl
    LogFile = Join-Path $runtime.LogsRoot "platform-api.log"
    PidFile = Join-Path $runtime.PidsRoot "platform-api.pid"
    Environment = $platformApiEnvironment
  },
  @{
    Name = "platform-web"
    Script = "dev:web"
    Port = 3000
    ProbeUrl = $platformWebProbeUrl
    LogFile = Join-Path $runtime.LogsRoot "platform-web.log"
    PidFile = Join-Path $runtime.PidsRoot "platform-web.pid"
    Environment = (Get-WindowsNodeEnvironment -Runtime $runtime -AdditionalEnvironment @{
      PORT = "3000"
      HOSTNAME = $BindHost
      PLATFORM_API_BASE_URL = $platformApiInternalBaseUrl
    })
  }
)

foreach ($agentRuntime in $agentRuntimes) {
  $flowRoot = Join-Path $runtime.RuntimeRoot ("agents\{0}" -f $agentRuntime.Alias)
  $overlayDataRoot = Join-Path $runtime.RuntimeRoot ("overlay-data\{0}" -f $agentRuntime.Alias)
  Ensure-Directory -Path $flowRoot
  Ensure-Directory -Path $overlayDataRoot

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
    $agentRuntime.OwnerUserId,
    "-AgentName",
    $agentRuntime.AgentName,
    "-BootstrapToken",
    $BootstrapToken,
    "-PlatformApiBaseUrl",
    $platformApiInternalBaseUrl,
    "-PlatformWebOrigin",
    $PlatformWebOrigin,
    "-UiPort",
    $agentRuntime.UiPort,
    "-Restart"
  ) -join " "

  $services += @{
    Name = $agentRuntime.Name
    Script = "start:agent"
    Port = [int]$agentRuntime.UiPort
    ProbeUrl = "http://127.0.0.1:$($agentRuntime.UiPort)/health"
    LogFile = Join-Path $runtime.LogsRoot ("{0}.log" -f $agentRuntime.Name)
    PidFile = Join-Path $runtime.PidsRoot ("{0}.pid" -f $agentRuntime.Name)
    Environment = (Get-WindowsNodeEnvironment -Runtime $runtime -AdditionalEnvironment @{
      FLOW_AGENT_BOOTSTRAP_TOKEN = $BootstrapToken
      FLOW_AGENT_UI_PORT = [string]$agentRuntime.UiPort
      FLOW_AGENT_NAME = $agentRuntime.AgentName
      FLOW_AGENT_OWNER_USER_ID = $agentRuntime.OwnerUserId
      FLOW_APP_ROOT = $repoRoot
      FLOW_AGENT_NODE_PATH = $runtime.NodeExe
      FLOW_AGENT_NPM_CLI_PATH = $runtime.NpmCliPath
      FLOW_AGENT_RESTART_COMMAND = $restartCommand
      FLOWCARD_ROOT = $flowRoot
      FLOW_OVERLAY_DATA_ROOT = $overlayDataRoot
      PLATFORM_API_BASE_URL = $platformApiInternalBaseUrl
      FLOW_PLATFORM_WEB_ORIGIN = $PlatformWebOrigin
    })
  }
}

$legacyDemoServices = @(
  @{ Name = "local-agent-owner"; Port = 38500; PidFile = Join-Path $runtime.PidsRoot "local-agent-owner.pid" },
  @{ Name = "local-agent-member"; Port = 38501; PidFile = Join-Path $runtime.PidsRoot "local-agent-member.pid" },
  @{ Name = "local-agent-admin-demo"; Port = 38502; PidFile = Join-Path $runtime.PidsRoot "local-agent-admin.pid" }
)

$restartAllServices = $Restart
if (-not $restartAllServices) {
  foreach ($service in $services) {
    if (-not (Test-HttpReachable -Url $service.ProbeUrl)) {
      $restartAllServices = $true
      break
    }
  }
}

if ($restartAllServices) {
  foreach ($service in $services) {
    Stop-ManagedProcess -Name $service.Name -PidFile $service.PidFile -Port $service.Port
  }

  if (-not $EnableDemoAgents) {
    foreach ($legacyService in $legacyDemoServices) {
      $activeService = $services | Where-Object { $_.Name -eq $legacyService.Name -and $_.Port -eq $legacyService.Port }
      if ($activeService) {
        continue
      }
      Stop-ManagedProcess -Name $legacyService.Name -PidFile $legacyService.PidFile -Port $legacyService.Port
    }
  }

  Ensure-FlowWindowsRuntime -Runtime $runtime

  $recoverStateScript = Join-Path $repoRoot "scripts\recover-platform-state.mjs"
  & $runtime.NodeExe $recoverStateScript --repo-root $repoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Platform state recovery failed."
  }

  if ($StorageMode -eq "postgres") {
    if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
      throw "DatabaseUrl is required when -StorageMode postgres."
    }

    Invoke-FlowWorkspaceScript -Environment $platformApiEnvironment -ScriptName "db:preflight"

    if ($RunMigrations) {
      Invoke-FlowWorkspaceScript -Environment $platformApiEnvironment -ScriptName "db:migrate"
    }

    $preflightJson = Invoke-FlowWorkspaceScript -Environment $platformApiEnvironment -ScriptName "db:preflight"
    $preflight = ($preflightJson -join "`n") | ConvertFrom-Json

    if ($ImportCurrentState) {
      Invoke-FlowWorkspaceScript -Environment $platformApiEnvironment -ScriptName "db:import-current-state"
      Invoke-FlowWorkspaceScript -Environment $platformApiEnvironment -ScriptName "db:verify-import"
    } elseif ($FailIfDbEmptyAndNoImport -and $preflight.empty_state) {
      throw "PostgreSQL database is empty and -ImportCurrentState was not provided."
    }
  }
}

if ($EnableLanProxy -and $BindHost -eq "0.0.0.0") {
  $webHost = Get-OriginHost -Url $PlatformWebOrigin
  $apiHost = Get-OriginHost -Url $PlatformApiBaseUrl
  Ensure-FirewallRule -DisplayName "Flow System Platform Web 3000" -Port 3000
  Ensure-FirewallRule -DisplayName "Flow System Platform API 4010" -Port 4010
  if ($webHost -ne "127.0.0.1" -and $webHost -ne "localhost") {
    Remove-PortProxyRule -ListenAddress $webHost -ListenPort 3000
    Set-PortProxyRule -ListenAddress $webHost -ListenPort 3000 -ConnectPort 3000
  }
  if ($apiHost -ne "127.0.0.1" -and $apiHost -ne "localhost") {
    Remove-PortProxyRule -ListenAddress $apiHost -ListenPort 4010
    Set-PortProxyRule -ListenAddress $apiHost -ListenPort 4010 -ConnectPort 4010
  }
}

Write-Host "Starting Flow System from $repoRoot"
Write-Host "Runtime mode: Native"

foreach ($service in $services) {
  if ((-not $restartAllServices) -and (Test-HttpReachable -Url $service.ProbeUrl)) {
    Write-Host ("[{0}] already reachable on {1}" -f $service.Name, $service.ProbeUrl)
    continue
  }

  if (Test-PortOpen -Port $service.Port) {
    Stop-PortOccupants -Name $service.Name -Port $service.Port
  }

  $bootstrapFile = Join-Path $runtime.BootstrapRoot ("{0}-native.cmd" -f $service.Name)
  Clear-Content -LiteralPath $service.LogFile -ErrorAction SilentlyContinue
  New-WindowsBootstrapScript -Path $bootstrapFile -WorkingDirectory $repoRoot -Environment $service.Environment -CommandLine (
    ('"{0}" "{1}" run {2} >> "{3}" 2>&1' -f
      (Convert-ToCmdValue -Value $runtime.NodeExe),
      (Convert-ToCmdValue -Value $runtime.NpmCliPath),
      $service.Script,
      (Convert-ToCmdValue -Value $service.LogFile))
  )

  Write-Host ("[{0}] launching..." -f $service.Name)
  $process = Invoke-WindowsBootstrapScript -ScriptPath $bootstrapFile -Hidden
  Set-Content -LiteralPath $service.PidFile -Value $process.Id -Encoding ascii
  $service.LaunchedPid = $process.Id
}

$failed = @()
foreach ($service in $services) {
  $launchedPid = if ($service.ContainsKey("LaunchedPid")) { [int]$service.LaunchedPid } else { 0 }
  Write-Host ("[{0}] waiting for {1}" -f $service.Name, $service.ProbeUrl)
  if (Wait-ForService -Name $service.Name -ProbeUrl $service.ProbeUrl -ProcessId $launchedPid -TimeoutSeconds 90) {
    Write-Host ("[{0}] ready" -f $service.Name)
  } else {
    Write-Warning ("[{0}] did not become ready. Log: {1}" -f $service.Name, $service.LogFile)
    $failed += $service
  }
}

if ($failed.Count -gt 0) {
  throw ("Flow System startup failed for: {0}" -f (($failed | ForEach-Object { $_.Name }) -join ", "))
}

Write-Host ""
Write-Host "Flow System is ready:"
Write-Host "  Runtime Mode : Native"
Write-Host "  Platform Web : $PlatformWebOrigin/"
Write-Host "  Platform API : $PlatformApiBaseUrl/health"
foreach ($agentRuntime in $agentRuntimes) {
  Write-Host ("  Local Agent ({0}) : http://127.0.0.1:{1}/" -f $agentRuntime.Alias, $agentRuntime.UiPort)
  $flowRoot = Join-Path $runtime.RuntimeRoot ("agents\{0}" -f $agentRuntime.Alias)
  $openClawStatus = Get-FlowOpenClawConnectionStatus -FlowRoot $flowRoot
  Write-Host ("  OpenClaw ({0}) : {1}" -f $agentRuntime.Alias, (Get-FlowOpenClawStatusSummary -Status $openClawStatus))
}
Write-Host "  Logs         : $($runtime.LogsRoot)"

if (-not $EnableDemoAgents) {
  $defaultFlowRoot = Join-Path $runtime.RuntimeRoot "agents\admin"
  $defaultOpenClawStatus = Get-FlowOpenClawConnectionStatus -FlowRoot $defaultFlowRoot
  if ($null -eq $defaultOpenClawStatus -or [string]$defaultOpenClawStatus.status_code -ne "ready") {
    Write-Warning "OpenClaw is not connected yet. Open the Agents page to complete or repair the OpenClaw connection."
  }
}

if (-not $NoOpen) {
  Start-Process "$PlatformWebOrigin/" | Out-Null
}
