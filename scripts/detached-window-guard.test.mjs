// A DETACHED launch must not open a console window on the owner's desktop either.
//
// bug->guard, and the second half of a bug the first guard could not see.
//
// 2026-08-11 fixed seven suites that spawned `powershell.exe` without `windowsHide`, and
// `console-window-guard.test.mjs` pinned that shape. The owner reported on 2026-08-20 that a blank
// terminal was STILL flashing, many times an hour, and only while a lane was working — which the
// static guard could not explain, because every spawn it knows how to read was already clean.
//
// Measured at HWND level rather than by process id: a poller keyed on new PIDs saw nothing, because
// Windows Terminal serves a new console as a new WINDOW inside its existing `-Embedding` process, so
// a new-PID detector is structurally blind to the thing being reported. Enumerating top-level
// windows instead caught it immediately, twice per run of `native-process-guard.test.mjs`:
//
//     [WINDOW] 05:24:14.287 hwnd=5440486  pid=16184 WindowsTerminal.exe -Embedding
//     [WINDOW] 05:24:14.706 hwnd=4195384  pid=16600 node.exe ... fake-gh.mjs linger 15000
//
// The cause was `Start-NativeProcess -Detached`. Detached means ShellExecute, .NET throws if
// `CreateNoWindow` is set alongside `UseShellExecute`, and the function therefore DROPPED the
// caller's `-CreateNoWindow` silently on exactly the path that needed it. ShellExecute's equivalent
// knob is nCmdShow, reached through `WindowStyle`, so the switch now lands on whichever mechanism the
// path has.
//
// This file proves the behaviour rather than the source text, because the source text is what was
// already believed to be correct. The second window in the capture above belongs to the CHILD's own
// process id, so the check can be attributed exactly — no diffing of unrelated windows, no race with
// whatever else is on screen.
import { afterAll, describe, expect, it } from "vitest";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const LIB = join(SCRIPTS, "lib", "native-process.ps1");

// A child that outlives the measurement window, so "no window" can never mean "already gone".
const LINGER = `setTimeout(() => {}, 30000);\n`;

// Generous on purpose. Each probe pays for a PowerShell start plus an `Add-Type`, which compiles C#
// at runtime, and both are slow under the load of the full suite running 350 files in parallel. The
// repository default is 15s; the first version of this file inherited it and went red once inside a
// full `npm test` while passing every time on its own. A window guard that fails when the machine is
// busy teaches people to re-run instead of to look.
const PROBE_TIMEOUT_MS = 90_000;

// The probe runs INSIDE PowerShell because the thing under test is a PowerShell function. It reports
// the peak count of visible top-level windows owned by the child's own process id.
//
// The negative control is launched through raw ShellExecute at WindowStyle Minimized rather than
// through Start-NativeProcess without -CreateNoWindow. A minimised window is still WS_VISIBLE, so it
// proves the detector can see a window it is supposed to see — without throwing a console across the
// owner's screen every time the suite runs, which is the exact harm this file exists to end.
const PROBE = `param(
  [Parameter(Mandatory = $true)][string]$LibPath,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$Linger,
  [Parameter(Mandatory = $true)][ValidateSet("hidden", "control")][string]$Mode
)
$ErrorActionPreference = "Stop"
. $LibPath

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CompyWindowProbe {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  public static int VisibleWindowsFor(uint target) {
    int found = 0;
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (IsWindowVisible(h)) {
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == target) found++;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

if ($Mode -eq "hidden") {
  # The launch under test: a console child, detached, asked to be invisible.
  $child = Start-NativeProcess -Command $NodeExe -ArgumentList @($Linger) -Detached -CreateNoWindow
  $processId = $child.Id
} else {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodeExe
  $startInfo.Arguments = '"' + $Linger + '"'
  $startInfo.UseShellExecute = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
  $child = [System.Diagnostics.Process]::Start($startInfo)
  $processId = $child.Id
}

$peak = 0
$deadline = (Get-Date).AddMilliseconds(8000)
while ((Get-Date) -lt $deadline) {
  $seen = [CompyWindowProbe]::VisibleWindowsFor([uint32]$processId)
  if ($seen -gt $peak) { $peak = $seen }
  if ($peak -gt 0) { break }
  if ($child.HasExited) { break }
  Start-Sleep -Milliseconds 40
}

Write-Output ("CHILDPID=" + $processId)
Write-Output ("EXITEDEARLY=" + $child.HasExited)
Write-Output ("VISIBLEWINDOWS=" + $peak)
Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
$child.Dispose()
`;

describe.runIf(windows)(`a detached launch opens no console window ${WINDOWS_ONLY}`, () => {
  const dir = mkdtempSync(join(tmpdir(), "compy-detached-window-"));
  const probePath = join(dir, "probe.ps1");
  const lingerPath = join(dir, "linger.js");
  writeFileSync(probePath, PROBE, "utf8");
  writeFileSync(lingerPath, LINGER, "utf8");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (mode) => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        probePath,
        "-LibPath",
        LIB,
        "-NodeExe",
        process.execPath,
        "-Linger",
        lingerPath,
        "-Mode",
        mode,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 90_000 },
    );
    const stdout = result.stdout ?? "";
    const read = (key) => new RegExp(`^${key}=(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? null;
    return {
      stdout,
      stderr: result.stderr ?? "",
      exitedEarly: read("EXITEDEARLY") === "True",
      windows: Number(read("VISIBLEWINDOWS")),
      childPid: read("CHILDPID"),
    };
  };

  it("sees a window it is supposed to see — otherwise a zero below proves nothing", () => {
    const control = run("control");
    expect(control.stderr, `probe failed:\n${control.stderr}`).not.toMatch(/\S/);
    expect(control.exitedEarly, "the control child died before it could be measured").toBe(false);
    expect(
      control.windows,
      "The detector found no window for a child launched through ShellExecute at WindowStyle\n" +
        "Minimized, which DOES own a visible top-level window. The detector is broken, so the\n" +
        "assertion below would pass for the wrong reason.",
    ).toBeGreaterThan(0);
  }, PROBE_TIMEOUT_MS);

  it("Start-NativeProcess -Detached -CreateNoWindow opens no window for its child", () => {
    const hidden = run("hidden");
    expect(hidden.stderr, `probe failed:\n${hidden.stderr}`).not.toMatch(/\S/);
    expect(hidden.exitedEarly, "the child died before it could be measured").toBe(false);
    expect(
      hidden.windows,
      "A detached console child asked for -CreateNoWindow still owns a visible window (pid " +
        `${hidden.childPid}). Under UseShellExecute .NET refuses CreateNoWindow, so the request has\n` +
        "to be carried as WindowStyle Hidden in Start-NativeProcess — see scripts/lib/native-process.ps1.\n" +
        "Every launch on this path flashes a Windows Terminal window on the owner's desktop.",
    ).toBe(0);
  }, PROBE_TIMEOUT_MS);
});
