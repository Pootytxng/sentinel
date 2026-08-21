# verify-local.ps1 - the everyday pre-push gate. This is what replaced hosted CI.
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# WHY THIS EXISTS. GitHub's free allowance was exhausted twice: 2,195 billed minutes in July, and
# again around 06:00 UTC on 7 August 2026 -- the second time with July's per-run cost-cutting already
# in place. The cause the second time was run VOLUME, not per-run cost: 111 real CI runs in six days
# (~570/month) against a guard that projected 122/month. Several agent lanes push all day, and no
# amount of caching closes a 3.4x gap. So .github/workflows/ci.yml is manual-only now, and the
# checks it used to run happen here instead, on hardware the owner already owns, for zero minutes.
#
# This intentionally does not publish, install, or change Windows state. It is a read-only proof.
#
# The set of checks below is pinned by scripts/local-gate-guard.test.mjs against ci.yml's own steps,
# so this file cannot silently become weaker than the hosted gate it replaced.
#
# NOT a duplicate of scripts/verify-release.ps1 -- the two are a deliberate ladder, and the split is
# by COST, not by rigour:
#
#   verify-local.ps1    every push. The five checks below. Everything it needs is on this machine.
#   verify-release.ps1  every release. A strict SUPERSET: adds the encoding guard, the release
#                       PowerShell static guard, strict RELEASE_STATE citations, the doc budget, the
#                       supply-chain gate (npm + cargo audit, which needs the NETWORK and whose
#                       answer changes when an advisory is published rather than when this repo
#                       changes), and updater-signature verification (which needs BUILT artifacts).
#
# The rest of the repo's drift detectors are not missing here: encoding-guard, doc-budget,
# markdown-link-guard, verify-module-map, verify-release-state and branch-disposition-audit are all
# resident inside `npm test` (see the RESIDENCY table in scripts/gate-residency-guard.test.mjs), so
# running `npm test` below runs them too. Only the network- and artifact-dependent checks are
# release-time-only, and each is release-time-only for a stated reason.
param(
  # Skip the dependency bootstrap when you know the tree is already installed (saves ~30s).
  [switch]$NoInstall
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Node 24 on Windows can abort INSIDE process.exit() when an async handle is still closing
# (nodejs/node#56645, open upstream). The process then dies with STATUS_STACK_BUFFER_OVERRUN,
# 0xC0000409 -- 3221226505 unsigned, -1073740791 as PowerShell's Int32 -- instead of the code it
# meant to return. That number is the runtime's, never the tree's: tsc reports 2, vite and vitest
# report 1, and nothing this gate runs reports 0xC0000409 on purpose. Seen twice on 2026-08-20
# under concurrent lane load (#171); each false red cost four minutes and is exactly how a gate
# teaches people --no-verify. So a Node-hosted check that dies with precisely that code is run
# ONCE more, with a WARN that names the cause, and a real failure still fails: any other exit
# code is final, and a second abort is final. This is NOT a retry-until-green and NOT a wider
# timeout. Pinned by scripts/local-gate-guard.test.mjs.
$NodeRuntimeAbortCodes = @(-1073740791, 3221226505)

function Invoke-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    # Set only for checks whose top-level process is Node (npm scripts). cargo is never retried.
    [switch]$NodeHosted
  )

  Write-Host ""
  Write-Host "LOCAL CHECK: $Name"
  & $Command @Arguments
  if ($NodeHosted -and ($NodeRuntimeAbortCodes -contains $LASTEXITCODE)) {
    Write-Host ""
    Write-Host "LOCAL CHECK WARN: $Name died with 0xC0000409 -- a Node runtime abort at exit (nodejs/node#56645), not a verdict on this tree. Running it once more. If this repeats, it is real: see issue #171."
    Write-Host "LOCAL CHECK: $Name (re-run after Node runtime abort)"
    & $Command @Arguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE."
  }
}

function Resolve-RequiredCommand {
  param([Parameter(Mandatory = $true)][string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Required command '$Name' was not found on PATH."
  }
  return $command.Source
}

$git = Resolve-RequiredCommand "git"
$npm = Resolve-RequiredCommand "npm"
$cargo = Resolve-RequiredCommand "cargo"

# Defines Test-DependenciesSatisfied. It carries the reasoning for what "installed" means and is
# driven against fixture trees by scripts/deps-bootstrap-guard.test.mjs.
. (Join-Path $PSScriptRoot "deps-satisfied.ps1")

function Confirm-Dependencies {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string[]]$InstallArguments
  )

  $state = Test-DependenciesSatisfied -Directory $Directory -NpmPath $npm
  if ($state.Satisfied) {
    Write-Host "LOCAL CHECK: $Label dependencies are installed ($($state.Reason))."
    return
  }

  Write-Host "LOCAL CHECK: installing $Label dependencies -- $($state.Reason)."
  Invoke-Check -Name "install $Label dependencies" -Command $npm -Arguments $InstallArguments
}

# Run from the repository root no matter where this was invoked from. `npm test` resolves its config
# from the working directory, so a run started in a subdirectory would silently test something else.
Push-Location $repo
try {
  # ---------------------------------------------------------------------------------------------
  # Dependency bootstrap. Not politeness -- correctness, and the reason is specific to worktrees.
  #
  # Node resolves node_modules by walking UP the directory tree. A git worktree under
  # .claude/worktrees/<name>/ therefore finds the MAIN checkout's node_modules and runs happily
  # against it, so `npm test` appears to work with no node_modules of its own. But guards that check
  # a RELATIVE path see nothing: on 2026-08-10 canvas-a11y-guard failed here with
  # "@react-three/fiber/dist/declarations/src/web/Canvas.d.ts moved" when the file was present in the
  # main checkout all along. A gate that invents failures is a gate people learn to pass with
  # --no-verify, which is worse than no gate. So the tree gets its own dependencies.
  #
  # site-app is the same story from the other side: without it the three site guards
  # (dist-site-staleness, site-landing, site-seo) all fail with "site-app dependencies missing",
  # which is a missing setup step wearing the costume of a broken test. ci.yml installs both; so
  # does this.
  #
  # WHAT "ALREADY INSTALLED" MEANS, and why it is not `Test-Path node_modules`. That is what this
  # asked until 2026-08-11, and a directory existing is not the same fact as dependencies being
  # installed. In .claude/worktrees/admiring-lumiere-648403 node_modules existed WITHOUT
  # @react-three/fiber (a later `npm install` added 489 packages), so the bootstrap above skipped
  # itself and canvas-a11y-guard reported the very same phantom this block was written to prevent,
  # naming the same package, on a push whose diff had nothing to do with r3f. The question is
  # therefore asked of the tree -- see scripts/deps-satisfied.ps1 for the three probes and their
  # costs -- and pinned by scripts/deps-bootstrap-guard.test.mjs against real partial trees.
  # ---------------------------------------------------------------------------------------------
  if (-not $NoInstall) {
    Confirm-Dependencies -Label "root" -Directory $repo -InstallArguments @("ci")
    Confirm-Dependencies -Label "site-app" -Directory (Join-Path $repo "site-app") -InstallArguments @("ci", "--prefix", "site-app")
  }

  Invoke-Check -Name "git diff check" -Command $git -Arguments @("-c", "safe.directory=$repo", "-C", $repo, "diff", "--check")
  Invoke-Check -Name "frontend tests" -Command $npm -Arguments @("test") -NodeHosted
  Invoke-Check -Name "frontend type-check and build" -Command $npm -Arguments @("run", "build") -NodeHosted
  Invoke-Check -Name "Rust tests" -Command $cargo -Arguments @("test", "--manifest-path", "src-tauri/Cargo.toml")
  # `--all-features` is a superset of ci.yml's flags, never weaker. The crate declares no [features]
  # and no optional dependencies today, so it resolves identically -- it is here so that adding one
  # later does not quietly leave it unlinted.
  Invoke-Check -Name "Rust clippy" -Command $cargo -Arguments @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings")
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "LOCAL CHECK RESULT: PASS"
Write-Host "These checks ran on this machine and used zero GitHub Actions minutes."
