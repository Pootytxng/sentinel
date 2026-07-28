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
if (mode === "ok") { console.log("${OK_SHA}"); process.exit(0); }
if (mode === "json") { console.log(JSON.stringify({ ref: "refs/tags/v0.9.10", object: { sha: "${JSON_SHA}", type: "commit" } })); process.exit(0); }
if (mode === "noisy-ok") { console.error("warning: reusing cached credentials"); console.log("${NOISY_SHA}"); process.exit(0); }
if (mode === "empty-ok") { process.exit(0); }
if (mode === "echo-args") { console.log(JSON.stringify(rest)); process.exit(0); }
if (mode !== "hang") { console.error("unknown mode " + mode); process.exit(2); }
setInterval(() => {}, 60000);
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
} elseif ($Scenario -eq "streamed-allows-expected") {
  $result = Invoke-StreamedProcess "streamed gate" $NodeExe @($FakeGh, "notfound") -TimeoutMs 30000 -AllowExitCodes @(1)
  Write-Output ("EXIT=" + $result.ExitCode)
} elseif ($Scenario -eq "batch-and-quoting") {
  $result = Invoke-NativeProcess -Command $GhCmd -ArgumentList @("--jq", ".object.sha", $SpaceArg) -TimeoutMs 30000
  Write-Output ("EXIT=" + $result.ExitCode)
  Write-Output ("ARGS=" + $result.StdOut.Trim())
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

  it("still fails a streamed gate closed when the child exits nonzero", () => {
    const { field } = run("streamed-failure");
    expect(field("THREW")).toBe("streamed gate failed (exit 1).");
  }, 60000);

  it("lets a streamed caller allow an expected nonzero exit", () => {
    const { out, field } = run("streamed-allows-expected");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("1");
  }, 60000);

  it("routes a .cmd shim through cmd.exe and round-trips an argument containing spaces", () => {
    const { out, field } = run("batch-and-quoting");
    expect(out, out).not.toContain("THREW=");
    expect(field("EXIT")).toBe("0");
    expect(JSON.parse(field("ARGS"))).toEqual(["--jq", ".object.sha", spaceArg]);
  }, 60000);

  it("refuses to run a tool that is not on PATH", () => {
    const { field } = run("missing-executable");
    expect(field("THREW")).toContain("was not found on PATH");
  }, 60000);
});
