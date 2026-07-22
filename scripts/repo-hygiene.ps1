# repo-hygiene.ps1 - standing maintenance checks (2026-07-22). Report-only WARNs; doc-budget exit governs.
$root = Split-Path $PSScriptRoot -Parent
Write-Host "== doc-budget:"
& powershell -NoProfile -File (Join-Path $PSScriptRoot "doc-budget.ps1")
$bud = $LASTEXITCODE
Write-Host "== stale Claude Code CLI processes (>24h, identified by PATH; AnthropicClaude desktop app NEVER touched):"
$now = Get-Date
Get-Process claude -ErrorAction SilentlyContinue | ForEach-Object {
  $p = $_; $path = $null; try { $path = $p.Path } catch {}
  if (-not $path) { Write-Host "  SKIP pid $($p.Id) (no path visible - leave alone)"; return }
  if ($path -like "*\AppData\Local\AnthropicClaude\*") { return }
  if (($now - $p.StartTime).TotalHours -gt 24) { Write-Host "  WARN stale CLI pid $($p.Id) started $($p.StartTime) path $path -> confirm it is not an active session, then kill in a sweep" }
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
