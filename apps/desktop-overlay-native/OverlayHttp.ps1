Add-Type -AssemblyName System.Net.Http

function New-OverlayHttpClient {
  $handler = New-Object System.Net.Http.HttpClientHandler
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(5)
  $client.DefaultRequestHeaders.Accept.Clear()
  $client.DefaultRequestHeaders.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new("application/json"))
  return $client
}

function Invoke-OverlayJsonRequest {
  param(
    [Parameter(Mandatory = $true)][System.Net.Http.HttpClient]$Client,
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet("GET", "POST")][string]$Method = "GET",
    $Body = $null
  )

  $requestUri = "{0}{1}" -f $BaseUrl.TrimEnd("/"), $Path
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::$Method, $requestUri)

  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    $request.Content = [System.Net.Http.StringContent]::new($json, [System.Text.Encoding]::UTF8, "application/json")
  }

  $response = $Client.SendAsync($request).GetAwaiter().GetResult()
  $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) {
    $details = $content
    try {
      $payload = $content | ConvertFrom-Json
      if ($payload.error) {
        $details = [string]$payload.error
      } elseif ($payload.message) {
        $details = [string]$payload.message
      }
    } catch {
    }
    throw "HTTP {0} {1}: {2}" -f ([int]$response.StatusCode), $response.ReasonPhrase, $details
  }

  if ([string]::IsNullOrWhiteSpace($content)) {
    return $null
  }

  return $content | ConvertFrom-Json
}
