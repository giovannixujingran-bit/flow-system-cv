Set-StrictMode -Version 2

function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Convert-ToWslPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WindowsPath
  )

  if ($WindowsPath -notmatch "^([A-Za-z]):\\(.*)$") {
    throw "Unsupported Windows path for WSL conversion: $WindowsPath"
  }

  $drive = $matches[1].ToLowerInvariant()
  $tail = ($matches[2] -replace "\\", "/")
  return "not_configured"
}

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
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

function Get-ProcessDescendantIds {
  param(
    [Parameter(Mandatory = $true)]
    [int]$RootProcessId
  )

  $pending = [System.Collections.Generic.Queue[int]]::new()
  $visited = [System.Collections.Generic.HashSet[int]]::new()
  $descendants = [System.Collections.Generic.List[int]]::new()

  $pending.Enqueue($RootProcessId)

  while ($pending.Count -gt 0) {
    $parentProcessId = $pending.Dequeue()
    $children = Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0}" -f $parentProcessId) -ErrorAction SilentlyContinue
    foreach ($child in @($children)) {
      $childProcessId = [int]$child.ProcessId
      if ($childProcessId -le 0 -or $visited.Contains($childProcessId)) {
        continue
      }

      $visited.Add($childProcessId) | Out-Null
      $descendants.Add($childProcessId) | Out-Null
      $pending.Enqueue($childProcessId)
    }
  }

  return @($descendants)
}

function Get-ManagedProcessRootId {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  $current = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue
  if (-not $current) {
    return $ProcessId
  }

  $rootProcessId = [int]$current.ProcessId
  while ($current.ParentProcessId -gt 0) {
    $parent = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $current.ParentProcessId) -ErrorAction SilentlyContinue
    if (-not $parent) {
      break
    }

    $parentName = [string]$parent.Name
    $parentCommandLine = [string]$parent.CommandLine
    $isManagedWrapper = (
      ($parentName -eq "node.exe" -or $parentName -eq "cmd.exe") -and
      (
        $parentCommandLine -match "workspace\\flow-system" -or
        $parentCommandLine -match "tsx(\.cmd)?(\s+watch|\s+src/server\.ts)" -or
        $parentCommandLine -match "npm-cli\.js.+run\s+(dev|start)"
      )
    )

    if (-not $isManagedWrapper) {
      break
    }

    $rootProcessId = [int]$parent.ProcessId
    $current = $parent
  }

  return $rootProcessId
}

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [int]$RootProcessId
  )

  $rootProcess = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
  $descendantProcessIds = @(Get-ProcessDescendantIds -RootProcessId $RootProcessId)

  for ($index = $descendantProcessIds.Count - 1; $index -ge 0; $index--) {
    $descendantProcessId = $descendantProcessIds[$index]
    Stop-Process -Id $descendantProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($rootProcess) {
    Write-Host ("[{0}] stopping pid {1}" -f $Name, $RootProcessId)
    if ($descendantProcessIds.Count -gt 0) {
      Write-Host ("[{0}] stopping child processes: {1}" -f $Name, ($descendantProcessIds -join ", "))
    }
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}

function Stop-PortOccupants {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $pids = @(Get-ListeningProcessIds -Port $Port)
  $stoppedRootIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($listenerPid in $pids) {
    $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }
    $rootProcessId = Get-ManagedProcessRootId -ProcessId $listenerPid
    if ($stoppedRootIds.Contains($rootProcessId)) {
      continue
    }
    $stoppedRootIds.Add($rootProcessId) | Out-Null
    if ($rootProcessId -ne $listenerPid) {
      Write-Host ("[{0}] stopping port occupant pid {1} via managed root pid {2} ({3})" -f $Name, $listenerPid, $rootProcessId, $process.ProcessName)
    } else {
      Write-Host ("[{0}] stopping port occupant pid {1} ({2})" -f $Name, $listenerPid, $process.ProcessName)
    }
    Stop-ProcessTree -Name $Name -RootProcessId $rootProcessId
  }

  if ($pids.Count -gt 0) {
    Start-Sleep -Milliseconds 750
  }
}

function Stop-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$PidFile,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $managedPid = Read-Pid -PidFile $PidFile
  if ($managedPid) {
    Stop-ProcessTree -Name $Name -RootProcessId $managedPid
    Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
  }

  if (Test-PortOpen -Port $Port) {
    Stop-PortOccupants -Name $Name -Port $Port
  }
}

function Test-HttpReachable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -lt 500
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode -lt 500
    }
    return $false
  } catch {
    return $false
  }
}

function Wait-ForService {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$ProbeUrl,
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReachable -Url $ProbeUrl) {
      return $true
    }

    if ($ProcessId -gt 0) {
      $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if (-not $process) {
        return $false
      }
    }

    Start-Sleep -Seconds 1
  }

  return $false
}

function Get-OriginHost {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    return ([System.Uri]$Url).Host
  } catch {
    throw "Invalid origin URL: $Url"
  }
}

function Remove-PortProxyRule {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ListenAddress,
    [Parameter(Mandatory = $true)]
    [int]$ListenPort
  )

  & netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$ListenPort | Out-Null
}

function Set-PortProxyRule {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ListenAddress,
    [Parameter(Mandatory = $true)]
    [int]$ListenPort,
    [Parameter(Mandatory = $true)]
    [int]$ConnectPort
  )

  Remove-PortProxyRule -ListenAddress "0.0.0.0" -ListenPort $ListenPort
  Remove-PortProxyRule -ListenAddress $ListenAddress -ListenPort $ListenPort
  & netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$ListenPort connectaddress=127.0.0.1 connectport=$ConnectPort | Out-Null
}

function Ensure-FirewallRule {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DisplayName,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue
  if ($existing) {
    return
  }

  New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
}

function Convert-ToCmdValue {
  param(
    [Parameter(Mandatory = $true)]
    [AllowNull()]
    [AllowEmptyString()]
    [string]$Value
  )

  if ($null -eq $Value) {
    return ""
  }

  return $Value -replace '"', '""'
}

function Get-FlowAgentAlias {
  param(
    [Parameter(Mandatory = $true)]
    [string]$OwnerUserId
  )

  switch ($OwnerUserId) {
    "user_admin" { return "admin" }
    "user_owner" { return "owner" }
    "user_member" { return "member" }
    "user_member01" { return "member01" }
    default {
      return ($OwnerUserId -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
    }
  }
}

function Get-FlowOpenClawConnectionStatePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FlowRoot
  )

  return Join-Path $FlowRoot "agent-data\openclaw-connection.json"
}

function Get-FlowOpenClawConnectionStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FlowRoot
  )

  $statePath = Get-FlowOpenClawConnectionStatePath -FlowRoot $FlowRoot
  if (-not (Test-Path -LiteralPath $statePath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $statePath -Raw -Encoding utf8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-FlowOpenClawStatusSummary {
  param(
    [AllowNull()]
    [object]$Status
  )

  if ($null -eq $Status) {
    return "not_configured"
  }

  if ($Status.status_label) {
    return [string]$Status.status_label
  }

  if ($Status.status_code) {
    return [string]$Status.status_code
  }

  return "not_configured"
}

function Resolve-WindowsOpenClawCommand {
  param(
    [string]$PreferredCommand
  )

  $candidates = @()
  if ($PreferredCommand -and $PreferredCommand.Trim().Length -gt 0) {
    $candidates += $PreferredCommand.Trim()
  }
  if ($env:FLOW_OPENCLAW_BIN -and $env:FLOW_OPENCLAW_BIN.Trim().Length -gt 0) {
    $candidates += $env:FLOW_OPENCLAW_BIN.Trim()
  }
  $candidates += @("openclaw.cmd", "openclaw.exe", "openclaw")

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ([System.IO.Path]::IsPathRooted($candidate)) {
      if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
      }
      continue
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
      return $command.Source
    }
  }

  return $null
}

function Convert-FromWslText {
  param(
    [AllowNull()]
    [object]$Value
  )

  if ($null -eq $Value) {
    return "not_configured"
  }

  $text = ($Value | ForEach-Object { $_.ToString() }) -join "`n"
  return ($text -replace "`0", "").Trim()
}

function Test-WslAvailable {
  $wslCommand = Get-Command wsl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $wslCommand
}

function Get-WslInstalledDistros {
  if (-not (Test-WslAvailable)) {
    return @()
  }

  $output = & wsl.exe -l -q 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }

  $text = Convert-FromWslText -Value $output
  if ([string]::IsNullOrWhiteSpace($text)) {
    return @()
  }

  return @(
    $text -split "`r?`n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_.Length -gt 0 } |
      Select-Object -Unique
  )
}

function Resolve-WslUser {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Distro,
    [string]$PreferredUser
  )

  if ($PreferredUser -and $PreferredUser.Trim().Length -gt 0) {
    $probe = & wsl.exe -d $Distro -u $PreferredUser -- bash -lc "whoami" 2>$null
    if ($LASTEXITCODE -eq 0) {
      return $PreferredUser.Trim()
    }
  }

  $auto = & wsl.exe -d $Distro -- bash -lc "whoami" 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $resolved = Convert-FromWslText -Value $auto
  if ([string]::IsNullOrWhiteSpace($resolved)) {
    return $null
  }

  return $resolved
}

function Resolve-WslOpenClawExecutable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Distro,
    [Parameter(Mandatory = $true)]
    [string]$User
  )

  $probeScript = @'
if [ -x "$HOME/.openclaw/bin/openclaw" ]; then
  printf '%s\n' "$HOME/.openclaw/bin/openclaw"
elif command -v openclaw >/dev/null 2>&1; then
  command -v openclaw
fi
'@

  $output = & wsl.exe -d $Distro -u $User -- bash -lc $probeScript 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $resolved = Convert-FromWslText -Value $output
  if ([string]::IsNullOrWhiteSpace($resolved)) {
    return $null
  }

  return $resolved
}

function Test-WslOpenClawConfigured {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Distro,
    [Parameter(Mandatory = $true)]
    [string]$User
  )

  & wsl.exe -d $Distro -u $User -- bash -lc "test -f ~/.openclaw/openclaw.json && test -f ~/.openclaw/agents/main/agent/auth-profiles.json" 2>$null
  return $LASTEXITCODE -eq 0
}

function New-WslOpenClawWrapper {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [Parameter(Mandatory = $true)]
    [string]$Distro,
    [Parameter(Mandatory = $true)]
    [string]$User,
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )

  $safeDistro = ($Distro -replace "[^a-zA-Z0-9_-]", "-")
  $safeUser = ($User -replace "[^a-zA-Z0-9_-]", "-")
  $wrapperPath = Join-Path $Runtime.BootstrapRoot ("openclaw-wsl-{0}-{1}.cmd" -f $safeDistro, $safeUser)
  $scriptPath = Join-Path $Runtime.BootstrapRoot ("openclaw-wsl-{0}-{1}.sh" -f $safeDistro, $safeUser)
  $wslScriptPath = Convert-ToWslPath -WindowsPath $scriptPath
  $distroValue = Convert-ToCmdValue -Value $Distro
  $userValue = Convert-ToCmdValue -Value $User
  $scriptTemplate = @'
#!/usr/bin/env bash
set -e
export PATH="$HOME/.openclaw/bin:$HOME/.openclaw/tools/node-v22.22.0/bin:$PATH"
exec '__EXEC__' "$@"
'@
  $scriptContent = $scriptTemplate.Replace("__EXEC__", $ExecutablePath)
  Write-Utf8File -Path $scriptPath -Content $scriptContent

  $wrapperTemplate = @'
@echo off
setlocal
wsl.exe -d __DISTRO__ -u __USER__ -- bash __SCRIPT__ %*
exit /b %errorlevel%
'@
  $wrapperContent = $wrapperTemplate.
    Replace("__DISTRO__", $distroValue).
    Replace("__USER__", $userValue).
    Replace("__SCRIPT__", $wslScriptPath)
  Write-Utf8File -Path $wrapperPath -Content $wrapperContent
  return $wrapperPath
}

function Resolve-OpenClawRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [string]$PreferredCommand,
    [string]$WslDistro,
    [string]$WslUser
  )

  $windowsCommand = Resolve-WindowsOpenClawCommand -PreferredCommand $PreferredCommand
  if ($windowsCommand) {
    return @{
      Source = "windows"
      Command = $windowsCommand
      Configured = (Test-WindowsOpenClawConfigured)
      Description = $windowsCommand
    }
  }

  if (-not (Test-WslAvailable)) {
    return $null
  }

  $candidateDistros = @()
  if ($WslDistro -and $WslDistro.Trim().Length -gt 0) {
    $candidateDistros += $WslDistro.Trim()
  }
  $candidateDistros += Get-WslInstalledDistros

  foreach ($distro in ($candidateDistros | Select-Object -Unique)) {
    if ([string]::IsNullOrWhiteSpace($distro)) {
      continue
    }

    $resolvedUser = Resolve-WslUser -Distro $distro -PreferredUser $WslUser
    if (-not $resolvedUser) {
      continue
    }

    $executablePath = Resolve-WslOpenClawExecutable -Distro $distro -User $resolvedUser
    if (-not $executablePath) {
      continue
    }

    $wrapperPath = New-WslOpenClawWrapper -Runtime $Runtime -Distro $distro -User $resolvedUser -ExecutablePath $executablePath
    return @{
      Source = "wsl"
      Command = $wrapperPath
      Configured = (Test-WslOpenClawConfigured -Distro $distro -User $resolvedUser)
      Description = "WSL $distro/$resolvedUser ($executablePath)"
      WslDistro = $distro
      WslUser = $resolvedUser
      ExecutablePath = $executablePath
    }
  }

  return $null
}

function Test-WindowsOpenClawConfigured {
  $configRoot = Join-Path $env:USERPROFILE ".openclaw"
  $configFile = Join-Path $configRoot "openclaw.json"
  $authFile = Join-Path $configRoot "agents\main\agent\auth-profiles.json"
  return (Test-Path -LiteralPath $configFile) -and (Test-Path -LiteralPath $authFile)
}

function Get-WindowsNodeEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [hashtable]$AdditionalEnvironment = @{}
  )

  $nodePathEntries = @(
    $Runtime.NodeRoot,
    (Join-Path $Runtime.GitRoot "cmd"),
    (Join-Path $Runtime.GitRoot "mingw64\bin"),
    $env:PATH
  ) | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 }

  $environment = @{
    PATH = ($nodePathEntries -join ";")
    npm_config_cache = (Join-Path $Runtime.ToolsRoot "npm-cache")
  }

  foreach ($key in $AdditionalEnvironment.Keys) {
    $environment[$key] = $AdditionalEnvironment[$key]
  }

  return $environment
}

function Get-FlowWindowsRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $runtimeRoot = Join-Path $RepoRoot "runtime"
  $toolsRoot = Join-Path $runtimeRoot "windows-tools"
  $logsRoot = Join-Path $runtimeRoot "logs"
  $pidsRoot = Join-Path $runtimeRoot "pids"
  $bootstrapRoot = Join-Path $runtimeRoot "bootstrap"
  $stateRoot = Join-Path $runtimeRoot "install-state"

  Ensure-Directory -Path $runtimeRoot
  Ensure-Directory -Path $toolsRoot
  Ensure-Directory -Path $logsRoot
  Ensure-Directory -Path $pidsRoot
  Ensure-Directory -Path $bootstrapRoot
  Ensure-Directory -Path $stateRoot

  $nodeVersion = "22.22.0"
  $nodeRoot = Join-Path $toolsRoot ("node-v{0}-win-x64" -f $nodeVersion)
  $nodeExe = Join-Path $nodeRoot "node.exe"
  $npmCliPath = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
  $gitRoot = Join-Path $toolsRoot "mingit"
  $gitExe = Join-Path $gitRoot "cmd\git.exe"
  $openClawCliVersion = "2026.3.8"
  $openClawCliRoot = Join-Path $toolsRoot "openclaw-cli"
  $openClawCmd = Join-Path $openClawCliRoot "node_modules\.bin\openclaw.cmd"

  return @{
    RepoRoot = $RepoRoot
    RuntimeRoot = $runtimeRoot
    ToolsRoot = $toolsRoot
    LogsRoot = $logsRoot
    PidsRoot = $pidsRoot
    BootstrapRoot = $bootstrapRoot
    StateRoot = $stateRoot
    NodeVersion = $nodeVersion
    NodeRoot = $nodeRoot
    NodeExe = $nodeExe
    NpmCliPath = $npmCliPath
    GitRoot = $gitRoot
    GitExe = $gitExe
    OpenClawCliVersion = $openClawCliVersion
    OpenClawCliRoot = $openClawCliRoot
    OpenClawCmd = $openClawCmd
    WorkspaceInstallStatePath = Join-Path $stateRoot "workspace-windows.json"
  }
}

function Invoke-RobocopyMirror {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [string[]]$ExcludeDirectories = @()
  )

  Ensure-Directory -Path $Destination

  $arguments = @(
    $Source,
    $Destination,
    "/MIR",
    "/R:1",
    "/W:1",
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
    throw "Robocopy failed with exit code $LASTEXITCODE while mirroring $Source"
  }
}

function Ensure-WindowsNodeRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime
  )

  if (Test-Path -LiteralPath $Runtime.NodeExe) {
    return
  }

  $archiveName = ("node-v{0}-win-x64.zip" -f $Runtime.NodeVersion)
  $downloadUrl = ("https://nodejs.org/dist/v{0}/{1}" -f $Runtime.NodeVersion, $archiveName)
  $archivePath = Join-Path $Runtime.ToolsRoot $archiveName
  $extractRoot = Join-Path $Runtime.ToolsRoot "_extract-node"

  Write-Host ("[windows-runtime] downloading Node.js {0}" -f $Runtime.NodeVersion)
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing

  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Ensure-Directory -Path $extractRoot
  Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force

  $extractedRoot = Join-Path $extractRoot ("node-v{0}-win-x64" -f $Runtime.NodeVersion)
  if (-not (Test-Path -LiteralPath $extractedRoot)) {
    throw "Downloaded Node archive did not contain the expected directory: $extractedRoot"
  }

  Remove-Item -LiteralPath $Runtime.NodeRoot -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $extractedRoot -Destination $Runtime.NodeRoot
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
}

function Ensure-WindowsGitRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime
  )

  $systemGit = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($systemGit) {
    return
  }

  if (Test-Path -LiteralPath $Runtime.GitExe) {
    return
  }

  Write-Host "[windows-runtime] downloading MinGit"
  $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest"
  $asset = $release.assets |
    Where-Object { $_.name -like "MinGit*-64-bit.zip" -and $_.name -notlike "*busybox*" } |
    Select-Object -First 1

  if (-not $asset) {
    throw "Could not find a MinGit 64-bit zip in the latest Git for Windows release."
  }

  $archivePath = Join-Path $Runtime.ToolsRoot $asset.name
  $extractRoot = Join-Path $Runtime.ToolsRoot "_extract-git"

  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -UseBasicParsing
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Ensure-Directory -Path $extractRoot
  Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force

  Remove-Item -LiteralPath $Runtime.GitRoot -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $extractRoot -Destination $Runtime.GitRoot
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $Runtime.GitExe)) {
    throw "MinGit installation completed but git.exe was not found at $($Runtime.GitExe)"
  }
}

function Invoke-WindowsBootstrapScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [switch]$Wait,
    [switch]$Hidden
  )

  $arguments = @("/d", "/c", ('"{0}"' -f $ScriptPath))
  $startSplat = @{
    FilePath = "cmd.exe"
    ArgumentList = $arguments
    PassThru = $true
  }

  if ($Wait) {
    $startSplat.Wait = $true
    $startSplat.NoNewWindow = $true
  } elseif ($Hidden) {
    $startSplat.WindowStyle = "Hidden"
  }

  return Start-Process @startSplat
}

function New-WindowsBootstrapScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [Parameter(Mandatory = $true)]
    [string]$CommandLine
  )

  $lines = @(
    "@echo off",
    "setlocal",
    ('cd /d "{0}"' -f (Convert-ToCmdValue -Value $WorkingDirectory))
  )

  foreach ($key in ($Environment.Keys | Sort-Object)) {
    $value = [string]$Environment[$key]
    $lines += ('set "{0}={1}"' -f $key, (Convert-ToCmdValue -Value $value))
  }

  $lines += $CommandLine
  $lines += "exit /b %errorlevel%"

  Write-Utf8File -Path $Path -Content ($lines -join "`r`n")
}

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Ensure-WorkspaceDependencies {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime
  )

  $packageLockPath = Join-Path $Runtime.RepoRoot "package-lock.json"
  $installMarkerPath = $Runtime.WorkspaceInstallStatePath
  $expectedHash = Get-FileSha256 -Path $packageLockPath
  $nodeModulesPath = Join-Path $Runtime.RepoRoot "node_modules"
  $criticalPaths = @(
    (Join-Path $Runtime.RepoRoot "node_modules\tsx\dist\preflight.cjs"),
    (Join-Path $Runtime.RepoRoot "node_modules\@swc\helpers\package.json"),
    (Join-Path $Runtime.RepoRoot "node_modules\next\dist\build\analysis\get-page-static-info.js"),
    (Join-Path $Runtime.RepoRoot "node_modules\next\dist\bin\next")
  )
  $needsInstall = -not (Test-Path -LiteralPath $nodeModulesPath)

  if (-not $needsInstall) {
    foreach ($criticalPath in $criticalPaths) {
      if (-not (Test-Path -LiteralPath $criticalPath)) {
        Write-Host ("[windows-runtime] dependency integrity check failed: missing {0}" -f $criticalPath)
        $needsInstall = $true
        break
      }
    }
  }

  if (-not $needsInstall -and (Test-Path -LiteralPath $installMarkerPath)) {
    try {
      $state = Get-Content -LiteralPath $installMarkerPath -Raw | ConvertFrom-Json
      if (
        $state.package_lock_sha256 -eq $expectedHash -and
        $state.platform -eq "win32" -and
        $state.node_version -eq $Runtime.NodeVersion
      ) {
        return
      }
      $needsInstall = $true
    } catch {
      $needsInstall = $true
    }
  } elseif (-not $needsInstall) {
    $needsInstall = $true
  }

  if (-not $needsInstall) {
    return
  }

  Write-Host "[windows-runtime] installing workspace dependencies"
  $installScript = Join-Path $Runtime.BootstrapRoot "windows-install-workspace.cmd"
  New-WindowsBootstrapScript -Path $installScript -WorkingDirectory $Runtime.RepoRoot -Environment (
    Get-WindowsNodeEnvironment -Runtime $Runtime
  ) -CommandLine (
    ('"{0}" "{1}" ci --no-audit --no-fund' -f
      (Convert-ToCmdValue -Value $Runtime.NodeExe),
      (Convert-ToCmdValue -Value $Runtime.NpmCliPath))
  )

  $process = Invoke-WindowsBootstrapScript -ScriptPath $installScript -Wait
  if ($process.ExitCode -ne 0) {
    throw "Windows workspace dependency install failed with exit code $($process.ExitCode)"
  }

  $state = @{
    platform = "win32"
    node_version = $Runtime.NodeVersion
    package_lock_sha256 = $expectedHash
    installed_at = (Get-Date).ToString("o")
  } | ConvertTo-Json -Depth 4
  Write-Utf8File -Path $installMarkerPath -Content $state
}

function Ensure-WindowsOpenClawCli {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime
  )

  $packageJsonPath = Join-Path $Runtime.OpenClawCliRoot "package.json"
  $installedPackageJsonPath = Join-Path $Runtime.OpenClawCliRoot "node_modules\openclaw\package.json"

  Ensure-Directory -Path $Runtime.OpenClawCliRoot

  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    $packageJson = @"
{
  "name": "flow-system-openclaw-cli",
  "private": true,
  "version": "0.0.0"
}
"@
    Write-Utf8File -Path $packageJsonPath -Content $packageJson
  }

  $installedVersion = $null
  if (Test-Path -LiteralPath $installedPackageJsonPath) {
    try {
      $installedVersion = (Get-Content -LiteralPath $installedPackageJsonPath -Raw | ConvertFrom-Json).version
    } catch {
      $installedVersion = $null
    }
  }

  if (
    $installedVersion -eq $Runtime.OpenClawCliVersion -and
    (Test-Path -LiteralPath $Runtime.OpenClawCmd)
  ) {
    return
  }

  Write-Host ("[windows-runtime] installing OpenClaw CLI {0}" -f $Runtime.OpenClawCliVersion)
  $installScript = Join-Path $Runtime.BootstrapRoot "windows-install-openclaw.cmd"
  New-WindowsBootstrapScript -Path $installScript -WorkingDirectory $Runtime.OpenClawCliRoot -Environment (
    Get-WindowsNodeEnvironment -Runtime $Runtime
  ) -CommandLine (
    ('"{0}" "{1}" install --no-audit --no-fund openclaw@{2}' -f
      (Convert-ToCmdValue -Value $Runtime.NodeExe),
      (Convert-ToCmdValue -Value $Runtime.NpmCliPath),
      (Convert-ToCmdValue -Value $Runtime.OpenClawCliVersion))
  )

  $process = Invoke-WindowsBootstrapScript -ScriptPath $installScript -Wait
  if ($process.ExitCode -ne 0) {
    throw "Windows OpenClaw CLI install failed with exit code $($process.ExitCode)"
  }

  if (-not (Test-Path -LiteralPath $Runtime.OpenClawCmd)) {
    throw "Windows OpenClaw CLI install completed but openclaw.cmd was not found at $($Runtime.OpenClawCmd)"
  }
}

function Ensure-FlowWindowsRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [switch]$EnsureOpenClawCli
  )

  Ensure-WindowsNodeRuntime -Runtime $Runtime
  Ensure-WorkspaceDependencies -Runtime $Runtime
  if ($EnsureOpenClawCli) {
    Ensure-WindowsGitRuntime -Runtime $Runtime
    Ensure-WindowsOpenClawCli -Runtime $Runtime
  }
}
