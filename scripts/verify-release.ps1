# verify-release.ps1 - the one local command that proves the whole release gate.
# ASCII only for Windows PowerShell 5.1 compatibility (see scripts/lib/native-process.ps1).
#
# Hosted CI is off by owner decision, so this run is the only run. That imposes two rules on it.
# It must cover everything, and it must never stop early: a gate that aborts on the first failure
# reports one problem per run, and a gate that skips a check because a tool is missing reports a
# pass it did not earn. So every check runs, and every check lands in exactly one of four states.
#
#   PASS     the check ran and was clean
#   FAIL     the check ran and found a problem
#   BLOCKED  the check could not run - a missing tool, an unreachable advisory database, a
#            classifier that could not produce a verdict
#   PENDING  the artifact this check proves does not exist yet, and the same pipeline creates and
#            proves it later in the run
#
# PENDING exists for exactly one case: scripts/release.ps1 runs this script before it builds and
# stages a candidate, so there is no staged signature to check at that point, and it has its own
# signature gates after staging. PENDING is printed and recorded like any other state - it is never
# a silent skip - but it does not escalate the exit code, because the absent artifact is a fact
# about when the check ran, not a capability this machine lacks. BLOCKED does escalate.
#
# Exit codes follow: 0 nothing failed and nothing is unprovable, 1 at least one FAIL, 3 nothing
# failed but something could not be proved.
# The whole result, including the dependency inventory, is written beside the staged release
# artifacts so the evidence pack carries what was actually verified rather than a claim about it.
#
# These gates are long-running and their output is the point: the owner watches vitest, tsc, cargo
# and clippy scroll past. Invoke-StreamedProcess launches the real executable with an argument array,
# relayed output, explicit exit data, and timeout-tree cleanup. Batch shims are forbidden.
param(
  [string]$EvidencePath
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\native-process.ps1")

$bundleDir = Join-Path $repo "src-tauri\target\release\bundle\nsis"
$supplyChainPath = Join-Path $bundleDir "supply-chain.json"
if (-not $EvidencePath) { $EvidencePath = Join-Path $bundleDir "verify-release-evidence.json" }

$script:GateResults = New-Object System.Collections.ArrayList

function Add-GateResult {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet("PASS", "FAIL", "BLOCKED", "PENDING")][string]$Status,
    [string]$Detail = ""
  )
  $null = $script:GateResults.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail })
  Write-Host ("  {0,-8} {1}" -f $Status, $Name)
  if ($Detail) { Write-Host ("           {0}" -f $Detail) }
}

# A tool that is absent is a BLOCKED result, never a silent skip - so resolution has to answer with
# data instead of terminating the run.
function Get-ToolPath {
  param([Parameter(Mandatory = $true)][string]$Command)
  try { return (Resolve-NativeExecutable $Command).Source } catch { return $null }
}

function Invoke-Gate {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @()
  )
  Write-Host ""
  Write-Host "VERIFY: $Name"
  try {
    Invoke-StreamedProcess $Name $Command $Arguments -WorkingDirectory $repo -TimeoutMs 3600000 | Out-Null
    Add-GateResult -Name $Name -Status "PASS"
  } catch {
    Add-GateResult -Name $Name -Status "FAIL" -Detail (Get-RedactedDiagnosticText ([string]$_.Exception.Message))
  }
}

function Invoke-ToolGate {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ToolName,
    [string]$ToolPath,
    [string[]]$Arguments = @()
  )
  if (-not $ToolPath) {
    Add-GateResult -Name $Name -Status "BLOCKED" -Detail "required executable '$ToolName' was not found on PATH, so this check did not run"
    return
  }
  Invoke-Gate -Name $Name -Command $ToolPath -Arguments $Arguments
}

$nodePath = Get-ToolPath "node"
$cargoPath = Get-ToolPath "cargo"
$gitPath = Get-ToolPath "git"
$shellPath = Get-ToolPath "powershell"

$npmInvocation = $null
$npmBlockedDetail = "the npm CLI could not be resolved, so this check did not run"
try { $npmInvocation = Get-NpmCliInvocation } catch { $npmBlockedDetail = [string]$_.Exception.Message }

function Invoke-NpmGate {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string[]]$Arguments = @()
  )
  if ($null -eq $npmInvocation) {
    Add-GateResult -Name $Name -Status "BLOCKED" -Detail $npmBlockedDetail
    return
  }
  Invoke-Gate -Name $Name -Command $npmInvocation.Command -Arguments (@($npmInvocation.ArgumentPrefix) + $Arguments)
}

Write-Host "VERIFY RELEASE: every gate runs. Nothing stops at the first failure."

# Both artifacts are read back later in this run. A leftover from a previous run would be relayed as
# this run's result - inherited counts wearing a current date - so neither may survive into the run
# that is supposed to produce it.
foreach ($stalePath in @($supplyChainPath, $EvidencePath)) {
  if (Test-Path -LiteralPath $stalePath -PathType Leaf) { Remove-Item -LiteralPath $stalePath -Force }
}

# Cheap static checks first, so a broken tree is visible before the long builds start.
Invoke-ToolGate -Name "git diff check" -ToolName "git" -ToolPath $gitPath -Arguments @("-C", $repo, "diff", "--check")
Invoke-ToolGate -Name "encoding guard" -ToolName "node" -ToolPath $nodePath -Arguments @("scripts/encoding-guard.mjs")
Invoke-ToolGate -Name "release PowerShell static guard" -ToolName "node" -ToolPath $nodePath -Arguments @("scripts/release-powershell-static-guard.mjs")
Invoke-ToolGate -Name "strict release-state citations" -ToolName "node" -ToolPath $nodePath -Arguments @("scripts/verify-release-state.mjs", "--strict")
Invoke-ToolGate -Name "documentation budget" -ToolName "powershell" -ToolPath $shellPath -Arguments @("-NoProfile", "-File", "scripts/doc-budget.ps1")

# Supply chain: both audits re-run against the CURRENT lockfiles, each finding classified by whether
# it reaches the shipped Windows build before any severity is argued, plus the dependency inventory.
# The classifier owns its own PASS/FAIL/BLOCKED verdicts; this script relays them.
Write-Host ""
Write-Host "VERIFY: supply chain (npm audit, Cargo audit, dependency inventory)"
$supplyChainChecks = @("npm audit", "Cargo audit", "dependency inventory")
if (-not $nodePath) {
  foreach ($checkName in $supplyChainChecks) {
    Add-GateResult -Name $checkName -Status "BLOCKED" -Detail "required executable 'node' was not found on PATH, so this check did not run"
  }
} else {
  $supplyChain = $null
  try {
    $supplyChainRun = Invoke-NativeProcess -Command $nodePath -ArgumentList @("scripts/supply-chain-gate.mjs", "--out", $supplyChainPath) -WorkingDirectory $repo -TimeoutMs 1800000
    if ($supplyChainRun.StdOut) { Write-Host (Get-RedactedDiagnosticText $supplyChainRun.StdOut.TrimEnd()) }
    if ($supplyChainRun.StdErr) { Write-Host (Get-RedactedDiagnosticText $supplyChainRun.StdErr.TrimEnd()) }
    if (Test-Path -LiteralPath $supplyChainPath -PathType Leaf) {
      $supplyChainText = Get-Content -LiteralPath $supplyChainPath -Raw
      $supplyChain = ConvertFrom-Json $supplyChainText
    }
  } catch {
    Write-Host (Get-RedactedDiagnosticText ([string]$_.Exception.Message))
  }
  if ($null -eq $supplyChain) {
    foreach ($checkName in $supplyChainChecks) {
      Add-GateResult -Name $checkName -Status "BLOCKED" -Detail "the supply-chain gate produced no readable result at $supplyChainPath"
    }
  } else {
    $reported = @{}
    foreach ($check in @($supplyChain.checks)) {
      $reported[[string]$check.name] = $true
      Add-GateResult -Name ([string]$check.name) -Status ([string]$check.status) -Detail ([string]$check.detail)
    }
    foreach ($checkName in $supplyChainChecks) {
      if (-not $reported.ContainsKey($checkName)) {
        Add-GateResult -Name $checkName -Status "BLOCKED" -Detail "the supply-chain gate returned no result for this check"
      }
    }
  }
}

# Updater signature: prove the staged candidate, or say plainly that there is nothing staged to
# prove. An absent candidate is PENDING (see the header): release.ps1 calls this script before it
# builds, and verifies the signature itself once a candidate exists. A receipt whose detached
# signature is missing is a real FAIL, not an absence - the artifact is there and unproved.
Write-Host ""
Write-Host "VERIFY: updater signature verification"
$stageReceiptPath = Join-Path $bundleDir "release-stage.json"
$stageSignaturePath = "$stageReceiptPath.sig"
$tauriConfPath = Join-Path $repo "src-tauri\tauri.conf.json"
if (-not $nodePath) {
  Add-GateResult -Name "updater signature verification" -Status "BLOCKED" -Detail "required executable 'node' was not found on PATH, so this check did not run"
} elseif (-not (Test-Path -LiteralPath $stageReceiptPath -PathType Leaf)) {
  Add-GateResult -Name "updater signature verification" -Status "PENDING" -Detail "no staged release candidate under the nsis bundle directory, so there is no signature to verify yet; scripts/release.ps1 stages one later in the same run and verifies it there"
} elseif (-not (Test-Path -LiteralPath $stageSignaturePath -PathType Leaf)) {
  Add-GateResult -Name "updater signature verification" -Status "FAIL" -Detail "a staged receipt exists at $stageReceiptPath but its detached signature is missing"
} else {
  $signatureTargets = New-Object System.Collections.ArrayList
  $null = $signatureTargets.Add([pscustomobject]@{ Label = "staged receipt"; Artifact = $stageReceiptPath; Signature = $stageSignaturePath })
  try {
    $receiptText = Get-Content -LiteralPath $stageReceiptPath -Raw
    $receipt = ConvertFrom-Json $receiptText
    $installerPath = Join-Path $repo ([string]$receipt.installer.path)
    $installerSignaturePath = Join-Path $repo ([string]$receipt.signature.path)
    if ((Test-Path -LiteralPath $installerPath -PathType Leaf) -and (Test-Path -LiteralPath $installerSignaturePath -PathType Leaf)) {
      $null = $signatureTargets.Add([pscustomobject]@{ Label = "staged installer"; Artifact = $installerPath; Signature = $installerSignaturePath })
    }
  } catch {
    Write-Host (Get-RedactedDiagnosticText ([string]$_.Exception.Message))
  }
  $signatureFailures = New-Object System.Collections.ArrayList
  foreach ($target in $signatureTargets) {
    try {
      Invoke-CheckedProcess "updater signature ($($target.Label))" $nodePath @("scripts/verify-updater-signature.mjs", $target.Artifact, $target.Signature, $tauriConfPath) -WorkingDirectory $repo | Out-Null
    } catch {
      $null = $signatureFailures.Add("$($target.Label): " + (Get-RedactedDiagnosticText ([string]$_.Exception.Message)))
    }
  }
  if ($signatureFailures.Count -gt 0) {
    Add-GateResult -Name "updater signature verification" -Status "FAIL" -Detail ($signatureFailures -join " | ")
  } else {
    $verified = (@($signatureTargets | ForEach-Object { $_.Label }) -join ", ")
    Add-GateResult -Name "updater signature verification" -Status "PASS" -Detail "verified: $verified"
  }
}

# Correctness: types, the whole test suite (frontend, entrypoint, hooks and the release-pipeline
# guards all live under the one vitest run), then the builds.
Invoke-ToolGate -Name "TypeScript" -ToolName "node" -ToolPath $nodePath -Arguments @("node_modules/typescript/bin/tsc", "--noEmit")
Invoke-NpmGate -Name "Vitest suite (frontend, hooks, entrypoint, release-pipeline guards)" -Arguments @("test")
Invoke-NpmGate -Name "frontend production build" -Arguments @("run", "build")
Invoke-ToolGate -Name "Rust tests" -ToolName "cargo" -ToolPath $cargoPath -Arguments @("test", "--manifest-path", "src-tauri/Cargo.toml")
Invoke-ToolGate -Name "Rust clippy" -ToolName "cargo" -ToolPath $cargoPath -Arguments @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings")

# The account of the run.
$results = @($script:GateResults)
$failed = @($results | Where-Object { $_.status -eq "FAIL" })
$blocked = @($results | Where-Object { $_.status -eq "BLOCKED" })
$pending = @($results | Where-Object { $_.status -eq "PENDING" })
$passed = @($results | Where-Object { $_.status -eq "PASS" })
$overall = if ($failed.Count -gt 0) { "FAIL" } elseif ($blocked.Count -gt 0) { "BLOCKED" } elseif ($pending.Count -gt 0) { "PENDING" } else { "PASS" }

$commit = "unknown"
if ($gitPath) {
  $head = Invoke-NativeProcess -Command $gitPath -ArgumentList @("-C", $repo, "rev-parse", "HEAD") -TimeoutMs 60000
  if ($head.ExitCode -eq 0) { $commit = $head.StdOut.Trim() }
}

$supplyChainEvidence = $null
if (Test-Path -LiteralPath $supplyChainPath -PathType Leaf) {
  try {
    $supplyChainEvidenceText = Get-Content -LiteralPath $supplyChainPath -Raw
    $supplyChainEvidence = ConvertFrom-Json $supplyChainEvidenceText
  } catch {
    $supplyChainEvidence = $null
  }
}

# The inventory rides along inside the evidence file, so the pack that accompanies a candidate says
# exactly which dependency versions were audited to produce these verdicts.
$evidence = [ordered]@{
  schema_version = 1
  generated_at   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  commit         = $commit
  status         = $overall
  checks         = @($results)
  supply_chain   = $supplyChainEvidence
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EvidencePath) | Out-Null
[System.IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "VERIFY SUMMARY"
foreach ($result in $results) {
  Write-Host ("  {0,-8} {1}" -f $result.status, $result.name)
  if ($result.status -ne "PASS" -and $result.detail) { Write-Host ("           {0}" -f $result.detail) }
}
Write-Host ""
Write-Host ("  {0} checks: {1} passed, {2} failed, {3} blocked, {4} pending" -f $results.Count, $passed.Count, $failed.Count, $blocked.Count, $pending.Count)
Write-Host ("  evidence: {0}" -f $EvidencePath)

if ($failed.Count -gt 0) {
  Write-Host "VERIFY RESULT: FAIL"
  exit 1
}
if ($blocked.Count -gt 0) {
  Write-Host "VERIFY RESULT: BLOCKED - every other gate passed, but the checks above could not be proved."
  exit 3
}
if ($pending.Count -gt 0) {
  Write-Host "VERIFY RESULT: PASS - every gate that had something to check passed; the pending checks above are waiting on an artifact this run has not produced yet."
  exit 0
}
Write-Host "VERIFY RESULT: PASS - all release gates passed."
exit 0
