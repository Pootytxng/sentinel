# Focused harness for the /releases/latest/download/ propagation-race primitives.
#
# Where the production-adapter sandbox proves the STAGE behaviour end to end, this harness proves the
# primitives underneath it against a real local HTTP server: a real 404 really is classified as
# propagation absence, a real 500 and a real connection failure really are not, no-cache headers and a
# unique cache-busting token really are put on the wire, and a retried download really cannot verify a
# file an earlier attempt left behind.
#
# This file is ASCII-only for Windows PowerShell 5.1.
param(
  [Parameter(Mandatory = $true)][string]$Sandbox,
  [ValidateSet(
    "http-classification", "stale-file-removed", "unique-cache-busting",
    "cache-busting-query", "version-compare", "lag-refusals"
  )][string]$Case = "http-classification"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
# release-artifacts.ps1 requires both ambients from its caller before it is dot-sourced.
$repo = Split-Path -Parent $PSScriptRoot
$releasesRepo = "sandbox/compy-releases"
. (Join-Path $PSScriptRoot "lib\release-artifacts.ps1")
. (Join-Path $PSScriptRoot "lib\release-transaction.ps1")
. (Join-Path $PSScriptRoot "lib\release-publish-adapter.ps1")

if (-not (Test-Path -LiteralPath $Sandbox -PathType Container)) {
  New-Item -ItemType Directory -Path $Sandbox | Out-Null
}
$Sandbox = (Resolve-Path -LiteralPath $Sandbox).Path
$logPath = Join-Path $Sandbox "requests.jsonl"
$portPath = Join-Path $Sandbox "port.txt"
$serverPath = Join-Path $Sandbox "alias-server.mjs"

function Write-HarnessUtf8 {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# Get-Content decorates every string it returns with the provider's ETS members (PSPath, PSProvider,
# PSDrive), and PSProvider.Drives -> Provider -> Drives is a cycle. Serialising such a string with
# ConvertTo-Json -Depth 8 walks that cycle and never returns, so file text read for reporting is read
# through .NET instead.
function Read-HarnessText {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path)
}

$context = [pscustomobject]@{
  ReleasesRepo = $releasesRepo
  InstallerName = "Compy_9.9.9_x64-setup.exe"
  Receipt = [pscustomobject]@{ version = "9.9.9"; tag = "v9.9.9" }
}

function Get-HarnessRequests {
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { return @() }
  return @(Get-Content -LiteralPath $logPath | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}

# A previous run that was hard-killed cannot have cleaned up after itself: `finally` is a language
# construct and never runs when the interpreter is killed from outside, which is exactly how these
# harnesses die when the worktree that spawned them goes silent. Measured 2026-08-27: two servers
# from this file alive for 110.5 hours, parents long dead, sandboxes deleted, still holding ports.
# The forward fix (the child watches its parent, below) cannot help a machine that has ALREADY
# leaked, so each run sweeps the previous run's garbage before adding a process of its own.
#
# Selection is on a DEAD parent, never on the name alone: a concurrent lane's live harness is not
# this run's garbage, and killing it would turn a leak into a flake.
function Stop-OrphanedAliasServer {
  try {
    $live = @{}
    foreach ($id in (Get-CimInstance Win32_Process -ErrorAction Stop).ProcessId) { $live[[int]$id] = $true }
    $servers = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*alias-server.mjs*" }
    foreach ($server in $servers) {
      if (-not $live.ContainsKey([int]$server.ParentProcessId)) {
        Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    # Reaping is opportunistic hygiene, never a reason to fail the run it is protecting.
  }
}

function Start-HarnessServer {
  Stop-OrphanedAliasServer
  Write-HarnessUtf8 $serverPath @'
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
const [logPath, portPath, parentPid] = process.argv.slice(2);
// The child owns its own lifetime. The caller's `finally` covers a graceful exit; nothing in the
// caller can cover its own hard kill, so the only guarantee that survives one has to live HERE, in
// the process that would otherwise outlive it. `process.kill(pid, 0)` signals nothing and throws
// ESRCH once the parent is gone. Unref'd so the watchdog itself never keeps the server alive.
if (parentPid) {
  setInterval(() => {
    try { process.kill(Number(parentPid), 0); } catch { process.exit(0); }
  }, 1000).unref();
}
const server = createServer((request, response) => {
  appendFileSync(logPath, `${JSON.stringify({url: request.url, headers: request.headers})}\n`);
  if (request.url.startsWith("/absent/")) { response.writeHead(404); response.end("not found"); return; }
  if (request.url.startsWith("/error/")) { response.writeHead(500); response.end("server fault"); return; }
  response.writeHead(200, {"content-type": "application/octet-stream"});
  response.end("sandbox-alias-body");
});
server.listen(0, "127.0.0.1", () => writeFileSync(portPath, String(server.address().port)));
'@
  $node = (Resolve-NativeExecutable "node").Source
  $process = Start-Process -FilePath $node -ArgumentList @($serverPath, $logPath, $portPath, $PID) `
    -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 200; $attempt++) {
    if (Test-Path -LiteralPath $portPath -PathType Leaf) {
      $port = (Get-Content -LiteralPath $portPath -Raw).Trim()
      if ($port) { return [pscustomobject]@{ Process = $process; Port = [int]$port } }
    }
    Start-Sleep -Milliseconds 50
  }
  throw "The harness HTTP server never reported a port."
}

function Get-HarnessErrorRecord {
  param([string]$Uri, [string]$OutFile)
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec 10
    return $null
  } catch {
    return $_
  }
}

function Get-HarnessThrownRecord {
  param([string]$Message)
  try { throw $Message } catch { return $_ }
}

$result = [ordered]@{ case = $Case }

if (@("http-classification", "stale-file-removed", "unique-cache-busting") -contains $Case) {
  $server = Start-HarnessServer
  try {
    $base = "http://127.0.0.1:$($server.Port)"
    $outFile = Join-Path $Sandbox "probe.bin"

    if ($Case -eq "http-classification") {
      # Real responses from a real socket, so the classifier is proved against the shapes production
      # actually meets rather than against a hand-built stand-in.
      $notFound = Get-HarnessErrorRecord "$base/absent/latest.json" $outFile
      $serverFault = Get-HarnessErrorRecord "$base/error/latest.json" $outFile
      # Nothing listens on port 1: a transport failure carries no HTTP response at all.
      $unreachable = Get-HarnessErrorRecord "http://127.0.0.1:1/absent/latest.json" $outFile
      $result.not_found_raised = ($null -ne $notFound)
      $result.server_fault_raised = ($null -ne $serverFault)
      $result.unreachable_raised = ($null -ne $unreachable)
      $result.not_found_is_absence = [bool](Test-ReleasePropagationAbsence $notFound)
      $result.server_fault_is_absence = [bool](Test-ReleasePropagationAbsence $serverFault)
      $result.unreachable_is_absence = [bool](Test-ReleasePropagationAbsence $unreachable)
      $result.null_is_absence = [bool](Test-ReleasePropagationAbsence $null)
      # The injected-transport half of the same contract: harnesses raise the shared marker, and only
      # the marker, to model an alias that does not carry the asset yet.
      $result.marker_is_absence = [bool](Test-ReleasePropagationAbsence (Get-HarnessThrownRecord "release-asset-not-published-yet: latest.json"))
      $result.other_message_is_absence = [bool](Test-ReleasePropagationAbsence (Get-HarnessThrownRecord "some other download failure"))

      Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
      $absent = Get-ProductionAliasAsset $context "$base/absent/latest.json" $outFile "token-alpha"
      # Assign first, then wrap: a single returned record unrolls out of the array otherwise.
      $requests = @(Get-HarnessRequests)
      $result.alias_probe_returned_absent = ($absent -eq $false)
      # One request, not six: a caller that classifies absence itself must not burn the inner retry
      # budget on the 404 it already expects.
      $result.alias_probe_requests = $requests.Count
      $result.alias_probe_url = if ($requests.Count) { $requests[0].url } else { "" }
      $result.alias_probe_cache_control = if ($requests.Count) { "" + $requests[0].headers.'cache-control' } else { "" }
      $result.alias_probe_pragma = if ($requests.Count) { "" + $requests[0].headers.pragma } else { "" }
    }

    if ($Case -eq "stale-file-removed") {
      # A previous attempt's body, sitting exactly where the next attempt would verify it.
      Write-HarnessUtf8 $outFile "stale body from an earlier attempt"
      $result.stale_file_present_before = [bool](Test-Path -LiteralPath $outFile -PathType Leaf)
      $absent = Get-ProductionAliasAsset $context "$base/absent/latest.json" $outFile "token-beta"
      $result.alias_probe_returned_absent = ($absent -eq $false)
      $result.stale_file_present_after = [bool](Test-Path -LiteralPath $outFile -PathType Leaf)
      # And the same guarantee on the success path: the served body replaces the stale one.
      Write-HarnessUtf8 $outFile "stale body from an earlier attempt"
      $null = Get-ProductionAliasAsset $context "$base/ok/latest.json" $outFile "token-gamma"
      $result.fetched_body = Read-HarnessText $outFile
    }

    if ($Case -eq "unique-cache-busting") {
      $first = Get-ProductionAliasAsset $context "$base/ok/latest.json" $outFile "token-one"
      $second = Get-ProductionAliasAsset $context "$base/ok/latest.json" $outFile "token-two"
      # Assign first, then wrap: a single returned record unrolls out of the array otherwise.
      $requests = @(Get-HarnessRequests)
      $result.both_fetched = (($first -eq $true) -and ($second -eq $true))
      $result.urls = @($requests | ForEach-Object { $_.url })
      $result.cache_control_values = @($requests | ForEach-Object { "" + $_.headers.'cache-control' })
    }
  } finally {
    Stop-Process -Id $server.Process.Id -Force -ErrorAction SilentlyContinue
  }
}

if ($Case -eq "cache-busting-query") {
  $result.no_token = Add-ReleaseCacheBustingQuery "https://example.invalid/latest.json" ""
  $result.plain = Add-ReleaseCacheBustingQuery "https://example.invalid/latest.json" "abc"
  $result.existing_query = Add-ReleaseCacheBustingQuery "https://example.invalid/latest.json?a=1" "abc"
}

if ($Case -eq "version-compare") {
  $result.older = Compare-ReleaseVersion "9.9.8" "9.9.9"
  $result.equal = Compare-ReleaseVersion "9.9.9" "9.9.9"
  $result.newer_patch = Compare-ReleaseVersion "9.9.10" "9.9.9"
  $result.newer_minor = Compare-ReleaseVersion "9.10.0" "9.9.9"
  $result.newer_major = Compare-ReleaseVersion "10.0.0" "9.9.9"
  $result.nonsemantic = try { $null = Compare-ReleaseVersion "9.9" "9.9.9"; "" } catch { "" + $_.Exception.Message }
  $result.tagged = try { $null = Compare-ReleaseVersion "v9.9.8" "9.9.9"; "" } catch { "" + $_.Exception.Message }
}

if ($Case -eq "lag-refusals") {
  $manifestPath = Join-Path $Sandbox "alias-latest.json"
  $probe = {
    param([string]$Text)
    Write-HarnessUtf8 $manifestPath $Text
    try { return "OK:" + (Assert-AliasPropagationLag $context $manifestPath) } catch { return "" + $_.Exception.Message }
  }
  $bound = {
    param([string]$Version)
    return (@{
      version = $Version
      platforms = @{ "windows-x86_64" = @{ url = "https://github.com/$releasesRepo/releases/download/v$Version/Compy.exe"; signature = "s" } }
    } | ConvertTo-Json -Depth 6 -Compress)
  }
  $result.unparseable = & $probe "{not json"
  $result.no_version = & $probe (@{ platforms = @{} } | ConvertTo-Json -Depth 6 -Compress)
  $result.newer = & $probe (& $bound "9.9.10")
  $result.equal = & $probe (& $bound "9.9.9")
  $result.foreign_repo = & $probe ((@{
    version = "9.9.8"
    platforms = @{ "windows-x86_64" = @{ url = "https://github.com/someone/else/releases/download/v9.9.8/Compy.exe"; signature = "s" } }
  } | ConvertTo-Json -Depth 6 -Compress))
  $result.wrong_alias_version_path = & $probe ((@{
    version = "9.9.8"
    platforms = @{ "windows-x86_64" = @{ url = "https://github.com/$releasesRepo/releases/download/v9.9.7/Compy.exe"; signature = "s" } }
  } | ConvertTo-Json -Depth 6 -Compress))
  $result.older = & $probe (& $bound "9.9.8")
}

# The result is written to the sandbox as well as to stdout, and the process is ended explicitly:
# a harness that starts a child HTTP server must never be able to hold its caller open after its
# answer is already known.
$json = [pscustomobject]$result | ConvertTo-Json -Depth 8 -Compress
Write-HarnessUtf8 (Join-Path $Sandbox "result.json") $json
$json
