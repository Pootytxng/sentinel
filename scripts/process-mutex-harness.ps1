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
  [string]$ReleaseFile,
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

# UTC, millisecond precision, one format both sides parse: the stamps below are how a test proves
# the contender's attempt fell INSIDE the holder's ownership window (#324).
function Get-Stamp {
  return [DateTime]::UtcNow.ToString('yyyy-MM-dd\THH:mm:ss.fff\Z')
}

# Holding for a FIXED number of milliseconds races the caller's next powershell.exe spawn, which
# measured >15s under the full 357-file pool on 2026-08-21 and again on 2026-09-02 (#324: a 1500ms
# hold, and the contender arrived after the holder had already released, so the assertion read a
# start-up delay as the mutex letting a second process in). Hold until the caller says it is done;
# HoldMs survives only as the hang stop.
function Wait-Release {
  if ($ReleaseFile) {
    $deadline = (Get-Date).AddMilliseconds($HoldMs)
    while (-not (Test-Path -LiteralPath $ReleaseFile) -and ((Get-Date) -lt $deadline)) {
      [System.Threading.Thread]::Sleep(50)
    }
  } else {
    [System.Threading.Thread]::Sleep($HoldMs)
  }
}

try {
  if ($Action -eq "raw-hold") {
    $raw = New-Object System.Threading.Mutex($false, $MutexName)
    $ownsRaw = $false
    try {
      $ownsRaw = $raw.WaitOne(0)
      if (-not $ownsRaw) { throw "raw test holder could not acquire $MutexName" }
      Write-Ready
      Wait-Release
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

  # Stamped BEFORE the attempt, so a refused contender still reports when it tried.
  Write-Output "ATTEMPT $(Get-Stamp)"
  $guard = Enter-CompyProcessMutex `
    -Name $MutexName `
    -Resource $Resource `
    -StateRoot $StateRoot
  $acquiredAt = Get-Stamp
  $releasedAt = $null
  try {
    Write-Ready
    if ($Action -eq "exit") { exit 0 }
    if ($Action -eq "throw") { throw "synthetic protected failure" }
    if ($Action -eq "hold") { Wait-Release }
  } finally {
    Exit-CompyProcessMutex $guard
    $releasedAt = Get-Stamp
  }
  Write-Output "ACQUIRED $acquiredAt"
  Write-Output "RELEASED $releasedAt"
  Write-Output "MUTEX ACQUIRED AND RELEASED: $Resource"
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
