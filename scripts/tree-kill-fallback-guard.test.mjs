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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "./lib/windows-only.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(root, "scripts", "lib", "native-process.ps1");

// Every process this harness starts exits by itself within 60s, so a crashed harness leaks nothing
// for long; the finally block kills them sooner, and only after checking each one is still ours.
const LINGER = "setTimeout(() => process.exit(0), 60000);\n";
// detached: true, deliberately. A non-detached child rides libuv's job object, so killing the root
// alone would cascade to it and the "child left alive" check could never see a root-only kill.
const PARENT = [
  "const { spawn } = require('child_process');",
  "spawn(process.execPath, [process.argv[2]], { detached: true, stdio: 'ignore' }).unref();",
  "setTimeout(() => process.exit(0), 60000);",
  "",
].join("\n");

const HARNESS = String.raw`
param([string]$LibPath, [string]$NodeExe, [string]$Linger, [string]$Parent)
$ErrorActionPreference = 'Stop'
. $LibPath
function Start-Node([string]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($psi)
}
function Test-Same([System.Diagnostics.Process]$Proc, [datetime]$Start) {
  try { return ([System.Diagnostics.Process]::GetProcessById($Proc.Id).StartTime -eq $Start) } catch { return $false }
}
$started = @()
try {
  $rootProc = Start-Node ('"' + $Parent + '" "' + $Linger + '"'); $started += $rootProc
  $rootStart = $rootProc.StartTime
  $child = $null
  $deadline = (Get-Date).AddSeconds(20)
  while (-not $child -and (Get-Date) -lt $deadline) {
    $row = @(Get-NativeProcessSnapshot) | Where-Object { $_.ParentProcessId -eq $rootProc.Id -and $_.ExeName -ieq 'node.exe' } | Select-Object -First 1
    if ($row) {
      $p = [System.Diagnostics.Process]::GetProcessById($row.ProcessId)
      if ($p.StartTime -ge $rootStart) { $child = $p }
    }
    if (-not $child) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $child) { throw 'the root never spawned its genuine child' }
  $started += $child
  $childStart = $child.StartTime

  # No -Job: the root was never placed in one, which is the fallback's situation.
  $verdict = Stop-NativeProcessTree -Process $rootProc
  "VERDICT=$verdict"
  "ROOT_DEAD=$($rootProc.WaitForExit(5000))"
  # Give a tree kill time to land before calling the child a survivor.
  Start-Sleep -Milliseconds 1500
  "CHILD_ALIVE=$(Test-Same $child $childStart)"

  $env:COMPY_NATIVE_TREE_KILL_FALLBACK = '1'
  try { $fallback = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($Linger) -TimeoutMs 1500 }
  finally { Remove-Item Env:COMPY_NATIVE_TREE_KILL_FALLBACK -ErrorAction SilentlyContinue }
  "FALLBACK_TIMEDOUT=$($fallback.TimedOut)"
  "FALLBACK_TREEKILL=$($fallback.TreeKill)"
  $normal = Invoke-NativeProcess -Command $NodeExe -ArgumentList @($Linger) -TimeoutMs 1500
  "NORMAL_TREEKILL=$($normal.TreeKill)"
  'SURVIVED'
} finally {
  foreach ($p in $started) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
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

describe.runIf(windows)("tree-kill fallback kills only the root (#562)", () => {
  it("kills the root, leaves its unproven child alone, and reports root-only", () => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness,
        "-LibPath", libPath,
        "-NodeExe", process.execPath,
        "-Linger", linger,
        "-Parent", parent,
      ],
      // A hang backstop, not a budget: vitest cannot interrupt a synchronous spawn.
      { encoding: "utf8", windowsHide: true, timeout: 90000 },
    );
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(out, out).toContain("SURVIVED");
    const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, "m")) ?? [])[1]?.trim() ?? "";
    expect(field("VERDICT"), out).toBe("root-only");
    expect(field("ROOT_DEAD"), out).toBe("True");
    expect(field("CHILD_ALIVE"), `the fallback killed a descendant it could not prove:\n${out}`).toBe("True");
    expect(field("FALLBACK_TIMEDOUT"), out).toBe("True");
    expect(field("FALLBACK_TREEKILL"), out).toBe("root-only");
    expect(field("NORMAL_TREEKILL"), out).toBe("tree");
  }, 120000);
});
