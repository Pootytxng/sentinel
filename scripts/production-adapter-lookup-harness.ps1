# production-adapter-lookup-harness.ps1 - focused harness for the draft-aware release lookup.
#
# The native sandbox proves the whole transaction over real handlers; this harness isolates
# Get-ProductionRelease and the draft-sensitive inspectors by replacing ONLY the gh transport with
# canned results. That is the only practical way to cover transport outcomes the sandbox cannot
# produce cheaply - a 300s timeout, a rate-limited listing, a by-id read that fails after the
# listing already proved the release exists.
#
# Every scenario emits ONE line of JSON (ok/failed alike), so a failure is asserted against the
# exact thrown message instead of console-wrapped PowerShell error text.
# ASCII only for Windows PowerShell 5.1.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "absent-empty-list",
    "private-draft",
    "published-release",
    "duplicate-release",
    "case-variant-tag",
    "authentication-failure",
    "permission-failure",
    "network-failure",
    "rate-limit-failure",
    "not-found-list",
    "timeout-failure",
    "malformed-list",
    "empty-list-response",
    "wrong-shape-list",
    "paginated-draft",
    "unterminated-pagination",
    "precise-read-failure",
    "precise-read-mismatch",
    "precise-read-timeout",
    "draft-assets-private-draft",
    "published-after-flag-change"
  )]
  [string]$Scenario
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\native-process.ps1")
. (Join-Path $PSScriptRoot "lib\release-artifacts.ps1")
. (Join-Path $PSScriptRoot "lib\release-transaction.ps1")
. (Join-Path $PSScriptRoot "lib\release-publish-adapter.ps1")

$script:Calls = New-Object System.Collections.Generic.List[string]
$script:Published = ($Scenario -eq "published-release")
$script:ReleaseId = 990099
$script:Tag = "v9.9.9"
$script:Title = "Compy v9.9.9"
$script:Notes = "Compy v9.9.9 release notes."

function New-GhResult {
  param(
    [int]$ExitCode = 0,
    [string]$StdOut = "",
    [string]$StdErr = "",
    [bool]$TimedOut = $false,
    [string]$Arguments = ""
  )
  return [pscustomobject]@{
    FilePath             = "gh"
    Arguments            = $Arguments
    ExitCode             = $ExitCode
    StdOut               = $StdOut
    StdErr               = $StdErr
    TimedOut             = $TimedOut
    ProcessId            = 4242
    DurationMs           = 1
    TerminationAttempted = $false
    EnvironmentKeys      = @()
  }
}

function New-ReleaseJson {
  param(
    [int]$Id,
    [string]$Tag,
    [bool]$Draft,
    [string]$Name = "",
    [string]$Body = "",
    [string]$Assets = "[]"
  )
  $draftText = if ($Draft) { "true" } else { "false" }
  return @"
{"id":$Id,"tag_name":"$Tag","name":"$Name","body":"$Body","draft":$draftText,"prerelease":false,"published_at":"2026-07-28T00:00:00Z","assets":$Assets}
"@
}

function New-ReleaseObject {
  param([string]$Tag = $script:Tag)
  return New-ReleaseJson -Id $script:ReleaseId -Tag $Tag -Draft (-not $script:Published) -Name $script:Title -Body $script:Notes
}

function New-PadPage {
  param([int]$Count, [int]$Offset)
  $entries = New-Object System.Collections.Generic.List[string]
  for ($index = 0; $index -lt $Count; $index++) {
    $entries.Add((New-ReleaseJson -Id (700000 + $Offset + $index) -Tag ("v0.0." + ($Offset + $index)) -Draft $false))
  }
  return "[" + ($entries.ToArray() -join ",") + "]"
}

function New-ListResult {
  param([int]$Page, [int]$PageSize, [string]$Arguments)
  switch ($Scenario) {
    "authentication-failure" { return New-GhResult -ExitCode 1 -StdErr "gh: Bad credentials (HTTP 401)" -Arguments $Arguments }
    "permission-failure" { return New-GhResult -ExitCode 1 -StdErr "gh: Resource not accessible by personal access token (HTTP 403)" -Arguments $Arguments }
    "network-failure" { return New-GhResult -ExitCode 1 -StdErr "error connecting to api.github.com" -Arguments $Arguments }
    "rate-limit-failure" { return New-GhResult -ExitCode 1 -StdErr "gh: API rate limit exceeded (HTTP 429)" -Arguments $Arguments }
    # A 404 from the LISTING endpoint is a broken request, never evidence that one release is absent.
    "not-found-list" { return New-GhResult -ExitCode 1 -StdErr "gh: Not Found (HTTP 404)" -Arguments $Arguments }
    "timeout-failure" { return New-GhResult -ExitCode -1 -TimedOut $true -Arguments $Arguments }
    "malformed-list" { return New-GhResult -StdOut '[{"id":990099,"tag_name":' -Arguments $Arguments }
    "empty-list-response" { return New-GhResult -StdOut "" -Arguments $Arguments }
    "wrong-shape-list" { return New-GhResult -StdOut '{"message":"Not Found","status":"404"}' -Arguments $Arguments }
    # Every page stays full, so the listing never terminates and must be refused rather than trusted.
    "unterminated-pagination" { return New-GhResult -StdOut (New-PadPage -Count $PageSize -Offset ($Page * $PageSize)) -Arguments $Arguments }
    "paginated-draft" {
      if ($Page -eq 1) { return New-GhResult -StdOut (New-PadPage -Count $PageSize -Offset 0) -Arguments $Arguments }
      return New-GhResult -StdOut ("[" + (New-ReleaseObject) + "]") -Arguments $Arguments
    }
  }
  if ($Page -gt 1) { return New-GhResult -StdOut "[]" -Arguments $Arguments }
  switch ($Scenario) {
    "absent-empty-list" { return New-GhResult -StdOut "[]" -Arguments $Arguments }
    "duplicate-release" {
      $first = New-ReleaseJson -Id 771001 -Tag $script:Tag -Draft $true -Name $script:Title -Body $script:Notes
      $second = New-ReleaseJson -Id 771002 -Tag $script:Tag -Draft $false -Name $script:Title -Body $script:Notes
      return New-GhResult -StdOut ("[" + $first + "," + $second + "]") -Arguments $Arguments
    }
    "case-variant-tag" {
      $variant = New-ReleaseJson -Id 771003 -Tag "V9.9.9" -Draft $true -Name $script:Title -Body $script:Notes
      return New-GhResult -StdOut ("[" + $variant + "]") -Arguments $Arguments
    }
  }
  return New-GhResult -StdOut ("[" + (New-ReleaseObject) + "]") -Arguments $Arguments
}

function New-PreciseResult {
  param([int]$Id, [string]$Arguments)
  switch ($Scenario) {
    # The listing already proved this release exists, so a 404 here is a contradiction, not absence.
    "precise-read-failure" { return New-GhResult -ExitCode 1 -StdErr "gh: Not Found (HTTP 404)" -Arguments $Arguments }
    "precise-read-mismatch" { return New-GhResult -StdOut (New-ReleaseObject -Tag "v9.9.8") -Arguments $Arguments }
    "precise-read-timeout" { return New-GhResult -ExitCode -1 -TimedOut $true -Arguments $Arguments }
  }
  return New-GhResult -StdOut (New-ReleaseObject) -Arguments $Arguments
}

# The ONLY replaced seam: the gh transport. Every lookup, filter, pagination and fail-closed decision
# under test is the real production code.
function Invoke-ProductionGhProcess {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 300000
  )
  $arguments = ($ArgumentList -join " ")
  $script:Calls.Add($arguments)
  $endpoint = if ($ArgumentList.Count -ge 2) { [string]$ArgumentList[1] } else { "" }
  if ($endpoint -match '/releases\?per_page=(\d+)&page=(\d+)$') {
    return New-ListResult -Page ([int]$Matches[2]) -PageSize ([int]$Matches[1]) -Arguments $arguments
  }
  if ($endpoint -match '/releases/(\d+)$') {
    return New-PreciseResult -Id ([int]$Matches[1]) -Arguments $arguments
  }
  return New-GhResult -ExitCode 1 -StdErr "gh: Not Found (HTTP 404)" -Arguments $arguments
}

$context = [pscustomobject]@{
  ReleasesRepo  = "sandbox/compy-releases"
  Receipt       = [pscustomobject]@{ tag = $script:Tag; version = "9.9.9" }
  ReleaseNotes  = $script:Notes
  InstallerName = "Compy_9.9.9_x64-setup.exe"
}

try {
  $payload = @{}
  switch ($Scenario) {
    "draft-assets-private-draft" {
      $inspection = Inspect-ProductionDraftAssets -Context $context
      $payload.status = $inspection.Status
      $payload.missing = @($inspection.Evidence.missing_assets)
    }
    "published-after-flag-change" {
      $draft = Inspect-ProductionDraft -Context $context
      $payload.draft_status = $draft.Status
      $payload.draft_state = [string]$draft.Evidence.state
      $payload.draft_id = [string]$draft.Evidence.release_id
      $pending = Inspect-ProductionPublished -Context $context
      $payload.pending_status = $pending.Status
      # Publication flips ONLY the draft flag: the same release must still be recognized.
      $script:Published = $true
      $published = Inspect-ProductionPublished -Context $context
      $payload.published_status = $published.Status
      $payload.published_id = [string]$published.Evidence.release_id
    }
    default {
      $lookup = Get-ProductionRelease -Context $context
      $payload.found = [bool]$lookup.Found
      $payload.release_id = if ($lookup.Found) { [string]$lookup.Value.id } else { "" }
      $payload.draft = if ($lookup.Found) { [bool]$lookup.Value.draft } else { $false }
      $inspection = Inspect-ProductionDraft -Context $context
      $payload.status = $inspection.Status
      $payload.state = if ($inspection.Evidence.ContainsKey("state")) { [string]$inspection.Evidence.state } else { "" }
    }
  }
  $payload.ok = $true
  $payload.scenario = $Scenario
  $payload.calls = @($script:Calls.ToArray())
  $payload.call_count = $script:Calls.Count
  Write-Output (ConvertTo-Json $payload -Compress -Depth 6)
  exit 0
} catch {
  $failure = @{
    ok         = $false
    scenario   = $Scenario
    error      = [string]$_.Exception.Message
    calls      = @($script:Calls.ToArray())
    call_count = $script:Calls.Count
  }
  Write-Output (ConvertTo-Json $failure -Compress -Depth 6)
  exit 1
}
