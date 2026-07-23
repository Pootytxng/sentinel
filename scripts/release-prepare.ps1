# release-prepare.ps1 - Phase 1 of the two-command release pipeline: PREPARE ONLY.
#
# Thin wrapper over release.ps1 -Mode stage so "prepare" and "publish" are two INDEPENDENT commands
# (the plan's requirement). Prepare refuses a dirty/unsynced/GM-pending tree, proves the key, bumps +
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
$release = Join-Path $PSScriptRoot "release.ps1"
if ($SetVersion) {
  & $release -Mode stage -Notes $Notes -SetVersion $SetVersion -BumpMinor:$BumpMinor
} else {
  & $release -Mode stage -Notes $Notes -BumpMinor:$BumpMinor
}
exit $LASTEXITCODE
