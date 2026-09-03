// @vitest-environment node
// bug->guard (SECOND failed v0.9.9 publish, 2026-07-27): scripts/release.ps1 asked the releases
// repository whether a tag existed with
//     (& gh api "repos/.../git/refs/tags/$tag" --jq ".object.sha" 2>$null)
// HTTP 404 is the CORRECT first-publish answer there, and the branch immediately below existed to
// act on it. But gh writes "gh: Not Found (HTTP 404)" to stderr, and Windows PowerShell 5.1 promotes
// a NATIVE command's stderr into a TERMINATING NativeCommandError under $ErrorActionPreference =
// "Stop" once that stream is redirected -- `2>$null` does not prevent it, it CAUSES it.
//
// release-pipeline-guard.test.mjs pins the mechanism statically across the whole release-critical
// surface. This suite proves the BEHAVIOUR of scripts/lib/native-process.ps1 by driving it through
// real `powershell.exe` (5.1, the exact environment) against real child processes:
//   1. an expected gh 404 comes back as an ABSENT result, and PowerShell survives
//   2. an authentication/permission failure stays FATAL (404 is not a synonym for "gh failed")
//   3. a network failure stays FATAL
//   4. successful structured stdout is captured and parses correctly
//   5. stderr written on a SUCCESSFUL path cannot terminate PowerShell
//   plus: an empty success is refused rather than guessed at, a hung child is killed on timeout,
//   Invoke-CheckedProcess fails closed carrying the child's own stderr, and the batch-shim route
//   round-trips an argument containing spaces.
// Coverage (10) -- the CDP transient-retry behaviour -- lives in runtime-proof-guard.test.mjs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "./lib/windows-only.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const OK_SHA = "1111111111111111111111111111111111111111";
const JSON_SHA = "2222222222222222222222222222222222222222";
const NOISY_SHA = "3333333333333333333333333333333333333333";

// A fake `gh api`, selected by mode. Every failure mode writes a REAL stderr line, because the
// stderr write is the thing that used to be fatal.
const FAKE_GH = `const [mode, ...rest] = process.argv.slice(2);
if (mode === "notfound") { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }
if (mode === "auth") { console.error("gh: Bad credentials (HTTP 401)"); process.exit(1); }
if (mode === "permission") { console.error("gh: Resource not accessible by personal access token (HTTP 403)"); process.exit(1); }
if (mode === "network") {
  console.error("error connecting to api.github.com");
  console.error("dial tcp: lookup api.github.com: no such host");
  process.exit(1);
}
if (mode === "mixed-auth-404") {
  console.error("gh: Bad credentials (HTTP 401)");
  console.error("proxy footer: HTTP 404");
  process.exit(1);
}
if (mode === "ok") { console.log("${OK_SHA}"); process.exit(0); }
if (mode === "json") { console.log(JSON.stringify({ ref: "refs/tags/v0.9.10", object: { sha: "${JSON_SHA}", type: "commit" } })); process.exit(0); }
if (mode === "noisy-ok") { console.error("warning: reusing cached credentials"); console.log("${NOISY_SHA}"); process.exit(0); }
if (mode === "empty-ok") { process.exit(0); }
// A child that OUTLIVES the script that launched it and lives far longer than the drain budget --
// the shape of the installed app after ship-reinstall returns. Writes nothing; surviving is the point.
if (mode === "linger") { setTimeout(() => process.exit(0), Number(rest[0]) || 60000); }
if (mode === "echo-args") { console.log(JSON.stringify(rest)); process.exit(0); }
if (mode === "environment") {
  console.log(JSON.stringify({
    present: Object.prototype.hasOwnProperty.call(process.env, "COMPY_PRESENT_EMPTY"),
    empty: process.env.COMPY_PRESENT_EMPTY,
    value: process.env.COMPY_OVERRIDE_VALUE,
    inherited: process.env.COMPY_INHERITED_VALUE,
  }));
  process.exit(0);
}
if (mode === "utf8") {
  process.stdout.write("stdout: Nihon - \\u65e5\\u672c\\u8a9e - \\u00b7\\n");
  process.stderr.write("stderr: Zhongwen - \\u4e2d\\u6587 - \\u00b7\\n");
  process.exit(0);
}
if (mode === "high-volume") {
  for (let i = 0; i < 12000; i++) {
    process.stdout.write("OUT-" + i.toString().padStart(5, "0") + "-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n");
    process.stderr.write("ERR-" + i.toString().padStart(5, "0") + "-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\\n");
  }
  process.exit(0);
}
if (mode === "ordered-stream") {
  // Interleaved on purpose: the two streams arrive through separate handlers, which is exactly the
  // condition under which a racing relay reorders them.
  for (let i = 1; i <= 60; i++) {
    process.stdout.write("out-" + i + "\\n");
    process.stderr.write("err-" + i + "\\n");
  }
  process.exit(0);
}
if (mode === "blank-stream") {
  // A blank line is ordinary build output -- npm prints one immediately after its banner, which is
  // precisely where verify-release.ps1 died. Emitted in every position that matters on BOTH streams:
  // leading, interior, consecutive, and trailing.
  process.stdout.write("\\n\\nout-a\\n\\n\\nout-b\\nout-c\\n\\n");
  process.stderr.write("\\nerr-a\\n\\nerr-b\\n\\n\\n");
  process.exit(0);
}
if (mode === "secrets" || mode === "secrets-fail") {
  // Secret-SHAPED, never real. One line per redaction class, including the two MULTI-LINE forms a
  // per-line pass cannot see: a PEM body sits between its markers, minisign key bytes sit after
  // their header. The last line is ordinary build output: a relay that blanks everything after a
  // secret is also broken, because the error it exists to show would be gone.
  for (const line of [
    "gh: request rejected for token ghp_CANARYTOKENaaaaaaaaaaaaaaaaaaaaaaaa",
    "Authorization: Bearer CANARYBEARERbbbbbbbbbbbb",
    "signing_key=CANARYASSIGNcccccccccccc",
    "untrusted comment: minisign encrypted secret key",
    "CANARYMINISIGNdddddddddddddddddddddd",
    "-----BEGIN PRIVATE KEY-----",
    "CANARYPEMBODYeeeeeeeeeeeeeeeeeeeeeeee",
    "-----END PRIVATE KEY-----",
    "tauri build failed at the bundling step",
  ]) {
    console.log(line);
    console.error(line);
  }
  process.exit(mode === "secrets" ? 0 : 1);
}
if (mode === "child-hang") { setInterval(() => {}, 60000); }
if (mode === "tree-hang") {
  const { spawn } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  // detached: true, deliberately (issue #254). A non-detached child rides libuv's job object, so
  // merely killing the PARENT already cascades to it -- proven 2026-08-29 by no-opping
  // Stop-NativeProcessTree and watching this suite stay green. A detached child dies only if the
  // tree walk actually reaches it, which is the property under test.
  const child = spawn(process.execPath, [process.argv[1], "child-hang"], {
    detached: true,
    stdio: "ignore",
  });
  // The pid travels by FILE, not stdout: a surviving grandchild holds inherited duplicates of the
  // wrapper's pipes, so on exactly the runs where tree-kill FAILED the stdout drain times out and a
  // pid sent through it would be lost -- the regression would hang the harness instead of failing.
  writeFileSync(rest[0], "CHILD_PID=" + child.pid);
  console.log("CHILD_PID=" + child.pid);
  setInterval(() => {}, 60000);
}
if (!["hang", "child-hang", "tree-hang", "linger"].includes(mode)) {
  console.error("unknown mode " + mode);
  process.exit(2);
}
if (mode === "hang") setInterval(() => {}, 60000);
`;

// Batch shim, so the .cmd route (cmd.exe /s /c "...") is exercised the same way npm.cmd is by
// verify-release.ps1. CreateProcess cannot launch a .bat/.cmd directly.
const GH_CMD = `@echo off\r\nnode "%~dp0fake-gh.mjs" echo-args %*\r\n`;

// ASCII only, no BOM. Reproduces release.ps1's tag-probe classification verbatim so the branch that
// burned v0.9.9 is proven, not just the helper under it.
const HARNESS = `param(
  [Parameter(Mandatory = $true)][string]$Scenario,
  [Parameter(Mandatory = $true)][string]$LibPath,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$FakeGh,
  [Parameter(Mandatory = $true)][string]$GhCmd,
  [Parameter(Mandatory = $true)][string]$SpaceArg
)
# The exact condition that converted an expected 404 into a fatal release error.
$ErrorActionPreference = "Stop"
. $LibPath

# Verbatim shape of release.ps1's releases-repo tag lookup: ONLY a real 404 reads as absence.
function Resolve-TagProbe {
  param([psobject]$Result)
  if ($Result.TimedOut) {
    throw "Releases-repo tag lookup timed out. Authentication/network failure is not treated as an absent tag."
  }
  if ($Result.ExitCode -eq 0) {
    $sha = ($Result.StdOut).Trim()
    if ([string]::IsNullOrWhiteSpace($sha)) {
      throw "Releases-repo tag lookup succeeded but returned no sha. Refusing to guess."
    }
    return $sha
  }
  if (Test-GhNotFound $Result) { return "" }
  throw "Releases-repo tag lookup failed (exit " + $Result.ExitCode + "). Authentication/network failure is not treated as an absent tag. " + (Get-FirstNonEmptyLine $Result.StdErr)
}

$modes = @{
  "expected-404"       = "notfound"
  "auth-failure"       = "auth"
  "permission-failure" = "permission"
  "network-failure"    = "network"
  "structured-json"    = "json"
  "stderr-on-success"  = "noisy-ok"
  "empty-success"      = "empty-ok"
  "mixed-auth-404"     = "mixed-auth-404"
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()

if ($modes.ContainsKey($Scenario)) {
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, $modes[$Scenario]) -TimeoutMs 30000
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  Write-Output ("STDERR_LEN=" + $result.StdErr.Length)
  Write-Output ("STDERR_FIRST=" + (Get-FirstNonEmptyLine $result.StdErr))
  Write-Output ("NOTFOUND=" + (Test-GhNotFound $result))
  try {
    $resolved = Resolve-TagProbe $result
    Write-Output ("RESOLVED=[" + $resolved + "]")
    if ($Scenario -eq "structured-json") {
      $payload = $result.StdOut.Trim() | ConvertFrom-Json
      Write-Output ("JSON_SHA=" + $payload.object.sha)
      Write-Output ("JSON_REF=" + $payload.ref)
    }
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} elseif ($Scenario -eq "timeout-kill") {
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "hang") -TimeoutMs 2000
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  try {
    Resolve-TagProbe $result | Out-Null
    Write-Output "RESOLVED=[unreachable]"
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} elseif ($Scenario -eq "timeout-kill-fallback") {
  # The taskkill path, forced. On a host whose WMI is down taskkill itself hangs (~60s, measured
  # 2026-09-02) and, started with inherited handles, holds the caller's pipes for as long as it
  # lives. The library must kill its own killer so this harness reaches EOF inside the drain budget.
  $env:COMPY_NATIVE_TREE_KILL_FALLBACK = "1"
  try {
    $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "hang") -TimeoutMs 2000
  } finally {
    Remove-Item Env:COMPY_NATIVE_TREE_KILL_FALLBACK -ErrorAction SilentlyContinue
  }
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  Write-Output ("TERMINATION_ATTEMPTED=" + $result.TerminationAttempted)
} elseif ($Scenario -eq "timeout-tree-kill") {
  $pidFile = Join-Path ([IO.Path]::GetTempPath()) ("compy-treekill-" + [Guid]::NewGuid().ToString("N") + ".txt")
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "tree-hang", $pidFile) -TimeoutMs 2000
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  Write-Output ("TERMINATION_ATTEMPTED=" + $result.TerminationAttempted)
  # deflake (issue #254, 2026-08-29, failed the full-parallel pre-push gate twice): the death check
  # lives HERE now, as an identity-checked poll, because the old test-side probe was wrong twice
  # over. It slept a fixed 1s -- under gate-wide CPU contention the kill can land later -- and it
  # probed with a bare pid (process.kill(pid, 0)), which under the gate's process churn can hit a
  # RECYCLED pid: measured on this machine 2026-08-29, a freed pid was re-occupied within 3s in 4 of
  # 12 trials. A dead child then read as alive. This poll cannot make that mistake: a process only
  # counts as OUR child while its CommandLine still carries the unique fixture path AND the
  # child-hang mode; anything else at that pid means our child is gone.
  $childPid = 0
  if (Test-Path -LiteralPath $pidFile) {
    $rawPid = Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue
    if ($rawPid -match "CHILD_PID=(\\d+)") { $childPid = [int]$Matches[1] }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  Write-Output ("TREE_CHILD_PID=" + $childPid)
  if ($childPid -le 0) {
    # Under contention the 2s timeout can fire before the parent node process ever reached spawn.
    # No descendant existed, so tree termination was never exercised: inconclusive, not a verdict.
    Write-Output "TREE_CHILD_FATE=SPAWN_INCONCLUSIVE"
  } else {
    $fate = "ALIVE"
    $probe = [Diagnostics.Stopwatch]::StartNew()
    while ($probe.ElapsedMilliseconds -lt 20000) {
      $rows = $null
      $queryOk = $true
      # WMI-free on purpose (2026-09-02): the CIM Win32_Process query hung for minutes on the dev
      # machine and this poll never returned, so the gate went red on a kill that had happened. The
      # snapshot is the kernel's own process table. Identity is the child's PARENT pid: toolhelp
      # keeps the creator's pid after the creator dies, and a recycled pid is a process some OTHER
      # creator made -- which is exactly the reuse this poll must not mistake for our child.
      try { $rows = @(Get-NativeProcessSnapshot) } catch { $queryOk = $false }
      if ($queryOk) {
        $live = $rows | Where-Object { $_.ProcessId -eq $childPid } | Select-Object -First 1
        if ($null -eq $live) { $fate = "DEAD"; break }
        if (($live.ParentProcessId -ne $result.ProcessId) -or ($live.ExeName -notlike "node*")) { $fate = "PID_REUSED"; break }
      }
      # A snapshot failure does NOT read as death: fail closed toward ALIVE, never toward a pass.
      Start-Sleep -Milliseconds 250
    }
    if ($fate -eq "ALIVE") {
      # A regression must FAIL the assertion, not also leak an immortal node that keeps holding
      # inherited pipe duplicates and hangs the suite. Killed DIRECTLY, never through the library
      # under test -- when tree-kill is the thing that broke, it cannot be the cleanup either.
      try { [System.Diagnostics.Process]::GetProcessById($childPid).Kill() } catch { }
    }
    Write-Output ("TREE_CHILD_FATE=" + $fate)
  }
} elseif ($Scenario -eq "checked-fails-closed") {
  try {
    Invoke-CheckedProcess "releases-repo tag lookup" $NodeExe @($FakeGh, "auth") -TimeoutMs 30000 | Out-Null
    Write-Output "RESOLVED=[unreachable]"
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} elseif ($Scenario -eq "checked-allows-expected") {
  $result = Invoke-CheckedProcess "expected-404 lookup" $NodeExe @($FakeGh, "notfound") -TimeoutMs 30000 -AllowExitCodes @(1)
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("STDERR_FIRST=" + (Get-FirstNonEmptyLine $result.StdErr))
} elseif ($Scenario -eq "detached-frees-caller" -or $Scenario -eq "inherited-strands-caller") {
  # issue #60 defect 2, the BEHAVIOURAL half. An inner script launches a child that outlives it and
  # then exits. The caller reads the inner script's stdout to EOF - exactly what a terminal, CI job
  # or scripting wrapper does. An INHERITED child holds that pipe for its whole life; a -Detached
  # child (ShellExecute) cannot, because it never receives the handle.
  # BOTH arms carry -CreateNoWindow, for two reasons. The pair still differs ONLY by -Detached, so it
  # keeps proving that the switch is what frees the pipe. And a 15-second console child launched
  # through ShellExecute WITHOUT it opened a real Windows Terminal window every time this suite ran -
  # measured 2026-08-20 at HWND level, and it is the residue the owner kept seeing after the seven
  # windowsHide fixes (issue #162).
  $detach = "-CreateNoWindow"
  if ($Scenario -eq "detached-frees-caller") { $detach = "-CreateNoWindow -Detached" }
  $innerPath = Join-Path ([IO.Path]::GetTempPath()) ("compy-detach-" + [Guid]::NewGuid().ToString("N") + ".ps1")
  $innerBody = @(
    (". " + [char]34 + $LibPath + [char]34),
    ("$" + "child = Start-NativeProcess -Command " + [char]34 + $NodeExe + [char]34 + " -ArgumentList @(" + [char]34 + $FakeGh + [char]34 + "," + [char]34 + "linger" + [char]34 + "," + [char]34 + "15000" + [char]34 + ") " + $detach),
    ("Write-Output ('CHILDALIVE=' + (-not $" + "child.HasExited))"),
    ("$" + "child.Dispose()")
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $innerPath -Value $innerBody -Encoding UTF8
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command powershell).Source
  $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $innerPath + '"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc.WaitForExit(60000) | Out-Null
  $innerExit = $sw.ElapsedMilliseconds
  # Reading to EOF is the caller behaviour under test: it completes only when every writer closes.
  $inner = $proc.StandardOutput.ReadToEnd()
  $sw.Stop()
  Remove-Item -LiteralPath $innerPath -Force -ErrorAction SilentlyContinue
  Write-Output ("INNEREXITMS=" + $innerExit)
  Write-Output ("PIPEEOFMS=" + $sw.ElapsedMilliseconds)
  Write-Output ("INNEROUT=" + (($inner -replace "[
]+", "|").Trim("|")))
} elseif ($Scenario -eq "streamed-surviving-grandchild") {
  # issue #60 defect 2. An inner script launches a child that OUTLIVES it by 60s, exactly as
  # ship-reinstall leaves the installed app running. .NET's CreateProcess inherits handles wholesale
  # (bInheritHandles=TRUE), so that grandchild holds a duplicate of the wrapper's pipe no matter
  # where its own stdout points -- redirection cannot prevent it. The property that MUST hold is
  # therefore not "no inheritance" but "the wrapper gives up on its own schedule".
  $innerPath = Join-Path ([IO.Path]::GetTempPath()) ("compy-survivor-" + [Guid]::NewGuid().ToString("N") + ".ps1")
  $innerBody = @(
    (". " + [char]34 + $LibPath + [char]34),
    ("$" + "child = Start-NativeProcess -Command " + [char]34 + $NodeExe + [char]34 + " -ArgumentList @(" + [char]34 + $FakeGh + [char]34 + "," + [char]34 + "linger" + [char]34 + "," + [char]34 + "60000" + [char]34 + ")"),
    ("$" + "child.Dispose()"),
    "Write-Output 'INNER-OK'"
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $innerPath -Value $innerBody -Encoding UTF8
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $result = Invoke-StreamedProcess "survivor gate" "powershell" @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $innerPath) -TimeoutMs 120000 6>$null
  $sw.Stop()
  Remove-Item -LiteralPath $innerPath -Force -ErrorAction SilentlyContinue
  Write-Output ("ELAPSEDMS=" + $sw.ElapsedMilliseconds)
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  Write-Output ("STDOUT=" + (($result.StdOut -replace "[
]+", "|").Trim("|")))
} elseif ($Scenario -eq "streamed-success") {
  $result = Invoke-StreamedProcess "streamed gate" $NodeExe @($FakeGh, "ok") -TimeoutMs 30000
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
} elseif ($Scenario -eq "streamed-failure") {
  try {
    Invoke-StreamedProcess "streamed gate" $NodeExe @($FakeGh, "auth") -TimeoutMs 30000 | Out-Null
    Write-Output "RESOLVED=[unreachable]"
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} elseif ($Scenario -eq "streamed-order") {
  # 6>$null: the live echo is not the subject here, the RETAINED order is. Split on a regex class
  # rather than an escape sequence, because this harness is embedded in a JS template literal.
  $result = Invoke-StreamedProcess "ordered gate" $NodeExe @($FakeGh, "ordered-stream") -TimeoutMs 30000 6>$null
  $outLines = @($result.StdOut -split "[\r\n]+" | Where-Object { $_ -ne "" })
  $errLines = @($result.StdErr -split "[\r\n]+" | Where-Object { $_ -ne "" })
  $expectedOut = @(1..60 | ForEach-Object { "out-" + $_ })
  $expectedErr = @(1..60 | ForEach-Object { "err-" + $_ })
  Write-Output ("OUT_COUNT=" + $outLines.Count)
  Write-Output ("ERR_COUNT=" + $errLines.Count)
  Write-Output ("OUT_ORDERED=" + ([string]::Join("|", $outLines) -eq [string]::Join("|", $expectedOut)))
  Write-Output ("ERR_ORDERED=" + ([string]::Join("|", $errLines) -eq [string]::Join("|", $expectedErr)))
  Write-Output ("OUT_FIRST12_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]::Join(" ", @($outLines | Select-Object -First 12)))))
} elseif ($Scenario -eq "streamed-blank-lines") {
  # 6>&1 captures the LIVE echo alongside the retained sink, because a blank line has to survive both
  # surfaces: the sink is what poisoned the next relay bind, and the echo is what an operator reads.
  $captured = @(Invoke-StreamedProcess "blank gate" $NodeExe @($FakeGh, "blank-stream") -TimeoutMs 30000 6>&1)
  $records = @($captured | Where-Object { $_ -is [System.Management.Automation.InformationRecord] })
  $result = @($captured | Where-Object { $_ -isnot [System.Management.Automation.InformationRecord] })[0]
  $relay = @($records | ForEach-Object {
    if ($null -ne $_.MessageData -and $null -ne $_.MessageData.Message) { [string]$_.MessageData.Message } else { [string]$_ }
  })
  Write-Output ("EXIT=" + $result.ExitCode)
  # Base64 of the RAW joined text: a blank line is invisible in a console transcript, so it has to be
  # carried through a lossless encoding to be assertable at all.
  Write-Output ("RELAY_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]::Join("|", $relay))))
  Write-Output ("BLANK_OUT_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.StdOut)))
  Write-Output ("BLANK_ERR_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.StdErr)))
} elseif ($Scenario -eq "streamed-secret-relay") {
  # 6>&1 captures what the relay ECHOES. The live transcript is the surface a credential would leak
  # to, so redaction has to happen before the line is printed, not only inside the retained sink.
  $captured = @(Invoke-StreamedProcess "signing gate" $NodeExe @($FakeGh, "secrets") -TimeoutMs 30000 6>&1)
  $records = @($captured | Where-Object { $_ -is [System.Management.Automation.InformationRecord] })
  $result = @($captured | Where-Object { $_ -isnot [System.Management.Automation.InformationRecord] })[0]
  $relay = @($records | ForEach-Object {
    if ($_.MessageData -and $_.MessageData.Message) { [string]$_.MessageData.Message } else { [string]$_ }
  })
  # Base64: console wrapping would corrupt a long diagnostic line before the assertion ever saw it.
  Write-Output ("RELAY_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]::Join("|", $relay))))
  Write-Output ("SINK_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.StdErr)))
  Write-Output ("EXIT=" + $result.ExitCode)
} elseif ($Scenario -eq "streamed-secret-diagnostic") {
  $failure = $null
  try {
    Invoke-StreamedProcess "signing gate" $NodeExe @($FakeGh, "secrets-fail") -TimeoutMs 30000 6>$null | Out-Null
  } catch {
    $failure = $_
  }
  if ($null -eq $failure) {
    Write-Output "THREW="
  } else {
    $inner = $failure.Exception
    # Verbatim shape of release-transaction.ps1's stage wrapper, so the rendered chain is the real one.
    $message = "Release transaction stage 'draft_created' failed during inspect: " + $inner.Message
    $wrapped = New-Object System.Management.Automation.RuntimeException $message, $inner
    $diagnostic = @(Write-ReleaseFailureDiagnostic -Label "release publish" -Failure $wrapped 6>&1 | ForEach-Object {
      if ($_.MessageData -and $_.MessageData.Message) { [string]$_.MessageData.Message } else { [string]$_ }
    })
    Write-Output ("THREW_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$inner.Message)))
    Write-Output ("CLASSIFICATION=" + [string]$inner.Data["NativeClassification"])
    Write-Output ("EXITCODE=" + [string]$inner.Data["NativeExitCode"])
    Write-Output ("DIAG_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]::Join("|", $diagnostic))))
  }
} elseif ($Scenario -eq "checked-secret-diagnostic") {
  try {
    Invoke-CheckedProcess "signing gate" $NodeExe @($FakeGh, "secrets-fail") -TimeoutMs 30000 | Out-Null
    Write-Output "RESOLVED=[unreachable]"
  } catch {
    $inner = $_.Exception
    Write-Output ("THREW_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$inner.Message)))
    Write-Output ("CLASSIFICATION=" + [string]$inner.Data["NativeClassification"])
    Write-Output ("STDERR_TAIL_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$inner.Data["NativeStdErrTail"])))
    Write-Output ("STDOUT_TAIL_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$inner.Data["NativeStdOutTail"])))
  }
} elseif ($Scenario -eq "streamed-allows-expected") {
  $result = Invoke-StreamedProcess "streamed gate" $NodeExe @($FakeGh, "notfound") -TimeoutMs 30000 -AllowExitCodes @(1)
  Write-Output ("EXIT=" + $result.ExitCode)
} elseif ($Scenario -eq "batch-and-quoting") {
  try {
    Invoke-NativeProcess -Command $GhCmd -ArgumentList @("--jq", ".object.sha", "--version&echo INJECTED", $SpaceArg) -TimeoutMs 30000 | Out-Null
    Write-Output "RESOLVED=[unsafe]"
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} elseif ($Scenario -eq "direct-argument-fidelity") {
  $tricky = @("", "space value", 'quote"value', 'trailing\\', 'amp&pipe|percent%bang!')
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList (@($FakeGh, "echo-args") + $tricky) -TimeoutMs 30000
  Write-Output ("ARGS=" + $result.StdOut.Trim())
} elseif ($Scenario -eq "environment-overrides") {
  [Environment]::SetEnvironmentVariable("COMPY_INHERITED_VALUE", "parent", "Process")
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "environment") -Environment @{
    COMPY_PRESENT_EMPTY = ""
    COMPY_OVERRIDE_VALUE = "child-only"
    COMPY_INHERITED_VALUE = "overridden"
  } -TimeoutMs 30000
  Write-Output ("ENV_JSON=" + $result.StdOut.Trim())
  Write-Output ("PARENT_VALUE=" + [Environment]::GetEnvironmentVariable("COMPY_INHERITED_VALUE", "Process"))
} elseif ($Scenario -eq "utf8-capture") {
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "utf8") -TimeoutMs 30000
  Write-Output ("UTF8_OUT_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result.StdOut.Trim())))
  Write-Output ("UTF8_ERR_B64=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result.StdErr.Trim())))
} elseif ($Scenario -eq "high-volume") {
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "high-volume") -TimeoutMs 30000
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("OUT_HAS_LAST=" + $result.StdOut.Contains("OUT-11999"))
  Write-Output ("ERR_HAS_LAST=" + $result.StdErr.Contains("ERR-11999"))
} elseif ($Scenario -eq "missing-executable") {
  try {
    Invoke-NativeProcess -Command "compy-no-such-tool-xyz" -ArgumentList @("--version") | Out-Null
    Write-Output "RESOLVED=[unreachable]"
  } catch {
    Write-Output ("THREW=" + $_.Exception.Message)
  }
} else {
  Write-Output ("THREW=unknown scenario " + $Scenario)
}

Write-Output ("ELAPSED_MS=" + $sw.ElapsedMilliseconds)
# Reached only if nothing terminated this PowerShell session.
Write-Output "SURVIVED"
exit 0
`;

let dir = "";
let harness = "";
let fakeGh = "";
let ghCmd = "";
let spaceArg = "";

beforeAll(() => {
  if (!windows) return;
  dir = mkdtempSync(join(tmpdir(), "compy-native-process-"));
  harness = join(dir, "harness.ps1");
  fakeGh = join(dir, "fake-gh.mjs");
  ghCmd = join(dir, "gh.cmd");
  spaceArg = join(dir, "a b", "receipt note.json");
  // Loudly, not silently: a non-ASCII byte in a generated fixture would make this suite test its
  // own corruption instead of the code under test.
  for (const [name, text] of [["harness.ps1", HARNESS], ["fake-gh.mjs", FAKE_GH], ["gh.cmd", GH_CMD]]) {
    const bad = [...text].find((ch) => ch.charCodeAt(0) > 0x7f);
    if (bad) throw new Error(`generated ${name} must be pure ASCII (found U+${bad.charCodeAt(0).toString(16)})`);
  }
  writeFileSync(harness, HARNESS, "utf8");
  writeFileSync(fakeGh, FAKE_GH, "utf8");
  writeFileSync(ghCmd, GH_CMD, "utf8");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = (scenario) => {
  const t0 = Date.now();
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness,
      "-Scenario", scenario,
      "-LibPath", join(root, "scripts", "lib", "native-process.ps1"),
      "-NodeExe", process.execPath,
      "-FakeGh", fakeGh,
      "-GhCmd", ghCmd,
      "-SpaceArg", spaceArg,
    ],
    // The 90s timeout is a hang backstop, not a budget (issue #254): a process that survives with
    // inherited duplicates of this pipe would otherwise block spawnSync PAST the vitest timeout,
    // which cannot interrupt sync code -- the gate would hang instead of going red.
    { encoding: "utf8", windowsHide: true, timeout: 90000 },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // The whole point: the harness must reach its end. A NativeCommandError would abort it.
  expect(out, `harness did not survive scenario ${scenario}:\n${out}`).toContain("SURVIVED");
  expect(result.status, `harness exit for ${scenario}:\n${out}`).toBe(0);
  const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1]?.trim() ?? "";
  // `elapsed` is the harness's own clock; `wall` is this spawnSync's. They differ by exactly the
  // time a process the library started (or failed to kill) kept a duplicate of our pipe open after
  // the harness had finished -- a 7s kill once read as a 64s hang here (2026-09-02).
  return { out, field, elapsed: Number(field("ELAPSED_MS")), wall: Date.now() - t0 };
};

describe.runIf(windows)("native-process behaviour (bug->guard, both failed v0.9.9 publishes)", () => {
  it("returns an ABSENT result for the expected gh 404 without terminating PowerShell", () => {
    const { out, field } = run("expected-404");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("1");
    expect(field("TIMEDOUT")).toBe("False");
    expect(field("STDERR_FIRST")).toContain("(HTTP 404)");
    expect(field("NOTFOUND")).toBe("True");
    // The empty string is what release.ps1's "create the tag" branch keys on.
    expect(field("RESOLVED")).toBe("[]");
  }, 60000);

  it("keeps an authentication failure fatal instead of reading it as an absent tag", () => {
    const { field } = run("auth-failure");
    expect(field("NOTFOUND")).toBe("False");
    expect(field("RESOLVED")).toBe("");
    expect(field("THREW")).toContain("Releases-repo tag lookup failed (exit 1)");
    expect(field("THREW")).toContain("Authentication/network failure is not treated as an absent tag");
    // The child's own stderr is carried into the failure, so the transcript alone diagnoses it.
    expect(field("THREW")).toContain("gh: Bad credentials (HTTP 401)");
  }, 60000);

  it("keeps a permission failure fatal", () => {
    const { field } = run("permission-failure");
    expect(field("NOTFOUND")).toBe("False");
    expect(field("THREW")).toContain("Releases-repo tag lookup failed (exit 1)");
    expect(field("THREW")).toContain("(HTTP 403)");
  }, 60000);

  it("keeps a network failure fatal", () => {
    const { field } = run("network-failure");
    expect(field("NOTFOUND")).toBe("False");
    expect(field("THREW")).toContain("Releases-repo tag lookup failed (exit 1)");
    expect(field("THREW")).toContain("error connecting to api.github.com");
  }, 60000);

  it("does not let an authentication failure hide behind unrelated 404 text", () => {
    const { field } = run("mixed-auth-404");
    expect(field("NOTFOUND")).toBe("False");
    expect(field("THREW")).toContain("Bad credentials (HTTP 401)");
  }, 60000);

  it("captures successful structured stdout and parses it correctly", () => {
    const { out, field } = run("structured-json");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("0");
    expect(field("JSON_SHA")).toBe(JSON_SHA);
    expect(field("JSON_REF")).toBe("refs/tags/v0.9.10");
  }, 60000);

  it("survives stderr written on a successful path", () => {
    const { out, field } = run("stderr-on-success");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("0");
    expect(Number(field("STDERR_LEN"))).toBeGreaterThan(0);
    expect(field("STDERR_FIRST")).toContain("reusing cached credentials");
    // A warning on stderr is not a 404 and not a failure; the real answer still comes back.
    expect(field("NOTFOUND")).toBe("False");
    expect(field("RESOLVED")).toBe(`[${NOISY_SHA}]`);
  }, 60000);

  it("refuses a successful lookup that returns nothing instead of guessing", () => {
    const { field } = run("empty-success");
    expect(field("EXIT")).toBe("0");
    expect(field("THREW")).toContain("succeeded but returned no sha");
  }, 60000);

  it("kills a hung child at the timeout and never calls it an absent tag", () => {
    const { field, elapsed, wall } = run("timeout-kill");
    expect(field("TIMEDOUT")).toBe("True");
    expect(field("THREW")).toContain("timed out");
    expect(field("THREW")).toContain("not treated as an absent tag");
    expect(elapsed).toBeLessThan(30000);
    // The harness finishing is not the caller being free: the pipe must close too (2026-09-02).
    expect(wall).toBeLessThan(30000);
  }, 60000);

  // deflake (issue #254): this test failed the full-parallel pre-push gate twice on 2026-08-29 by
  // racing the kill -- a fixed 1s sleep, then ONE identity-blind process.kill(pid, 0) probe, which a
  // recycled pid satisfies (measured: under churn a freed pid was re-occupied within 3s in 4 of 12
  // trials, and a dead child then reads as alive). The verdict now comes from the harness's
  // identity-checked bounded poll (the timeout-tree-kill branch above). SPAWN_INCONCLUSIVE means the
  // 2s timeout beat the parent's spawn call, so no descendant ever existed to terminate -- rerun
  // that, bounded. This is NOT the banned flake-hiding retry (vitest.config.ts): a real tree-kill
  // regression reports ALIVE on every attempt, never SPAWN_INCONCLUSIVE, so retrying cannot mask it.
  it("attempts process-tree termination so timed-out descendants do not survive", () => {
    let attempt = run("timeout-tree-kill");
    for (let retries = 0; attempt.field("TREE_CHILD_FATE") === "SPAWN_INCONCLUSIVE" && retries < 2; retries++) {
      attempt = run("timeout-tree-kill");
    }
    const { field } = attempt;
    expect(field("TIMEDOUT")).toBe("True");
    expect(field("TERMINATION_ATTEMPTED")).toBe("True");
    expect(Number(field("TREE_CHILD_PID"))).toBeGreaterThan(0);
    // DEAD and PID_REUSED both prove the descendant no longer exists; ALIVE is the regression.
    expect(["DEAD", "PID_REUSED"]).toContain(field("TREE_CHILD_FATE"));
  }, 120000);

  // bug->guard (2026-09-02): taskkill answers through WMI and hung ~60s on the dev machine, and the
  // abandoned killer held inherited duplicates of THIS pipe, so spawnSync could not see EOF until
  // it died -- a 7s kill read as a 64s hang and failed the gate on a test the library had passed.
  // The tree kill no longer uses taskkill at all (toolhelp snapshot + Process.Kill); this forces the
  // fallback that still does and proves the killer cannot outlive its wait: whatever taskkill does,
  // the harness reaches EOF inside the drain budget.
  it("kills its own killer when the taskkill fallback outlives the timeout", () => {
    const { field, wall } = run("timeout-kill-fallback");
    expect(field("TIMEDOUT")).toBe("True");
    expect(field("TERMINATION_ATTEMPTED")).toBe("True");
    expect(wall).toBeLessThan(30000);
  }, 60000);

  it("fails closed on an unexpected nonzero exit, carrying the child's stderr", () => {
    const { field } = run("checked-fails-closed");
    expect(field("THREW")).toBe(
      "releases-repo tag lookup failed (exit 1): gh: Bad credentials (HTTP 401)",
    );
  }, 60000);

  it("lets the caller allow an expected nonzero result", () => {
    const { out, field } = run("checked-allows-expected");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("1");
    expect(field("STDERR_FIRST")).toContain("(HTTP 404)");
  }, 60000);

  // bug->guard (2026-07-28, caught by verify-release.ps1 before this repair was committed):
  // Start-Process -PassThru returns a Process whose SafeHandle is not cached, so after the child
  // exits .ExitCode reads back $null -- and `$null -ne 0` is TRUE, which turned a CLEAN `git diff
  // --check` into "git diff check failed (exit )". Every streaming gate in verify-release.ps1 rides
  // this path, so a passing release would have been unable to prove itself.
  it("reports a real exit code for a streamed gate that succeeds", () => {
    const { out, field } = run("streamed-success");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("0");
    expect(field("TIMEDOUT")).toBe("False");
  }, 60000);

  // bug->guard (issue #60 defect 2) - the BEHAVIOURAL pair, and the one that proves the fix.
  //
  // Reproduced live 2026-08-03: ship-reinstall.ps1 completed all of its work (install done, one
  // installer staged, launched exe stamp-verified) and the wrapper running it had to be KILLED at
  // 600s. Under -Detached the same command returned in 4 seconds. The cause is that a CreateProcess
  // launch hands the child this process's stdout/stderr (bInheritHandles=TRUE) and the installed app
  // is MEANT to outlive the script, so it held the caller's pipe for as long as it ran. Redirecting
  // the child's own streams does NOT prevent this - the handle is inherited regardless.
  //
  // These two cases differ ONLY by the -Detached switch, so the pair proves the switch is what does
  // the work rather than the timing being incidental. The inherited case is the regression detector:
  // if -Detached ever stops using ShellExecute, "detached" starts behaving like "inherited" and the
  // first assertion fails.
  it("strands the caller's pipe when a surviving child INHERITS its handles", () => {
    const { field } = run("inherited-strands-caller");
    // The inner script's own work is instant; only the pipe is held.
    expect(Number(field("INNEREXITMS"))).toBeLessThan(5000);
    expect(field("INNEROUT")).toBe("CHILDALIVE=True");
    // Held until the 15s child exits. Anything under that means inheritance stopped happening.
    expect(Number(field("PIPEEOFMS"))).toBeGreaterThan(10000);
  }, 120000);

  it("frees the caller's pipe immediately when the surviving child is -Detached", () => {
    const { field } = run("detached-frees-caller");
    expect(field("INNEROUT")).toBe("CHILDALIVE=True");
    // The child is still alive for another ~15s; the caller must not be waiting on it.
    expect(Number(field("PIPEEOFMS"))).toBeLessThan(5000);
  }, 120000);

  // bug->guard (issue #60 defect 2, the v0.9.12 publish): release-prove.ps1 / release-publish.ps1
  // printed their success banner and appeared to HANG -- proof finished 11:28, wrapper still alive
  // at 11:37 -- until the owner closed Compy by hand. The runtime proof leaves the installed app
  // RUNNING by design, and .NET's CreateProcess inherits handles wholesale (bInheritHandles=TRUE),
  // so that survivor holds a duplicate of the wrapper's pipe. Redirecting the child's own streams
  // does NOT prevent this (measured: stdout EOF still arrived only when the survivor exited).
  //
  // So the property worth pinning is that the wrapper gives up on its OWN schedule rather than the
  // survivor's. Measured on current main: a 60s survivor costs ~10.4s, not 60s -- the two bounded
  // Complete-NativeStreamLines drains (DrainMs each), and nothing else.
  //
  // Note precisely WHY the parameterless $process.WaitForExit() on the non-timeout path is harmless
  // here, because it looks like the culprit and is not: that overload only blocks for stream EOF
  // when asynchronous reads are outstanding, and this helper deliberately does NOT use
  // BeginOutputReadLine (see the ordering comment in Invoke-StreamedProcess). Swapping in async
  // reads WITHOUT bounding that wait is exactly the regression this test exists to catch -- it
  // would grow to the survivor's full lifetime. The bound, not the overload, is the contract.
  it("gives up on its own schedule when a grandchild outlives the script", () => {
    const { field } = run("streamed-surviving-grandchild");
    // The inner script's own work completes immediately; only teardown is at issue.
    expect(field("STDOUT")).toBe("INNER-OK");
    expect(field("EXIT")).toBe("0");
    expect(field("TIMEDOUT")).toBe("False");
    // Comfortably under the 60s survivor, comfortably over the ~10.4s bounded cost.
    expect(Number(field("ELAPSEDMS"))).toBeLessThan(30000);
  }, 120000);

  // bug->guard (2026-07-28, the v0.9.11 publish): the whole failure arrived as
  // "release publish failed (exit 1)." An outer wrapper's exit status is not a diagnosis; the
  // child's own first stderr line is the one fact an operator needs.
  it("still fails a streamed gate closed, carrying the child's own stderr", () => {
    const { field } = run("streamed-failure");
    expect(field("THREW")).toBe("streamed gate failed (exit 1): gh: Bad credentials (HTTP 401)");
  }, 60000);

  const CANARIES = [
    "CANARYTOKEN",
    "CANARYBEARER",
    "CANARYASSIGN",
    "CANARYMINISIGN",
    "CANARYPEMBODY",
  ];
  const decode = (value) => Buffer.from(value, "base64").toString("utf8");

  // bug->guard (2026-07-28, found while proving the redaction below): the relay used
  // Register-ObjectEvent -Action, and PowerShell runs each -Action block as a thread-pool job. Two
  // racing handlers enqueued the child's lines OUT OF ORDER (measured: out-1 out-2 out-4 out-5
  // out-3). A scrambled build log already fails the "surface useful stderr" bar -- but worse,
  // multi-line redaction reads ADJACENT lines, so the reordering split a PEM block and printed its
  // body in cleartext. Faithful order is therefore a SECURITY property here, not a cosmetic one.
  it("relays both streams in the child's own order", () => {
    const { field } = run("streamed-order");
    expect(field("OUT_COUNT")).toBe("60");
    expect(field("ERR_COUNT")).toBe("60");
    expect(decode(field("OUT_FIRST12_B64"))).toBe(
      "out-1 out-2 out-3 out-4 out-5 out-6 out-7 out-8 out-9 out-10 out-11 out-12",
    );
    expect(field("OUT_ORDERED")).toBe("True");
    expect(field("ERR_ORDERED")).toBe("True");
  }, 60000);

  // bug->guard (2026-07-28, caught by the full verify-release.ps1 run of THIS repair, before commit):
  // the relay sink is a List[string] bound to a MANDATORY parameter, and PowerShell validates a
  // mandatory argument that implements IList ELEMENT BY ELEMENT. One blank line already in the sink
  // therefore failed the NEXT relay call with "Cannot bind argument to parameter 'Sink' because it is
  // an empty string" -- so `npm test`, which prints a blank line right after its banner, could not
  // run through Invoke-StreamedProcess at all. [AllowEmptyCollection()] does not cover this;
  // [AllowEmptyString()] is the decoration that permits an empty ELEMENT. The queue was never
  // affected because ConcurrentQueue is not an IList, which is why the failure looked so arbitrary.
  // No other fixture here emits a blank line, which is exactly why 25 passing guards missed it.
  it("relays and retains blank child output lines instead of failing the sink bind", () => {
    const { field } = run("streamed-blank-lines");
    expect(field("EXIT")).toBe("0");
    // Exact arrays: blanks preserved in every position, and no line collapsed, dropped or moved.
    expect(decode(field("BLANK_OUT_B64")).split("\r\n")).toEqual([
      "", "", "out-a", "", "", "out-b", "out-c", "",
    ]);
    expect(decode(field("BLANK_ERR_B64")).split("\r\n")).toEqual([
      "", "err-a", "", "err-b", "", "",
    ]);
    // The live echo carries them too: a relay that silently swallowed blanks would still let the
    // multi-line redaction state machine read the wrong adjacent line.
    const relay = decode(field("RELAY_B64")).split("|");
    expect(relay).toHaveLength(14);
    expect(relay.filter((line) => line === "")).toHaveLength(9);
    // Cross-stream interleaving is not deterministic; per-stream order is.
    expect(relay.filter((line) => line.startsWith("out-"))).toEqual(["out-a", "out-b", "out-c"]);
    expect(relay.filter((line) => line.startsWith("err-"))).toEqual(["err-a", "err-b"]);
  }, 60000);

  it("redacts every secret class from the live relay without blanking the rest of the build", () => {
    const { out, field } = run("streamed-secret-relay");
    const relay = decode(field("RELAY_B64"));
    const sink = decode(field("SINK_B64"));
    expect(field("EXIT")).toBe("0");
    for (const canary of CANARIES) {
      // Printed AND retained: a credential must survive neither surface.
      expect(relay, relay).not.toContain(canary);
      expect(sink, sink).not.toContain(canary);
      // Nothing reaches the raw transcript either, base64 aside.
      expect(out.replace(/^[A-Z_]+_B64=.*$/gm, ""), out).not.toContain(canary);
    }
    expect(relay).toContain("[REDACTED-TOKEN]");
    expect(relay).toContain("[REDACTED]");
    expect(relay).toContain("[REDACTED-SIGNING-MATERIAL]");
    expect(relay).toContain("[REDACTED-PRIVATE-KEY]");
    // Suppression is bounded: exactly the key material, not everything that follows it.
    expect(relay).toContain("tauri build failed at the bundling step");
    expect(sink).toContain("tauri build failed at the bundling step");
  }, 60000);

  it("prints the nested cause chain, stage, classification, exit code and redacted stderr", () => {
    const { field } = run("streamed-secret-diagnostic");
    const diagnostic = decode(field("DIAG_B64"));
    expect(decode(field("THREW_B64"))).toBe(
      "signing gate failed (exit 1): gh: request rejected for token [REDACTED-TOKEN]",
    );
    expect(field("CLASSIFICATION")).toBe("nonzero-exit");
    expect(field("EXITCODE")).toBe("1");
    expect(diagnostic).toContain("=== release publish FAILED ===");
    // Outer stage context AND the innermost actionable cause, not either end alone.
    expect(diagnostic).toContain("cause: Release transaction stage 'draft_created' failed during inspect");
    expect(diagnostic).toContain("caused by: signing gate failed (exit 1)");
    expect(diagnostic).toContain("failing stage: draft_created (inspect)");
    expect(diagnostic).toContain("command: signing gate");
    expect(diagnostic).toContain("classification: nonzero-exit");
    expect(diagnostic).toContain("exit code: 1");
    expect(diagnostic).toContain("stderr (tail):");
    expect(diagnostic).toContain("tauri build failed at the bundling step");
    expect(diagnostic).toContain("=== end release publish diagnostic ===");
    for (const canary of CANARIES) {
      expect(diagnostic, diagnostic).not.toContain(canary);
    }
  }, 60000);

  it("redacts the captured-mode diagnostic tails the same way", () => {
    const { field } = run("checked-secret-diagnostic");
    const stdErrTail = decode(field("STDERR_TAIL_B64"));
    const stdOutTail = decode(field("STDOUT_TAIL_B64"));
    expect(decode(field("THREW_B64"))).toBe(
      "signing gate failed (exit 1): gh: request rejected for token [REDACTED-TOKEN]",
    );
    expect(field("CLASSIFICATION")).toBe("nonzero-exit");
    for (const canary of CANARIES) {
      expect(stdErrTail, stdErrTail).not.toContain(canary);
      expect(stdOutTail, stdOutTail).not.toContain(canary);
    }
    // Whole-text redaction is what catches a PEM block, whose markers straddle lines.
    expect(stdErrTail).toContain("[REDACTED-PRIVATE-KEY]");
    expect(stdErrTail).toContain("[REDACTED-SIGNING-MATERIAL]");
    expect(stdErrTail).toContain("tauri build failed at the bundling step");
  }, 60000);

  it("lets a streamed caller allow an expected nonzero exit", () => {
    const { out, field } = run("streamed-allows-expected");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("1");
  }, 60000);

  it("refuses batch shims instead of reparsing argument arrays through cmd.exe", () => {
    const { field } = run("batch-and-quoting");
    expect(field("RESOLVED")).toBe("");
    expect(field("THREW")).toContain("Batch shim");
    expect(field("THREW")).toContain("shell reparsing");
  }, 60000);

  it("round-trips empty, quoted, trailing-slash, and shell-metachar arguments to executables", () => {
    const { field } = run("direct-argument-fidelity");
    expect(JSON.parse(field("ARGS"))).toEqual([
      "",
      "space value",
      'quote"value',
      "trailing\\",
      "amp&pipe|percent%bang!",
    ]);
  }, 60000);

  it("applies child-only environment overrides including a present empty value", () => {
    const { field } = run("environment-overrides");
    expect(JSON.parse(field("ENV_JSON"))).toEqual({
      present: true,
      empty: "",
      value: "child-only",
      inherited: "overridden",
    });
    expect(field("PARENT_VALUE")).toBe("parent");
  }, 60000);

  it("decodes captured stdout and stderr explicitly as UTF-8", () => {
    const { field } = run("utf8-capture");
    const stdout = Buffer.from(field("UTF8_OUT_B64"), "base64").toString("utf8");
    const stderr = Buffer.from(field("UTF8_ERR_B64"), "base64").toString("utf8");
    expect(stdout).toContain("日本語");
    expect(stdout).toContain("·");
    expect(stderr).toContain("中文");
    expect(stderr).toContain("·");
  }, 60000);

  it("drains high-volume stdout and stderr concurrently without deadlock or truncation", () => {
    const { field } = run("high-volume");
    expect(field("EXIT")).toBe("0");
    expect(field("OUT_HAS_LAST")).toBe("True");
    expect(field("ERR_HAS_LAST")).toBe("True");
  }, 60000);

  it("refuses to run a tool that is not on PATH", () => {
    const { field } = run("missing-executable");
    expect(field("THREW")).toContain("was not found on PATH");
  }, 60000);
});

// bug->guard (issue #254): the tree-kill deflake is itself pinned. If the whole poll were removed
// the main test would fail on a missing TREE_CHILD_FATE field -- but a PARTIAL revert (dropping
// just the CommandLine identity check, the inconclusive verdict, or the leftover cleanup) would
// bring the original full-parallel races straight back while every test stays green. Runs on every
// platform: it asserts on the HARNESS source, not on live processes.
describe("tree-kill death probe stays deterministic (issue #254)", () => {
  it("keeps the identity-checked, bounded, fail-closed poll in the harness", () => {
    // Identity (WMI-free since 2026-09-02): a pid only counts as our child while the kernel's process
    // table still shows a node.exe whose creator was the timed-out parent. Win32_Process was the
    // previous witness; it hung for minutes on the dev machine and the poll never returned.
    expect(HARNESS).toContain("Get-NativeProcessSnapshot");
    expect(HARNESS).not.toContain("Get-CimInstance");
    expect(HARNESS).toContain("$live.ParentProcessId -ne $result.ProcessId");
    expect(HARNESS).toContain('$fate = "PID_REUSED"');
    // ...and a snapshot that could not be taken proves nothing: only a READ table may classify.
    expect(HARNESS).toContain("$queryOk = $false");
    // Setup that never produced a descendant is inconclusive, not a verdict either way.
    expect(HARNESS).toContain("TREE_CHILD_FATE=SPAWN_INCONCLUSIVE");
    // A failed run must not leak the immortal child-hang node -- and the cleanup must not route
    // through the library under test, whose tree-kill is exactly what a red run says is broken.
    expect(HARNESS).toContain("GetProcessById($childPid).Kill()");
    // Fail-closed polarity: a CIM error may never read as death.
    expect(HARNESS).toContain("catch { $queryOk = $false }");
  });

  it("keeps the discriminating fixture and the pipe-proof pid transport", () => {
    // A non-detached grandchild dies with its parent via libuv's job object, so the test would
    // pass with tree termination entirely removed -- proven 2026-08-29 by no-opping
    // Stop-NativeProcessTree under the old fixture and watching the suite stay green.
    expect(FAKE_GH).toContain("detached: true");
    // The pid travels by file: a surviving grandchild holds inherited pipe duplicates, so on
    // exactly the runs where tree-kill failed, a pid sent through stdout would be lost.
    expect(FAKE_GH).toMatch(/writeFileSync\(rest\[0\], "CHILD_PID="/);
    expect(HARNESS).toContain("TREE_CHILD_PID=");
  });
});
