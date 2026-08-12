<#
  Compy Console - start it, or focus it if it is already running.

  Idempotent on purpose: double-clicking the shortcut twice must not leave two servers fighting
  over the port. It checks the port first and only starts a server if nothing answers, so the
  second double-click just opens the page. (Bug->guard from the launcher's single-flight work:
  every entrypoint on this machine has to survive being clicked twice.)
#>
param([int]$Port = 4517, [switch]$NoBrowser, [switch]$Restart)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$url = "http://127.0.0.1:$Port/"

function Test-Console {
  try { $null = Invoke-WebRequest -Uri "$url" -UseBasicParsing -TimeoutSec 3; return $true } catch { return $false }
}

# bug->guard: "already answering" is NOT the same as "running the current code". The server reads
# index.html from disk per request, so after a `git pull` the PAGE updates while the API routes stay
# on the old build -- which looked exactly like a broken feature (404s on endpoints that visibly
# existed in the source). -Restart kills whatever OWNS THE PORT, which is the only reliable identity
# for "the server"; matching on a command-line string silently found nothing and started a second
# process that lost the bind race.
if ($Restart) {
  $owners = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
  foreach ($procId in $owners) {
    if ($procId) { Write-Host "  stopping pid $procId" -ForegroundColor Yellow; Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 700
}

if (Test-Console) {
  Write-Host "Compy Console is already running." -ForegroundColor Green
} else {
  Write-Host "Starting Compy Console from $repo ..." -ForegroundColor Cyan
  $env:COMPY_CONSOLE_PORT = "$Port"
  Start-Process -FilePath 'node' -ArgumentList 'tools/console/server.mjs' -WorkingDirectory $repo -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Console) { break }
  }
  if (-not (Test-Console)) {
    Write-Host "  The server did not come up. Run this by hand to see why:" -ForegroundColor Red
    Write-Host "    cd $repo; node tools/console/server.mjs" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
  Write-Host "  up at $url" -ForegroundColor Green
}

# Open it as an APPLICATION WINDOW, not a browser tab.
#
# The owner's words on first use: "why [is] it set up like a browser controlled thing when it was
# suppose to be like my own admin console app". Fair. A real desktop app would mean a build step, a
# signing step, an updater and a dependency tree -- the exact "another thing to maintain" this
# console exists to avoid -- so the honest middle is Chrome's `--app=`: no tabs, no address bar, no
# bookmarks, its own taskbar entry. It looks and behaves like an app because for this purpose it is
# one. Same trick /api/open already uses for the provider windows, so this is not a new idea here.
#
# Falls back to the default browser when Chrome and Edge are both absent: a tab beats nothing.
#
# bug->guard: a browser INHERITS the launching shell's working directory and holds it for its whole
# lifetime. Launched bare, `Start-Process $url` handed Firefox a cwd of $repo, which pinned that
# folder open -- `git worktree remove` then failed with ERROR_SHARING_VIOLATION on a directory that
# was already empty, and the only way to free it was killing the user's browser. Any worktree the
# console has ever been opened from becomes undeletable until the browser closes. EVERY launch
# below therefore names a working directory nobody will ever want to remove.
if (-not $NoBrowser) {
  # `${env:ProgramFiles(x86)}` reads as $null on this machine and Join-Path then THROWS under
  # $ErrorActionPreference='Stop' -- which killed the launch outright rather than falling back.
  # GetEnvironmentVariable has no parsing ambiguity, and every root is checked before it is joined.
  $roots = @(
    [Environment]::GetEnvironmentVariable('ProgramFiles'),
    [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),
    [Environment]::GetEnvironmentVariable('LocalAppData')
  ) | Where-Object { $_ }
  $rel = @(
    'Google\Chrome\Application\chrome.exe',
    'Microsoft\Edge\Application\msedge.exe'
  )
  # @() is load-bearing: a foreach that yields ONE string collapses to a scalar, and $x[0] on a
  # string is its first CHARACTER -- which tried to launch a program called "C".
  $appBrowsers = @(foreach ($r in $roots) {
    foreach ($x in $rel) {
      $p = Join-Path $r $x
      if (Test-Path $p) { $p }
    }
  })

  # FOREGROUND COURTESY (owner ask, 2026-08-11). When the OWNER runs this script he is asking to look
  # at the console, so it opens normally and in front. When TOOLING runs it, the same window arrives
  # unannounced over whatever he is actually doing, and on Windows an activating window minimises an
  # exclusive-fullscreen game. `COMPY_NO_ACTIVATE` is the one lever for that across the repo (same
  # variable src-tauri/src/lib.rs reads), and Minimized maps to SW_SHOWMINNOACTIVE: it launches, it
  # lands on the taskbar, it never takes the foreground.
  $browserWindow = if ($env:COMPY_NO_ACTIVATE -and $env:COMPY_NO_ACTIVATE.Trim() -and $env:COMPY_NO_ACTIVATE.Trim() -ne "0") { "Minimized" } else { "Normal" }
  if ($appBrowsers.Count -gt 0) {
    Start-Process -FilePath $appBrowsers[0] -ArgumentList "--app=$url" -WorkingDirectory $env:USERPROFILE -WindowStyle $browserWindow
  } else {
    Start-Process $url -WorkingDirectory $env:USERPROFILE -WindowStyle $browserWindow
  }
}
