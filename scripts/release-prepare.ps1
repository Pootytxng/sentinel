# release-prepare.ps1 - Phase 1 of the three-command release pipeline: PREPARE ONLY.
#
# Thin wrapper over release.ps1 -Mode stage. Prepare, local proof, and owner-gated publication are
# independent commands. Prepare refuses a dirty/unsynced/GM-pending tree, proves the key, bumps +
# commits the exact source, runs the full gate, builds the signed artifacts, verifies signature +
# embedded stamp, records size + SHA-256, writes + signs a receipt, creates the pre-existing source
# tag, and STOPS. It never installs, pushes, or publishes.
#
#   powershell -NoProfile -File .\scripts\release-prepare.ps1 -Notes "Plain-English notes"
#
# ASCII only (Windows PowerShell 5.1 must not reinterpret this release-critical wrapper).
param(
  [Parameter(Mandatory = $true)][string]$Notes,
  [string]$SetVersion,
  [switch]$BumpMinor
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
$release = Join-Path $PSScriptRoot "release.ps1"
$arguments = @("-NoProfile", "-File", $release, "-Mode", "stage", "-Notes", $Notes)
if ($SetVersion) {
  $arguments += @("-SetVersion", $SetVersion)
}
if ($BumpMinor) { $arguments += "-BumpMinor" }
try {
  Invoke-StreamedProcess "release prepare" "powershell" $arguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot) | Out-Null
} catch {
  Write-ReleaseFailureDiagnostic -Label "release prepare" -Failure $_
  exit 1
}
exit 0
