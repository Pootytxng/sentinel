# release-transaction.ps1 - deterministic, resumable release publication state machine.
#
# The adapter owns external I/O. This engine owns ordering, journal binding, retry semantics, and
# the final publication boundary. Production and the sandbox harness execute this same function.
# ASCII only for Windows PowerShell 5.1.

$script:ReleaseTransactionStages = @(
  "receipt_verified",
  "runtime_proved",
  "source_main_pushed",
  "source_tag_pushed",
  "releases_tag_created",
  "draft_created",
  "draft_assets_verified",
  "release_published",
  "public_assets_verified"
)

function Get-ReleaseTransactionStages {
  return @($script:ReleaseTransactionStages)
}

function Invoke-ReleaseScriptBlock {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock,
    [object[]]$ArgumentList = @()
  )
  # The sole approved dynamic call on the release surface. It can invoke only an already-typed
  # in-memory ScriptBlock; native executables must go through native-process.ps1.
  return & $ScriptBlock @ArgumentList
}

# A stage handler that throws is the most important diagnostic the pipeline produces, and it used to
# surface as a bare message with no indication of WHICH stage or phase produced it. Rethrow with the
# stage context attached and the original exception preserved as InnerException, so the wrapper can
# print the real cause instead of an outer "exit 1".
function Invoke-ReleaseStageHandler {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][ValidateSet("inspect", "apply")][string]$Phase,
    [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock,
    [object[]]$ArgumentList = @()
  )
  try {
    return Invoke-ReleaseScriptBlock -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList
  } catch {
    $inner = $_.Exception
    $message = "Release transaction stage '$Stage' failed during $Phase`: $($inner.Message)"
    throw (New-Object System.Management.Automation.RuntimeException $message, $inner)
  }
}

function Get-ReleaseTransactionBinding {
  param([Parameter(Mandatory = $true)][psobject]$Receipt)
  if ($Receipt.schema_version -ne 3) {
    throw "Unsupported staged receipt schema: $($Receipt.schema_version)"
  }
  foreach ($required in @(
    @{ Name = "version"; Value = $Receipt.version },
    @{ Name = "commit"; Value = $Receipt.commit },
    @{ Name = "tag"; Value = $Receipt.tag },
    @{ Name = "installer.sha256"; Value = $Receipt.installer.sha256 },
    @{ Name = "signature.sha256"; Value = $Receipt.signature.sha256 },
    @{ Name = "manifest.sha256"; Value = $Receipt.manifest.sha256 }
  )) {
    if ([string]::IsNullOrWhiteSpace([string]$required.Value)) {
      throw "Staged receipt has no $($required.Name)."
    }
  }
  if ($Receipt.commit -notmatch '^[0-9a-fA-F]{40}$') {
    throw "Staged receipt commit is not a full 40-character Git object id."
  }
  if ($Receipt.tag -ne "v$($Receipt.version)") {
    throw "Staged receipt tag $($Receipt.tag) does not match version v$($Receipt.version)."
  }
  foreach ($hash in @($Receipt.installer.sha256, $Receipt.signature.sha256, $Receipt.manifest.sha256)) {
    if ($hash -notmatch '^[0-9a-fA-F]{64}$') {
      throw "Staged receipt contains a malformed SHA-256 binding."
    }
  }
  return [ordered]@{
    receipt_schema = [int]$Receipt.schema_version
    version = [string]$Receipt.version
    release_commit = ([string]$Receipt.commit).ToLowerInvariant()
    source_tag = [string]$Receipt.tag
    installer_sha256 = ([string]$Receipt.installer.sha256).ToLowerInvariant()
    signature_sha256 = ([string]$Receipt.signature.sha256).ToLowerInvariant()
    manifest_sha256 = ([string]$Receipt.manifest.sha256).ToLowerInvariant()
  }
}

function Test-ReleaseTransactionBindingEqual {
  param(
    [Parameter(Mandatory = $true)][psobject]$Expected,
    [Parameter(Mandatory = $true)][psobject]$Actual
  )
  foreach ($name in @(
    "receipt_schema", "version", "release_commit", "source_tag",
    "installer_sha256", "signature_sha256", "manifest_sha256"
  )) {
    if ([string]$Expected.$name -cne [string]$Actual.$name) { return $false }
  }
  return $true
}

function Read-ReleaseTransactionJournal {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][psobject]$Binding
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [ordered]@{
      schema_version = 1
      binding = $Binding
      completed_stages = @()
      evidence = [ordered]@{}
    }
  }
  $journal = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($journal.schema_version -ne 1 -or -not $journal.binding) {
    throw "Release transaction journal is malformed or unsupported: $Path"
  }
  if (-not (Test-ReleaseTransactionBindingEqual -Expected $Binding -Actual $journal.binding)) {
    throw "Release transaction journal is bound to a different receipt. Preserve it and use the matching candidate; refusing to overwrite it."
  }
  $completed = @($journal.completed_stages)
  $known = Get-ReleaseTransactionStages
  if (@($completed | Sort-Object -Unique).Count -ne $completed.Count) {
    throw "Release transaction journal contains duplicate stages."
  }
  for ($index = 0; $index -lt $completed.Count; $index++) {
    if ($index -ge $known.Count -or $completed[$index] -ne $known[$index]) {
      throw "Release transaction journal stages are not an exact ordered prefix of the transaction."
    }
  }
  return [ordered]@{
    schema_version = 1
    binding = $Binding
    completed_stages = $completed
    evidence = if ($journal.evidence) { $journal.evidence } else { [ordered]@{} }
  }
}

function Write-ReleaseTransactionJournal {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][psobject]$Journal
  )
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Journal | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding($false)))
  try {
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
  }
}

function Set-ReleaseJournalEvidence {
  param(
    [Parameter(Mandatory = $true)][psobject]$Journal,
    [Parameter(Mandatory = $true)][string]$Stage,
    [psobject]$Evidence
  )
  # Enumerate by TYPE, not both ways. psobject.Properties on a dictionary yields the IDictionary
  # surface (Count/Keys/Values/SyncRoot/...), not the entries, and the old both-ways carry-forward
  # baked that surface into the file as literal evidence keys -- then re-read it as real properties
  # and grew it on every write. Evidence keys are transaction stage names by construction, so keeping
  # only known stages both fixes the write and repairs a journal an older build already polluted.
  # Journal AUTHORITY is unchanged: schema_version, binding and completed_stages are untouched.
  $known = @(Get-ReleaseTransactionStages)
  $evidenceTable = [ordered]@{}
  if ($Journal.evidence) {
    if ($Journal.evidence -is [System.Collections.IDictionary]) {
      foreach ($key in @($Journal.evidence.Keys)) {
        if ($known -contains $key) { $evidenceTable[$key] = $Journal.evidence[$key] }
      }
    } else {
      foreach ($property in $Journal.evidence.psobject.Properties) {
        if ($known -contains $property.Name) { $evidenceTable[$property.Name] = $property.Value }
      }
    }
  }
  $evidenceTable[$Stage] = if ($null -eq $Evidence) { [ordered]@{} } else { $Evidence }
  $Journal.evidence = $evidenceTable
}

function Invoke-ReleaseTransaction {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][hashtable]$Adapter,
    [Parameter(Mandatory = $true)][string]$JournalPath,
    [switch]$AllowPublication,
    [string]$StopAfterStage
  )
  $binding = Get-ReleaseTransactionBinding -Receipt $Context.Receipt
  if ($Adapter.ContainsKey("__dependency_keys")) {
    $adapterDependencyKeys = @($Adapter["__dependency_keys"])
    $contextDependencyKeys = if ($Context.Dependencies) {
      @($Context.Dependencies.Keys | Sort-Object)
    } else {
      @()
    }
    if (($adapterDependencyKeys -join "`n") -cne ($contextDependencyKeys -join "`n")) {
      throw "Release adapter dependency binding does not match the transaction context."
    }
  }
  $journal = Read-ReleaseTransactionJournal -Path $JournalPath -Binding $binding
  $Context | Add-Member -NotePropertyName Binding -NotePropertyValue $binding -Force
  $Context | Add-Member -NotePropertyName Journal -NotePropertyValue $journal -Force

  foreach ($stage in (Get-ReleaseTransactionStages)) {
    if (-not $Adapter.ContainsKey($stage)) {
      throw "Release transaction adapter has no '$stage' stage."
    }
    $handler = $Adapter[$stage]
    if (-not $handler.Inspect) {
      throw "Release transaction adapter stage '$stage' has no Inspect handler."
    }

    # The journal is evidence, never authority: inspect real state on every invocation.
    $inspection = Invoke-ReleaseStageHandler -Stage $stage -Phase "inspect" -ScriptBlock $handler.Inspect -ArgumentList @($Context)
    if (-not $inspection -or @("complete", "absent") -notcontains $inspection.Status) {
      throw "Release transaction stage '$stage' returned a malformed inspection result."
    }
    $wasJournaled = @($journal.completed_stages) -contains $stage
    if ($wasJournaled -and $inspection.Status -ne "complete") {
      throw "Release transaction mismatch: journal records '$stage', but real state is not compatible."
    }

    if ($inspection.Status -eq "absent") {
      if ($stage -eq "release_published" -and -not $AllowPublication) {
        throw "OWNER BOUNDARY: verified draft is ready, but fleet-visible publication was not authorized for this invocation."
      }
      if (-not $handler.Apply) {
        throw "Release transaction stage '$stage' is absent and has no Apply handler."
      }
      Invoke-ReleaseStageHandler -Stage $stage -Phase "apply" -ScriptBlock $handler.Apply -ArgumentList @($Context)

      # GitHub is read-after-write eventually consistent: a ref or release that our OWN Apply just
      # created can still answer 404 for a beat. An absence measured immediately after a SUCCESSFUL
      # Apply is therefore evidence that we asked too early - not that the action failed. v0.9.12
      # proved it the expensive way: three publish invocations, each completing exactly one stage
      # and then failing to see the thing it had just created (releases_tag_created, then
      # draft_created), with the created ref visible in the very same log line.
      #
      # Fail-closed is preserved EXACTLY. Only "absent" is retried. A malformed inspection or a
      # throw from the inspector still fails instantly, and an absence that outlives the whole
      # budget still fails. Retrying absence here cannot mask a failed Apply: a failed Apply throws
      # before this loop is ever reached.
      $verifyAttempts = 6
      $verifyDelayMs = 1500
      if ($Context.PSObject.Properties['PostApplyVerifyAttempts']) {
        $verifyAttempts = [Math]::Max(1, [int]$Context.PostApplyVerifyAttempts)
      }
      if ($Context.PSObject.Properties['PostApplyVerifyDelayMs']) {
        $verifyDelayMs = [Math]::Max(0, [int]$Context.PostApplyVerifyDelayMs)
      }

      $inspection = $null
      for ($verifyAttempt = 1; $verifyAttempt -le $verifyAttempts; $verifyAttempt++) {
        $inspection = Invoke-ReleaseStageHandler -Stage $stage -Phase "inspect" -ScriptBlock $handler.Inspect -ArgumentList @($Context)
        if (-not $inspection -or @("complete", "absent") -notcontains $inspection.Status) {
          throw "Release transaction stage '$stage' returned a malformed inspection result after its action."
        }
        if ($inspection.Status -eq "complete") { break }
        if ($verifyAttempt -lt $verifyAttempts -and $verifyDelayMs -gt 0) {
          Start-Sleep -Milliseconds $verifyDelayMs
        }
      }
      if (-not $inspection -or $inspection.Status -ne "complete") {
        throw "Release transaction stage '$stage' did not verify as complete after its action."
      }
    }

    if (-not $wasJournaled) {
      $journal.completed_stages = @($journal.completed_stages) + $stage
    }
    Set-ReleaseJournalEvidence -Journal $journal -Stage $stage -Evidence $inspection.Evidence
    Write-ReleaseTransactionJournal -Path $JournalPath -Journal $journal

    if ($StopAfterStage -and $StopAfterStage -eq $stage) {
      return [pscustomobject]@{
        Completed = $false
        StoppedAfter = $stage
        Stages = @($journal.completed_stages)
      }
    }
  }

  return [pscustomobject]@{
    Completed = $true
    StoppedAfter = ""
    Stages = @($journal.completed_stages)
  }
}
