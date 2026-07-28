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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

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
  const child = spawn(process.execPath, [process.argv[1], "child-hang"], {
    detached: false,
    stdio: "ignore",
  });
  console.log("CHILD_PID=" + child.pid);
  setInterval(() => {}, 60000);
}
if (!["hang", "child-hang", "tree-hang"].includes(mode)) {
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
} elseif ($Scenario -eq "timeout-tree-kill") {
  $result = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($FakeGh, "tree-hang") -TimeoutMs 2000
  Write-Output ("TIMEDOUT=" + $result.TimedOut)
  Write-Output ("TERMINATION_ATTEMPTED=" + $result.TerminationAttempted)
  Write-Output ("TREE_STDOUT=" + (($result.StdOut -replace "[\r\n]+", "|").Trim("|")))
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
    { encoding: "utf8", windowsHide: true },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // The whole point: the harness must reach its end. A NativeCommandError would abort it.
  expect(out, `harness did not survive scenario ${scenario}:\n${out}`).toContain("SURVIVED");
  expect(result.status, `harness exit for ${scenario}:\n${out}`).toBe(0);
  const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1]?.trim() ?? "";
  return { out, field, elapsed: Number(field("ELAPSED_MS")) };
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
    const { field, elapsed } = run("timeout-kill");
    expect(field("TIMEDOUT")).toBe("True");
    expect(field("THREW")).toContain("timed out");
    expect(field("THREW")).toContain("not treated as an absent tag");
    expect(elapsed).toBeLessThan(30000);
  }, 60000);

  it("attempts process-tree termination so timed-out descendants do not survive", async () => {
    const { field } = run("timeout-tree-kill");
    expect(field("TIMEDOUT")).toBe("True");
    expect(field("TERMINATION_ATTEMPTED")).toBe("True");
    const childPid = Number(field("TREE_STDOUT").match(/CHILD_PID=(\d+)/)?.[1]);
    expect(childPid).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(() => process.kill(childPid, 0)).toThrow();
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
