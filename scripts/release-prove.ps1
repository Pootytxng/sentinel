# release-prove.ps1 - install and live-prove the exact staged candidate without pushing or publishing.
# ASCII only for Windows PowerShell 5.1.
param()
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
$release = Join-Path $PSScriptRoot "release.ps1"
try {
  Invoke-StreamedProcess "release local proof" "powershell" @(
    "-NoProfile", "-File", $release, "-Mode", "prove"
  ) -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -TimeoutMs 1800000 | Out-Null
} catch {
  Write-ReleaseFailureDiagnostic -Label "release local proof" -Failure $_
  exit 1
}
exit 0
