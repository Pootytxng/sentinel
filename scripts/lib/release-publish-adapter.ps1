# release-publish-adapter.ps1 - production external-state adapter for release-transaction.ps1.
#
# Every Inspect handler derives truth from the filesystem, installed payload, Git remotes, GitHub,
# or exact downloaded bytes. Journal entries are never accepted as proof. Every Apply handler is
# idempotent by precondition: it is called only after Inspect returned "absent", and the engine
# immediately inspects again before recording completion.
# ASCII only for Windows PowerShell 5.1.

function New-ProductionInspection {
  param([string]$Status, [hashtable]$Evidence = @{})
  return [pscustomobject]@{ Status = $Status; Evidence = $Evidence }
}

function Get-ProductionEncodedArguments {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$Tool,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  $encoderName = "${Tool}ArgumentsEncoder"
  $prefixName = "${Tool}ArgumentPrefix"
  $encoder = $Context.$encoderName
  if ($encoder) {
    return @(Invoke-ReleaseScriptBlock -ScriptBlock $encoder -ArgumentList @(,$ArgumentList))
  }
  $prefix = if ($Context.$prefixName) { @($Context.$prefixName) } else { @() }
  return @($prefix + $ArgumentList)
}

function Invoke-ProductionGhProcess {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 300000
  )
  $command = if ($Context.GhCommand) { [string]$Context.GhCommand } else { "gh" }
  $arguments = Get-ProductionEncodedArguments -Context $Context -Tool "Gh" -ArgumentList $ArgumentList
  return Invoke-NativeProcess -Command $command -ArgumentList $arguments -TimeoutMs $TimeoutMs
}

function Invoke-ProductionGhChecked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 300000,
    [switch]$ShowOutput
  )
  $command = if ($Context.GhCommand) { [string]$Context.GhCommand } else { "gh" }
  $arguments = Get-ProductionEncodedArguments -Context $Context -Tool "Gh" -ArgumentList $ArgumentList
  return Invoke-CheckedProcess $Label $command $arguments -TimeoutMs $TimeoutMs -ShowOutput:$ShowOutput
}

function Invoke-ProductionGitProcess {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 300000
  )
  $command = if ($Context.GitCommand) { [string]$Context.GitCommand } else { "git" }
  $arguments = Get-ProductionEncodedArguments -Context $Context -Tool "Git" -ArgumentList $ArgumentList
  return Invoke-NativeProcess -Command $command -ArgumentList $arguments -TimeoutMs $TimeoutMs
}

function Invoke-ProductionGitChecked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [int]$TimeoutMs = 300000,
    [switch]$ShowOutput
  )
  $command = if ($Context.GitCommand) { [string]$Context.GitCommand } else { "git" }
  $arguments = Get-ProductionEncodedArguments -Context $Context -Tool "Git" -ArgumentList $ArgumentList
  return Invoke-CheckedProcess $Label $command $arguments -TimeoutMs $TimeoutMs -ShowOutput:$ShowOutput
}

function Get-ProductionGitLine {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  return (Invoke-ProductionGitChecked "read Git release state" $Context $ArgumentList).StdOut.Trim()
}

function Invoke-ProductionSignatureVerification {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ArtifactPath
  )
  if ($Context.SignatureVerifier) {
    Invoke-ReleaseScriptBlock -ScriptBlock $Context.SignatureVerifier -ArgumentList @($ArtifactPath, $Context.Signature)
    return
  }
  Invoke-CheckedProcess $Label "node" @(
    (Join-Path $Context.Repo "scripts\verify-updater-signature.mjs"),
    $ArtifactPath, $Context.Signature, (Join-Path $Context.Repo "src-tauri\tauri.conf.json")
  ) -ShowOutput | Out-Null
}

function Invoke-ProductionDownload {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$CacheBustToken,
    [switch]$StopOnNotFound
  )
  # A retried download must never be able to verify a file a previous attempt left behind.
  if (Test-Path -LiteralPath $OutFile) {
    Remove-Item -LiteralPath $OutFile -Force
  }
  $requestUri = Add-ReleaseCacheBustingQuery $Uri $CacheBustToken
  if ($Context.DownloadFile) {
    $null = Invoke-ReleaseScriptBlock -ScriptBlock $Context.DownloadFile -ArgumentList @($requestUri, $OutFile)
  } else {
    Invoke-DownloadWithRetry $requestUri $OutFile -StopOnNotFound:$StopOnNotFound
  }
  if (-not (Test-Path -LiteralPath $OutFile -PathType Leaf)) {
    throw "Public release download reported success but produced no file: $requestUri"
  }
}

function Get-ProductionGhApi {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$Endpoint,
    [switch]$AllowNotFound
  )
  $result = Invoke-ProductionGhProcess -Context $Context -ArgumentList @("api", $Endpoint) -TimeoutMs 300000
  if ($result.TimedOut) {
    throw "GitHub API lookup timed out for $Endpoint. Network failure is not absence."
  }
  if ($result.ExitCode -eq 0) {
    if ([string]::IsNullOrWhiteSpace($result.StdOut)) {
      throw "GitHub API lookup succeeded with an empty response for $Endpoint."
    }
    try {
      return [pscustomobject]@{ Found = $true; Value = ($result.StdOut | ConvertFrom-Json) }
    } catch {
      throw "GitHub API lookup returned malformed JSON for $Endpoint."
    }
  }
  if ($AllowNotFound -and (Test-GhNotFound $result)) {
    return [pscustomobject]@{ Found = $false; Value = $null }
  }
  $detail = Get-FirstNonEmptyLine $result.StdErr
  if (-not $detail) { $detail = Get-FirstNonEmptyLine $result.StdOut }
  throw "GitHub API lookup failed for $Endpoint (exit $($result.ExitCode)). Authentication, permission, network, and malformed failures are fatal. $detail"
}

function Remove-ProductionTempDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a non-temporary release verification directory: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-BinaryContainsExactAscii {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Text
  )
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $needle = [System.Text.Encoding]::ASCII.GetBytes($Text)
  $count = 0
  for ($index = 0; $index -le $bytes.Length - $needle.Length; $index++) {
    $matches = $true
    for ($offset = 0; $offset -lt $needle.Length; $offset++) {
      if ($bytes[$index + $offset] -ne $needle[$offset]) { $matches = $false; break }
    }
    if ($matches) { $count += 1 }
  }
  return $count
}

function Inspect-ProductionRuntime {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  # Probed through PSObject.Properties, not read directly: this hook is OPTIONAL (the sandbox
  # harness supplies it, production never does), and a direct read of an absent property is a
  # terminating error the moment anything up the call chain has turned strict mode on. That is
  # exactly what killed the v0.9.26 prove run; the leak is fixed in canonical-data-root.ps1, and
  # this reads the way release-transaction.ps1 already reads its own optional context values.
  $runtimeInspector = $Context.PSObject.Properties['RuntimeInspector']
  if ($runtimeInspector -and $runtimeInspector.Value) {
    return Invoke-ReleaseScriptBlock -ScriptBlock $runtimeInspector.Value -ArgumentList @($Context)
  }
  # The journal never decides this verdict. A proof that just completed in this process is valid;
  # otherwise an exact installed payload is subjected to a fresh live mounted-shell proof below.
  $exe = Join-Path $env:LOCALAPPDATA "Compy\compy.exe"
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    return New-ProductionInspection "absent"
  }
  $short = (Get-GitLine @("rev-parse", "--short", $Context.Receipt.commit)).Trim()
  $count = Test-BinaryContainsExactAscii -Path $exe -Text $short
  if ($count -ne 1 -or (Test-BinaryContainsExactAscii -Path $exe -Text "$short+dirty") -gt 0) {
    return New-ProductionInspection "absent"
  }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  $uninstall = Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Compy" -ErrorAction SilentlyContinue
  if ($version -ne $Context.Receipt.version -or -not $uninstall -or $uninstall.DisplayVersion -ne $Context.Receipt.version) {
    return New-ProductionInspection "absent"
  }
  if (-not [bool]$Context.RuntimeProvedThisInvocation) {
    Invoke-StreamedProcess "revalidate installed runtime proof" "powershell" @(
      "-NoProfile", "-File", (Join-Path $Context.Repo "scripts\ship-reinstall.ps1"),
      "-ProofOnly",
      "-VerifyRuntime",
      "-ExpectedCommit", $Context.Receipt.commit,
      "-ExpectedInstallerPath", $Context.Installer,
      "-ExpectedInstallerSha256", $Context.Receipt.installer.sha256
    ) -WorkingDirectory $Context.Repo -TimeoutMs 600000 | Out-Null
  }
  return New-ProductionInspection "complete" @{
    installed_version = $version
    embedded_short_commit = $short
    embedded_count = $count
  }
}

function Inspect-ProductionSourceMain {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  Invoke-ProductionGitChecked "refresh source main" $Context @("-C", $Context.Repo, "fetch", "origin", "main") -ShowOutput | Out-Null
  $remote = Get-ProductionGitLine $Context @("-C", $Context.Repo, "rev-parse", "origin/main")
  if ($remote -eq $Context.Receipt.commit) {
    return New-ProductionInspection "complete" @{ origin_main = $remote; relation = "exact" }
  }
  $contains = Invoke-ProductionGitProcess -Context $Context -ArgumentList @(
    "-C", $Context.Repo, "merge-base", "--is-ancestor", $Context.Receipt.commit, "origin/main"
  ) -TimeoutMs 300000
  if ($contains.TimedOut -or @(0, 1) -notcontains $contains.ExitCode) {
    throw "Could not prove whether origin/main contains the staged release commit."
  }
  if ($contains.ExitCode -eq 0) {
    return New-ProductionInspection "complete" @{ origin_main = $remote; relation = "descendant" }
  }
  $fastForward = Invoke-ProductionGitProcess -Context $Context -ArgumentList @(
    "-C", $Context.Repo, "merge-base", "--is-ancestor", "origin/main", $Context.Receipt.commit
  ) -TimeoutMs 300000
  if ($fastForward.TimedOut -or @(0, 1) -notcontains $fastForward.ExitCode) {
    throw "Could not prove whether the staged release commit can fast-forward origin/main."
  }
  if ($fastForward.ExitCode -eq 0) {
    return New-ProductionInspection "absent" @{ origin_main = $remote; relation = "fast_forwardable" }
  }
  throw "origin/main and the staged release commit have diverged. Refusing a non-fast-forward release."
}

function Inspect-ProductionSourceTag {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $result = Invoke-ProductionGitChecked "read remote source tag" $Context @(
    "-C", $Context.Repo, "ls-remote", "origin",
    "refs/tags/$($Context.Receipt.tag)", "refs/tags/$($Context.Receipt.tag)^{}"
  ) -TimeoutMs 300000
  $lines = @($result.StdOut -split "`r?`n" | Where-Object { $_.Trim() })
  if ($lines.Count -eq 0) { return New-ProductionInspection "absent" }
  $direct = ""
  $peeled = ""
  foreach ($line in $lines) {
    $parts = $line -split '\s+'
    if ($parts.Count -lt 2) { throw "Remote source-tag lookup returned malformed output." }
    if ($parts[1] -eq "refs/tags/$($Context.Receipt.tag)") { $direct = $parts[0] }
    elseif ($parts[1] -eq "refs/tags/$($Context.Receipt.tag)^{}") { $peeled = $parts[0] }
  }
  $localTagObject = Get-ProductionGitLine $Context @("-C", $Context.Repo, "rev-parse", $Context.Receipt.tag)
  if (-not $direct -or -not $peeled -or
      $direct -ne $localTagObject -or $peeled -ne $Context.Receipt.commit) {
    throw "Remote source tag $($Context.Receipt.tag) is not the exact annotated tag object and receipt commit."
  }
  return New-ProductionInspection "complete" @{
    remote_tag_object = $direct
    remote_tag_commit = $peeled
  }
}

function Get-ProductionReleasesMain {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $lookup = Get-ProductionGhApi -Context $Context -Endpoint "repos/$($Context.ReleasesRepo)/commits/main"
  $sha = [string]$lookup.Value.sha
  if ($sha -notmatch '^[0-9a-fA-F]{40}$') {
    throw "Releases repository main lookup returned a malformed object id."
  }
  return $sha.ToLowerInvariant()
}

function Inspect-ProductionReleasesTag {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $target = Get-ProductionReleasesMain $Context
  $lookup = Get-ProductionGhApi -Context $Context -Endpoint "repos/$($Context.ReleasesRepo)/git/ref/tags/$($Context.Receipt.tag)" -AllowNotFound
  if (-not $lookup.Found) {
    $Context | Add-Member -NotePropertyName ReleasesTagTarget -NotePropertyValue $target -Force
    return New-ProductionInspection "absent" @{ confirmed_absent = "HTTP 404"; intended_target = $target }
  }
  $actual = [string]$lookup.Value.object.sha
  if ($actual -ne $target) {
    throw "Releases-repository tag $($Context.Receipt.tag) points at $actual; expected exact releases main $target."
  }
  return New-ProductionInspection "complete" @{ releases_tag_target = $actual }
}

# GitHub does not serve DRAFT releases from `GET /repos/{repo}/releases/{tag}`: that endpoint
# answers 404 for a draft that demonstrably exists, because drafts are reachable only by numeric id
# or through the authenticated releases list. A draft-sensitive stage resolved by tag therefore
# reads "absent" for the draft it just created, so the transaction can never confirm its own work
# (v0.9.11 failed exactly this way). The authenticated, paginated list is the authoritative lookup;
# the numeric id it yields is what the precise read below -- and later stages -- use.
#
# Absence is the ONLY non-fatal outcome, and it is earned: a complete, well-formed listing that
# contains no matching tag. Authentication, permission, rate-limit, network, timeout, nonzero exit,
# empty body, malformed JSON, unexpected shape and incomplete pagination are all fatal, because
# none of them are evidence that the release does not exist.
function Get-ProductionReleasePage {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][int]$Page,
    [Parameter(Mandatory = $true)][int]$PageSize
  )
  $endpoint = "repos/$($Context.ReleasesRepo)/releases?per_page=$PageSize&page=$Page"
  $result = Invoke-ProductionGhProcess -Context $Context -ArgumentList @("api", $endpoint) -TimeoutMs 300000
  if ($result.TimedOut) {
    throw "GitHub release listing timed out on page $Page for $($Context.ReleasesRepo). Network failure is not absence."
  }
  if ($result.ExitCode -ne 0) {
    $detail = Get-FirstNonEmptyLine $result.StdErr
    if (-not $detail) { $detail = Get-FirstNonEmptyLine $result.StdOut }
    $class = if (Test-GhNotFound $result) { "not-found" } else { "failure" }
    throw "GitHub release listing failed on page $Page for $($Context.ReleasesRepo) (exit $($result.ExitCode), $class). Authentication, permission, rate-limit, network and not-found failures are all fatal here; none of them mean the release is absent. $detail"
  }
  $raw = [string]$result.StdOut
  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "GitHub release listing returned an empty response on page $Page for $($Context.ReleasesRepo)."
  }
  if (-not $raw.TrimStart().StartsWith("[")) {
    throw "GitHub release listing returned an unexpected response shape on page $Page for $($Context.ReleasesRepo); a JSON array was required."
  }
  try {
    $parsed = $raw | ConvertFrom-Json
  } catch {
    throw "GitHub release listing returned malformed JSON on page $Page for $($Context.ReleasesRepo)."
  }
  return @($parsed)
}

function Get-ProductionReleaseList {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $pageSize = 100
  $maxPages = 100
  $releases = New-Object System.Collections.Generic.List[psobject]
  for ($page = 1; $page -le $maxPages; $page++) {
    $batch = Get-ProductionReleasePage -Context $Context -Page $page -PageSize $pageSize
    foreach ($entry in $batch) {
      if ($null -eq $entry.id -or [string]::IsNullOrWhiteSpace([string]$entry.tag_name)) {
        throw "GitHub release listing returned an entry without an id and tag on page $page for $($Context.ReleasesRepo)."
      }
      $releases.Add($entry)
    }
    # A short page is the documented end of the listing; a full page is never assumed to be the last.
    if ($batch.Count -lt $pageSize) { return @($releases.ToArray()) }
  }
  throw "GitHub release listing for $($Context.ReleasesRepo) exceeded $maxPages pages; refusing to act on an incompletely paginated listing."
}

function Get-ProductionRelease {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $tag = [string]$Context.Receipt.tag
  $releases = Get-ProductionReleaseList -Context $Context
  $exact = @($releases | Where-Object { [string]$_.tag_name -ceq $tag })
  $variant = @($releases | Where-Object { [string]$_.tag_name -ieq $tag -and [string]$_.tag_name -cne $tag })
  if ($variant.Count -gt 0) {
    $names = (@($variant | ForEach-Object { [string]$_.tag_name }) | Sort-Object -Unique) -join ", "
    throw "GitHub releases for $($Context.ReleasesRepo) contain case-variant tags for ${tag}: $names. Refusing to act on an ambiguous release namespace."
  }
  if ($exact.Count -eq 0) {
    return [pscustomobject]@{ Found = $false; Value = $null }
  }
  if ($exact.Count -gt 1) {
    $ids = (@($exact | ForEach-Object { [string]$_.id }) | Sort-Object) -join ", "
    throw "Duplicate GitHub releases for tag ${tag} in $($Context.ReleasesRepo) (ids $ids). Refusing to act on an ambiguous release."
  }
  $releaseId = [string]$exact[0].id
  if ($releaseId -notmatch '^\d+$') {
    throw "GitHub release listing returned a malformed release id for tag ${tag} in $($Context.ReleasesRepo)."
  }
  # The listing proved existence; this precise by-id read is the authoritative object (drafts
  # included). Any failure here is fatal -- a release that just listed cannot be "absent".
  $precise = Get-ProductionGhApi -Context $Context -Endpoint "repos/$($Context.ReleasesRepo)/releases/$releaseId"
  $release = $precise.Value
  if ([string]$release.id -ne $releaseId -or [string]$release.tag_name -cne $tag) {
    throw "GitHub release $releaseId in $($Context.ReleasesRepo) did not read back as tag ${tag}. Refusing to act on an inconsistent release."
  }
  return [pscustomobject]@{ Found = $true; Value = $release }
}

function Assert-ProductionReleaseIdentity {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][psobject]$Release
  )
  if ($Release.tag_name -ne $Context.Receipt.tag -or
      $Release.name -ne "Compy $($Context.Receipt.tag)" -or
      $Release.body -ne $Context.ReleaseNotes -or
      $Release.prerelease) {
    throw "Existing GitHub release collision: tag, title, notes, or prerelease state is incompatible with the receipt."
  }
}

function Inspect-ProductionDraft {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $lookup = Get-ProductionRelease $Context
  if (-not $lookup.Found) { return New-ProductionInspection "absent" }
  Assert-ProductionReleaseIdentity $Context $lookup.Value
  if (-not $lookup.Value.draft) {
    # A compatible public release means this earlier stage remains complete on a post-public retry.
    return New-ProductionInspection "complete" @{ release_id = $lookup.Value.id; state = "published" }
  }
  return New-ProductionInspection "complete" @{ release_id = $lookup.Value.id; state = "draft" }
}

function Inspect-ProductionDraftAssets {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $lookup = Get-ProductionRelease $Context
  if (-not $lookup.Found) { throw "Draft asset stage reached before the draft exists." }
  Assert-ProductionReleaseIdentity $Context $lookup.Value
  $assets = @($lookup.Value.assets)
  $wanted = @($Context.InstallerName, "latest.json")
  $matching = @($assets | Where-Object { $wanted -contains $_.name })
  $foreign = @($assets | Where-Object { $wanted -notcontains $_.name })
  if ($foreign.Count -gt 0) {
    throw "Existing draft contains unexpected assets; refusing to delete or overwrite them."
  }
  if (@($matching.name | Sort-Object -Unique).Count -ne $matching.Count) {
    throw "Existing draft has duplicate expected assets; refusing to overwrite it."
  }
  $presentNames = @($matching.name)
  $missingNames = @($wanted | Where-Object { $presentNames -notcontains $_ })
  $Context | Add-Member -NotePropertyName MissingDraftAssets -NotePropertyValue $missingNames -Force
  if ($matching.Count -eq 0) {
    return New-ProductionInspection "absent" @{ missing_assets = $missingNames }
  }
  $verifyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-draft-verify-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $verifyDir | Out-Null
  try {
    foreach ($assetName in $presentNames) {
      Invoke-ProductionGhChecked "download existing draft asset $assetName" $Context @(
        "release", "download", $Context.Receipt.tag, "--repo", $Context.ReleasesRepo,
        "--dir", $verifyDir, "--pattern", $assetName
      ) -TimeoutMs 1800000 -ShowOutput | Out-Null
    }
    if ($presentNames -contains $Context.InstallerName) {
      $downloadedInstaller = Join-Path $verifyDir $Context.InstallerName
      Assert-ReceiptHash "Downloaded draft installer" $downloadedInstaller $Context.Receipt.installer.sha256
      Invoke-ProductionSignatureVerification $Context "downloaded draft signature verification" $downloadedInstaller
    }
    if ($presentNames -contains "latest.json") {
      $downloadedManifest = Join-Path $verifyDir "latest.json"
      Assert-ReceiptHash "Downloaded draft manifest" $downloadedManifest $Context.Receipt.manifest.sha256
      $null = Read-BoundManifest $downloadedManifest $Context.Signature $Context.Receipt.version $Context.InstallerName
    }
  } finally {
    Remove-ProductionTempDirectory $verifyDir
  }
  if ($missingNames.Count -gt 0) {
    return New-ProductionInspection "absent" @{
      verified_present_assets = $presentNames
      missing_assets = $missingNames
    }
  }
  return New-ProductionInspection "complete" @{
    installer_sha256 = $Context.Receipt.installer.sha256
    manifest_sha256 = $Context.Receipt.manifest.sha256
  }
}

function Inspect-ProductionPublished {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $lookup = Get-ProductionRelease $Context
  if (-not $lookup.Found) { throw "Publication stage reached before a compatible draft exists." }
  Assert-ProductionReleaseIdentity $Context $lookup.Value
  if ($lookup.Value.draft) { return New-ProductionInspection "absent" }
  return New-ProductionInspection "complete" @{ release_id = $lookup.Value.id; published_at = $lookup.Value.published_at }
}

# GitHub answers `GET /repos/{repo}/releases/latest` from release metadata, which is consistent
# immediately, while the /releases/latest/download/ redirector converges a beat later. Requiring the
# metadata to already name this exact release is what makes a lagging alias provably a lag and not a
# publication that went somewhere else.
function Assert-ProductionLatestReleaseIdentity {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][psobject]$Release
  )
  $latest = Get-ProductionGhApi $Context "repos/$($Context.ReleasesRepo)/releases/latest"
  if (-not $latest.Found -or -not $latest.Value) {
    throw "The releases repository reports no latest published release for $($Context.Receipt.tag)."
  }
  $value = $latest.Value
  if (("" + $value.id) -cne ("" + $Release.id)) {
    throw "GitHub reports release $($value.id) (tag $($value.tag_name)) as latest, not the published release $($Release.id) for $($Context.Receipt.tag)."
  }
  if (("" + $value.tag_name) -cne $Context.Receipt.tag) {
    throw "The latest published release is tagged $($value.tag_name); the receipt binds $($Context.Receipt.tag)."
  }
  if ($value.draft) { throw "The latest published release for $($Context.Receipt.tag) is still a draft." }
  if ($value.prerelease) { throw "The latest published release for $($Context.Receipt.tag) is marked prerelease." }
  return $value
}

# The only body a lagging alias is allowed to serve is a well-formed manifest for a STRICTLY OLDER
# release of this same repository. A newer version, an equal version with different bytes, an
# unparseable body or a manifest bound somewhere else is an unrelated payload, and unrelated is fatal.
function Assert-AliasPropagationLag {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$ManifestPath
  )
  $manifest = $null
  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "The latest-download alias returned an unparseable manifest; refusing to read it as propagation lag."
  }
  if (-not $manifest -or [string]::IsNullOrWhiteSpace(("" + $manifest.version))) {
    throw "The latest-download alias returned a manifest with no version; refusing to read it as propagation lag."
  }
  $aliasVersion = ("" + $manifest.version).Trim()
  if ((Compare-ReleaseVersion $aliasVersion $Context.Receipt.version) -ge 0) {
    throw "The latest-download alias serves version $aliasVersion, which is not older than the published $($Context.Receipt.version). That is an unrelated or newer release, not propagation lag."
  }
  $platform = $manifest.platforms.'windows-x86_64'
  $expectedPrefix = "https://github.com/$($Context.ReleasesRepo)/releases/download/v$aliasVersion/"
  if (-not $platform -or -not ("" + $platform.url).StartsWith($expectedPrefix, [System.StringComparison]::Ordinal)) {
    throw "The latest-download alias serves a manifest that does not bind $($Context.ReleasesRepo) v$aliasVersion; refusing to read it as propagation lag."
  }
  return $aliasVersion
}

function Invoke-ProductionAliasDelay {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][int]$Seconds
  )
  if ($Context.SleepSeconds) {
    $null = Invoke-ReleaseScriptBlock -ScriptBlock $Context.SleepSeconds -ArgumentList @($Seconds)
    return [double]$Seconds
  }
  Start-Sleep -Seconds $Seconds
  return 0.0
}

function Get-ProductionAliasAsset {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][string]$CacheBustToken
  )
  try {
    Invoke-ProductionDownload $Context $Uri $OutFile -CacheBustToken $CacheBustToken -StopOnNotFound
  } catch {
    if (Test-ReleasePropagationAbsence $_) { return $false }
    throw
  }
  return $true
}

function Wait-ProductionLatestAliasConvergence {
  param(
    [Parameter(Mandatory = $true)][psobject]$Context,
    [Parameter(Mandatory = $true)][string]$WorkingDir
  )
  $deadlineSeconds = 900
  if ($Context.AliasDeadlineSeconds) { $deadlineSeconds = [int]$Context.AliasDeadlineSeconds }
  $backoff = @(5, 10, 20, 30, 45, 60)
  $manifestUri = "https://github.com/$($Context.ReleasesRepo)/releases/latest/download/latest.json"
  $installerUri = "https://github.com/$($Context.ReleasesRepo)/releases/latest/download/$($Context.InstallerName)"
  $expectedManifestHash = $Context.Receipt.manifest.sha256.ToLowerInvariant()
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $charged = 0.0
  $attempt = 0
  $observed = "no attempt completed"
  for (;;) {
    $attempt++
    # A fresh directory per attempt, plus a fresh cache-busting token, so nothing an earlier attempt
    # downloaded can be mistaken for what this attempt observed.
    $attemptDir = Join-Path $WorkingDir ("alias-attempt-" + $attempt.ToString("000"))
    New-Item -ItemType Directory -Path $attemptDir | Out-Null
    $token = [guid]::NewGuid().ToString("N")
    $aliasManifest = Join-Path $attemptDir "latest.json"
    $aliasInstaller = Join-Path $attemptDir $Context.InstallerName
    $converged = $false
    if (-not (Get-ProductionAliasAsset $Context $manifestUri $aliasManifest $token)) {
      $observed = "the latest-download alias does not serve a manifest yet"
    } elseif ((Get-ArtifactHash $aliasManifest) -cne $expectedManifestHash) {
      $aliasVersion = Assert-AliasPropagationLag $Context $aliasManifest
      $observed = "the latest-download alias still serves v$aliasVersion"
    } elseif (-not (Get-ProductionAliasAsset $Context $installerUri $aliasInstaller $token)) {
      # Half a converged alias is not convergence: the fleet resolves both names.
      $observed = "the latest-download alias serves the published manifest but not yet the installer"
    } else {
      Assert-ReceiptHash "Public latest installer" $aliasInstaller $Context.Receipt.installer.sha256
      Assert-ReceiptHash "Public latest manifest" $aliasManifest $Context.Receipt.manifest.sha256
      $null = Read-BoundManifest $aliasManifest $Context.Signature $Context.Receipt.version $Context.InstallerName
      $converged = $true
    }
    if ($converged) {
      return [pscustomobject]@{
        Attempts = $attempt
        ElapsedSeconds = [math]::Round(($stopwatch.Elapsed.TotalSeconds + $charged), 1)
      }
    }
    $elapsed = $stopwatch.Elapsed.TotalSeconds + $charged
    $delay = $backoff[[math]::Min(($attempt - 1), ($backoff.Count - 1))]
    if (($elapsed + $delay) -ge $deadlineSeconds) {
      throw "The /releases/latest/download/ alias did not converge on $($Context.Receipt.tag) within $deadlineSeconds seconds ($attempt attempts): $observed."
    }
    $charged += Invoke-ProductionAliasDelay $Context $delay
  }
}

function Inspect-ProductionPublicAssets {
  param([Parameter(Mandatory = $true)][psobject]$Context)
  $lookup = Get-ProductionRelease $Context
  if (-not $lookup.Found -or $lookup.Value.draft) {
    throw "Public asset verification reached before the release is public."
  }
  Assert-ProductionReleaseIdentity $Context $lookup.Value
  $publicDir = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-public-verify-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $publicDir | Out-Null
  $convergence = $null
  try {
    # 1. The tag-specific assets ARE the release. They are consistent the moment it is published, so
    #    a mismatch here is never propagation lag and is never retried.
    $tagManifest = Join-Path $publicDir "tag-latest.json"
    $publicInstaller = Join-Path $publicDir $Context.InstallerName
    Invoke-ProductionDownload $Context "https://github.com/$($Context.ReleasesRepo)/releases/download/$($Context.Receipt.tag)/latest.json" $tagManifest
    Invoke-ProductionDownload $Context "https://github.com/$($Context.ReleasesRepo)/releases/download/$($Context.Receipt.tag)/$($Context.InstallerName)" $publicInstaller
    Assert-ReceiptHash "Public tag-specific installer" $publicInstaller $Context.Receipt.installer.sha256
    Assert-ReceiptHash "Public tag-specific manifest" $tagManifest $Context.Receipt.manifest.sha256
    $null = Read-BoundManifest $tagManifest $Context.Signature $Context.Receipt.version $Context.InstallerName
    # 2. The updater signature is proved from the public bytes a fleet machine would actually fetch.
    Invoke-ProductionSignatureVerification $Context "public updater signature verification" $publicInstaller
    # 3. GitHub's own metadata must already name this release as latest before the eventually
    #    consistent redirector is given any benefit of the doubt.
    $null = Assert-ProductionLatestReleaseIdentity $Context $lookup.Value
    # 4. Only the alias may lag, so only the alias is polled - and both names must land together.
    $convergence = Wait-ProductionLatestAliasConvergence $Context $publicDir
  } finally {
    Remove-ProductionTempDirectory $publicDir
  }
  # 5. Recorded only after the alias has converged on the receipt-bound assets.
  return New-ProductionInspection "complete" @{
    installer_sha256 = $Context.Receipt.installer.sha256
    manifest_sha256 = $Context.Receipt.manifest.sha256
    latest_alias_verified = $true
    latest_alias_attempts = $convergence.Attempts
    latest_alias_seconds = $convergence.ElapsedSeconds
  }
}

function New-ProductionReleaseAdapter {
  param([hashtable]$Dependencies = @{})
  if ($Dependencies.Count -gt 0) {
    $requiredSimulationDependencies = @(
      "InspectReceipt",
      "InspectRuntime", "ApplyRuntime",
      "InspectSourceMain", "ApplySourceMain",
      "InspectSourceTag", "ApplySourceTag",
      "InspectReleasesTag", "ApplyReleasesTag",
      "InspectDraft", "ApplyDraft",
      "InspectDraftAssets", "ApplyDraftAssets",
      "InspectPublished", "ApplyPublished",
      "InspectPublicAssets", "ApplyPublicAssets"
    )
    $missing = @($requiredSimulationDependencies | Where-Object { -not $Dependencies.ContainsKey($_) })
    if ($missing.Count -gt 0) {
      throw "Injected release adapter is incomplete; refusing any production fallback. Missing: $($missing -join ', ')"
    }
  }
  return @{
    __dependency_keys = @($Dependencies.Keys | Sort-Object)
    receipt_verified = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectReceipt")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectReceipt"] -ArgumentList @($context)
        }
        $validator = $context.ValidateReceipt
        Invoke-ReleaseScriptBlock -ScriptBlock $validator -ArgumentList @($context)
        return New-ProductionInspection "complete" @{
          receipt_signature = "verified"
          installer_sha256 = $context.Receipt.installer.sha256
          signature_sha256 = $context.Receipt.signature.sha256
          manifest_sha256 = $context.Receipt.manifest.sha256
        }
      }
      Apply = $null
    }
    runtime_proved = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectRuntime")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectRuntime"] -ArgumentList @($context)
        }
        Inspect-ProductionRuntime $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplyRuntime")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyRuntime"] -ArgumentList @($context)
          return
        }
        if ($context.RuntimeProofRunner) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.RuntimeProofRunner -ArgumentList @($context)
          $context | Add-Member -NotePropertyName RuntimeProvedThisInvocation -NotePropertyValue $true -Force
          return
        }
        Invoke-StreamedProcess "local ship-reinstall runtime proof" "powershell" @(
          "-NoProfile", "-File", (Join-Path $context.Repo "scripts\ship-reinstall.ps1"),
          "-VerifyRuntime",
          "-ExpectedCommit", $context.Receipt.commit,
          "-ExpectedInstallerPath", $context.Installer,
          "-ExpectedInstallerSha256", $context.Receipt.installer.sha256
        ) -WorkingDirectory $context.Repo -TimeoutMs 1800000 | Out-Null
        # The post-action inspection must know a live proof just completed before the journal exists.
        $context | Add-Member -NotePropertyName RuntimeProvedThisInvocation -NotePropertyValue $true -Force
      }
    }
    source_main_pushed = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectSourceMain")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectSourceMain"] -ArgumentList @($context)
        }
        Inspect-ProductionSourceMain $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplySourceMain")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplySourceMain"] -ArgumentList @($context)
          return
        }
        Invoke-ProductionGitChecked "push staged source" $context @(
          "-C", $context.Repo, "push", "--no-follow-tags", "origin", "$($context.Receipt.commit):main"
        ) -ShowOutput | Out-Null
      }
    }
    source_tag_pushed = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectSourceTag")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectSourceTag"] -ArgumentList @($context)
        }
        Inspect-ProductionSourceTag $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplySourceTag")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplySourceTag"] -ArgumentList @($context)
          return
        }
        Invoke-ProductionGitChecked "push exact source tag" $context @(
          "-C", $context.Repo, "push", "origin", "refs/tags/$($context.Receipt.tag)"
        ) -ShowOutput | Out-Null
      }
    }
    releases_tag_created = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and
            $context.Dependencies.ContainsKey("InspectReleasesTag") -and
            $null -ne $context.Dependencies["InspectReleasesTag"]) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectReleasesTag"] -ArgumentList @($context)
        }
        Inspect-ProductionReleasesTag $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and
            $context.Dependencies.ContainsKey("ApplyReleasesTag") -and
            $null -ne $context.Dependencies["ApplyReleasesTag"]) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyReleasesTag"] -ArgumentList @($context)
          return
        }
        $target = if ($context.ReleasesTagTarget) { $context.ReleasesTagTarget } else { Get-ProductionReleasesMain $context }
        Invoke-ProductionGhChecked "create releases-repository tag" $context @(
          "api", "repos/$($context.ReleasesRepo)/git/refs",
          "-f", "ref=refs/tags/$($context.Receipt.tag)", "-f", "sha=$target"
        ) -ShowOutput | Out-Null
      }
    }
    draft_created = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectDraft")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectDraft"] -ArgumentList @($context)
        }
        Inspect-ProductionDraft $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplyDraft")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyDraft"] -ArgumentList @($context)
          return
        }
        Invoke-ProductionGhChecked "create private draft release" $context @(
          "release", "create", $context.Receipt.tag, "--repo", $context.ReleasesRepo,
          "--draft", "--verify-tag", "--title", "Compy $($context.Receipt.tag)",
          "--notes", $context.ReleaseNotes
        ) -TimeoutMs 300000 -ShowOutput | Out-Null
      }
    }
    draft_assets_verified = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectDraftAssets")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectDraftAssets"] -ArgumentList @($context)
        }
        Inspect-ProductionDraftAssets $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplyDraftAssets")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyDraftAssets"] -ArgumentList @($context)
          return
        }
        $uploadPaths = @()
        foreach ($name in @($context.MissingDraftAssets)) {
          if ($name -eq $context.InstallerName) { $uploadPaths += $context.Installer }
          elseif ($name -eq "latest.json") { $uploadPaths += $context.Manifest }
          else { throw "Draft inspection requested an unknown asset upload: $name" }
        }
        if ($uploadPaths.Count -eq 0) {
          throw "Draft asset stage was absent but named no missing assets."
        }
        Invoke-ProductionGhChecked "upload missing immutable draft assets" $context (@(
          "release", "upload", $context.Receipt.tag, "--repo", $context.ReleasesRepo
        ) + $uploadPaths) -TimeoutMs 1800000 -ShowOutput | Out-Null
      }
    }
    release_published = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectPublished")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectPublished"] -ArgumentList @($context)
        }
        Inspect-ProductionPublished $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplyPublished")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyPublished"] -ArgumentList @($context)
          return
        }
        $publicVersionGate = $context.AssertPublicVersion
        Invoke-ReleaseScriptBlock -ScriptBlock $publicVersionGate -ArgumentList @($context)
        Invoke-ProductionGhChecked "publish verified GitHub release" $context @(
          "release", "edit", $context.Receipt.tag, "--repo", $context.ReleasesRepo, "--draft=false"
        ) -TimeoutMs 300000 -ShowOutput | Out-Null
      }
    }
    public_assets_verified = @{
      Inspect = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("InspectPublicAssets")) {
          return Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["InspectPublicAssets"] -ArgumentList @($context)
        }
        Inspect-ProductionPublicAssets $context
      }
      Apply = {
        param($context)
        if ($context.Dependencies -and $context.Dependencies.ContainsKey("ApplyPublicAssets")) {
          Invoke-ReleaseScriptBlock -ScriptBlock $context.Dependencies["ApplyPublicAssets"] -ArgumentList @($context)
          return
        }
        throw "Public assets are absent after publication; verification cannot manufacture them."
      }
    }
  }
}
