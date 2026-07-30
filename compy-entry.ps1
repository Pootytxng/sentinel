#!/usr/bin/env pwsh
# The one thing Kuya runs. Everything else is an implementation detail.
#
# It resolves the control folder from its own location, never from the current directory, asserts
# its own pin, asks the preflight for a verdict, and only then routes into the right worktree with
# that folder as the real project root.
#
# On REFUSE it prints what disagreed and what to do, and writes nothing.
#
# pwsh (PowerShell 7) only. PowerShell 5.1 mis-decodes this repo's UTF-8-without-BOM scripts into
# parse errors; that has already cost this project a debugging session once.

[CmdletBinding()]
param(
    # Which Work Control issue to work on. Omit to be shown what is Ready.
    [int] $Issue = 0,

    # Show the verdict and stop before any write.
    [switch] $DryRun,

    # Copy the canonical .claude/hooks set into the target folder. The only path that writes hooks.
    [switch] $Repair,

    # Skip installing the in-session root assert. The launch is then unverified from inside.
    [switch] $NoOverlay,

    # Print the verdict and exit without opening an editor.
    [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'
$ControlDir = $PSScriptRoot
$TOOLING_BRANCH = 'tooling/compy-entry'
$EXPECTED_REMOTE = 'Pootytxng/sentinel'

function Write-Head($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }
function Write-Bad($text) { Write-Host "  $text" -ForegroundColor Red }
function Write-Good($text) { Write-Host "  $text" -ForegroundColor Green }

# --- 1. The control folder asserts its own pin --------------------------------
# If this folder is not what it claims to be, nothing it says about other folders is worth anything.
function Assert-ControlPin {
    if (-not (Test-Path (Join-Path $ControlDir 'tools/entry/cli.mjs'))) {
        throw "This does not look like the control folder: $ControlDir"
    }

    $branch = (git -C $ControlDir rev-parse --abbrev-ref HEAD).Trim()
    $remote = (git -C $ControlDir remote get-url origin).Trim()
    $common = (git -C $ControlDir rev-parse --git-common-dir).Trim()

    if ($branch -ne $TOOLING_BRANCH) {
        throw "The control folder is on '$branch', not '$TOOLING_BRANCH'. It is pinned for a reason: the launcher must not route itself away from the code that does the routing."
    }
    if ($remote -notlike "*$EXPECTED_REMOTE*") {
        throw "The control folder's origin is '$remote', not $EXPECTED_REMOTE."
    }
    # A separate clone resolves its common dir inside itself. A linked worktree would resolve it to
    # code\sentinel\.git, which is exactly the coupling that disqualified sentinel as the entrypoint.
    $resolved = (Resolve-Path (Join-Path $ControlDir $common) -ErrorAction SilentlyContinue)
    if ($null -eq $resolved -or -not $resolved.Path.StartsWith($ControlDir, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The control folder is not a standalone clone (common dir: $common). It must keep working while code\sentinel\.git is mid-surgery."
    }
}

try {
    Assert-ControlPin
}
catch {
    Write-Bad "compy-entry cannot vouch for itself:"
    Write-Bad "  $($_.Exception.Message)"
    exit 3
}

# --- 2. Optional repair, before the verdict, and only when asked --------------
if ($Repair) {
    if ($Issue -le 0) { Write-Bad 'Use -Repair together with -Issue <n> so there is a folder to repair.'; exit 2 }
    Write-Head "Repairing the hook set for #$Issue"
    node (Join-Path $ControlDir 'tools/entry/repair.mjs') --issue $Issue --control $ControlDir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# --- 3. The verdict -----------------------------------------------------------
Write-Head 'Preflight'
# NOT $args -- that is an automatic variable in PowerShell and assigning to it is a trap.
$cliArgs = @('preflight')
if ($Issue -gt 0) { $cliArgs += @('--issue', "$Issue") }
node (Join-Path $ControlDir 'tools/entry/cli.mjs') @cliArgs
$verdictCode = $LASTEXITCODE

if ($verdictCode -eq 2) { exit 2 }   # nothing to do, or a choice is needed -- cli.mjs already said so
if ($verdictCode -ne 0) {
    Write-Bad 'Refused. Nothing was written.'
    Write-Host '  Fix what is listed above, or pick a different task.' -ForegroundColor DarkGray
    exit 1
}

if ($DryRun) {
    Write-Good 'Dry run: the preflight passes. Stopping before any write.'
    exit 0
}

# --- 4. Launch ----------------------------------------------------------------
Write-Head 'Launching'
$launchArgs = @('--control', $ControlDir)
if ($Issue -gt 0) { $launchArgs += @('--issue', "$Issue") }
if ($NoOverlay) { $launchArgs += '--no-overlay' }

$json = node (Join-Path $ControlDir 'tools/entry/launch.mjs') @launchArgs
if ($LASTEXITCODE -ne 0) {
    Write-Bad 'The launch sequence refused. See above; the claim was not posted.'
    exit 1
}

$result = $json | ConvertFrom-Json
$folder = $result.folder

if ($NoLaunch) {
    Write-Good "Ready: #$($result.issue) in $folder on $($result.branch)."
    Write-Host "  Open it with: code -n `"$folder`"" -ForegroundColor DarkGray
    exit 0
}

# The folder must become the WORKSPACE folder, not merely the shell's directory. Claude's project
# root follows the workspace folder; cd-ing would leave settings, hooks and the context window
# resolving from wherever the window was already rooted. That is guard 8.
code -n $folder

Write-Host ''
Write-Good "#$($result.issue) is ready in $folder"
Write-Host "  branch $($result.branch) - context window $($result.window)" -ForegroundColor DarkGray
Write-Host '  The new window is rooted in that folder. Open Claude there and start.' -ForegroundColor DarkGray
Write-Host '  When you stop, release the claim so the next session can see the handoff.' -ForegroundColor DarkGray
Write-Host ''
