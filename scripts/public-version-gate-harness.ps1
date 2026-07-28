# public-version-gate-harness.ps1 - behavioural harness for Assert-PublicVersionCanPublish.
#
# release.ps1 is an entry point (top-level param + immediate execution), so it cannot be dot-sourced.
# This harness extracts the REAL function text from the shipped file and runs it, so the behaviour
# under test is the code that publishes, not a copy of it. Only the two transports are replaced:
# the gh releases listing and the public-manifest download.
#
# It exists because a green test suite still shipped a gate that answered "v0.9.11 exists as a
# prerelease" about a release whose prerelease flag was false: PowerShell 5.1 returns a parsed JSON
# array as ONE Object[], so @(<pipeline> | ConvertFrom-Json) nested it, property reads
# member-enumerated, and a multi-element array of $false is TRUE. Only real PowerShell 5.1 execution
# catches that class - a Node-side contract harness cannot.
#
# Every scenario emits ONE line of JSON (ok/failed alike), so a failure is asserted against the exact
# thrown message instead of console-wrapped PowerShell error text.
# ASCII only for Windows PowerShell 5.1.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "compatible-draft",
    "genuine-prerelease",
    "duplicate-release",
    "existing-without-candidate-state",
    "absent-tag",
    "empty-release-list",
    "unreadable-list",
    "timeout-list",
    "empty-response",
    "malformed-json",
    "wrong-shape",
    "nested-entry-shape",
    "downgrade-blocked",
    "equal-version-blocked",
    "manifest-disagreement",
    "non-semantic-latest-tag"
  )]
  [string]$Scenario,
  # Adversarial mutation seam: the regression tests re-introduce the historical nested parse in a
  # COPY of release.ps1 and require this harness to fail on it. A guard that passes both before and
  # after the fix proves nothing.
  [string]$SourcePath
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "lib\native-process.ps1")
. (Join-Path $PSScriptRoot "lib\release-artifacts.ps1")

$releasesRepo = "Pootytxng/compy-releases"
$script:CandidateTag = "v0.9.11"
$script:CandidateVersion = "0.9.11"
$script:AllowCandidateState = $true
$script:PublicManifestVersion = "0.9.7"
$script:ListArguments = $null

$published = '{"tagName":"v0.9.7","isDraft":false,"isPrerelease":false,"publishedAt":"2026-07-20T00:00:00Z"}'
$draft = '{"tagName":"v0.9.11","isDraft":true,"isPrerelease":false,"publishedAt":null}'
$prerelease = '{"tagName":"v0.9.11","isDraft":false,"isPrerelease":true,"publishedAt":"2026-07-26T00:00:00Z"}'
$older = '{"tagName":"v0.9.4","isDraft":false,"isPrerelease":false,"publishedAt":"2026-07-01T00:00:00Z"}'

$listResult = @{ ExitCode = 0; StdErr = ""; TimedOut = $false; StdOut = "[$older,$published,$draft]" }

switch ($Scenario) {
  "compatible-draft" { }
  "genuine-prerelease" { $listResult.StdOut = "[$older,$published,$prerelease]" }
  "duplicate-release" { $listResult.StdOut = "[$published,$draft,$draft]" }
  "existing-without-candidate-state" { $script:AllowCandidateState = $false }
  "absent-tag" { $listResult.StdOut = "[$older,$published]" }
  "empty-release-list" { $listResult.StdOut = "[]" }
  "unreadable-list" {
    $listResult.ExitCode = 1
    $listResult.StdOut = ""
    $listResult.StdErr = "gh: authentication required`nsecond line"
  }
  "timeout-list" { $listResult.TimedOut = $true; $listResult.StdOut = "" }
  "empty-response" { $listResult.StdOut = "   " }
  "malformed-json" { $listResult.StdOut = "[{`"tagName`":" }
  "wrong-shape" { $listResult.StdOut = '{"tagName":"v0.9.11","isDraft":true,"isPrerelease":false}' }
  "nested-entry-shape" { $listResult.StdOut = "[[$published],[$draft]]" }
  "downgrade-blocked" { $script:CandidateVersion = "0.9.6"; $script:CandidateTag = "v0.9.6"; $listResult.StdOut = "[$older,$published]" }
  "equal-version-blocked" {
    # Same version as the public manifest, under a tag the listing does not contain, so the
    # non-increase branch is reached instead of the earlier already-exists branch.
    $script:CandidateVersion = "0.9.4"
    $script:CandidateTag = "v0.9.4-rc"
    $script:AllowCandidateState = $false
    $listResult.StdOut = "[$older]"
    $script:PublicManifestVersion = "0.9.4"
  }
  "manifest-disagreement" { $script:PublicManifestVersion = "0.9.4" }
  "non-semantic-latest-tag" {
    $listResult.StdOut = '[{"tagName":"latest","isDraft":false,"isPrerelease":false,"publishedAt":"2026-07-20T00:00:00Z"}]'
  }
}

# Seam replacement: these definitions win over the dot-sourced originals.
function Invoke-NativeProcess {
  param(
    [string]$Command,
    [string[]]$ArgumentList,
    [int]$TimeoutMs,
    [Parameter(ValueFromRemainingArguments = $true)]$Rest
  )
  $script:ListArguments = $ArgumentList
  return [pscustomobject]@{
    ExitCode = $listResult.ExitCode
    StdOut   = $listResult.StdOut
    StdErr   = $listResult.StdErr
    TimedOut = $listResult.TimedOut
  }
}

function Invoke-DownloadWithRetry([string]$Uri, [string]$OutFile) {
  $body = '{"version":"' + $script:PublicManifestVersion + '","platforms":{}}'
  Set-Content -LiteralPath $OutFile -Value $body -Encoding UTF8
}

$resolvedSource = if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  Join-Path $PSScriptRoot "release.ps1"
} else {
  $SourcePath
}
$source = Get-Content -LiteralPath $resolvedSource -Raw
$start = $source.IndexOf("function Assert-PublicVersionCanPublish")
if ($start -lt 0) { throw "Assert-PublicVersionCanPublish is missing from release.ps1" }
$open = $source.IndexOf("{", $start)
$depth = 0
$end = -1
for ($index = $open; $index -lt $source.Length; $index++) {
  $char = $source[$index]
  if ($char -eq "{") { $depth++ }
  elseif ($char -eq "}") {
    $depth--
    if ($depth -eq 0) { $end = $index; break }
  }
}
if ($end -lt 0) { throw "Could not brace-match Assert-PublicVersionCanPublish in release.ps1" }
$functionText = $source.Substring($start, $end - $start + 1)
foreach ($required in @("ConvertFrom-Json", "Refusing updater downgrade/non-increase", "Invoke-DownloadWithRetry")) {
  if ($functionText -notmatch [regex]::Escape($required)) {
    throw "Extracted function text is truncated; it is missing: $required"
  }
}
. ([scriptblock]::Create($functionText))

$outcome = [ordered]@{ scenario = $Scenario; ok = $false; error = ""; listed = $false }
try {
  if ($script:AllowCandidateState) {
    Assert-PublicVersionCanPublish $script:CandidateVersion $script:CandidateTag -AllowCandidateState
  } else {
    Assert-PublicVersionCanPublish $script:CandidateVersion $script:CandidateTag
  }
  $outcome.ok = $true
} catch {
  $outcome.error = ("" + $_.Exception.Message)
}
$outcome.listed = ($null -ne $script:ListArguments -and ($script:ListArguments -join " ").Contains("isPrerelease"))
Write-Output ($outcome | ConvertTo-Json -Compress -Depth 5)
