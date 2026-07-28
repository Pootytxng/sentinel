# release-artifacts.ps1 - shared receipt-bound artifact verification for production and sandbox proof.
# The caller defines $repo and $releasesRepo before dot-sourcing this file.
# ASCII only for Windows PowerShell 5.1.

function Get-ArtifactHash([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Release artifact is missing: $Path"
  }
  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Resolve-ReceiptArtifact([string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($RelativePath)) {
    throw "Staged receipt contains an empty artifact path."
  }
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $repo $RelativePath))
  $rootPrefix = $repo.TrimEnd('\') + '\'
  if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Staged receipt artifact escapes the repository: $RelativePath"
  }
  return $candidate
}

function Assert-ReceiptHash([string]$Label, [string]$Path, [string]$Expected) {
  $actual = Get-ArtifactHash $Path
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "$Label hash changed after staging. Expected $Expected; found $actual."
  }
}

function Read-BoundManifest([string]$Path, [string]$SignaturePath, [string]$Version, [string]$InstallerName) {
  $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($manifest.version -ne $Version) {
    throw "Manifest version $($manifest.version) does not match staged version $Version."
  }
  $platform = $manifest.platforms.'windows-x86_64'
  if (-not $platform) {
    throw "Manifest has no windows-x86_64 updater entry."
  }
  $expectedUrl = "https://github.com/$releasesRepo/releases/download/v$Version/$InstallerName"
  if ($platform.url -ne $expectedUrl) {
    throw "Manifest URL does not bind the staged release. Expected $expectedUrl; found $($platform.url)."
  }
  $signatureText = (Get-Content -LiteralPath $SignaturePath -Raw).Trim()
  if ($platform.signature -ne $signatureText) {
    throw "Manifest signature does not match the staged updater signature."
  }
  return $manifest
}

# GitHub's /releases/latest/download/ alias is eventually consistent: for a window after a release
# is published it still redirects to the PREVIOUS release. Every read of that alias is therefore
# issued with no-cache headers and a unique query token, so no proxy, CDN edge or local cache can
# hand back a stale body that either fakes propagation lag or hides a real one.
$script:ReleaseNoCacheHeaders = @{
  "Cache-Control" = "no-cache, no-store, max-age=0"
  "Pragma" = "no-cache"
}

# Injected transports (sandbox and regression harnesses) raise this exact marker to model "the alias
# does not carry this asset yet". Production classifies the identical condition from a real HTTP 404.
$script:ReleasePropagationAbsenceMarker = "release-asset-not-published-yet"

function Add-ReleaseCacheBustingQuery([string]$Uri, [string]$Token) {
  if ([string]::IsNullOrWhiteSpace($Token)) { return $Uri }
  $separator = "?"
  if ($Uri.Contains("?")) { $separator = "&" }
  return $Uri + $separator + "compy-cache-bust=" + $Token
}

# Absence is the ONLY retryable download outcome. A response that is not a 404, or a failure with no
# HTTP response at all (DNS, TLS, timeout, authentication), is a real failure and is never absorbed.
function Test-ReleasePropagationAbsence($ErrorRecord) {
  if ($null -eq $ErrorRecord) { return $false }
  $exception = $ErrorRecord.Exception
  $response = $null
  if ($exception -and ($exception.PSObject.Properties.Name -contains "Response")) {
    $response = $exception.Response
  }
  if ($response) {
    $status = 0
    try { $status = [int]$response.StatusCode } catch { $status = 0 }
    return ($status -eq 404)
  }
  return (("" + $ErrorRecord) -like ("*" + $script:ReleasePropagationAbsenceMarker + "*"))
}

function ConvertTo-ReleaseVersionParts([string]$Version) {
  $match = [regex]::Match(("" + $Version).Trim(), '^(\d+)\.(\d+)\.(\d+)$')
  if (-not $match.Success) { return $null }
  return @([int]$match.Groups[1].Value, [int]$match.Groups[2].Value, [int]$match.Groups[3].Value)
}

function Compare-ReleaseVersion([string]$Left, [string]$Right) {
  $leftParts = ConvertTo-ReleaseVersionParts $Left
  $rightParts = ConvertTo-ReleaseVersionParts $Right
  if ($null -eq $leftParts -or $null -eq $rightParts) {
    throw "Refusing to compare non-semantic release versions: '$Left' and '$Right'."
  }
  for ($index = 0; $index -lt 3; $index++) {
    if ($leftParts[$index] -lt $rightParts[$index]) { return -1 }
    if ($leftParts[$index] -gt $rightParts[$index]) { return 1 }
  }
  return 0
}

function Invoke-DownloadWithRetry([string]$Uri, [string]$OutFile, [switch]$StopOnNotFound) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -Headers $script:ReleaseNoCacheHeaders
      return
    } catch {
      $lastError = $_
      # A caller polling an eventually-consistent alias classifies absence itself; burning the inner
      # retry budget on a 404 it already expects would only blur its own backoff and deadline.
      if ($StopOnNotFound -and (Test-ReleasePropagationAbsence $lastError)) { throw }
      if ($attempt -lt 6) { Start-Sleep -Seconds 5 }
    }
  }
  throw "Public release download failed after retries: $Uri`n$lastError"
}
