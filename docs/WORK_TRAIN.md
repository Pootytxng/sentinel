# WORK_TRAIN.md — Compy's standing work queue

**Authority:** `OWNER_DIRECTIVE_2026-10-23.md` (owner decision). This file is the one queue the scheduled
work sessions pull from. It is execution order only; product direction stays in `PRODUCT_CONSTITUTION.md`
and `product/ROADMAP.md`, build/install truth in `RELEASE_STATE.md`.

**Testers (owner, 2026-10-23):** the owner and one trusted friend. No wider beta. Optimize for the owner's
rig first; anything shipped to the friend goes through the normal updater.

## How a session runs (every scheduled run follows this)

**Bounds.** One session = at most **2 queue items or 60 minutes**, whichever comes first, and at most
one item in flight. Finish or park (note the next step under the item) before stopping. Never start an
item you cannot finish in the time left.

1. **Preflight.** Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\Kuya\code\_train\preflight.ps1`
   and obey its `MODE`:
   - **FULL** (owner idle ≥ 10 min, no game window): everything below, including pushes and real-PC checks.
   - **CODE-ONLY** (owner using the PC or a game is open): code, tests and local commits only. No UI
     driving, no installs, **no pushes** (the pre-push gate launches Compy and steals focus, see FOCUS).
   - **BUSY** (a `train-*` worktree was touched in the last 90 min): another session is mid-item. Read
     only; report and stop.
2. **Catch up first.** If `main` is ahead of GitHub and MODE is FULL, push it before new work. If a
   `train-*` worktree holds unlanded commits, finish that item first.
3. **Pick.** The first unchecked item in **Queue** whose needs are met. Items needing the owner go to
   **Needs owner** instead. If fewer than 5 ready items remain, the session's first item is to refill the
   queue from `product/ROADMAP.md` (next phase's smallest user-visible slices). Never queue process work.
4. **Branch.** Worktree `.claude\worktrees\train-<item>` on `claude/train-<item>` from `origin/main`;
   link deps with `mklink /J node_modules C:\Users\Kuya\code\sentinel\node_modules`.
5. **Do the smallest slice that proves something.** Product code and tests only (directive rule 1).
   Every fixed bug gets a test that fails on the old code (run it against `main` once to prove it).
6. **Prove.** `npx tsc --noEmit`, the touched tests, `cargo check` (+ `cargo test` and
   `cargo clippy --all-targets -- -D warnings` when Rust changed). Real-PC read-back or a screenshot when
   the change touches the machine or the UI and MODE is FULL.
7. **Review.** Rust, rollback, privilege or measurement changes: one independent review agent on the diff
   only, before landing. Two rounds maximum (rule 3); SHOULD-FIX findings become new queue items.
8. **Land.** Merge to `main` (fast-forward or `--no-ff`), tick the item here with the SHA in the same
   commit, push if MODE is FULL. Then remove the worktree: `rmdir <worktree>\node_modules` first (it is a
   link to the shared folder), then `git worktree remove --force`, then delete the branch.
9. **Log and report.** Add one line to **Session log** (date, mode, items, SHAs, pushed yes/no; keep the
   newest 14). End with three lines for the owner: what you can see now / what changed under the hood /
   what I need from you.

**Stop rules.** A gate fails twice on the same cause → write the blocker under the item and move on.
Never change Windows settings outside Compy's own apply/rollback. Never publish a release, sign, touch
credentials, close or edit GitHub issues (the session cannot), or edit `~/.claude/settings.json`.
Windows commands: write PowerShell to a .ps1 and run it with `-File` (inline `$vars` are stripped); use
`git commit -F <file>` for messages with quotes; never run git writes from the remote Linux shell.

## Needs owner
- **P2-exit** (#453): 5 minutes at the PC while Compy shows Health, Test, History and Live; you confirm
  they agree. Can also run in a FULL session with computer use if you leave Compy open and the PC idle.
- **Close fixed issues** #645, #608, #671 on GitHub (sessions cannot write issues).
- **Old scheduled task** "#678 check-in 1/3…" still armed; turn it off in your scheduled tasks list.

## Queue

### Now — finish what's open
- [x] **PR-sweep** Product PRs: review once and land or close #673 (honest unknown FPS), #666
      (data-root tests), #661 (debrief unmeasured), #627 (ledger write announce), #604 (TS coverage).
      Process PRs (#685, #679, #654, #644, #642, #606, #605, #492, #471, #470, #464): close with a
      one-line "parked under OWNER_DIRECTIVE_2026-10-23" comment.
      Progress 2026-10-23: process PRs closed; #673 landed (fix 88bec9ad, sparklines too);
      #666 landed (merge of 68e3c215, data_root 23/23 on main).
      2026-10-24: #661 landed (merge of e1cf6f96; Debrief shows "—" + Not graded for unmeasured FPS,
      jsdom 58/58 + Chromium layout 6/6).
      #627 landed (merge of b48bd156; Check/Fix writes now refresh the Test bench without a
      refocus; 23 files / 266 tests). #604 landed 2026-10-23 evening (8 test files, 96 tests;
      its monitor-v2 cases moved to `monitor-v2-verdict-cases.test.ts` beside the newer file on main).
- [x] **WT-prune** 15 worktree folders removed 2026-10-23 evening; every branch kept, detached heads
      saved as `keep/*` branches, uncommitted edits saved as patches in
      `_archive/compy-sessions/worktree-salvage-2026-10-23/wt-prune-2026-10-23`. The `.codex` one is left alone.

### Next — bugs a real user would hit (from the Sep 29 Trial batch)
- [x] **FOCUS** Cause found 2026-10-24: `foreground-probe.ps1` named its parameter `$Args` (PowerShell's
      automatic variable), so every guard launch dropped `--no-activate` and was a normal, activating
      launch. Compy's quiet launch was never the problem: 0/10 FOREGROUND events once the flag arrives;
      guard still fails on an injected `set_focus()`. `713838e6`.
- [x] **#631** Rollback that ran but couldn't save reads as a failure. Backend `ad7a1221`; screens +
      Benchmark trial wording `48972cd3` (2026-10-24).
- [x] **#616** Roll back an apply whose receipt can't be built or saved (orphan change). Ported from the
      Sep 28 branch onto main 2026-10-23 (`claude/train-616`, head 0b8eb85c): cargo test 1427/0, clippy clean,
      ledger guards 222/222; independent review APPROVE, no blockers.
- [x] **#616-f1** (`ad7a1221`) Batch phase-2 receipt commit failure drops the collected per-item skip reasons (the
      "check this setting in Windows" warnings); add them to the Err text (history.rs ~1398). From the #616 review.
- [x] **#616-f2** (`ad7a1221`) Test a receipt build that fails partway through a list in `commit_receipts` (distinct
      branch from a failed save). From the #616 review.
- [x] **#617** Multi-write applies leave partial state on a mid-apply failure. `1bc030bd` (2026-10-24).
- [x] **#617-f1** (`29e5e67a`) Tests: apply with a present REG_BINARY UserPreferencesMask checks snapshot bytes; F1
      test for game mode and visual effects. From the #617 review (N2).
- [x] **#619 / #621** Ledger writes outside App don't refresh the other screens.
      #619 landed with PR #627 (2026-10-24). #621 `6afaa71b` (2026-10-24).
- [x] **#629** Test → Benchmark claims no baseline while one exists. Fixed 2026-10-23: "Reading…" until
      the read answers, "couldn't read" on failure, no overwrite button meanwhile (guard falsified 2/3 on old code).
- [x] **#628** Trial start note says another change is active after a same-setting rollback. `2275c3e7`.
- [x] **#669 / #668** Active-change and attribution counts collapse to 0 on a failed ledger read.
      `e83017a5` (2026-10-24): unknown stays unknown; sessions.json stays loadable by older builds.
      Needs history.rs (#668: `active_changes_in(rows)` fold; #669 also touches sessions.rs types).
- [x] **#645 / #608 / #671** Unmeasured FPS still shown as a number anywhere. All listed sites fixed on
      main (#656, PR #661, PR #673); a grep finds only gated sites. Issues still open on GitHub: closing them
      needs the owner (the session could not write to issues).
- [x] **#622** Health layout below ~600 px. `3c3e7553` (2026-10-24).
- [x] **#677** Clipped session metadata and combined-effect tooltips. `3c3e7553`.
- [x] **#622-f1** Live session rows stack below 600 px of list width `716e0fbd`.
- [ ] **#622-f2** Health verdict panel scrolls inside itself in narrow windows (#225, needs its own change);
      at exactly 600 px (en) the Live row timeline is ~27 px wide.
- [x] **#638** Phase 2 follow-ons from PR #634. Lands with this log entry (Optimize can't-confirm group, History tile title).
- [ ] **GB-picker** `game-bar-disable` not offered in the Trial picker on the owner rig with both
      values = 1 (seen 2026-10-23 07:46 on a fresh Compy). Reproduce, then fix or close.
- [x] **#686-followup** One `LiveReads` per Trial start instead of one PowerShell spawn per row. `6e7792a8`.

### Then — Roadmap Phase 4: Optimization Engine v1 (`product/OPTIMIZATION_ENGINE.md`)
Planned 2026-10-24 from the spec and the code. Order is dependency order. Phase 4 exit on the owner rig:
a current WARDOGS noise floor is used; every passing candidate is tested or skipped with a reason; an
uneven baseline gives "too noisy", never Slower/Faster; only Better stays applied; the WARDOGS summary
reads honest to the owner. First check: does `sessions.rs` keep per-second fps (needed by P4-baseline-quality)?
- [x] **P4-plan** Slices written below (2026-10-24).
- [x] **P4-noise-store** (`4caee92b`, wording `ad436c84`; stored value = spread within one 25 s
      calibration, not between sessions — P4-noise must decide if that is the right floor) Store a measured noise floor per game + rig (`process_name` + `hw_fingerprint`),
      stale after a driver/Windows/game-build change; fill `measured_noise_pct` in `experiment.rs` from
      `benchmark_trial.rs` calibration. Rust unit tests. TRIAL_PROTOCOL §5, MACHINE_MODEL §4, ENGINE §10.
- [x] **P4-noise** `f1c93f44`: verdict band = max(1% low range across >= 3 unchanged sessions, 3%);
      uneven-halves grading stays on the fixed 3% (owner). An effect inside the band reads No change.
- [ ] **P4-noise-proof** (owner) Play 3 WARDOGS sessions >= 10 min with no Compy change, Trial or Gaming
      Mode change between them; then confirm the receipt shows the measured band. None qualify yet.
- [x] **P4-noise-copy** Lands with the 2026-10-24 evening log entry. "from one session to the next" → "between any two of those sessions" (en); rename
      `grade_baseline`'s `noise_floor_pct` param to `halves_floor_pct`; fix ExperimentBench.tsx:206 comment.
- [x] **453-fix** `dce14e95`: Health, Optimize and History count one per change whose live check reads On;
      can't-confirm grouped the same on all three; shared parity fixture (Rust + TS).
- [ ] **453-rerun** (needs a desk install of main) Re-run the #453 four-screen check; record in BACKLOG P2.
- [ ] **453-f1** `history.rs` `summarize_history` is a fourth counting rule (newest row by position,
      Unreadable counts as active) feeding session receipts / Debrief / Monitor "N Compy changes active".
      Move it onto `live_change_groups`. Also: "Applied on this machine" diagnostics line still counts rows.
- [x] **P4-baseline-quality** `66f1daea`. Owner 2026-10-24: warn, don't block — < 600 readings refuses;
      uneven halves (> 3%) or no trace warn and are recorded on the receipt. Blocking waits for P4-noise.
      Was: grade the baseline before a start: < 600 readings, or halves differing by more
      than the noise floor (the 133→244 fps swing), reads "too uneven" and offers a re-record. Fixture from
      the 2026-10-23 AFK numbers. TRIAL_PROTOCOL §2.
- [x] **P4-sessions** (uneven-session half only, owner approved 2026-10-24; the "effect below
      session-to-session spread" half waits for P4-noise, which supplies that spread) "Too noisy to judge" verdict (Inconclusive, restored) when either session is uneven
      or the effect is below session-to-session spread. Test replays the −18.5% case. Needs P4-baseline-quality.
- [ ] **P4-comparable** Leave idle/menu stretches out of the measurement; a Partial pair shows what differed
      in one line. `comparability.rs` + conclude. TRIAL_PROTOCOL §7, ENGINE §10.
- [ ] **P4-candidates** "Worth testing on this PC": a pure module filters the catalog (applies / already
      set / Compy can do it safely); the picker shows only passing ones, reasons behind a toggle. Covers
      GB-picker. ENGINE §3.1–3.3.
- [ ] **P4-rank** Drop candidates whose likely effect is below measured noise ("too small to measure here");
      order the rest by benefit vs risk and test time; group interactions. Needs P4-noise, P4-candidates. ENGINE §3.4–3.7, §4.
- [ ] **P4-recommended** First outcome, Recommended / Best Overall: Better only if the 1% low improves beyond
      noise and the average doesn't drop; ties keep the default. Needs P4-sessions. ENGINE §2, §6.
- [ ] **P4-maxfps-smooth** Maximum FPS (average + 1% low) and Smoothest frame pacing (frame-time spread,
      0.1% low when samples allow) as user-picked outcomes. Needs P4-recommended. ENGINE §2.
- [ ] **P4-next** After a Trial, propose the next ranked candidate; "Nothing else here is worth testing"
      is a success state. Needs P4-rank. ENGINE §7.
- [ ] **P4-exit** "We tested what mattered on this PC" per-game summary: tested/kept/restored, skipped +
      why, noise floor used, context, what stays applied; confidence vocabulary, no fake percentages.
      Owner-rig proof with WARDOGS. ENGINE §8–9, ROADMAP Phase 4 exit.

### Before deadlines
- [x] **fflate** 0.6.11 `53a1c9de`; dev-only body-parser/zod advisories cleared (shadcn 4.22.1) `89fc1add`.
- [ ] **tokio** `cargo update -p tokio` 1.52.3 → 1.54.1 with `cargo test` and a desk install.

### Every Friday 4:34 PM (separate scheduled task)
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime` (FULL mode only), update
  `RELEASE_STATE.md` in the same commit, report what is visible, and summarise the week from the Session log.

## Session log
- 2026-10-23 eve (interactive, CODE-ONLY late): PR #604 `86f6a697`, worktree prune, #629 `fef8dc7a`,
  lease check retired `dad641d1`, #616 `d398a9ed`; pushed: #604 only (owner on PC).

- 2026-10-24 early (interactive, CODE-ONLY, parallel lanes): #621 `6afaa71b`, #628 `2275c3e7`, #631
  `ad7a1221` + `48972cd3`, #622/#677 `3c3e7553`, #617 `1bc030bd`; not pushed (owner on PC).
- 2026-10-24 morning: pushed `abe0edd7`; FOCUS `713838e6`, fflate `53a1c9de`, audit `89fc1add`,
  #668/#669 `e83017a5`.
- 2026-10-24 late morning: #686-followup `6e7792a8`, P4-noise-store `4caee92b` + `ad436c84`.
- 2026-10-24 midday: guard re-anchor `18622365` (pushed), #617-f1 `29e5e67a`, #638.
- 2026-10-24 afternoon: #622-f1 `716e0fbd`, P4-baseline-quality `66f1daea` (owner: warn, don't block).
- 2026-10-24 afternoon: P4-sessions (too-noisy on uneven sessions).
- 2026-10-24 12:24 #453 live run on owner rig: Health 13 vs Optimize/History 14 (row-count +
  rig-stamp bug, see 453-fix); diagnostics agreed; startup toggle visible + rolled back everywhere;
  CPU temp unknown with reason. P4-noise `f1c93f44`.
- 2026-10-24 afternoon: 453-fix `dce14e95`.
- 2026-10-24 evening (scheduled, CODE-ONLY, owner in WARDOGS): P4-noise-copy (this entry's commit);
  tsc 0, ExperimentBench 54/54, cargo experiment 105/0, clippy clean; not pushed.

## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
