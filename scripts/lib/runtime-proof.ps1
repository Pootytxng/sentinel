# runtime-proof.ps1 - the release runtime proof, isolated so it can be exercised by tests.
#
# ASCII ONLY. Windows PowerShell 5.1 decodes a BOM-less file as ANSI, so keeping every byte in this
# file ASCII means it needs no BOM and no character in it can ever mojibake. (ship-reinstall.ps1
# carries non-ASCII text and therefore carries a BOM; see its header and version-drift-guard Guard C.)
#
# bug->guard (failed v0.9.9 publish, 2026-07-27):
#   The proof invoked the CDP probe as a PowerShell NATIVE command:
#       $probeText = (& node $probeScript $debugPort stamp 2>$null | Out-String).Trim()
#   With $ErrorActionPreference = "Stop", Windows PowerShell 5.1 turns ANY native-command stderr
#   output into a TERMINATING NativeCommandError, and `2>$null` does not prevent it. A freshly
#   installed app always needs a moment before it serves CDP, so the very first probe always wrote
#   an ECONNREFUSED line to stderr - which killed the release on iteration 1 of a retry loop that
#   existed precisely to tolerate that. The publish failed closed (nothing was pushed or uploaded)
#   but could not complete.
#
# The repair is not to suppress errors. It is to stop treating the probe as a native command at all:
# Invoke-CapturedProcess runs it through System.Diagnostics.Process with both streams redirected, so
# stdout, stderr and the exit code come back as DATA. An unsuccessful attempt is then an ordinary
# value the retry loop inspects, while every real proof failure still THROWS immediately:
#   * the installed app exited                      -> RUNTIME PROOF FAILED (exit ...)
#   * the app answers with a different build stamp  -> RUNTIME STAMP MISMATCH
#   * the mounted shell shows a different version   -> RUNTIME VERSION MISMATCH
#   * no valid answer before the deadline           -> RUNTIME PROOF FAILED (deadline)
#
# An INCOMPLETE answer (the probe's own "ERR:" marker, or a shell that has not mounted its version
# yet) is not a mismatch and is not an answer either - it is a retryable attempt, and the deadline
# still fails the proof if it never becomes a real answer. Nothing about what the proof PROVES is
# relaxed: success still requires the exact expected stamp plus the expected version, from a live
# process, within the deadline.

# Windows CommandLineToArgvW quoting. .NET Framework (PowerShell 5.1) has no
# ProcessStartInfo.ArgumentList, so the argument string is built explicitly rather than by
# string-joining and hoping no path contains a space.
function ConvertTo-NativeArgumentString {
  param([string[]]$ArgumentList = @())
  $parts = @()
  foreach ($argument in $ArgumentList) {
    if ($null -eq $argument) { continue }
    if ($argument.Length -gt 0 -and $argument -notmatch '[\s"]') {
      $parts += $argument
      continue
    }
    # Backslashes are literal unless they precede a quote, where they must be doubled.
    $escaped = [regex]::Replace($argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    $parts += '"' + $escaped + '"'
  }
  return ($parts -join ' ')
}

function Get-FirstNonEmptyLine {
  param([string]$Text)
  if (-not $Text) { return "" }
  foreach ($line in ($Text -split "`r?`n")) {
    if ($line.Trim()) { return $line.Trim() }
  }
  return ""
}

# Runs a native executable and returns its stdout, stderr and exit code as DATA. Never raises a
# NativeCommandError, because the child is never a PowerShell native command. A child that outlives
# TimeoutMs is killed and reported as TimedOut.
function Invoke-CapturedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 20000,
    [int]$DrainMs = 5000
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = ConvertTo-NativeArgumentString $ArgumentList
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  # The probe emits UTF-8 and the build stamp carries U+00B7. Decoding its output with the console
  # code page would corrupt the exact string this proof compares, i.e. invent a mismatch.
  $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $stdout = ""
  $stderr = ""
  $exitCode = -1
  $timedOut = $false
  try {
    if (-not $process.Start()) { throw "Could not start '$FilePath'." }
    $process.StandardInput.Close()
    # Read both pipes concurrently: reading one to the end while the other fills can deadlock.
    $outReader = $process.StandardOutput.ReadToEndAsync()
    $errReader = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMs)) {
      $timedOut = $true
      try { $process.Kill() } catch { }
      $process.WaitForExit($DrainMs) | Out-Null
    }
    # Bounded drain: a killed child must not hang the caller, and a faulted reader is reported as
    # empty output for THIS attempt rather than crashing it.
    try { if ($outReader.Wait($DrainMs)) { $stdout = $outReader.Result } } catch { $stdout = "" }
    try { if ($errReader.Wait($DrainMs)) { $stderr = $errReader.Result } } catch { $stderr = "" }
    if ($process.HasExited) { $exitCode = $process.ExitCode }
  } finally {
    $process.Dispose()
  }

  return [pscustomobject]@{
    FilePath  = $FilePath
    Arguments = $startInfo.Arguments
    ExitCode  = $exitCode
    StdOut    = $stdout
    StdErr    = $stderr
    TimedOut  = $timedOut
  }
}

# The proof itself. Polls the CDP probe until the LIVE process answers with the exact expected build
# stamp and a shell showing the expected version, or throws.
function Invoke-CompyRuntimeProof {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$LaunchedProcess,
    [Parameter(Mandatory = $true)][string]$ProbeFilePath,
    [Parameter(Mandatory = $true)][string[]]$ProbeArgumentList,
    [Parameter(Mandatory = $true)][string]$ExpectedStamp,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [int]$TimeoutSeconds = 60,
    [int]$ProbeTimeoutMs = 20000,
    [int]$RetryDelayMs = 500
  )

  $attempts = 0
  $transientFailures = 0
  $lastFailure = "no probe attempt completed"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ($true) {
    if ($LaunchedProcess.HasExited) {
      throw "RUNTIME PROOF FAILED: installed Compy exited before its main window became healthy (exit $($LaunchedProcess.ExitCode))."
    }

    $attempts += 1
    $result = Invoke-CapturedProcess -FilePath $ProbeFilePath -ArgumentList $ProbeArgumentList -TimeoutMs $ProbeTimeoutMs
    $payload = $null

    if ($result.TimedOut) {
      $lastFailure = "probe did not return within $ProbeTimeoutMs ms"
    } elseif ($result.ExitCode -ne 0) {
      # EXPECTED while the app is still starting: the debugging port is not listening yet, so the
      # probe exits nonzero after writing to stderr. An unsuccessful ATTEMPT, not a failed proof.
      $lastFailure = "probe exit $($result.ExitCode): " + (Get-FirstNonEmptyLine $result.StdErr)
    } elseif (-not $result.StdOut.Trim()) {
      $lastFailure = "probe exited 0 with no output"
    } else {
      $parseFailed = $false
      try {
        $payload = $result.StdOut.Trim() | ConvertFrom-Json
      } catch {
        # ONLY a malformed payload is absorbed here. Every verdict below is thrown OUTSIDE this
        # catch, so a genuine stamp or version mismatch can never be swallowed by it.
        $payload = $null
        $parseFailed = $true
      }
      if ($parseFailed) {
        $lastFailure = "probe returned unparsable output"
      } elseif ($null -eq $payload) {
        $lastFailure = "probe returned an empty payload"
      } elseif (-not $payload.stamp -or ("" + $payload.stamp).StartsWith("ERR:")) {
        # The probe's own error marker: the shell is up but the command has not answered yet.
        $payload = $null
        $lastFailure = "shell has not answered get_build_stamp yet"
      } elseif (-not $payload.railVersion) {
        $payload = $null
        $lastFailure = "shell has not mounted its version yet"
      }
    }

    if ($null -ne $payload) {
      if ($payload.stamp -ne $ExpectedStamp) {
        throw "RUNTIME STAMP MISMATCH: running app reports '$($payload.stamp)'; expected '$ExpectedStamp'."
      }
      if ($payload.railVersion -notmatch [regex]::Escape($ExpectedVersion)) {
        throw "RUNTIME VERSION MISMATCH: the mounted shell does not show version $ExpectedVersion (found '$($payload.railVersion)')."
      }
      return [pscustomobject]@{
        Stamp             = $payload.stamp
        RailVersion       = $payload.railVersion
        Pill              = $payload.pill
        Attempts          = $attempts
        TransientFailures = $transientFailures
      }
    }

    $transientFailures += 1
    if ($LaunchedProcess.HasExited) {
      throw "RUNTIME PROOF FAILED: installed Compy exited before its main window became healthy (exit $($LaunchedProcess.ExitCode))."
    }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Milliseconds $RetryDelayMs
  }

  throw "RUNTIME PROOF FAILED: Compy's main shell did not answer the build-stamp probe within $TimeoutSeconds seconds ($attempts attempt(s); last failure: $lastFailure)."
}
