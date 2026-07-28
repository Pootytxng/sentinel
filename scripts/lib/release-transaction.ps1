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
  $evidenceTable = [ordered]@{}
  if ($Journal.evidence) {
    foreach ($property in $Journal.evidence.psobject.Properties) {
      $evidenceTable[$property.Name] = $property.Value
    }
    if ($Journal.evidence -is [System.Collections.IDictionary]) {
      foreach ($key in $Journal.evidence.Keys) { $evidenceTable[$key] = $Journal.evidence[$key] }
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
    $inspection = Invoke-ReleaseScriptBlock -ScriptBlock $handler.Inspect -ArgumentList @($Context)
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
      Invoke-ReleaseScriptBlock -ScriptBlock $handler.Apply -ArgumentList @($Context)
      $inspection = Invoke-ReleaseScriptBlock -ScriptBlock $handler.Inspect -ArgumentList @($Context)
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
