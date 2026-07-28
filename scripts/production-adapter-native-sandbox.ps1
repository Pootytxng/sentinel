# Sandboxed integration driver for New-ProductionReleaseAdapter.
#
# The real production adapter and transaction engine run every stage. Only the installed-runtime
# primitive is injected, because the production implementation is currently bound to the owner's
# fixed LOCALAPPDATA path and HKCU uninstall key. Git and GitHub still cross the native-process
# boundary: small Node programs stand in for their remote transports and persist external state in
# this temporary sandbox. Public downloads are redirected to the sandbox's immutable asset store.
#
# This file is ASCII-only for Windows PowerShell 5.1.
param(
  [Parameter(Mandatory = $true)][string]$Sandbox,
  [ValidateSet(
    "happy", "authentication-failure", "permission-failure", "network-failure",
    "wrong-source-tag", "wrong-installer-hash", "wrong-manifest-hash",
    "wrong-updater-signature", "public-release-collision",
    "downloaded-draft-mismatch", "downloaded-public-mismatch",
    "adopt-existing-draft", "incompatible-existing-draft", "duplicate-release",
    "paginated-release-list", "unpaginated-release-list",
    "malformed-release-list", "empty-release-list", "wrong-shape-release-list"
  )][string]$Scenario = "happy"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
. (Join-Path $PSScriptRoot "lib\release-artifacts.ps1")
. (Join-Path $PSScriptRoot "lib\release-transaction.ps1")
. (Join-Path $PSScriptRoot "lib\release-publish-adapter.ps1")

if (-not (Test-Path -LiteralPath $Sandbox -PathType Container)) {
  New-Item -ItemType Directory -Path $Sandbox | Out-Null
}
$Sandbox = (Resolve-Path -LiteralPath $Sandbox).Path
$statePath = Join-Path $Sandbox "native-remote-state.json"
$journalPath = Join-Path $Sandbox "native-release-transaction.json"
$fakeGitPath = Join-Path $Sandbox "fake-git.mjs"
$fakeGhPath = Join-Path $Sandbox "fake-gh.mjs"
$callsPath = Join-Path $Sandbox "native-calls.jsonl"
$assetStore = Join-Path $Sandbox "remote-assets"
$repo = Join-Path $Sandbox "source"
$scriptDir = Join-Path $repo "scripts"
$tauriDir = Join-Path $repo "src-tauri"
$installer = Join-Path $Sandbox "Compy_9.9.9_x64-setup.exe"
$signature = "$installer.sig"
$manifest = Join-Path $Sandbox "latest.json"

function Write-SandboxUtf8 {
  param([string]$Path, [string]$Text)
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-SandboxHash {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

foreach ($directory in @($repo, $scriptDir, $tauriDir, $assetStore)) {
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
}

if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  Write-SandboxUtf8 $installer "sandbox installer bytes bound to v9.9.9"
}
$installerHash = Get-SandboxHash $installer
$signatureText = "sandbox-signature:$installerHash"
Write-SandboxUtf8 $signature $signatureText
$releasesRepo = "sandbox/compy-releases"
Write-SandboxUtf8 $manifest ([ordered]@{
  version = "9.9.9"
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      url = "https://github.com/$releasesRepo/releases/download/v9.9.9/$(Split-Path -Leaf $installer)"
      signature = $signatureText
    }
  }
} | ConvertTo-Json -Depth 6 -Compress)
Write-SandboxUtf8 (Join-Path $tauriDir "tauri.conf.json") '{"version":"9.9.9"}'

Write-SandboxUtf8 (Join-Path $scriptDir "verify-updater-signature.mjs") @'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const [artifact, signature] = process.argv.slice(2);
const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
const actual = readFileSync(signature, "utf8").trim();
if (actual !== `sandbox-signature:${digest}`) {
  console.error("sandbox signature mismatch");
  process.exit(1);
}
console.log("sandbox signature verified");
'@

$releaseCommit = "1111111111111111111111111111111111111111"
$sourceDescendant = "5555555555555555555555555555555555555555"
$sourceBase = "2222222222222222222222222222222222222222"
$sourceTagObject = "3333333333333333333333333333333333333333"
$releasesMain = "4444444444444444444444444444444444444444"
$releaseTag = "v9.9.9"
$releaseNotes = "Sandbox production-adapter integration."

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
  $existingRelease = @(
    "public-release-collision", "downloaded-draft-mismatch",
    "adopt-existing-draft", "incompatible-existing-draft"
  ) -contains $Scenario
  $listFailure = switch ($Scenario) {
    "unpaginated-release-list" { "unpaginated" }
    "malformed-release-list" { "malformed" }
    "empty-release-list" { "empty" }
    "wrong-shape-release-list" { "shape" }
    default { "" }
  }
  # Two releases carrying the same tag: the ambiguity a by-tag lookup can never see.
  $extraReleases = if ($Scenario -eq "duplicate-release") {
    @(
      @{ id = 771001; tag_name = $releaseTag; name = "Compy $releaseTag"; body = $releaseNotes; draft = $true; prerelease = $false },
      @{ id = 771002; tag_name = $releaseTag; name = "Compy $releaseTag"; body = $releaseNotes; draft = $false; prerelease = $false }
    )
  } else { @() }
  Write-SandboxUtf8 $statePath (@{
    releaseCommit = $releaseCommit
    sourceDescendant = $sourceDescendant
    sourceBase = $sourceBase
    sourceMain = $sourceBase
    sourceTag = $releaseTag
    sourceTagObject = $sourceTagObject
    remoteSourceTagObject = if ($Scenario -eq "wrong-source-tag") { "9999999999999999999999999999999999999999" } else { $sourceTagObject }
    remoteSourceTagCommit = $releaseCommit
    sourceTagPushed = ($Scenario -eq "wrong-source-tag")
    releasesMain = $releasesMain
    releasesTagCreated = $existingRelease
    draftCreated = $existingRelease
    published = ($Scenario -eq "public-release-collision")
    releaseId = 990099
    padCount = if ($Scenario -eq "paginated-release-list") { 150 } else { 0 }
    extraReleases = $extraReleases
    listFailure = $listFailure
    title = if ($Scenario -eq "public-release-collision") { "Foreign release" } elseif ($existingRelease) { "Compy $releaseTag" } else { "" }
    notes = if ($Scenario -eq "public-release-collision") { "foreign" } elseif ($Scenario -eq "incompatible-existing-draft") { "notes that are not the signed receipt notes" } elseif ($existingRelease) { $releaseNotes } else { "" }
    ghFailure = if ($Scenario -like "*-failure") { $Scenario } else { "" }
    assetStore = $assetStore
    callsPath = $callsPath
  } | ConvertTo-Json -Depth 8)
}
if ($Scenario -eq "downloaded-draft-mismatch") {
  Write-SandboxUtf8 (Join-Path $assetStore (Split-Path -Leaf $installer)) "wrong draft bytes"
  Copy-Item -LiteralPath $manifest -Destination (Join-Path $assetStore "latest.json")
}

Write-SandboxUtf8 $fakeGitPath @'
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [statePath, ...raw] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(state.callsPath, `${JSON.stringify({tool:"git",args:raw})}\n`);
let args = raw;
if (args[0] === "-C") args = args.slice(2);
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (args[0] === "fetch") process.exit(0);
if (args[0] === "rev-parse" && args[1] === "origin/main") {
  console.log(state.sourceMain);
  process.exit(0);
}
if (args[0] === "rev-parse" && args[1] === state.sourceTag) {
  console.log(state.sourceTagObject);
  process.exit(0);
}
if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
  const ancestor = args[2] === "origin/main" ? state.sourceMain : args[2];
  const descendant = args[3] === "origin/main" ? state.sourceMain : args[3];
  if (ancestor === descendant) process.exit(0);
  if (ancestor === state.sourceBase && descendant === state.releaseCommit) process.exit(0);
  if (ancestor === state.releaseCommit && descendant === state.sourceMain &&
      [state.releaseCommit, state.sourceDescendant].includes(state.sourceMain)) process.exit(0);
  process.exit(1);
}
if (args[0] === "push" && args.includes(`${state.releaseCommit}:main`)) {
  state.sourceMain = state.releaseCommit;
  save();
  process.exit(0);
}
if (args[0] === "push" && args.includes(`refs/tags/${state.sourceTag}`)) {
  state.sourceTagPushed = true;
  save();
  process.exit(0);
}
if (args[0] === "ls-remote") {
  if (state.sourceTagPushed) {
    console.log(`${state.remoteSourceTagObject}\trefs/tags/${state.sourceTag}`);
    console.log(`${state.remoteSourceTagCommit}\trefs/tags/${state.sourceTag}^{}`);
  }
  process.exit(0);
}
console.error(`unsupported fake git invocation: ${args.join(" ")}`);
process.exit(12);
'@

Write-SandboxUtf8 $fakeGhPath @'
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
const [statePath, ...args] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(state.callsPath, `${JSON.stringify({tool:"gh",args})}\n`);
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (state.ghFailure) {
  const failures = {
    "authentication-failure": "gh: Bad credentials (HTTP 401)",
    "permission-failure": "gh: Resource not accessible (HTTP 403)",
    "network-failure": "gh: error connecting to api.github.com",
  };
  console.error(failures[state.ghFailure]);
  process.exit(1);
}
const notFound = () => {
  console.error("gh: Not Found (HTTP 404)");
  process.exit(1);
};
const releaseObject = () => ({
  id: state.releaseId,
  tag_name: state.sourceTag,
  name: state.title,
  body: state.notes,
  draft: !state.published,
  prerelease: false,
  published_at: state.published ? "2026-07-28T00:00:00Z" : null,
  assets: existsSync(state.assetStore)
    ? ["Compy_9.9.9_x64-setup.exe", "latest.json"]
        .filter((name) => existsSync(join(state.assetStore, name)))
        .map((name, index) => ({id: index + 1, name}))
    : [],
});
// Real GitHub visibility, which the previous fake did not model: a DRAFT release is absent from
// the by-tag endpoint (HTTP 404) and is reachable only by numeric id or through the authenticated
// releases list. Padding entries sit BEFORE the real release so a client that stops after page one
// fails to find a release that demonstrably exists.
const asArray = (value) => {
  // Windows PowerShell 5.1 serializes an EMPTY array inside a hashtable as {} (sometimes as
  // {"value":[],"Count":0}) and a one-item array as a bare object, so every shape is normalized
  // back to a list here and only entries that actually carry a release id survive.
  const list = Array.isArray(value)
    ? value
    : value && Array.isArray(value.value)
      ? value.value
      : value ? [value] : [];
  return list.filter((entry) => entry && entry.id);
};
const listReleases = () => {
  const releases = [];
  for (let index = 0; index < (state.padCount || 0); index += 1) {
    releases.push({
      id: 500000 + index, tag_name: `v0.0.${index}`, name: `pad ${index}`,
      body: "pad", draft: false, prerelease: false, assets: [],
    });
  }
  if (state.draftCreated) releases.push(releaseObject());
  for (const extra of asArray(state.extraReleases)) releases.push({assets: [], ...extra});
  return releases;
};
if (args[0] === "api" && args[1].endsWith("/commits/main")) {
  console.log(JSON.stringify({sha: state.releasesMain}));
  process.exit(0);
}
if (args[0] === "api" && args[1].includes("/git/ref/tags/")) {
  if (!state.releasesTagCreated) notFound();
  console.log(JSON.stringify({object:{sha:state.releasesMain}}));
  process.exit(0);
}
if (args[0] === "api" && args[1].endsWith("/git/refs")) {
  const sha = args.find((value) => value.startsWith("sha="))?.slice(4);
  const ref = args.find((value) => value.startsWith("ref="))?.slice(4);
  if (sha !== state.releasesMain || ref !== `refs/tags/${state.sourceTag}`) {
    console.error("incompatible create-ref request");
    process.exit(13);
  }
  state.releasesTagCreated = true;
  save();
  console.log(JSON.stringify({ref, object:{sha}}));
  process.exit(0);
}
if (args[0] === "api" && args[1].includes("/releases?")) {
  if (state.listFailure === "malformed") { console.log("[{\"id\": 1, "); process.exit(0); }
  if (state.listFailure === "empty") { process.exit(0); }
  if (state.listFailure === "shape") { console.log(JSON.stringify({message: "not an array"})); process.exit(0); }
  const perPage = Number((args[1].match(/per_page=(\d+)/) || [])[1] || 30);
  const page = Number((args[1].match(/[?&]page=(\d+)/) || [])[1] || 1);
  if (state.listFailure === "unpaginated") {
    // Every page is full, so the listing never ends: an honest client must refuse, not guess.
    const filler = [];
    for (let index = 0; index < perPage; index += 1) {
      filler.push({id: page * 1000 + index, tag_name: `v0.0.${page}-${index}`, draft: false, prerelease: false, assets: []});
    }
    console.log(JSON.stringify(filler));
    process.exit(0);
  }
  const all = listReleases();
  console.log(JSON.stringify(all.slice((page - 1) * perPage, page * perPage)));
  process.exit(0);
}
const byId = args[0] === "api" ? args[1].match(/\/releases\/(\d+)$/) : null;
if (byId) {
  const found = listReleases().find((release) => release.id === Number(byId[1]));
  if (!found) notFound();
  console.log(JSON.stringify(found));
  process.exit(0);
}
if (args[0] === "api" && args[1].includes("/releases/tags/")) {
  // GitHub answers 404 here for a draft that exists. v0.9.11 failed on exactly this.
  if (!state.draftCreated || !state.published) notFound();
  console.log(JSON.stringify(releaseObject()));
  process.exit(0);
}
if (args[0] === "release" && args[1] === "create") {
  if (!state.releasesTagCreated) {
    console.error("release tag missing");
    process.exit(14);
  }
  if (state.draftCreated) {
    // Real GitHub refuses a second release for one tag; adopting the existing draft is the only
    // correct resume behaviour, so a duplicate-create attempt must fail loudly here.
    console.error("gh: Validation Failed (HTTP 422): a release for tag v9.9.9 already exists");
    process.exit(1);
  }
  state.draftCreated = true;
  state.title = args[args.indexOf("--title") + 1];
  state.notes = args[args.indexOf("--notes") + 1];
  save();
  console.log("sandbox draft created");
  process.exit(0);
}
if (args[0] === "release" && args[1] === "upload") {
  mkdirSync(state.assetStore, {recursive:true});
  const repoIndex = args.indexOf("--repo");
  const inputs = args.slice(repoIndex + 2);
  for (const input of inputs) copyFileSync(input, join(state.assetStore, basename(input)));
  save();
  console.log("sandbox assets uploaded");
  process.exit(0);
}
if (args[0] === "release" && args[1] === "download") {
  const directory = args[args.indexOf("--dir") + 1];
  const pattern = args[args.indexOf("--pattern") + 1];
  mkdirSync(directory, {recursive:true});
  copyFileSync(join(state.assetStore, pattern), join(directory, pattern));
  process.exit(0);
}
if (args[0] === "release" && args[1] === "edit" && args.includes("--draft=false")) {
  if (!state.draftCreated) notFound();
  state.published = true;
  save();
  console.log("sandbox release published");
  process.exit(0);
}
console.error(`unsupported fake gh invocation: ${args.join(" ")}`);
process.exit(15);
'@

$node = (Resolve-NativeExecutable "node").Source
$downloadFile = {
  param([string]$Uri, [string]$OutFile)
  $name = if ($Uri -like "*/latest/download/latest.json") {
    "latest.json"
  } else {
    [System.IO.Path]::GetFileName(([uri]$Uri).AbsolutePath)
  }
  $source = Join-Path $assetStore $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Sandbox public asset is absent: $name"
  }
  Copy-Item -LiteralPath $source -Destination $OutFile
  if ($Scenario -eq "downloaded-public-mismatch" -and $name -like "*.exe") {
    Write-SandboxUtf8 $OutFile "wrong public bytes"
  }
}.GetNewClosure()

$receipt = [pscustomobject]@{
  schema_version = 3
  version = "9.9.9"
  commit = $releaseCommit
  tag = $releaseTag
  installer = [pscustomobject]@{ sha256 = Get-SandboxHash $installer }
  signature = [pscustomobject]@{ sha256 = Get-SandboxHash $signature }
  manifest = [pscustomobject]@{ sha256 = Get-SandboxHash $manifest }
}
if ($Scenario -eq "wrong-installer-hash") { $receipt.installer.sha256 = "0" * 64 }
if ($Scenario -eq "wrong-manifest-hash") { $receipt.manifest.sha256 = "0" * 64 }
if ($Scenario -eq "wrong-updater-signature") {
  Write-SandboxUtf8 $signature "forged signature"
  $receipt.signature.sha256 = Get-SandboxHash $signature
  $manifestValue = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  $manifestValue.platforms.'windows-x86_64'.signature = "forged signature"
  Write-SandboxUtf8 $manifest ($manifestValue | ConvertTo-Json -Depth 6 -Compress)
  $receipt.manifest.sha256 = Get-SandboxHash $manifest
}

$validateReceipt = {
  param($context)
  Assert-ReceiptHash "Installer" $context.Installer $context.Receipt.installer.sha256
  Assert-ReceiptHash "Signature" $context.Signature $context.Receipt.signature.sha256
  Assert-ReceiptHash "Manifest" $context.Manifest $context.Receipt.manifest.sha256
  $null = Read-BoundManifest $context.Manifest $context.Signature `
    $context.Receipt.version $context.InstallerName
  Invoke-ProductionSignatureVerification $context "sandbox receipt signature verification" $context.Installer
}.GetNewClosure()

$runtimeInspector = {
  param($context)
  return New-ProductionInspection "complete" @{
    installed_version = $context.Receipt.version
    embedded_short_commit = $context.Receipt.commit.Substring(0, 7)
    sandbox_runtime = $true
  }
}.GetNewClosure()

$context = [pscustomobject]@{
  Receipt = $receipt
  Repo = $repo
  Installer = $installer
  Signature = $signature
  Manifest = $manifest
  InstallerName = Split-Path -Leaf $installer
  ReleaseNotes = $releaseNotes
  ReleasesRepo = $releasesRepo
  ValidateReceipt = $validateReceipt
  AssertPublicVersion = { param($context); if ($context.Receipt.version -ne "9.9.9") { throw "version drift" } }
  GhCommand = $node
  GhArgumentPrefix = @($fakeGhPath, $statePath)
  GitCommand = $node
  GitArgumentPrefix = @($fakeGitPath, $statePath)
  DownloadFile = $downloadFile
  RuntimeInspector = $runtimeInspector
  Dependencies = @{}
}

# Every transaction stage uses its production handler. Only primitive transports are redirected.
$adapter = New-ProductionReleaseAdapter
$first = Invoke-ReleaseTransaction -Context $context -Adapter $adapter `
  -JournalPath $journalPath -AllowPublication

# A second complete pass proves the journal is evidence only: every production Inspect handler
# re-runs against fake external state, while no mutating Git/GitHub operation is repeated. Advance
# source main to a normal repair descendant first: the receipt/tag/artifacts remain exact.
$retryState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$retryState.sourceMain = $retryState.sourceDescendant
Write-SandboxUtf8 $statePath ($retryState | ConvertTo-Json -Depth 8)
$beforeRetry = @(Get-Content -LiteralPath $callsPath | ForEach-Object { $_ | ConvertFrom-Json })
$second = Invoke-ReleaseTransaction -Context $context -Adapter $adapter `
  -JournalPath $journalPath -AllowPublication
$afterRetry = @(Get-Content -LiteralPath $callsPath | ForEach-Object { $_ | ConvertFrom-Json })

$mutations = @($afterRetry | Where-Object {
  ($_.tool -eq "git" -and $_.args[2] -eq "push") -or
  ($_.tool -eq "gh" -and (
    ($_.args[0] -eq "api" -and $_.args[1] -like "*/git/refs") -or
    ($_.args[0] -eq "release" -and @("create", "upload", "edit") -contains $_.args[1])
  ))
})

[pscustomobject]@{
  ok = $true
  first_stages = @($first.Stages)
  retry_stages = @($second.Stages)
  calls_before_retry = $beforeRetry.Count
  calls_after_retry = $afterRetry.Count
  mutation_calls = @($mutations)
  calls = @($afterRetry)
  journal = $journalPath
  state = (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)
} | ConvertTo-Json -Depth 12 -Compress
