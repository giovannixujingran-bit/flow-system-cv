[CmdletBinding()]
param(
  [string]$Repo = "giovannixujingran-bit/flow-system",
  [string]$Branch = "main",
  [string]$SourceRoot,
  [string]$CommitMessage = "publish flow-system workspace",
  [switch]$IncludeManagedAccounts,
  [switch]$PreserveRemoteLicense = $true
)

$ErrorActionPreference = "Stop"

function Resolve-ToolPath {
  param(
    [Parameter(Mandatory = $true)][string[]]$Candidates,
    [Parameter(Mandatory = $true)][string]$Label
  )

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
      return $command.Source
    }
  }

  throw "$Label was not found."
}

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string]$GitExe,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory
  )

  if ($WorkingDirectory) {
    & $GitExe -C $WorkingDirectory @Arguments
  } else {
    & $GitExe @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    throw ("git command failed: git {0}" -f ($Arguments -join " "))
  }
}

function Invoke-Gh {
  param(
    [Parameter(Mandatory = $true)][string]$GhExe,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $GhExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("gh command failed: gh {0}" -f ($Arguments -join " "))
  }
}

function Invoke-Robocopy {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirectories = @(),
    [string[]]$ExcludeFiles = @()
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

  if ($ExcludeFiles.Count -gt 0) {
    $arguments += "/XF"
    $arguments += $ExcludeFiles
  }

  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
  }
}

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = Split-Path -Parent $PSScriptRoot
}

$sourceRootResolved = (Resolve-Path -LiteralPath $SourceRoot).Path
$bundledGitCmd = Join-Path $sourceRootResolved "runtime\windows-tools\mingit\cmd\git.exe"
$bundledGitBin = Join-Path $sourceRootResolved "runtime\windows-tools\mingit\mingw64\bin\git.exe"
$gitExe = Resolve-ToolPath -Candidates @(
  $bundledGitCmd,
  $bundledGitBin,
  "C:\Program Files\Git\cmd\git.exe",
  "git.exe",
  "git"
) -Label "Git"
$ghExe = Resolve-ToolPath -Candidates @(
  "C:\Program Files\GitHub CLI\gh.exe",
  "gh.exe",
  "gh"
) -Label "GitHub CLI"

$gitDir = Split-Path -Parent $gitExe
$ghDir = Split-Path -Parent $ghExe
$pathEntries = @($gitDir, $ghDir, $env:PATH) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$env:PATH = ($pathEntries -join ";")

Invoke-Gh -GhExe $ghExe -Arguments @("auth", "status")
Invoke-Gh -GhExe $ghExe -Arguments @("auth", "setup-git")

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("flow-system-publish-" + [System.Guid]::NewGuid().ToString("N"))
$cloneRoot = Join-Path $tempRoot "repo"
Ensure-Directory -Path $tempRoot

try {
  Invoke-Git -GitExe $gitExe -Arguments @("clone", "--branch", $Branch, ("https://github.com/{0}.git" -f $Repo), $cloneRoot)

  $licenseBackup = $null
  $remoteLicensePath = Join-Path $cloneRoot "LICENSE"
  $localLicensePath = Join-Path $sourceRootResolved "LICENSE"
  if ($PreserveRemoteLicense -and (Test-Path -LiteralPath $remoteLicensePath) -and -not (Test-Path -LiteralPath $localLicensePath)) {
    $licenseBackup = Join-Path $tempRoot "LICENSE"
    Copy-Item -LiteralPath $remoteLicensePath -Destination $licenseBackup -Force
  }

  Get-ChildItem -LiteralPath $cloneRoot -Force | Where-Object { $_.Name -ne ".git" } | Remove-Item -Recurse -Force

  $excludeDirectories = @(
    (Join-Path $sourceRootResolved "node_modules"),
    (Join-Path $sourceRootResolved "runtime"),
    (Join-Path $sourceRootResolved "storage"),
    (Join-Path $sourceRootResolved "release"),
    (Join-Path $sourceRootResolved ".next"),
    (Join-Path $sourceRootResolved "apps\platform-web\.next"),
    (Join-Path $sourceRootResolved "apps\platform-web\.next-dev"),
    (Join-Path $sourceRootResolved "apps\platform-api\dist"),
    (Join-Path $sourceRootResolved "apps\local-agent\dist")
  ) | Where-Object { Test-Path -LiteralPath $_ }

  $excludeFiles = @(
    (Join-Path $sourceRootResolved ".env"),
    (Join-Path $sourceRootResolved "apps\platform-web\tsconfig.tsbuildinfo")
  ) | Where-Object { Test-Path -LiteralPath $_ }

  if (-not $IncludeManagedAccounts) {
    $excludeFiles += @(
      (Join-Path $sourceRootResolved "account-management\managed-users.json"),
      (Join-Path $sourceRootResolved "account-management\accounts-summary.txt")
    ) | Where-Object { Test-Path -LiteralPath $_ }
  }

  Invoke-Robocopy -Source $sourceRootResolved -Destination $cloneRoot -ExcludeDirectories $excludeDirectories -ExcludeFiles $excludeFiles

  if (-not $IncludeManagedAccounts) {
    @(
      (Join-Path $cloneRoot "account-management\managed-users.json"),
      (Join-Path $cloneRoot "account-management\accounts-summary.txt")
    ) | ForEach-Object {
      if (Test-Path -LiteralPath $_) {
        Remove-Item -LiteralPath $_ -Force
      }
    }
  }

  if ($licenseBackup -and (Test-Path -LiteralPath $licenseBackup)) {
    Copy-Item -LiteralPath $licenseBackup -Destination (Join-Path $cloneRoot "LICENSE") -Force
  }

  $login = (& $ghExe api user --jq .login).Trim()
  if ([string]::IsNullOrWhiteSpace($login)) {
    throw "Could not resolve the authenticated GitHub login."
  }

  Invoke-Git -GitExe $gitExe -WorkingDirectory $cloneRoot -Arguments @("config", "user.name", $login)
  Invoke-Git -GitExe $gitExe -WorkingDirectory $cloneRoot -Arguments @("config", "user.email", ("{0}@users.noreply.github.com" -f $login))
  Invoke-Git -GitExe $gitExe -WorkingDirectory $cloneRoot -Arguments @("add", "-A")

  $status = & $gitExe -C $cloneRoot status --short
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed."
  }

  if (-not $status) {
    Write-Host "[publish] No changes to publish."
    return
  }

  Invoke-Git -GitExe $gitExe -WorkingDirectory $cloneRoot -Arguments @("commit", "-m", $CommitMessage)
  Invoke-Git -GitExe $gitExe -WorkingDirectory $cloneRoot -Arguments @("push", "origin", $Branch)
  Write-Host "[publish] Flow System has been pushed to GitHub."
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
