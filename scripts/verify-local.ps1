# verify-local.ps1 - the everyday pre-push gate (docs/PRODUCT_CONSTITUTION.md section 38).
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# The gate is limited to user safety and correctness: diff check, type-check + bundle, clippy, the
# frontend GATE tests (npm run test:gate) and the Rust tests. Everything else lives in
# `npm run test:audit` (scripts/audit-tests.txt), which runs weekly and before every release.
# It does not publish, install, or change Windows state. It is a read-only proof, and it does not
# install dependencies: a missing node_modules is reported, not fixed.
#
# NOT a duplicate of scripts/verify-release.ps1: that is a strict superset run before a release.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gateStart = Get-Date

# The gate keeps its own output (newest 20 logs), so an intermittent failure leaves evidence.
$script:GateLog = $null
try {
  $logDir = Join-Path $repo "logs"
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
  $script:GateLog = Join-Path $logDir "verify-local-$stamp.log"
  Set-Content -Path $script:GateLog -Value "LOCAL GATE $stamp  repo=$repo" -Encoding UTF8
  # Names sort chronologically, so keeping the newest needs no clock.
  Get-ChildItem -Path $logDir -Filter "verify-local-*.log" | Sort-Object Name -Descending |
    Select-Object -Skip 20 | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
}
catch {
  # A log directory that cannot be written costs the log, never the check.
  $script:GateLog = $null
}

# Say it on the console AND in the log, so the log reads like the run.
function Write-Gate {
  param([string]$Text = "")
  Write-Host $Text
  if ($script:GateLog) {
    try { Add-Content -Path $script:GateLog -Value $Text -Encoding UTF8 } catch { }
  }
}

# Node 24 on Windows can abort INSIDE process.exit() (nodejs/node#56645), leaving 0xC0000409
# (3221226505 unsigned, -1073740791 as PowerShell's Int32) instead of the code it meant. That number
# is the runtime's, never the tree's. A Node-hosted check that dies with exactly that code is run
# ONCE more with a WARN naming the cause; any other exit code, and a second abort, is final.
$NodeRuntimeAbortCodes = @(-1073740791, 3221226505)

# Run a check so stdout AND stderr reach both the console and the log, in one encoding (UTF-8).
# vitest puts the verdict on stdout and the attribution on stderr; a stdout-only log would keep
# "failed" and lose the reason. $ErrorActionPreference is relaxed around the call only, because
# under 5.1 a merged native stderr line arrives as an ErrorRecord that Stop would turn fatal. A
# check fails on its EXIT CODE, never on having written to stderr.
function Invoke-Teed {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @()
  )
  if (-not $script:GateLog) {
    & $Command @Arguments
    return
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command @Arguments 2>&1 | ForEach-Object {
      $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
      Write-Host $line
      try { Add-Content -Path $script:GateLog -Value $line -Encoding UTF8 } catch { }
    }
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Invoke-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    # Set only for checks whose top-level process is Node (npm scripts). cargo is never retried.
    [switch]$NodeHosted
  )
  $checkStart = Get-Date
  Write-Gate ""
  Write-Gate "LOCAL CHECK: $Name"
  Invoke-Teed -Command $Command -Arguments $Arguments
  if ($NodeHosted -and ($NodeRuntimeAbortCodes -contains $LASTEXITCODE)) {
    Write-Gate ""
    Write-Gate "LOCAL CHECK WARN: $Name died with 0xC0000409 -- a Node runtime abort at exit (nodejs/node#56645), not a verdict on this tree. Running it once more."
    Write-Gate "LOCAL CHECK: $Name (re-run after Node runtime abort)"
    Invoke-Teed -Command $Command -Arguments $Arguments
  }
  $code = $LASTEXITCODE
  Write-Gate ("LOCAL CHECK TIME: {0} = {1:N1} s" -f $Name, ((Get-Date) - $checkStart).TotalSeconds)
  if ($code -ne 0) {
    throw "$Name failed with exit code $code."
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
$null = Resolve-RequiredCommand "node"

# Run from the repository root no matter where this was invoked from: npm resolves its config from
# the working directory, so a run started in a subdirectory would silently test something else.
Push-Location $repo
try {
  if (-not (Test-Path (Join-Path $repo "node_modules\.package-lock.json"))) {
    throw "node_modules is missing or incomplete. Run: npm ci"
  }
  Invoke-Check -Name "git diff check" -Command $git -Arguments @("-c", "safe.directory=$repo", "-C", $repo, "diff", "--check")
  Invoke-Check -Name "type-check + bundle" -Command $npm -Arguments @("run", "build") -NodeHosted
  # clippy before test: a lint failure comes back in about ten seconds, not after the long pole.
  Invoke-Check -Name "Rust clippy" -Command $cargo -Arguments @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--", "-D", "warnings")

  # cargo test runs beside vitest: its long pole is single-threaded test time, not CPU.
  $cargoLog = Join-Path $repo "logs\cargo-test-last.log"
  $cargoStart = Get-Date
  Write-Gate ""
  Write-Gate "LOCAL CHECK: Rust tests (started beside the frontend gate tests)"
  $cargoProc = Start-Process -FilePath $cargo -ArgumentList @("test", "--manifest-path", "src-tauri/Cargo.toml") `
    -RedirectStandardOutput $cargoLog -RedirectStandardError "$cargoLog.err" -NoNewWindow -PassThru
  $null = $cargoProc.Handle   # Windows PowerShell 5.1 loses ExitCode without a cached handle
  try {
    Invoke-Check -Name "frontend gate tests" -Command $npm -Arguments @("run", "test:gate") -NodeHosted
  }
  finally {
    # If vitest failed, still wait: no orphan cargo may be left writing into target/.
    $cargoProc.WaitForExit()
  }
  foreach ($f in @($cargoLog, "$cargoLog.err")) {
    if (Test-Path $f) { Get-Content $f | ForEach-Object { Write-Gate $_ } }
  }
  Write-Gate ("LOCAL CHECK TIME: Rust tests = {0:N1} s" -f ($cargoProc.ExitTime - $cargoStart).TotalSeconds)
  if ($cargoProc.ExitCode -ne 0) {
    throw "Rust tests failed with exit code $($cargoProc.ExitCode)."
  }
}
finally {
  Pop-Location
  if ($script:GateLog) {
    Write-Host ""
    Write-Host "LOCAL CHECK LOG: $script:GateLog"
  }
}

Write-Gate ""
Write-Gate ("LOCAL CHECK WALL TIME: {0:N1} s" -f ((Get-Date) - $gateStart).TotalSeconds)
Write-Gate "LOCAL CHECK RESULT: PASS"
