# ship-reinstall.ps1 — the post-rebuild ship law, codified.
#
# After `npm run tauri build`, run this so the LIVE running Compy becomes the just-built version, with
# exactly ONE (current) installer on the Desktop. The OWNER NEVER installs manually — he only verifies.
# (Memory: "silent-reinstall-is-my-job"; CLAUDE.md standing rule. Run from anywhere.)
#
# INVOCATION: in the Claude Code Bash->PowerShell shell, `powershell -File <path>` parse-errors
# ("Unexpected token") — a shell quirk, not a script bug. Use the call operator (or run the steps inline):
#   powershell -NoProfile -Command "& '<repo>\scripts\ship-reinstall.ps1'"            # install + launch
#   powershell -NoProfile -Command "& '<repo>\scripts\ship-reinstall.ps1' -NoLaunch"  # don't launch
#
# ENCODING (bug→guard 2026-07-16): this file MUST start with a UTF-8 BOM. Windows PowerShell 5.1
# (`powershell`) decodes a BOM-less file as ANSI, so the em-dashes in the throw strings become
# mojibake that parse-errors the whole script (caught live at the 0.9.0 ship — an edit had re-saved
# the file without its BOM). pwsh 7 reads UTF-8 either way. Pinned by version-drift-guard.test.mjs
# Guard C — any tool that re-saves this file must preserve the BOM (or run the guard and find out).
param(
  [switch]$NoLaunch,
  [switch]$AllowDirty,
  [switch]$VerifyRuntime,
  [string]$ExpectedCommit,
  [string]$ExpectedInstallerPath,
  [string]$ExpectedInstallerSha256
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ($VerifyRuntime -and $NoLaunch) {
  throw "VerifyRuntime requires launching the installed app."
}
if ($VerifyRuntime -and $ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') {
  throw "VerifyRuntime requires the full 40-character expected source commit."
}
if (($ExpectedInstallerPath -and -not $ExpectedInstallerSha256) -or
    ($ExpectedInstallerSha256 -and -not $ExpectedInstallerPath)) {
  throw "ExpectedInstallerPath and ExpectedInstallerSha256 must be supplied together."
}

function Get-FreeLoopbackPort {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

# Version is DERIVED from tauri.conf.json (single source of truth) — never hardcode it here.
# A hardcoded 0.1.0 survived the 0.9.0 bump as a silent drift site; derivation kills the class.
$conf = Get-Content (Join-Path $repo "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$ver = $conf.version
if (-not $ver) { throw "Could not read .version from tauri.conf.json" }
$nsis = Join-Path $repo "src-tauri\target\release\bundle\nsis\Compy_${ver}_x64-setup.exe"
if (-not (Test-Path $nsis)) { throw "Built NSIS not found — run 'npm run tauri build' first: $nsis" }
if ($ExpectedInstallerPath) {
  $actualPath = [System.IO.Path]::GetFullPath($nsis)
  $expectedPath = [System.IO.Path]::GetFullPath($ExpectedInstallerPath)
  if (-not $actualPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "INSTALLER PATH MISMATCH: ship-reinstall derived '$actualPath'; receipt names '$expectedPath'."
  }
  $actualInstallerHash = (Get-FileHash -LiteralPath $nsis -Algorithm SHA256).Hash
  if ($actualInstallerHash -ne $ExpectedInstallerSha256) {
    throw "INSTALLER HASH MISMATCH: canonical NSIS does not match the signed staged receipt."
  }
}
$desk = [Environment]::GetFolderPath("Desktop")

# 0) STALE-BUILD GATE (bug→guard, 2026-07-06): a docs/frontend-only commit chain can leave cargo's
#    fingerprint "fresh", so `npm run tauri build` silently re-bundles the PREVIOUS binary — stale
#    stamp AND stale embedded assets (caught live: a rebuild at b52adb3 shipped a 6b2f46f exe).
#    stamp == HEAD ⟺ the crate recompiled ⟺ assets were re-embedded from the current dist/. The
#    packaged exe is checked BEFORE install; on mismatch: `cargo clean -p compy --release` + rebuild.
$releaseExe = Join-Path $repo "src-tauri\target\release\compy.exe"
if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
  throw "Built release executable is missing before install: $releaseExe"
}
$headOutput = @(& git -C $repo rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0) { throw "Could not resolve the source HEAD before install." }
$head = (($headOutput | Out-String).Trim())
if (-not $head) { throw "Source HEAD was empty before install." }
if (-not (Select-String -Path $releaseExe -Pattern $head -Quiet)) {
  throw "STALE BUILD: target\release\compy.exe does not embed HEAD ($head) — cargo reused a cached binary. Run: cargo clean -p compy --release --manifest-path src-tauri/Cargo.toml && npm run tauri build"
}

# 0b) DIRTY-STAMP GATE (bug→guard, 2026-07-14): a build cut from a dirty tree stamps "+dirty" and
#     nothing downstream ever mechanically checked it — the PART B installer shipped stamped
#     "2eda4eb+dirty" unnoticed (that one was benign: docs-only untracked files, and build.rs now
#     excludes docs/ from the dirty check). This gate blocks the REAL case: any tracked change or
#     non-docs untracked file at ship time means the stamp can't be trusted to equal HEAD's code.
#     Override deliberately with -AllowDirty (states intent in the transcript).
$treeDirt = @(& git -C $repo status --porcelain -- ":(exclude)docs")
if ($LASTEXITCODE -ne 0) { throw "Could not verify the source worktree before install." }
if ($treeDirt -and -not $AllowDirty) {
  $dirtLines = $treeDirt -join [Environment]::NewLine
  throw "DIRTY-STAMP: the tree has non-docs changes — the build stamp would read '+dirty' (or lie about HEAD). Commit/stash first, rebuild, then ship. Deliberate override: -AllowDirty.`n$dirtLines"
}

# 0c) GAMING-MODE RESTORE GATE (bug->guard 2026-07-22): closing Compy does not itself run the
# Gaming Mode restore orchestrator. Any live, pending, unreadable, temp, or quarantined contract may
# therefore represent session-scoped Windows changes that still need recovery. Refuse BEFORE touching
# a process or installer; never parse, delete, quarantine, or guess from this ship script.
$gamingDataDir = Join-Path $env:APPDATA "Compy"
$pendingGamingContracts = @()
if (Test-Path -LiteralPath $gamingDataDir -PathType Container) {
  # A cleanly-CLEARED session backup (the app renames an ended contract to
  # gaming-session.cleared-<ts>.json.bak) is the app's OWN "already restored" marker and does NOT need
  # recovery (gaming_session.rs documented intent: cleared sessions don't qualify). Exclude ONLY that
  # exact cleared-backup shape; a live gaming-session.json, a quarantine, a temp, or a numbered contract
  # still blocks. Reconcile 2026-07-23: the broad glob false-positived on a month-old cleared .bak and
  # would have blocked EVERY publish (evidence: gaming-session.cleared-20260618-202101.json.bak). The
  # pinned `gaming-session*` substring is preserved for release-pipeline-guard.test.mjs.
  $pendingGamingContracts = @(Get-ChildItem -LiteralPath $gamingDataDir -Force -ErrorAction Stop |
    Where-Object { $_.Name -like "gaming-session*" } |
    Where-Object { $_.Name -notlike "*.cleared-*.json.bak" })
}
if ($pendingGamingContracts.Count -gt 0) {
  $contractNames = ($pendingGamingContracts.Name -join ", ")
  throw "GAMING MODE RESTORE REQUIRED: update/install refused before closing Compy. Return to normal or recover the pending Gaming Mode session, confirm its contract clears, then retry. Preserved: $contractNames"
}

# 1) Stop any running Compy so the install can replace the exe (single-instance + file lock). The
# Gaming Mode gate above, not CloseMainWindow, proves no temporary session contract remains. Close
# the ordinary app gracefully first for its normal shutdown path, then force-kill only stragglers.
foreach ($p in (Get-Process compy -ErrorAction SilentlyContinue)) {
  if ($p.MainWindowHandle -ne 0) { $p.CloseMainWindow() | Out-Null }
}
Start-Sleep -Milliseconds 1500
# Force-kill stragglers we CAN kill — per-process, denial-tolerant (bug→guard 2026-07-22): the
# ELEVATED fps-capture helper is Access-denied from this non-elevated shell, and under
# ErrorActionPreference=Stop the old single-pipeline Stop-Process died on it BEFORE killing the
# main app or staging anything (caught live mid-smoke-QA). The helper needs no kill anyway — it
# self-exits ~4s after the main app's fps.alive heartbeat goes stale — so kill what we can, then
# WAIT for the rest to drain.
Get-Process compy -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
}
$drainDeadline = (Get-Date).AddSeconds(20)
while ((Get-Process compy -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $drainDeadline)) {
  Start-Sleep -Milliseconds 500
}
$left = Get-Process compy -ErrorAction SilentlyContinue
if ($left) { throw "compy process(es) still alive 20s after close+kill (PID $(($left.Id) -join ', ')) — a helper that won't self-exit is a real defect (and would hold the exe lock through the install); investigate before shipping." }
Start-Sleep -Milliseconds 600

# 2) Desktop hygiene: remove EVERY Compy installer, then stage ONLY the current NSIS (one file).
Get-ChildItem $desk -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "Compy*" -and ($_.Extension -eq ".exe" -or $_.Extension -eq ".msi") } |
  Remove-Item -Force
$dest = Join-Path $desk "Compy_${ver}_x64-setup.exe"
Copy-Item $nsis $dest -Force
$sha = (Get-FileHash $dest -Algorithm SHA256).Hash

# 3) Silent install (per-user → no UAC). A hung installer must stop the release train rather than
# hold the owner shell forever; leave its PID visible for manual inspection instead of killing a
# possibly mid-transaction installer and pretending rollback is safe.
$p = Start-Process -FilePath $dest -ArgumentList "/S" -PassThru
if (-not $p.WaitForExit(180000)) {
  throw "Silent install timed out after 180 seconds (PID $($p.Id)). Publication remains blocked; inspect the installer before retrying."
}
$p.Refresh()
if ($p.ExitCode -ne 0) { throw "Silent install failed: exit $($p.ExitCode)" }

# 4) Prove the installed payload and Windows app metadata both match the staged release.
$exe = Join-Path $env:LOCALAPPDATA "Compy\compy.exe"
if (-not (Test-Path $exe)) { throw "Installed exe not found after install: $exe" }
$builtExeHash = (Get-FileHash $releaseExe -Algorithm SHA256).Hash
$installedExeHash = (Get-FileHash $exe -Algorithm SHA256).Hash
if ($installedExeHash -ne $builtExeHash) {
  throw "INSTALLED-BINARY MISMATCH: installed compy.exe does not byte-match the staged release binary."
}
$installedVersion = (Get-Item $exe).VersionInfo.ProductVersion
if ($installedVersion -ne $ver) {
  throw "INSTALLED-VERSION MISMATCH: installed compy.exe reports $installedVersion; expected $ver."
}
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Compy"
$uninstall = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
if (-not $uninstall) {
  throw "INSTALL-METADATA MISSING: Windows has no Compy uninstall record at $uninstallKey."
}
if ($uninstall.DisplayVersion -ne $ver) {
  throw "INSTALL-METADATA MISMATCH: Windows Apps reports $($uninstall.DisplayVersion); expected $ver."
}

# 5) Launch so the running app IS the new build (unless -NoLaunch). Release publication uses
# VerifyRuntime: the app must stay alive, mount its real shell, and return the exact clean build
# stamp over the existing read-only CDP probe before any source push or fleet publication.
$runtimeProof = $null
if (-not $NoLaunch) {
  if ($VerifyRuntime) {
    $debugPort = Get-FreeLoopbackPort
    $debugName = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
    $priorDebug = [Environment]::GetEnvironmentVariable($debugName, "Process")
    [Environment]::SetEnvironmentVariable($debugName, "--remote-debugging-port=$debugPort", "Process")
    try {
      $launched = Start-Process $exe -PassThru
    } finally {
      [Environment]::SetEnvironmentVariable($debugName, $priorDebug, "Process")
    }

    $expectedShort = (& git -C $repo rev-parse --short $ExpectedCommit).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $expectedShort) {
      throw "Could not derive the expected short build stamp for $ExpectedCommit."
    }
    $expectedStamp = $expectedShort + " " + [char]0x00B7 + " release"
    $probeScript = Join-Path $repo "scripts\e2e-updater-probe.mjs"
    try {
      $deadline = (Get-Date).AddSeconds(30)
      while ((Get-Date) -lt $deadline) {
        if ($launched.HasExited) {
          throw "RUNTIME PROOF FAILED: installed Compy exited before its main window became healthy (exit $($launched.ExitCode))."
        }
        $probeText = (& node $probeScript $debugPort stamp 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $probeText) {
          try {
            $probe = $probeText | ConvertFrom-Json
            if ($probe.stamp -ne $expectedStamp) {
              throw "RUNTIME STAMP MISMATCH: running app reports '$($probe.stamp)'; expected '$expectedStamp'."
            }
            if (-not $probe.railVersion -or $probe.railVersion -notmatch [regex]::Escape($ver)) {
              throw "RUNTIME VERSION MISMATCH: the mounted shell does not show version $ver (found '$($probe.railVersion)')."
            }
            $runtimeProof = $probe
            break
          } catch {
            if ($_.Exception.Message -like "RUNTIME *") { throw }
          }
        }
        Start-Sleep -Milliseconds 500
      }
      if (-not $runtimeProof) {
        throw "RUNTIME PROOF FAILED: Compy's main shell did not answer the build-stamp probe within 30 seconds."
      }
    } finally {
      # Never leave a release build running with a CDP debugging port. Close the proof launch and
      # restart normally only after its exact stamp and mounted shell have passed.
      if ($launched -and -not $launched.HasExited) {
        if ($launched.MainWindowHandle -ne 0) { $launched.CloseMainWindow() | Out-Null }
        if (-not $launched.WaitForExit(5000)) {
          Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue
          $launched.WaitForExit(5000) | Out-Null
        }
      }
    }
    Start-Process $exe
  } else {
    Start-Process $exe
  }
}

Write-Output "ship-reinstall OK"
Write-Output ("installer SHA-256 : " + $sha)
Write-Output ("live exe          : " + $exe + $(if ($NoLaunch) { " (not launched)" } else { " (launched)" }))
Write-Output ("installed version : " + $installedVersion + " (Windows Apps: " + $uninstall.DisplayVersion + ")")
if ($runtimeProof) {
  Write-Output ("runtime proof     : " + $runtimeProof.stamp + " · shell " + $runtimeProof.railVersion)
} else {
  Write-Output "Desktop now holds exactly one installer. Runtime proof was not requested."
}
