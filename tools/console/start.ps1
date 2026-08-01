<#
  Compy Console - start it, or focus it if it is already running.

  Idempotent on purpose: double-clicking the shortcut twice must not leave two servers fighting
  over the port. It checks the port first and only starts a server if nothing answers, so the
  second double-click just opens the page. (Bug->guard from the launcher's single-flight work:
  every entrypoint on this machine has to survive being clicked twice.)
#>
param([int]$Port = 4517, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$url = "http://127.0.0.1:$Port/"

function Test-Console {
  try { $null = Invoke-WebRequest -Uri "$url" -UseBasicParsing -TimeoutSec 3; return $true } catch { return $false }
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

if (-not $NoBrowser) { Start-Process $url }
