# Read-first recovery inspection for abandoned release/install mutex ownership.
# This script never changes GitHub. Record the verified recovery evidence on the authoritative Work
# Control issue first; only then pass that issue-comment URL together with -Clear.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("ReleasePipeline", "InstalledBinary")]
  [string]$Resource,
  [switch]$Clear,
  [string]$IssueEvidenceUrl
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
. (Join-Path $PSScriptRoot "lib\process-mutex.ps1")

$mutexName = if ($Resource -eq "ReleasePipeline") {
  "Local\Compy.ReleasePipeline.v1"
} else {
  "Local\Compy.InstalledBinary.v1"
}

$inspection = Get-CompyProcessMutexRecovery -Name $mutexName -Resource $Resource
if (-not $inspection.RecoveryRequired) {
  Write-Output "NO RECOVERY REQUIRED: $Resource"
  exit 0
}

Write-Output "RECOVERY INSPECTION REQUIRED: $Resource"
Write-Output "mutex             : $mutexName"
Write-Output "reason            : $($inspection.Reason)"
Write-Output "owner record      : $($inspection.OwnerPath)"
Write-Output "recovery marker   : $($inspection.MarkerPath)"
Write-Output "state SHA-256     : $($inspection.RecoveryStateSha256)"
if ($inspection.Owner) {
  Write-Output "recorded PID       : $($inspection.Owner.pid)"
  Write-Output "recorded start UTC : $($inspection.Owner.process_start_utc)"
  Write-Output "recorded worktree  : $($inspection.Owner.worktree)"
  Write-Output "recorded PID alive : $($inspection.OwnerAlive)"
}

if (-not $Clear) {
  Write-Output "Read-only inspection complete. Verify processes, worktree, Git state, and release receipts; record the evidence on the linked Work Control issue."
  Write-Output "Post this evidence shape on the Active work-control issue:"
  Write-Output "### Mutex recovery inspection"
  Write-Output "- Resource: $Resource"
  Write-Output "- Mutex: $mutexName"
  Write-Output "- Recovery state SHA-256: $($inspection.RecoveryStateSha256)"
  Write-Output "- Process/worktree/Git/receipts checked: <exact evidence>"
  Write-Output "- Decision: safe to clear"
  Write-Output "Nothing was cleared. Re-run with -Clear -IssueEvidenceUrl <issue-comment-url> only after that inspection."
  exit 2
}

Resolve-CompyProcessMutexRecovery `
  -Name $mutexName `
  -Resource $Resource `
  -IssueEvidenceUrl $IssueEvidenceUrl
Write-Output "RECOVERY CLEARED: $Resource"
Write-Output "evidence           : $IssueEvidenceUrl"
