[CmdletBinding()]
param(
  [string]$Version,
  [string]$Notes = "",
  [string]$ApiBaseUrl = "http://127.0.0.1:4010",
  [string]$Username = "admin",
  [string]$Password = "admin123"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$agentPackageJson = Join-Path $repoRoot "apps\local-agent\package.json"
if (-not $Version) {
  $package = Get-Content -Raw $agentPackageJson | ConvertFrom-Json
  $Version = [string]$package.version
}

$storageRoot = Join-Path $repoRoot "storage"
$releaseRelDir = "releases/agents/$Version"
$releaseDir = Join-Path $storageRoot $releaseRelDir
$artifactName = "flow-system-agent-$Version.tar.gz"
$artifactPath = Join-Path $releaseDir $artifactName

if (-not (Test-Path -LiteralPath $releaseDir)) {
  New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

if (Test-Path -LiteralPath $artifactPath) {
  Remove-Item -LiteralPath $artifactPath -Force
}

Push-Location $repoRoot
try {
  & tar.exe `
    --exclude=.git `
    --exclude=node_modules `
    --exclude=runtime `
    --exclude=storage `
    --exclude=apps/platform-web/.next `
    -czf $artifactPath `
    .
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create agent release archive"
  }
} finally {
  Pop-Location
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $artifactPath).Length

$loginBody = @{
  username = $Username
  password = $Password
} | ConvertTo-Json

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginResponse = Invoke-RestMethod `
  -Method Post `
  -Uri "$ApiBaseUrl/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body $loginBody `
  -WebSession $session

$csrfToken = [string]$loginResponse.csrf_token
if (-not $csrfToken) {
  throw "Could not obtain CSRF token from platform login"
}

$publishBody = @{
  version = $Version
  notes = $Notes
  package_rel_path = "$releaseRelDir/$artifactName"
  package_sha256 = $hash
  package_size_bytes = $size
} | ConvertTo-Json

$publishResponse = Invoke-RestMethod `
  -Method Post `
  -Uri "$ApiBaseUrl/api/v1/releases/agents/current" `
  -ContentType "application/json" `
  -Body $publishBody `
  -Headers @{ "x-csrf-token" = $csrfToken } `
  -WebSession $session

Write-Host "Agent release published"
Write-Host "  Version : $Version"
Write-Host "  Package : $artifactPath"
Write-Host "  SHA256  : $hash"
Write-Host "  Size    : $size bytes"
Write-Host "  API     : $ApiBaseUrl"
