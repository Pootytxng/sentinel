// @vitest-environment node
//
// #559 bug->guard: the timeout tree kill must never count a process as a descendant because of its
// RECORDED parent pid. Windows keeps a dead parent's pid in th32ParentProcessID and hands that pid to
// a new process within seconds, so an orphan (explorer.exe, a second claude.exe, every MSYS program
// started by a cygwin-to-cygwin exec) reads as a child of whatever now holds the pid. The tree kill
// then `.Kill()`s it with 0xFFFFFFFF, which Git Bash prints as exit 127.
//
// The first fix compared start times. The review of PR #561 found that unsound: start times are
// wall-clock stamps, which can tie, and the system clock can move backward. So the tree is no longer
// inferred at all. The child joins a job object straight after Start(), the kernel adds every process
// it creates to that job, and a timeout terminates the job.
//
// Static half: the kill path reads no parent pid, snapshot, start time or clock, and both timed
// callers attach the child to its job straight after Start(). A clock rollback cannot be staged here
// (the system clock is an owner-held setting), which is why any clock read is forbidden outright.
// Behavioural half: through Invoke-NativeProcess, a timed-out root's DETACHED grandchild dies,
// TreeKill says "tree", and a stranger started beside it survives.
//
// #598 bug->guard: the harness itself judged and killed by pid. Under the full suite it read a freed
// pid, re-issued to a vitest worker, as the grandchild (GRANDCHILD_ALIVE=True, "SURVIVED"), and its
// cleanup killed that worker. The verdict now goes through lib/held-process.ps1, which proves
// identity from the command line of the process holding the pid, and a control stages the reuse:
// the recorded pid names a stranger, which must read as "reused" and must survive.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "./lib/windows-only.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(root, "scripts", "lib", "native-process.ps1");
const heldPath = join(root, "scripts", "lib", "held-process.ps1");

// Every process this harness starts exits by itself within 60s, so a crashed harness leaks nothing
// for long; the finally block kills them sooner.
const LINGER = "setTimeout(() => process.exit(0), 60000);\n";
// detached: true, deliberately. A detached child leaves node's own job, so only OUR job can reach it.
// The grandchild carries the pid file's path in its argv: that path is its identity (#598).
const PARENT = [
  "const { spawn } = require('child_process');",
  "const { writeFileSync } = require('fs');",
  "const c = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: 'ignore' });",
  "c.unref();",
  "writeFileSync(process.argv[3], String(c.pid));",
  "setTimeout(() => process.exit(0), 60000);",
  "",
].join("\n");

// Every process the harness kills is one it holds: those it started (their Process objects keep a
// handle), or one whose identity lib/held-process.ps1 proved through a handle it holds. Never a pid.
const HARNESS = String.raw`
param([string]$LibPath, [string]$HeldPath, [string]$NodeExe, [string]$Linger, [string]$Parent, [string]$PidFile, [string]$Mode)
$ErrorActionPreference = 'Stop'
. $LibPath
. $HeldPath
function Start-Node([string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($psi)
}
$held = @()
$grandchild = 0
$judged = $false
try {
  $stranger = Start-Node @($Linger); $held += $stranger
  if ($Mode -eq 'reuse') {
    # The flake, staged: the recorded pid now belongs to a node process that is not the grandchild.
    # Beside it, a process that IS marked, so a verdict that never says "alive" cannot pass.
    $marked = Start-Node @($Linger, $PidFile); $held += $marked
    "MARKED_STATE=$(Resolve-HeldProcessFate -ProcessId $marked.Id -Marker @($PidFile) -WaitMs 1500)"
    "MARKED_DEAD=$($marked.WaitForExit(5000))"
    "STRANGER_STATE=$(Resolve-HeldProcessFate -ProcessId $stranger.Id -Marker @($PidFile) -WaitMs 1500)"
    "STRANGER_ALIVE=$(-not $stranger.HasExited)"
    'SURVIVED'
    return
  }
  $r = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($Parent, $Linger, $PidFile) -TimeoutMs 4000
  "TIMEDOUT=$($r.TimedOut)"
  "TREEKILL=$($r.TreeKill)"
  $grandchild = [int]((Get-Content -Raw $PidFile).Trim())
  "GRANDCHILD=$grandchild"
  # Gives the job's termination up to 1.5s to land before calling the grandchild a survivor.
  $judged = $true
  "GRANDCHILD_STATE=$(Resolve-HeldProcessFate -ProcessId $grandchild -Marker @($PidFile) -WaitMs 1500)"
  "STRANGER_ALIVE=$(-not $stranger.HasExited)"
  'SURVIVED'
} finally {
  foreach ($p in $held) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
  if ($grandchild -and -not $judged) { [void](Resolve-HeldProcessFate -ProcessId $grandchild -Marker @($PidFile) -WaitMs 0) }
}
`;

// A PowerShell function's CODE, from its declaration to its closing brace in column 0, with
// full-line comments dropped so an explanation of what is gone does not trip the check.
function functionCode(src, name) {
  const start = src.indexOf(`function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}", start);
  expect(end, `${name} is not closed`).toBeGreaterThan(start);
  return src
    .slice(start, end + 2)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

// The C# job helper, with // comments dropped.
function jobHelperCode(src) {
  const open = "$script:NativeProcessJobSource = @'";
  const start = src.indexOf(open);
  expect(start, "the job helper source not found").toBeGreaterThan(-1);
  const end = src.indexOf("\n'@", start);
  expect(end, "the job helper source is not closed").toBeGreaterThan(start);
  return src
    .slice(start + open.length, end)
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const count = (text, needle) => text.split(needle).length - 1;

// What an inferred tree reads: recorded parent pids, a process snapshot, start times or the clock.
const INFERENCE =
  /ParentProcessId|th32ParentProcessID|Toolhelp|Get-NativeProcessSnapshot|Get-NativeDescendantIds|StartTime|CreationDate|CreationTime|Get-Date|DateTime|taskkill|Win32_Process|CimInstance|WmiObject/i;

describe("tree kill proves membership, never ancestry (#559)", () => {
  const src = readFileSync(libPath, "utf8");

  it("reads no parent pid, snapshot, start time or clock on the kill path", () => {
    for (const name of ["Initialize-NativeProcessJob", "Stop-NativeProcessTree"]) {
      const code = functionCode(src, name);
      expect(code.match(INFERENCE)?.[0], `${name} infers the tree:\n${code}`).toBeUndefined();
    }
    const helper = jobHelperCode(src);
    expect(helper.match(INFERENCE)?.[0], `the job helper infers the tree:\n${helper}`).toBeUndefined();
    expect(src).not.toMatch(/^function\s+(Get-NativeDescendantIds|Get-NativeProcessStartTime)\b/m);
  });

  it("gives the job exactly BREAKAWAY_OK, so closing it after a normal exit kills nothing", () => {
    const helper = jobHelperCode(src);
    expect(count(helper, "LimitFlags ="), helper).toBe(1);
    expect(helper).toMatch(/LimitFlags = 0x800;/);
    expect(helper).not.toMatch(/0x2000|KILL_ON_JOB_CLOSE/i);
    // Unnamed and not inheritable: no other process can open it or receive the handle.
    expect(helper).toMatch(/CreateJobObjectW\(IntPtr\.Zero, null\)/);
  });

  it("puts both timed callers' child in its job straight after Start(), and kills through it", () => {
    const attachAfterStart =
      /\$process\.Start\(\)\)\s*\{[^{}]*\}\r?\n\s*if \(\$jobReady\) \{ \$job = \[Compy\.NativeProcessJob\]::Attach\(\$process\.Handle\) \}/g;
    expect(src.match(attachAfterStart)?.length ?? 0).toBe(2);
    expect(count(src, "$jobReady = $KillTreeOnTimeout -and (Initialize-NativeProcessJob)")).toBe(2);
    expect(count(src, "if ($job -ne [IntPtr]::Zero) { [Compy.NativeProcessJob]::Close($job) }")).toBe(2);
    // Every call of the kill passes the caller's own Process object and its job.
    expect(count(src, "Stop-NativeProcessTree -")).toBe(2);
    expect(count(src, "$treeKill = Stop-NativeProcessTree -Process $process -Job $job")).toBe(2);
  });
});

describe("the harness judges a process by its identity, never by its pid (#598)", () => {
  const held = readFileSync(heldPath, "utf8");

  it("looks up and kills nothing by pid, and reads no start time", () => {
    expect(HARNESS.match(/GetProcessById|GetProcesses|Get-Process\b|Stop-Process|taskkill|Win32_Process|StartTime|Get-Date/i)?.[0]).toBeUndefined();
    expect(count(HARNESS, "Resolve-HeldProcessFate -ProcessId $grandchild -Marker @($PidFile)")).toBe(2);
  });

  it("proves identity through one held handle before it waits on or kills anything", () => {
    const code = functionCode(held, "Resolve-HeldProcessFate");
    expect(code.match(INFERENCE)?.[0], code).toBeUndefined();
    expect(code).not.toMatch(/GetProcessById|Stop-Process/i);
    expect(count(code, "[Compy.HeldProcess]::Open(")).toBe(1);
    expect(count(code, "[Compy.HeldProcess]::Kill($handle)")).toBe(1);
    const marker = code.indexOf("foreach ($m in $Marker)");
    expect(marker).toBeGreaterThan(code.indexOf("::CommandLine($handle)"));
    expect(code.indexOf("::Exited($handle, $WaitMs)")).toBeGreaterThan(marker);
    expect(code.indexOf("::Kill($handle)")).toBeGreaterThan(code.indexOf("::Exited($handle, $WaitMs)"));
    // The handle is closed on every path, so it pins the pid only while the verdict is being made.
    expect(code).toMatch(/\} finally \{\s*\[Compy\.HeldProcess\]::Close\(\$handle\)\s*\}/);
  });
});

let dir;
let harness;
let linger;
let parent;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-tree-kill-"));
  harness = join(dir, "harness.ps1");
  linger = join(dir, "linger.js");
  parent = join(dir, "parent.js");
  writeFileSync(harness, HARNESS, "utf8");
  writeFileSync(linger, LINGER, "utf8");
  writeFileSync(parent, PARENT, "utf8");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function runHarness(mode, pidFile) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness,
      "-LibPath", libPath,
      "-HeldPath", heldPath,
      "-NodeExe", process.execPath,
      "-Linger", linger,
      "-Parent", parent,
      "-PidFile", join(dir, pidFile),
      "-Mode", mode,
    ],
    // A hang backstop, not a budget: vitest cannot interrupt a synchronous spawn.
    { encoding: "utf8", windowsHide: true, timeout: 90000 },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  expect(out, out).toContain("SURVIVED");
  const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1]?.trim() ?? "";
  return { out, field };
}

describe.runIf(windows)("tree kill ends the job and nothing else (#559)", () => {
  it("kills a timed-out root's detached grandchild and leaves a stranger running", () => {
    const { out, field } = runHarness("job", "grandchild.pid");
    expect(field("TIMEDOUT"), out).toBe("True");
    expect(field("TREEKILL"), out).toBe("tree");
    expect(Number(field("GRANDCHILD")), out).toBeGreaterThan(0);
    // gone, exited or reused all mean the grandchild no longer exists: a live process keeps its pid.
    expect(["gone", "exited", "reused"], `the job did not reach the detached grandchild:\n${out}`).toContain(
      field("GRANDCHILD_STATE"),
    );
    expect(field("STRANGER_ALIVE"), `a process outside the job was killed:\n${out}`).toBe("True");
  }, 120000);

  // #598: before this guard the harness called a stranger holding the recorded pid "alive" and
  // killed it. The marked control proves the verdict can still say "alive" and kill its own.
  it("reads a recycled pid as reused and leaves its holder running", () => {
    const { out, field } = runHarness("reuse", "reused.pid");
    expect(field("MARKED_STATE"), out).toBe("alive");
    expect(field("MARKED_DEAD"), out).toBe("True");
    expect(field("STRANGER_STATE"), `a stranger holding the pid was read as the grandchild:\n${out}`).toBe("reused");
    expect(field("STRANGER_ALIVE"), `the harness killed a process it does not own:\n${out}`).toBe("True");
  }, 120000);
});
