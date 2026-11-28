# Owner-run: retires the multi-session hooks (docs/agent-diet-2026-11-28.patch) in the main checkout.
# It only removes files and settings entries. It stops, changing nothing, unless the checkout is on a
# clean main; it undoes itself if the check after applying fails. The push runs the normal gate.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Kuya\code\sentinel'
Set-Location $root
if ((git branch --show-current) -ne 'main') { throw 'Main checkout is not on main; nothing changed.' }
if (git status --porcelain) { throw 'Main checkout has uncommitted changes; nothing changed.' }
git pull --ff-only origin main
if ($LASTEXITCODE) { throw 'Could not update main; nothing changed.' }
$patch = Join-Path $root 'docs\agent-diet-2026-11-28.patch'
git apply --check $patch
if ($LASTEXITCODE) { throw 'Patch no longer applies (already applied?); nothing changed.' }
git apply --index $patch
# Apply-check: retired hooks gone, settings parse, every hook settings still names exists.
$gone = 'session-root-assert','context-size-advisor','project-write-assert','shell-ownership-assert','scope-drift-check','target-ownership','work-control-receipt-guard'
$bad = @($gone | Where-Object { Test-Path ".claude\hooks\$_.mjs" })
$text = Get-Content .claude\settings.json -Raw
$null = $text | ConvertFrom-Json
$bad += @($gone | Where-Object { $text.Contains("/$_.mjs") })
foreach ($m in [regex]::Matches($text, '(?:\$\{?CLAUDE_PROJECT_DIR\}?)/([^"\\]+\.mjs)')) {
  if (-not (Test-Path (Join-Path $root $m.Groups[1].Value))) { $bad += $m.Groups[1].Value }
}
if ($bad.Count) { git apply -R --index $patch; throw "Check failed ($($bad -join ', ')); undone, nothing changed." }
git rm -q docs/agent-diet-2026-11-28.patch scripts/apply-agent-diet.ps1
git commit -q -m 'chore(agents): retire the multi-session hooks (owner applied docs/agent-diet-2026-11-28.patch)'
git push origin main
if ($LASTEXITCODE) { throw 'Committed locally but the push check failed; tell Claude.' }
Write-Host 'Done: multi-session hooks retired. Open a new Claude session to pick it up.'
