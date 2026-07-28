// @vitest-environment node
// bug->guard (failed v0.9.9 publish, 2026-07-27): scripts/ship-reinstall.ps1 ran the CDP probe as a
// PowerShell NATIVE command. Windows PowerShell 5.1 promotes ANY native stderr write to a
// TERMINATING NativeCommandError under $ErrorActionPreference = "Stop" (`2>$null` does not stop it),
// so the first connection refusal -- which is EXPECTED while a freshly installed app boots -- killed
// the release inside the very retry loop written to tolerate it.
//
// release-pipeline-guard.test.mjs pins the mechanism statically. This suite proves the BEHAVIOUR by
// driving scripts/lib/runtime-proof.ps1 through real `powershell.exe` (5.1, the exact environment)
// against real child processes:
//   1. a probe against a closed port exits nonzero WITHOUT terminating the calling PowerShell
//   2. expected failed attempts are followed by a successful valid response
//   3. a stamp mismatch still fails, immediately
//   4. a version mismatch still fails, immediately
//   5. no valid response before the deadline still fails
//   6. an exited Compy process still fails, immediately
// Every fixture is ASCII on the wire: the stamp's U+00B7 is emitted as UTF-8 by node and returned as
// code points, so a code-page decoding regression in the capture helper fails test 2 loudly.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

// Escapes, not literals: every generated fixture below must be pure ASCII on disk, so the only
// place U+00B7 exists as a byte is where the code under test puts it.
const EXPECTED_STAMP = "abc1234 · release";
const EXPECTED_VERSION = "9.9.9";
const EXPECTED_RAIL = "v9.9.9";

// One fake probe, selected by mode. Mirrors e2e-updater-probe.mjs: one JSON line on stdout and
// exit 0, or a message on stderr and a nonzero exit.
const FAKE_PROBE = `import { appendFileSync, readFileSync } from "node:fs";
const [mode, counterFile, failCount] = process.argv.slice(2);
const good = { stamp: "abc1234 \\u00b7 release", railVersion: "${EXPECTED_RAIL}", pill: "release" };
const count = (() => {
  appendFileSync(counterFile, "x");
  return readFileSync(counterFile, "utf8").length;
})();
if (mode === "always-fail" || (mode === "flaky" && count <= Number(failCount))) {
  console.error("connect ECONNREFUSED 127.0.0.1:1 (attempt " + count + ")");
  process.exit(1);
}
if (mode === "stamp-mismatch") { console.log(JSON.stringify({ ...good, stamp: "deadbee \\u00b7 release" })); process.exit(0); }
if (mode === "version-mismatch") { console.log(JSON.stringify({ ...good, railVersion: "v0.0.1" })); process.exit(0); }
console.log(JSON.stringify(good));
process.exit(0);
`;

// ASCII only, no BOM required. Prints ASCII-safe markers so the harness output survives whatever
// code page powershell.exe uses for a redirected pipe.
const HARNESS = `param(
  [Parameter(Mandatory = $true)][string]$Scenario,
  [Parameter(Mandatory = $true)][string]$LibPath,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$FakeProbe,
  [Parameter(Mandatory = $true)][string]$RealProbe,
  [Parameter(Mandatory = $true)][string]$CounterFile
)
# The exact condition that turned an expected probe failure into a fatal release error.
$ErrorActionPreference = "Stop"
. $LibPath

$expectedStamp = "abc1234 " + [char]0x00B7 + " release"
$psExe = (Get-Command powershell).Source
$child = $null
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  if ($Scenario -eq "closed-port") {
    # Port 1 never listens: the REAL probe writes to stderr and exits nonzero.
    $r = Invoke-CapturedProcess -FilePath $NodeExe -ArgumentList @($RealProbe, "1", "stamp")
    Write-Output ("EXIT=" + $r.ExitCode)
    Write-Output ("STDERR_LEN=" + $r.StdErr.Length)
    Write-Output ("TIMEDOUT=" + $r.TimedOut)
  } else {
    $mode = "ok"
    $failCount = 0
    $timeout = 30
    if ($Scenario -eq "flaky-then-ok") { $mode = "flaky"; $failCount = 2 }
    if ($Scenario -eq "stamp-mismatch") { $mode = "stamp-mismatch" }
    if ($Scenario -eq "version-mismatch") { $mode = "version-mismatch" }
    if ($Scenario -eq "deadline") { $mode = "always-fail"; $timeout = 1 }

    if ($Scenario -eq "process-exited") {
      $child = Start-Process -FilePath $psExe -ArgumentList @("-NoProfile", "-Command", "exit 7") -PassThru -WindowStyle Hidden
      $child.WaitForExit()
    } else {
      $child = Start-Process -FilePath $psExe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 45") -PassThru -WindowStyle Hidden
    }

    try {
      $proof = Invoke-CompyRuntimeProof \`
        -LaunchedProcess $child \`
        -ProbeFilePath $NodeExe \`
        -ProbeArgumentList @($FakeProbe, $mode, $CounterFile, "$failCount") \`
        -ExpectedStamp $expectedStamp \`
        -ExpectedVersion "${EXPECTED_VERSION}" \`
        -TimeoutSeconds $timeout \`
        -RetryDelayMs 100
      Write-Output ("STAMP_CODES=" + (([int[]][char[]]$proof.Stamp) -join ","))
      Write-Output ("RAIL=" + $proof.RailVersion)
      Write-Output ("ATTEMPTS=" + $proof.Attempts)
      Write-Output ("TRANSIENT=" + $proof.TransientFailures)
    } catch {
      Write-Output ("THREW=" + $_.Exception.Message)
    }
  }
} finally {
  if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
}
Write-Output ("ELAPSED_MS=" + $sw.ElapsedMilliseconds)
# Reached only if nothing terminated this PowerShell session.
Write-Output "SURVIVED"
exit 0
`;

let dir = "";
let harness = "";
let fakeProbe = "";
let counterSeq = 0;

beforeAll(() => {
  if (!windows) return;
  dir = mkdtempSync(join(tmpdir(), "compy-runtime-proof-"));
  harness = join(dir, "harness.ps1");
  fakeProbe = join(dir, "fake-probe.mjs");
  // Loudly, not silently: a non-ASCII byte in a generated fixture would make this suite test its
  // own corruption instead of the code under test.
  for (const [name, text] of [["harness.ps1", HARNESS], ["fake-probe.mjs", FAKE_PROBE]]) {
    const bad = [...text].find((ch) => ch.charCodeAt(0) > 0x7f);
    if (bad) throw new Error(`generated ${name} must be pure ASCII (found U+${bad.charCodeAt(0).toString(16)})`);
  }
  writeFileSync(harness, HARNESS, "utf8");
  writeFileSync(fakeProbe, FAKE_PROBE, "utf8");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = (scenario) => {
  counterSeq += 1;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness,
      "-Scenario", scenario,
      "-LibPath", join(root, "scripts", "lib", "runtime-proof.ps1"),
      "-NodeExe", process.execPath,
      "-FakeProbe", fakeProbe,
      "-RealProbe", join(root, "scripts", "e2e-updater-probe.mjs"),
      "-CounterFile", join(dir, `counter-${scenario}-${counterSeq}.txt`),
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

describe.runIf(windows)("runtime proof behaviour (bug->guard, failed v0.9.9 publish)", () => {
  it("returns a nonzero exit for a probe against a closed port without terminating PowerShell", () => {
    const { field } = run("closed-port");
    expect(Number(field("EXIT"))).not.toBe(0);
    expect(Number(field("STDERR_LEN"))).toBeGreaterThan(0);
    expect(field("TIMEDOUT")).toBe("False");
  }, 60000);

  it("survives expected failed attempts and then accepts a valid response", () => {
    const { field, out } = run("flaky-then-ok");
    expect(out, out).not.toContain("THREW=");
    const stamp = String.fromCharCode(...field("STAMP_CODES").split(",").map(Number));
    expect(stamp).toBe(EXPECTED_STAMP); // proves UTF-8 decoding of U+00B7, not the console code page
    expect(field("RAIL")).toBe(EXPECTED_RAIL);
    expect(Number(field("ATTEMPTS"))).toBe(3);
    expect(Number(field("TRANSIENT"))).toBe(2);
  }, 60000);

  it("still fails immediately on a stamp mismatch", () => {
    const { field, elapsed } = run("stamp-mismatch");
    expect(field("THREW")).toContain("RUNTIME STAMP MISMATCH");
    expect(elapsed).toBeLessThan(20000); // the 30s deadline was never reached
  }, 60000);

  it("still fails immediately on a version mismatch", () => {
    const { field, elapsed } = run("version-mismatch");
    expect(field("THREW")).toContain("RUNTIME VERSION MISMATCH");
    expect(elapsed).toBeLessThan(20000);
  }, 60000);

  it("still fails when no valid response arrives before the deadline", () => {
    const { field } = run("deadline");
    expect(field("THREW")).toContain("RUNTIME PROOF FAILED");
    expect(field("THREW")).toContain("did not answer the build-stamp probe");
    expect(field("THREW")).toMatch(/\d+ attempt\(s\)/);
  }, 60000);

  it("still fails immediately when the app process has exited", () => {
    const { field, elapsed } = run("process-exited");
    expect(field("THREW")).toContain("RUNTIME PROOF FAILED");
    expect(field("THREW")).toContain("exited before its main window became healthy");
    expect(field("THREW")).toContain("exit 7");
    expect(elapsed).toBeLessThan(20000);
  }, 60000);
});
