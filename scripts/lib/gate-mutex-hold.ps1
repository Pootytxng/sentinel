# gate-mutex-hold.ps1 - hold the test gate on behalf of a Node process (#543).
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# WHY A SEPARATE PROCESS. Node has no named-mutex API, and scripts/run-vitest.mjs must queue a full
# suite on the same Local\Compy.TestGate.v1 that scripts/verify-local.ps1 holds. So this process takes
# it through the one library the gate uses (gate-mutex.ps1: bounded wait, names the holder, takes over
# an abandoned mutex), prints one line to say it holds it, and keeps it until its stdin closes.
#
# THE PROTOCOL, all of it: stderr carries the library's TEST GATE lines for a person to read; stdout
# carries exactly one line, "GATE-MUTEX-HELD <pid>", once the mutex is owned; the parent releases it
# by closing this process's stdin. A parent that dies closes that pipe too, so a crashed run cannot
# leave the gate held. If this process is itself killed, the mutex is abandoned and the next waiter
# takes it over with a WARN -- the library's own recovery, nothing extra here.
#
# Exit codes: 0 held and released; 3 gave up after the bounded wait (the library said who holds it);
# 4 failed for any other reason before holding it (a TEST GATE WARN line says why; the run goes on).
# Driven by scripts/lib/gate-mutex.mjs; pinned by scripts/run-vitest-gate-guard.test.mjs.

param(
  [string]$Name = "",
  [string]$StateDir = "",
  [string]$Label = "",
  [int]$TimeoutSeconds = 1800,
  [int]$NoticeSeconds = 60
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "gate-mutex.ps1")
if (-not $Name) { $Name = $GateMutexName }
if (-not $StateDir) { $StateDir = $GateMutexStateDir }

# Every line goes to stderr: stdout belongs to the one line the parent is waiting for.
$say = { param($Text) [Console]::Error.WriteLine($Text) }

try {
  $lease = Enter-GateMutex -Name $Name -StateDir $StateDir -Label $Label -TimeoutSeconds $TimeoutSeconds -NoticeSeconds $NoticeSeconds -Say $say
} catch {
  $message = $_.Exception.Message
  # Only the library's bounded-wait give-up is exit 3; it has already said who holds the gate. Any
  # other failure is this helper breaking, not a busy gate, and must not refuse the run as one.
  if ($message -like "TEST GATE: gave up after*") { exit 3 }
  & $say "TEST GATE WARN: the gate holder failed before it held '$Name': $message"
  exit 4
}

try {
  [Console]::Out.WriteLine("GATE-MUTEX-HELD $PID")
  [Console]::Out.Flush()
  # Blocks until the parent closes the pipe, on purpose or by exiting. The mutex is thread-affine:
  # this read runs on the thread that took it, so the release below is legal.
  $null = [Console]::In.ReadToEnd()
} finally {
  Exit-GateMutex -Lease $lease
}
exit 0
