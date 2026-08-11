# setup-local-ci.ps1 - enable the repository-local pre-push verification hook.
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# One-time wiring. `core.hooksPath` lives in .git/config, which every worktree SHARES, so running
# this once arms the gate for the main checkout and every worktree at the same time.
#
# It then proves the wiring rather than announcing it. An unreachable hook is not an error to git --
# it simply runs nothing and lets the push through, which is indistinguishable from a passing gate.
# That is the failure this repository has already been bitten by twice at a larger scale (hosted CI
# rejected before a runner was assigned, twice reported as "red X's" that no test produced), so a
# setup script that prints "enabled" without checking has no business existing here.
param()

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$git = Get-Command git -ErrorAction Stop

& $git.Source -c "safe.directory=$repo" -C $repo config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
  throw "Could not configure Git's local hooks path."
}

# Ask git where it will ACTUALLY look, rather than assuming the relative path resolves here. A
# relative core.hooksPath resolves against the MAIN worktree's root, not the worktree you are
# standing in -- so from .claude/worktrees/<name>/ this returns the main checkout's .githooks.
$hooksDir = (& $git.Source -c "safe.directory=$repo" -C $repo rev-parse --git-path hooks).Trim()
$prePush = Join-Path $hooksDir "pre-push"

Write-Host "core.hooksPath  -> .githooks"
Write-Host "git resolves to -> $hooksDir"

if (-not (Test-Path $prePush)) {
  Write-Warning "NOT ARMED: no pre-push hook at $prePush"
  Write-Warning "Git will run nothing and every push will succeed unverified."
  Write-Warning "This is expected until the branch carrying .githooks/ is checked out in the MAIN"
  Write-Warning "worktree ($((Split-Path $hooksDir -Parent))). Re-run this script after it merges."
  exit 1
}

Write-Host ""
Write-Host "ARMED. Every push now runs: npm run verify:local"
Write-Host "The hook FILE is shared by all worktrees; the verify-local.ps1 it runs is the one in the"
Write-Host "worktree being pushed, so the gate still travels with the branch."
Write-Host "To disable it later: git config --local --unset core.hooksPath"
