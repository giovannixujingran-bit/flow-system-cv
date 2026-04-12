[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$lines = & netsh interface portproxy show v4tov4
foreach ($line in $lines) {
  if ($line -match "^\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$") {
    $listenAddress = $matches[1]
    $listenPort = [int]$matches[2]
    if ($listenPort -in @(3000, 4010)) {
      & netsh interface portproxy delete v4tov4 listenaddress=$listenAddress listenport=$listenPort | Out-Null
    }
  }
}

Get-NetFirewallRule -DisplayName "Flow System Platform Web 3000" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName "Flow System Platform API 4010" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

Write-Host "Flow System LAN proxy removed for ports 3000 and 4010."
