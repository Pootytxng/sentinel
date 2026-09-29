// @vitest-environment node
//
// #562 bug->guard: when the process tree cannot be read (no toolhelp snapshot, no Add-Type, or
// COMPY_NATIVE_TREE_KILL_FALLBACK=1), Stop-NativeProcessTree used to run `taskkill /PID <n> /T /F`.
// taskkill /T walks the OS-recorded parent pids unchecked, so a stranger that inherited a recycled
// parent pid could be killed with 0xFFFFFFFF, which Git Bash prints as exit 127.
//
// With no job object (the helper did not compile, the assignment failed, or
// COMPY_NATIVE_TREE_KILL_FALLBACK=1) the kill now ends the root alone and reports "root-only". This
// guard starts a root with a GENUINE detached child, kills it with no job, and requires: the root
// dies, the child is left alive (nothing proves it is ours, so it must not be touched), the function
// says "root-only", and Invoke-NativeProcess carries that as TreeKill when the fallback is forced.
// The normal path must still say "tree". Against the taskkill fallback the child dies (whenever WMI
// answers) and no verdict is returned; the static half fails regardless of WMI, because a hung WMI
// (dev PC, 2026-09-02) makes taskkill kill nothing and would let the behavioural half pass on the old
// code.
//
// #615 bug->guard: the harness found the child with GetProcessById on a snapshot row and killed it
// through that object, which holds no handle, so a pid freed and re-issued in between named a
// stranger. The child's pid now comes from its parent, its identity from the pid file's path in its
// argv, and lib/held-process.ps1 judges and kills it through one held handle. The reuse control
// points the recorded pid at a stranger, which must read as "reused" and must survive.
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
// detached: true, deliberately. A non-detached child rides libuv's job object, so killing the root
// alone would cascade to it and the "child left alive" check could never see a root-only kill.
// The child carries the pid file's path in its argv: that path is its identity (#615).
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
$stranger = $null
$child = 0
$genuine = 0
$judged = $false
try {
  $stranger = Start-Node @($Linger); $held += $stranger
  $rootProc = Start-Node @($Parent, $Linger, $PidFile); $held += $rootProc
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not $child -and $clock.ElapsedMilliseconds -lt 20000) {
    if (Test-Path -LiteralPath $PidFile) { [void][int]::TryParse((Get-Content -Raw -LiteralPath $PidFile), [ref]$child) }
    if (-not $child) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $child) { throw 'the root never spawned its genuine child' }
  # The red needs this: a tree walk reaches the child only through its recorded parent.
  $row = @(Get-NativeProcessSnapshot) | Where-Object { $_.ProcessId -eq $child } | Select-Object -First 1
  "CHILD_PARENT_IS_ROOT=$([bool]($row -and $row.ParentProcessId -eq $rootProc.Id))"
  if ($Mode -eq 'reuse') {
    # The flake, staged: the recorded pid now belongs to a node process that is not the child.
    $genuine = $child
    $child = $stranger.Id
  }

  # No -Job: the root was never placed in one, which is the fallback's situation.
  $verdict = Stop-NativeProcessTree -Process $rootProc
  "VERDICT=$verdict"
  "ROOT_DEAD=$($rootProc.WaitForExit(5000))"
  # Gives a tree kill up to 1.5s to land before calling the child a survivor; "alive" then kills it.
  $judged = $true
  "CHILD_STATE=$(Resolve-HeldProcessFate -ProcessId $child -Marker @($PidFile) -WaitMs 1500)"

  $env:COMPY_NATIVE_TREE_KILL_FALLBACK = '1'
  try { $fallback = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($Linger) -TimeoutMs 1500 }
  finally { Remove-Item Env:COMPY_NATIVE_TREE_KILL_FALLBACK -ErrorAction SilentlyContinue }
  "FALLBACK_TIMEDOUT=$($fallback.TimedOut)"
  "FALLBACK_TREEKILL=$($fallback.TreeKill)"
  $normal = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($Linger) -TimeoutMs 1500
  "NORMAL_TREEKILL=$($normal.TreeKill)"
  'SURVIVED'
} finally {
  if ($child -and -not $judged) { [void](Resolve-HeldProcessFate -ProcessId $child -Marker @($PidFile) -WaitMs 0) }
  if ($genuine) { [void](Resolve-HeldProcessFate -ProcessId $genuine -Marker @($PidFile) -WaitMs 0) }
  # Read after every cleanup that goes by a recorded pid, so a cleanup that hits the stranger shows.
  if ($stranger) { "STRANGER_ALIVE=$(-not $stranger.HasExited)" }
  foreach ($p in $held) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
}
`;

// The CODE of Stop-NativeProcessTree, from its declaration to the next top-level function, with
// full-line comments dropped so the comment explaining why taskkill is gone does not trip the check.
function stopTreeCode() {
  const src = readFileSync(libPath, "utf8");
  const start = src.indexOf("function Stop-NativeProcessTree");
  expect(start, "Stop-NativeProcessTree not found").toBeGreaterThan(-1);
  const next = src.indexOf("\nfunction ", start + 1);
  return src
    .slice(start, next === -1 ? undefined : next)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

let dir;
let harness;
let linger;
let parent;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-tree-kill-fallback-"));
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

describe("tree-kill fallback walks no unproven tree (#562)", () => {
  it("starts no taskkill and no WMI walk: both follow recorded parent pids unchecked", () => {
    const body = stopTreeCode();
    expect(body).toMatch(/\$Process\.Kill\(\)/);
    expect(body).not.toMatch(/taskkill/i);
    expect(body).not.toMatch(/["'\s]\/T["'\s]/);
    expect(body).not.toMatch(/Win32_Process|CimInstance|WmiObject/i);
  });
});

describe("the harness judges the child by its identity, never by its pid (#615)", () => {
  it("looks up and kills nothing by pid, and reads no start time", () => {
    expect(HARNESS.match(/GetProcessById|GetProcesses|Get-Process\b|Stop-Process|taskkill|StartTime/i)?.[0]).toBeUndefined();
    expect(HARNESS.split("Resolve-HeldProcessFate -ProcessId $child -Marker @($PidFile)").length - 1).toBe(2);
  });
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
  expect(field("CHILD_PARENT_IS_ROOT"), `the child's recorded parent is not the root, so no tree walk could reach it:\n${out}`).toBe("True");
  expect(field("VERDICT"), out).toBe("root-only");
  expect(field("ROOT_DEAD"), out).toBe("True");
  expect(field("FALLBACK_TIMEDOUT"), out).toBe("True");
  expect(field("FALLBACK_TREEKILL"), out).toBe("root-only");
  expect(field("NORMAL_TREEKILL"), out).toBe("tree");
  return { out, field };
}

describe.runIf(windows)("tree-kill fallback kills only the root (#562)", () => {
  it("kills the root, leaves its unproven child alone, and reports root-only", () => {
    const { out, field } = runHarness("child", "child.pid");
    // "alive" means the child outlived the 1.5s wait; the verdict then killed it through its handle.
    expect(field("CHILD_STATE"), `the fallback killed a descendant it could not prove:\n${out}`).toBe("alive");
    expect(field("STRANGER_ALIVE"), out).toBe("True");
  }, 120000);

  // #615: before this guard the harness killed its child through a Process object that holds no
  // handle, so a pid re-issued to a stranger made the stranger the kill's target.
  it("reads a recycled child pid as reused and leaves its holder running", () => {
    const { out, field } = runHarness("reuse", "reused.pid");
    expect(field("CHILD_STATE"), `a stranger holding the pid was read as the child:\n${out}`).toBe("reused");
    expect(field("STRANGER_ALIVE"), `the harness killed a process it does not own:\n${out}`).toBe("True");
  }, 120000);
});
