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
  [switch]$ProofOnly,
  [string]$ExpectedCommit,
  [string]$ExpectedInstallerPath,
  [string]$ExpectedInstallerSha256
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\process-mutex.ps1")
$installedBinaryMutex = Enter-CompyProcessMutex `
  -Name "Local\Compy.InstalledBinary.v1" `
  -Resource "InstalledBinary"
try {
# Runtime proof mechanism (Invoke-NativeProcess / Invoke-CompyRuntimeProof). Lives in its own
# dot-sourced file so the release-pipeline tests can drive it directly. See its header for the
# 2026-07-27 NativeCommandError incident it exists to make impossible.
. (Join-Path $PSScriptRoot "lib\canonical-data-root.ps1")
. (Join-Path $PSScriptRoot "lib\runtime-proof.ps1")
# Every external command in this script runs through the shared native-process abstraction. Windows PowerShell 5.1
# turns a native command's stderr into a TERMINATING error under "Stop" (that is what broke the
# v0.9.9 publish), and git legitimately writes warnings to stderr, so no gate here may depend on
# whether an external tool happened to stay quiet.

if ($VerifyRuntime -and $NoLaunch) {
  throw "VerifyRuntime requires launching the installed app."
}
if ($ProofOnly) {
  $VerifyRuntime = $true
  if ($NoLaunch) { throw "ProofOnly cannot be combined with NoLaunch." }
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
$proofCommit = if ($VerifyRuntime) { $ExpectedCommit } else { "HEAD" }
$headProbe = Invoke-NativeProcess -Command "git" -ArgumentList @("-C", $repo, "rev-parse", "--short", $proofCommit)
if ($headProbe.ExitCode -ne 0) { throw "Could not resolve the expected source commit before install. $(Get-FirstNonEmptyLine $headProbe.StdErr)" }
$expectedShortCommit = $headProbe.StdOut.Trim()
if (-not $expectedShortCommit) { throw "Expected source commit was empty before install." }
if (-not (Select-String -Path $releaseExe -Pattern $expectedShortCommit -Quiet)) {
  throw "STALE BUILD: target\release\compy.exe does not embed receipt-bound commit ($expectedShortCommit). Run: cargo clean -p compy --release --manifest-path src-tauri/Cargo.toml && npm run tauri build"
}

# 0b) DIRTY-STAMP GATE (bug→guard, 2026-07-14): a build cut from a dirty tree stamps "+dirty" and
#     nothing downstream ever mechanically checked it — the PART B installer shipped stamped
#     "2eda4eb+dirty" unnoticed (that one was benign: docs-only untracked files, and build.rs now
#     excludes docs/ from the dirty check). This gate blocks the REAL case: any tracked change or
#     non-docs untracked file at ship time means the stamp can't be trusted to equal HEAD's code.
#     Override deliberately with -AllowDirty (states intent in the transcript).
$dirtProbe = Invoke-NativeProcess -Command "git" -ArgumentList @("-C", $repo, "status", "--porcelain", "--", ":(exclude)docs")
if ($dirtProbe.ExitCode -ne 0) { throw "Could not verify the source worktree before install. $(Get-FirstNonEmptyLine $dirtProbe.StdErr)" }
$treeDirt = @($dirtProbe.StdOut -split "`r?`n" | Where-Object { $_.Trim() })
if ($treeDirt.Count -gt 0 -and -not $AllowDirty) {
  $dirtLines = $treeDirt -join [Environment]::NewLine
  throw "DIRTY-STAMP: the tree has non-docs changes — the build stamp would read '+dirty' (or lie about HEAD). Commit/stash first, rebuild, then ship. Deliberate override: -AllowDirty.`n$dirtLines"
}

# 0c) GAMING-MODE RESTORE GATE (bug->guard 2026-07-22): closing Compy does not itself run the
# Gaming Mode restore orchestrator. Any live, pending, unreadable, temp, or quarantined contract may
# therefore represent session-scoped Windows changes that still need recovery. Refuse BEFORE touching
# a process or installer; never parse, delete, quarantine, or guess from this ship script.
# #130: the root is PROVEN canonical before it is read - a redirected or split root throws here
# rather than reporting "no pending contract" about a folder it never looked at.
$verifiedGamingRoot = Get-CanonicalCompyDataRoot -Phase "gaming-mode restore gate"
$gamingDataDir = $verifiedGamingRoot.Path
$pendingGamingContracts = @()
if ($verifiedGamingRoot.Exists) {
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

# 1b) PAYLOAD-LOCK GATE (bug→guard 2026-08-21, issue #156). Every compy PROCESS being gone is not
#     the same fact as the installed exe being WRITABLE: an antimalware scan, Explorer's icon
#     reader, or a straggler handle can outlive process exit by seconds. NSIS in silent mode does
#     not fail on a file it cannot overwrite — it SKIPS it and still exits 0, which is exactly how
#     2026-08-20 produced an "installed" build whose compy.exe kept its previous mtime and its
#     previous embedded stamp (402b0080). The stamp gate at step 4 caught that, but only after the
#     fact and only as "a wrong/older build is installed". Prove writability BEFORE handing the
#     installer a file it will silently decline to replace, so the failure is named at its cause.
$exe = Join-Path $env:LOCALAPPDATA "Compy\compy.exe"
function Test-CompyExeWritable {
  param([Parameter(Mandatory = $true)][string]$Path)
  # A file that does not exist yet (first install) is trivially writable.
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  # FileShare::None is the point: it succeeds only when NOBODY else holds a handle, which is the
  # precondition NSIS actually needs. A narrower probe would pass while the install still skips.
  try {
    $probe = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $probe.Dispose()
    return $true
  } catch {
    # Deliberately swallowed: "locked" is the ANSWER this probe returns, not an error to raise. The
    # caller decides whether a locked file is fatal, and does so with a named throw of its own.
    return $false
  }
}
function Wait-CompyExeWritable {
  param([Parameter(Mandatory = $true)][string]$Path, [int]$TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-CompyExeWritable -Path $Path) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 500
  }
  return (Test-CompyExeWritable -Path $Path)
}
$prePayload = $null
if (-not $ProofOnly) {
  if (-not (Wait-CompyExeWritable -Path $exe)) {
    throw "PAYLOAD LOCKED (issue #156): $exe is still held by another process 20s after every compy process exited. A silent NSIS install would exit 0 and skip the payload rather than fail. Close whatever holds the file (an antimalware scan or Explorer usually releases within seconds) and re-run; do NOT loosen the stamp gate at step 4."
  }
  # Identity BEFORE the install, so step 3b can tell "payload not written" apart from "wrong build
  # written". mtime alone is not proof — length is carried with it because a same-second rebuild of
  # a same-size binary is the one case mtime could miss.
  if (Test-Path -LiteralPath $exe) {
    $preItem = Get-Item -LiteralPath $exe
    $prePayload = [pscustomobject]@{ WriteTimeUtc = $preItem.LastWriteTimeUtc; Length = $preItem.Length }
  }
}

# 2-3) A journal rerun uses ProofOnly: it re-proves the real installed payload and mounted shell
# without reinstalling or changing Desktop artifacts. A first proof stages and installs the exact
# receipt-bound NSIS through the recoverable replacement path.
$desktopBackup = $null
if ($ProofOnly) {
  $dest = $nsis
  $sha = (Get-FileHash -LiteralPath $nsis -Algorithm SHA256).Hash
} else {
  $dest = Join-Path $desk "Compy_${ver}_x64-setup.exe"
  $incoming = Join-Path $desk (".compy-incoming-" + [guid]::NewGuid().ToString("N") + ".exe")
  $desktopBackup = Join-Path ([System.IO.Path]::GetTempPath()) ("compy-desktop-installers-" + [guid]::NewGuid().ToString("N"))
  Copy-Item -LiteralPath $nsis -Destination $incoming
  if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $nsis -Algorithm SHA256).Hash) {
    throw "Desktop staging copy does not match the canonical NSIS installer."
  }
  New-Item -ItemType Directory -Path $desktopBackup | Out-Null
  $priorInstallers = @(Get-ChildItem $desk -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $incoming -and $_.Name -like "Compy*" -and ($_.Extension -eq ".exe" -or $_.Extension -eq ".msi") })
  foreach ($priorInstaller in $priorInstallers) {
    Copy-Item -LiteralPath $priorInstaller.FullName -Destination (Join-Path $desktopBackup $priorInstaller.Name)
    Remove-Item -LiteralPath $priorInstaller.FullName -Force
  }
  Move-Item -LiteralPath $incoming -Destination $dest -Force
  $sha = (Get-FileHash $dest -Algorithm SHA256).Hash

  # Silent install (per-user -> no UAC). Leave a hung installer visible rather than killing it
  # mid-transaction and pretending rollback is safe.
  #
  # 3b) PAYLOAD-REPLACEMENT GATE + exactly ONE loud retry (bug→guard 2026-08-21, issue #156).
  #     Exit 0 from a silent NSIS is NOT proof the payload landed — on 2026-08-20 it rewrote the
  #     Desktop shortcut, exited 0, and left compy.exe untouched. The retry mirrors the accepted
  #     #171 precedent: bounded, loud, and keyed to EXACTLY that signature, never a blanket retry.
  #     The step-4 stamp gate is untouched and still fails closed if a retry lands a wrong build —
  #     this gate only makes "the installer skipped the file" say so at the moment it happens.
  $installAttempts = 0
  while ($true) {
    $installAttempts++
    $installResult = Invoke-NativeProcess -Command $dest -ArgumentList @("/S") -TimeoutMs 180000 -KillTreeOnTimeout $false
    if ($installResult.TimedOut) {
      throw "Silent install timed out after 180 seconds (PID $($installResult.ProcessId)). Publication remains blocked; inspect the installer before retrying. Prior Desktop installers remain preserved at $desktopBackup."
    }
    if ($installResult.ExitCode -ne 0) {
      throw "Silent install failed: exit $($installResult.ExitCode). Prior Desktop installers remain preserved at $desktopBackup."
    }
    if (-not (Test-Path -LiteralPath $exe)) {
      throw "Installed exe not found after a silent install that exited 0: $exe. Prior Desktop installers remain preserved at $desktopBackup."
    }
    $postItem = Get-Item -LiteralPath $exe
    $payloadUntouched = ($null -ne $prePayload) -and
      ($postItem.LastWriteTimeUtc -eq $prePayload.WriteTimeUtc) -and
      ($postItem.Length -eq $prePayload.Length)
    if (-not $payloadUntouched) { break }
    if ($installAttempts -ge 2) {
      throw "SILENT INSTALL SKIPPED THE PAYLOAD (issue #156): the installer exited 0 twice and compy.exe still carries its pre-install timestamp and size ($($prePayload.Length) bytes). This is NOT a gate to loosen — the build on disk is not the build that was staged. Prior Desktop installers remain preserved at $desktopBackup."
    }
    Write-Warning "WARN issue #156: silent install exited 0 but did not replace $exe (same mtime and size as before). Re-proving the file is unlocked and retrying the install ONCE, loudly."
    if (-not (Wait-CompyExeWritable -Path $exe)) {
      throw "PAYLOAD LOCKED (issue #156): $exe became locked again between the pre-install gate and the install, and is still held 20s later. Publication remains blocked. Prior Desktop installers remain preserved at $desktopBackup."
    }
  }
}

# 4) Prove the installed payload and Windows app metadata both match the staged release.
# $exe was resolved at step 1b, where the payload-lock gate needs it first.
if (-not (Test-Path $exe)) { throw "Installed exe not found after install: $exe" }
# Correctness invariant is EMBEDDED COMMIT + version, NOT byte-identity. NSIS packaging is not
# byte-preserving and Rust release links aren't reproducible (PE timestamp + debug GUID differ per
# link), so a legitimate install of THIS build routinely has a different SHA-256 than
# target/release/compy.exe (same commit, same version, same size). Byte-matching the two spuriously
# failed a correct 0.9.7/100ace3 install on 2026-07-23. The staleness we actually guard against is
# "an OLDER build got installed" — caught precisely by the env!("COMPY_GIT_HASH") short hash baked
# into the exe (the same Gate-0 proof run against the staged binary) plus the ProductVersion check
# below. (bug->guard 2026-07-23; matches CLAUDE.md ship-LAW: verify by stamp, not exe hash.)
if (-not (Select-String -Path $exe -Pattern $expectedShortCommit -Quiet)) {
  throw "INSTALLED-BINARY STALE: installed compy.exe does not embed receipt-bound commit $expectedShortCommit; a wrong/older build is installed."
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
  # DEBUG-PORT ASSERTION (issue #60 defect 2). The persistent relaunches below are -Detached, and a
  # detached child inherits THIS process's environment rather than taking a child-only override.
  # Proving the variable is absent HERE therefore proves no debugging port can reach the relaunched
  # app - and it fails loud instead of silently clearing. This replaces the old per-child
  # `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null` and is strictly stronger. The proof launch below
  # keeps its child-only override precisely because it NEEDS the port, and is torn down before here.
  if ($env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) {
    throw "REFUSING TO RELAUNCH: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set in this process, so a detached relaunch would inherit it and could leave the shipped build serving a debugging port."
  }
  # FOREGROUND COURTESY (owner ask, 2026-08-11). This relaunch happens whenever a build finishes,
  # which is routinely while the owner is doing something else on the same machine - and activating a
  # window MINIMISES an exclusive-fullscreen game. The app still launches and still appears on the
  # taskbar; it just does not snatch the foreground. Honoured by `should_suppress_activation` in
  # src-tauri/src/lib.rs.
  #
  # BOTH levers are set on purpose, because they cover different processes. The env var is set on
  # THIS process rather than per-child because the relaunches below are -Detached and ShellExecute
  # has no child-only environment (Start-NativeProcess's contract, scripts/lib/native-process.ps1).
  # The argv token is what survives the single-instance hop: if an older Compy is still alive, the
  # new process hands it only its command line and then dies, so an env-only lever would be dropped
  # exactly when it matters.
  $env:COMPY_NO_ACTIVATE = "1"
  $quietLaunchArgs = @("--no-activate")
  # And the LAUNCH itself must not activate (WORK_TRAIN item FOCUS, 2026-10-24): a ShellExecute
  # launch hands the child SW_SHOWNORMAL in its STARTUPINFO, which Windows applies to the first
  # ShowWindow in place of Compy's own non-activating show. So the detached relaunches pass
  # -NoActivate (CreateProcessW with SW_SHOWNOACTIVATE). The -Environment proof launch below goes
  # through CreateProcess without STARTF_USESHOWWINDOW (measured: dwFlags=0), so nothing overrides
  # the app's show there.
  if ($VerifyRuntime) {
    # Derive what the running app MUST report before anything is launched: a bad -ExpectedCommit
    # must never leave a release build running with a debugging port open.
    $stampProbe = Invoke-NativeProcess -Command "git" -ArgumentList @("-C", $repo, "rev-parse", "--short", $ExpectedCommit)
    $expectedShort = $stampProbe.StdOut.Trim()
    if ($stampProbe.ExitCode -ne 0 -or -not $expectedShort) {
      throw "Could not derive the expected short build stamp for $ExpectedCommit. $(Get-FirstNonEmptyLine $stampProbe.StdErr)"
    }
    $expectedStamp = $expectedShort + " " + [char]0x00B7 + " release"
    $probeScript = Join-Path $repo "scripts\e2e-updater-probe.mjs"
    $nodeExe = (Resolve-NativeExecutable "node").Source

    $debugPort = Get-FreeLoopbackPort
    $debugEnvironment = @{
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort"
    }
    $launched = Start-NativeProcess -Command $exe -ArgumentList $quietLaunchArgs -Environment $debugEnvironment

    try {
      # The app needs a moment before it serves CDP, so the first attempts are EXPECTED to fail.
      # Invoke-CompyRuntimeProof treats those as data and keeps polling; it throws on an exited
      # process, a stamp mismatch, a version mismatch, or the deadline.
      $runtimeProof = Invoke-CompyRuntimeProof `
        -LaunchedProcess $launched `
        -ProbeFilePath $nodeExe `
        -ProbeArgumentList @($probeScript, "$debugPort", "stamp") `
        -ExpectedStamp $expectedStamp `
        -ExpectedVersion $ver `
        -TimeoutSeconds 60
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
    Wait-LoopbackPortClosed -Port $debugPort -TimeoutMs 10000
    # -Detached: this app outlives the script, so it must not inherit our stdout/stderr and strand
    # a caller's pipe (issue #60 defect 2). Port absence is proven by the assertion above.
    $normalLaunch = Start-NativeProcess -Command $exe -Detached -NoActivate -ArgumentList $quietLaunchArgs  # detached-window-allow: Compy is a GUI app, and this is the launch the owner is MEANT to see.
    Start-Sleep -Seconds 3
    if ($normalLaunch.HasExited) {
      throw "RUNTIME PROOF FAILED: normal relaunch exited during the health window (exit $($normalLaunch.ExitCode))."
    }
    $normalLaunch.Dispose()
  } else {
    # Same reason as the VerifyRuntime relaunch (issue #60 defect 2).
    $normalLaunch = Start-NativeProcess -Command $exe -Detached -NoActivate -ArgumentList $quietLaunchArgs  # detached-window-allow: Compy is a GUI app, and this is the launch the owner is MEANT to see.
    $normalLaunch.Dispose()
  }
}

if ($desktopBackup -and (Test-Path -LiteralPath $desktopBackup -PathType Container)) {
  Remove-Item -LiteralPath $desktopBackup -Recurse -Force
}

Write-Output "ship-reinstall OK"
Write-Output ("installer SHA-256 : " + $sha)
Write-Output ("live exe          : " + $exe + $(if ($NoLaunch) { " (not launched)" } else { " (launched)" }))
Write-Output ("installed version : " + $installedVersion + " (Windows Apps: " + $uninstall.DisplayVersion + ")")
if ($runtimeProof) {
  Write-Output ("runtime proof     : " + $runtimeProof.Stamp + " · shell " + $runtimeProof.UiVersion)
  Write-Output ("proof attempts    : " + $runtimeProof.Attempts + " (" + $runtimeProof.TransientFailures + " expected transient)")
} else {
  Write-Output "Desktop now holds exactly one installer. Runtime proof was not requested."
}
} finally {
  Exit-CompyProcessMutex $installedBinaryMutex
}
