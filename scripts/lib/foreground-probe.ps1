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
  [int]$SettleMs = 2000
)
$ErrorActionPreference = "Stop"

Add-Type -Namespace CompyProbe -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
'@

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
  param([System.Diagnostics.Process]$Target, [double]$Seconds)
  $samples = 0; $owned = 0; $present = 0; $firstMs = -1
  $sawWindow = $false; $sawVisibleWindow = $false
  $before = Get-ForegroundOwner
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
        if ([CompyProbe.Win]::IsWindowVisible($Target.MainWindowHandle) -and -not [CompyProbe.Win]::IsIconic($Target.MainWindowHandle)) {
          $sawVisibleWindow = $true
        }
      }
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  $after = Get-ForegroundOwner
  return [ordered]@{
    samples                = $samples
    foregroundSamples      = $present
    ownedForegroundSamples = $owned
    everTookForeground     = ($owned -gt 0)
    firstForegroundMs      = $firstMs
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

$started = Start-Target -Args $ArgumentList -Grant
$proc = $started.Process
$relaunchProc = $null
try {
  $initial = Measure-Foreground -Target $proc -Seconds $DurationSeconds

  $relaunch = $null
  if ($RelaunchWith -ne "none") {
    $relaunchArgs = if ($RelaunchWith -eq "quiet") { @("--no-activate") } else { @() }
    $relaunchStart = Start-Target -Args $relaunchArgs
    $relaunchProc = $relaunchStart.Process
    # The measurement target stays the FIRST process: the second one exits almost immediately after
    # handing over its argv, and the window that may or may not come forward belongs to the first.
    $relaunch = Measure-Foreground -Target $proc -Seconds $DurationSeconds
    $relaunch.relaunchWith = $RelaunchWith
    $relaunch.relaunchArguments = ($relaunchArgs -join " ")
    $relaunch.relaunchRightsGranted = $relaunchStart.RightsGranted
  }

  [ordered]@{
    filePath        = $FilePath
    arguments       = ($ArgumentList -join " ")
    launchedPid     = $proc.Id
    rightsGranted   = $started.RightsGranted
    initial         = $initial
    relaunch        = $relaunch
  } | ConvertTo-Json -Compress -Depth 6
} finally {
  # Only ever the processes this script started. Killing anything else would be taking over another
  # lane, which docs/WORK_CONTROL.md forbids outright.
  foreach ($p in @($relaunchProc, $proc)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      [void]$p.WaitForExit(5000)
    }
  }
}
