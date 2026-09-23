# gate-mutex.ps1 - one gate's heavy stages at a time in this Windows session (#522).
# ASCII only for Windows PowerShell 5.1 compatibility.
#
# WHY. Every lane's pre-push gate runs `npm test`, and each `npm test` starts a full vitest pool of
# about one worker per core. Two or three gates at once oversubscribe the machine two to three times
# over, and whichever tests are slowest at that moment cross vitest's 15s testTimeout. Measured from
# the fleet's own gate logs on 2026-09-23 (110 runs since 2026-09-01): a gate whose `npm test` ran
# alone took a median 138s; with two peer gates in its window, a median 259s, and on 2026-09-23 at
# 10:59-11:01Z three concurrent gates took 881-964s each and ALL THREE failed on 28-37 timeouts.
# The failing tests rotate with the load, so fixing tests one at a time never converges. Queueing
# does: a gate that waits two minutes for a peer beats three gates that each fail after fifteen.
#
# WHAT IT HOLDS. `scripts/verify-local.ps1` holds this from `npm test` through the build, cargo test
# and clippy stages. The first cut held `npm test` alone, and that SCHEDULED the collision it was
# meant to stop: a queued gate is admitted the moment the holder's suite ends, which is exactly when
# the holder starts compiling. On 2026-09-23 at 13:14Z the holder passed 457/457 files alone, then
# the queued gate's suite ran beside its build and cargo stages (a 2m20s test-profile compile) and
# lost 6 tests to the 15s limit at 15.0-17.6s each. The cheap stages before the lock (diff check,
# scope drift) still run in parallel; the queue costs each extra lane one whole gate of waiting.
#
# HOW IT DIFFERS FROM Local\Compy.ReleasePipeline.v1 AND Local\Compy.InstalledBinary.v1
# (scripts/lib/process-mutex.ps1). Those guard mutations, so a second process fails at once and a
# crashed holder leaves recovery-required state for a person to inspect. This one guards a
# READ-ONLY proof, so a second gate WAITS (bounded, naming the holder), and a holder that died
# without releasing is simply taken over: there is nothing it held that could need recovery.
#
# Pinned by scripts/gate-mutex-guard.test.mjs against real processes; documented in
# docs/WORK_CONTROL.md "Windows-session collision guards".

$GateMutexName = "Local\Compy.TestGate.v1"

# Who holds the gate, for the NEXT waiter's message only. Informational: nothing trusts it, and a
# missing or stale note never blocks or frees anything -- the mutex alone decides.
$GateMutexStateDir = Join-Path ([System.IO.Path]::GetTempPath()) "compy-test-gate"

function Get-GateMutexNotePath {
  param([string]$Name, [string]$StateDir)
  $leaf = ($Name -replace '^(Local|Global)\\', '') -replace '[\\/:*?"<>|]', '_'
  return (Join-Path $StateDir "$leaf.holder.json")
}

function Get-GateMutexHolderText {
  param([string]$NotePath, [switch]$Previous)
  $note = $null
  try {
    if (Test-Path -LiteralPath $NotePath -PathType Leaf) {
      $note = [System.IO.File]::ReadAllText($NotePath) | ConvertFrom-Json
    }
  } catch { $note = $null }
  if ($null -eq $note -or -not $note.pid) { return "a holder that left no note" }

  $text = "pid $($note.pid)"
  if ($note.label) { $text += " ($($note.label))" }
  try {
    # PowerShell 7's ConvertFrom-Json has already turned the ISO string into a UTC DateTime, and [string]
    # on that drops the Z, so Parse would read it as local time (#529). Take a DateTime as it is; parse a
    # string (Windows PowerShell 5.1 leaves it one) round-trip.
    $since = if ($note.since -is [DateTime]) { $note.since } else {
      [DateTime]::Parse([string]$note.since, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    }
    $since = $since.ToUniversalTime()
    $age = [int]([DateTime]::UtcNow - $since).TotalSeconds
    $text += ", since $($since.ToString('HH:mm:ss'))Z (${age}s)"
  } catch { }
  if (-not $Previous -and -not (Get-Process -Id ([int]$note.pid) -ErrorAction SilentlyContinue)) {
    $text += " -- that pid has exited, so the note is stale and the real holder left none"
  }
  return $text
}

# Acquire the gate. Returns a lease for Exit-GateMutex. Waits while another process holds it, says
# who that is when the wait starts and every NoticeSeconds after, and throws after TimeoutSeconds.
#
# TimeoutSeconds is 30 minutes because a holder can legitimately take that long: the slowest
# `npm test` in the measured logs ran 1111s under load, and a queue of three normal ones is ~7 min.
# Past that, the holder is stuck rather than slow, and the gate says which process to look at
# instead of waiting forever or running beside it.
function Enter-GateMutex {
  param(
    [string]$Name = $GateMutexName,
    [string]$StateDir = $GateMutexStateDir,
    [string]$Label = "",
    [int]$TimeoutSeconds = 1800,
    [int]$NoticeSeconds = 60,
    # Every call discards what Say returns: a Say that writes to the pipeline would otherwise be
    # returned alongside the lease and break Exit-GateMutex.
    [scriptblock]$Say = { param($Text) Write-Host $Text }
  )

  $notePath = Get-GateMutexNotePath -Name $Name -StateDir $StateDir
  $started = [DateTime]::UtcNow
  $deadline = $started.AddSeconds($TimeoutSeconds)
  $mutex = $null
  $owned = $false
  $tookOver = $false
  $queued = $false
  $lastNotice = $started

  while ($true) {
    if ($null -eq $mutex) {
      try {
        $mutex = [System.Threading.Mutex]::new($false, $Name)
      } catch [System.UnauthorizedAccessException] {
        # The gate exists but was created under a token this process may not open (an elevated
        # lane, say). It is still a holder: wait for it to go away rather than crash the gate.
        $mutex = $null
      }
    }

    # The first look never waits, so a busy gate is announced at once. After that a handle waits
    # until the next notice is due; without a handle there is nothing to wait ON, so re-look every 2s.
    $remainingMs = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    $sliceMs = 0
    if ($queued) {
      $sliceMs = if ($null -ne $mutex) { [Math]::Min($NoticeSeconds * 1000, $remainingMs) } else { [Math]::Min(2000, $remainingMs) }
    }
    if ($null -ne $mutex) {
      try {
        $owned = $mutex.WaitOne($sliceMs)
      } catch [System.Threading.AbandonedMutexException] {
        # The kernel hands ownership to this thread when it reports the previous owner died.
        $owned = $true
        $tookOver = $true
      }
    } elseif ($sliceMs -gt 0) {
      [System.Threading.Thread]::Sleep($sliceMs)
    }
    if ($owned) { break }

    $now = [DateTime]::UtcNow
    $waited = [int]($now - $started).TotalSeconds
    $holder = if ($null -eq $mutex) { "a process this session cannot open" } else { Get-GateMutexHolderText -NotePath $notePath }
    if ($now -ge $deadline) {
      if ($null -ne $mutex) { $mutex.Dispose() }
      $gaveUp = "TEST GATE: gave up after ${waited}s waiting for '$Name' -- still held by $holder. A test run does not take this long; if that process is not a gate still making progress (its folder's logs\verify-local-*.log stops growing), stop it and push again."
      $null = & $Say $gaveUp
      throw $gaveUp
    }
    if (-not $queued) {
      $null = & $Say "TEST GATE: busy -- '$Name' is held by $holder. Queued rather than running a second gate's suite and builds beside it (#522); waiting up to ${TimeoutSeconds}s."
      $queued = $true
    } elseif (($now - $lastNotice).TotalSeconds -ge $NoticeSeconds) {
      $null = & $Say "TEST GATE: still queued after ${waited}s -- held by $holder."
      $lastNotice = $now
    }
  }

  $waitedSeconds = [int]([DateTime]::UtcNow - $started).TotalSeconds
  if ($tookOver) {
    $null = & $Say "TEST GATE WARN: the previous holder of '$Name' exited without releasing it ($(Get-GateMutexHolderText -NotePath $notePath -Previous)). Taking over: the gate is a read-only proof, so nothing it held needs recovery."
  }
  if ($queued) {
    $null = & $Say "TEST GATE: acquired '$Name' after ${waitedSeconds}s in the queue."
  } else {
    $null = & $Say "TEST GATE: acquired '$Name' (no wait)."
  }

  # A note that cannot be written costs the next waiter a name, never this run its gate.
  try {
    if (-not (Test-Path -LiteralPath $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
    $note = [ordered]@{ pid = $PID; label = $Label; since = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($notePath, $note, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }

  return [pscustomobject]@{ Mutex = $mutex; Name = $Name; NotePath = $notePath; WaitedSeconds = $waitedSeconds; TookOver = $tookOver; Say = $Say }
}

# Release the gate. Never throws: it runs in a finally, and a failure here must not replace the
# verdict of the check it guarded. Process exit releases the mutex regardless.
function Exit-GateMutex {
  param($Lease)
  if ($null -eq $Lease -or $null -eq $Lease.Mutex) { return }
  try {
    $note = [System.IO.File]::ReadAllText($Lease.NotePath) | ConvertFrom-Json
    if ([int]$note.pid -eq $PID) { Remove-Item -LiteralPath $Lease.NotePath -Force -ErrorAction SilentlyContinue }
  } catch { }
  try {
    $Lease.Mutex.ReleaseMutex()
    $null = & $Lease.Say "TEST GATE: released '$($Lease.Name)'."
  } catch {
    $null = & $Lease.Say "TEST GATE WARN: could not release '$($Lease.Name)' ($($_.Exception.Message)); process exit releases it."
  } finally {
    $Lease.Mutex.Dispose()
  }
}
