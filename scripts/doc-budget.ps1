# doc-budget.ps1 - line budgets for hot docs (owner token-efficiency decree 2026-07-22)
# FAIL = MOVE history/log sections to docs/archive/ (append at top, leave a pointer), never delete. Re-run after.
# Release-critical: verify-release.ps1 runs this as a gate, so it fails closed like the rest of the
# surface. Nothing here invokes a native program; the budget check is pure cmdlets.
$ErrorActionPreference = "Stop"
$budgets = @{
  # 300 -> 270 on 2026-08-22: the "Required owner decisions (live)" section was 98 lines of which
  # ~57 were already CLOSED/ANSWERED/DONE - a closed decision under a heading that says (live) is
  # drift by definition. They moved to archive/RELEASE_STATE_HISTORY.md. Banking the headroom is
  # the point: without the tightening the section just refills and the archive move bought nothing.
  "docs/RELEASE_STATE.md" = 270
  "docs/BACKLOG.md" = 1000
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
#   docs/BACKLOG.md         84KB            RATCHETED DOWN FIVE TIMES: 142KB -> 122KB on 2026-08-18 when the
#                                           2026-07-27a ... 2026-08-04a steering-log cycles moved to
#                                           docs/archive/, then 122KB -> 114KB when 2026-08-04b ...
#                                           2026-08-04g followed them, then 106KB -> 100KB on 2026-08-22
#                                           when five shipped conformance rows (C-04, Arial buttons,
#                                           .arc-v2, the kernel celebration, the ledger-honesty class)
#                                           moved to docs/BACKLOG_ARCHIVE.md, and 114KB -> 106KB on 2026-08-20
#                                           when A4's 42 shipped entries moved to
#                                           docs/archive/BACKLOG_A4_SHIPPED_2026-08-20.md, and 100KB -> 84KB
#                                           on 2026-08-25 when PHASE A's 60 shipped rows moved to
#                                           docs/archive/BACKLOG_PHASE_A_SHIPPED_2026-08-25.md. That last
#                                           move was FORCED: four new Tier 1 rows (#220) overran the 100KB
#                                           ceiling by 1.2KB, and the law's answer to a FAIL is archive,
#                                           not a higher number. The LINE budget followed 1200 -> 1000 in
#                                           the same pass; a budget kept above the file it measures is not
#                                           a budget. It is UNDER its 120KB derived target, so the ratchet
#                                           is the live ceiling and the target no longer buys any room.
#   docs/RELEASE_STATE.md   42KB            RATCHETED 57KB -> 48KB (2026-08-18, desk-build lineage back
#                                           to 0.9.18 archived) -> 42KB (2026-08-22). The 2026-08-18
#                                           diet lasted four days, because hauling old prose out by
#                                           hand treats the symptom: the two build-identity rows are
#                                           APPEND-ONLY, so they refill on every ship. This ratchet is
#                                           DERIVED, not guessed - verify-release-state.mjs check (5b)
#                                           now caps each of those two rows (LINEAGE_ROW_CAPS), and the
#                                           budget is the real 40.3KB plus exactly the growth those caps
#                                           still permit. Do not raise it to buy room for a ship; a
#                                           ship that needs room needs an archive move, which is what
#                                           check (5b)'s failure text tells whoever hits it.
# (CLAUDE.md is handled by its own older guard - see the note under the table.)
$byteBudgets = @{
  "docs/BACKLOG.md" = 86016
  "docs/RELEASE_STATE.md" = 43008
  "docs/OWNER_ACTION_CHECKLIST.md" = 33792
  "src-tauri/CLAUDE.md" = 10240
}
# CLAUDE.md is deliberately NOT in the table above. Its byte ceiling already exists and predates
# this one: src/claude-md-laws-guard.test.ts, "is under 25000 bytes (re-bloat guard)". Restating it
# here would be a second source of truth for the same number - the exact drift bomb this repo
# already disarmed for MAX_CONTINUES. One ceiling, one owner; that guard keeps it.

# SECTION byte budgets, added 2026-08-22 - the row-cap pattern from verify-release-state.mjs check
# (5b), applied to the other ledger that refills.
#
# The caught defect: docs/BACKLOG.md sat at 99KB of a 100KB ceiling four days after a 106KB -> 100KB
# archive pass, for the same structural reason RELEASE_STATE.md refilled - its three working queues
# are APPEND-ONLY, so every train adds a row and no rule takes one out. The FILE budget above sees
# the total but cannot say WHICH queue grew, so whoever hits it goes hunting. A per-section cap fails
# earlier and names the section. The HQ STEERING LOG even had a retention rule already - "keeps only
# the newest ~12 cycles", written in prose in the doc, enforced by nothing. That is the tier this
# repo demotes: a rule that gets broken becomes a guard, not another paragraph.
#
# Key is "<path>::<substring of the heading line>", and it must match exactly ONE heading or this
# fails - a section renamed away is a MISSING cap, never a silent pass. ASCII-only on purpose: these
# headings carry emoji and a date that moves on every re-rank.
#
# The numbers are DERIVED - each is the section's size the day the caps landed plus one typical row
# (~1KB) of room, so a train may add one entry and the next has to archive a closed row first. They
# may only ever move DOWN, same law as the tables above. The file budget above is then the real
# 96.4KB plus exactly the 3348 bytes these caps still permit, which is why it moved 102400 -> 100352
# in the same commit; doc-budget-guard.test.mjs pins that arithmetic so neither can move alone.
#
# Measured LF-normalized (the section's lines joined with LF), NOT as the bytes sit on disk: this
# repo checks out CRLF on Windows and LF elsewhere, so an on-disk measure would give two different
# answers for one unchanged file. Get-Content already drops the line endings, so the PowerShell and
# the JS mirror agree by construction.
#
# Both reads pin -Encoding utf8 on purpose. Windows PowerShell 5.1 defaults to the ANSI code page,
# so every em dash and emoji in these docs decodes as 2-3 separate chars and re-encodes ~300 bytes
# heavier - NEXT UP reads 12.5KB under powershell.exe and 12.2KB under pwsh, from one unchanged
# file. A phantom overflow here tells the next session to archive live rows, so the host must not
# be able to move the number. Run it with either; scripts/doc-budget-guard.test.mjs pins this.
$sectionByteBudgets = @{
  "docs/BACKLOG.md::NEXT UP" = 12544
  "docs/BACKLOG.md::Conformance queue" = 28160
  "docs/BACKLOG.md::HQ STEERING LOG" = 4608
}

$root = Split-Path $PSScriptRoot -Parent
$fail = 0
foreach ($f in ($budgets.Keys | Sort-Object)) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { Write-Host "SKIP  $f (missing)"; continue }
  $n = (Get-Content $p -Encoding utf8).Count
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

foreach ($k in ($sectionByteBudgets.Keys | Sort-Object)) {
  $parts = $k -split "::", 2
  $rel = $parts[0]; $needle = $parts[1]
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { Write-Host "SKIP  $k (missing)"; continue }
  $lines = @(Get-Content $p -Encoding utf8)
  $starts = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^#{1,6}\s' -and $lines[$i].Contains($needle)) { $starts += $i }
  }
  if ($starts.Count -ne 1) {
    Write-Host "FAIL  $k  -> matched $($starts.Count) headings, expected exactly 1; the section was renamed or split, so re-point the cap"
    $fail = 1; continue
  }
  $s = $starts[0]
  $level = ([regex]::Match($lines[$s], '^#{1,6}')).Value.Length
  $e = $lines.Count
  for ($i = $s + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^#{1,$level}\s") { $e = $i; break }
  }
  $text = (($lines[$s..($e - 1)]) -join "`n") + "`n"
  $n = [System.Text.Encoding]::UTF8.GetByteCount($text)
  $b = $sectionByteBudgets[$k]
  $nk = [math]::Round($n / 1KB, 1); $bk = [math]::Round($b / 1KB, 1)
  if ($n -le $b) { Write-Host "PASS  $k  ${nk}KB/${bk}KB" }
  else {
    Write-Host "FAIL  $k  ${nk}KB/${bk}KB  -> this queue is append-only and has refilled. Move its OLDEST CLOSED row byte-for-byte to docs/BACKLOG_ARCHIVE.md, leave the one collapsed pointer, then re-run. Never raise the cap."
    $fail = 1
  }
}

if ($fail) { exit 1 } else { Write-Host "doc-budget: ALL PASS" }
