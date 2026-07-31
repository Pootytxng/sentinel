#!/usr/bin/env pwsh
# The one thing Kuya runs. Everything else is an implementation detail.
#
# It resolves the control folder from its own location, never from the current directory, asserts
# its own pin, asks which task, prepares the folder, opens the editor on it, asks that window for a
# Claude session, and then PROVES the session took the launch up before it says the word "started".
#
# The journey, end to end:
#
#   choose -> launch.mjs (verdict, worktree, tier, claim, brief, token, overlay)
#          -> code <folder>        the workspace root Claude will resolve everything from
#          -> cli.mjs bridge       wait for a LIVE extension window on that exact folder
#          -> vscode://...  /open  ask that window for a Claude session
#          -> cli.mjs handoff      wait for that session to claim THIS launch token
#          -> one line, then exit
#
# What Kuya does: double-click, and answer one question when there is a real question to answer.
# No prompt to paste, no folder to pick, no branch to remember, no terminal left behind.
#
# On a refusal it prints the consequence and the one next action, writes nothing, and holds the
# window open. The full preflight table is always in the log; -Details also puts it on screen.
#
# pwsh (PowerShell 7) only. PowerShell 5.1 mis-decodes this repo's UTF-8-without-BOM scripts into
# parse errors; that has already cost this project a debugging session once.

[CmdletBinding()]
param(
    # Which Work Control issue to work on. Omit to be asked.
    [int] $Issue = 0,

    # Show the verdict and stop before any write.
    [switch] $DryRun,

    # Copy the canonical .claude/hooks set into the target folder. The only path that writes the
    # whole set; ordinary launches repair only the files that are missing, and say so.
    [switch] $Repair,

    # Skip installing the in-session root assert. The launch is then unverified from inside.
    [switch] $NoOverlay,

    # Prepare everything and stop before opening the editor.
    [switch] $NoLaunch,

    # Put the whole account on screen as it happens, including the full preflight table.
    [switch] $Details
)

$ErrorActionPreference = 'Stop'

# Native exit codes are DATA here, not exceptions. Every one of them is a verdict this script has to
# branch on -- 0 launch, 1 refusal, 2 nothing-to-do. PowerShell 7.4+ turns a non-zero native exit
# into a terminating error when ErrorActionPreference is Stop, which would blow up the refusal path
# with a stack trace instead of running the sentence written for it. (Measured: pwsh 7.6.4 here.)
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ControlDir = $PSScriptRoot
$CONTROL_BRANCH = 'main'
$EXPECTED_REMOTE = 'Pootytxng/sentinel'

# Verified against the installed extension (anthropic.claude-code 2.1.220): its URI handler routes
# /open to claude-vscode.primaryEditor.open. Nothing here simulates a keystroke or a click.
$OPEN_URI = 'vscode://anthropic.claude-code/open'

$LogFile = Join-Path $env:LOCALAPPDATA ('CompyEntry\logs\launch-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Cli = Join-Path $ControlDir 'tools/entry/cli.mjs'

function Note($t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Bad($t) { Write-Host "  $t" -ForegroundColor Red }
function Good($t) { Write-Host "  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }

# Only trouble holds the window. A launch that worked has nothing left to say, and a window Kuya has
# to close is a chore this entrypoint exists to delete.
function Hold-Window {
    if (-not [Environment]::UserInteractive) { return }
    Write-Host ''
    try { Read-Host '  press Enter to close' | Out-Null } catch { }
}

# --- 1. The control folder asserts its own pin --------------------------------
# If this folder is not what it claims to be, nothing it says about other folders is worth anything.
function Assert-ControlPin {
    if (-not (Test-Path (Join-Path $ControlDir 'tools/entry/cli.mjs'))) {
        throw "This does not look like the control folder: $ControlDir"
    }

    $branch = (git -C $ControlDir rev-parse --abbrev-ref HEAD).Trim()
    $remote = (git -C $ControlDir remote get-url origin).Trim()
    $common = (git -C $ControlDir rev-parse --git-common-dir).Trim()

    if ($branch -ne $CONTROL_BRANCH) {
        throw "The control folder is on '$branch', not '$CONTROL_BRANCH'. It is pinned for a reason: the launcher must not route itself away from the code that does the routing."
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
    Bad 'compy-entry cannot vouch for itself:'
    Bad "  $($_.Exception.Message)"
    Hold-Window
    exit 3
}

# --- 1b. ...and then catches itself up, once -----------------------------------
# Guard 11, which was live on this machine: the control folder ran a launcher two merges behind the
# one every test in the repo had verified. Merging to main does not reach the folder the shortcut
# executes, so the folder fetches its own pinned branch and fast-forwards -- never a merge, a rebase
# or a reset, never over a dirty clone, never onto another branch. control-update.mjs holds those
# rules and the guards that hold IT.
#
# A refusal here refuses the UPDATE, not the launch: being a commit behind is worth one line, not a
# dead shortcut. Then it re-executes ITSELF, because the script already parsed is the old one -- the
# env var makes that exactly once, so a machine that cannot fast-forward can never loop.
if (-not $env:COMPY_ENTRY_RESTARTED) {
    $updateJson = node (Join-Path $ControlDir 'tools/entry/control-update.mjs') --dir $ControlDir --branch $CONTROL_BRANCH
    $updateCode = $LASTEXITCODE
    $update = if ($updateJson) { $updateJson | ConvertFrom-Json } else { $null }

    if ($updateCode -eq 10) {
        Note "launcher updated: $($update.reason). restarting into it."
        $env:COMPY_ENTRY_RESTARTED = '1'
        & $PSCommandPath @PSBoundParameters
        exit $LASTEXITCODE
    }
    if ($updateCode -ne 0 -and $update -and $update.reason) {
        # Disclosure, not a chore: it says what it is running and why it stayed there.
        Note "running launcher $($update.short) -- not updated: $($update.reason)"
    }
}

# --- 2. Optional full repair, before the verdict, and only when asked ---------
if ($Repair) {
    if ($Issue -le 0) { Bad 'Use -Repair together with -Issue <n> so there is a folder to repair.'; Hold-Window; exit 2 }
    Head "Repairing the hook set for #$Issue"
    node (Join-Path $ControlDir 'tools/entry/repair.mjs') --issue $Issue --control $ControlDir
    if ($LASTEXITCODE -ne 0) { Hold-Window; exit $LASTEXITCODE }
}

# --- 3. With no issue given, ASK. Never pick ---------------------------------
# The defect this closes (owner addendum on #18): with #18 Active under our own claim and one
# unrelated #13 Ready, the no-argument shortcut selected #13 by itself, refused on that worktree,
# and exited -- so "18", typed a second later, went nowhere. Now the choice is made here, while the
# window is still open, and it accepts either the menu position or the issue number. One task that
# is already ours and still claimed is resumed without a question, because there is not one to ask.
if ($Issue -le 0) {
    $chosenJson = node $Cli choose
    if ($LASTEXITCODE -ne 0) { Hold-Window; exit 2 }   # cancelled, unreachable, or nothing on offer -- already said
    $Issue = [int] ($chosenJson | ConvertFrom-Json).issue
}

# --- 4. Prepare. One run of the launch sequence, not two ---------------------
# The old script ran preflight for a verdict and then ran the launch sequence, which read the same
# facts a second time -- and a second read is a second chance to disagree with itself. The sequence
# below is the only thing that measures anything, and everything printed after it is its answer.
$launchArgs = @('--control', $ControlDir, '--log', $LogFile, '--issue', "$Issue")
if ($DryRun) { $launchArgs += '--dry-run' }
if ($NoOverlay) { $launchArgs += '--no-overlay' }
if (-not $Details) { $launchArgs += '--quiet' }

if ($Details) { Head "Preparing #$Issue" }
$json = node (Join-Path $ControlDir 'tools/entry/launch.mjs') @launchArgs
$launchCode = $LASTEXITCODE
$result = if ($json) { $json | ConvertFrom-Json } else { $null }

if ($launchCode -ne 0) {
    Write-Host ''
    Bad "#$Issue was not started, and nothing was written."
    if ($result -and $result.reason) { Note $result.reason }
    $next = if ($result -and $result.remediation) { @($result.remediation)[0] } else { $null }
    if ($next) { Write-Host ''; Write-Host "  Do this: $next" }
    Write-Host ''
    Note "the full check table is in $LogFile"
    if (-not $Details) { Note 'or re-run with -Details to watch it happen on screen' }
    Hold-Window
    exit 1
}

if ($DryRun) {
    Good "Dry run: #$($result.issue) passes preflight. Nothing was written."
    Note "it would run in $($result.folder) on $($result.branch), context $($result.contextLabel)"
    Hold-Window
    exit 0
}

$folder = $result.folder

if ($NoLaunch) {
    Good "#$($result.issue) is prepared in $folder on $($result.branch)."
    Note "open it with: code `"$folder`""
    Hold-Window
    exit 0
}

# --- 5. Open the editor ON that folder ---------------------------------------
# The folder must become the WORKSPACE folder, not merely the shell's directory. Claude's project
# root follows the workspace folder; cd-ing would leave settings, hooks and the context window
# resolving from wherever the window was already rooted, which the in-session assert then hard-stops.
if (-not (Get-Command code -ErrorAction SilentlyContinue)) {
    Warn "VS Code's 'code' command is not on this PATH, so this script cannot open the workspace."
    Note "#$($result.issue) is fully prepared: open $folder in VS Code and Claude will pick up the brief."
    Hold-Window
    exit 4
}

Note 'opening the editor on that folder...'
code $folder

# Wait for a window that is actually LIVE on that folder. Not "we ran the command" -- three of the
# four lock files on this machine name windows that were closed weeks ago, and firing the open-URI
# at one of those would report a launch that never happened.
node $Cli bridge --folder $folder
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Warn "#$($result.issue) is prepared, but no editor window came up on $folder."
    Note 'Open that folder in VS Code and Claude will pick up the brief from there.'
    Hold-Window
    exit 4
}

# --- 6. Ask that window for a Claude session ---------------------------------
# No prompt rides on the URI: prompt= only PRE-FILLS the box, and a prefilled box is still something
# Kuya has to press Enter on. The instructions arrive the other way, from the SessionStart hook, which
# is why the brief was written to disk before the token that admits a session.
Start-Process $OPEN_URI

# --- 7. Give the panel a bounded turn ----------------------------------------
# The URI is the nicer path and it is also the only step here that cannot be AIMED: the extension
# registers its handler at activation, so the open lands in whichever window activated it. Opening
# the workspace first makes the right window likely, not certain. It therefore gets a turn, not the
# whole budget -- and the nonce decides, so a URI that went to the wrong window cannot pass for this.
node $Cli handoff --folder $folder --timeout 45000
$handoff = $LASTEXITCODE

# --- 7b. ...then start the session in the folder itself ----------------------
# No window to guess at: the working directory IS the project root, so Claude resolves its settings,
# its hooks and the brief from exactly the folder that was prepared. Nothing is typed for Kuya -- the
# brief arrives from the SessionStart hook, the same carrier the panel path uses.
if ($handoff -ne 0) {
    $startJson = node (Join-Path $ControlDir 'tools/entry/claude-start.mjs') --folder $folder
    $startPlan = if ($startJson) { $startJson | ConvertFrom-Json } else { $null }

    if ($startPlan -and $startPlan.ok) {
        Note $startPlan.reason
        # -ArgumentList rejects an empty array, and "no arguments" is a real plan here (no bridge).
        $spawn = @{ FilePath = $startPlan.exe; WorkingDirectory = $startPlan.cwd }
        if ($startPlan.args -and @($startPlan.args).Count -gt 0) { $spawn.ArgumentList = @($startPlan.args) }
        Start-Process @spawn
        node $Cli handoff --folder $folder --timeout 90000
        $handoff = $LASTEXITCODE
    }
    elseif ($startPlan -and $startPlan.reason) {
        Note $startPlan.reason
    }
}

# --- 8. Prove it, then get out of the way ------------------------------------
Write-Host ''
if ($handoff -eq 0) {
    Good "$($result.action) #$($result.issue) - $($result.title)"
    Note "$folder  |  $($result.contextLabel)  |  Claude started there with the launch brief"
    Write-Host ''
    exit 0
}

Warn "#$($result.issue) is prepared and the editor is open, but no session took the launch up."
Note 'Do this: press Ctrl+Esc in that window. The brief is on disk and the session will pick it up.'
Note "account of this run: $LogFile"
Hold-Window
exit 5
