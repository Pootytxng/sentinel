# release-publish.ps1 - Phase 2 of the two-command release pipeline: PUBLISH ONLY (owner ship action).
#
# Thin wrapper over release.ps1 -Mode publish. Consumes the EXACT staged receipt from release-prepare
# and, only after every gate passes, installs+proves locally, pushes the exact source + pre-existing
# tag, creates and re-downloads a DRAFT release (verifying its bytes), and finally flips the draft
# public. It takes no version/notes arguments - the candidate is already frozen in the receipt.
#
#   powershell -NoProfile -File .\scripts\release-publish.ps1
#
# This is the single explicit owner action that makes a release fleet-visible. ASCII only.
param()
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
$release = Join-Path $PSScriptRoot "release.ps1"
try {
  Invoke-StreamedProcess "release publish" "powershell" @("-NoProfile", "-File", $release, "-Mode", "publish") -WorkingDirectory (Split-Path -Parent $PSScriptRoot) | Out-Null
} catch {
  # A publish failure must name the failing stage and the child's own error. Reporting only this
  # wrapper's exit status hides the one fact an operator needs.
  Write-ReleaseFailureDiagnostic -Label "release publish" -Failure $_
  exit 1
}
exit 0
