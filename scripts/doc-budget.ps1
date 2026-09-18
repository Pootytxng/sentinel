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
  # 2026-09-04 (#369): BACKLOG.md was rebuilt as a 130-line / 5.4KB execution ledger by the
  # constitutional migration; the ratchets follow it down (the slack rule in doc-budget-guard.test.mjs
  # allows at most 8KB of byte headroom).
  "docs/BACKLOG.md" = 300
  "docs/OWNER_ACTION_CHECKLIST.md" = 385
  "docs/BETA_DISTRIBUTION_RECORD.md" = 250
  # 119 -> 107 on 2026-08-31. It said "two rows of room, then it pays again"; both rows went to
  # #271 and #274, the file hit the cap exactly, and it paid: the 2026-08-21 sweep narrative (three
  # refs pruned that day, nothing live left in it bar two facts kept behind) moved to
  # archive/BRANCH_DISPOSITION_SWEEPS.md, taking 119 -> 105 with the new row already in. Same
  # append-by-design reasoning as before, so the ratchet again leaves exactly two rows of headroom
  # rather than banking all 14 - a zero-headroom budget fails the next lane for existing.
  # Prior step: 120 -> 119 on 2026-08-26, when the retired detached checkout's disposition took it
  # to 123 and two FINISHED narratives (#160 landed and pruned, #193 landed) were archived for it.
  # 2026-09-01: the cap did NOT move for #309's row, and the payment did not come from a row. The
  # audit had just proven every one of the 30 refs live, so nothing was retirable -- it came from
  # the pinned counts in the prose above the table, which had gone stale twice that day by the
  # hand of the lane adding the row. `refSplit` in branch-disposition-audit.mjs prints the live
  # split on OK instead. That is the §6 move: the rule that keeps getting broken gets a mechanism,
  # not another paragraph -- and it freed 3 lines, which at that tip left 105/107 and the two rows
  # of headroom the ratchet below was set to preserve.
  # 2026-09-02, corrected in place rather than left to read as current: that headroom is GONE. This
  # lane merged `main`, which had independently added two rows of its own, so the file lands at
  # exactly 107/107 -- passing, with nothing spare. The next row here does NOT have a free line to
  # take and must be paid from `archive/BRANCH_DISPOSITION_SWEEPS.md` before it is written. The cap
  # does not move for it; that is the whole point of the ratchet.
  # 82 -> 79 on 2026-09-15, pre-emptive at 82/82 and with the row table long gone (#291): the #65 origin
  # and the four incident narratives behind the live rules moved verbatim to
  # archive/BRANCH_DISPOSITION_SWEEPS.md (82 -> 77); two lines of headroom kept.
  "docs/BRANCH_DISPOSITIONS.md" = 79
  "docs/RELEASE_AUTONOMY.md" = 120
  "docs/RELEASE_TRANSACTION.md" = 120
  # 120 -> 116 on 2026-09-15, pre-emptive at 119/120: the Shipped / Self-review / Harvest rows, the DIR-1a
  # walk record and the three reachability cases moved verbatim to archive/SESSION_HANDOFF_HISTORY.md
  # (119 -> 114); two lines of headroom kept, per the ratchet rule above.
  "docs/SESSION_HANDOFF.md" = 116
  # Tightened 400 -> 380 on 2026-08-04, when the module map's read-only half moved to
  # src-tauri/CLAUDE.md. Without the tightening the root just refills to 400 and the split bought
  # nothing; the banked headroom is what keeps the always-loaded doc smaller.
  # 380 -> 199 on 2026-09-18 (#479): the ★ module-map entries, LOCKED 6's full text and the dev-machine
  # note moved to path-scoped .claude/rules/*.md (260 -> 197 lines). 199 = Anthropic's published
  # "under ~200 lines" line, with 2 lines of headroom; the next addition pays with a deletion.
  "CLAUDE.md" = 199
  # The half that only loads for Rust work. Budgeted so it cannot become the new dumping ground.
  "src-tauri/CLAUDE.md" = 120
  # Path-scoped rules (#479). They load only when matching files are touched, but then load WHOLE, so
  # each gets a ceiling at its moved size + a few lines - a rule file must not become the new root.
  ".claude/rules/rust-safety-boundary.md" = 40
  ".claude/rules/tweak-catalog.md" = 36
  ".claude/rules/dev-machine.md" = 16
}
# BYTE budgets, added 2026-08-18. The line budgets above are structurally blind to the thing the
# token law exists to control: docs/BACKLOG.md passed 1286/1400 LINES while weighing 142 KB, because
# a line budget cannot see a 113-byte average line, and docs/RELEASE_STATE.md passed 252/300 lines at
# 222 bytes per line. Tokens are charged by bytes. Both budgets now apply; a doc must clear both.
#
# The numbers are derived, not chosen:
#   48 KB = MAX_UNBOUNDED_BYTES, the unbounded-Read budget the now-removed .claude/hooks/big-read-guard.mjs
#           once enforced (purged as an owner-ordered hook cleanup; the number is kept here as the
#           still-valid "unreadable in one big gulp" line, it just isn't hook-enforced anymore).
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
#   docs/BACKLOG.md         79KB            (84KB -> 79KB on 2026-08-29 when the C-13(b) keyboard-contract
#                                           record moved to BACKLOG_ARCHIVE.md and the six earlier collapses
#                                           had left slack.) RATCHETED DOWN FIVE TIMES BEFORE THAT:
#                                           142KB -> 122KB on 2026-08-18 when the
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
  "docs/BACKLOG.md" = 12288
  "docs/RELEASE_STATE.md" = 43008
  "docs/OWNER_ACTION_CHECKLIST.md" = 32256
  # 10240 -> 7680 on 2026-09-07 (#396). The map's three Compy Care entries -- case_intelligence,
  # case_evidence_upload and incident_observer -- had grown to 4,650 bytes, 47% of a 55-line file,
  # and two of the three describe DARK modules whose gates are hard-false. That is long-form
  # CONTRACT prose, not the one-line "what is this module, and is it a mutation boundary" the map
  # exists to answer, and every src-tauri/ session was paying for it. It moved to
  # docs/CARE_TIER_MODULE_CONTRACTS.md (nothing deleted; the #259 redactor residuals, the Tier 1
  # trust-root separation, the contract §4 never-imports list and the arming notes all carried
  # over), leaving a compact line plus a pointer each: 9,895 -> 6,903 bytes.
  #
  # The ratchet is what makes the move worth doing -- without it the file just refills to 10KB and
  # the archive move bought nothing. 7,680 leaves 777 bytes, and that allowance is SIZED, not
  # guessed: PR #387's pending machine_model.rs entry is 281 of it (measured at that branch's head,
  # where this file sits at 10,176/10,240 -- 64 bytes spare, which is what triggered this pass).
  # The remaining ~496 is one ordinary entry's worth. Lower this again once #387 lands and the
  # real post-merge size is known.
  "src-tauri/CLAUDE.md" = 7680
  # #479: the ★ entries' moved size (4,159 bytes at the move) + one ordinary entry.
  ".claude/rules/rust-safety-boundary.md" = 4608
  ".claude/rules/tweak-catalog.md" = 2048
  ".claude/rules/dev-machine.md" = 768
}
# CLAUDE.md is deliberately NOT in the table above. Its byte ceiling already exists and predates
# this one: src/claude-md-laws-guard.test.ts, "is under <MAX_BYTES> bytes (re-bloat guard)". Restating it
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
  # 12288 -> 11776, later the same day (2026-08-26). NEXT UP failed again at 12.2KB when the
  # first-timer walk's two dead-code findings were filed. Paid from the archive as the law
  # requires, never from the cap: #213's A1 block, the taste-vs-defect process amendment and the
  # whole B1-B5 half moved out VERBATIM (4130 bytes) behind two collapsed pointers - all three
  # were closed records, and their guards live in the tree, which is the only reason they were
  # safe to move. 12.2KB -> 10.2KB. The ratchet banks 512 of the ~2KB freed and leaves ~1.5KB of
  # deliberate room, for the same reason as the ratchet before it: this queue is where a NEW
  # owner bug report lands, and a zero-headroom cap would fail the session that answers him.
  #
  # 12544 -> 12288 earlier on 2026-08-26. NEXT UP FAILED at 13320 when the #213 A1 and #219
  # rulings were recorded, and the payment came from the archive: five archive-POINTER blocks
  # plus the A2/A3 not-a-defect finding moved out verbatim, leaving one consolidated pointer.
  # 13320 -> 11775, banking 256 of the 1545 bytes freed.
  # 2026-09-04 (#369): the constitutional migration rebuilt BACKLOG.md as an execution ledger; the
  # NEXT UP / Conformance queue / HQ STEERING LOG sections no longer exist, so their caps are re-pointed
  # at the ledger sections that replaced them (measured 1577 / 683 / 284 bytes at re-pointing).
  "docs/BACKLOG.md::Constitutional migration" = 2048
  # 24064 -> 23808 on 2026-08-29, banking 256 of the 584 bytes the Q9b Stage 1 repair (#259)
  # freed. The queue FAILED at 23.8KB when the repair's record was filed, and the payment came
  # from the archive as the law requires: Q9a's CLOSED visual-self-review record moved to
  # docs/BACKLOG_ARCHIVE.md verbatim behind a pointer, 23.8KB -> 22.9KB. Freeing room inside a
  # CAPPED section does not pay for itself, though - it raises what the caps still permit, so
  # the file budget stops covering the arithmetic and doc-budget-guard.test.mjs fails instead
  # (81039 vs 80896). Banking the freed room here is the half of the move that closes it; the
  # remaining 328 bytes are deliberate, because this queue is where the next conformance
  # finding lands and a zero-headroom cap would fail the session that files it.
  #
  # HELD at 23808 on 2026-08-31, deliberately NOT ratcheted, while landing the Q9b Stage 3 record
  # (#287). The queue FAILED at 24214 and was paid from the archive as always - Q9b Stage 1's
  # invisible-character failure and its reviewed repair, plus Q9a's settled ships-by-default
  # reasoning, moved to docs/BACKLOG_ARCHIVE.md verbatim behind two pointers, and the Stage 3
  # record itself was written tighter. 24214 -> 23519. Nothing was banked because only 289 of the
  # 695 bytes freed are new room: the other 406 paid the overflow. Ratcheting to 23552 would leave
  # 33 bytes, which is the zero-headroom failure the paragraph above already ruled against. The
  # one closed row this queue had was archived long ago, so the NEXT payment has no closed row to
  # move - it will have to come from open-row narrative that has gone historical, the way this one
  # did. Note that too, rather than reaching for the cap.
  # The 24064 -> 23808 history above belongs to the retired Conformance queue this cap was re-pointed
  # away from in #369. 2026-09-05: re-pointed again, to the P1 heading the post-constitution
  # re-derivation renamed it to. The cap was NOT raised - the first draft of that re-derivation
  # measured 2217 bytes and was cut to 971 to fit, which is what "keep the blocker list short" means
  # in bytes. Same rule from here: pay an overflow out of the prose, never out of the number.
  "docs/BACKLOG.md::Roadmap Phase 1 blockers" = 1024
  "docs/BACKLOG.md::Owner-gated / external decisions" = 512
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
