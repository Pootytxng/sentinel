# dev-relaunch.ps1 — the build-refresh discipline, codified.
#
# Stops any running Compy (installed OR dev) so the single-instance lock is free, frees the Vite dev
# port, then starts a fresh `npm run tauri dev`. Run from the repo root, in the BACKGROUND so it
# persists across turns. Mirrors the standing dev-build law (see CLAUDE.md / the memory
# "live-dev-build-standing-workflow").
#
# GOTCHA this exists to prevent: killing compy.exe alone leaves the Vite child still holding port
# 1420, so the next `tauri dev` dies with "Port 1420 is already in use." Always free the port too.
#
# GOTCHA #2 (cosmetic): the NEXT run of this script force-kills the prior build's compy.exe, which
# makes that prior `tauri dev`'s cargo print "process didn't exit successfully ... (exit code:
# 0xffffffff)". That's the kill, NOT a startup crash — the build started by THIS run is what's live.
#
# Usage:
#   powershell -File scripts/dev-relaunch.ps1              # clean + relaunch (run in background)
#   powershell -File scripts/dev-relaunch.ps1 -CleanOnly   # just stop everything, don't relaunch
param([switch]$CleanOnly)

$ErrorActionPreference = "SilentlyContinue"

# 1) Stop every Compy instance (the single-instance lock owner could be the installed app OR a dev build).
# Per-call -ErrorAction (not just $ErrorActionPreference) — CIM/Get-Process errors when nothing matches
# aren't reliably suppressed by the preference var, and "nothing matches" is the success case here.
Get-Process compy -ErrorAction SilentlyContinue | Stop-Process -Force

# 2) Free the Vite port (the child that survives a compy.exe kill).
$owners = (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($owners) { $owners | ForEach-Object { Stop-Process -Id $_ -Force } }

Start-Sleep -Milliseconds 700

$compy = (Get-Process compy -ErrorAction SilentlyContinue | Measure-Object).Count
$port = (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Output "clean: compy=$compy port1420=$port"
if ($compy -ne 0 -or $port -ne 0) { Write-Output "WARNING: not fully clean — a relaunch may fail." }

if ($CleanOnly) { return }

# 3) Fresh dev build. Verify the binary is current after it boots (the law: don't trust, confirm).
npm run tauri dev
