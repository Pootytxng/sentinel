# ship-reinstall.ps1 — the post-rebuild ship law, codified.
#
# After `npm run tauri build`, run this so the LIVE running Compy becomes the just-built version, with
# exactly ONE (current) installer on the Desktop. The OWNER NEVER installs manually — he only verifies.
# (Memory: "silent-reinstall-is-my-job"; CLAUDE.md standing rule. Run from anywhere.)
#
# INVOCATION: in the Claude Code Bash->PowerShell shell, `powershell -File <path>` parse-errors
# ("Unexpected token") — a shell quirk, not a script bug. Use the call operator (or run the steps inline):
#   powershell -NoProfile -Command "& 'C:\Users\Kuya\code\sentinel\scripts\ship-reinstall.ps1'"            # install + launch
#   powershell -NoProfile -Command "& 'C:\Users\Kuya\code\sentinel\scripts\ship-reinstall.ps1' -NoLaunch"  # don't launch
#
# ENCODING (bug→guard 2026-07-16): this file MUST start with a UTF-8 BOM. Windows PowerShell 5.1
# (`powershell`) decodes a BOM-less file as ANSI, so the em-dashes in the throw strings become
# mojibake that parse-errors the whole script (caught live at the 0.9.0 ship — an edit had re-saved
# the file without its BOM). pwsh 7 reads UTF-8 either way. Pinned by version-drift-guard.test.mjs
# Guard C — any tool that re-saves this file must preserve the BOM (or run the guard and find out).
param([switch]$NoLaunch, [switch]$AllowDirty)
$ErrorActionPreference = "Stop"

# Version is DERIVED from tauri.conf.json (single source of truth) — never hardcode it here.
# A hardcoded 0.1.0 survived the 0.9.0 bump as a silent drift site; derivation kills the class.
$conf = Get-Content "C:\Users\Kuya\code\sentinel\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$ver = $conf.version
if (-not $ver) { throw "Could not read .version from tauri.conf.json" }
$nsis = "C:\Users\Kuya\code\sentinel\src-tauri\target\release\bundle\nsis\Compy_${ver}_x64-setup.exe"
if (-not (Test-Path $nsis)) { throw "Built NSIS not found — run 'npm run tauri build' first: $nsis" }
$desk = [Environment]::GetFolderPath("Desktop")

# 0) STALE-BUILD GATE (bug→guard, 2026-07-06): a docs/frontend-only commit chain can leave cargo's
#    fingerprint "fresh", so `npm run tauri build` silently re-bundles the PREVIOUS binary — stale
#    stamp AND stale embedded assets (caught live: a rebuild at b52adb3 shipped a 6b2f46f exe).
#    stamp == HEAD ⟺ the crate recompiled ⟺ assets were re-embedded from the current dist/. The
#    packaged exe is checked BEFORE install; on mismatch: `cargo clean -p compy --release` + rebuild.
$releaseExe = "C:\Users\Kuya\code\sentinel\src-tauri\target\release\compy.exe"
$head = (git -C "C:\Users\Kuya\code\sentinel" rev-parse --short HEAD).Trim()
if ((Test-Path $releaseExe) -and $head) {
  if (-not (Select-String -Path $releaseExe -Pattern $head -Quiet)) {
    throw "STALE BUILD: target\release\compy.exe does not embed HEAD ($head) — cargo reused a cached binary. Run: cargo clean -p compy --release --manifest-path src-tauri/Cargo.toml && npm run tauri build"
  }
}

# 0b) DIRTY-STAMP GATE (bug→guard, 2026-07-14): a build cut from a dirty tree stamps "+dirty" and
#     nothing downstream ever mechanically checked it — the PART B installer shipped stamped
#     "2eda4eb+dirty" unnoticed (that one was benign: docs-only untracked files, and build.rs now
#     excludes docs/ from the dirty check). This gate blocks the REAL case: any tracked change or
#     non-docs untracked file at ship time means the stamp can't be trusted to equal HEAD's code.
#     Override deliberately with -AllowDirty (states intent in the transcript).
$treeDirt = git -C "C:\Users\Kuya\code\sentinel" status --porcelain -- ":(exclude)docs"
if ($treeDirt -and -not $AllowDirty) {
  $dirtLines = $treeDirt -join [Environment]::NewLine
  throw "DIRTY-STAMP: the tree has non-docs changes — the build stamp would read '+dirty' (or lie about HEAD). Commit/stash first, rebuild, then ship. Deliberate override: -AllowDirty.`n$dirtLines"
}

# 1) Stop any running Compy so the install can replace the exe (single-instance + file lock). Close
#    GRACEFULLY first (CloseMainWindow → the app's §1 clean-exit path), so an active Gaming Mode session
#    restores cleanly and the next launch doesn't show a spurious "session didn't end cleanly" recovery
#    banner. Force-kill only the stragglers that ignore the close.
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

# 3) Silent install (per-user → no UAC).
$p = Start-Process -FilePath $dest -ArgumentList "/S" -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "Silent install failed: exit $($p.ExitCode)" }

# 4) Launch so the running app IS the new build (unless -NoLaunch).
$exe = Join-Path $env:LOCALAPPDATA "Compy\compy.exe"
if (-not (Test-Path $exe)) { throw "Installed exe not found after install: $exe" }
if (-not $NoLaunch) { Start-Process $exe }

Write-Output "ship-reinstall OK"
Write-Output ("installer SHA-256 : " + $sha)
Write-Output ("live exe          : " + $exe + $(if ($NoLaunch) { " (not launched)" } else { " (launched)" }))
Write-Output "Desktop now holds exactly one installer. VERIFY live==build via the build STAMP, not an exe hash:"
Write-Output "  launch with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>, then invoke('get_build_stamp')."
