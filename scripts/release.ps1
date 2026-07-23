# release.ps1 - fail-closed two-phase Compy updater release pipeline (engine for the two-command
# interface: scripts/release-prepare.ps1 and scripts/release-publish.ps1 are thin wrappers over the
# -Mode stage / -Mode publish paths below; prefer those so the two operations can't be confused).
#
# Reconcile 2026-07-23 (Phase 3) added, on top of the fail-closed base: stage + publish both refuse a
# pending Gaming Mode session/recovery record (a cleanly-cleared .bak backup does NOT count); stage
# verifies the built exe EMBEDS the release commit stamp before writing the receipt; the receipt
# records installer size + SHA-256; stage creates a pre-existing annotated source tag at the exact
# release commit; publish requires that tag, pushes it, and creates the GitHub release with --verify-tag.
#
# Phase 1 (default) prepares a signed, locally verified release candidate and writes an
# immutable receipt. It never installs, pushes, or publishes anything:
#   powershell -NoProfile -File .\scripts\release.ps1 -Notes "Plain-English notes"
#
# Phase 2 is an explicit owner ship action. It consumes the exact staged receipt, installs
# that artifact locally, pushes its exact source, creates and re-downloads a draft release,
# and only then makes the draft public:
#   powershell -NoProfile -File .\scripts\release.ps1 -Mode publish
#
# ASCII only: Windows PowerShell 5.1 must not reinterpret this release-critical script.
param(
  [ValidateSet("stage", "publish")][string]$Mode = "stage",
  [string]$Notes,
  [string]$SetVersion,
  [switch]$BumpMinor
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releasesRepo = "Pootytxng/compy-releases"
$bundleDir = Join-Path $repo "src-tauri\target\release\bundle\nsis"
$stageReceiptPath = Join-Path $bundleDir "release-stage.json"
$stageReceiptSignaturePath = "$stageReceiptPath.sig"
$trustRootPath = Join-Path $repo "scripts\updater-trust-root.json"
$pinnedFleetTrustRootSha256 = "a9b2df7ea775a4a3a095791222e781b2629ef2bafa077d2f0e89be99bf50662e"
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

function Write-NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Native([string]$Label, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed (exit $LASTEXITCODE)"
  }
}

function Get-GitLine([string[]]$Arguments) {
  $output = & git -C $repo @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed (exit $LASTEXITCODE)"
  }
  return (($output | Out-String).Trim())
}

function Assert-CleanMain {
  $dirty = @(& git -C $repo status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)" }
  if ($dirty.Count -gt 0) {
    throw "Release refused: the worktree is not clean.`n$($dirty -join [Environment]::NewLine)"
  }

  $branch = (& git -C $repo branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0) { throw "git branch --show-current failed (exit $LASTEXITCODE)" }
  if ($branch -ne "main") {
    throw "Release refused: branch is '$branch'; releases must run from main."
  }
}

function Assert-StageStartsAtRemoteMain {
  Assert-CleanMain
  Invoke-Native "git fetch origin main" { git -C $repo fetch origin main }
  $head = Get-GitLine @("rev-parse", "HEAD")
  $remote = Get-GitLine @("rev-parse", "origin/main")
  if ($head -ne $remote) {
    throw "Release refused: local main is not synchronized with origin/main. HEAD=$head origin/main=$remote"
  }
}

function Assert-NoPendingGamingContract([string]$Phase) {
  # An active Gaming Mode session or a pending recovery record means temporary Windows changes may
  # still be un-restored — never bump a version or publish over that. Same definition ship-reinstall
  # uses: any `gaming-session*` contract blocks EXCEPT a cleanly-cleared backup
  # (gaming-session.cleared-<ts>.json.bak), which is the app's own "already restored" marker.
  $dir = Join-Path $env:APPDATA "Compy"
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return }
  $pending = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop |
    Where-Object { $_.Name -like "gaming-session*" } |
    Where-Object { $_.Name -notlike "*.cleared-*.json.bak" })
  if ($pending.Count -gt 0) {
    throw "Release refused ($Phase): a pending Gaming Mode session/recovery record exists ($($pending.Name -join ', ')). Return to normal or recover it in the app, confirm the contract clears, then retry."
  }
}

function Get-ArtifactHash([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Release artifact is missing: $Path"
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-ReceiptArtifact([string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($RelativePath)) {
    throw "Staged receipt contains an empty artifact path."
  }
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $repo $RelativePath))
  $rootPrefix = $repo.TrimEnd('\') + '\'
  if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Staged receipt artifact escapes the repository: $RelativePath"
  }
  return $candidate
}

function Assert-ReceiptHash([string]$Label, [string]$Path, [string]$Expected) {
  $actual = Get-ArtifactHash $Path
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "$Label hash changed after staging. Expected $Expected; found $actual."
  }
}

function Assert-UpdaterTrustRoot {
  if (-not (Test-Path -LiteralPath $trustRootPath -PathType Leaf)) {
    throw "UPDATER TRUST-ROOT DRIFT: machine-readable fleet anchor is missing."
  }
  $anchor = Get-Content -LiteralPath $trustRootPath -Raw | ConvertFrom-Json
  $conf = Get-Content -LiteralPath (Join-Path $repo "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  if ($anchor.schema_version -ne 1 -or [string]::IsNullOrWhiteSpace($anchor.public_key)) {
    throw "UPDATER TRUST-ROOT DRIFT: unsupported or empty fleet anchor."
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $anchorHash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$anchor.public_key)) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
  }
  if ($anchorHash -ne $pinnedFleetTrustRootSha256 -or
      $anchor.public_key_sha256 -ne $pinnedFleetTrustRootSha256 -or
      $conf.plugins.updater.pubkey -ne $anchor.public_key) {
    throw "UPDATER TRUST-ROOT DRIFT: normal releases must keep the v0.9.4 fleet key. Follow docs/UPDATER_TRUST_ROOT.md for an owner-approved bridge rotation."
  }
}

function Read-BoundManifest([string]$Path, [string]$SignaturePath, [string]$Version, [string]$InstallerName) {
  $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($manifest.version -ne $Version) {
    throw "Manifest version $($manifest.version) does not match staged version $Version."
  }
  $platform = $manifest.platforms.'windows-x86_64'
  if (-not $platform) {
    throw "Manifest has no windows-x86_64 updater entry."
  }
  $expectedUrl = "https://github.com/$releasesRepo/releases/download/v$Version/$InstallerName"
  if ($platform.url -ne $expectedUrl) {
    throw "Manifest URL does not bind the staged release. Expected $expectedUrl; found $($platform.url)."
  }
  $signatureText = (Get-Content -LiteralPath $SignaturePath -Raw).Trim()
  if ($platform.signature -ne $signatureText) {
    throw "Manifest signature does not match the staged updater signature."
  }
  return $manifest
}

function Invoke-DownloadWithRetry([string]$Uri, [string]$OutFile) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
      return
    } catch {
      $lastError = $_
      if ($attempt -lt 6) { Start-Sleep -Seconds 5 }
    }
  }
  throw "Public release download failed after retries: $Uri`n$lastError"
}

function Assert-PublicVersionCanPublish([string]$CandidateVersion, [string]$CandidateTag, [switch]$AllowOwnDraft) {
  $releaseListText = (& gh release list --repo $releasesRepo --limit 1000 --json tagName,isDraft,isPrerelease,publishedAt | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not query the releases repository. Authentication/network failure is not treated as an absent tag."
  }
  $releaseList = @($releaseListText | ConvertFrom-Json)
  $sameTag = @($releaseList | Where-Object { $_.tagName -eq $CandidateTag })
  if ($AllowOwnDraft) {
    if ($sameTag.Count -ne 1 -or -not $sameTag[0].isDraft -or $sameTag[0].isPrerelease) {
      throw "Expected exactly one private draft for $CandidateTag immediately before publication."
    }
  } elseif ($sameTag.Count -gt 0) {
    throw "Release $CandidateTag already exists. Refusing to overwrite or republish it."
  }

  $latestPublished = $releaseList |
    Where-Object { -not $_.isDraft -and -not $_.isPrerelease -and $_.publishedAt } |
    Sort-Object { [datetime]$_.publishedAt } -Descending |
    Select-Object -First 1
  if (-not $latestPublished) { return }
  if ($latestPublished.tagName -notmatch '^v(\d+\.\d+\.\d+)$') {
    throw "Latest published tag is not semantic versioned: $($latestPublished.tagName)"
  }
  $latestTagVersion = [version]$Matches[1]
  $currentPublicDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-current-public-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $currentPublicDir | Out-Null
  try {
    $currentPublicManifestPath = Join-Path $currentPublicDir "latest.json"
    Invoke-DownloadWithRetry "https://github.com/$releasesRepo/releases/latest/download/latest.json" $currentPublicManifestPath
    $currentPublicManifest = Get-Content -LiteralPath $currentPublicManifestPath -Raw | ConvertFrom-Json
    $currentPublicVersion = [version]$currentPublicManifest.version
    if ($currentPublicVersion -ne $latestTagVersion) {
      throw "Public updater manifest $currentPublicVersion disagrees with latest tag $latestTagVersion."
    }
    if ([version]$CandidateVersion -le $currentPublicVersion) {
      throw "Refusing updater downgrade/non-increase: staged=$CandidateVersion public=$currentPublicVersion."
    }
  } finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedCurrentPublicDir = [System.IO.Path]::GetFullPath($currentPublicDir)
    if ($resolvedCurrentPublicDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedCurrentPublicDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-TauriSigned([string]$KeyPath, [string[]]$NpmArgs, [string]$Label) {
  # GRANDFATHERED FLEET ANCHOR (reconcile 2026-07-23, owner-approved): the pinned fleet key
  # (docs/UPDATER_TRUST_ROOT.md) is passwordless, and normal releases MUST use it. The tauri CLI
  # needs TAURI_SIGNING_PRIVATE_KEY_PASSWORD PRESENT-BUT-EMPTY, which PowerShell/.NET cannot express
  # (assigning "" deletes the var), so route every signing build/sign through a node shim whose spawn
  # env carries the present-but-empty value. A future password-protected key is honored transparently
  # (a non-empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD in the environment passes through). The real gate
  # stays cryptographic: the sign-probe + the trust-root pubkey pin reject any key that is not the
  # exact fleet anchor, with or without a password.
  # Everything is passed via ENV (key content + the command as a JSON array), never node argv or an
  # inline `node -e` script: PowerShell mangles the double-quotes when handing an inline script to
  # node.exe, and `node -e SCRIPT ... -- ...` also swallows the `--` that `signer sign` needs. The
  # shim is written to a temp `.cjs` file (`.cjs` because package.json is type:module) and run as
  # `node <file>`, which is quote-safe.
  $shimBody = @"
const { spawnSync } = require("child_process");
const a = JSON.parse(process.env.COMPY_SIGN_ARGS);
// shell:true is required to launch npm.cmd, but Node does NOT quote the exe/args for it, so a
// spaced path (C:\Program Files\nodejs\npm.cmd) or a spaced artifact path would be split by cmd.exe.
// Pass a single command string with every whitespace-bearing token quoted; cmd.exe /s + Node's own
// outer quotes then hand each token through intact.
const cmd = a.map(s => /\s/.test(s) ? '"' + s + '"' : s).join(" ");
const r = spawnSync(cmd, {
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: process.env.COMPY_SIGN_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "" },
  stdio: "inherit",
  shell: true,
});
process.exit(r.status === null ? 1 : r.status);
"@
  $shimPath = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-sign-shim-" + [guid]::NewGuid().ToString("N") + ".cjs")
  [System.IO.File]::WriteAllText($shimPath, $shimBody, (New-Object System.Text.UTF8Encoding($false)))
  # TAURI_SIGNING_PRIVATE_KEY carries the key CONTENT, not the path: `tauri signer sign` (used by the
  # sign-probe preflight and receipt signing) treats the env value as literal base64 key material and
  # never path-resolves it, so a path here fails with "failed to decode base64 secret key". Content is
  # accepted uniformly by both `signer sign` and `tauri build`.
  $env:COMPY_SIGN_KEY = (Get-Content -LiteralPath $KeyPath -Raw).Trim()
  $env:COMPY_SIGN_ARGS = (,$npmCmd + $NpmArgs | ConvertTo-Json -Compress)
  try {
    Invoke-Native $Label { & node $shimPath }
  } finally {
    Remove-Item Env:\COMPY_SIGN_KEY, Env:\COMPY_SIGN_ARGS -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $shimPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ProtectedSigner([string]$Path, [string]$KeyPath, [string]$Label) {
  Invoke-TauriSigned $KeyPath @("run", "tauri", "--", "signer", "sign", $Path) $Label
}

Assert-UpdaterTrustRoot

if ($Mode -eq "publish") {
  if ($Notes -or $SetVersion -or $BumpMinor) {
    throw "Publish consumes an existing staged receipt; do not pass Notes, SetVersion, or BumpMinor."
  }

  Assert-CleanMain
  Assert-NoPendingGamingContract "publish"
  if (-not (Test-Path -LiteralPath $stageReceiptPath -PathType Leaf)) {
    throw "No staged release receipt found at $stageReceiptPath. Run stage mode first."
  }

  $receipt = Get-Content -LiteralPath $stageReceiptPath -Raw | ConvertFrom-Json
  if ($receipt.schema_version -ne 3) {
    throw "Unsupported staged receipt schema: $($receipt.schema_version)"
  }

  $head = Get-GitLine @("rev-parse", "HEAD")
  if ($head -ne $receipt.commit) {
    throw "HEAD does not match staged commit. HEAD=$head staged=$($receipt.commit)"
  }

  $conf = Get-Content -LiteralPath (Join-Path $repo "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  if ($conf.version -ne $receipt.version) {
    throw "Source version $($conf.version) does not match staged version $($receipt.version)."
  }

  # Pre-existing tag gate (Phase 3 #4): the annotated tag from stage must ALREADY point at the exact
  # release commit before publish will push source or create the release.
  if ([string]::IsNullOrWhiteSpace($receipt.tag)) { throw "Staged receipt has no release tag." }
  if ($receipt.tag -ne "v$($receipt.version)") { throw "Staged tag $($receipt.tag) does not match version v$($receipt.version)." }
  $tagCommit = Get-GitLine @("rev-parse", "$($receipt.tag)^{commit}")
  if ($tagCommit -ne $receipt.commit) {
    throw "Release tag $($receipt.tag) does not point at the staged commit. tag=$tagCommit staged=$($receipt.commit)"
  }

  if (-not (Test-Path -LiteralPath $stageReceiptSignaturePath -PathType Leaf)) {
    throw "Staged receipt signature is missing: $stageReceiptSignaturePath"
  }
  Invoke-Native "staged receipt signature verification" {
    node (Join-Path $repo "scripts\verify-updater-signature.mjs") $stageReceiptPath $stageReceiptSignaturePath (Join-Path $repo "src-tauri\tauri.conf.json")
  }

  $canonicalInstallerRelative = "src-tauri/target/release/bundle/nsis/Compy_$($receipt.version)_x64-setup.exe"
  $canonicalSignatureRelative = "$canonicalInstallerRelative.sig"
  $canonicalManifestRelative = "src-tauri/target/release/bundle/nsis/latest.json"
  if ($receipt.installer.path -ne $canonicalInstallerRelative -or
      $receipt.signature.path -ne $canonicalSignatureRelative -or
      $receipt.manifest.path -ne $canonicalManifestRelative) {
    throw "Staged receipt artifact paths are not the canonical paths for v$($receipt.version)."
  }

  $installer = Resolve-ReceiptArtifact $receipt.installer.path
  $signature = Resolve-ReceiptArtifact $receipt.signature.path
  $manifestPath = Resolve-ReceiptArtifact $receipt.manifest.path
  Assert-ReceiptHash "Installer" $installer $receipt.installer.sha256
  Assert-ReceiptHash "Updater signature" $signature $receipt.signature.sha256
  Assert-ReceiptHash "Updater manifest" $manifestPath $receipt.manifest.sha256

  $installerName = Split-Path -Leaf $installer
  $manifest = Read-BoundManifest $manifestPath $signature $receipt.version $installerName
  Invoke-Native "publish-time updater signature verification" {
    node (Join-Path $repo "scripts\verify-updater-signature.mjs") $installer $signature (Join-Path $repo "src-tauri\tauri.conf.json")
  }

  $tag = "v$($receipt.version)"
  # A stale local source may never publish a downgrade. Check before touching the local install,
  # then check again immediately before the only fleet-visible transition below.
  Assert-PublicVersionCanPublish $receipt.version $tag

  # Local proof happens before any source push or GitHub release creation.
  & (Join-Path $repo "scripts\ship-reinstall.ps1") -VerifyRuntime -ExpectedCommit $receipt.commit -ExpectedInstallerPath $installer -ExpectedInstallerSha256 $receipt.installer.sha256
  if ($LASTEXITCODE -ne 0) { throw "Local ship-reinstall failed (exit $LASTEXITCODE)" }

  Assert-CleanMain
  $postInstallHead = Get-GitLine @("rev-parse", "HEAD")
  if ($postInstallHead -ne $receipt.commit) {
    throw "Source moved during local runtime proof. HEAD=$postInstallHead staged=$($receipt.commit)"
  }

  Invoke-Native "git fetch origin main" { git -C $repo fetch origin main }
  $remote = Get-GitLine @("rev-parse", "origin/main")
  $parent = Get-GitLine @("rev-parse", "HEAD^")
  if ($remote -eq $parent) {
    Invoke-Native "git push staged source" { git -C $repo push origin "$($receipt.commit):main" }
  } elseif ($remote -ne $head) {
    throw "origin/main is neither the staged commit nor its parent. Refusing a non-fast-forward release."
  }
  Invoke-Native "refresh pushed source" { git -C $repo fetch origin main }
  $pushed = Get-GitLine @("rev-parse", "origin/main")
  if ($pushed -ne $receipt.commit) {
    throw "Source push did not publish the staged commit. Expected $($receipt.commit); found $pushed."
  }
  # Push the source tag alongside the commit; confirm origin's tag resolves to the exact commit.
  Invoke-Native "push release tag" { git -C $repo push origin "refs/tags/$($receipt.tag)" }
  $remoteTagLine = (& git -C $repo ls-remote origin "refs/tags/$($receipt.tag)^{}" | Out-String).Trim()
  $remoteTagSha = ($remoteTagLine -split '\s+')[0]
  if ($remoteTagSha -ne $receipt.commit) {
    throw "Pushed release tag $($receipt.tag) does not resolve to the staged commit on origin. tag=$remoteTagSha staged=$($receipt.commit)"
  }

  # A draft is still not visible to the fleet updater. Verify its exact downloaded bytes first.
  $releaseNotes = "$($receipt.notes)`n`nSource commit: $head"
  # The release lives in compy-releases (no source commits), so its tag can't point at the source
  # commit — that binding is the source-tag gate above + this notes line. Create the releases-repo tag
  # ref so gh --verify-tag is a real fail-closed check (refuses creation if the tag is absent).
  # Idempotent for a retried publish.
  $releasesMainSha = (& gh api "repos/$releasesRepo/commits/main" --jq ".sha")
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releasesMainSha)) { throw "Could not resolve $releasesRepo main sha for the release tag." }
  $releasesMainSha = $releasesMainSha.Trim()
  $existingReleasesTag = (& gh api "repos/$releasesRepo/git/refs/tags/$tag" --jq ".object.sha" 2>$null)
  if ([string]::IsNullOrWhiteSpace($existingReleasesTag)) {
    Invoke-Native "create releases-repo tag" { gh api "repos/$releasesRepo/git/refs" -f "ref=refs/tags/$tag" -f "sha=$releasesMainSha" }
  }
  Invoke-Native "create draft GitHub release" {
    gh release create $tag --repo $releasesRepo --draft --verify-tag --title "Compy $tag" --notes $releaseNotes $installer $manifestPath
  }

  $verifyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-release-verify-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $verifyDir | Out-Null
  try {
    Invoke-Native "download draft release assets" {
      gh release download $tag --repo $releasesRepo --dir $verifyDir --pattern $installerName --pattern "latest.json"
    }
    $downloadedInstaller = Join-Path $verifyDir $installerName
    $downloadedManifest = Join-Path $verifyDir "latest.json"
    Assert-ReceiptHash "Downloaded draft installer" $downloadedInstaller $receipt.installer.sha256
    Assert-ReceiptHash "Downloaded draft manifest" $downloadedManifest $receipt.manifest.sha256
    $null = Read-BoundManifest $downloadedManifest $signature $receipt.version $installerName
    Invoke-Native "downloaded draft signature verification" {
      node (Join-Path $repo "scripts\verify-updater-signature.mjs") $downloadedInstaller $signature (Join-Path $repo "src-tauri\tauri.conf.json")
    }
  } finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedVerifyDir = [System.IO.Path]::GetFullPath($verifyDir)
    if ($resolvedVerifyDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedVerifyDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  # GitHub exposes no compare-and-swap for "latest" release publication. Compy release publishing
  # is therefore a single-writer owner action, with this second check kept immediately beside edit.
  Assert-PublicVersionCanPublish $receipt.version $tag -AllowOwnDraft
  # This is the only fleet-visible transition, and it is deliberately last.
  Invoke-Native "publish verified GitHub release" { gh release edit $tag --repo $releasesRepo --draft=false }

  $latestTag = (& gh release view --repo $releasesRepo --json tagName --jq ".tagName").Trim()
  if ($LASTEXITCODE -ne 0 -or $latestTag -ne $tag) {
    throw "Release was published but latest-release verification failed. Expected $tag; found '$latestTag'."
  }

  # Verify the exact public URLs consumed by installed clients, not only GitHub's draft API bytes.
  $publicDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-public-verify-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $publicDir | Out-Null
  try {
    $publicManifest = Join-Path $publicDir "latest.json"
    $publicInstaller = Join-Path $publicDir $installerName
    Invoke-DownloadWithRetry "https://github.com/$releasesRepo/releases/latest/download/latest.json" $publicManifest
    Invoke-DownloadWithRetry "https://github.com/$releasesRepo/releases/latest/download/$installerName" $publicInstaller
    Assert-ReceiptHash "Public latest installer" $publicInstaller $receipt.installer.sha256
    Assert-ReceiptHash "Public latest manifest" $publicManifest $receipt.manifest.sha256
    $null = Read-BoundManifest $publicManifest $signature $receipt.version $installerName
    Invoke-Native "public latest signature verification" {
      node (Join-Path $repo "scripts\verify-updater-signature.mjs") $publicInstaller $signature (Join-Path $repo "src-tauri\tauri.conf.json")
    }
  } finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedPublicDir = [System.IO.Path]::GetFullPath($publicDir)
    if ($resolvedPublicDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedPublicDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host "PUBLISHED: $tag"
  Write-Host "Source: $head"
  Write-Host "Installer SHA-256: $($receipt.installer.sha256)"
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Notes)) {
  throw "Stage mode requires -Notes with plain-English release notes."
}

# Stage preflight runs before any version file is touched.
Assert-StageStartsAtRemoteMain
Assert-NoPendingGamingContract "stage"
$verifiedSourceHead = Get-GitLine @("rev-parse", "HEAD")
$keyPath = Join-Path $env:USERPROFILE ".tauri\compy-updater.key"
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  throw "Updater signing key is unavailable. Restore the owner's protected key before staging."
}
# Passwordless signing is GRANDFATHERED for the pinned fleet anchor only (owner-approved 2026-07-23):
# docs/UPDATER_TRUST_ROOT.md pins a passwordless key as the anchor and requires normal releases to use
# it, so a non-empty password can't be a release precondition. The genuine gate is the sign-probe
# below (proves the key signs AND the pinned pubkey accepts) plus Assert-UpdaterTrustRoot; an unknown
# or wrong key fails those regardless of password. A future protected key still works: set
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD and it is used transparently. Rotation stays a separate train.
if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  Write-Host "Signing with a password-protected key (rotation in progress?)."
} else {
  Write-Host "Signing with the passwordless pinned fleet anchor (grandfathered; docs/UPDATER_TRUST_ROOT.md)."
}

$confPath = Join-Path $repo "src-tauri\tauri.conf.json"
$pkgPath = Join-Path $repo "package.json"
$lockPath = Join-Path $repo "package-lock.json"
$cargoPath = Join-Path $repo "src-tauri\Cargo.toml"

# Full project proof runs on the exact clean source that will be versioned.
& (Join-Path $repo "scripts\verify-release.ps1")
if ($LASTEXITCODE -ne 0) { throw "verify-release.ps1 failed (exit $LASTEXITCODE)" }
Assert-CleanMain
$postVerifyHead = Get-GitLine @("rev-parse", "HEAD")
if ($postVerifyHead -ne $verifiedSourceHead) {
  throw "Source moved while verification ran. Verified=$verifiedSourceHead current=$postVerifyHead"
}

# Prove the protected key + password can sign and that the pinned public key accepts the result
# before creating a version commit. A bad key/password can therefore never burn a release number.
$signProbeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-sign-probe-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $signProbeDir | Out-Null
$signProbe = Join-Path $signProbeDir "probe.bin"
Write-NoBom $signProbe "Compy updater signing preflight"
try {
  Invoke-ProtectedSigner $signProbe $keyPath "Updater signing-key preflight"
  Invoke-Native "signing-key preflight verification" {
    node (Join-Path $repo "scripts\verify-updater-signature.mjs") $signProbe "$signProbe.sig" $confPath
  }
} finally {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $resolvedProbeDir = [System.IO.Path]::GetFullPath($signProbeDir)
  if ($resolvedProbeDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedProbeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$conf = Get-Content -LiteralPath $confPath -Raw | ConvertFrom-Json
$current = [version]$conf.version
if ($SetVersion) {
  $next = [version]$SetVersion
} elseif ($BumpMinor) {
  $next = [version]::new($current.Major, $current.Minor + 1, 0)
} else {
  $next = [version]::new($current.Major, $current.Minor, $current.Build + 1)
}
if ($next -le $current) {
  throw "Release version must increase. Current=$current requested=$next"
}
$currentText = $current.ToString()
$nextText = $next.ToString()
$currentEscaped = [regex]::Escape($currentText)

Write-NoBom $confPath ((Get-Content -LiteralPath $confPath -Raw) -replace ('"version": "' + $currentEscaped + '"'), ('"version": "' + $nextText + '"'))
Write-NoBom $pkgPath ((Get-Content -LiteralPath $pkgPath -Raw) -replace ('"version": "' + $currentEscaped + '"'), ('"version": "' + $nextText + '"'))
$lockPattern = '("name": "compy",\s*"version": ")' + $currentEscaped + '"'
Write-NoBom $lockPath ((Get-Content -LiteralPath $lockPath -Raw) -replace $lockPattern, ('${1}' + $nextText + '"'))
Write-NoBom $cargoPath ((Get-Content -LiteralPath $cargoPath -Raw) -replace ('(?m)^version = "' + $currentEscaped + '"'), ('version = "' + $nextText + '"'))

Push-Location (Join-Path $repo "src-tauri")
try {
  Invoke-Native "Cargo.lock version sync" { cargo update -p compy }
} finally {
  Pop-Location
}

# Version and release-shape guards run again after the mechanical bump.
Push-Location $repo
try {
  Invoke-Native "post-bump release guards" {
    node scripts/run-vitest.mjs run scripts/version-drift-guard.test.mjs scripts/release-pipeline-guard.test.mjs
  }
} finally {
  Pop-Location
}

Invoke-Native "stage release version files" {
  git -C $repo add "src-tauri/tauri.conf.json" "package.json" "package-lock.json" "src-tauri/Cargo.toml" "src-tauri/Cargo.lock"
}
Invoke-Native "commit staged release version" { git -C $repo commit -m "release: v$nextText" -m $Notes }
$releaseCommit = Get-GitLine @("rev-parse", "HEAD")
Assert-CleanMain
$releaseParent = Get-GitLine @("rev-parse", "HEAD^")
if ($releaseParent -ne $verifiedSourceHead) {
  throw "Release commit is not based directly on the verified source. Expected parent $verifiedSourceHead; found $releaseParent."
}

# Re-run the complete gate against the exact clean commit that will be built and published. The
# pre-bump proof covered its parent; this closes the gap where an unintended/concurrent edit to a
# version file could otherwise be swept into the release commit after that proof.
Write-Host "`n=== Exact release-commit verification ==="
& (Join-Path $repo "scripts\verify-release.ps1")
if ($LASTEXITCODE -ne 0) { throw "Exact release-commit verification failed (exit $LASTEXITCODE)" }
Assert-CleanMain
$postCommitVerifyHead = Get-GitLine @("rev-parse", "HEAD")
if ($postCommitVerifyHead -ne $releaseCommit) {
  throw "Source moved while the exact release commit was verified. Expected=$releaseCommit current=$postCommitVerifyHead"
}

# Build signed updater artifacts from the committed, clean release source (via the grandfathered
# present-but-empty-password signing shim; see Invoke-TauriSigned).
Push-Location $repo
try {
  Invoke-TauriSigned $keyPath @("run", "tauri", "build") "Signed Tauri build"
} finally {
  Pop-Location
}

$installerRelative = "src-tauri/target/release/bundle/nsis/Compy_${nextText}_x64-setup.exe"
$signatureRelative = "$installerRelative.sig"
$manifestRelative = "src-tauri/target/release/bundle/nsis/latest.json"
$installer = Resolve-ReceiptArtifact $installerRelative
$signature = Resolve-ReceiptArtifact $signatureRelative
$manifestPath = Resolve-ReceiptArtifact $manifestRelative
if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) {
  throw "Signed build did not produce the mandatory updater signature: $signature"
}

Invoke-Native "cryptographic updater signature verification" {
  node (Join-Path $repo "scripts\verify-updater-signature.mjs") $installer $signature $confPath
}
Assert-CleanMain
$postBuildHead = Get-GitLine @("rev-parse", "HEAD")
if ($postBuildHead -ne $releaseCommit) {
  throw "Source moved while the signed build ran. Built=$releaseCommit current=$postBuildHead"
}

# Verify the built binary EMBEDS the release commit stamp (build.rs stamps the short hash into the
# release exe). A cached/stale cargo fingerprint can silently rebundle a prior binary; the stamp is
# the proof the artifact IS this exact source. The uncompressed release exe carries it (the NSIS
# installer is compressed, so publish re-proves it on the INSTALLED exe via ship-reinstall -VerifyRuntime).
$releaseShort = Get-GitLine @("rev-parse", "--short", $releaseCommit)
$releaseExe = Join-Path $repo "src-tauri\target\release\compy.exe"
if (-not (Select-String -LiteralPath $releaseExe -Pattern $releaseShort -SimpleMatch -Quiet)) {
  throw "EMBEDDED-STAMP MISMATCH: target\release\compy.exe does not embed the release stamp $releaseShort. cargo reused a cached binary; run 'cargo clean -p compy --release --manifest-path src-tauri/Cargo.toml' and re-stage."
}
if (Select-String -LiteralPath $releaseExe -Pattern "$releaseShort+dirty" -SimpleMatch -Quiet) {
  throw "EMBEDDED-STAMP MISMATCH: the release exe stamp reads '+dirty'; the build was cut from an unclean tree."
}

$signatureText = (Get-Content -LiteralPath $signature -Raw).Trim()
$manifest = [ordered]@{
  version = $nextText
  notes = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signatureText
      url = "https://github.com/$releasesRepo/releases/download/v$nextText/Compy_${nextText}_x64-setup.exe"
    }
  }
}
Write-NoBom $manifestPath (($manifest | ConvertTo-Json -Depth 5))

# Pre-existing tag (Phase 3 #4): an annotated tag pointing at the EXACT release commit, in the
# source repo. LOCAL only — stage never pushes/publishes. Publish REQUIRES this tag to already point
# at the receipt commit before it will push source or create the release.
$releaseTag = "v$nextText"
Invoke-Native "create release tag" { git -C $repo tag -a $releaseTag $releaseCommit -m "Compy $releaseTag" }

$receipt = [ordered]@{
  schema_version = 3
  version = $nextText
  commit = $releaseCommit
  tag = $releaseTag
  notes = $Notes
  created_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  installer = [ordered]@{ path = $installerRelative; sha256 = Get-ArtifactHash $installer; bytes = (Get-Item -LiteralPath $installer).Length }
  signature = [ordered]@{ path = $signatureRelative; sha256 = Get-ArtifactHash $signature }
  manifest = [ordered]@{ path = $manifestRelative; sha256 = Get-ArtifactHash $manifestPath }
}
Write-NoBom $stageReceiptPath (($receipt | ConvertTo-Json -Depth 5))
Invoke-ProtectedSigner $stageReceiptPath $keyPath "Staged receipt signing"
Invoke-Native "staged receipt self-verification" {
  node (Join-Path $repo "scripts\verify-updater-signature.mjs") $stageReceiptPath $stageReceiptSignaturePath $confPath
}

Write-Host "STAGED ONLY: v$nextText"
Write-Host "Nothing was installed, pushed, or published."
Write-Host "Receipt: $stageReceiptPath"
Write-Host "Receipt signature: $stageReceiptSignaturePath"
Write-Host "After owner review, publish this exact candidate with:"
Write-Host "  powershell -NoProfile -File .\scripts\release.ps1 -Mode publish"
