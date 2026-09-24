// @vitest-environment node
//
// #559 bug->guard: Stop-NativeProcessTree must never count a process as a descendant just because
// its RECORDED parent pid matches. Windows keeps a dead parent's pid in th32ParentProcessID and hands
// that pid to a new process within seconds, so an orphan (explorer.exe, a second claude.exe, every
// MSYS program started by a cygwin-to-cygwin exec) reads as a child of whatever now holds the pid.
// The tree kill then `.Kill()`s it with 0xFFFFFFFF, which Git Bash prints as exit 127.
//
// The scenario is built from a REAL snapshot with one row forged: an OLDER process claims the root
// as its parent, exactly what pid reuse produces. Get-NativeDescendantIds must keep the root's
// genuine child and leave the older impostor out. Against the pre-#559 walk the impostor is returned.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "./lib/windows-only.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every process this harness starts exits by itself within 60s, so a crashed harness leaks nothing
// for long; the finally block kills them sooner, and only after checking each one is still ours.
const LINGER = "setTimeout(() => process.exit(0), 60000);\n";
const PARENT = [
  "const { spawn } = require('child_process');",
  "spawn(process.execPath, [process.argv[2]], { stdio: 'ignore' });",
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
$started = @()
try {
  $old = Start-Node ('"' + $Linger + '"'); $started += $old
  Start-Sleep -Milliseconds 400
  $rootProc = Start-Node ('"' + $Parent + '" "' + $Linger + '"'); $started += $rootProc
  $genuine = $null
  $deadline = (Get-Date).AddSeconds(20)
  while (-not $genuine -and (Get-Date) -lt $deadline) {
    $snap = @(Get-NativeProcessSnapshot)
    $genuine = $snap | Where-Object { $_.ParentProcessId -eq $rootProc.Id -and $_.ExeName -ieq 'node.exe' } | Select-Object -First 1
    if (-not $genuine) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $genuine) { throw 'the root never spawned its genuine child' }
  $started += [System.Diagnostics.Process]::GetProcessById($genuine.ProcessId)
  # The forgery pid reuse produces: the OLDER process records the root as its parent.
  $forged = foreach ($row in $snap) {
    if ($row.ProcessId -eq $old.Id) { [pscustomobject]@{ ProcessId = $row.ProcessId; ParentProcessId = $rootProc.Id; ExeName = $row.ExeName } }
    else { $row }
  }
  $ids = @(Get-NativeDescendantIds -ProcessId $rootProc.Id -Snapshot @($forged))
  "OLD=$($old.Id)"
  "GENUINE=$($genuine.ProcessId)"
  "IDS=$($ids -join ',')"
  'SURVIVED'
} finally {
  foreach ($p in $started) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
}
`;

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

describe.runIf(windows)("tree kill ignores a recycled parent pid (#559)", () => {
  it("keeps the root's genuine child and leaves out an older process that only claims the root as parent", () => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness,
        "-LibPath", join(root, "scripts", "lib", "native-process.ps1"),
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
    const ids = field("IDS").split(",").filter(Boolean);
    expect(ids, out).toContain(field("GENUINE"));
    expect(ids, `an older process was counted as the root's child:\n${out}`).not.toContain(field("OLD"));
  }, 120000);
});
