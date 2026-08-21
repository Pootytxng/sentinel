#!/usr/bin/env node
// Is the owner's Compy running with a remote-debugging port open right now?
//
// Every self-review relaunches the INSTALLED app with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port so it can read computed styles and
// capture natively. Nothing ever told it to put the app back. Found 2026-08-21, after the ambient-
// backdrop review: the owner's installed Compy was left running with 127.0.0.1:9333 listening and
// three WebView2 processes carrying the flag. Localhost-only, but it is an unattended debug surface
// on his desk that nobody chose, and it survives until he reboots or someone notices.
//
// scripts/q7-probe.mjs already has a `restore` subcommand and uses it. The self-reviewer had no
// equivalent, so this is the check it must now run and quote before its verdict (rubric item 11 in
// .claude/agents/self-reviewer.md).
//
// Deliberately NOT wired into scripts/verify-local.ps1: a probe or a review legitimately holds a
// port open while it works, and failing the push gate mid-measurement would be worse than the thing
// it guards. This is a teardown check, run at the end of the thing that opened the port.
//
//   node scripts/no-debug-port.mjs          -> exit 0 clean, exit 1 with the offenders named
//   node scripts/no-debug-port.mjs --json   -> machine-readable, same exit codes
//
// Windows-only, like the app.

import { execFileSync } from "node:child_process";

const PS = [
  "$names = 'compy','msedgewebview2'",
  "$procs = Get-Process -Name $names -ErrorAction SilentlyContinue",
  "$ids = @($procs | ForEach-Object { $_.Id })",
  "$flagged = @()",
  "if ($ids.Count -gt 0) {",
  "  $flagged = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
  "    Where-Object { $names -contains $_.Name.Replace('.exe','') -and $_.CommandLine -match 'remote-debugging' } |",
  "    ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name } })",
  "}",
  "$ports = @()",
  "if ($ids.Count -gt 0) {",
  "  $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
  "    Where-Object { $ids -contains $_.OwningProcess } |",
  "    ForEach-Object { [pscustomobject]@{ port = $_.LocalPort; pid = $_.OwningProcess; address = $_.LocalAddress } })",
  "}",
  "$env = @('Process','User','Machine') | ForEach-Object {",
  "  $v = [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $_)",
  "  if ($v) { [pscustomobject]@{ scope = $_; value = $v } }",
  "}",
  "@{ running = $ids.Count; flagged = @($flagged); ports = @($ports); env = @($env) } | ConvertTo-Json -Depth 4 -Compress",
  // Joined with newlines, NOT "; " -- a semicolon after a trailing pipe makes an empty pipe element
  // and PowerShell refuses to parse the whole command.
].join("\n");

let raw;
try {
  raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], {
    encoding: "utf8",
    // windowsHide: this runs while the owner is at his desk; without it every check flashes a
    // console window at him. scripts/console-window-guard.test.mjs enforces it repo-wide.
    windowsHide: true,
  });
} catch (err) {
  console.error(`no-debug-port: could not query the machine — ${err.message}`);
  process.exit(2);
}

const state = JSON.parse(raw.trim() || "{}");
const flagged = state.flagged ?? [];
const ports = state.ports ?? [];
const env = state.env ?? [];

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...state, clean: !flagged.length && !ports.length && !env.length }, null, 2));
}

const problems = [];
for (const p of flagged) problems.push(`${p.name} pid ${p.pid} was launched with --remote-debugging`);
for (const p of ports) problems.push(`pid ${p.pid} is LISTENING on ${p.address}:${p.port}`);
for (const e of env) {
  problems.push(
    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set at ${e.scope} scope (${e.value}) — every future ` +
      `launch inherits it, not just this one`,
  );
}

if (!problems.length) {
  const n = state.running ?? 0;
  console.log(
    `no-debug-port: CLEAN — ${n} compy/WebView2 process(es) live, none carrying --remote-debugging, ` +
      `none listening, and the env var is unset at Process, User and Machine scope.`,
  );
  process.exit(0);
}

console.error("no-debug-port: OPEN DEBUG SURFACE on the owner's machine");
for (const p of problems) console.error(`  - ${p}`);
console.error(
  "\nPut it back before claiming done: stop compy, clear the env var at every scope it is set on, " +
    "and relaunch %LOCALAPPDATA%\\Compy\\compy.exe plainly. Then re-run this check and quote it.",
);
process.exit(1);
