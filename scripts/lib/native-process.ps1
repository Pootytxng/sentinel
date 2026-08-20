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
  # The message text is unchanged; the classification, exit code and full redacted stderr ride along
  # as exception Data so a wrapper can print a real diagnosis instead of "exit 1".
  if ($result.TimedOut) {
    throw (New-NativeProcessFailure -Label $Label -Classification "timeout" -Command $result.Arguments `
      -StdOut $result.StdOut -StdErr $result.StdErr `
      -Message "$Label timed out after $TimeoutMs ms and was terminated.")
  }
  if ($result.ExitCode -ne 0 -and -not ($AllowExitCodes -contains $result.ExitCode)) {
    $detail = Get-FirstNonEmptyLine $result.StdErr
    if (-not $detail) { $detail = Get-FirstNonEmptyLine $result.StdOut }
    $failureMessage = if ($detail) { "$Label failed (exit $($result.ExitCode)): $detail" } else { "$Label failed (exit $($result.ExitCode))." }
    throw (New-NativeProcessFailure -Label $Label -Message $failureMessage -Classification "nonzero-exit" `
      -ExitCode $result.ExitCode -Command $result.Arguments -StdOut $result.StdOut -StdErr $result.StdErr)
  }
  if ($ShowOutput) {
    foreach ($stream in @($result.StdOut, $result.StdErr)) {
      if ($stream -and $stream.Trim()) { Write-Host $stream.Trim() }
    }
  }
  return $result
}

# FAILURE DIAGNOSTICS
# -------------------
# A failing release stage is the most important output this pipeline produces, and it used to arrive
# as a bare "release publish failed (exit 1)." with the child's real message destroyed. Failures now
# carry the child's own stderr, a CLASSIFICATION and the exit code as exception DATA, and the
# wrappers print the whole cause chain.
#
# Diagnostics are printed AND retained, so nothing that could carry a credential may pass through
# them. Redaction is deliberately over-eager: a masked token is a cosmetic loss, a printed signing
# key is a security incident.
function Get-RedactedDiagnosticText {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $redacted = [string]$Text
  $redacted = [regex]::Replace($redacted, '(?s)-----BEGIN[^-]*PRIVATE KEY-----.*?-----END[^-]*PRIVATE KEY-----', '[REDACTED-PRIVATE-KEY]')
  # minisign/Tauri signing material: the key bytes are the line AFTER the untrusted comment.
  $redacted = [regex]::Replace($redacted, '(?i)untrusted comment:[^\r\n]*(\r?\n[^\r\n]*)?', '[REDACTED-SIGNING-MATERIAL]')
  $redacted = [regex]::Replace($redacted, '(?i)\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}', '[REDACTED-TOKEN]')
  $redacted = [regex]::Replace($redacted, '(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [REDACTED]')
  $redacted = [regex]::Replace($redacted, '(?i)\b(token|secret|password|passphrase|api[_-]?key|private[_-]?key|signing[_-]?key|authorization)\b(["'']?\s*[:=]\s*["'']?)([^\s"'']{4,})', '$1$2[REDACTED]')
  $redacted = [regex]::Replace($redacted, '[A-Za-z0-9+/]{200,}={0,2}', '[REDACTED-BLOB]')
  return $redacted
}

# The LAST lines are the diagnostic ones: a build's real error follows thousands of progress lines.
function Get-DiagnosticTail {
  param(
    [string]$Text,
    [int]$MaxLines = 40,
    [int]$MaxChars = 4000
  )
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $lines = @(($Text -split "`r?`n") | Where-Object { $_.Trim() })
  if ($lines.Count -eq 0) { return "" }
  if ($lines.Count -gt $MaxLines) { $lines = @($lines[($lines.Count - $MaxLines)..($lines.Count - 1)]) }
  $tail = ($lines -join "`n")
  if ($tail.Length -gt $MaxChars) { $tail = "..." + $tail.Substring($tail.Length - $MaxChars) }
  return (Get-RedactedDiagnosticText $tail)
}

function New-NativeProcessFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Message,
    [Parameter(Mandatory = $true)][string]$Classification,
    [int]$ExitCode = -1,
    [string]$Command = "",
    [string]$StdOut = "",
    [string]$StdErr = ""
  )
  $text = Get-RedactedDiagnosticText $Message
  $exception = New-Object System.Management.Automation.RuntimeException $text
  $exception.Data["NativeLabel"] = $Label
  $exception.Data["NativeClassification"] = $Classification
  $exception.Data["NativeExitCode"] = $ExitCode
  $exception.Data["NativeCommand"] = (Get-RedactedDiagnosticText $Command)
  $exception.Data["NativeStdOutTail"] = (Get-DiagnosticTail -Text $StdOut)
  $exception.Data["NativeStdErrTail"] = (Get-DiagnosticTail -Text $StdErr)
  return $exception
}

# Unwinds an ErrorRecord (or a bare exception) into its cause chain, outermost first. The stage
# context added by the transaction engine lives in the OUTER message; the actionable cause lives in
# the innermost one, so a diagnosis needs the whole chain, not either end of it.
function Get-NativeExceptionChain {
  param([Parameter(Mandatory = $true)]$Failure)
  $exception = if ($Failure -is [System.Management.Automation.ErrorRecord]) { $Failure.Exception } else { $Failure }
  $chain = New-Object System.Collections.Generic.List[object]
  $guard = 0
  while ($exception -and $guard -lt 16) {
    $chain.Add($exception)
    $exception = $exception.InnerException
    $guard++
  }
  return @($chain.ToArray())
}

# Prints the complete, secret-free cause of a failed release step: every message in the chain, the
# failing transaction stage and phase when the chain carries one, the command classification, the
# exit code, and the child's own stderr tail. A wrapper that reports only its own "exit 1" is not a
# diagnosis.
function Write-ReleaseFailureDiagnostic {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)]$Failure
  )
  $chain = Get-NativeExceptionChain -Failure $Failure
  Write-Host ""
  Write-Host "=== $Label FAILED ==="
  for ($index = 0; $index -lt $chain.Count; $index++) {
    $prefix = if ($index -eq 0) { "cause" } else { "caused by" }
    Write-Host ("  {0}: {1}" -f $prefix, (Get-RedactedDiagnosticText ([string]$chain[$index].Message)))
  }
  foreach ($exception in $chain) {
    $stageMatch = [regex]::Match([string]$exception.Message, "Release transaction stage '([a-z_]+)' failed during (inspect|apply)")
    if ($stageMatch.Success) {
      Write-Host ("  failing stage: {0} ({1})" -f $stageMatch.Groups[1].Value, $stageMatch.Groups[2].Value)
      break
    }
  }
  foreach ($exception in $chain) {
    if (-not $exception.Data -or -not $exception.Data["NativeClassification"]) { continue }
    Write-Host ("  command: {0}" -f [string]$exception.Data["NativeLabel"])
    Write-Host ("  classification: {0}" -f [string]$exception.Data["NativeClassification"])
    Write-Host ("  exit code: {0}" -f [string]$exception.Data["NativeExitCode"])
    $invocation = [string]$exception.Data["NativeCommand"]
    if ($invocation) { Write-Host ("  invocation: {0}" -f $invocation) }
    $stdErrTail = [string]$exception.Data["NativeStdErrTail"]
    $stdOutTail = [string]$exception.Data["NativeStdOutTail"]
    if ($stdErrTail) {
      Write-Host "  stderr (tail):"
      foreach ($line in ($stdErrTail -split "`r?`n")) { Write-Host "    $line" }
    } elseif ($stdOutTail) {
      Write-Host "  stdout (tail):"
      foreach ($line in ($stdOutTail -split "`r?`n")) { Write-Host "    $line" }
    }
    break
  }
  if ($Failure -is [System.Management.Automation.ErrorRecord] -and $Failure.ScriptStackTrace) {
    Write-Host "  script stack:"
    foreach ($line in ($Failure.ScriptStackTrace -split "`r?`n")) { Write-Host "    $line" }
  }
  Write-Host "=== end $Label diagnostic ==="
  Write-Host ""
}

# Pulls whatever the child has already written into the relay queue, without blocking. Exactly ONE
# ReadLineAsync is outstanding per stream at a time - the next read is issued only after the previous
# line is in hand - so a line physically cannot overtake an earlier one. The reader bag is a
# hashtable because it is mutated across polls and hashtables are reference types.
function Read-NativeStreamLines {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Reader,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Concurrent.ConcurrentQueue[string]]$Queue
  )
  while (-not $Reader["Done"]) {
    if ($null -eq $Reader["Task"]) { $Reader["Task"] = $Reader["Stream"].ReadLineAsync() }
    if (-not $Reader["Task"].IsCompleted) { return }
    $task = $Reader["Task"]
    $Reader["Task"] = $null
    $line = $null
    # A faulted or cancelled read means the pipe is gone. That is end-of-stream, not a reason to
    # terminate a release run whose child has already reported an exit code.
    try { $line = $task.Result } catch { $Reader["Done"] = $true; return }
    if ($null -eq $line) {
      $Reader["Done"] = $true
      return
    }
    $Queue.Enqueue([string]$line)
  }
}

# Drains to real end-of-stream once the child is gone, bounded so a stuck pipe cannot hang a release.
function Complete-NativeStreamLines {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Reader,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Concurrent.ConcurrentQueue[string]]$Queue,
    [int]$TimeoutMs = 5000
  )
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not $Reader["Done"]) {
    Read-NativeStreamLines -Reader $Reader -Queue $Queue
    if ($Reader["Done"]) { break }
    if ($clock.ElapsedMilliseconds -ge $TimeoutMs) { break }
    if ($null -ne $Reader["Task"]) { $Reader["Task"].Wait(50) | Out-Null }
  }
}

# Drains one relayed stream into its retained sink and echoes it to this host. Write-Host (never
# Write-Error) on both streams: under $ErrorActionPreference = "Stop" an echoed stderr line must not
# become a terminating error of the PARENT, and the child's exit code is the only verdict.
function Write-NativeRelayLines {
  param(
    # AllowEmptyCollection is required, not decorative: PowerShell rejects an EMPTY collection as an
    # unbound mandatory argument, which would break the relay on the very first (silent) poll.
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Concurrent.ConcurrentQueue[string]]$Queue,
    # AllowEmptyString is required for a DIFFERENT reason, and the sink needs it while the queue does
    # not: a mandatory parameter whose argument is an IList is validated ELEMENT BY ELEMENT, so one
    # blank line already in the sink fails the bind with "because it is an empty string" - and every
    # real build log has blank lines (npm prints one right after its banner). List[string] is an IList;
    # ConcurrentQueue[string] is not, so its elements are never walked.
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][System.Collections.Generic.List[string]]$Sink,
    # Multi-line secrets straddle relay polls, so the carry-over must survive between calls. One
    # state bag PER STREAM: stdout and stderr interleave, and a block opened on one is not open on
    # the other. A hashtable is a reference type, so the caller's bag is what gets updated.
    [hashtable]$State,
    [int]$RetainLines = 4000
  )
  if ($null -eq $State) { $State = @{} }
  $line = $null
  while ($Queue.TryDequeue([ref]$line)) {
    $raw = [string]$line
    $text = Get-RedactedDiagnosticText $raw
    $suppressSuccessor = $false
    # A per-line pass cannot see a multi-line secret: a PEM body sits BETWEEN its markers and
    # signing key bytes sit AFTER their header, so both look innocuous line by line.
    if ($State["InKeyBlock"]) {
      $text = "[REDACTED-PRIVATE-KEY]"
      if ($raw -match '(?i)-----END[^-]*PRIVATE KEY-----') { $State["InKeyBlock"] = $false }
    } elseif ($raw -match '(?i)-----BEGIN[^-]*PRIVATE KEY-----' -and $raw -notmatch '(?i)-----END[^-]*PRIVATE KEY-----') {
      $text = "[REDACTED-PRIVATE-KEY]"
      $State["InKeyBlock"] = $true
    } elseif ($State["AfterSigningHeader"]) {
      $text = "[REDACTED-SIGNING-MATERIAL]"
    } elseif ($text -match '\[REDACTED-SIGNING-MATERIAL\]$') {
      # Exactly ONE successor. Keying this off the previous SINK line instead made every later line
      # redact itself forever, which hid the build error the relay exists to show.
      $suppressSuccessor = $true
    }
    $State["AfterSigningHeader"] = $suppressSuccessor
    $Sink.Add($text)
    if ($Sink.Count -gt $RetainLines) { $Sink.RemoveAt(0) }
    Write-Host $text
  }
}

# For long-running commands whose output must be surfaced while they run. Both streams are redirected
# and drained asynchronously, then echoed live AND retained, so a failing child's real message is
# both visible as it happens and attached to the thrown exception. (The former "inherit the console"
# design silently destroyed all child output whenever the parent's own stdout was a pipe rather than
# a console - which is exactly the case that matters, a captured/redirected release run.)
# System.Diagnostics.Process still returns the exit code as data and supports the same
# working-directory, environment, timeout and tree-kill contract as captured mode.
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
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  Set-NativeEnvironment -StartInfo $startInfo -Environment $Environment

  $outQueue = New-Object System.Collections.Concurrent.ConcurrentQueue[string]
  $errQueue = New-Object System.Collections.Concurrent.ConcurrentQueue[string]
  $stdOutLines = New-Object System.Collections.Generic.List[string]
  $stdErrLines = New-Object System.Collections.Generic.List[string]
  $outRelayState = @{}
  $errRelayState = @{}
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $processId = -1
  $exitCode = -1
  $exitUnknown = $false
  $timedOut = $false
  $terminationAttempted = $false
  try {
    if (-not $process.Start()) {
      throw "$Label could not start '$($resolved.Source)'."
    }
    $processId = $process.Id
    # Deliberately NOT BeginOutputReadLine: that raises OutputDataReceived through PowerShell's event
    # plumbing, and BOTH routes into it dispatch through the thread pool - an -Action handler, and the
    # -Action-less route drained with Get-Event. Concurrent dispatch REORDERS the child's own lines
    # (measured on the ordering guard: "out-3" arriving after "out-5"). A scrambled build log already
    # fails the "surface useful stderr" bar; a scrambled SECRET is worse, because the relay's
    # multi-line redaction reads ADJACENT lines - reordering split a PEM block and printed its body in
    # cleartext. One outstanding read per stream cannot reorder anything.
    $outReader = @{ Stream = $process.StandardOutput; Task = $null; Done = $false }
    $errReader = @{ Stream = $process.StandardError; Task = $null; Done = $false }
    $exited = $false
    while (-not $exited) {
      $exited = $process.WaitForExit(200)
      Read-NativeStreamLines -Reader $outReader -Queue $outQueue
      Read-NativeStreamLines -Reader $errReader -Queue $errQueue
      Write-NativeRelayLines -Queue $outQueue -Sink $stdOutLines -State $outRelayState
      Write-NativeRelayLines -Queue $errQueue -Sink $stdErrLines -State $errRelayState
      if (-not $exited -and $clock.ElapsedMilliseconds -ge $TimeoutMs) {
        $timedOut = $true
        break
      }
    }
    if ($timedOut) {
      if ($KillTreeOnTimeout) {
        $terminationAttempted = $true
        Stop-NativeProcessTree -ProcessId $process.Id -TimeoutMs $DrainMs
        if (-not $process.HasExited) {
          try { $process.Kill() } catch { }
        }
        $process.WaitForExit($DrainMs) | Out-Null
      }
    } else {
      $process.WaitForExit()
    }
    # The child is gone, but its pipes still hold whatever it wrote last. Draining to real
    # end-of-stream (bounded) is what makes the tail complete - exiting is not flushing.
    Complete-NativeStreamLines -Reader $outReader -Queue $outQueue -TimeoutMs $DrainMs
    Complete-NativeStreamLines -Reader $errReader -Queue $errQueue -TimeoutMs $DrainMs
    Write-NativeRelayLines -Queue $outQueue -Sink $stdOutLines -State $outRelayState
    Write-NativeRelayLines -Queue $errQueue -Sink $stdErrLines -State $errRelayState
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
  $stdOutText = ($stdOutLines -join "`r`n")
  $stdErrText = ($stdErrLines -join "`r`n")

  if ($timedOut) {
    $timeoutMessage = if ($KillTreeOnTimeout) {
      "$Label timed out after $TimeoutMs ms and process-tree termination was attempted."
    } else {
      "$Label timed out after $TimeoutMs ms; the process was intentionally left running for inspection."
    }
    throw (New-NativeProcessFailure -Label $Label -Message $timeoutMessage -Classification "timeout" `
      -Command $commandLine -StdOut $stdOutText -StdErr $stdErrText)
  }
  # Fail closed: an unreadable exit code is not a pass.
  if ($exitUnknown) {
    throw (New-NativeProcessFailure -Label $Label -Classification "unknown-exit" -Command $commandLine `
      -StdOut $stdOutText -StdErr $stdErrText `
      -Message "$Label finished but Windows did not report an exit code. Refusing to assume success.")
  }
  if ($exitCode -ne 0 -and -not ($AllowExitCodes -contains $exitCode)) {
    # The child's own first line is the actionable cause; an outer "exit 1" is not a diagnosis.
    $detail = Get-FirstNonEmptyLine $stdErrText
    if (-not $detail) { $detail = Get-FirstNonEmptyLine $stdOutText }
    $failureMessage = if ($detail) { "$Label failed (exit $exitCode): $detail" } else { "$Label failed (exit $exitCode)." }
    throw (New-NativeProcessFailure -Label $Label -Message $failureMessage -Classification "nonzero-exit" `
      -ExitCode $exitCode -Command $commandLine -StdOut $stdOutText -StdErr $stdErrText)
  }
  return [pscustomobject]@{
    FilePath             = $resolved.Source
    Arguments            = $commandLine
    ExitCode             = $exitCode
    StdOut               = $stdOutText
    StdErr               = $stdErrText
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
    [switch]$CreateNoWindow,
    [switch]$Detached
  )
  # -Detached (issue #60 defect 2, 2026-08-03): launch through ShellExecute instead of
  # CreateProcess-with-inheritance. A CreateProcess launch hands the child THIS process's stdout and
  # stderr handles (bInheritHandles=TRUE, and redirecting the child's own streams does not prevent
  # it). For a launch that is MEANT to outlive us - the installed app after ship-reinstall - that
  # child then holds the pipe of whatever is upstream (an operator's terminal, CI, a scripting
  # wrapper) for as long as it runs, which is the phantom prove/publish "hang". Measured against a
  # 60s child: outer pipe freed at 60297ms inherited vs 240ms detached.
  #
  # ShellExecute cannot carry a child-only environment, so the two are mutually exclusive BY
  # CONTRACT rather than silently ignored - a silently-dropped override is how a debugging port
  # would survive into a shipped build.
  if ($Detached -and $Environment) {
    throw "Start-NativeProcess: -Detached cannot carry -Environment (ShellExecute has no child-only environment). Assert the parent's environment instead."
  }
  $resolved = Resolve-NativeExecutable $Command
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $resolved.FilePath
  $startInfo.Arguments = ConvertTo-NativeCommandLine $resolved $ArgumentList
  if ($WorkingDirectory) { $startInfo.WorkingDirectory = $WorkingDirectory }
  $startInfo.UseShellExecute = [bool]$Detached
  # ONE SWITCH, TWO MECHANISMS (owner report 2026-08-20: a blank terminal window still flashing while
  # a lane works). .NET throws if CreateNoWindow is set alongside UseShellExecute, so the detached
  # path used to DROP -CreateNoWindow silently -- and a silently dropped window request is exactly how
  # a console child launched to be invisible ends up opening a real Windows Terminal window in the
  # owner's face. ShellExecute's equivalent knob is nCmdShow, reached through WindowStyle, so the
  # caller's one switch now lands on whichever mechanism the launch path actually has instead of
  # being discarded on one of them. This file already refuses -Detached with -Environment for the
  # same reason: a silently-dropped override is not a contract.
  #
  # Without -CreateNoWindow the style stays Normal, and that is a decision rather than a default: the
  # detached launch in production is Compy itself, a GUI app whose WinMain receives nCmdShow, so
  # hiding every detached launch would risk starting the shipped app with no window after
  # ship-reinstall -- the one launch the owner is supposed to see.
  if ($Detached) {
    $startInfo.WindowStyle = if ($CreateNoWindow) {
      [System.Diagnostics.ProcessWindowStyle]::Hidden
    } else {
      [System.Diagnostics.ProcessWindowStyle]::Normal
    }
  } else {
    $startInfo.CreateNoWindow = [bool]$CreateNoWindow
  }
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
