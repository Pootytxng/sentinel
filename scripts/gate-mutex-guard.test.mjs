// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// #522 -- the pre-push gate's `npm test` stage queues on a machine-wide mutex instead of running a
// second full suite beside a peer's. Three gates' suites at once each ran ~15 minutes and all three
// failed on 28-37 timeouts (2026-09-23); the failing tests rotated with the load, so no per-test fix
// could converge. This file pins the fix against REAL processes: the gate takes the mutex around
// `npm test` and nothing else, a second holder waits rather than runs, the wait is bounded and names
// the holder, a failed suite still releases it, and a holder that died is taken over rather than
// deadlocking every lane's push.
//
// NEVER THE PRODUCTION NAME. This file runs inside `npm test`, which runs inside a gate that HOLDS
// Local\Compy.TestGate.v1. A case that waited on that name would wait on its own gate for 30 minutes.
// Every case uses a fresh Local\Compy.Test.<uuid> and a private state directory.
//
// TIMEOUT: same reason as process-mutex-guard.test.mjs, its sibling. These cases spawn Windows
// PowerShell two or three times each and hold some of those processes for the length of a case;
// the global 15s was calibrated for React render tests, not process spawn under the full pool. No
// assertion here is about speed -- they are about order and exit codes, which do not become truer
// at 15s than at 120s.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const root = join(import.meta.dirname, "..");
const lib = join(root, "scripts", "lib", "gate-mutex.ps1");
const verifyLocal = join(root, "scripts", "verify-local.ps1");
const workControl = join(root, "docs", "WORK_CONTROL.md");
const powershell = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";
const PRODUCTION_NAME = "Local\\Compy.TestGate.v1";

const stripPsComments = (text) =>
  text
    .replace(/<#[\s\S]*?#>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

// ---------------------------------------------------------------------------------------------------
// PowerShell drivers, generated into a temp dir so the repo carries no test-only scripts. ASCII only.

const STAMP = String.raw`function Stamp { [DateTime]::UtcNow.ToString("yyyy-MM-dd\THH:mm:ss.fff\Z") }`;

const WAIT_FOR_RELEASE = String.raw`
function Wait-ForRelease {
  param([string]$Path)
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not (Test-Path -LiteralPath $Path)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw "driver: release file never came" }
    Start-Sleep -Milliseconds 25
  }
}`;

// A second party for the gate: takes the mutex through the library, like any other lane's gate.
// -ReadyFile/-ReleaseFile turn it into a holder that lets go only when TOLD (never a fixed sleep,
// which races powershell.exe start-up under the full pool -- #324). -Deny instead creates the mutex
// with an ACL that denies this user, standing in for a lane running under a token we cannot open.
const CONTENDER = String.raw`
param(
  [string]$Lib, [string]$MutexName, [string]$StateDir, [string]$Label = "contender",
  [int]$TimeoutSeconds = 90, [string]$ReadyFile = "", [string]$ReleaseFile = "", [switch]$Deny
)
$ErrorActionPreference = "Stop"
${STAMP}
${WAIT_FOR_RELEASE}
. $Lib
"PID $PID"
if ($Deny) {
  $security = New-Object System.Security.AccessControl.MutexSecurity
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule = New-Object System.Security.AccessControl.MutexAccessRule($me, [System.Security.AccessControl.MutexRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Deny)
  $security.AddAccessRule($rule)
  $created = $false
  $held = New-Object System.Threading.Mutex($true, $MutexName, [ref]$created, $security)
  if (-not $created) { throw "driver: the deny-ACL mutex already existed" }
  "ACQUIRED $(Stamp)"
  Set-Content -LiteralPath $ReadyFile -Value "ready"
  Wait-ForRelease -Path $ReleaseFile
  "RELEASED $(Stamp)"
  $held.ReleaseMutex()
  $held.Dispose()
  exit 0
}
"ATTEMPT $(Stamp)"
$lease = Enter-GateMutex -Name $MutexName -StateDir $StateDir -Label $Label -TimeoutSeconds $TimeoutSeconds -NoticeSeconds 1
"ACQUIRED $(Stamp)"
if ($ReadyFile) { Set-Content -LiteralPath $ReadyFile -Value "ready" }
if ($ReleaseFile) { Wait-ForRelease -Path $ReleaseFile }
"RELEASED $(Stamp)"
Exit-GateMutex -Lease $lease
`;

// Runs verify-local.ps1's OWN statements -- the Enter-GateMutex assignment and the try that follows
// it, lifted from the real file by the PowerShell parser -- with Invoke-Check stubbed to hold the
// stage open until told. Only the mutex name and state dir are redirected, through the library's
// own defaults, so the gate's default-name call path is the one exercised. -InspectOnly reports
// the wiring as JSON instead of running it.
const PROBE = String.raw`
param(
  [string]$VerifyLocal, [string]$Lib, [string]$MutexName, [string]$StateDir,
  [string]$ReadyFile = "", [string]$ReleaseFile = "", [switch]$Fail, [switch]$InspectOnly
)
$ErrorActionPreference = "Stop"
${STAMP}
${WAIT_FOR_RELEASE}
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($VerifyLocal, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "probe: verify-local.ps1 does not parse" }
function Get-Calls { param($Scope, [string]$Name) @($Scope.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $Name }, $true)) }
function Get-CheckName {
  param($Call)
  $e = $Call.CommandElements
  for ($i = 0; $i -lt $e.Count - 1; $i++) {
    if ($e[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $e[$i].ParameterName -eq "Name") {
      try { return [string]$e[$i + 1].SafeGetValue() } catch { return $e[$i + 1].Extent.Text }
    }
  }
  return $null
}
function Test-Inside { param($Inner, $Outer) $Inner.Extent.StartOffset -ge $Outer.Extent.StartOffset -and $Inner.Extent.EndOffset -le $Outer.Extent.EndOffset }

$enters = @(Get-Calls $ast "Enter-GateMutex")
$report = [ordered]@{ enterCalls = $enters.Count; libDotSourced = $false; assignedTo = $null; nextIsTry = $false; catchClauses = $null; guardedChecks = @(); unguardedTestChecks = @(); finallyReleasesLease = $false; enterBeforeTestStage = $false }
foreach ($c in (Get-Calls $ast "Join-Path")) {
  if ($c.Extent.Text -notmatch 'lib\\gate-mutex\.ps1') { continue }
  $p = $c.Parent
  while ($p -and $p -isnot [System.Management.Automation.Language.CommandAst]) { $p = $p.Parent }
  if ($p -and $p.InvocationOperator -eq "Dot") { $report.libDotSourced = $true }
}
if ($enters.Count -eq 1) {
  $stmt = $enters[0]
  while ($stmt.Parent -isnot [System.Management.Automation.Language.StatementBlockAst] -and $stmt.Parent -isnot [System.Management.Automation.Language.NamedBlockAst]) { $stmt = $stmt.Parent }
  if ($stmt -is [System.Management.Automation.Language.AssignmentStatementAst]) { $report.assignedTo = $stmt.Left.VariablePath.UserPath }
  $siblings = @($stmt.Parent.Statements)
  $index = [array]::IndexOf($siblings, $stmt)
  $try = if ($index -ge 0 -and $index + 1 -lt $siblings.Count) { $siblings[$index + 1] } else { $null }
  if ($try -is [System.Management.Automation.Language.TryStatementAst]) {
    $report.nextIsTry = $true
    $report.catchClauses = $try.CatchClauses.Count
    $report.guardedChecks = @(Get-Calls $try.Body "Invoke-Check" | ForEach-Object { Get-CheckName $_ })
    if ($try.Finally) {
      foreach ($x in (Get-Calls $try.Finally "Exit-GateMutex")) {
        if ($report.assignedTo -and $x.Extent.Text -match ('-Lease\s+\$' + [regex]::Escape($report.assignedTo) + '\b')) { $report.finallyReleasesLease = $true }
      }
    }
    # Every Invoke-Check that runs the npm test script, or is named like the test stage, must sit
    # inside the guarded try -- a second, unguarded copy would run the suite beside a peer again.
    foreach ($check in (Get-Calls $ast "Invoke-Check")) {
      $isTestStage = ((Get-CheckName $check) -eq "frontend tests") -or ($check.Extent.Text -match '@\(\s*"test"\s*\)')
      if ($isTestStage -and -not (Test-Inside $check $try.Body)) { $report.unguardedTestChecks += (Get-CheckName $check) }
    }
    $firstTest = @(Get-Calls $ast "Invoke-Check" | Where-Object { (Get-CheckName $_) -eq "frontend tests" } | Select-Object -First 1)
    if ($firstTest.Count -eq 1) { $report.enterBeforeTestStage = $stmt.Extent.EndOffset -le $firstTest[0].Extent.StartOffset }
  }
}
"INSPECT " + ($report | ConvertTo-Json -Compress -Depth 4)
if ($InspectOnly) { exit 0 }
if (-not $report.nextIsTry) { throw "probe: no try statement follows Enter-GateMutex" }

. $Lib
$GateMutexName = $MutexName
$GateMutexStateDir = $StateDir
function Write-Gate { param([string]$Text = "") Write-Host $Text }
function Invoke-Check {
  param([string]$Name, [string]$Command, [string[]]$Arguments = @(), [switch]$NodeHosted)
  Write-Host "CHECK-START $Name $(Stamp)"
  Set-Content -LiteralPath $ReadyFile -Value "ready"
  Wait-ForRelease -Path $ReleaseFile
  Write-Host "CHECK-END $Name $(Stamp)"
  if ($Fail) { throw "$Name failed with exit code 1." }
}
$repo = "probe-repo"
$npm = "npm"
"PID $PID"
. ([scriptblock]::Create($stmt.Extent.Text + [Environment]::NewLine + $try.Extent.Text))
"PROBE-DONE $(Stamp)"
`;

// ---------------------------------------------------------------------------------------------------

let driverDir;
const liveChildren = new Set();
const tempRoots = new Set();

beforeAll(() => {
  driverDir = mkdtempSync(join(tmpdir(), "compy-gate-mutex-drivers-"));
  writeFileSync(join(driverDir, "contender.ps1"), CONTENDER, "utf8");
  writeFileSync(join(driverDir, "probe.ps1"), PROBE, "utf8");
  return () => rmSync(driverDir, { recursive: true, force: true });
});

const makeCase = () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "compy-gate-mutex-test-"));
  tempRoots.add(stateRoot);
  return {
    stateRoot,
    stateDir: join(stateRoot, "state"),
    mutexName: `Local\\Compy.Test.${crypto.randomUUID()}`,
    file: (name) => join(stateRoot, name),
  };
};

const start = (script, params) => {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(driverDir, script)];
  for (const [key, value] of Object.entries(params)) {
    if (value === true) args.push(`-${key}`);
    else if (value !== undefined && value !== false) args.push(`-${key}`, String(value));
  }
  const child = spawn(powershell, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.out = "";
  child.err = "";
  child.stdout.on("data", (chunk) => (child.out += chunk));
  child.stderr.on("data", (chunk) => (child.err += chunk));
  child.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout: child.out, stderr: child.err }));
  });
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  return child;
};

const contender = (testCase, extra = {}) =>
  start("contender.ps1", { Lib: lib, MutexName: testCase.mutexName, StateDir: testCase.stateDir, ...extra });

const probe = (testCase, extra = {}) =>
  start("probe.ps1", { VerifyLocal: verifyLocal, Lib: lib, MutexName: testCase.mutexName, StateDir: testCase.stateDir, ...extra });

// Epoch ms of a `LABEL <iso>` line, or null when absent -- an absent stamp must fail the comparison
// it feeds, never read as zero.
const stamp = (stdout, label) => {
  const m = new RegExp("^" + label + " (\\S+)\\s*$", "m").exec(stdout);
  return m ? Date.parse(m[1]) : null;
};
const pidOf = (stdout) => Number(/^PID (\d+)\s*$/m.exec(stdout)?.[1] ?? NaN);

const waitFor = async (predicate, what, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
};

afterEach(async () => {
  await Promise.all([...liveChildren].map(stop));
  for (const path of tempRoots) rmSync(path, { recursive: true, force: true });
  liveChildren.clear();
  tempRoots.clear();
});

// ---------------------------------------------------------------------------------------------------

describe("the test-gate mutex is a distinct, documented name", () => {
  const libText = readFileSync(lib, "utf8");

  it("defaults to Local\\Compy.TestGate.v1, which no mutation guard uses", () => {
    expect(stripPsComments(libText)).toMatch(/^\$GateMutexName\s*=\s*"Local\\Compy\.TestGate\.v1"\s*$/m);
    // Sharing a name with a mutation guard would make every push queue behind a release or an
    // install -- or worse, make a release fail closed because a gate was running.
    const mutationNames = ["release.ps1", "ship-reinstall.ps1"].flatMap((file) =>
      [...readFileSync(join(root, "scripts", file), "utf8").matchAll(/-Name\s+"(Local\\[^"]+)"/g)].map((m) => m[1]),
    );
    expect(mutationNames).toEqual(expect.arrayContaining(["Local\\Compy.ReleasePipeline.v1", "Local\\Compy.InstalledBinary.v1"]));
    expect(mutationNames).not.toContain(PRODUCTION_NAME);
  });

  it("is documented in docs/WORK_CONTROL.md with its wait semantics", () => {
    const doc = readFileSync(workControl, "utf8");
    const section = doc.slice(doc.indexOf("## Windows-session collision guards"));
    // A bullet is its first line plus the two-space-indented lines that continue it.
    const lines = section.split(/\r?\n/);
    const first = lines.findIndex((line) => line.startsWith("- ") && line.includes("Local\\Compy.TestGate.v1"));
    let end = first + 1;
    while (first >= 0 && end < lines.length && /^ {2}\S/.test(lines[end])) end++;
    const bullet = first >= 0 ? lines.slice(first, end).join(" ") : undefined;
    expect(bullet, "WORK_CONTROL.md must name the test-gate mutex in its collision-guards section").toBeTruthy();
    expect(bullet).toContain("verify-local.ps1");
    expect(bullet).toMatch(/\bwaits?\b/i);
  });
});

describe.runIf(process.platform === "win32")("verify-local.ps1 queues its test stage on the gate mutex", () => {
  it("takes the mutex around `npm test` and nothing else, and releases it in finally", async () => {
    const result = await probe(makeCase(), { InspectOnly: true }).done;
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(/^INSPECT (.*)$/m.exec(result.stdout)?.[1] ?? "null");
    expect(report).toMatchObject({
      enterCalls: 1,
      libDotSourced: true,
      nextIsTry: true,
      // A catch here could swallow a red suite and let the push through.
      catchClauses: 0,
      finallyReleasesLease: true,
      enterBeforeTestStage: true,
      unguardedTestChecks: [],
    });
    expect(report.assignedTo).toBeTruthy();
    // Only the suite is serialized: the build and cargo stages stay parallel across lanes.
    expect(report.guardedChecks).toEqual(["frontend tests"]);
  });

  it("makes a second gate WAIT, naming the holder, and admits it only after the first releases", async () => {
    const testCase = makeCase();
    const ready = testCase.file("probe-ready.txt");
    const release = testCase.file("probe-release.txt");
    const gate = probe(testCase, { ReadyFile: ready, ReleaseFile: release });
    await waitFor(() => existsSync(ready), "the gate to reach its test stage");

    const peer = contender(testCase, { Label: "peer lane" });
    await waitFor(() => /TEST GATE: busy/.test(peer.out), "the peer to report the gate busy");
    // Held long enough for a notice: the queue says, again, who it is waiting on.
    await waitFor(() => /TEST GATE: still queued after \d+s/.test(peer.out), "a still-queued notice");
    expect(peer.out).not.toMatch(/^ACQUIRED /m);
    writeFileSync(release, "release", "utf8");

    const [held, waited] = await Promise.all([gate.done, peer.done]);
    expect(held.code, held.stderr).toBe(0);
    expect(waited.code, waited.stderr).toBe(0);

    const gatePid = pidOf(held.stdout);
    expect(held.stdout).toContain(`TEST GATE: acquired '${testCase.mutexName}' (no wait).`);
    expect(held.stdout).toContain(`TEST GATE: released '${testCase.mutexName}'.`);
    expect(waited.stdout).toContain(`held by pid ${gatePid} (verify-local.ps1 in probe-repo)`);
    expect(waited.stdout).toMatch(/TEST GATE: acquired '.*' after \d+s in the queue\./);

    // The premise, proven by both processes' own clocks: the peer asked while the gate's test stage
    // was running, and got the mutex only once that stage had ended.
    const stageStart = stamp(held.stdout, "CHECK-START frontend tests");
    const stageEnd = stamp(held.stdout, "CHECK-END frontend tests");
    const asked = stamp(waited.stdout, "ATTEMPT");
    const admitted = stamp(waited.stdout, "ACQUIRED");
    for (const value of [stageStart, stageEnd, asked, admitted]) expect(value).not.toBeNull();
    expect(asked).toBeGreaterThanOrEqual(stageStart);
    expect(asked).toBeLessThanOrEqual(stageEnd);
    expect(admitted).toBeGreaterThanOrEqual(stageEnd);
  });

  it("still releases the mutex when the test stage fails, and the gate still fails", async () => {
    const testCase = makeCase();
    const ready = testCase.file("probe-ready.txt");
    const release = testCase.file("probe-release.txt");
    const gate = probe(testCase, { ReadyFile: ready, ReleaseFile: release, Fail: true });
    await waitFor(() => existsSync(ready), "the gate to reach its test stage");
    writeFileSync(release, "release", "utf8");
    const result = await gate.done;

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("frontend tests failed with exit code 1.");
    expect(result.stdout).not.toMatch(/^PROBE-DONE /m);
    const end = result.stdout.indexOf("CHECK-END frontend tests");
    const released = result.stdout.indexOf(`TEST GATE: released '${testCase.mutexName}'.`);
    expect(end).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(end);
  });
});

describe.runIf(process.platform === "win32")("the gate mutex library", () => {
  it("gives up after the bounded wait and names the holder, instead of waiting forever or running beside it", async () => {
    const testCase = makeCase();
    const ready = testCase.file("holder-ready.txt");
    const release = testCase.file("holder-release.txt");
    const holder = contender(testCase, { Label: "stuck lane", ReadyFile: ready, ReleaseFile: release });
    await waitFor(() => existsSync(ready), "the holder to acquire");

    const late = await contender(testCase, { TimeoutSeconds: 2 }).done;
    writeFileSync(release, "release", "utf8");
    const held = await holder.done;

    expect(held.code, held.stderr).toBe(0);
    expect(late.code).not.toBe(0);
    expect(late.stdout).not.toMatch(/^ACQUIRED /m);
    expect(late.stdout + late.stderr).toMatch(
      new RegExp(`TEST GATE: gave up after \\d+s waiting for '.*' -- still held by pid ${pidOf(held.stdout)} \\(stuck lane\\)`),
    );
  });

  it("takes over from a holder that died without releasing, rather than deadlocking the queue", async () => {
    const testCase = makeCase();
    const ready = testCase.file("holder-ready.txt");
    const release = testCase.file("holder-release.txt");
    const holder = contender(testCase, { Label: "crashed lane", ReadyFile: ready, ReleaseFile: release });
    await waitFor(() => existsSync(ready) && /^PID \d+/m.test(holder.out), "the holder to acquire");
    const holderPid = pidOf(holder.out);

    const next = contender(testCase, { Label: "next lane" });
    await waitFor(() => /TEST GATE: busy/.test(next.out), "the next lane to queue");
    await stop(holder); // TerminateProcess: the mutex is abandoned, never released
    const result = await next.done;

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`TEST GATE WARN: the previous holder of '${testCase.mutexName}' exited without releasing it (pid ${holderPid} (crashed lane)`);
    expect(result.stdout).toContain("Taking over");
    expect(result.stdout).toMatch(/^ACQUIRED /m);
  });

  it("waits on a holder whose mutex this session cannot open, instead of crashing the gate", async () => {
    const testCase = makeCase();
    const ready = testCase.file("holder-ready.txt");
    const release = testCase.file("holder-release.txt");
    const holder = contender(testCase, { Deny: true, ReadyFile: ready, ReleaseFile: release });
    await waitFor(() => existsSync(ready), "the foreign holder to acquire");

    const next = contender(testCase, { Label: "next lane" });
    await waitFor(() => /TEST GATE: busy/.test(next.out), "the next lane to queue");
    writeFileSync(release, "release", "utf8");
    const [held, result] = await Promise.all([holder.done, next.done]);

    expect(held.code, held.stderr).toBe(0);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("held by a process this session cannot open");
    const admitted = stamp(result.stdout, "ACQUIRED");
    const freed = stamp(held.stdout, "RELEASED");
    expect(admitted).not.toBeNull();
    expect(freed).not.toBeNull();
    expect(admitted).toBeGreaterThanOrEqual(freed);
  });
});
