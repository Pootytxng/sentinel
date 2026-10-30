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
credentials, or edit `~/.claude/settings.json`. **Closing issues is Claude's job, not the owner's** (owner,
2026-10-28): once a fix is on `main` and pushed, close its issue with a comment naming the fix commit. A
session with no GitHub issue access (the scheduled desk sessions) lists the issue under Needs owner's
next interactive session instead, and that session closes it.
Windows commands: write PowerShell to a .ps1 and run it with `-File` (inline `$vars` are stripped); use
`git commit -F <file>` for messages with quotes; never run git writes from the remote Linux shell.

**Owner's PC: admin prompts off (owner decision 2026-10-29).** The owner is the only user and wants
Windows admin (UAC) prompts off indefinitely: `ConsentPromptBehaviorAdmin=0`, UAC itself still on
(`EnableLUA=1`). Leave it that way: do not turn prompts back on, and do not treat silent elevation as a
fault. A session may *suggest* turning them on only when a test needs prompt-on behaviour (for example,
checking Compy's elevation prompt as a normal user sees it), and turns them back off afterwards with the
owner's OK. Scripts: `C:\Users\Kuya\code\_train\uac-off-permanent.ps1` (off), `uac-restore.ps1` (back to
the recorded original, 5). Every other security setting stays owner-gated (CLAUDE.md).

## Needs owner
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
      main (#656, PR #661, PR #673); a grep finds only gated sites. Issues closed 2026-10-28 with the fix
      commits named.
- [x] **#622** Health layout below ~600 px. `3c3e7553` (2026-10-24).
- [x] **#677** Clipped session metadata and combined-effect tooltips. `3c3e7553`.
- [x] **#622-f1** Live session rows stack below 600 px of list width `716e0fbd`.
- [x] **#622-f2** `4edfbb0e`: Health single column below 1240 px (two-column panel first fits at 1232); Live row
      timeline >= 120 px. Measured at 720 px tall only.
- [x] **#638** Phase 2 follow-ons from PR #634. Lands with this log entry (Optimize can't-confirm group, History tile title).
- [x] **GB-picker** `e0160644`: not a bug — Game Bar already off in Windows (AppCaptureEnabled=0, GameDVR_Enabled=0),
      now shown as "Already set this way in Windows, not by Compy".
- [x] **#686-followup** One `LiveReads` per Trial start instead of one PowerShell spawn per row. `6e7792a8`.
- [x] **#618** A set-aside change history refused every Trial forever. Trials `4405e96c` (fix `c9d4fa64`,
      review fix `1292fd09`), Care `d16309a3` (fix `871f9f41`). The marker's own last write is the edge
      (`history::ledger_coverage`, read-only metadata, 2 s slack); the history is loaded before the marker is
      read everywhere (start, conclude, readiness, notice, next band, session start, Care); a session begun
      after a set-aside records its counts as counts since it (`compy_changes_since_set_aside`), never as its
      total, compared only like with like; noise pairs only covered sessions; attribution never calls the rig
      clean after one. Game Readiness keeps its "right now" total refused (deliberate). Mutation-gate: read-only
      history.rs additions only, rollback untouched. rust-tauri-reviewer: round 1 REQUEST-CHANGES (symlink /
      directory marker taken), round 2 APPROVE; Care round: no MUST-FIX, window-start edge confirmed.
      Cowork-lane adversarial audit flagged (history.rs).

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
- [x] **P4-noise-proof** DONE 2026-10-29 on WARDOGS: 3 unchanged firing-range sessions 15:37-16:12 (661/634/660
      readings, ~319 fps, 1% low 211-214), then a bench retest of visual-effects (exp:5-1793315799398, owner OK):
      no-change, medium, restored (verified, VisualFXSetting=0); 1% low +1.6%, average +0.1%. The record's
      `noise_evidence` carries the measured band (±21.6%, between-session, 6 sessions) and the bench line shows
      it. Findings queued below (P4-noise-stretch, P4-noise-copy-2). Evidence `C:\Users\Kuya\code\_train\trial-wardogs\`.
- [ ] **P4-noise-stretch** (from P4-noise-proof) WARDOGS was judged against ±21.6% from older Oct-25 play
      (1% lows 148/136/122) although today's three idle sessions agreed within ~1.4%: the band takes the widest
      unchanged stretch in history, so old noisy play sets the band for every later Trial. Decide with
      P5-realplay (like-with-like scenes): which unchanged sessions describe the Trial's own conditions.
      Measurement: Rust review.
- [x] **P4-noise-copy-2** (done 2026-10-30 `a2437af7`, merge `fcb18d43`) "differed by up to X% between any two of those sessions" overstates it: only
      sessions within one unchanged stretch are compared. Reword (en + zh-CN) with a test.
- [x] **P4-cap-note** (done 2026-10-30 `42f8e04a`, merge `9234ff98`; self-review owed at next FULL) Both WARDOGS firing-range sessions sat at ~320 fps and were flagged "may be a menu or a
      frame cap"; a capped scene can't show a gain, so a no-change verdict there says little. Check the verdict
      line says so when both sides are capped (copy + test).
      Earlier the same day, P4-noise-proof's first attempt (original ask: 3 unchanged WARDOGS sessions >= 10 min,
      then the receipt shows the measured band). 2026-10-29 (owner moved it to Phantom Blade Zero, idle in the open world): 4 unchanged PBZ sessions of
      ~11 min recorded 10:25-11:11 (661/661/661/620 readings, ~168-170 fps). A guided Trial (visual effects,
      exp:4-1793299391026) then ran: Compy measured a ±16.1% between-session band over 7 PBZ sessions, but its
      two before-sessions swung 172->132 and 132->178 fps (the character left the idle spot for a boss
      fight), so the verdict was too-noisy and the change was put back (verified restored). Not closed: the
      receipt did not show the band (see **P4-noise-evidence**), and the swinging sessions widened PBZ's band.
- [x] **P4-noise-evidence** (from the 2026-10-29 PBZ Trial; copy fix, see the merge "train-noise-unjudged")
      Not a lost record: `noise_evidence_for` records a band only when the verdict was judged against it, and
      this too-noisy Trial stopped on its uneven before-session (3% halves check), so nothing reached the
      ±16.1% band. The bench said "No noise-floor record was kept", which read as a lost record and
      contradicted the journey receipt's band. Now a result that never reached the band says "not judged
      against a noise floor: its sessions could not be compared fairly" (en + zh-CN); guard in
      ExperimentBench.test ("Aniimo today") fails on the old copy.
- [ ] **P5-realplay** (owner decision 2026-10-29, Constitution §36; ROADMAP Phase 5 "Real-play mode"; next after
      P4-noise-evidence, ahead of the redesign) Trials must reach a verdict from normal, inconsistent play.
      Plan before coding (one bounded Rust slice + one TS slice): a Trial may keep its change on across several
      ordinary sessions and judge them against several ordinary sessions without it (session-level 1% low and
      average distributions, band from between-session spread), reporting Likely / No clear difference /
      Unknown with the confidence it earned; "too noisy" becomes "keep playing, Compy is still collecting"
      until enough sessions exist. Measurement + rollback (the change stays on for days): Rust review, and
      the journey must say plainly that the change is on and how to put it back.
      2026-10-29 evening (scheduled, CODE-ONLY, owner in PBZ): not started - needs a Rust measurement slice +
      review that does not fit one bounded session, and cargo builds would load the PC mid-game. Best taken
      in an interactive or FULL session.
- [x] **P4-noise-copy** Lands with the 2026-10-24 evening log entry. "from one session to the next" → "between any two of those sessions" (en); rename
      `grade_baseline`'s `noise_floor_pct` param to `halves_floor_pct`; fix ExperimentBench.tsx:206 comment.
- [x] **453-fix** `dce14e95`: Health, Optimize and History count one per change whose live check reads On;
      can't-confirm grouped the same on all three; shared parity fixture (Rust + TS).
- [x] **453-rerun** PASSED 2026-10-24 14:32–14:35 on desk build `2afd7471`: Health, History and Optimize read
      14 → 15 (EpicGamesLauncher startup entry on, STILL ON) → 14 (ROLLED BACK); recorded in BACKLOG P2.
- [x] **453-f1** `63414c42`: sessions, Trial start, Live and Debrief use the same one-per-change rule;
      can't-confirm stored and compared apart; sessions.json keeps the older-rule count for older builds.
- [x] **P4-baseline-quality** `66f1daea`. Owner 2026-10-24: warn, don't block — < 600 readings refuses;
      uneven halves (> 3%) or no trace warn and are recorded on the receipt. Blocking waits for P4-noise.
      Was: grade the baseline before a start: < 600 readings, or halves differing by more
      than the noise floor (the 133→244 fps swing), reads "too uneven" and offers a re-record. Fixture from
      the 2026-10-23 AFK numbers. TRIAL_PROTOCOL §2.
- [x] **P4-sessions** (uneven-session half only, owner approved 2026-10-24; the "effect below
      session-to-session spread" half waits for P4-noise, which supplies that spread) "Too noisy to judge" verdict (Inconclusive, restored) when either session is uneven
      or the effect is below session-to-session spread. Test replays the −18.5% case. Needs P4-baseline-quality.
- [x] **P4-comparable** `4dd3b46e` + `99b132e0` (merged with the interactive lane: flat stretches named,
      What-differed keys, too-few-readings wording; one field `background_secs_excluded`): alt-tabbed seconds (helper sees the game's own window behind
      another) stay out of every session FPS figure and are counted in `background_secs_excluded`; unknown,
      UWP/launcher-owned windows and older helpers measured as before. A Partial pair's one-line "what
      differed" already shipped (`experiment.rs` `with_comparability`). Menus shown in front stay measured:
      undetectable without game introspection, which is forbidden.
- [x] **P4-comparable-show** `78b908c3`: Debrief + Live list say "N s left out while another window was in front"; overlay set
      `focusable:false` (was focusable) + guard.
- [x] **P4-show-f1** `97313e21` (saved as a zero-reading row; every reader skips it; deck, receipts, detail windows fixed). A session whose game was always behind another window is never saved (`has_data()` needs
      samples > 0); save a zero-sample record that every comparison skips, so the UI can say why.
- [x] **P4-show-f2** 2026-10-29 PASS on installed `e6db699e` over Phantom Blade Zero: shows on the primary
      monitor, EXSTYLE 0x080C0138 (TRANSPARENT|LAYERED|NOACTIVATE|TOPMOST), WindowFromPoint inside it hits the
      game, never foreground. Evidence `C:\Users\Kuya\code\_train\review\p4-show-f2\`.
- [x] **P4-candidates** `e0160644`: picker shows only changes worth testing here; reasons behind a toggle.
- [x] **P4-rank** `8f1169ca`: picker ordered by evidence then risk, one reason each; "too small to measure here"
      only with a stated `expected_low1_pct` + a measured band (no catalog entry states one yet); no grouping
      (catalog has no interaction data).
- [x] **P4-recommended** `a86fbcf5`: kept only when the 1% low rises beyond the band and the average
      doesn't fall beyond it; 1% low down beyond the band = Worse; else No change (restored).
- [x] **P4-maxfps-smooth** `baa03405`: Maximum FPS ships (average beyond the band, 1% low held).
      Smoothest withdrawn (shown disabled): per-second data overstates the spread and a 5-pt floor sat inside
      real session variation (review).
- [x] **P4-smooth-measure** `df01e252` (true per-frame p50/p99/p99.9 via a 1% log histogram, freezes capped at 1 s,
      ~125 B/session; between-session pacing band). Store per-frame frame times (or a percentile spread) per session and measure the
      spread's session-to-session noise; then offer Smoothest.
- [x] **P4-smooth-offer** (-a `75f1d0d3`, -b `06596359` + `0f38e9ba`) Offer Smoothest for a game once `between_session_pacing_noise` (p99/p50 band) is measured for it; judge against that band (ratios carry ~±1% bucket error: a spread under ~2% is at the resolution limit).
      Scoped 2026-10-27 (skipped for P7-depth: not one bounded session). Split before starting: **-a** (Rust,
      measurement; review: one Rust agent) `experiment.rs` `start_experiment` admits "smoothest" only when
      `between_session_pacing_noise` is `Some` for the game, and `conclude` judges the treatment's p99/p50
      against the baseline's beyond that band (floor 2%); verdict rows record the band used; unit tests for
      admit/refuse and improved/no-change/regressed at the band edges. **-b** (TS) the bench's Smoothest option
      reads a new read-only field from `get_trial_candidates` (or the gate) saying whether it is measured for
      this game, and its "held" reason names what is missing; `ExperimentBench.test.tsx`.
      **-a done** `75f1d0d3` (feat `45d48c79`): `smoothest_admission` (unmeasured / no start ratio / unreadable
      history each refused in plain words before anything is recorded), `with_smoothest_outcome` (delta as a % of
      the lower ratio, like the band), `SmoothestEvidence` stored additively; cargo 1651/0, clippy clean; one Rust
      review (REQUEST-CHANGES → denominator, history refusal, wording, NaN note taken; wrong-session and
      write-order findings checked and not applicable). Ordering gate: -b ships in the same build or later, never
      before -a (an older Compy reads a stored "smoothest" as Recommended). -b plan: a read-only
      `get_smoothest_readiness(baseline_session_id)` sharing the start's admission, read by the bench.
      -b scope found 2026-10-27 (read-only): the bench reads every non-"max-fps" Trial as Recommended
      (`ExperimentBench.tsx` judged-row readout ~:363 and P5 `outcomeChoices` ~:913), so -b must also type
      "smoothest" there (judged row says "Judged for Smoothest"; P5 choices either include it or skip it
      explicitly), and the readiness reason needs locale keys (en + zh-CN), not the backend's English.
      **-b done** `06596359` (feat `f53f4511`, review fix `76d56405`): read-only `get_smoothest_readiness`
      sharing the start's `smoothest_for`; held reasons as `SmoothestHeld` keys in en + zh-CN; Smoothest rows
      judged on pacing; never one side of the P5 switch; frontend IPC review APPROVE, re-ask after each
      reload and held-pick fallback taken. r26 caught the command granted to no window and the census
      retirement → `0f38e9ba` (capability + `outcomeSmoothestUnavailable` retired). Visual self-review owed (FULL).
- [x] **P4-next** `abd4c883`: after a Trial, offer the next untested change (offer only); none left =
      "Nothing else here is worth testing on this PC" as success. Tested = a verdict on this game in experiments.json.
- [x] **P4-next-f1** `1fc5026c`: picker marks tested changes ("· Tested: <verdict>") after untested ones.
- [x] **P4-exit** (code) `e3d0420e`: read-only "What Compy tested on <game>" panel; "We tested what
      mattered" only when nothing untested remains. Today for WARDOGS: 1 of 16 testable changes has a result.
- [x] **P4-exit-truth** (`8e8370a0`, fix `0c27d141`; from the 2026-10-26 critical review §4, reproduced on the owner's
      WARDOGS records) The journey counted "too noisy to judge" as a finished test, and a result judged under an
      older driver/Windows build still read "We tested what mattered". Now only a measured verdict (improved /
      no-change / regressed) is a result; other verdicts are inconclusive attempts; a result whose Trial ran
      under a different driver or Windows build than the game's newest session is stale; inconclusive (under 2
      runs in a row, ENGINE §7) or stale changes the picker still offers are "worth another run", offered after
      the untested ones (`nextToTest`, one rule for P4-next, P5-continue and P5-resume); the claim is bounded:
      "Compy finished the supported tests for <game> on this PC". Unknown context stays unknown. Tests fail on
      the old code (test-summary 8, journey-resume 5, bench 1). Review (1 round, all fixed in the same commit):
      an as-is session from an older driver/build is never reused (`reusableAsIs`), so a stale retest records a
      fresh before-reading; a stale result is counted apart from tested, and a kept one is listed with "put it
      back, then test again"; the just-judged Trial replaces the store's running copy of itself; journey and
      summary share one newest-Trial comparator (`judgedAt`). Decision to overrule if wanted: the two-run cap.
- [x] **P4-exit-truth-f1** (2af5f7e2, fix 748e2192; the 2026-10-26 follow-up review's five findings, one bounded
      pass) §1 one validity rule: `contextCheckFor(...).matchOf` (GPU + driver + Windows build → matching /
      changed / unverified) now serves the summary, the journey, as-is reuse AND the outcome switch, which
      withholds a keep whose Trial ran under a changed context (`keepStale`; trade still shown as history).
      §2 unverified is neither matching nor changed and never "finished"; the two-run retest cap counts only
      attempts under comparable conditions. §3 nothing untested, nothing to retry, nothing measured →
      "nothing testable now", never "finished". §4 Care: the same advice judged on another rig re-anchors
      (stored baseline retired as `rig`); a stored step's final read counts as shown only when BlackBox
      renders it (`markFinalShown`), not when a crash card won the pick. §5 Home "did it help?": a failed
      Trial-records read says "couldn't read", never "has not measured" (`trials.judged: null`). en + zh-CN.
      Guards fail on the old code: test-summary 7, bench 1, Care 3, Home 1. Review (1 round, APPROVE +
      7 SHOULD-FIX, all taken in the same commit): a keep is offered only on a MATCHING context (unverified
      is withheld with its own line, same as changed); a measured result with unverified context gets its
      own headline ("can't be tied to this PC as it is now"), never "nothing measured", and blocks "finished";
      `reusableAsIs` reads `matchOf`; a null `get_experiments` answer is unknown, not zero. Two UNVERIFIED
      items checked and found not defects: CareNextStep renders whenever it has a step, and
      `storedStutterStep` already compares rigs via `newestRigOf` before the final read.
- [x] **P4-exit-truth-f2** (38e31fa0, fix c9580298; the third review's four remaining gaps, one bounded pass) §1 "now"
      is the NEWEST session, never an older one found by searching back: a newest session with no context
      leaves results unverified (last-known context is still shown). §2 completion is worded from what EVERY
      change holds (`stop` counts): one measured change never speaks for another's unjudged attempt; "finished"
      needs a matching result and nothing unjudged. §3 journey and summary agree on unverified: counted apart
      in progress, offered again as a retest while the picker offers the change (the route to fresh
      evidence), with its own reason line. §4 Home: a failed gate check is also "couldn't read"; only a bench
      that positively read dark is an empty history. Combination tests: a 12-cell matrix (context × result ×
      offered) pins headline and offer; harness fixtures now record a context and the real baseline id, so
      "tested" in tests means verified. Guards fail on the old code: summary 13, journey 2, bench 3, Home 1.
      Review (1 round, 1 MUST-FIX + 2 SHOULD-FIX, all taken in the same commit): an unverified retest could
      loop forever and as-is reuse defeated it → an as-is session is reused only under a MATCHING context,
      and an unverified result is offered again at most twice in a row (`unverifiedRuns`, same cap as
      inconclusive), then said as unverified; `stop.unjudged` renamed `stop.noResult` (it is the uncapped
      count). Noted, not changed: "worth retesting" with only a set stale result is mitigated by the
      stale-kept line (pre-existing).
- [x] **P4-exit-truth-f3** (3de75240, fix dcfc5d9f; the fourth review's one defect + three wordings, one
      bounded pass). Defect: alternating "measured but unverified" and "too noisy" attempts never reached
      the retest cap (each counter reset the other) → `unusableRunsOf` is the ONE budget (RETEST_CAP 2) for
      every attempt that gave no result Compy can use now; summary (`unjudged`, retest offers) and journey
      (`retestReasonFor`) draw on it; the reason named is the newest attempt's; a measured MATCHING result
      resets it; "changed" attempts don't count (round-3 semantics kept). Wordings: the "worth retesting"
      headline lists the reasons present through the row's own mapping; the §9 line is "Last recorded
      context (<date>):" (`contextAt`), never "Measured on:"; Home: a bench read dark is "testing
      unavailable" (`judged` stays null, `didItHelp.sentenceUnavailableSince`), not an empty history.
      Caught on the way: two zh-CN Home strings were mojibake from f2's write (repaired), and the full
      desk suite then showed the repo's own `scripts/encoding-guard.test.mjs` already catches exactly this
      (it also flagged 3 comment spans in `CareNextStep.tsx` from an earlier round; repaired with
      `node scripts/encoding-guard.mjs --fix` in the tick commit). Lesson, not a new guard: f1/f2 proved
      only the touched suites; the FULL suite is the landing gate (a draft parallel mojibake test was
      dropped — one monitor). Review (1 round, 1 MUST-FIX + 3 SHOULD-FIX, all taken in the same commit): the
      headline counted/explained unverified rows the cap had stopped offering → from `retest` + `stale`
      only; no "Invalid Date"; reasons say "couldn't be judged" and "a different driver, build or GPU".
      Guards fail on the old code: summary 2, journey 1, bench 4, Home 1. Not pushed, not installed
      (CODE-ONLY); the owner-and-friend walkthrough is the next investment, not code.
- [ ] **P4-exit-proof** (owner, FULL) Run Trials on WARDOGS until the panel says "Compy finished the supported
      tests" with nothing worth another run; record it in BACKLOG as the Phase 4 exit.

### Then — Roadmap Phase 5: Guided Optimization Journey (`product/ROADMAP.md` Phase 5)
Planned 2026-10-25. Order is value order. Phase 5 exit on the owner rig: from one button to the summary,
the owner never clicks Start experiment, Start capture, Stop capture or Conclude, and never picks a setting.
- [x] **P5-plan** Slices written below (2026-10-25).
- [x] **P5-guided** `2f33cc6b` (capture starts on the button press; ends on game exit or Done). One "Optimize my game" button on Optimize for the detected/last-played game: defaults to
      Recommended (Maximum FPS one tap away), says the plan and time in one line (e.g. "2 sessions of ~10 min:
      one as-is, one with <top-ranked change>"), picks the change from P4-rank, and starts/stops capture
      itself when `game_state` sees the game in front / closed; then concludes and shows the verdict. One
      change per run; no overlay. Needs P4-rank, P4-recommended, P4-maxfps-smooth, P4-comparable. ROADMAP P5
      steps 1, 2, 4; Constitution §4, §10; ENGINE §2.
      Deviation: capture starts on the button press, not on detection (the FPS helper is what sees the game).
- [x] **P5-continue** `61e7539e` (verdict line, one-tap Next with honest 10/20 min, reuses a steady baseline). After a verdict the journey acts on it (Better kept, everything else restored, said in one
      line) and offers "Next: <change>, ~10 min" as one tap, until P4-next says nothing is left. Needs
      P5-guided, P4-next-f1. ROADMAP P5 steps 5, 7; ENGINE §4, §7.
- [x] **P5-enough** `b28e188c`: countdown -> "Compy has enough; you can stop" (>= 600 counted readings + steady
      halves) in the journey panel and the click-through overlay; never takes focus.
- [x] **P5-enough-f1** (`013cac22`) If halves never settle, the line can stay up forever; after a cap, say plainly the game keeps
      changing and offer stop (judged as uneven). (desk) Check the line fits the 230x150 overlay.
- [x] **P5-rebaseline** `a0da7bbb`: uneven/untraced as-is session -> one more as-is session (max 2), then test anyway or stop;
      one shared grading helper pinned to Rust.
- [x] **P5-learned** `a5836783` (kept/put-back + why, one lesson from a documented rule table, detail behind a toggle). End-of-journey summary in plain words: kept, restored and why, plus one lesson from this
      PC's numbers (e.g. "1% lows rose, average barely moved: steadier, not faster"); detail behind a toggle.
      Extends the P4-exit panel. Needs P5-continue. ROADMAP P5 step 8; Constitution §13, §14; ENGINE §8.
- [x] **P5-resume** `b285dc73` (progress from the experiments store; Stop here keeps decisions). The journey survives a Compy or game restart and spans days: Optimize shows "2 of 5
      tested · Next: <change>" and a Stop-here that keeps current decisions. Needs P5-continue. ROADMAP P5
      step 5; ENGINE §7 (user ends).
- [x] **P5-outcomes** (`6ce1280b`) When a game has both a Recommended and a Maximum FPS result that differ, offer the choice
      with the actual trade in one sentence; one result = no choice shown. Needs P5-learned. ROADMAP P5
      step 6; ENGINE §5, §6 (default wins ties).
- [x] **P5-outcomes-f1** (`19c70a50`) Record which Trial justified an outcome-switch keep in the Trust Ledger (needs a Rust change).
- [ ] **P5-exit-proof** (owner, FULL) Run the journey on WARDOGS from the button to the summary with no manual
      Trial clicks; the friend repeats it once. Record in BACKLOG as the Phase 5 exit. Needs P5-guided through
      P5-learned. ROADMAP P5 exit.

### Then — Roadmap Phase 6: Care Journey convergence (`product/ROADMAP.md` Phase 6)
Planned 2026-10-25. Order is value order. Converge, don't add rooms. Phase 6 exit on the owner rig: from Home,
"my game crashed" or "it stutters" reaches one next step or an honest "we don't know" in one place, with no
room or station picked by hand.
- [x] **P6-plan** Slices written below (2026-10-25).
- [x] **P6-changed** (`3216a6b2`) Each incident in Crash & Freeze Rescue shows "Changed before this": Compy changes, driver,
      Windows build, power plan, hardware and drift since the last clean session, tagged "not proven cause".
      Needs the `intelligence.rs` gather anchored at the incident time. ROADMAP P6 bullets 1, 3; Constitution §17, §25.
- [x] **P6-changed-f1** (`7d496665`) Localise the "Changed before this" event lines by event kind (they show Rust's English
      `summary` today, as the What-changed panel does) so zh-CN reads whole. Needs P6-changed.
- [x] **P6-changed-f2** (`8204e17c`) The WER folder read stops at 400 entries in folder order; if hit, treat the scan as
      incomplete for "clean" (no time cut-point today), or read newest-first so a cut-point exists.
- [x] **P6-door** (`bac31375`) One Care door on Home ("Something's wrong") replaces the Crash & Freeze entry; the observer
      card and the interview crash/stutter answers all land on the same Care view. Needs P6-changed. ROADMAP P6
      exit; Constitution §18, §27.
- [x] **P6-stutter** (`597a76dc`) Stutter/slow on that view compares the latest session of the game with its last good one
      (`what_changed_between`), not a Monitor/benchmark hand-off; no good session = say so and offer one.
      Needs P6-door. ROADMAP P6 bullet 4; Constitution §16, §17.
- [x] **P6-next** (`9708fbc6`) The Care view shows exactly one next step (Black Box `next_step` or the what-changed next
      test); after it, the measured-payoff line reports recurrence or absence. Needs P6-door. ROADMAP P6
      bullet 6; Constitution §25.
- [x] **P6-restore** (`8f326131`) When Compy changes sit between the last good session and the problem, offer "Put back how
      it was on <date>" with the list, via the existing ledger rollback; unrecorded changes say Compy can't
      restore them. Needs P6-changed. ROADMAP P6 bullet 7; Constitution §26.
- [x] **P6-restore-f1** (`6e2f4e99`) ExperimentBench (Trial start) should respect App busyId so a Trial can't start while Put back is running.
- [x] **P6-next-f1** (`dc674a14`) `blackbox-resolution.ts` `resolutionFor` counts any record with the same `tag` as a recurrence; for App crash / App hang it should also match `receipt.faulting_app` (case-insensitive), as `care-next-step.ts` `sameKind` does.
- [x] **P6-next-f2** (`142b769b`; owner visual check of the final read at the next FULL session) Keep a stored stutter step (and its payoff) alive while its anchor exists, so "stayed within" can show after a good session; today the step disappears once the latest pair isn't regressed.
- [x] **P6-next-f3** (`43abf86a`) The Black Box "Did this help?" resolution line (`blackbox-resolution.ts`) is built in English in TS;
      move it to en/zh-CN locale keys.
- [x] **P6-unknown** (`1c09b476`) Honest ends on the Care view: "Not enough evidence yet", or "Beyond Compy" (`beyond_us`)
      with the Support evidence export one tap away. Needs P6-next. ROADMAP P6 bullet 8; Constitution §26.
- [x] **P6-timeline** (`02a00f5f`) One "Since it last worked" list on the Care view (incidents, Compy changes, drift,
      hardware changes, sessions); the duplicate drift/hardware notices in Check, HomeHud and HomeV2 point
      there. Needs P6-door. ROADMAP P6 bullet 2; Constitution §16, §27.
- [ ] **P6-exit-proof** (owner, FULL) From Home, follow a real (or past) WARDOGS crash and a stutter to a next
      step or honest unknown without picking a room; the friend repeats it once. Record in BACKLOG as the
      Phase 6 exit. Needs P6-changed through P6-unknown. ROADMAP P6 exit.

### Then — Roadmap Phase 7: Contextual UX and education convergence (`product/ROADMAP.md` Phase 7)
Planned 2026-10-25. Order is value order. Converge, don't add rooms, consoles or guards (directive rule 1:
product guards frozen for additions; slice tests sit beside the code). Phase 7 exit on the owner rig: the
friend goes from Home to an answer on "more FPS", "it stutters" and "it crashed" without asking what a word
means, and the owner opens the technical layer on each and sees the exact setting, measurement and source.
Parallel: slices marked "Parallel-safe" touch files no other open P7 slice touches; the rest run in order.
- [x] **P7-plan** Slices written below (2026-10-25).
- [x] **P7-route** — `9fefbf6d` (2026-10-26; tsc 0, full vitest 521 files / 9312 passed). Still owed: the
      visual self-review of the interview → bench/Blackbox landing (CODE-ONLY run, no UI driving); do it at
      the next desk-free session before any install claims it live. Home interview answers land on the journey that answers them, not a bare station:
      "I want more FPS" opens the Optimize station with the P5 guided journey ready (today `wantFps` runs the
      fast path / Diagnostics and claims frames "are usually taken by things running alongside your game");
      "I changed something — did it help?" opens "What Compy tested" or "Since it last worked", not Benchmark.
      `home-interview-data.ts`, `App.tsx` `openLabStation`, `LabConsole.tsx` mount effect, a one-shot arrival
      key beside `care-arrival.ts`, `GuidedJourney.tsx`. ROADMAP P7 bullet 1; Constitution §3, §11, §27.
- [x] **P7-depth** (`7530677e`, feat `4306036b`; visual self-review owed at the next FULL session, CODE-ONLY run)
      `src/design/Depth.tsx` + `Depth.css`: answer always shown; explanation one tap ("Why this, for this
      PC", or the adopter's own label); receipt one more tap; Expert view opens both by default and follows
      the toggle live; children mount only while open; `ReceiptRow` never shows a blank field; a11y rostered,
      mono on values only. Adopters: `CareNextStep` (answer = step + its own instruction + measured payoff;
      explanation = why, with safe / research / beyond and stored-stutter variants, the source, final read;
      receipt = the exact recorded fields) and `CareHonestEnd` (answer = no step + what adds evidence;
      explanation = why none; no receipt — the gaps are its whole state). Review (1 round, 3 MUST-FIX +
      5 SHOULD-FIX, all taken): the why over-claimed "safe first check" and "latest comparison"; the detail
      (stop code) had gone behind a tap. Taste calls recorded: payoff in the answer; two hairline doors
      inside the block, not boxed. Proof: tsc 0; 87 files / 958 tests on the touched suites (desk + Linux);
      full desk suite under the landing. One shared Answer / Explanation / Technical receipt block in `src/design/` (answer always
      shown; explanation one tap; receipt one more tap, or open by default under Expert view via
      `use-expert-view.ts`). First adopter: `CareNextStep.tsx` + `CareHonestEnd.tsx`. No new data.
      ROADMAP P7 bullet 2; Constitution §13. Parallel-safe (new component + Care files only).
- [x] **P7-depth-verdicts** (`a0c008bd`, feat `e43ffe78`; visual self-review owed at the next FULL session)
      Journey result: the line stays the answer; explanation = the keep rule it was judged by (Recommended /
      Maximum FPS, with the band figure only when the record holds the judged band; a no-result attempt says
      the sessions could not be compared fairly); receipt = the record's numbers verbatim (change, outcome,
      verdict, confidence, before/after average and 1% low with stored deltas, band or floor as recorded,
      measured noise, samples, session ids, trial id). Bench summary: noise-band line, last-recorded-context
      line and a per-change delta row move to the receipt; no explanation door. Debrief comparison card:
      verdict + keep/revert stay the answer; delta line and "what a null result means" are the explanation;
      before/after readings, noise-floor chip and exact fields the receipt. One `receiptPct`/`receiptBand`
      helper for every receipt (no "-0.0%"). Review (1 round, APPROVE + 4 SHOULD-FIX, all taken). Guards:
      journey 3, bench 2 adapted + receipt row, Debrief 1, helper 1; 5 fail on the old code. Proof: tsc 0;
      touched suites 87 files / 1015; full desk suite under the landing. Put the Trial / journey verdict (`GuidedJourney.tsx`, ExperimentBench summary and
      `test-summary.ts` output) and `SessionDebrief.tsx` on the P7-depth block: raw deltas, noise band,
      registry/API names and sample counts move to the receipt layer. Needs P7-depth, P7-route (both touch
      GuidedJourney). ROADMAP P7 bullet 2; Constitution §13, §25.
- [x] **P7-jargon** (`a49b2128`, copy `94000540`; copy only — no review round, visual self-review owed at FULL)
      Inventory of the in-scope faces found the Home tiles and Debrief headline terms already `Term`-glossed;
      the un-glossed strings were the journey's kept line + four keep-rule whys, the Care view's two
      session-payoff lines and the Debrief's delta line. They now read "the frame rate in your worst
      moments (the 1% low)" and "the normal run-to-run wobble (the noise band/floor)" — the Debrief's own
      "worst moments" vocabulary — with the exact term kept once in parentheses; receipts keep exact terms.
      zh-CN unified on "1% 最低帧（最卡的时刻）" / "噪声范围". Nine test expectations updated. Full desk suite
      522 files / 10032 green. Not swept (out of this item's named scope): the Benchmark room's own strings
      and the bench's technical rows. Default-face copy sweep of Home, the journey, the Care view and the Debrief (en + zh-CN):
      "noise floor" (25 en strings), "frametime" (10) and bare "1% low" (67) get plain words or a `Term`
      gloss on the answer and explanation layers; exact terms stay in the receipt. Locale JSON + call sites;
      no new guard. Needs P7-depth-verdicts. ROADMAP P7 exit; Constitution §3, §13.
- [x] **P7-confidence** (`f0fd750d`, feat `7b55540b`; visual self-review owed at FULL) `src/data/confidence-word.ts`:
      inference bands (limiter rows, What-changed hypotheses, hardware evidence, Blackbook patterns) read
      Likely for high/medium and Unknown for low/unknown; provenance reads Known / Measured / Expected, else
      Unknown; the interview's level maps 1:1 ("Not measured yet" → Unknown, §26). Seven raw "{{level}}
      confidence" tags and the interview chip replaced; raw band kept on `data-confidence`; a title hint
      says what the word qualifies ("the reading is measured; what it means here is inferred, not proven").
      Retired keys removed (en + zh-CN; zh Likely = 较可能); affordance census re-recorded for the deliberate
      retirement. Review (1 round, APPROVE, SHOULD-FIX hint taken). Guards: confidence-word.test.ts + 5
      surface assertions. Full desk suite 523 files / 10708 green. One user-facing confidence vocabulary from Constitution §25: Known / Measured / Likely
      / Expected / Unknown, one helper in `src/data/` with en + zh-CN keys. Replace the six
      "{{level}} confidence" tags that print raw high/medium/low (`home.json` ×3, `optimize.json` ×2,
      `gaming.json` `confidenceSuffix`, `blackbook.json` `confidenceLabel`) and the interview's
      measured/likely/unknown chip; map from each producer's own field (`Provenance`, `PriorityItem.confidence`,
      `ConfidenceBand`, `FindingLevel`), never a percentage. HomeConsole/HomeHud/HomeV2 limiter rows,
      `OptimizeStation.tsx`, `HardwareGrid.tsx`, `PatternsTile.tsx`, `HomeInterview.tsx`. ROADMAP P7 bullet 6;
      Constitution §25, §26.
- [x] **P7-severity** (`2ba1f70c`; visual check at the next FULL session) A Trial that hurt and was put back is not red "Critical": `trialVerdictTone` /
      `verdictTone` (`benchmark-view.ts`) use `danger` for "Hurt — reverted" and "regressed"; danger stays for
      a harmful state still on the machine; check `status.ts` "Critical" has no other user. `Benchmark.tsx`,
      `TwoFutures.tsx`. ROADMAP P7 bullet 7; Constitution §34, §26. Parallel-safe.
- [x] **P7-score** (`d2f5b002`, fix `81ccb193`; visual self-review owed at FULL) HomeConsole: readable = checks −
      unknown; score = passed / readable, null when nothing was readable; note "13 of 14 checks passed · 2
      couldn't be read"; with nothing readable the reason is said beside the not-yet ring; grade words Good /
      Fair / Worth a look (zh 良好 / 尚可 / 值得看看); the interview's readiness fact counts "of" the readable
      checks. Not changed: HomeHud / HomeV2 pilots' own counters; LabConsole derives no ring. Guard in
      home-console.test.tsx fails on the old code (81 "FAIR" for 13/16 with 2 unread). The Home/Lab readiness ring counts unreadable checks as failures (`readinessScore` subtracts
      `unknown_count`) and grades < 70 "NEEDS WORK": leave unknowns out of the ratio and say "N couldn't be
      read"; calm grade words; the formula line stays. `HomeConsole.tsx` ~624-660, `command-center-data.ts`,
      LabConsole's same derivation, `home.json` `readinessGrade`. Needs P7-confidence (HomeConsole).
      ROADMAP P7 bullet 8; Constitution §34, §26.
- [x] **P7-notify** — `890e71bb` (feat `687551d1`, 2026-10-27; live toast proof owed in a FULL session) The session-end toast fires for every saved session ("Your <game> debrief is ready").
      Fire it only when the session settles a decision or a state change (a Trial/journey verdict, a
      regression against the last good session); otherwise stay silent and leave the debrief in the app.
      `lib.rs` `notify_debrief_ready`, `monitoring.rs` ~1286, `sessions.rs` `save_session`; Rust unit tests.
      Care incident toast (`incident_observer.rs`) already follows the rule: leave it. ROADMAP P7 bullet 3;
      Constitution §15, §33. Parallel-safe (Rust only). Review: one agent (Rust).
- [x] **P7-teach** (`d501a659` + gate repairs `ab2cdda8`; feat `3fb653a3`, fix `7d0eae04`, test `3801b499`; visual
      self-review owed at FULL) `lessonRuleFor` / `lessonRuleForVerdict` (test-summary.ts) are the one rule table
      behind the Trial summary, the Debrief comparison card (lesson behind Why, worded for the Trial of that change)
      and the Care stutter comparison (`stutterLessonRule`: deltas from the report's own session readings against
      its floor, worded for two sessions; the stored verdict wins, confounded / zero floor / inside-floor teach
      nothing). `src/design/LessonLine.tsx` links the Library entry (`LESSON_LIBRARY_ID`: one-percent-lows, noise-floor
      for too-noisy). Review (1 round, APPROVE-WITH-FIXES, 3 SHOULD-FIX + 5 NIT taken; stutter line stays outside
      a Depth). Guards: test-summary (rules, dirs, key-exists in both locales, entries exist), SessionDebrief
      (lesson behind Why; verdict wins; confounded none), StutterCompare (rule, verdict wins, render + none),
      a11y census roster. Landing gate r19: 523 files / 10724 green after two repairs (LessonLine roster; Care
      next-step explanation waited for). After personal evidence only: the Debrief and the Care stutter comparison show at most one
      lesson from the P5-learned rule table (`test-summary.ts` `LESSON_RULES` / `lessonFor`), with a link to
      the matching Library entry (`libraryApi.openLibrary`); no rule = no lesson. `SessionDebrief.tsx`,
      `StutterCompare.tsx`. Needs P7-depth-verdicts (Debrief). ROADMAP P7 bullet 5; Constitution §14.
- [x] **P7-palette** (`2f72e4a3`; feat `029c217e`, fix `dbc55768`; visual self-review owed at FULL) 13 interview
      findings (all but the two "not sure" answers) are palette intents with plain labels + typed keywords
      (home.json `interview.palette.*`, en + zh-CN); choosing one writes a 60-second one-shot arrival and goes
      Home, where HomeConsole opens the interview AT that card along `pathToFinding` (Back works; the card's own
      action waits for the tap — the palette fires nothing). Offered only with the Home console and the
      interview both on; an interview switched off spends the key and opens nothing. Group headers now via
      i18n. Review (1 round, APPROVE-WITH-FIXES: 2 MUST-FIX + 5 SHOULD-FIX + 2 NIT taken; per-row hint and the
      pre-existing header role kept). Guards: intents census + zh words + pathToFinding; palette ranking for
      the four named phrases, keyword collisions (ram, compare, desktop, 卡, 死机), zh header, App
      write-before-navigate + flag gating, ShellV2 forwarding; Home arrival before/after mount, junk, interview
      off, expired. Landing gate r20: tsc 0, 523 files green. The command palette understands plain problems ("it stutters", "it crashed", "more fps",
      "what changed"): intent items reuse the interview finding actions from P7-route, so typing a symptom
      lands on the same journey as answering it. `command-palette-data.ts`, `CommandPalette.tsx`. Needs
      P7-route. ROADMAP P7 bullet 1; Constitution §27.
- [x] **P7-rig-limiter** (`bf178ac5` + gate repair `9ef50adb`; feat `2678d781`, fix `2d0e3d3d`, `b72f3934`; visual
      self-review owed at FULL — confirm the limiter highlight also opens the part's spec card on Home, intended)
      `rig/limiter-part.ts`: `install-drive` → the ONE detected physical drive reporting media type HDD
      (hardware.rs MediaType 3 → "HDD"); none/two HDDs, SSD-only or a volume fallback → no part; seven
      setting/software ids → "away" (dim, `DIMMED_GLOW` 0.35 through the existing `glow`, fans excepted);
      anything else → rig untouched. Drift guard parses priorities.rs so a new limiter id must be classified.
      HomeConsole: the raw top attention limiter drives `selectedId` until the user picks or clears a part;
      one line under the 3D stage ("the top thing Compy flagged is about this part" / "…is a setting or
      software, not a part", en + zh-CN). Review: r1 REQUEST-CHANGES (wiring lost — see session log; wrong-
      drive risk; copy overclaimed) → r2 APPROVE. Landing gate r22: tsc 0, 524 files / 10084. The Home rig picks out the part the answer is about: the #1 limiter maps to a rig part
      kind (`rig-parts.ts`), `RigHologram` highlights it through its existing `selectedId`; a limiter that is a
      setting or software dims the parts and says the evidence points away from hardware. `HomeConsole.tsx`
      stage, `rig-parts.ts`, `RigHologram.tsx`. Needs P7-score (HomeConsole). ROADMAP P7 bullet 4;
      Constitution §24.
- [x] **P7-rig-care** `9f60e291` (feat `c184ad8c`, fix `4f1f0437`; flake fix `908b0464`). Same on the Care station: the incident's faulting part (GPU driver -> GPU, memory error ->
      RAM, app crash with no hardware sign -> "not hardware") drives the Lab rig (`LabConsole.tsx`
      `RigViewer`). Needs P7-rig-limiter. ROADMAP P7 bullet 4; Constitution §24, §25.
      Rust `AssessmentRule` key beside the prose; overheating / graphics-driver (vendor-matched) -> the GPU,
      app-specific -> "not hardware", the rest draw no focus. Deviation: no RAM focus — no rule says memory
      alone (hardware-error covers WHEA/CPU/RAM together), so it stays unfocused rather than guessed. Review:
      source + date named on the rig line, vendor match taken. Visual self-review owed (FULL).
- [x] **P7-visual-review** `547fd2a1` (fix `f722c49f` TS, `1e0943a3` Rust) + gate repair `ed2de634` (`55b4093b`).
      2026-10-28 visual self-review of desk build `a33ff51c` on the owner's rig (right monitor), run by a
      general-purpose agent with desk tools. PASS: P7-score, P7-palette, P7-rig-limiter. FAIL, now fixed:
      P7-confidence (8 native-title chips -> `ConfidenceWord` with a glossed Term; bench "confidence: x" ->
      shared words, `lab.experimentBench.confidence.*` retired; What-Changed headline drops its raw
      "(x confidence)"), P7-jargon (`withTerms` glosses "1% lows"/"noise floor" in headlines), P7-rig-care
      (rig note no longer overlaps the grid), P7-depth (Step-id receipt row removed; a Windows host-process
      crash such as RUNDLL32 now gets "Update Windows, then the program that was starting", Partial, instead
      of "Verify the game's files"), P7-route (StutterCompare scrolls the answer into view once on a
      stutter arrival). Also the bench "Tested:" line separator. Review: rust-tauri-reviewer
      REQUEST-CHANGES (host list pruned of explorer/msiexec/WerFault, Strong -> Partial, Event Viewer
      wording softened), all taken. BLOCKED on real data (re-check when the owner has it): P7-severity,
      P7-depth-verdicts, P7-teach, P4-smooth-offer-b (its held state passed). The "Aniimo header on a
      Wardogs debrief" note was not reproduced: the captured outline shows an Aniimo session throughout.
      Round 2 (desk build `ed2de634`): P7-depth PASS; FAIL on clipped tooltips at the right edge, the
      stutter answer ~27,500px down under a loading crash scan, the rig note still on the stage floor, and
      a few unglossed words -> fixed in `dfd8f90c` (fix `7682027d`): Term flips end-anchored when it would
      spill, a stutter arrival renders the comparison first, the note sits under the stage, the interview
      level chip and every bench confidence word glossed. Round 3 (`dfd8f90c`): all PASS except bench
      noise-floor sentences -> `e6db699e` (fix `504dbbe3`). Kept unglossed by decision: delta labels
      ("After, 1% low") and the Home MEASURED provenance stamps (technical-layer measurement chrome).
      Round 5 (2026-10-29, real PBZ data, driven through the debug port while the owner played): P4-smooth-
      offer-b PASS (Smoothest offered and selectable on PBZ), P7-teach PASS (stutter comparison against the
      11:00 steady session, lesson line + Library link, glosses inside the window), P7-severity PASS (the
      too-noisy, put-back Trial is grey/amber, never red or "Critical"), P7-depth-verdicts: three layers
      present; the bench noise line contradicted the receipt -> P4-noise-evidence copy fix. Judged by design,
      not defects: the receipt shows only "After, samples" (the record stores no before-session sample
      count) and the bench summary receipt carries deltas (P7-depth-verdicts spec). Small follow-ups noted,
      not queued: Smoothest's hypothesis text still names 1% lows; the stutter headline says "previous" while
      its header says "last steady". Evidence `C:\Users\Kuya\code\_train\review\r5\`.
      Hurt-case check (2026-10-29, WARDOGS exp:1 "regressed -18.5%, restored"): bench row "Slower — restored",
      neutral grey, never red or "Critical"; no other surface shows it. Not seen live: SessionDebrief's
      session-vs-session `cmp-bad` (a measured regression of play, not a reverted Trial). P7-severity PASS.
      Evidence `C:\Users\Kuya\code\_train\trial-wardogs\`.
      Desk build `e6db699e` installed. Round 4 verdict: "OVERALL: PASS, except the per-row footnote half
      of (a), which is BLOCKED because no such row exists here" (shared noise line, Lab gauge, tooltip
      flip, rig note, stutter-first, bench words all PASS). Evidence `C:\Users\Kuya\code\_train\review\r4\`.
- [ ] **P7-exit-proof** (owner, FULL) The friend goes from Home to an answer on "more FPS", "it stutters" and
      "it crashed" without asking what a word means; the owner opens the technical layer on each and finds the
      exact setting, measurement and source. Record in BACKLOG as the Phase 7 exit. Needs P7-route through
      P7-teach; P7-palette and the rig slices do not block it. ROADMAP P7 exit.

### Then — Roadmap Phase 8: Advanced tuning envelope (`product/ROADMAP.md` Phase 8, `product/RISK_MODEL.md`)
Planned 2026-10-28 (scheduled refill). ROADMAP: broaden only after the Trial/risk/stability systems are
proven, so the first slices build the user-facing risk side of the Risk Model on the existing catalog
(no new mutation, no new catalog entry). Already there, not re-queued: the Blackbook says "Refused" for the
barred tweaks (HPET, bcdedit, core parking, registry hacks) and the palette finds them; the picker shows
each change's risk word. New capabilities wait for the owner and the Phase 4 exit proof.
- [x] **P8-posture-a** — `1eeef838` (Rust) `trial_candidates::screen` takes the user's risk choice: "Low risk only"
      (catalog `safe`) or "Low and moderate" (today's behaviour, the default). A moderate change under "Low
      risk only" is left out with a new `SkipReason::OutsideChosenRisk`; so is an unknown severity (it
      can't be shown to be low). The default leaves nothing out (every live catalog row states safe or
      moderate). Pure unit tests; one review round. RISK_MODEL §2.
- [x] **P8-posture-b** — `48785b23` (TS) The Trial picker asks once, "How far may Compy go on this PC?", saves the
      choice, sends it to the candidate read, and the "why not listed" row says "Outside the risk you
      chose" (en + zh-CN). The guided journey's next pick uses the same list; `test-summary.ts` and
      `journey-resume.ts` must not read a risk-filtered change as "not available". Needs P8-posture-a.
      Visible UI (new picker) still needs self-review in the next FULL session.
- [x] **P8-posture-note** — `73d9c5d9` (TS) "Nothing left to test" now adds "N more changes are held back
      by the risk you chose" (en + zh-CN); test proven failing on the old code. Self-review owed (FULL+desk).
- [x] **P8-posture-count** — `9e2083f5` (TS) `outsideRisk` lists only never-tested held changes; a held
      stale result no longer counts in `stop.stale` or the retest headline (`staleAsked`). Two tests, both
      proven failing on the old code.
- [x] **P8-posture-stale-copy** `53514506` (fix `35e39a0a`) A held-back change whose only result is stale reaches "nothing-testable-now",
      whose copy says nothing was measured; that is untrue when a (stale) result exists. Give that case its
      own honest line (en + zh-CN) and a test. Found 2026-10-29 while doing P8-posture-count. Self-review of
      the new line owed at the next FULL desk session.
- [ ] **P8-posture-show** The Trial receipt and the game summary name the risk choice in force when each
      Trial started (stored on the experiment record; older records read "not recorded", never a guess).
      Needs P8-posture-b.
- [ ] **P8-ack** Before a moderate change's Trial starts, one plain line names its cost from the catalog's
      own words and needs one tap ("I understand, test it"); safe changes start as today. Recorded on the
      receipt. RISK_MODEL §1 Advanced ("explicit user acknowledgement when the cost is not obvious").
- [ ] **P8-dims** The Trial receipt's technical layer lists the risk dimensions the catalog states for the
      change (reversibility, stability, compatibility, security) instead of one word; an unstated dimension
      reads "not stated", never filled in. RISK_MODEL §3 ("do not collapse these into one arbitrary score").
- [ ] **P8-first-advanced** (owner) Pick the first Advanced candidate (deeper power/scheduling behaviour)
      and admit it through `.claude/rules/tweak-catalog.md` + ARCHITECTURE_LOCKS "candidate only after
      Trial + Risk proof". Needs the owner's sign-off and P4-exit-proof.

### Then — Roadmap Phase 9: Hardware decision intelligence (`product/ROADMAP.md` Phase 9)
Planned 2026-10-28 (scheduled refill, second). Smallest read-only slices on what Compy already measures;
no shopping, no product names, no prices (affiliate firewall), never an invented spec.
- [x] **P9-hz** `f1bfbb26` The display-mode line shows the refresh rate with its unit ("1920×1080 @ 250 Hz", was
      "1920x1080@250") on the debrief rig line, Trial summary context, Care next-step rig and hardware-change
      timeline, en + zh-CN; rate 0 reads "refresh rate unknown". Self-review of the four lines owed (FULL+desk).
- [x] **P9-target** FPS answers compare against the screen's measured refresh rate ("about 60% of your
      250 Hz screen"); no line when the rate or the FPS is unmeasured. ROADMAP P9 "display target".
      `97ebbf7f` (merge `6e4224c9`): session debrief line from the session's own recorded mode, en + zh-CN.
      Self-review of the line owed at next FULL desk session.
- [x] **P9-settings-done** When the Phase 4 panel says Compy finished the supported candidates for a game,
      the game summary adds one line: settings have reached what Compy can test here, then the measured
      limiter (P7-rig-limiter) or "not measured". "No upgrade recommended" is a valid answer and the default
      when nothing is measured. Needs P4-exit-proof for a live case; code + tests can land first.
      `25feba43` (merge `a84ba5a7`): code + tests landed; reads the cached scan's top attention limiter (a
      setting named as a setting, a part named only), no scan/unread = "not measured". Live case still needs
      P4-exit-proof; self-review of the line owed at next FULL desk session.

### Before deadlines
- [x] **fflate** 0.6.11 `53a1c9de`; dev-only body-parser/zod advisories cleared (shadcn 4.22.1) `89fc1add`.
- [x] **tokio** `fcc64291` (1.54.1; only tokio's lock entry changed). Desk install at the next ship.
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime` (FULL mode only), update
  `RELEASE_STATE.md` in the same commit, report what is visible, and summarise the week from the Session log.

## Session log
- 2026-10-27 ~18:15–18:50 (interactive from Claude HQ, CODE-ONLY): P4-smooth-offer-a `75f1d0d3` (feat `45d48c79`);
  cargo test 1651 passed, clippy -D warnings clean; one Rust review round, 4 findings taken; r25 FULL vitest 525
  files / 10100, exit 0. Lesson: a regex over `ExperimentRecord {` also matches fn return types — anchor struct
  literal edits on the compiler's missing-field errors, not text. Not pushed.
- 2026-10-27 ~18:55–19:40 (interactive from Claude HQ, CODE-ONLY): P4-smooth-offer-b `06596359` (feat `f53f4511`,
  fix `76d56405`); r26 FULL vitest failed on command-authority-guard + affordance-census → `0f38e9ba`; r27 FULL
  vitest 525 files / 10777, exit 0, tsc 0; cargo 1651/0, clippy clean. Lessons: a new command's touched set
  includes `command-authority-guard` (capability grant), and retiring a locale key includes the census. Not pushed.
- 2026-10-27 ~19:40–20:10 (interactive from Claude HQ, CODE-ONLY): #618 Trials `4405e96c` + Care `d16309a3`;
  cargo 1660/0, clippy clean; r28 FULL vitest 525 files / 10110, exit 0 (Trials), r29 for Care. Lesson: when
  a permanent marker gates a check, find every reader of it (#669's session counts were a second dead-end
  the old patch didn't cover). Not pushed.
- 2026-10-27 ~19:57–20:42 (owner watching a film on the primary monitor, asked us to work around it): FULL
  catch-up. Pushed `2730e4d8..a33ff51c` then `..f515f53f` (pre-push gate refused twice on real catches:
  closing-keyword in a docs subject, reworded; a moved archive row's relative link, re-pointed; and once on a
  CareNextStep Depth-door flake → `f515f53f`, doors opened against the live tree). Desk build `a33ff51c` installed
  silently (`-NoLaunch`, updater artifacts off for this desk-only build: no signing key in the session), stamp
  in the installed exe; RELEASE_STATE row `bc38ee54`. Compy's saved window position pointed at monitor 2 for the
  run and restored after; a watcher moved three gate-launched Compy windows off the film monitor, no focus taken.
  Visual self-reviews still owed: the self-reviewer can't reach the desk from a cloud session (needs a desk-local
  session).
- 2026-10-28 ~05:50-07:30 (interactive from Claude HQ, owner on PC, Compy on the right monitor by his choice):
  the owed visual self-reviews ran after all - a general-purpose agent with the desk tools can capture and
  judge, unlike the dedicated self-reviewer from a cloud session. Verdicts and fixes under P7-visual-review.
  Gate r30 caught two expected misses (a named census retirement, a test reading the old chip); r31 green
  (526 files / 9448 passed), cargo 1661 passed, clippy clean. Lessons: a gate-launch wrapper's array args
  do not survive `-File`, call it with `&`; keep vitest log filters to summary lines (a loose "fail" regex
  matches hundreds of test names). Review rounds 2-4 drove `dfd8f90c` and `e6db699e` (gates r32, r33 green,
  526 files / 9453 passed); round 4 PASS. Lesson: a scroll-into-view fix loses to content loading above
  it - put the answer first instead. Installed `e6db699e`, pushed after.
- 2026-10-29 10:16-12:50 (interactive from Claude HQ, owner away then playing PBZ): 4 unchanged PBZ sessions
  recorded unattended (owner-approved admin-prompt window 10:22-11:55, restored), one guided Trial
  (too-noisy, put back), P4-show-f2 PASS, round-5 screen checks (P4-smooth-offer-b, P7-teach, P7-severity
  PASS), noise-line copy fix `d38ef19b`, Constitution §36 `b9fe3c8b`, admin prompts left off by owner decision
  (`4ab109f8`). Gate r34 green (526 files / 9465), cargo 1665, clippy clean; desk build `4ab109f8` installed,
  pushed. Lesson: Compy's FPS helper needs an elevated start each session; an unattended session needs the
  owner's prompt decision first.
- 2026-10-28 ~08:45-09:00 (scheduled, CODE-ONLY, owner playing WARDOGS): Phase 8 queue refill `fb483dd4`;
  P8-posture-a `1eeef838` (cargo trial_candidates 20 passed, clippy clean, review r1 PASS-WITH-NITS; nit
  folded into P8-posture-b). Not pushed - next FULL session pushes.
- 2026-10-28 ~13:00-14:15 (scheduled, CODE-ONLY): Phase 9 queue refill `2fc32bf7`; P8-posture-b `48785b23`
  (tsc clean, targeted 570/570, full vitest 523/526 files - the 3 site-app tests need site-app/node_modules,
  absent in the worktree; review r1 MUST-FIX reload race fixed + guard test; SHOULD-FIX and NITs queued as
  P8-posture-note / P8-posture-count). Picker needs self-review next FULL session. Not pushed.
- 2026-10-29 (scheduled, FULL): catch-up push `a8ff8391..651cd1b6`; P8-posture-note `73d9c5d9`, P8-posture-count
  `9e2083f5` (tsc clean, targeted 163/163, both fixes' tests proven failing on old code, full vitest 523/526 -
  site-app env only; TS display logic, no review). New item P8-posture-stale-copy. Self-review of the P8
  picker + headline owed (needs desk build). Log trimmed to the newest 14. Not pushed - owner back at the PC before landing (preflight idle 0 s);
  next FULL session pushes.
- 2026-10-29 ~15:45-16:30 (scheduled, CODE-ONLY, owner playing PBZ): P8-posture-stale-copy `53514506` (fix
  `35e39a0a`); tsc clean, targeted 170/170, i18n/copy guards 40/40, bench test proven failing on old code; TS
  display copy, no review. Leftover train-p6nextf2/p7notify/p7route/p7severity folders hold only site-app
  residue, no commits. Log trimmed to the newest 14. Not pushed (CODE-ONLY); next FULL session pushes.
- 2026-10-29 evening (scheduled, CODE-ONLY, owner playing PBZ): P9-hz `f1bfbb26` (display mode worded with Hz on
  four lines); tsc clean, targeted 240/240, census/i18n/copy/data guards 64 files / 516, the bench context test
  asserted the old raw mode. TS display only, no review. P5-realplay left for an interactive/FULL session (Rust
  + review, no cargo mid-game). One item only. Not pushed (CODE-ONLY); next FULL session pushes.
- 2026-10-30 (scheduled, CODE-ONLY, owner in Aniimo): P4-noise-copy-2 `a2437af7` (merge `fcb18d43`) and
  P4-cap-note `42f8e04a` (merge `9234ff98`); tsc 0; vitest bench + i18n/locale/copy set 10 files / 190, exit 0;
  both proven failing on old code (3 and 2 tests). TS copy only, no review needed. Cap line self-review owed
  at next FULL desk session. Not pushed.
- 2026-10-30 ~16:30 (scheduled, CODE-ONLY, owner playing WARDOGS): P9-target `97ebbf7f` (merge `6e4224c9`);
  tsc 0; 21 files / 318 tests, exit 0; debrief test proven failing on old code (run after the commit). TS
  display only, no review. Rust items (P4-noise-stretch, P5-realplay) left for a session with no game running.
  One item only. Log trimmed to the newest 14. Not pushed (CODE-ONLY); next FULL session pushes.
- 2026-10-30 evening (scheduled, CODE-ONLY, owner playing WARDOGS): P9-settings-done `25feba43` (merge
  `a84ba5a7`); tsc 0; bench + helper + i18n/locale/copy/census guards 17 files / 275, exit 0; two bench tests
  proven failing on old code. TS display only, no review. Rust items left for a session with no game running.
  One item only. Log trimmed to the newest 14. Not pushed (CODE-ONLY); next FULL session pushes.

## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] **P2-exit** Phase 2 owner-rig exit (#453): four screens agree live on desk build `2afd7471` (2026-10-24)
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
