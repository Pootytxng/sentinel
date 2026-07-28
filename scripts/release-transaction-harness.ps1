# Sandboxed driver for the production release transaction adapter and engine.
# It uses real files and native child processes, but no production GitHub repository, installed
# Compy, signing key, public manifest, or paid service.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "first-publish-404", "create-releases-tag", "source-main-already-pushed",
    "source-tag-already-pushed", "releases-tag-already-created", "draft-already-created",
    "assets-already-uploaded", "retry-boundaries", "authentication-failure",
    "permission-failure", "network-failure", "wrong-source-tag-target",
    "wrong-installer-hash", "wrong-manifest-hash", "wrong-updater-signature",
    "existing-public-release-collision", "public-manifest-tag-disagreement",
    "downloaded-draft-asset-mismatch", "downloaded-public-asset-mismatch",
    "complete-first-publish", "partial-draft-asset-resume", "journal-audit"
  )][string]$Scenario,
  [Parameter(Mandatory = $true)][string]$Sandbox,
  [string]$StopAfterStage,
  [string]$FailOnceAtStage,
  [switch]$AllowPublication
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
. (Join-Path $PSScriptRoot "lib\release-transaction.ps1")
. (Join-Path $PSScriptRoot "lib\release-publish-adapter.ps1")

if (-not (Test-Path -LiteralPath $Sandbox -PathType Container)) {
  New-Item -ItemType Directory -Path $Sandbox | Out-Null
}
$statePath = Join-Path $Sandbox "remote-state.json"
$journalPath = Join-Path $Sandbox "release-transaction.json"
$installerPath = Join-Path $Sandbox "Compy_9.9.9_x64-setup.exe"
$signaturePath = "$installerPath.sig"
$manifestPath = Join-Path $Sandbox "latest.json"
$draftAssetsDir = Join-Path $Sandbox "remote-draft-assets"
$publicAssetsDir = Join-Path $Sandbox "remote-public-assets"
$fakeGhPath = Join-Path $Sandbox "fake-gh.ps1"

function Get-HarnessHash([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}
function Write-HarnessUtf8([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}
function Copy-HarnessAsset([string]$Source, [string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    New-Item -ItemType Directory -Path $Directory | Out-Null
  }
  Copy-Item -LiteralPath $Source -Destination (Join-Path $Directory (Split-Path -Leaf $Source))
}
function Test-HarnessAsset([string]$Source, [string]$Directory, [switch]$AllowAbsent) {
  $remote = Join-Path $Directory (Split-Path -Leaf $Source)
  if (-not (Test-Path -LiteralPath $remote -PathType Leaf)) {
    if ($AllowAbsent) { return $false }
    throw "sandbox remote asset is absent: $remote"
  }
  if ((Get-HarnessHash $remote) -ne (Get-HarnessHash $Source)) {
    throw "sandbox downloaded asset mismatch: $(Split-Path -Leaf $Source)"
  }
  return $true
}

if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  Write-HarnessUtf8 $installerPath "sandbox installer bytes"
  $installerDigest = Get-HarnessHash $installerPath
  Write-HarnessUtf8 $signaturePath "signed:$installerDigest"
  Write-HarnessUtf8 $manifestPath ('{"version":"9.9.9","signature":"signed:' + $installerDigest + '"}')
}
if (-not (Test-Path -LiteralPath $fakeGhPath -PathType Leaf)) {
  Write-HarnessUtf8 $fakeGhPath @'
param(
  [string]$Outcome,
  [string]$StatePath,
  [string]$FailOnceAtStage,
  [string]$EncodedGhArgs
)
switch ($Outcome) {
  "404" { [Console]::Error.WriteLine("gh: Not Found (HTTP 404)"); exit 1 }
  "auth" { [Console]::Error.WriteLine("gh: Bad credentials (HTTP 401)"); exit 1 }
  "permission" { [Console]::Error.WriteLine("gh: Resource not accessible (HTTP 403)"); exit 1 }
  "network" { [Console]::Error.WriteLine("gh: error connecting to api.github.com"); exit 1 }
}
if (-not $StatePath -or -not (Test-Path -LiteralPath $StatePath)) {
  [Console]::Error.WriteLine("fake gh state is missing")
  exit 2
}
$decodedGhArgs = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedGhArgs)) |
  ConvertFrom-Json
if ($decodedGhArgs.Count -eq 1 -and $decodedGhArgs[0] -is [System.Array]) {
  $decodedGhArgs = $decodedGhArgs[0]
}
$GhArgs = @($decodedGhArgs)
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$endpoint = if ($GhArgs.Count -gt 1) { $GhArgs[1] } else { "" }
if ($GhArgs[0] -eq "api" -and $endpoint -match "/commits/main$") {
  [Console]::Out.WriteLine('{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
  exit 0
}
if ($GhArgs[0] -eq "api" -and $endpoint -match "/git/ref/tags/") {
  if (-not $state.releases_tag_created) {
    $state.events = @($state.events) + "inspect:expected-404"
    [System.IO.File]::WriteAllText(
      $StatePath,
      ($state | ConvertTo-Json -Depth 12),
      (New-Object System.Text.UTF8Encoding($false))
    )
    [Console]::Error.WriteLine("gh: Not Found (HTTP 404)")
    exit 1
  }
  [Console]::Out.WriteLine('{"object":{"sha":"' + $state.releases_tag_target + '"}}')
  exit 0
}
if ($GhArgs[0] -eq "api" -and $endpoint -match "/git/refs$") {
  $shaField = @($GhArgs | Where-Object { $_ -like "sha=*" } | Select-Object -First 1)
  if ($shaField.Count -ne 1) {
    [Console]::Error.WriteLine("fake gh create-ref request has no sha")
    exit 3
  }
  $state.releases_tag_created = $true
  $state.releases_tag_target = $shaField[0].Substring(4)
  $state.events = @($state.events) + "apply:releases_tag_created"
  $shouldFail = $FailOnceAtStage -eq "releases_tag_created" -and
    @($state.failures_consumed) -notcontains "releases_tag_created"
  if ($shouldFail) {
    $state.failures_consumed = @($state.failures_consumed) + "releases_tag_created"
  }
  [System.IO.File]::WriteAllText(
    $StatePath,
    ($state | ConvertTo-Json -Depth 12),
    (New-Object System.Text.UTF8Encoding($false))
  )
  if ($shouldFail) {
    [Console]::Error.WriteLine("injected post-side-effect failure at releases_tag_created")
    exit 9
  }
  [Console]::Out.WriteLine('{"ref":"created"}')
  exit 0
}
[Console]::Error.WriteLine("unsupported fake gh invocation: " + ($GhArgs -join " "))
exit 4
'@
}

function Save-HarnessState([psobject]$State) {
  Write-HarnessUtf8 $statePath ($State | ConvertTo-Json -Depth 12)
}
function Read-HarnessState {
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  }
  $initial = [ordered]@{
    receipt_verified = $false
    runtime_proved = $false
    source_main_pushed = $false
    source_tag_pushed = $false
    releases_tag_created = $false
    releases_tag_target = ""
    draft_created = $false
    draft_assets_verified = $false
    release_published = $false
    public_assets_verified = $false
    public_version = "0.9.7"
    public_tag = "v0.9.7"
    events = @()
    failures_consumed = @()
  }
  switch ($Scenario) {
    "source-main-already-pushed" { $initial.source_main_pushed = $true }
    "source-tag-already-pushed" {
      $initial.source_main_pushed = $true; $initial.source_tag_pushed = $true
    }
    "releases-tag-already-created" {
      $initial.source_main_pushed = $true; $initial.source_tag_pushed = $true
      $initial.releases_tag_created = $true
      $initial.releases_tag_target = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
    "draft-already-created" {
      $initial.source_main_pushed = $true; $initial.source_tag_pushed = $true
      $initial.releases_tag_created = $true
      $initial.releases_tag_target = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      $initial.draft_created = $true
    }
    "assets-already-uploaded" {
      $initial.source_main_pushed = $true; $initial.source_tag_pushed = $true
      $initial.releases_tag_created = $true
      $initial.releases_tag_target = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      $initial.draft_created = $true
    }
    "wrong-source-tag-target" { $initial.source_tag_pushed = "wrong" }
    "existing-public-release-collision" { $initial.release_published = "foreign" }
    "public-manifest-tag-disagreement" { $initial.public_tag = "v0.9.8" }
  }
  Save-HarnessState $initial
  return Read-HarnessState
}
function Add-HarnessEvent([psobject]$State, [string]$Event) {
  $State.events = @($State.events) + $Event
  Save-HarnessState $State
}
function New-HarnessInspection([string]$Status, [string]$Proof, [hashtable]$Extra = @{}) {
  $evidence = [ordered]@{ proof = $Proof }
  foreach ($key in $Extra.Keys) { $evidence[$key] = $Extra[$key] }
  return [pscustomobject]@{ Status = $Status; Evidence = $evidence }
}
function Invoke-HarnessMutation([psobject]$State, [string]$Stage) {
  $State.$Stage = $true
  Add-HarnessEvent $State "apply:$Stage"
  if ($FailOnceAtStage -eq $Stage -and @($State.failures_consumed) -notcontains $Stage) {
    $State.failures_consumed = @($State.failures_consumed) + $Stage
    Save-HarnessState $State
    # Failure occurs AFTER the external side effect and BEFORE post-inspection/journaling.
    throw "injected post-side-effect failure at $Stage"
  }
}
function Invoke-HarnessGhProbe([string]$Outcome) {
  return Invoke-NativeProcess -Command "powershell.exe" -ArgumentList @(
    "-NoProfile", "-NonInteractive", "-File", $fakeGhPath, "-Outcome", $Outcome
  ) -TimeoutMs 20000
}

$state = Read-HarnessState
$receipt = [pscustomobject]@{
  schema_version = 3
  version = "9.9.9"
  commit = "1111111111111111111111111111111111111111"
  tag = "v9.9.9"
  installer = [pscustomobject]@{ path = $installerPath; sha256 = Get-HarnessHash $installerPath }
  signature = [pscustomobject]@{ path = $signaturePath; sha256 = Get-HarnessHash $signaturePath }
  manifest = [pscustomobject]@{ path = $manifestPath; sha256 = Get-HarnessHash $manifestPath }
}
switch ($Scenario) {
  "wrong-installer-hash" { $receipt.installer.sha256 = "0" * 64 }
  "wrong-manifest-hash" { $receipt.manifest.sha256 = "0" * 64 }
  "wrong-updater-signature" { Write-HarnessUtf8 $signaturePath "forged signature"; $receipt.signature.sha256 = Get-HarnessHash $signaturePath }
  "assets-already-uploaded" {
    Copy-HarnessAsset $installerPath $draftAssetsDir
    Copy-HarnessAsset $manifestPath $draftAssetsDir
  }
  "downloaded-draft-asset-mismatch" {
    if (-not (Test-Path -LiteralPath $draftAssetsDir)) { New-Item -ItemType Directory $draftAssetsDir | Out-Null }
    Write-HarnessUtf8 (Join-Path $draftAssetsDir (Split-Path -Leaf $installerPath)) "wrong draft bytes"
    Copy-HarnessAsset $manifestPath $draftAssetsDir
  }
  "downloaded-public-asset-mismatch" {
    if (-not (Test-Path -LiteralPath $publicAssetsDir)) { New-Item -ItemType Directory $publicAssetsDir | Out-Null }
    Write-HarnessUtf8 (Join-Path $publicAssetsDir (Split-Path -Leaf $installerPath)) "wrong public bytes"
    Copy-HarnessAsset $manifestPath $publicAssetsDir
  }
}
$ghOutcome = switch ($Scenario) {
  "authentication-failure" { "auth" }
  "permission-failure" { "permission" }
  "network-failure" { "network" }
  default { "" }
}
$ghArgumentsEncoder = {
  param([string[]]$GhArgs)
  $json = $GhArgs | ConvertTo-Json -Compress
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  return @(
    "-NoProfile", "-NonInteractive", "-File", $fakeGhPath,
    "-Outcome", $ghOutcome, "-StatePath", $statePath,
    "-FailOnceAtStage", $FailOnceAtStage, "-EncodedGhArgs", $encoded
  )
}.GetNewClosure()
$context = [pscustomobject]@{
  Receipt = $receipt
  State = $state
  InstallerPath = $installerPath
  SignaturePath = $signaturePath
  ManifestPath = $manifestPath
  InstallerName = Split-Path -Leaf $installerPath
  DraftAssetsDir = $draftAssetsDir
  PublicAssetsDir = $publicAssetsDir
  Dependencies = @{}
  Repo = $Sandbox
  ReleasesRepo = "sandbox/compy-releases"
  GhCommand = "powershell.exe"
  GhArgumentPrefix = @()
  GhArgumentsEncoder = $ghArgumentsEncoder
}

$dependencies = @{
  InspectReceipt = {
    param($ctx)
    if ((Get-HarnessHash $ctx.InstallerPath) -ne $ctx.Receipt.installer.sha256) { throw "wrong installer hash" }
    if ((Get-HarnessHash $ctx.SignaturePath) -ne $ctx.Receipt.signature.sha256) { throw "wrong signature hash" }
    if ((Get-HarnessHash $ctx.ManifestPath) -ne $ctx.Receipt.manifest.sha256) { throw "wrong manifest hash" }
    $expectedSignature = "signed:" + (Get-HarnessHash $ctx.InstallerPath)
    if ((Get-Content -LiteralPath $ctx.SignaturePath -Raw).Trim() -ne $expectedSignature) {
      throw "wrong updater signature"
    }
    $manifest = Get-Content -LiteralPath $ctx.ManifestPath -Raw | ConvertFrom-Json
    if ($manifest.signature -ne $expectedSignature) { throw "manifest signature mismatch" }
    if ($ctx.State.public_tag -ne "v$($ctx.State.public_version)") {
      throw "public manifest/tag version disagreement"
    }
    return New-HarnessInspection "complete" "real sandbox files, hashes, and signature verified"
  }
  InspectRuntime = {
    param($ctx)
    if ($ctx.State.runtime_proved -eq $true) { return New-HarnessInspection "complete" "sandbox runtime reverified" }
    return New-HarnessInspection "absent" "sandbox runtime absent"
  }
  ApplyRuntime = { param($ctx) Invoke-HarnessMutation $ctx.State "runtime_proved" }
  InspectSourceMain = {
    param($ctx)
    if ($ctx.State.source_main_pushed -eq $true) { return New-HarnessInspection "complete" "source main exact" }
    return New-HarnessInspection "absent" "source main fast-forwardable"
  }
  ApplySourceMain = { param($ctx) Invoke-HarnessMutation $ctx.State "source_main_pushed" }
  InspectSourceTag = {
    param($ctx)
    if ([string]$ctx.State.source_tag_pushed -eq "wrong") { throw "wrong source-tag target" }
    if ($ctx.State.source_tag_pushed -eq $true) { return New-HarnessInspection "complete" "annotated source tag exact" }
    return New-HarnessInspection "absent" "source tag absent"
  }
  ApplySourceTag = { param($ctx) Invoke-HarnessMutation $ctx.State "source_tag_pushed" }
  InspectReleasesTag = $null
  ApplyReleasesTag = $null
  InspectDraft = {
    param($ctx)
    $ctx.State = Read-HarnessState
    if ([string]$ctx.State.release_published -eq "foreign") { throw "existing public release collision" }
    if ($ctx.State.draft_created -eq $true -or $ctx.State.release_published -eq $true) {
      return New-HarnessInspection "complete" "compatible draft/public release exact"
    }
    return New-HarnessInspection "absent" "draft absent"
  }
  ApplyDraft = { param($ctx) Invoke-HarnessMutation $ctx.State "draft_created" }
  InspectDraftAssets = {
    param($ctx)
    $installerPresent = Test-HarnessAsset $ctx.InstallerPath $ctx.DraftAssetsDir -AllowAbsent
    $manifestPresent = Test-HarnessAsset $ctx.ManifestPath $ctx.DraftAssetsDir -AllowAbsent
    $missing = @()
    if (-not $installerPresent) { $missing += $ctx.InstallerName }
    if (-not $manifestPresent) { $missing += "latest.json" }
    $ctx | Add-Member -NotePropertyName MissingDraftAssets -NotePropertyValue $missing -Force
    if ($missing.Count -eq 0) { return New-HarnessInspection "complete" "downloaded draft assets byte-correct" }
    return New-HarnessInspection "absent" "missing draft assets" @{ missing = $missing }
  }
  ApplyDraftAssets = {
    param($ctx)
    foreach ($name in @($ctx.MissingDraftAssets)) {
      if ($name -eq $ctx.InstallerName) { Copy-HarnessAsset $ctx.InstallerPath $ctx.DraftAssetsDir }
      elseif ($name -eq "latest.json") { Copy-HarnessAsset $ctx.ManifestPath $ctx.DraftAssetsDir }
      if ($Scenario -eq "partial-draft-asset-resume" -and $name -eq $ctx.InstallerName -and
          @($ctx.State.failures_consumed) -notcontains "draft_assets_partial") {
        $ctx.State.failures_consumed = @($ctx.State.failures_consumed) + "draft_assets_partial"
        Add-HarnessEvent $ctx.State "apply:draft_assets_partial"
        throw "injected failure after first draft asset upload"
      }
    }
    Invoke-HarnessMutation $ctx.State "draft_assets_verified"
  }
  InspectPublished = {
    param($ctx)
    if ([string]$ctx.State.release_published -eq "foreign") { throw "existing public release collision" }
    if ($ctx.State.release_published -eq $true) { return New-HarnessInspection "complete" "public release exact" }
    return New-HarnessInspection "absent" "compatible verified draft remains private"
  }
  ApplyPublished = {
    param($ctx)
    # Publishing exposes the already-verified draft assets; there is no separate public-assets
    # mutation in production.
    Copy-HarnessAsset $ctx.InstallerPath $ctx.PublicAssetsDir
    Copy-HarnessAsset $ctx.ManifestPath $ctx.PublicAssetsDir
    if ($Scenario -eq "downloaded-public-asset-mismatch") {
      Write-HarnessUtf8 (Join-Path $ctx.PublicAssetsDir $ctx.InstallerName) "wrong public bytes"
    }
    Invoke-HarnessMutation $ctx.State "release_published"
  }
  InspectPublicAssets = {
    param($ctx)
    $installerPresent = Test-HarnessAsset $ctx.InstallerPath $ctx.PublicAssetsDir -AllowAbsent
    $manifestPresent = Test-HarnessAsset $ctx.ManifestPath $ctx.PublicAssetsDir -AllowAbsent
    if ($installerPresent -and $manifestPresent) {
      if ($FailOnceAtStage -eq "public_assets_verified" -and
          @($ctx.State.failures_consumed) -notcontains "public_assets_verified") {
        $ctx.State.failures_consumed = @($ctx.State.failures_consumed) + "public_assets_verified"
        Save-HarnessState $ctx.State
        throw "injected post-side-effect failure at public_assets_verified"
      }
      return New-HarnessInspection "complete" "downloaded public assets byte-correct"
    }
    return New-HarnessInspection "absent" "public asset propagation incomplete"
  }
  ApplyPublicAssets = {
    param($ctx)
    throw "Public assets are absent after publication; verification cannot manufacture them."
  }
}
$context.Dependencies = $dependencies
$adapter = New-ProductionReleaseAdapter -Dependencies $dependencies

try {
  $invoke = @{
    Context = $context
    Adapter = $adapter
    JournalPath = $journalPath
  }
  if ($AllowPublication) { $invoke.AllowPublication = $true }
  if ($StopAfterStage) { $invoke.StopAfterStage = $StopAfterStage }
  $result = Invoke-ReleaseTransaction @invoke
  $state = Read-HarnessState
  [pscustomobject]@{
    ok = $true
    scenario = $Scenario
    completed = $result.Completed
    stopped_after = $result.StoppedAfter
    stages = $result.Stages
    events = @($state.events)
    journal = $journalPath
    state = $statePath
  } | ConvertTo-Json -Depth 8 -Compress
  exit 0
} catch {
  [pscustomobject]@{
    ok = $false
    scenario = $Scenario
    error = $_.Exception.Message
    journal = $journalPath
    state = $statePath
  } | ConvertTo-Json -Depth 8 -Compress
  exit 1
}
