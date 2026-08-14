# Test harness for the machine-local process mutex. Production entrypoints use the same helper;
# this file only supplies deterministic hold/crash/inspection actions for real multi-process tests.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("hold", "raw-hold", "acquire", "throw", "exit", "inspect", "clear")]
  [string]$Action,
  [Parameter(Mandatory = $true)][string]$MutexName,
  [Parameter(Mandatory = $true)][string]$Resource,
  [Parameter(Mandatory = $true)][string]$StateRoot,
  [string]$ReadyFile,
  [int]$HoldMs = 0,
  [string]$IssueEvidenceUrl,
  [string]$IssueEvidenceFile
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\process-mutex.ps1")

function Write-Ready {
  if (-not $ReadyFile) { return }
  [System.IO.File]::WriteAllText($ReadyFile, "ready", [System.Text.Encoding]::UTF8)
}

try {
  if ($Action -eq "raw-hold") {
    $raw = New-Object System.Threading.Mutex($false, $MutexName)
    $ownsRaw = $false
    try {
      $ownsRaw = $raw.WaitOne(0)
      if (-not $ownsRaw) { throw "raw test holder could not acquire $MutexName" }
      Write-Ready
      [System.Threading.Thread]::Sleep($HoldMs)
    } finally {
      if ($ownsRaw) { $raw.ReleaseMutex() }
      $raw.Dispose()
    }
    Write-Output "RAW HOLDER RELEASED: $Resource"
    exit 0
  }

  if ($Action -eq "inspect") {
    $inspection = Get-CompyProcessMutexRecovery `
      -Name $MutexName `
      -Resource $Resource `
      -StateRoot $StateRoot
    $inspection | ConvertTo-Json -Depth 6
    if ($inspection.RecoveryRequired) { exit 2 }
    exit 0
  }

  if ($Action -eq "clear") {
    $testIssueLookup = $null
    if ($IssueEvidenceFile) {
      $fixture = ([System.IO.File]::ReadAllText($IssueEvidenceFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
      $testIssueLookup = {
        param($Kind, $Id)
        if ($Kind -eq "comment" -and [long]$fixture.comment.id -eq [long]$Id) { return $fixture.comment }
        if ($Kind -eq "issue" -and [long]$fixture.issue.number -eq [long]$Id) { return $fixture.issue }
        if ($Kind -eq "project" -and [long]$fixture.issue.number -eq [long]$Id) { return $fixture.project }
        throw "Issue evidence fixture has no matching $Kind $Id."
      }.GetNewClosure()
    }
    Resolve-CompyProcessMutexRecovery `
      -Name $MutexName `
      -Resource $Resource `
      -StateRoot $StateRoot `
      -IssueEvidenceUrl $IssueEvidenceUrl `
      -TestIssueLookup $testIssueLookup
    Write-Output "RECOVERY CLEARED: $Resource"
    exit 0
  }

  $guard = Enter-CompyProcessMutex `
    -Name $MutexName `
    -Resource $Resource `
    -StateRoot $StateRoot
  try {
    Write-Ready
    if ($Action -eq "exit") { exit 0 }
    if ($Action -eq "throw") { throw "synthetic protected failure" }
    if ($Action -eq "hold") { [System.Threading.Thread]::Sleep($HoldMs) }
  } finally {
    Exit-CompyProcessMutex $guard
  }
  Write-Output "MUTEX ACQUIRED AND RELEASED: $Resource"
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
