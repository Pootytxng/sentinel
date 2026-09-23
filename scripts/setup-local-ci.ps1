# setup-local-ci.ps1 - enable the repository-local pre-push verification hook.
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# One-time wiring. `core.hooksPath` is written to .git/config, which every worktree SHARES -- but the
# value written is RELATIVE (".githooks"), and git resolves a relative hooks path against the
# worktree the hook RUNS in, not against the main checkout. That single shared setting therefore
# points every worktree at its OWN .githooks, which is what lets the gate travel with the branch.
#
# The corollary is the part worth knowing: a worktree whose branch does not carry .githooks/ ends up
# with no hook at all, and git reports nothing -- it runs nothing and allows the push.
# scripts/hookspath-fleet-guard.test.mjs is the thing that notices that across every checkout: it
# blocks the push from the affected checkout, warns about every other one, and blocks on all of
# them under `npm run fleet:hygiene` (#488).
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

# Ask git where it will ACTUALLY look, rather than assuming. --path-format=absolute is load-bearing:
# --git-path on its own answers RELATIVELY (".githooks"), and Test-Path below would then resolve that
# against the CALLER's current directory instead of the repository. Measured 2026-08-31: invoked with
# the shell sitting in C:\Users\Kuya, this script called a correctly armed checkout "NOT ARMED" and
# exited 1, and Split-Path -Parent of the same value printed an empty directory into the warning.
# A setup script that reports the gate's state has to answer about the repo, not about the shell.
$hooksDir = (& $git.Source -c "safe.directory=$repo" -C $repo rev-parse --path-format=absolute --git-path hooks).Trim()
$prePush = Join-Path $hooksDir "pre-push"

Write-Host "core.hooksPath  -> .githooks"
Write-Host "git resolves to -> $hooksDir"

if (-not (Test-Path $prePush)) {
  Write-Warning "NOT ARMED: no pre-push hook at $prePush"
  Write-Warning "Git will run nothing and every push will succeed unverified."
  Write-Warning "A relative core.hooksPath resolves against THIS checkout, so the repair belongs here"
  Write-Warning "and not in the main worktree: check out a branch that carries .githooks/ in"
  Write-Warning "$repo and re-run this script."
  exit 1
}

Write-Host ""
Write-Host "ARMED. Every push now runs: npm run verify:local"
Write-Host "The hook FILE and the verify-local.ps1 it runs BOTH come from the checkout being pushed,"
Write-Host "so the gate travels with the branch -- and each worktree must carry its own .githooks/."
Write-Host "To disable it later: git config --local --unset core.hooksPath"
