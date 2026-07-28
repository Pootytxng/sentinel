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

# Resolves a command name or path to a real executable. CreateProcess cannot launch a .cmd/.bat
# file. Routing an argument array through cmd.exe would reparse &, |, <, >, %, ! and ^ as shell
# syntax, which is not argument-array semantics. Batch shims are therefore refused. Callers that
# need npm use Get-NpmCliInvocation, which launches npm-cli.js through node.exe directly.
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
  if ($isBatch) {
    throw "Batch shim '$source' is not a safe executable target: cmd.exe shell reparsing would violate argument-array semantics. Invoke its real interpreter entry point instead."
  }
  return [pscustomobject]@{
    Source   = $source
    FilePath = $source
    IsBatch  = $false
  }
}

function ConvertTo-NativeCommandLine {
  param(
    [Parameter(Mandatory = $true)][psobject]$Resolved,
    [string[]]$ArgumentList = @()
  )
  return (ConvertTo-NativeArgumentString $ArgumentList)
}

function Get-NpmCliInvocation {
  $npm = @(Get-Command "npm.cmd" -CommandType Application -ErrorAction SilentlyContinue)
  if ($npm.Count -eq 0) { throw "Required npm.cmd installation was not found on PATH." }
  $nodeRoot = Split-Path -Parent $npm[0].Source
  $node = Join-Path $nodeRoot "node.exe"
  $cli = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    $node = (Resolve-NativeExecutable "node").Source
  }
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw "npm CLI entry point was not found beside npm.cmd: $cli"
  }
  return [pscustomobject]@{
    Command = $node
    ArgumentPrefix = @($cli)
  }
}

function Set-NativeEnvironment {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.ProcessStartInfo]$StartInfo,
    [hashtable]$Environment
  )
  if (-not $Environment) { return }
  foreach ($key in $Environment.Keys) {
    if ([string]::IsNullOrWhiteSpace([string]$key)) {
      throw "Native-process environment overrides cannot contain an empty variable name."
    }
    $value = $Environment[$key]
    if ($null -eq $value) {
      $StartInfo.EnvironmentVariables.Remove([string]$key)
    } else {
      # Assign through ProcessStartInfo, not the parent process environment. An empty string remains
      # PRESENT in the child, which the passwordless pinned Tauri signing key requires.
      $StartInfo.EnvironmentVariables[[string]$key] = [string]$value
    }
  }
}

function Stop-NativeProcessTree {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [int]$TimeoutMs = 10000
  )
  $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
  if (Test-Path -LiteralPath $taskkill -PathType Leaf) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $taskkill
    $info.Arguments = ConvertTo-NativeArgumentString @("/PID", "$ProcessId", "/T", "/F")
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $killer = New-Object System.Diagnostics.Process
    $killer.StartInfo = $info
    try {
      if ($killer.Start()) {
        $null = $killer.StandardOutput.ReadToEndAsync()
        $null = $killer.StandardError.ReadToEndAsync()
        $killer.WaitForExit($TimeoutMs) | Out-Null
      }
    } catch {
      # The tracked-process fallback below still runs. Timeout handling must never pretend a failed
      # tree-kill attempt succeeded.
    } finally {
      $killer.Dispose()
    }
  }
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
    [hashtable]$Environment,
    [int]$TimeoutMs = 20000,
    [int]$DrainMs = 5000,
    [bool]$KillTreeOnTimeout = $true
  )

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
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
  Set-NativeEnvironment -StartInfo $startInfo -Environment $Environment

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $stdout = ""
  $stderr = ""
  $exitCode = -1
  $timedOut = $false
  $terminationAttempted = $false
  $processId = -1
  try {
    if (-not $process.Start()) { throw "Could not start '$FilePath'." }
    $processId = $process.Id
    $process.StandardInput.Close()
    # Read both pipes concurrently: reading one to the end while the other fills can deadlock.
    $outReader = $process.StandardOutput.ReadToEndAsync()
    $errReader = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMs)) {
      $timedOut = $true
      if ($KillTreeOnTimeout) {
        $terminationAttempted = $true
        Stop-NativeProcessTree -ProcessId $process.Id -TimeoutMs $DrainMs
        if (-not $process.HasExited) {
          try { $process.Kill() } catch { }
        }
        $process.WaitForExit($DrainMs) | Out-Null
      }
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
    FilePath             = $FilePath
    Arguments            = $startInfo.Arguments
    ExitCode             = $exitCode
    StdOut               = $stdout
    StdErr               = $stderr
    TimedOut             = $timedOut
    ProcessId            = $processId
    DurationMs           = $clock.ElapsedMilliseconds
    TerminationAttempted = $terminationAttempted
    EnvironmentKeys      = @($(if ($Environment) { $Environment.Keys | Sort-Object } else { @() }))
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
    [hashtable]$Environment,
    [int]$TimeoutMs = 600000,
    [bool]$KillTreeOnTimeout = $true
  )
  $resolved = Resolve-NativeExecutable $Command
  $commandLine = ConvertTo-NativeCommandLine $resolved $ArgumentList
  return Invoke-CapturedProcess -FilePath $resolved.FilePath -ArgumentString $commandLine -WorkingDirectory $WorkingDirectory -Environment $Environment -TimeoutMs $TimeoutMs -KillTreeOnTimeout $KillTreeOnTimeout
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
    [hashtable]$Environment,
    [int]$TimeoutMs = 600000,
    [bool]$KillTreeOnTimeout = $true,
    [int[]]$AllowExitCodes = @(),
    [switch]$ShowOutput
  )
  $result = Invoke-NativeProcess -Command $Command -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -Environment $Environment -TimeoutMs $TimeoutMs -KillTreeOnTimeout $KillTreeOnTimeout
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

# For long-running commands whose output must be surfaced while they run. The child inherits this
# console's stdout/stderr handles, so output remains live. System.Diagnostics.Process still returns
# the exit code as data and supports the same working-directory, environment, timeout and tree-kill
# contract as captured mode.
function Invoke-StreamedProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Label,
    [Parameter(Mandatory = $true, Position = 1)][string]$Command,
    [Parameter(Position = 2)][string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [hashtable]$Environment,
    [int]$TimeoutMs = 3600000,
    [int]$DrainMs = 5000,
    [bool]$KillTreeOnTimeout = $true,
    [int[]]$AllowExitCodes = @()
  )
  $resolved = Resolve-NativeExecutable $Command
  $commandLine = ConvertTo-NativeCommandLine $resolved $ArgumentList

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $resolved.FilePath
  $startInfo.Arguments = $commandLine
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $false
  $startInfo.RedirectStandardOutput = $false
  $startInfo.RedirectStandardError = $false
  Set-NativeEnvironment -StartInfo $startInfo -Environment $Environment

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    $process.Dispose()
    throw "$Label could not start '$($resolved.Source)'."
  }

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $processId = $process.Id
  $exitCode = -1
  $exitUnknown = $false
  $timedOut = $false
  $terminationAttempted = $false
  try {
    if (-not $process.WaitForExit($TimeoutMs)) {
      $timedOut = $true
      if ($KillTreeOnTimeout) {
        $terminationAttempted = $true
        Stop-NativeProcessTree -ProcessId $process.Id -TimeoutMs $DrainMs
        if (-not $process.HasExited) {
          try { $process.Kill() } catch { }
        }
        $process.WaitForExit($DrainMs) | Out-Null
      }
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

  if ($timedOut) {
    if ($KillTreeOnTimeout) { throw "$Label timed out after $TimeoutMs ms and process-tree termination was attempted." }
    throw "$Label timed out after $TimeoutMs ms; the process was intentionally left running for inspection."
  }
  # Fail closed: an unreadable exit code is not a pass.
  if ($exitUnknown) {
    throw "$Label finished but Windows did not report an exit code. Refusing to assume success."
  }
  if ($exitCode -ne 0 -and -not ($AllowExitCodes -contains $exitCode)) {
    throw "$Label failed (exit $exitCode)."
  }
  return [pscustomobject]@{
    FilePath             = $resolved.Source
    Arguments            = $commandLine
    ExitCode             = $exitCode
    StdOut               = ""
    StdErr               = ""
    TimedOut             = $timedOut
    ProcessId            = $processId
    DurationMs           = $clock.ElapsedMilliseconds
    TerminationAttempted = $terminationAttempted
    EnvironmentKeys      = @($(if ($Environment) { $Environment.Keys | Sort-Object } else { @() }))
  }
}

# Starts a long-lived executable without waiting. Used only where the caller needs a Process object
# for lifecycle proof (Compy's CDP launch) or an intentional fire-and-forget normal app launch.
function Start-NativeProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Command,
    [Parameter(Position = 1)][string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [hashtable]$Environment,
    [switch]$CreateNoWindow
  )
  $resolved = Resolve-NativeExecutable $Command
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $resolved.FilePath
  $startInfo.Arguments = ConvertTo-NativeCommandLine $resolved $ArgumentList
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = [bool]$CreateNoWindow
  Set-NativeEnvironment -StartInfo $startInfo -Environment $Environment
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    $process.Dispose()
    throw "Could not start '$($resolved.Source)'."
  }
  return $process
}

# The ONE nonzero result the release pipeline is allowed to absorb: GitHub's 404 for a ref that does
# not exist yet, which is the CORRECT answer on a first publish. Everything else - authentication,
# permission, rate limiting, network failure, a malformed response, a timeout - is NOT an absent
# ref, must not be mistaken for one, and stays fatal at the call site.
function Test-GhNotFound {
  param([Parameter(Mandatory = $true)][psobject]$Result)
  if ($Result.TimedOut -or $Result.ExitCode -eq 0) { return $false }
  $text = ("" + $Result.StdErr) + "`n" + ("" + $Result.StdOut)
  # Any stronger failure signal wins. A proxy footer or combined stderr must never hide auth,
  # permission, rate-limit or network failures behind the digits "404".
  if ($text -match '(?i)HTTP\s+(401|403|407|429)\b|bad credentials|not accessible|permission|rate.?limit|timed?\s*out|could not resolve|no such host|error connecting|connection (?:refused|reset)') {
    return $false
  }
  if ($text -match '(?im)^\s*gh:\s+Not Found\s+\(HTTP 404\)\s*$') { return $true }
  if ($text -match '"message"\s*:\s*"Not Found"' -and $text -match '"status"\s*:\s*"404"') { return $true }
  return $false
}
