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

function Invoke-DownloadWithRetry([string]$Uri, [string]$OutFile) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
      return
    } catch {
      $lastError = $_
      if ($attempt -lt 6) { Start-Sleep -Seconds 5 }
    }
  }
  throw "Public release download failed after retries: $Uri`n$lastError"
}
