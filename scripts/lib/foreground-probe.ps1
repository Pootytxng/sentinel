# Foreground probe — launch a process and MEASURE whether it takes the foreground.
#
# Written because the first attempt at Compy's foreground-courtesy fix (PR #100) shipped with a
# static guard that read the source, asserted the right words were present, and passed green while
# the feature did nothing at all. Three separate hand-runs were needed to discover that; one of them
# minimised the owner's running game. A rule about what a WINDOW does can only be proven by watching
# a window.
#
# Emits one line of JSON on stdout. Everything else goes to stderr, so the caller can parse without
# stripping noise. The launched process is ALWAYS killed before this script returns.
#
# -RelaunchWith runs a SECOND launch against the still-live first one, which the single-instance
# plugin absorbs: the new process hands its argv to the live instance and exits. That is the path
# that reaches `tray::show_or_recreate_main`, and it is the one that matters most here, because it
# restores the window through Win32 SetForegroundWindow (via tao's AttachThreadInput dance) rather
# than through a creation-time ShowWindow. That route IGNORES Windows' foreground lock, so it is both
# the likeliest way to steal the owner's screen and the phase that measures the same every time.
#
# The relaunch is deliberately launched WITHOUT the foreground-rights grant below. Measured, with the
# quiet relaunch handler gutted to a literal no-op and rebuilt: the live window still came forward for
# 35 of 37 samples. Under granted rights Windows raises the existing instance itself when a briefly
# live second process exits, so a granted relaunch measures the OS, not Compy. Ungranted -- which is
# what ship-reinstall.ps1 and a double-clicked shortcut actually do -- the two cases separate cleanly:
# quiet 0/50, loud 48/50. Measure the condition production has.
param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [string[]]$ArgumentList = @(),
  [ValidateSet("none", "quiet", "loud")][string]$RelaunchWith = "none",
  [double]$DurationSeconds = 6,
  [int]$IntervalMs = 100,
  [int]$SettleMs = 2000,
  # ISSUE #121: skip the AllowSetForegroundWindow grant for the initial launch. Measured 2026-08-13:
  # when the grant TAKES (input-idle desk), Windows fronts the fresh launch on the launcher's behalf
  # -- at/before the app's first window, against a binary with no activation path left in it. In
  # that context the quiet assertion is unpassable by ANY correct app, so a caller measuring app
  # politeness (not launch-context behaviour) launches ungranted. The steal class this guard exists
  # for -- tao's set_focus, which reaches SetForegroundWindow through AttachThreadInput and raises
  # even where the OS would not -- needs no grant to succeed, so it stays detectable.
  [switch]$NoGrant
)
$ErrorActionPreference = "Stop"

Add-Type -Namespace CompyProbe -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
'@

# ISSUE #121 — the EVENT TRACE. The 100ms poll below can say THAT the launch came forward, never WHAT
# raised it: inside one iteration it reads the foreground first and the window second, so a fresh
# launch fronted by Windows and an in-process raise that beat the first sample read identically
# (the 2026-08-18 split). This hook is the finer instrument that split asked for. On the same clock
# as the poll (0 = the poll's first sample) it records:
#   EVENT_SYSTEM_FOREGROUND  — every foreground change on the desk, whoever owns the window;
#   EVENT_OBJECT_FOCUS       — every keyboard-focus change, with the CLASS and OWNING PROCESS of the
#                              window that took it. That is the attribution: a focus landing on a
#                              `Chrome_WidgetWin_*` window owned by msedgewebview2.exe is the WebView2
#                              runtime, a focus on the tao top-level owned by compy.exe is in-process,
#                              a foreground change with no focus from the launched family at all is
#                              the launcher/OS fronting it;
#   EVENT_OBJECT_CREATE/SHOW/DESTROY — window-level (OBJID_WINDOW) lifecycle for the launched process
#                              and its children, so "the window existed" is an event rather than a
#                              Process.MainWindowHandle heuristic, and its distance to the first
#                              foreground is a measurement;
#   EVENT_SYSTEM_MINIMIZESTART/END — the owner's game being minimised IS the harm, so it is named.
# Out-of-context hooks deliver through the hooking thread's message queue, which is why the poll
# loop below pumps messages instead of sleeping. Events are recorded for EVERY process and filtered
# afterwards: the WebView2 child processes' PIDs do not exist until the launch creates them.
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "foreground-events.cs"))

function Get-ForegroundOwner {
  $hwnd = [CompyProbe.Win]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return $null }
  $procId = 0
  [void][CompyProbe.Win]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  return [pscustomobject]@{ Handle = $hwnd; ProcessId = $procId }
}

# Watch the foreground for a while and report what the target process did with it. Also records
# whether the target has a real visible window: "never took the foreground" is equally true of an app
# that crashed on launch, and that would be a far worse bug passing as a fix.
function Measure-Foreground {
  param([System.Diagnostics.Process]$Target, [double]$Seconds, [CompyProbe.EventHook]$Hook)
  $samples = 0; $owned = 0; $present = 0; $firstMs = -1; $firstWindowMs = -1
  $sawWindow = $false; $sawVisibleWindow = $false
  $before = Get-ForegroundOwner
  # One clock for both instruments: event stamps are relative to this loop's first sample, so an
  # event's `ms` compares directly with firstForegroundMs / firstWindowMs below. Events recorded
  # before this point (during Start-Process) carry negative stamps and are kept.
  $eventsFrom = $Hook.Events.Count
  $Hook.ZeroMs = $Hook.Clock.ElapsedMilliseconds
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
    $samples++
    $owner = Get-ForegroundOwner
    if ($owner) {
      $present++
      if ($owner.ProcessId -eq $Target.Id) {
        $owned++
        if ($firstMs -lt 0) { $firstMs = [int]$sw.Elapsed.TotalMilliseconds }
      }
    }
    if (-not $Target.HasExited) {
      $Target.Refresh()
      if ($Target.MainWindowHandle -ne [IntPtr]::Zero) {
        $sawWindow = $true
        if ($firstWindowMs -lt 0) { $firstWindowMs = [int]$sw.Elapsed.TotalMilliseconds }
        if ([CompyProbe.Win]::IsWindowVisible($Target.MainWindowHandle) -and -not [CompyProbe.Win]::IsIconic($Target.MainWindowHandle)) {
          $sawVisibleWindow = $true
        }
      }
    }
    # Pump instead of sleep: out-of-context WinEvents are delivered through this thread's message
    # queue, and pumping stamps each one when it ARRIVES rather than at the next 100ms boundary.
    $Hook.Pump($IntervalMs)
  }
  $after = Get-ForegroundOwner
  return [ordered]@{
    # Half-open index range into the hook's event list for THIS measurement; resolved to names and
    # filtered to the launched family once the process tree is known (see Resolve-Trace).
    eventsFrom             = $eventsFrom
    eventsTo               = $Hook.Events.Count
    samples                = $samples
    foregroundSamples      = $present
    ownedForegroundSamples = $owned
    everTookForeground     = ($owned -gt 0)
    firstForegroundMs      = $firstMs
    # When the target FIRST had a main window, on the same sampling clock as firstForegroundMs.
    # COMPARE THESE ONLY WITH A MARGIN OF ONE $IntervalMs. Within a single iteration the foreground
    # is read first and the window second, with a Process.Refresh() (slow, heuristic) in between, so
    # a few-ms "foreground first" lead is this loop's own ordering, not the machine's. A gap larger
    # than one interval is real: that is a raise well after the window existed. Anything smaller
    # cannot tell an in-process raise apart from Windows fronting a fresh launch (issue #121) -- an
    # earlier reader of this field claimed it could, and was wrong (corrected 2026-08-18).
    firstWindowMs          = $firstWindowMs
    sawWindow              = $sawWindow
    sawVisibleWindow       = $sawVisibleWindow
    exited                 = $Target.HasExited
    exitCode               = $(if ($Target.HasExited) { $Target.ExitCode } else { $null })
    foregroundPidBefore    = $(if ($before) { $before.ProcessId } else { $null })
    foregroundPidAfter     = $(if ($after) { $after.ProcessId } else { $null })
  }
}

function Start-Target {
  param([string[]]$Args, [switch]$Grant)
  # GRANT the launch permission to come forward -- INITIAL launch only (see the -RelaunchWith note).
  # Windows refuses SetForegroundWindow from a process that has not earned foreground rights, and a
  # probe run from a hidden shell often has not. Left alone, a quiet launch could pass for the wrong
  # reason ("it couldn't") rather than the right one ("it chose not to"). ASFW_ANY (-1) permits; it
  # never forces. The grant itself can be refused -- the result records whether it took, so a caller
  # can tell a strict measurement from a lenient one.
  $granted = if ($Grant) { [CompyProbe.Win]::AllowSetForegroundWindow(-1) } else { $false }
  # Start-Process's -ArgumentList is ValidateNotNullOrEmpty, so an argument-free launch must omit the
  # parameter rather than pass @(). Splatting keeps the two cases one call.
  $launch = @{ FilePath = $FilePath; PassThru = $true }
  if ($Args -and $Args.Count -gt 0) { $launch.ArgumentList = $Args }
  return [pscustomobject]@{ Process = (Start-Process @launch); RightsGranted = $granted }
}

# The launched process and everything it spawned (WebView2's browser/GPU/renderer processes are
# children of compy.exe). Snapshotted BEFORE the kill, while the tree still exists.
function Get-ProcessFamily {
  param([int]$RootPid)
  $byParent = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId) {
    if (-not $byParent.ContainsKey([int]$p.ParentProcessId)) { $byParent[[int]$p.ParentProcessId] = New-Object System.Collections.ArrayList }
    [void]$byParent[[int]$p.ParentProcessId].Add([int]$p.ProcessId)
  }
  $family = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $cur = $queue.Dequeue()
    if ($family.Contains($cur)) { continue }
    [void]$family.Add($cur)
    if ($byParent.ContainsKey($cur)) { foreach ($c in $byParent[$cur]) { $queue.Enqueue($c) } }
  }
  return @($family)
}

# Turn one measurement's slice of the raw event list into the trace the caller sees: process names
# resolved, every foreground/focus/minimise event kept (whoever owns it -- the window that LOST the
# foreground matters as much as the one that took it), and window lifecycle kept only for the
# launched family. Raw events are unfiltered by PID on purpose (the children do not exist when the
# hook starts), so this is where the noise goes.
function Resolve-Trace {
  param([CompyProbe.EventHook]$Hook, [System.Collections.IDictionary]$Measurement, [int[]]$Family, [hashtable]$Names, [int]$Limit = 400)
  $familySet = @{}; foreach ($f in $Family) { $familySet[$f] = $true }
  $out = New-Object System.Collections.ArrayList
  $kept = 0; $total = 0
  for ($i = $Measurement.eventsFrom; $i -lt $Measurement.eventsTo; $i++) {
    $e = $Hook.Events[$i]
    $inFamily = $familySet.ContainsKey($e.pid) -or $familySet.ContainsKey($e.rootPid)
    $lifecycle = ($e.kind -eq "CREATE" -or $e.kind -eq "SHOW" -or $e.kind -eq "0x8001")
    if ($lifecycle -and -not $inFamily) { continue }
    $total++
    if ($kept -ge $Limit) { continue }
    $kept++
    [void]$out.Add([ordered]@{
      ms      = $e.ms
      kind    = $(if ($e.kind -eq "0x8001") { "DESTROY" } else { $e.kind })
      hwnd    = ("0x{0:X}" -f $e.hwnd)
      pid     = $e.pid
      proc    = $(if ($Names.ContainsKey($e.pid)) { $Names[$e.pid] } else { $null })
      family  = $inFamily
      cls     = $e.cls
      title   = $e.title
      root    = ("0x{0:X}" -f $e.root)
      rootPid = $e.rootPid
      fgPid   = $(if ($e.kind -eq "FOREGROUND") { $e.fgPid } else { $null })
    })
  }
  $Measurement.Remove("eventsFrom"); $Measurement.Remove("eventsTo")
  $Measurement.events = @($out)
  $Measurement.eventsKept = $kept
  $Measurement.eventsTotal = $total
  $Measurement.eventsDroppedAtCap = $Hook.Dropped
}

$processName = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)

# A launch cannot be measured against a lock holder: the single-instance plugin makes the second
# process hand its argv to the live one and exit, so what we would time is somebody else's window.
# Refuse loudly rather than emit a result that means something different from what it says.
$existing = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
  throw "REFUSING TO MEASURE: $($existing.Count) instance(s) of $processName are already running (PIDs $($existing.Id -join ', ')). A second launch would be absorbed by the single-instance lock and the measurement would describe the OLD window."
}

# Settle before measuring. Windows applies a foreground LOCK for a short window after the active
# window changes, and killing a process at the end of a previous measurement is such a change.
# Measured: two back-to-back probes, and the second could not take the foreground even when it was
# explicitly asked to — which reads as "the fix works" when nothing was proven at all.
Start-Sleep -Milliseconds $SettleMs

# The hook goes up BEFORE the launch so the very first CREATE of the launched process is on record.
$hook = New-Object CompyProbe.EventHook
$hook.Start()
$hook.ZeroMs = $hook.Clock.ElapsedMilliseconds

$started = Start-Target -Args $ArgumentList -Grant:(-not $NoGrant)
$proc = $started.Process
$relaunchProc = $null
try {
  $initial = Measure-Foreground -Target $proc -Seconds $DurationSeconds -Hook $hook

  $relaunch = $null
  if ($RelaunchWith -ne "none") {
    $relaunchArgs = if ($RelaunchWith -eq "quiet") { @("--no-activate") } else { @() }
    $relaunchStart = Start-Target -Args $relaunchArgs
    $relaunchProc = $relaunchStart.Process
    # The measurement target stays the FIRST process: the second one exits almost immediately after
    # handing over its argv, and the window that may or may not come forward belongs to the first.
    $relaunch = Measure-Foreground -Target $proc -Seconds $DurationSeconds -Hook $hook
    $relaunch.relaunchWith = $RelaunchWith
    $relaunch.relaunchArguments = ($relaunchArgs -join " ")
    $relaunch.relaunchRightsGranted = $relaunchStart.RightsGranted
  }

  # Resolve the trace while the launched tree is still alive: names and the parent chain vanish
  # with the kill in `finally`.
  $hook.Dispose()
  $family = @(Get-ProcessFamily -RootPid $proc.Id)
  if ($relaunchProc) { $family += @(Get-ProcessFamily -RootPid $relaunchProc.Id) }
  $names = @{}
  foreach ($p in Get-Process) { $names[[int]$p.Id] = $p.ProcessName }
  Resolve-Trace -Hook $hook -Measurement $initial -Family $family -Names $names
  if ($relaunch) { Resolve-Trace -Hook $hook -Measurement $relaunch -Family $family -Names $names }

  [ordered]@{
    filePath        = $FilePath
    arguments       = ($ArgumentList -join " ")
    launchedPid     = $proc.Id
    familyPids      = $family
    rightsGranted   = $started.RightsGranted
    initial         = $initial
    relaunch        = $relaunch
  } | ConvertTo-Json -Compress -Depth 8
} finally {
  $hook.Dispose()
  # Only ever the processes this script started. Killing anything else would be taking over another
  # lane, which docs/WORK_CONTROL.md forbids outright.
  foreach ($p in @($relaunchProc, $proc)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      [void]$p.WaitForExit(5000)
    }
  }
}
