[CmdletBinding()]
param(
  [ValidateSet("install", "update", "start", "install-skills", "package-bootstrap")]
  [string]$Action = "install",
  [string]$Repo,
  [string]$Ref,
  [string]$InstallPath,
  [string]$ConfigPath,
  [string]$ReleaseDir,
  [string]$LocalSourceRoot,
  [switch]$SkipSkillInstall,
  [switch]$NoOpen,
  [switch]$Restart,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArguments
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Remove-DirectoryIfExists {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Get-DistributionConfig {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $raw = Get-Content -LiteralPath $Path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  return $raw | ConvertFrom-Json
}

function Expand-ConfigValue {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Value
  }

  return [Environment]::ExpandEnvironmentVariables($Value)
}

function Get-CodexHome {
  if ($env:CODEX_HOME) {
    return $env:CODEX_HOME
  }

  return Join-Path $HOME ".codex"
}

function Copy-DirectoryTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Overwrite
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source directory was not found: $Source"
  }

  $destinationParent = Split-Path -Parent $Destination
  $destinationLeaf = Split-Path -Leaf $Destination
  $sourceLeaf = Split-Path -Leaf $Source
  Ensure-Directory -Path $destinationParent

  $copiedPath = Join-Path $destinationParent $sourceLeaf
  if (Test-Path -LiteralPath $copiedPath) {
    Remove-DirectoryIfExists -Path $copiedPath
  }

  if ((Test-Path -LiteralPath $Destination) -and $Overwrite) {
    Remove-DirectoryIfExists -Path $Destination
  }

  Copy-Item -LiteralPath $Source -Destination $destinationParent -Recurse -Force

  if ($copiedPath -ne $Destination) {
    if (Test-Path -LiteralPath $Destination) {
      Remove-DirectoryIfExists -Path $Destination
    }
    Rename-Item -LiteralPath $copiedPath -NewName $destinationLeaf
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
    throw "robocopy failed with exit code $LASTEXITCODE"
  }
}

function Validate-FlowSystemRoot {
  param([Parameter(Mandatory = $true)][string]$Path)

  $required = @(
    (Join-Path $Path "package.json"),
    (Join-Path $Path "start-flow-system.cmd"),
    (Join-Path $Path "scripts\start-flow-system.ps1")
  )

  foreach ($item in $required) {
    if (-not (Test-Path -LiteralPath $item)) {
      throw "Flow System root is invalid. Missing: $item"
    }
  }
}

function Get-LocalSourceTree {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  Validate-FlowSystemRoot -Path $resolved
  return @{
    TempRoot = $null
    SourceRoot = $resolved
    Repo = "local"
    Ref = "local"
  }
}

function Get-GitHubSourceTree {
  param(
    [Parameter(Mandatory = $true)][string]$RepoName,
    [Parameter(Mandatory = $true)][string]$RepoRef
  )

  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("flow-system-" + [System.Guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot "repo.zip"
  $extractRoot = Join-Path $tempRoot "repo"
  Ensure-Directory -Path $tempRoot

  $downloadUrl = "https://codeload.github.com/$RepoName/zip/$RepoRef"
  Write-Host "[flow-system] Downloading $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  $repoRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if (-not $repoRoot) {
    throw "Downloaded GitHub archive is empty."
  }

  Validate-FlowSystemRoot -Path $repoRoot.FullName
  return @{
    TempRoot = $tempRoot
    SourceRoot = $repoRoot.FullName
    Repo = $RepoName
    Ref = $RepoRef
  }
}

function Get-SourceTree {
  param(
    [string]$RepoName,
    [string]$RepoRef,
    [string]$LocalRoot
  )

  if (-not [string]::IsNullOrWhiteSpace($LocalRoot)) {
    return Get-LocalSourceTree -Path $LocalRoot
  }

  if ([string]::IsNullOrWhiteSpace($RepoName)) {
    throw "GitHub repo is not configured."
  }

  $resolvedRef = if ([string]::IsNullOrWhiteSpace($RepoRef)) { "main" } else { $RepoRef }
  return Get-GitHubSourceTree -RepoName $RepoName -RepoRef $resolvedRef
}

function Backup-PreservedFiles {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string[]]$RelativePaths
  )

  $backupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("flow-system-preserve-" + [System.Guid]::NewGuid().ToString("N"))
  $hasBackups = $false
  Ensure-Directory -Path $backupRoot

  foreach ($relativePath in $RelativePaths) {
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      continue
    }

    $sourcePath = Join-Path $InstallRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      continue
    }

    $targetPath = Join-Path $backupRoot $relativePath
    $targetParent = Split-Path -Parent $targetPath
    Ensure-Directory -Path $targetParent
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    $hasBackups = $true
  }

  if (-not $hasBackups) {
    Remove-DirectoryIfExists -Path $backupRoot
    return $null
  }

  return $backupRoot
}

function Restore-PreservedFiles {
  param(
    [string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$InstallRoot
  )

  if ([string]::IsNullOrWhiteSpace($BackupRoot) -or -not (Test-Path -LiteralPath $BackupRoot)) {
    return
  }

  Get-ChildItem -LiteralPath $BackupRoot -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($BackupRoot.Length).TrimStart("\")
    $destinationPath = Join-Path $InstallRoot $relativePath
    $destinationParent = Split-Path -Parent $destinationPath
    Ensure-Directory -Path $destinationParent
    Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Force
  }

  Remove-DirectoryIfExists -Path $BackupRoot
}

function Sync-RepoSkills {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [switch]$Overwrite
  )

  $skillsRoot = Join-Path $RepoRoot "skills"
  if (-not (Test-Path -LiteralPath $skillsRoot)) {
    Write-Host "[flow-system] No repo-local skills directory found."
    return
  }

  $codexSkillsRoot = Join-Path (Get-CodexHome) "skills"
  Ensure-Directory -Path $codexSkillsRoot

  $installed = @()
  Get-ChildItem -LiteralPath $skillsRoot -Directory | ForEach-Object {
    $skillMd = Join-Path $_.FullName "SKILL.md"
    if (-not (Test-Path -LiteralPath $skillMd)) {
      return
    }

    $destination = Join-Path $codexSkillsRoot $_.Name
    Copy-DirectoryTree -Source $_.FullName -Destination $destination -Overwrite:$Overwrite
    $installed += $_.Name
  }

  if ($installed.Count -eq 0) {
    Write-Host "[flow-system] No repo-local skills with SKILL.md were found."
    return
  }

  Write-Host ("[flow-system] Synced skills: {0}" -f ($installed -join ", "))
}

function Install-FlowSystemTree {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeRelativePaths
  )

  if (Test-Path -LiteralPath $Destination) {
    throw "Install path already exists: $Destination. Use update-flow-system-from-github.cmd instead."
  }

  $excludeDirectories = @($ExcludeRelativePaths | ForEach-Object { Join-Path $Source.SourceRoot $_ })
  Invoke-Robocopy -Source $Source.SourceRoot -Destination $Destination -ExcludeDirectories $excludeDirectories
  Validate-FlowSystemRoot -Path $Destination
}

function Update-FlowSystemTree {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeRelativePaths,
    [string[]]$PreserveFiles
  )

  if (-not (Test-Path -LiteralPath $Destination)) {
    throw "Install path does not exist: $Destination. Use install-flow-system-from-github.cmd first."
  }

  Validate-FlowSystemRoot -Path $Destination
  $backupRoot = Backup-PreservedFiles -InstallRoot $Destination -RelativePaths $PreserveFiles
  try {
    $excludeDirectories = @($ExcludeRelativePaths | ForEach-Object { Join-Path $Source.SourceRoot $_ })
    Invoke-Robocopy -Source $Source.SourceRoot -Destination $Destination -ExcludeDirectories $excludeDirectories
    Restore-PreservedFiles -BackupRoot $backupRoot -InstallRoot $Destination
    Validate-FlowSystemRoot -Path $Destination
  } catch {
    Restore-PreservedFiles -BackupRoot $backupRoot -InstallRoot $Destination
    throw
  }
}

function Package-BootstrapBundle {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$OutputRoot
  )

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bundleName = "flow-system-bootstrap-$timestamp"
  $stageRoot = Join-Path $OutputRoot $bundleName
  $zipPath = Join-Path $OutputRoot "$bundleName.zip"
  $stageScripts = Join-Path $stageRoot "scripts"

  Ensure-Directory -Path $OutputRoot
  Remove-DirectoryIfExists -Path $stageRoot
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Ensure-Directory -Path $stageScripts

  Copy-Item -LiteralPath (Join-Path $RepoRoot "install-flow-system-from-github.cmd") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "update-flow-system-from-github.cmd") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "start-installed-flow-system.cmd") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "start-flow-agent-shared-user.cmd") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "package-flow-bootstrap.cmd") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "flow-system-distribution.config.json.example") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "FLOW-SYSTEM-DISTRIBUTION.md") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "INSTALL-CN.md") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "scripts\manage-flow-system-distribution.ps1") -Destination $stageScripts -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "scripts\start-flow-agent-shared-user.ps1") -Destination $stageScripts -Force

  $actualConfig = Join-Path $RepoRoot "flow-system-distribution.config.json"
  if (Test-Path -LiteralPath $actualConfig) {
    Copy-Item -LiteralPath $actualConfig -Destination $stageRoot -Force
  }

  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force
  Remove-DirectoryIfExists -Path $stageRoot
  return $zipPath
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$defaultConfigPath = Join-Path $repoRoot "flow-system-distribution.config.json"
$resolvedConfigPath = if ($ConfigPath) { $ConfigPath } else { $defaultConfigPath }
$config = Get-DistributionConfig -Path $resolvedConfigPath

if (-not $Repo -and $config -and $config.github -and $config.github.repo) {
  $Repo = [string]$config.github.repo
}

if (-not $Ref) {
  if ($config -and $config.github -and $config.github.ref) {
    $Ref = [string]$config.github.ref
  } else {
    $Ref = "main"
  }
}

$installDirectory = $InstallPath
if ([string]::IsNullOrWhiteSpace($installDirectory)) {
  if ($config -and $config.install -and $config.install.path) {
    $installDirectory = Expand-ConfigValue -Value ([string]$config.install.path)
  } elseif ($config -and $config.install -and $config.install.parent_dir -and $config.install.folder_name) {
    $installDirectory = Join-Path (Expand-ConfigValue -Value ([string]$config.install.parent_dir)) ([string]$config.install.folder_name)
  } else {
    $installDirectory = Join-Path $HOME "OpenClawProjects\flow-system"
  }
}

$excludeRelativePaths = @(
  "node_modules",
  "runtime",
  "storage",
  "apps/platform-web/.next"
)

$preserveFiles = @(
  ".env",
  "account-management\managed-users.json",
  "account-management\accounts-summary.txt"
)

if ($config -and $config.update -and $config.update.exclude_directories) {
  $excludeRelativePaths = @()
  foreach ($relativePath in $config.update.exclude_directories) {
    $excludeRelativePaths += ([string]$relativePath)
  }
}

if ($config -and $config.update -and $config.update.preserve_files) {
  $preserveFiles = @($config.update.preserve_files | ForEach-Object { [string]$_ })
}

switch ($Action) {
  "install" {
    $source = $null
    try {
      $source = Get-SourceTree -RepoName $Repo -RepoRef $Ref -LocalRoot $LocalSourceRoot
      Install-FlowSystemTree -Source $source -Destination $installDirectory -ExcludeRelativePaths $excludeRelativePaths
      Write-Host ("[flow-system] Installed to {0}" -f $installDirectory)
      if (-not $SkipSkillInstall) {
        Sync-RepoSkills -RepoRoot $installDirectory -Overwrite
      }
      Write-Host "[flow-system] Next step: double-click start-installed-flow-system.cmd"
    } finally {
      if ($source -and $source.TempRoot) {
        Remove-DirectoryIfExists -Path $source.TempRoot
      }
    }
  }
  "update" {
    $source = $null
    try {
      $source = Get-SourceTree -RepoName $Repo -RepoRef $Ref -LocalRoot $LocalSourceRoot
      Update-FlowSystemTree -Source $source -Destination $installDirectory -ExcludeRelativePaths $excludeRelativePaths -PreserveFiles $preserveFiles
      Write-Host ("[flow-system] Updated at {0}" -f $installDirectory)
      if (-not $SkipSkillInstall) {
        Sync-RepoSkills -RepoRoot $installDirectory -Overwrite
      }
      Write-Host "[flow-system] Next step: restart the installed Flow System if needed."
    } finally {
      if ($source -and $source.TempRoot) {
        Remove-DirectoryIfExists -Path $source.TempRoot
      }
    }
  }
  "start" {
    $startScript = Join-Path $installDirectory "start-flow-system.cmd"
    if (-not (Test-Path -LiteralPath $startScript)) {
      throw "Installed Flow System was not found at $installDirectory. Run install-flow-system-from-github.cmd first."
    }

    $command = @($RemainingArguments)
    $managedUsersFile = Join-Path $installDirectory "account-management\managed-users.json"
    $hasExplicitSeedChoice = $command -contains "-AllowSelfSetup" -or $command -contains "-EnableDemoData"
    if (-not (Test-Path -LiteralPath $managedUsersFile) -and -not $hasExplicitSeedChoice) {
      $command += "-AllowSelfSetup"
      Write-Host "[flow-system] No managed account file was found. Starting with -AllowSelfSetup."
    }
    if ($NoOpen) {
      $command += "-NoOpen"
    }
    if ($Restart) {
      $command += "-Restart"
    }

    & $startScript @command
    exit $LASTEXITCODE
  }
  "install-skills" {
    if (-not (Test-Path -LiteralPath $installDirectory)) {
      throw "Installed Flow System was not found at $installDirectory."
    }
    Sync-RepoSkills -RepoRoot $installDirectory -Overwrite
  }
  "package-bootstrap" {
    $outputRoot = if ($ReleaseDir) { $ReleaseDir } else { Join-Path $repoRoot "release" }
    $zipPath = Package-BootstrapBundle -RepoRoot $repoRoot -OutputRoot $outputRoot
    Write-Host ("[flow-system] Bootstrap package created: {0}" -f $zipPath)
  }
}
