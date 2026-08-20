# doc-budget.ps1 - line budgets for hot docs (owner token-efficiency decree 2026-07-22)
# FAIL = MOVE history/log sections to docs/archive/ (append at top, leave a pointer), never delete. Re-run after.
# Release-critical: verify-release.ps1 runs this as a gate, so it fails closed like the rest of the
# surface. Nothing here invokes a native program; the budget check is pure cmdlets.
$ErrorActionPreference = "Stop"
$budgets = @{
  "docs/RELEASE_STATE.md" = 300
  "docs/BACKLOG.md" = 1200
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
# BYTE budgets, added 2026-08-18. The line budgets above are structurally blind to the thing the
# token law exists to control: docs/BACKLOG.md passed 1286/1400 LINES while weighing 142 KB, because
# a line budget cannot see a 113-byte average line, and docs/RELEASE_STATE.md passed 252/300 lines at
# 222 bytes per line. Tokens are charged by bytes. Both budgets now apply; a doc must clear both.
#
# The numbers are derived, not chosen:
#   48 KB = MAX_UNBOUNDED_BYTES in .claude/hooks/big-read-guard.mjs. Past it, this repo's own guard
#           already refuses to read the file whole - so a doc over it has become unreadable by its
#           own rules.
#   120 KB = the boot-tax line scripts/usage-audit.mjs has flagged since 2026-07-13. BACKLOG is read
#           by section by law, so it keeps the wider line.
#   20 KB = Anthropic's published "keep CLAUDE.md under ~200 lines" (code.claude.com/docs/en/costs)
#           at this repo's ~110 bytes/line. CLAUDE.md is auto-loaded on EVERY session boot, so it is
#           the most expensive file in the repo per byte.
# The two big ledgers sit at a RATCHET rather than at their derived target - the size they were on
# 2026-08-18 - so any further growth fails immediately, rather than at the target, because shipping
# a red gate is worse than shipping a working ratchet, and because bringing them down is a CONTENT
# decision owned by whoever writes them, not a mechanical trim (bytes are content; re-wrapping a
# long line does not remove any). The budget may only ever move DOWN. Lower each as its pass lands:
#   docs/BACKLOG.md        114KB            RATCHETED DOWN TWICE on 2026-08-18: 142KB -> 122KB when the
#                                           2026-07-27a ... 2026-08-04a steering-log cycles moved to
#                                           docs/archive/, then 122KB -> 114KB when 2026-08-04b ...
#                                           2026-08-04g followed them. It is now UNDER its 120KB
#                                           derived target, so the ratchet is the live ceiling and
#                                           the target no longer buys any room.
#   docs/RELEASE_STATE.md   48KB            AT TARGET 2026-08-18 (was 57KB): the desk-build lineage
#                                           back to 0.9.18 moved to RELEASE_STATE_HISTORY.md. The
#                                           budget follows the file down the same day it shrinks -
#                                           a budget padded to buy room in advance is the thing the
#                                           slack guard in doc-budget-guard.test.mjs exists to catch.
# (CLAUDE.md is handled by its own older guard - see the note under the table.)
$byteBudgets = @{
  "docs/BACKLOG.md" = 116736
  "docs/RELEASE_STATE.md" = 49152
  "docs/OWNER_ACTION_CHECKLIST.md" = 33792
  "src-tauri/CLAUDE.md" = 10240
}
# CLAUDE.md is deliberately NOT in the table above. Its byte ceiling already exists and predates
# this one: src/claude-md-laws-guard.test.ts, "is under 25000 bytes (re-bloat guard)". Restating it
# here would be a second source of truth for the same number - the exact drift bomb this repo
# already disarmed for MAX_CONTINUES. One ceiling, one owner; that guard keeps it.
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
foreach ($f in ($byteBudgets.Keys | Sort-Object)) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { Write-Host "SKIP  $f bytes (missing)"; continue }
  $n = (Get-Item $p).Length
  $b = $byteBudgets[$f]
  $nk = [math]::Round($n / 1KB, 1); $bk = [math]::Round($b / 1KB, 0)
  if ($n -le $b) { Write-Host "PASS  $f  ${nk}KB/${bk}KB" }
  else { Write-Host "FAIL  $f  ${nk}KB/${bk}KB  -> over the BYTE budget; archive prose, never delete"; $fail = 1 }
}
if ($fail) { exit 1 } else { Write-Host "doc-budget: ALL PASS" }
