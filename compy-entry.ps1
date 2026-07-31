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
#          -> cli.mjs handoff      a window restoring its own panel needs nothing else
#          -> vscode://...  /open  and only if it had no panel to restore, ask for one
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

# Everything Kuya reads on success comes back through node's stdout, and PowerShell decodes a native
# command's output with whatever [Console]::OutputEncoding says -- which on this machine is the OEM
# code page. The first log that carried the success line proved it: "150k ΓÇö standard", the em dash
# of an ASCII-safe label arriving as three characters of noise. The corruption is in the STRING, not
# the file, so it reaches the console too, and it would reach a task name in the picker or a sentence
# in a refusal the same way. Process-local, set before the first node call.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ControlDir = $PSScriptRoot
$CONTROL_BRANCH = 'main'
$EXPECTED_REMOTE = 'Pootytxng/sentinel'

# Verified against the installed extension (anthropic.claude-code 2.1.220): its URI handler routes
# /open to claude-vscode.primaryEditor.open. Nothing here simulates a keystroke or a click.
$OPEN_URI = 'vscode://anthropic.claude-code/open'

$LogFile = Join-Path $env:LOCALAPPDATA ('CompyEntry\logs\launch-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Cli = Join-Path $ControlDir 'tools/entry/cli.mjs'

# The account of a run has to include the part where it went wrong. launch.mjs writes the check table
# into $LogFile and stops there, so everything after it -- the editor, the two waits, the fallback,
# the verdict -- was console-only, and a successful launch closes its window (guard 13). Scoring
# journey 5 of the acceptance run proved the cost: the log ended at "launch token written" while the
# journey ran on for another 18s. §8's refusal cites this file as "the account of this run"; it must
# not stop before the failure it is cited for.
#
# Buffered until the file exists, which is launch.mjs's doing: a run that ends at the picker still
# writes nothing at all, and that is a property, not an accident.
$script:Journey = [System.Collections.Generic.List[string]]::new()
function Write-Journey($t) {
    $script:Journey.Add(('{0}   {1}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $t))
    if (-not (Test-Path -LiteralPath $LogFile)) { return }
    # Losing the account is a bad day; failing the launch over it is a worse one.
    try {
        Add-Content -LiteralPath $LogFile -Value $script:Journey.ToArray() -Encoding utf8
        $script:Journey.Clear()
    }
    catch { }
}

function Note($t) { Write-Host "  $t" -ForegroundColor DarkGray; Write-Journey $t }
function Bad($t) { Write-Host "  $t" -ForegroundColor Red; Write-Journey $t }
function Good($t) { Write-Host "  $t" -ForegroundColor Green; Write-Journey $t }
function Warn($t) { Write-Host "  $t" -ForegroundColor Yellow; Write-Journey $t }
function Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Journey $t }

# Only trouble holds the window. A launch that worked has nothing left to say, and a window Kuya has
# to close is a chore this entrypoint exists to delete.
function Hold-Window {
    if (-not [Environment]::UserInteractive) { return }
    Write-Host ''
    try { Read-Host '  press Enter to close' | Out-Null } catch { }
}

# Whole-path repository identity, across the spellings git actually produces. Mirrors `sameRepo` in
# tools/entry/control-update.mjs, which carries the guards for it. `-notlike "*Pootytxng/sentinel*"`
# accepted https://github.com/attacker/Pootytxng-sentinel-fork -- a spelling test, not a pin.
function ConvertTo-RepoPath([string]$Url) {
    $x = "$Url".Trim()
    $x = $x -replace '\.git$', ''
    $x = $x -replace '/+$', ''
    $x = $x -replace '^git@([^:]+):', 'https://$1/'
    $x = $x -replace '^ssh://git@', 'https://'
    $x = $x.ToLowerInvariant()
    if ($x -match '^https?://[^/]+/(.+)$') { return $Matches[1] }
    return $x
}

function Test-SameRepo([string]$Url, [string]$Expected) {
    $a = ConvertTo-RepoPath $Url
    $b = ConvertTo-RepoPath $Expected
    return ($a -ne '') -and ($a -eq $b)
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
    $head   = (git -C $ControlDir rev-parse HEAD).Trim()
    $status = (git -C $ControlDir status --porcelain) -join "`n"

    if ($branch -ne $CONTROL_BRANCH) {
        throw "The control folder is on '$branch', not '$CONTROL_BRANCH'. It is pinned for a reason: the launcher must not route itself away from the code that does the routing."
    }
    # Identity is <owner>/<repo>, matched whole. `-notlike "*Pootytxng/sentinel*"` accepted
    # https://github.com/attacker/Pootytxng-sentinel-fork, which is not a pin, it is a spelling test.
    if (-not (Test-SameRepo $remote $EXPECTED_REMOTE)) {
        throw "The control folder's origin is '$remote', not $EXPECTED_REMOTE."
    }
    # A pin that does not look at the working copy pins a commit id, not the code about to run. The
    # launcher is seconds away from routing work and copying hooks out of this folder; "clean" is the
    # only thing that makes the commit id describe the bytes that will execute.
    if ($status) {
        throw "The control folder has uncommitted changes, so the launcher about to run is not the launcher $($head.Substring(0,7)) describes. Commit or stash them, or run the shortcut from a clean control folder."
    }
    if ($head -notmatch '^[0-9a-f]{40}$') {
        throw "The control folder's HEAD is not a commit id ('$head'), so there is nothing to pin to."
    }
    $script:ControlSha = $head
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
    $updateJson = node (Join-Path $ControlDir 'tools/entry/control-update.mjs') --dir $ControlDir --branch $CONTROL_BRANCH --remote $EXPECTED_REMOTE
    $updateCode = $LASTEXITCODE
    $update = if ($updateJson) { $updateJson | ConvertFrom-Json } else { $null }

    if ($updateCode -eq 10) {
        Note "launcher updated: $($update.reason). restarting into it."
        $env:COMPY_ENTRY_RESTARTED = '1'
        & $PSCommandPath @PSBoundParameters
        exit $LASTEXITCODE
    }
    # Exit 2 is control-update saying the folder cannot vouch for itself: wrong branch, dirty tree,
    # divergence, a foreign origin, an unreadable folder, or a fast-forward that did not land. The
    # old code printed a note and launched anyway -- "refuse the update, run the stale launcher"
    # defeats the entire pin, and spec section 8 says refuse rather than guess. It is one line and a
    # stop, not a chore: the remedy is named and the shortcut does nothing behind the owner's back.
    if ($updateCode -eq 2) {
        Bad 'compy-entry cannot vouch for the launcher it would run:'
        Bad "  $($update.reason)"
        Hold-Window
        exit 3
    }
    # A launcher that could not even be parsed leaves $update null. Silence there was the worst case
    # of all: a total update failure that launched without saying one word.
    if ($updateCode -ne 0 -and -not $update) {
        Bad 'compy-entry could not read the launcher update result, so it will not launch on an unproven folder.'
        Hold-Window
        exit 3
    }
    if ($updateCode -ne 0 -and $update -and $update.reason) {
        # Disclosure, not a chore: it says what it is running and why it stayed there.
        Note "running launcher $($update.short) -- not updated: $($update.reason)"
    }
}

# --- 1c. ...and looks at the thing Kuya actually double-clicks -----------------
# The shortcut is the only component of this journey that is not a tracked file, so for the whole of
# this program nothing had an opinion about it -- and it shipped with -NoExit (a window to close after
# every success, the exact chore this entrypoint deletes) and a target inside a VERSIONED PowerShell
# package folder, which the next Store update would have removed. That second one does not fail now;
# it fails weeks later, silently, at the moment the entrypoint is reached for.
#
# REPORT, never repair. Rewriting the owner's Desktop from inside a launch is a surprise, not a
# preparation, and a shortcut broken badly enough to matter is one this script never runs from.
try {
    $lnkJson = node (Join-Path $ControlDir 'tools/entry/shortcut.mjs') --control $ControlDir 2>$null
    if ($LASTEXITCODE -eq 1 -and $lnkJson) {
        $lnk = $lnkJson | ConvertFrom-Json
        Warn "your Desktop shortcut still works, but it will not keep working:"
        foreach ($d in $lnk.defects) { Warn "  $($d.reason) -- $($d.remediation)" }
    }
}
catch { }

# --- 2. Optional full repair, before the verdict, and only when asked ---------
if ($Repair) {
    if ($Issue -le 0) { Bad 'Use -Repair together with -Issue <n> so there is a folder to repair.'; Hold-Window; exit 2 }
    Head "Repairing the hook set for #$Issue"
    node (Join-Path $ControlDir 'tools/entry/repair.mjs') --issue $Issue --control $ControlDir
    if ($LASTEXITCODE -ne 0) { Hold-Window; exit $LASTEXITCODE }
}

# --- 2b. One launcher at a time ------------------------------------------------
# Double-clicking twice is a normal thing to do when the first click looks like it did nothing, and
# nothing stopped it: both runs passed preflight, both posted or renewed the same claim, and both
# wrote the SINGLETON %LOCALAPPDATA%\CompyEntry\launch.json -- the second overwriting the first's
# nonce. Then both handoff waiters read whichever token was current, so one session could take up the
# other's launch while the other waited out its budget for a record that had been replaced.
#
# The lock is held from here through handoff, which is the whole span in which that singleton is
# live. A second run writes nothing and says one calm sentence, then exits 0: Kuya clicking twice is
# not an error, and telling him it is teaches him to ignore the launcher.
$LockScript = Join-Path $ControlDir 'tools/entry/single-flight.mjs'
$lockJson = node $LockScript acquire --pid $PID --issue $Issue
$lockCode = $LASTEXITCODE
$lock = if ($lockJson) { $lockJson | ConvertFrom-Json } else { $null }

if ($lockCode -ne 0) {
    Write-Host ''
    Note $(if ($lock -and $lock.reason) { $lock.reason } else { 'Compy is already starting.' })
    Note 'Nothing was written by this second run.'
    Hold-Window
    exit 0
}
if ($lock -and $lock.stole -and $lock.reason) { Note "took over a stale launcher lock -- $($lock.reason)" }

# Give it back on the way out, however this run ends. Staleness covers the case where the process
# dies without getting here at all; this covers every ordinary exit, including the refusals.
$null = Register-EngineEvent PowerShell.Exiting -Action {
    try { node (Join-Path $ControlDir 'tools/entry/single-flight.mjs') release --pid $PID | Out-Null } catch { }
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
    # "nothing was written" is a claim about the machine, and it used to be printed for EVERY nonzero
    # exit -- true only of a refusal before the first write. launch.mjs is a legal-prefix sequence: it
    # can create a worktree, establish a tier, post a claim and write a token, brief and overlay, and
    # then refuse. Telling Kuya nothing happened while a claim sits on the board under his name is the
    # launcher lying about the one thing he would have to clean up. So it reports what the run
    # actually did, and reserves the old sentence for the case the payload proves.
    $effects = if ($result -and $result.effects) { @($result.effects) } else { @() }
    if ($effects.Count -gt 0) {
        Bad "#$Issue was not started, but this run had already done the following:"
        foreach ($e in $effects) {
            if ($e.detail) { Write-Host "    - $($e.what) -- $($e.detail)" }
            else { Write-Host "    - $($e.what)" }
        }
        Write-Host ''
    }
    else {
        Bad "#$Issue was not started, and nothing was written."
    }
    if ($result -and $result.reason) { Note $result.reason }
    $next = if ($result -and $result.remediation) { @($result.remediation)[0] } else { $null }
    if ($next) { Write-Host ''; Write-Host "  Do this: $next" }
    Write-Host ''
    # And the log is only promised when it exists. On the quiet path the terminal copy is suppressed,
    # so pointing at a file that was never written would leave a refusal with no account of itself at
    # all -- while claiming the opposite.
    if ($result -and $result.logDurable) {
        Note "the full check table is in $LogFile"
        if (-not $Details) { Note 'or re-run with -Details to watch it happen on screen' }
    }
    else {
        Note 'the detailed check table could not be written to disk -- re-run with -Details to watch it on screen'
    }
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

# --- 6. Let a window that restores its own panel finish on its own -----------
# Opening the workspace is often the whole handoff: VS Code restores the Claude panel that folder had
# open, the panel starts a session, and the SessionStart hook takes the launch up unasked. Measured
# here on 2026-07-31: `code <folder>` alone, no URI, claimed a freshly minted token in 10s.
#
# Asking that window for a session anyway opens a SECOND panel on the same claim -- two agents in one
# worktree, which is the one thing the claim protocol exists to prevent. It happened: journey 4 of
# the acceptance run started two sessions 0.8s apart on one launch. So the panel already coming up
# gets the first turn, and only the silence after it justifies the URI.
node $Cli handoff --folder $folder --timeout 15000
$handoff = $LASTEXITCODE
# Silent on the console -- node already said it there. The log is the half that outlives the window.
Write-Journey ('restored panel: {0}' -f $(if ($handoff -eq 0) { 'took the launch up' } else { 'nothing in 15s' }))

# --- 7. Ask only the window that had nothing to restore ----------------------
# No prompt rides on the URI: prompt= only PRE-FILLS the box, and a prefilled box is still something
# Kuya has to press Enter on. The instructions arrive the other way, from the SessionStart hook, which
# is why the brief was written to disk before the token that admits a session.
#
# This is also the only step here that cannot be AIMED: the extension registers its handler at
# activation, so the open lands in whichever window activated it. Opening the workspace first makes
# the right window likely, not certain. It therefore gets a turn, not the whole budget -- and the
# nonce decides, so a URI that went to the wrong window cannot pass for this.
if ($handoff -ne 0) {
    Start-Process $OPEN_URI
    node $Cli handoff --folder $folder --timeout 45000
    $handoff = $LASTEXITCODE
    Write-Journey ('open-URI: {0}' -f $(if ($handoff -eq 0) { 'a session took the launch up' } else { 'nothing in 45s' }))
}

# --- 7b. ...then start the session in the folder itself ----------------------
# No window to guess at: the working directory IS the project root, so Claude resolves its settings,
# its hooks and the brief from exactly the folder that was prepared. Nothing is typed for Kuya -- the
# brief arrives from the SessionStart hook, the same carrier the panel path uses.
if ($handoff -ne 0) {
    # Started AS the conversation the launcher named, not as whichever session happens to appear.
    $startArgs = @('--folder', $folder)
    if ($result.sessionId) { $startArgs += @('--session-id', $result.sessionId) }
    $startJson = node (Join-Path $ControlDir 'tools/entry/claude-start.mjs') @startArgs
    $startPlan = if ($startJson) { $startJson | ConvertFrom-Json } else { $null }

    if ($startPlan -and $startPlan.ok) {
        Note $startPlan.reason
        # -ArgumentList rejects an empty array, and "no arguments" is a real plan here (no bridge).
        $spawn = @{ FilePath = $startPlan.exe; WorkingDirectory = $startPlan.cwd }
        if ($startPlan.args -and @($startPlan.args).Count -gt 0) { $spawn.ArgumentList = @($startPlan.args) }
        Start-Process @spawn
        node $Cli handoff --folder $folder --timeout 90000
        $handoff = $LASTEXITCODE
        Write-Journey ('CLI in the folder: {0}' -f $(if ($handoff -eq 0) { 'a session took the launch up' } else { 'nothing in 90s' }))
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
    # The Desktop proof names the exact launcher commit it ran. "It worked" about unnamed code is not
    # evidence, and this is the line that makes a screenshot of a successful launch checkable.
    Note "launcher $($script:ControlSha.Substring(0,7))  |  $CONTROL_BRANCH  |  $EXPECTED_REMOTE"
    Write-Host ''
    exit 0
}

Warn "#$($result.issue) is prepared and the editor is open, but no session took the launch up."
Note 'Do this: press Ctrl+Esc in that window. The brief is on disk and the session will pick it up.'
Note "account of this run: $LogFile"
Hold-Window
exit 5
