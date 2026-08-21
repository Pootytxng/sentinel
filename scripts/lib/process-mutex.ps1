# Machine-local collision guard for release/install critical sections.
#
# GitHub Work Control remains the authority for ownership. These named mutexes enforce only local
# process exclusion. The sidecar owner record is a crash breadcrumb, never a lease: if a process
# dies before normal cleanup, later acquisition fails closed until explicit issue-backed inspection.

# The recovery state lives under Compy's data root, so it comes through the #130 resolver.
. (Join-Path $PSScriptRoot "canonical-data-root.ps1")

function Get-CompyProcessMutexDefaultStateRoot {
  # NEVER compose this from the $env:APPDATA string (#130, 2026-08-18). During the packaged-host
  # incident that string was CORRECT and the resolution was still redirected into a package
  # overlay -- which is exactly the failure this file cannot survive: two lanes would each write
  # owner.json into a DIFFERENT root, each see a clean slate, and both proceed. A collision guard
  # that cannot prove it is looking at the shared root is not a guard. The resolver refuses rather
  # than guesses, and refusing to start is the correct outcome here.
  #
  # Tests never reach this: the harness passes an explicit -StateRoot under the temp directory.
  # Guarded by scripts/data-root-guard.test.mjs and by the static guard's required tokens.
  $verified = Get-CanonicalCompyDataRoot -Phase "process-mutex state root"
  return (Join-Path $verified.Path "work-control\process-mutex")
}

function Get-CompyProcessMutexPaths {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Resource,
    [string]$StateRoot
  )

  if ([string]::IsNullOrWhiteSpace($Name)) { throw "Process mutex name is required." }
  if ([string]::IsNullOrWhiteSpace($Resource)) { throw "Process mutex resource is required." }
  if ([string]::IsNullOrWhiteSpace($StateRoot)) {
    $StateRoot = Get-CompyProcessMutexDefaultStateRoot
  }
  $safeResource = ($Resource -replace '[^A-Za-z0-9._-]', '-').Trim('-')
  if ([string]::IsNullOrWhiteSpace($safeResource)) {
    throw "Process mutex resource does not contain a safe state-path name."
  }
  $resourceRoot = Join-Path ([System.IO.Path]::GetFullPath($StateRoot)) $safeResource
  return [pscustomobject]@{
    Name = $Name
    Resource = $Resource
    Root = $resourceRoot
    Owner = Join-Path $resourceRoot "owner.json"
    Recovery = Join-Path $resourceRoot "recovery-required.json"
  }
}

function Write-CompyProcessMutexJsonAtomic {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  if (Test-Path -LiteralPath $Path) {
    throw "Process mutex state already exists and will not be overwritten: $Path"
  }
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $json = $Value | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
      $temporary,
      $json,
      (New-Object System.Text.UTF8Encoding($false))
    )
    [System.IO.File]::Move($temporary, $Path)
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Read-CompyProcessMutexJson {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "Process mutex state is empty and requires recovery inspection: $Path"
  }
  try {
    return ($text | ConvertFrom-Json)
  } catch {
    throw "Process mutex state is unreadable and requires recovery inspection: $Path"
  }
}

function Get-CompyProcessStartUtc {
  param([Parameter(Mandatory = $true)][int]$Id)

  $process = Get-Process -Id $Id -ErrorAction Stop
  try {
    return $process.StartTime.ToUniversalTime().ToString("o")
  } finally {
    $process.Dispose()
  }
}

function Test-CompyProcessMutexOwnerAlive {
  param($Owner)

  if (-not $Owner -or -not $Owner.pid -or -not $Owner.process_start_utc) { return $false }
  try {
    $actualStart = Get-CompyProcessStartUtc -Id ([int]$Owner.pid)
    return $actualStart -eq [string]$Owner.process_start_utc
  } catch {
    return $false
  }
}

function New-CompyProcessMutexRecoveryMarker {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)][string]$Reason,
    $Owner
  )

  if (Test-Path -LiteralPath $Paths.Recovery -PathType Leaf) { return }
  $marker = [ordered]@{
    schema_version = 1
    resource = $Paths.Resource
    mutex_name = $Paths.Name
    reason = $Reason
    detected_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    detector_pid = $PID
    prior_owner = $Owner
    resolution = "Inspect the holder/process state, record evidence on the linked Work Control issue, then clear explicitly."
  }
  Write-CompyProcessMutexJsonAtomic -Path $Paths.Recovery -Value $marker
}

function Enter-CompyProcessMutex {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Resource,
    [string]$StateRoot
  )

  $paths = Get-CompyProcessMutexPaths -Name $Name -Resource $Resource -StateRoot $StateRoot
  if (Test-Path -LiteralPath $paths.Recovery -PathType Leaf) {
    throw "RECOVERY REQUIRED ($Resource): recovery inspection is still required at '$($paths.Recovery)'. A mutex never grants takeover permission."
  }

  $mutex = [System.Threading.Mutex]::new($false, $Name)
  $ownsMutex = $false
  try {
    $abandonedByKernel = $false
    try {
      $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      # WaitOne grants this thread ownership when it reports abandonment. Keep it only long enough
      # to persist the recovery condition, then release and fail this invocation.
      $ownsMutex = $true
      $abandonedByKernel = $true
    }

    if (-not $ownsMutex) {
      throw "MUTEX COLLISION ($Resource): '$Name' is already held by another process. The later process fails closed."
    }

    $priorOwner = $null
    if (Test-Path -LiteralPath $paths.Owner -PathType Leaf) {
      try {
        $priorOwner = Read-CompyProcessMutexJson -Path $paths.Owner
      } catch {
        New-CompyProcessMutexRecoveryMarker -Paths $paths -Reason "unreadable-owner-record" -Owner $null
        throw "RECOVERY REQUIRED ($Resource): abandoned ownership metadata is unreadable; recovery inspection is required."
      }
    }

    if ($abandonedByKernel -or $priorOwner) {
      $reason = if ($abandonedByKernel) {
        "abandoned-kernel-mutex"
      } elseif (Test-CompyProcessMutexOwnerAlive $priorOwner) {
        "owner-record-conflicts-with-free-mutex"
      } else {
        "abandoned-owner-record"
      }
      New-CompyProcessMutexRecoveryMarker -Paths $paths -Reason $reason -Owner $priorOwner
      throw "RECOVERY REQUIRED ($Resource): abandoned process ownership was detected; inspect and record recovery on the linked Work Control issue before retrying."
    }

    $token = [guid]::NewGuid().ToString("N")
    $owner = [ordered]@{
      schema_version = 1
      resource = $Resource
      mutex_name = $Name
      token = $token
      pid = $PID
      process_start_utc = Get-CompyProcessStartUtc -Id $PID
      acquired_at_utc = (Get-Date).ToUniversalTime().ToString("o")
      worktree = (Get-Location).Path
    }
    Write-CompyProcessMutexJsonAtomic -Path $paths.Owner -Value $owner

    return [pscustomobject]@{
      Mutex = $mutex
      Name = $Name
      Resource = $Resource
      OwnerPath = $paths.Owner
      RecoveryPath = $paths.Recovery
      Token = $token
      OwnsMutex = $true
    }
  } catch {
    if ($ownsMutex) {
      try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
    throw
  }
}

function Exit-CompyProcessMutex {
  param([Parameter(Mandatory = $true)]$Guard)

  if (-not $Guard.OwnsMutex -or -not $Guard.Mutex) {
    throw "Process mutex guard is not owned by this invocation."
  }

  $cleanupFailure = $null
  try {
    $owner = Read-CompyProcessMutexJson -Path $Guard.OwnerPath
    if (-not $owner -or $owner.token -ne $Guard.Token -or [int]$owner.pid -ne $PID) {
      throw "Process mutex owner record changed while '$($Guard.Resource)' was held; recovery inspection is required."
    }
    Remove-Item -LiteralPath $Guard.OwnerPath -Force -ErrorAction Stop
  } catch {
    $cleanupFailure = $_
    try {
      $paths = [pscustomobject]@{
        Resource = $Guard.Resource
        Name = $Guard.Name
        Recovery = $Guard.RecoveryPath
      }
      New-CompyProcessMutexRecoveryMarker -Paths $paths -Reason "owner-cleanup-failed" -Owner $owner
    } catch {}
  } finally {
    try { $Guard.Mutex.ReleaseMutex() } finally { $Guard.Mutex.Dispose() }
    $Guard.OwnsMutex = $false
  }

  if ($cleanupFailure) { throw $cleanupFailure }
}

function Get-CompyProcessMutexRecoveryStateSha256 {
  param([Parameter(Mandatory = $true)]$Paths)

  $parts = @()
  foreach ($path in @($Paths.Owner, $Paths.Recovery)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $parts += ((Split-Path -Leaf $path) + ":" + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path)))
    }
  }
  if ($parts.Count -eq 0) { return $null }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("X2") })
  } finally {
    $sha.Dispose()
  }
}

function Invoke-CompyProcessMutexIssueLookup {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("comment", "issue", "project")]
    [string]$Kind,
    [Parameter(Mandatory = $true)][long]$Id
  )

  if (-not (Get-Command Invoke-NativeProcess -CommandType Function -ErrorAction SilentlyContinue)) {
    throw "GitHub recovery verification requires scripts/lib/native-process.ps1."
  }
  $argumentList = if ($Kind -eq "comment") {
    @("api", "repos/Pootytxng/sentinel/issues/comments/$Id")
  } elseif ($Kind -eq "issue") {
    @("api", "repos/Pootytxng/sentinel/issues/$Id")
  } else {
    @("project", "item-list", "1", "--owner", "Pootytxng", "--format", "json", "--limit", "1000")
  }
  $result = Invoke-NativeProcess -Command "gh" -ArgumentList $argumentList -TimeoutMs 300000
  if ($result.TimedOut -or $result.ExitCode -ne 0) {
    $detail = ("" + $result.StdErr).Trim()
    throw "GitHub recovery verification failed for $Kind $Id. $detail"
  }
  if ([string]::IsNullOrWhiteSpace($result.StdOut)) {
    throw "GitHub recovery verification returned an empty $Kind response."
  }
  try {
    return ($result.StdOut | ConvertFrom-Json)
  } catch {
    throw "GitHub recovery verification returned malformed $Kind JSON."
  }
}

function Assert-CompyProcessMutexIssueEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$IssueEvidenceUrl,
    [Parameter(Mandatory = $true)][string]$Resource,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$RecoveryStateSha256,
    [scriptblock]$TestIssueLookup
  )

  $urlMatch = [regex]::Match(
    $IssueEvidenceUrl,
    '^https://github\.com/Pootytxng/sentinel/issues/(?<issue>\d+)#issuecomment-(?<comment>\d+)$'
  )
  if (-not $urlMatch.Success) {
    throw "Recovery clear requires a linked Work Control issue comment URL recording the completed inspection."
  }
  if ($TestIssueLookup -and
      ($Name -notmatch '^Local\\Compy\.Test\.' -or $Resource -notmatch '^test-')) {
    throw "Test issue lookup is restricted to temporary test resources."
  }
  $issueNumber = [long]$urlMatch.Groups["issue"].Value
  $commentId = [long]$urlMatch.Groups["comment"].Value
  if ($TestIssueLookup) {
    $comment = $TestIssueLookup.InvokeReturnAsIs("comment", $commentId)
    $issue = $TestIssueLookup.InvokeReturnAsIs("issue", $issueNumber)
    $project = $TestIssueLookup.InvokeReturnAsIs("project", $issueNumber)
  } else {
    $comment = Invoke-CompyProcessMutexIssueLookup -Kind "comment" -Id $commentId
    $issue = Invoke-CompyProcessMutexIssueLookup -Kind "issue" -Id $issueNumber
    $project = Invoke-CompyProcessMutexIssueLookup -Kind "project" -Id $issueNumber
  }
  $expectedIssueApi = "https://api.github.com/repos/Pootytxng/sentinel/issues/$issueNumber"
  $labelNames = @($issue.labels | ForEach-Object { [string]$_.name })
  if (-not $comment -or -not $issue -or
      [string]$comment.html_url -cne $IssueEvidenceUrl -or
      [string]$comment.issue_url -cne $expectedIssueApi -or
      [long]$issue.number -ne $issueNumber -or
      [string]$issue.state -cne "open" -or
      $labelNames -notcontains "work-control") {
    throw "Recovery evidence is not a live comment on the linked open work-control issue."
  }

  $projectMatches = @($project.items | Where-Object {
    [string]$_.content.type -ceq "Issue" -and
    [long]$_.content.number -eq $issueNumber -and
    [string]$_.content.repository -ceq "Pootytxng/sentinel"
  })
  if ($projectMatches.Count -ne 1 -or [string]$projectMatches[0].status -cne "Active") {
    throw "Recovery evidence issue is not Active in the authoritative Work Control Project."
  }

  $body = [string]$comment.body
  foreach ($line in @(
    "### Mutex recovery inspection",
    "- Resource: $Resource",
    "- Mutex: $Name",
    "- Recovery state SHA-256: $RecoveryStateSha256",
    "- Decision: safe to clear"
  )) {
    if (-not [regex]::IsMatch($body, "(?m)^" + [regex]::Escape($line) + "\r?$")) {
      throw "The linked work-control issue comment does not contain the required recovery evidence: $line"
    }
  }

  $inspectionMatch = [regex]::Match(
    $body,
    '(?m)^- Process/worktree/Git/receipts checked:\s*(?<evidence>.+?)\r?$'
  )
  $inspectionEvidence = if ($inspectionMatch.Success) { $inspectionMatch.Groups["evidence"].Value.Trim() } else { "" }
  if ([string]::IsNullOrWhiteSpace($inspectionEvidence) -or
      $inspectionEvidence -match '^<.*>$|^(todo|tbd|n/?a|none)$') {
    throw "The linked work-control issue comment does not contain completed recovery inspection evidence."
  }
  return [pscustomobject]@{
    IssueNumber = $issueNumber
    CommentId = $commentId
    CommentUrl = $IssueEvidenceUrl
    RecoveryStateSha256 = $RecoveryStateSha256
  }
}

function Get-CompyProcessMutexRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Resource,
    [string]$StateRoot
  )

  $paths = Get-CompyProcessMutexPaths -Name $Name -Resource $Resource -StateRoot $StateRoot
  $marker = $null
  $owner = $null
  $readError = $null
  try { $marker = Read-CompyProcessMutexJson -Path $paths.Recovery } catch { $readError = $_.Exception.Message }
  try { $owner = Read-CompyProcessMutexJson -Path $paths.Owner } catch { $readError = $_.Exception.Message }
  $required = [bool]($marker -or $owner -or $readError)
  return [pscustomobject]@{
    RecoveryRequired = $required
    Resource = $Resource
    MutexName = $Name
    MarkerPath = $paths.Recovery
    OwnerPath = $paths.Owner
    RecoveryStateSha256 = Get-CompyProcessMutexRecoveryStateSha256 -Paths $paths
    Reason = if ($readError) { $readError } elseif ($marker) { [string]$marker.reason } elseif ($owner) { "owner-record-present" } else { $null }
    OwnerAlive = if ($owner) { Test-CompyProcessMutexOwnerAlive $owner } else { $false }
    Marker = $marker
    Owner = $owner
  }
}

function Resolve-CompyProcessMutexRecovery {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Resource,
    [string]$StateRoot,
    [string]$IssueEvidenceUrl,
    [scriptblock]$TestIssueLookup
  )

  if ($IssueEvidenceUrl -notmatch '^https://github\.com/Pootytxng/sentinel/issues/\d+#issuecomment-\d+$') {
    throw "Recovery clear requires a linked Work Control issue comment URL recording the completed inspection."
  }
  if ($TestIssueLookup) {
    $tempRootPath = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $stateRootPath = if ($StateRoot) { [System.IO.Path]::GetFullPath($StateRoot) } else { "" }
    if ($Name -notmatch '^Local\\Compy\.Test\.' -or
        $Resource -notmatch '^test-' -or
        -not $stateRootPath.StartsWith($tempRootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Test issue lookup is restricted to temporary test resources."
    }
  }

  $paths = Get-CompyProcessMutexPaths -Name $Name -Resource $Resource -StateRoot $StateRoot
  if (-not (Test-Path -LiteralPath $paths.Recovery -PathType Leaf) -and
      -not (Test-Path -LiteralPath $paths.Owner -PathType Leaf)) {
    throw "No recovery-required state exists for '$Resource'."
  }

  $inspection = Get-CompyProcessMutexRecovery -Name $Name -Resource $Resource -StateRoot $StateRoot
  $expectedRecoveryStateSha256 = [string]$inspection.RecoveryStateSha256
  if ([string]::IsNullOrWhiteSpace($expectedRecoveryStateSha256)) {
    throw "Recovery-required state has no stable identity; refuse to clear it."
  }
  $null = Assert-CompyProcessMutexIssueEvidence `
    -IssueEvidenceUrl $IssueEvidenceUrl `
    -Resource $Resource `
    -Name $Name `
    -RecoveryStateSha256 $expectedRecoveryStateSha256 `
    -TestIssueLookup $TestIssueLookup

  $mutex = [System.Threading.Mutex]::new($false, $Name)
  $ownsMutex = $false
  try {
    try {
      $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $ownsMutex = $true
    }
    if (-not $ownsMutex) {
      throw "MUTEX COLLISION ($Resource): '$Name' is still held; recovery cannot clear active ownership."
    }

    $owner = $null
    try { $owner = Read-CompyProcessMutexJson -Path $paths.Owner } catch {}
    if ($owner -and (Test-CompyProcessMutexOwnerAlive $owner)) {
      throw "MUTEX COLLISION ($Resource): recorded holder PID $($owner.pid) is still alive; recovery cannot clear active ownership."
    }

    $currentRecoveryStateSha256 = Get-CompyProcessMutexRecoveryStateSha256 -Paths $paths
    if ($currentRecoveryStateSha256 -cne $expectedRecoveryStateSha256) {
      throw "Recovery state changed after issue evidence was verified; inspect and record the new state before clearing."
    }

    if (Test-Path -LiteralPath $paths.Owner -PathType Leaf) {
      Remove-Item -LiteralPath $paths.Owner -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $paths.Recovery -PathType Leaf) {
      Remove-Item -LiteralPath $paths.Recovery -Force -ErrorAction Stop
    }
  } finally {
    if ($ownsMutex) {
      try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
  }
}
