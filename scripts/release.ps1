# release.ps1 - one-command Compy release: bump -> commit -> signed build -> latest.json
# -> GitHub release on Pootytxng/compy-releases -> local ship-reinstall -> push.
#
# The fleet updater (tauri-plugin-updater, ARMED 2026-07-22) polls:
#   https://github.com/Pootytxng/compy-releases/releases/latest/download/latest.json
# so PUBLISHING A RELEASE IS THE SHIP MOMENT for every install in the field that carries
# the updater. Distribution is owner territory: run this only on the owner's go.
#
# Usage (from anywhere; same call-operator quirk as ship-reinstall.ps1):
#   powershell -NoProfile -Command "& 'C:\Users\Kuya\code\sentinel\scripts\release.ps1' -Notes 'What changed, in plain English'"
# Options:
#   -Notes <string>    REQUIRED. Release notes; shown verbatim in the in-app update panel.
#   -SetVersion x.y.z  Explicit version (default: bump patch).
#   -BumpMinor         Bump minor instead of patch.
#   -NoPublish         Build + manifest only; skips the GitHub release AND the git push.
#   -SkipReinstall     Skip the local ship-reinstall step (rare - the reinstall law says do it).
#
# ASCII ONLY in this file (see ship-reinstall.ps1's BOM/mojibake bug->guard; ASCII sidesteps
# the entire encoding class in Windows PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Notes,
  [string]$SetVersion,
  [switch]$BumpMinor,
  [switch]$NoPublish,
  [switch]$SkipReinstall
)
$ErrorActionPreference = "Stop"
$repo = "C:\Users\Kuya\code\sentinel"
$releasesRepo = "Pootytxng/compy-releases"

function Write-NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# 0) Preconditions: signing key present (no key -> updates cannot ship, ABORT early).
$keyPath = Join-Path $env:USERPROFILE ".tauri\compy-updater.key"
if (-not (Test-Path $keyPath)) {
  throw "Updater signing key not found at $keyPath - updates CANNOT be signed. Restore it from the owner's backup before releasing."
}

# 1) Version bump. tauri.conf.json is the source of truth; package.json + package-lock.json +
#    Cargo.toml follow. Exact-anchor text replacement, never a JSON/TOML rewrite (preserves
#    formatting; serde_json also rejects a BOM, which ConvertTo-Json + Set-Content would add).
$confPath  = "$repo\src-tauri\tauri.conf.json"
$pkgPath   = "$repo\package.json"
$lockPath  = "$repo\package-lock.json"
$cargoPath = "$repo\src-tauri\Cargo.toml"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$cur = [version]$conf.version
if ($SetVersion)    { $new = [version]$SetVersion }
elseif ($BumpMinor) { $new = [version]::new($cur.Major, $cur.Minor + 1, 0) }
else                { $new = [version]::new($cur.Major, $cur.Minor, $cur.Build + 1) }
$curS = $cur.ToString(); $newS = $new.ToString()
if ($new -le $cur -and -not $SetVersion) { throw "New version $newS is not greater than current $curS" }
Write-Host "Release: $curS -> $newS"

$curEsc = [regex]::Escape($curS)
Write-NoBom $confPath ((Get-Content $confPath -Raw) -replace ('"version": "' + $curEsc + '"'), ('"version": "' + $newS + '"'))
Write-NoBom $pkgPath  ((Get-Content $pkgPath  -Raw) -replace ('"version": "' + $curEsc + '"'), ('"version": "' + $newS + '"'))
# package-lock: ONLY the two compy root entries (a dep pinned at the same number must not move).
$lockRe = '("name": "compy",\s*"version": ")' + $curEsc + '"'
Write-NoBom $lockPath ((Get-Content $lockPath -Raw) -replace $lockRe, ('${1}' + $newS + '"'))
# Cargo.toml: the [package] version is the only line-start `version = ` in the file.
Write-NoBom $cargoPath ((Get-Content $cargoPath -Raw) -replace ('(?m)^version = "' + $curEsc + '"'), ('version = "' + $newS + '"'))
# Cargo.lock: sync the compy entry so the release commit is complete (no post-build dirt).
Push-Location "$repo\src-tauri"
cargo update -p compy 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "cargo update -p compy failed (Cargo.lock sync)" }
Pop-Location

# 2) Commit the bump BEFORE building - ship-reinstall's stale-build gate requires the build
#    stamp to equal HEAD, so the release commit must exist first. Adds ONLY the bump files;
#    any other dirt stays visible to the dirty-stamp gate (deliberately).
git -C $repo add "src-tauri/tauri.conf.json" "package.json" "package-lock.json" "src-tauri/Cargo.toml" "src-tauri/Cargo.lock"
git -C $repo commit -m "release: v$newS" -m "$Notes"
if ($LASTEXITCODE -ne 0) { throw "git commit of the version bump failed" }
$head = (git -C $repo rev-parse --short HEAD).Trim()
Write-Host "Release commit: $head"

# 3) Signed build. TAURI_SIGNING_PRIVATE_KEY_PATH makes `tauri build` emit the .sig next to
#    the NSIS installer (createUpdaterArtifacts). Process-scoped env: nothing persists.
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
Push-Location $repo
npm run tauri build
$buildExit = $LASTEXITCODE
Pop-Location
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
if ($buildExit -ne 0) { throw "npm run tauri build failed (exit $buildExit)" }

# 4) Artifact + signature verification. A missing .sig means signing broke: the release would
#    be UNINSTALLABLE by the fleet updater (signature verification is mandatory). Hard abort.
$nsis = "$repo\src-tauri\target\release\bundle\nsis\Compy_${newS}_x64-setup.exe"
$sig  = "$nsis.sig"
if (-not (Test-Path $nsis)) { throw "NSIS installer not found: $nsis" }
if (-not (Test-Path $sig))  { throw "Updater signature missing: $sig - signing env or createUpdaterArtifacts broke. ABORTING before anything ships." }

# 5) latest.json - the manifest every fleet install polls. The signature field is the .sig
#    CONTENT (minisign over the NSIS installer); the url must byte-match the uploaded asset name.
$sigContent = (Get-Content $sig -Raw).Trim()
$manifest = [ordered]@{
  version   = $newS
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $sigContent
      url       = "https://github.com/$releasesRepo/releases/download/v$newS/Compy_${newS}_x64-setup.exe"
    }
  }
}
$latestPath = "$repo\src-tauri\target\release\bundle\nsis\latest.json"
Write-NoBom $latestPath (($manifest | ConvertTo-Json -Depth 5))
Write-Host "Manifest written: $latestPath"

# 6) Publish: the GitHub release IS the fleet ship moment (releases/latest/download resolves
#    to this the instant it publishes). Installer + manifest land in one atomic create.
if ($NoPublish) {
  Write-Host "-NoPublish: skipping GitHub release and git push. Built + signed only."
} else {
  gh release create "v$newS" --repo $releasesRepo --title "Compy v$newS" --notes "$Notes" "$nsis" "$latestPath"
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed - fleet endpoint NOT updated" }
  Write-Host "Published: https://github.com/$releasesRepo/releases/tag/v$newS"
}

# 7) Local reinstall (the silent-reinstall law: the owner's desktop always runs the current
#    build, one installer on the Desktop, nothing for him to do) + push the release commit.
if (-not $SkipReinstall) { & "$repo\scripts\ship-reinstall.ps1" }
if (-not $NoPublish) {
  git -C $repo push
  if ($LASTEXITCODE -ne 0) { throw "git push failed (release is live; push the commit manually)" }
}
Write-Host "RELEASE COMPLETE: v$newS ($head)"
