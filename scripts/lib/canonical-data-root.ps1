# CANONICAL DATA ROOT — preflight parity with the Rust resolver (#130, 2026-08-18).
#
# WHY THIS EXISTS — a real defect, not a hypothetical:
#
#   Compy was launched at least once as a child of the MSIX-packaged Claude desktop app. A child of
#   a packaged host inherits the package's filesystem overlay: `$env:APPDATA` still reads
#   `C:\Users\<u>\AppData\Roaming` — the STRING is correct — but resolving anything under it lands in
#   `...\AppData\Local\Packages\<family>\LocalCache\Roaming\`. Compy's Trust Ledger split in two.
#   61 receipts of real Windows changes went to the overlay; a normally-launched Compy sees 3.
#
#   The release and ship preflights each did `Join-Path $env:APPDATA "Compy"` and then
#   `if (-not (Test-Path $dir)) { return }` — they FAIL OPEN. Run from a redirected shell they would
#   inspect the overlay, find no pending Gaming Mode contract, and wave a publish through while a
#   real un-restored session sat on the real machine. The gate would report PASS for a directory it
#   had never looked at.
#
# So the rule is mechanical on this side too: a preflight that reads Compy's data root must PROVE
# the root is canonical, and REFUSE when it cannot. Absence of evidence is never a pass.
#
# `src-tauri/src/data_root.rs` is the authority; this is the same decision in PowerShell, kept
# deliberately smaller (it needs no `MutationRoot` capability, only a verified path or a throw).
# `scripts/data-root-guard.test.mjs` fails the build if a script composes a data path from
# `$env:APPDATA` without coming through here.

Set-StrictMode -Version Latest

$script:PackagesSegment = '\appdata\local\packages\'

function Deny-CompyDataRoot {
  <#
    .SYNOPSIS
      The single refusal. A named function rather than a ScriptBlock because the release PowerShell
      static guard forbids the `&` call operator outside its typed gateway - and a preflight helper
      that trips the release lint is not a helper.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Phase,
    [Parameter(Mandatory)][string]$Why,
    [Parameter(Mandatory)][string]$Tail
  )
  throw "Refused ($Phase): $Why $Tail"
}

function Get-CanonicalCompyDataRoot {
  <#
    .SYNOPSIS
      The verified canonical `%APPDATA%\Compy`, or a throw explaining why it cannot be verified.
    .PARAMETER Phase
      Named in the refusal so the operator knows which gate stopped.
    .OUTPUTS
      [pscustomobject] Path (string), Exists (bool). Never a guess, never a fallback.
  #>
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Phase)

  # Two refusal tails on purpose. A wrong-shell problem is fixed by relaunching; a real split is
  # not, and telling the operator to "just retry" would send them round a loop that cannot close.
  $relaunch = "This gate cannot honestly pass. Run this from a normal PowerShell / Windows Terminal session (never from inside another app's terminal), then retry."
  $recover  = "This gate cannot honestly pass, and relaunching will not clear it. See docs/decisions/2026-08-18-canonical-data-root.md and GitHub issue #130 - recovery is owner-gated."

  # P1 — the environment must exist at all.
  $appData = $env:APPDATA
  if ([string]::IsNullOrWhiteSpace($appData)) { Deny-CompyDataRoot -Phase $Phase -Why "APPDATA is not set." -Tail $relaunch }
  $userProfile = $env:USERPROFILE
  if ([string]::IsNullOrWhiteSpace($userProfile)) { Deny-CompyDataRoot -Phase $Phase -Why "USERPROFILE is not set." -Tail $relaunch }

  # P2 — the APPDATA *string* must be the user's own Roaming dir, and must not already name a
  # package container. Cheap, catches env tampering and an explicitly-redirected shell.
  $expected = Join-Path $userProfile 'AppData\Roaming'
  if ($appData.TrimEnd('\') -ne $expected.TrimEnd('\')) {
    Deny-CompyDataRoot -Phase $Phase -Why "APPDATA is '$appData' but this account's Roaming folder is '$expected'." -Tail $relaunch
  }
  if ($appData.ToLowerInvariant().Contains($script:PackagesSegment)) {
    Deny-CompyDataRoot -Phase $Phase -Why "APPDATA resolves inside an app package container ('$appData')." -Tail $relaunch
  }

  $root = Join-Path $appData 'Compy'
  $exists = Test-Path -LiteralPath $root -PathType Container

  # P3 — DECISIVE. Where does the opened directory actually LAND? This is the predicate that caught
  # the real incident: under a packaged host the string above passes and this one does not.
  if ($exists) {
    $item = Get-Item -LiteralPath $root -Force -ErrorAction Stop
    $final = if ($item.PSObject.Properties['Target'] -and $item.Target) { [string]$item.Target } else { $item.FullName }
    if ($final.ToLowerInvariant().Contains($script:PackagesSegment)) {
      Deny-CompyDataRoot -Phase $Phase -Why "'$root' actually resolves to '$final', inside an app package container." -Tail $relaunch
    }
  }

  # P4 — a package overlay copy that still holds receipts is a SPLIT. Refuse rather than pick one;
  # nothing here reads, copies, merges or deletes either side (recovery is owner-gated).
  $packagesDir = Join-Path $userProfile 'AppData\Local\Packages'
  if (Test-Path -LiteralPath $packagesDir -PathType Container) {
    $foreign = @(Get-ChildItem -LiteralPath $packagesDir -Directory -Force -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Compy\history.json' } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
      Where-Object { (Get-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue).Length -gt 2 })
    if ($foreign.Count -gt 0) {
      Deny-CompyDataRoot -Phase $Phase -Why "a second Compy change history exists in an app package container ($($foreign -join ', ')). Nothing has been merged, copied or undone — this needs the documented recovery, not a publish." -Tail $recover
    }
  }

  [pscustomobject]@{ Path = $root; Exists = $exists }
}
