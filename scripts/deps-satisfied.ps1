# deps-satisfied.ps1 - does a directory's node_modules actually satisfy its manifest?
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# WHY THIS EXISTS. bug->guard, 2026-08-11. scripts/verify-local.ps1 bootstraps dependencies so that a
# git worktree does not run its guards against the MAIN checkout's node_modules -- that is the whole
# reason the bootstrap was added on 2026-08-10, after canvas-a11y-guard reported that
# @react-three/fiber's declaration file had "moved" when it had never moved.
#
# The bootstrap then failed at the same thing, one step later. It asked `Test-Path node_modules`, and
# a directory existing is not the same fact as dependencies being installed. In worktree
# .claude/worktrees/admiring-lumiere-648403 on 2026-08-11 node_modules existed and @react-three/fiber
# was absent from it -- a later `npm install` added 489 packages -- so `npm ci` was skipped and
# canvas-a11y-guard invented THE SAME FAILURE, naming the same package and blocking a push whose diff
# had nothing to do with r3f. A gate that invents failures is a gate people learn to pass with
# --no-verify, which is worse than no gate.
#
# So the question this answers is "does the tree satisfy the manifest", not "is there a directory".
# Three probes, cheapest first, and each catches something the others cannot:
#
#   1. node_modules absent                  nothing to interrogate; install.
#   2. .package-lock.json absent or STALE    npm writes that hidden lockfile as its last act, so a
#                                            tree without one was never finished by an install, and a
#                                            tree whose copy predates package-lock.json was installed
#                                            from a different lock than the one checked out now.
#   3. `npm ls --depth=0` exits non-zero     the authoritative answer, because it is npm's own. This
#                                            is the probe that catches the case above: a tree that
#                                            looks finished and is missing a declared package. It
#                                            also cannot drift from npm's rules about which optional
#                                            and platform-specific packages are allowed to be absent,
#                                            which a hand-rolled walk of package-lock.json would --
#                                            every @rollup/rollup-linux-* entry is in that lock and
#                                            correctly not installed on Windows.
#
# Probe 3 costs ~3.5s on this repo's tree. It runs twice per gate invocation (root + site-app) on a
# gate that takes minutes, and only when the two free probes already passed.
#
# Both directions of a wrong answer are survivable, but they are not equally bad, so the bias is
# deliberate: a false "needs install" costs one npm ci, while a false "satisfied" is the 2026-08-10
# and 2026-08-11 incidents again -- a red gate naming a file that was never touched.
#
# Dot-source this file to define Test-DependenciesSatisfied; run it with -Path to get the same answer
# as an exit code (0 satisfied, 1 needs install). scripts/deps-bootstrap-guard.test.mjs drives the
# -Path form against fixtures, which is what keeps this honest.
param(
  # Supplied: run standalone against this directory and exit with the verdict.
  # Omitted: dot-sourced, and this file only defines the function below.
  [string]$Path
)

function Test-DependenciesSatisfied {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    # Pass the caller's already-resolved npm so the gate and this agree on which npm answered.
    [string]$NpmPath
  )

  $verdict = { param($ok, $why) return [pscustomobject]@{ Satisfied = $ok; Reason = $why } }

  if (-not (Test-Path (Join-Path $Directory "package.json"))) {
    return & $verdict $true "no package.json here, so there is nothing to install"
  }

  $nodeModules = Join-Path $Directory "node_modules"
  if (-not (Test-Path $nodeModules)) {
    return & $verdict $false "node_modules is absent"
  }

  $declaredLock = Join-Path $Directory "package-lock.json"
  $installedLock = Join-Path $nodeModules ".package-lock.json"
  if (Test-Path $declaredLock) {
    if (-not (Test-Path $installedLock)) {
      return & $verdict $false "node_modules has no .package-lock.json, so no install ever finished here"
    }
    $declaredAt = (Get-Item -LiteralPath $declaredLock -Force).LastWriteTimeUtc
    $installedAt = (Get-Item -LiteralPath $installedLock -Force).LastWriteTimeUtc
    if ($declaredAt -gt $installedAt) {
      return & $verdict $false "package-lock.json is newer than the installed tree"
    }
  }

  if (-not $NpmPath) {
    $npmCommand = Get-Command "npm" -ErrorAction SilentlyContinue
    if ($null -eq $npmCommand) {
      return & $verdict $false "npm was not found on PATH, so the tree cannot be verified"
    }
    $NpmPath = $npmCommand.Source
  }

  # A native command's stderr must not become a terminating error here: the caller runs with
  # $ErrorActionPreference = "Stop", and npm ls writes its complaints to stderr precisely when it is
  # telling us the thing we asked about. Only the exit code is the answer.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $NpmPath "ls" "--prefix" $Directory "--depth=0" 2>$null | Out-Null
    $listExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($listExitCode -ne 0) {
    return & $verdict $false "npm ls reports the tree does not satisfy package.json"
  }

  return & $verdict $true "node_modules satisfies package.json"
}

if ($PSBoundParameters.ContainsKey("Path")) {
  $state = Test-DependenciesSatisfied -Directory $Path
  Write-Host $state.Reason
  if ($state.Satisfied) { exit 0 } else { exit 1 }
}
