# doc-budget.ps1 - line budgets for hot docs (owner token-efficiency decree 2026-07-22)
# FAIL = MOVE history/log sections to docs/archive/ (append at top, leave a pointer), never delete. Re-run after.
# Release-critical: verify-release.ps1 runs this as a gate, so it fails closed like the rest of the
# surface. Nothing here invokes a native program; the budget check is pure cmdlets.
$ErrorActionPreference = "Stop"
$budgets = @{
  "docs/RELEASE_STATE.md" = 300
  "docs/BACKLOG.md" = 1400
  "docs/OWNER_ACTION_CHECKLIST.md" = 450
  "docs/BETA_DISTRIBUTION_RECORD.md" = 250
  "docs/BRANCH_DISPOSITIONS.md" = 120
  "docs/RELEASE_AUTONOMY.md" = 120
  "docs/RELEASE_TRANSACTION.md" = 120
  "docs/SESSION_HANDOFF.md" = 120
  # Tightened 400 -> 380 on 2026-08-04, when the module map's read-only half moved to
  # src-tauri/CLAUDE.md. Without the tightening the root just refills to 400 and the split bought
  # nothing; the banked headroom is what keeps the always-loaded doc smaller.
  "CLAUDE.md" = 380
  # The half that only loads for Rust work. Budgeted so it cannot become the new dumping ground.
  "src-tauri/CLAUDE.md" = 120
}
$root = Split-Path $PSScriptRoot -Parent
$fail = 0
foreach ($f in ($budgets.Keys | Sort-Object)) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { Write-Host "SKIP  $f (missing)"; continue }
  $n = (Get-Content $p).Count
  $b = $budgets[$f]
  if ($n -le $b) { Write-Host "PASS  $f  $n/$b" }
  else { Write-Host "FAIL  $f  $n/$b  -> archive history/log sections to docs/archive/, never delete"; $fail = 1 }
}
if ($fail) { exit 1 } else { Write-Host "doc-budget: ALL PASS" }
