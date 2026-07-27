# repo-hygiene.ps1 - standing maintenance checks (2026-07-22). Report-only WARNs; doc-budget exit governs.
$root = Split-Path $PSScriptRoot -Parent
Write-Host "== doc-budget:"
& powershell -NoProfile -File (Join-Path $PSScriptRoot "doc-budget.ps1")
$bud = $LASTEXITCODE
Write-Host "== markdown links:"
& node (Join-Path $PSScriptRoot "markdown-link-guard.mjs")
$links = $LASTEXITCODE
if ($links -ne 0) { exit $links }
Write-Host "== stale Claude Code CLI processes (>24h, exact standalone CLI executable path only):"
$now = Get-Date
$claudeCommand = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $claudeCommand) {
  Write-Host "  SKIP standalone Claude CLI not resolved by Get-Command"
} else {
  $claudePath = [System.IO.Path]::GetFullPath($claudeCommand.Source)
  $cliProcesses = @()
  Get-Process claude -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_; $processPath = $null; try { $processPath = $p.Path } catch {}
    if (-not $processPath) { Write-Host "  SKIP pid $($p.Id) (no path visible - leave alone)"; return }
    $normalizedProcessPath = [System.IO.Path]::GetFullPath($processPath)
    if (-not [string]::Equals($normalizedProcessPath, $claudePath, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Host "  SKIP pid $($p.Id) (not standalone Claude CLI)"
      return
    }
    $cliProcesses += $p
  }
  $newestCli = $cliProcesses | Sort-Object StartTime -Descending | Select-Object -First 1
  $cliProcesses | ForEach-Object {
    if ($_.Id -eq $newestCli.Id) { Write-Host "  SKIP newest CLI pid $($_.Id) (leave active session alone)"; return }
    if (($now - $_.StartTime).TotalHours -gt 24) { Write-Host "  WARN stale CLI pid $($_.Id) started $($_.StartTime) path $($_.Path) -> confirm it is not an active session, then kill in a sweep" }
  }
}
Write-Host "== untracked under docs/ older than 7 days:"
git -C $root ls-files --others --exclude-standard -- docs | ForEach-Object {
  $f = Join-Path $root $_
  if ((Test-Path $f) -and ((Get-Item $f).LastWriteTime -lt (Get-Date).AddDays(-7))) { Write-Host "  WARN untracked: $_ -> commit it or gitignore it" }
}
Write-Host "== working-tree modifications older than 24h:"
git -C $root diff --name-only | ForEach-Object {
  $f = Join-Path $root $_
  if ((Test-Path $f) -and ((Get-Item $f).LastWriteTime -lt (Get-Date).AddHours(-24))) { Write-Host "  WARN dirty >24h: $_ -> commit or revert" }
}
Write-Host "repo-hygiene: done"
exit $bud
