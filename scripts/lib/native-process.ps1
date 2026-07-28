# native-process.ps1 - the ONE approved way for release-critical PowerShell to run an external
# program.
#
# ASCII ONLY, no BOM. Windows PowerShell 5.1 decodes a BOM-less file as ANSI, so keeping every byte
# in this file ASCII means no character in it can ever mojibake. (ship-reinstall.ps1 carries
# non-ASCII text and therefore carries a BOM; see version-drift-guard Guard C.)
#
# THE DEFECT THIS EXISTS TO KILL
# ------------------------------
# Windows PowerShell 5.1 promotes a native command's STDERR into a TERMINATING NativeCommandError
# whenever that stderr is redirected or captured and $ErrorActionPreference = "Stop". `2>$null` does
# not prevent it - redirecting the stream is what CREATES the ErrorRecord. Two consecutive v0.9.9
# publish attempts died on this exact class:
#   * attempt 1 - the CDP runtime probe's EXPECTED "connection refused" while a freshly installed
#     app was still booting (scripts/ship-reinstall.ps1, repaired 2026-07-27)
#   * attempt 2 - `gh api "repos/.../git/refs/tags/$tag" --jq ".object.sha" 2>$null` returning the
#     CORRECT "HTTP 404 = this tag does not exist yet" answer for a first publish
#     (scripts/release.ps1:393, 2026-07-27)
# Both times an EXPECTED failure, inside logic written to tolerate it, killed the release. Both
# times the pipeline failed CLOSED - but it could not complete, and each attempt burns a version.
#
# The repair is not suppression, and it is not weakening $ErrorActionPreference. It is to stop
# invoking external programs as PowerShell native commands at all. Everything below runs the child
# through System.Diagnostics.Process (or Start-Process, a cmdlet) and returns the exit code as DATA:
#
#   Invoke-NativeProcess   - capture stdout/stderr/exit code; NEVER throws on a nonzero exit. For
#                            the few callers that must CLASSIFY a failure rather than fail on it
#                            (the expected-404 tag probe; see Test-GhNotFound).
#   Invoke-CheckedProcess  - capture, then FAIL CLOSED on any exit code outside -AllowExitCodes,
#                            with the child's own stderr carried into the thrown message.
#   Invoke-StreamedProcess - for long commands whose output must stay VISIBLE (builds, test suites,
#                            uploads, nested scripts). Start-Process is a cmdlet, not a native
#                            invocation, so it is immune to NativeCommandError while the child
#                            writes straight to the inherited console. Fails closed the same way.
#
# All three take an explicit executable plus an explicit argument ARRAY. Nothing is ever handed to a
# shell for re-parsing, so a path with a space, a multi-line release note, or a `--jq` expression
# reaches the child exactly as written.

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

# Resolves a command name or path to a real executable. CreateProcess (which is what
# UseShellExecute=$false uses) CANNOT launch a .cmd/.bat file, so a batch shim such as npm.cmd is
# reported as such and routed through cmd.exe by ConvertTo-NativeCommandLine.
function Resolve-NativeExecutable {
  param([Parameter(Mandatory = $true)][string]$Command)

  $source = ""
  if ($Command -match '[\\/]' -or [System.IO.Path]::IsPathRooted($Command)) {
    if (-not (Test-Path -LiteralPath $Command -PathType Leaf)) {
      throw "Required executable '$Command' does not exist."
    }
    $source = (Resolve-Path -LiteralPath $Command).Path
  } else {
    $found = @(Get-Command $Command -CommandType Application -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) { throw "Required executable '$Command' was not found on PATH." }
    $source = $found[0].Source
  }

  $extension = [System.IO.Path]::GetExtension($source)
  $isBatch = ($extension -eq ".cmd" -or $extension -eq ".bat")
  return [pscustomobject]@{
    Source   = $source
    FilePath = $(if ($isBatch) { $env:ComSpec } else { $source })
    IsBatch  = $isBatch
  }
}

# Builds the exact command line for a resolved executable. A batch shim gets the only cmd.exe form
# that survives a quoted path plus quoted arguments: /s /c "<the whole quoted command>".
function ConvertTo-NativeCommandLine {
  param(
    [Parameter(Mandatory = $true)][psobject]$Resolved,
    [string[]]$ArgumentList = @()
  )
  if ($Resolved.IsBatch) {
    return '/s /c "' + (ConvertTo-NativeArgumentString (@($Resolved.Source) + @($ArgumentList))) + '"'
  }
  return (ConvertTo-NativeArgumentString $ArgumentList)
}

# Runs a native executable and returns its stdout, stderr and exit code as DATA. Never raises a
# NativeCommandError, because the child is never a PowerShell native command. A child that outlives
# TimeoutMs is killed and reported as TimedOut.
function Invoke-CapturedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$ArgumentString,
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 20000,
    [int]$DrainMs = 5000
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  if ($PSBoundParameters.ContainsKey("ArgumentString")) {
    $startInfo.Arguments = $ArgumentString
  } else {
    $startInfo.Arguments = ConvertTo-NativeArgumentString $ArgumentList
  }
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

# Capture without judgement. The ONLY entry point a caller should use when a nonzero exit is a
# legitimate ANSWER that must be classified (not a failure to propagate).
function Invoke-NativeProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Command,
    [Parameter(Position = 1)][string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 600000
  )
  $resolved = Resolve-NativeExecutable $Command
  $commandLine = ConvertTo-NativeCommandLine $resolved $ArgumentList
  return Invoke-CapturedProcess -FilePath $resolved.FilePath -ArgumentString $commandLine -WorkingDirectory $WorkingDirectory -TimeoutMs $TimeoutMs
}

# Capture and FAIL CLOSED. Any exit code outside -AllowExitCodes, and any timeout, throws with the
# child's own first stderr line attached so the failure is diagnosable from the transcript alone.
function Invoke-CheckedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Label,
    [Parameter(Mandatory = $true, Position = 1)][string]$Command,
    [Parameter(Position = 2)][string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 600000,
    [int[]]$AllowExitCodes = @(),
    [switch]$ShowOutput
  )
  $result = Invoke-NativeProcess -Command $Command -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -TimeoutMs $TimeoutMs
  if ($result.TimedOut) {
    throw "$Label timed out after $TimeoutMs ms and was terminated."
  }
  if ($result.ExitCode -ne 0 -and -not ($AllowExitCodes -contains $result.ExitCode)) {
    $detail = Get-FirstNonEmptyLine $result.StdErr
    if (-not $detail) { $detail = Get-FirstNonEmptyLine $result.StdOut }
    if ($detail) { throw "$Label failed (exit $($result.ExitCode)): $detail" }
    throw "$Label failed (exit $($result.ExitCode))."
  }
  if ($ShowOutput) {
    foreach ($stream in @($result.StdOut, $result.StdErr)) {
      if ($stream -and $stream.Trim()) { Write-Host $stream.Trim() }
    }
  }
  return $result
}

# For long-running commands whose output must be surfaced while they run. Start-Process is a cmdlet,
# so no NativeCommandError is possible; -NoNewWindow makes the child inherit this console's handles,
# so its output streams live instead of arriving in one lump at the end.
function Invoke-StreamedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Label,
    [Parameter(Mandatory = $true, Position = 1)][string]$Command,
    [Parameter(Position = 2)][string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 3600000,
    [int]$DrainMs = 5000,
    [int[]]$AllowExitCodes = @()
  )
  $resolved = Resolve-NativeExecutable $Command
  $commandLine = ConvertTo-NativeCommandLine $resolved $ArgumentList

  $startArgs = @{
    FilePath    = $resolved.FilePath
    NoNewWindow = $true
    PassThru    = $true
  }
  # A single pre-quoted string is passed to the child verbatim; an ARRAY would be space-joined by
  # Start-Process without any quoting, which breaks the first path containing a space.
  if ($commandLine) { $startArgs["ArgumentList"] = $commandLine }
  if ($WorkingDirectory) { $startArgs["WorkingDirectory"] = $WorkingDirectory }

  $process = Start-Process @startArgs
  if (-not $process) { throw "$Label could not start '$($resolved.Source)'." }
  # Start-Process -PassThru hands back a Process whose SafeHandle is NOT cached. Once the child
  # exits, .ExitCode then comes back $null - and $null -ne 0 is TRUE, so a PASSING gate reads as a
  # failure. Dereferencing .Handle while the child is still alive caches it, which is what makes
  # .ExitCode retrievable after exit.
  try { $null = $process.Handle } catch { }

  $exitCode = -1
  $exitUnknown = $false
  $timedOut = $false
  try {
    if (-not $process.WaitForExit($TimeoutMs)) {
      $timedOut = $true
      try { $process.Kill() } catch { }
      $process.WaitForExit($DrainMs) | Out-Null
    }
    $process.Refresh()
    if ($process.HasExited) {
      $raw = $process.ExitCode
      if ($null -ne $raw) { $exitCode = [int]$raw } else { $exitUnknown = $true }
    } else {
      $exitUnknown = $true
    }
  } finally {
    $process.Dispose()
  }

  if ($timedOut) { throw "$Label timed out after $TimeoutMs ms and was terminated." }
  # Fail closed: an unreadable exit code is not a pass.
  if ($exitUnknown) {
    throw "$Label finished but Windows did not report an exit code. Refusing to assume success."
  }
  if ($exitCode -ne 0 -and -not ($AllowExitCodes -contains $exitCode)) {
    throw "$Label failed (exit $exitCode)."
  }
  return [pscustomobject]@{
    Command   = $resolved.Source
    Arguments = $commandLine
    ExitCode  = $exitCode
    TimedOut  = $timedOut
  }
}

# The ONE nonzero result the release pipeline is allowed to absorb: GitHub's 404 for a ref that does
# not exist yet, which is the CORRECT answer on a first publish. Everything else - authentication,
# permission, rate limiting, network failure, a malformed response, a timeout - is NOT an absent
# ref, must not be mistaken for one, and stays fatal at the call site.
function Test-GhNotFound {
  param([Parameter(Mandatory = $true)][psobject]$Result)
  if ($Result.TimedOut) { return $false }
  $text = ("" + $Result.StdErr) + "`n" + ("" + $Result.StdOut)
  if ($text -match '\(HTTP 404\)') { return $true }
  if ($text -match '"status"\s*:\s*"404"') { return $true }
  if ($text -match 'HTTP\s+404\b') { return $true }
  return $false
}
