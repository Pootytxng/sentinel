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
- [x] **#622-f2** `4edfbb0e`: Health single column below 1240 px (two-column panel first fits at 1232); Live row
      timeline >= 120 px. Measured at 720 px tall only.
- [x] **#638** Phase 2 follow-ons from PR #634. Lands with this log entry (Optimize can't-confirm group, History tile title).
- [x] **GB-picker** `e0160644`: not a bug — Game Bar already off in Windows (AppCaptureEnabled=0, GameDVR_Enabled=0),
      now shown as "Already set this way in Windows, not by Compy".
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
- [ ] **P4-show-f2** (desk) Check the overlay still shows and stays click-through with `focusable:false`.
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
- [ ] **P4-smooth-offer** Offer Smoothest for a game once `between_session_pacing_noise` (p99/p50 band) is measured for it; judge against that band (ratios carry ~±1% bucket error: a spread under ~2% is at the resolution limit).
      Scoped 2026-10-27 (skipped for P7-depth: not one bounded session). Split before starting: **-a** (Rust,
      measurement; review: one Rust agent) `experiment.rs` `start_experiment` admits "smoothest" only when
      `between_session_pacing_noise` is `Some` for the game, and `conclude` judges the treatment's p99/p50
      against the baseline's beyond that band (floor 2%); verdict rows record the band used; unit tests for
      admit/refuse and improved/no-change/regressed at the band edges. **-b** (TS) the bench's Smoothest option
      reads a new read-only field from `get_trial_candidates` (or the gate) saying whether it is measured for
      this game, and its "held" reason names what is missing; `ExperimentBench.test.tsx`.
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
- [ ] **P7-palette** The command palette understands plain problems ("it stutters", "it crashed", "more fps",
      "what changed"): intent items reuse the interview finding actions from P7-route, so typing a symptom
      lands on the same journey as answering it. `command-palette-data.ts`, `CommandPalette.tsx`. Needs
      P7-route. ROADMAP P7 bullet 1; Constitution §27.
- [ ] **P7-rig-limiter** The Home rig picks out the part the answer is about: the #1 limiter maps to a rig part
      kind (`rig-parts.ts`), `RigHologram` highlights it through its existing `selectedId`; a limiter that is a
      setting or software dims the parts and says the evidence points away from hardware. `HomeConsole.tsx`
      stage, `rig-parts.ts`, `RigHologram.tsx`. Needs P7-score (HomeConsole). ROADMAP P7 bullet 4;
      Constitution §24.
- [ ] **P7-rig-care** Same on the Care station: the incident's faulting part (GPU driver -> GPU, memory error ->
      RAM, app crash with no hardware sign -> "not hardware") drives the Lab rig (`LabConsole.tsx`
      `RigViewer`). Needs P7-rig-limiter. ROADMAP P7 bullet 4; Constitution §24, §25.
- [ ] **P7-exit-proof** (owner, FULL) The friend goes from Home to an answer on "more FPS", "it stutters" and
      "it crashed" without asking what a word means; the owner opens the technical layer on each and finds the
      exact setting, measurement and source. Record in BACKLOG as the Phase 7 exit. Needs P7-route through
      P7-teach; P7-palette and the rig slices do not block it. ROADMAP P7 exit.

### Before deadlines
- [x] **fflate** 0.6.11 `53a1c9de`; dev-only body-parser/zod advisories cleared (shadcn 4.22.1) `89fc1add`.
- [x] **tokio** `fcc64291` (1.54.1; only tokio's lock entry changed). Desk install at the next ship.
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime` (FULL mode only), update
  `RELEASE_STATE.md` in the same commit, report what is visible, and summarise the week from the Session log.

## Session log
- 2026-10-25 morning: P4-recommended `a86fbcf5`.
- 2026-10-25 morning: P4-rank `8f1169ca`, #622-f2 `4edfbb0e`.
- 2026-10-25 midday: P4-next `abd4c883`.
- 2026-10-25 midday: P4-maxfps `baa03405` (Smoothest held).
- 2026-10-25 afternoon: P4-exit code `e3d0420e`.
- 2026-10-25 ~06:39 desk install of main `f6736154` (stamp-proved, attempt 1; installer 21B647B4…EDB940) so the
  owner's Phase 4 Trial runs use the new engine; RELEASE_STATE recorded.
- 2026-10-25 morning: P5-guided `2f33cc6b`, P5-rebaseline `a0da7bbb`, P4-comparable-show `78b908c3`;
  owner's first live Aniimo Trial (visual-effects): too noisy (baseline 293->241 fps), restored, verified.
- 2026-10-25 late morning: P4-smooth-measure `df01e252`.
- 2026-10-25 midday: P5-continue `61e7539e`.
- 2026-10-25 afternoon: layout harness flake fix `f904c658`, P5-enough `b28e188c`.
- 2026-10-25 afternoon: P5-learned `a5836783`, P5-resume `b285dc73`.
- 2026-10-25 ~11:55 desk install of main `7aa8e810` (stamp-proved, attempt 1; installer 02AC5E76…F21814) so the
  owner gets the Phase 5 guided journey and the Phase 6 "Changed before this" crash view; RELEASE_STATE recorded.
- 2026-10-25 ~14:45 desk install of main `9712572d` (stamp-proved, attempt 1; installer D945743C…F3D6FC) so the
  owner can run the Phase 6 exit proof; RELEASE_STATE recorded.
- 2026-10-26 (scheduled, CODE-ONLY, owner on PC): P7-severity `2ba1f70c`, P6-next-f2 `142b769b`
  (review fixes `aa762687`; new tests fail on the old code); tsc 0, vitest 152/152; not pushed.
- 2026-10-26 ~12:20–13:15 (interactive from Claude HQ, CODE-ONLY, owner on PC): P4-exit-truth `8e8370a0` (the
  2026-10-26 critical review's reproduced completion/staleness defect); tsc 0, vitest 255/255 across 13 files
  on the desk; one review round, all findings fixed (details under the item); not pushed.
- 2026-10-26 afternoon (scheduled, CODE-ONLY, owner on PC): P7-route `9fefbf6d` (resumed parked worktree;
  TS-only, no Rust); tsc 0, full vitest 521 files / 9312 passed; visual self-review owed; not pushed.
- 2026-10-26 ~19:35–20:40 (interactive from Claude HQ, CODE-ONLY, owner on PC): P4-exit-truth-f1 2af5f7e2
  (the follow-up review's five findings); tsc 0, vitest 21 files / 466 passed on the desk; one review
  round, all SHOULD-FIXes taken; not pushed.
- 2026-10-27 ~00:05–01:20 (interactive from Claude HQ, CODE-ONLY, owner on PC): P4-exit-truth-f2 38e31fa0
  (the third review's four gaps + combination matrix); tsc 0, vitest 21 files / 475 passed on the desk;
  one review round, MUST-FIX + SHOULD-FIXes taken; not pushed.
- 2026-10-27 ~02:30–03:40 (interactive from Claude HQ, CODE-ONLY, owner on PC): P4-exit-truth-f3 3de75240
  (the fourth review's alternating-retest defect + three wordings; zh-CN mojibake repaired); tsc 0, FULL
  vitest on the desk 521 files pass + `encoding-guard` green after the tick commit's repair; one review
  round, MUST-FIX + 3 SHOULD-FIXes taken; not pushed.
- 2026-10-27 ~03:30 (interactive from Claude HQ, CODE-ONLY, owner on PC): verification receipt for the
  final tree `ac58379a` (fifth review asked for one clean full-suite run, no code): tsc exit 0; FULL vitest
  521 files / 10020 tests passed, exit 0, 157 s; clean checkout. Not pushed.
- 2026-10-27 ~06:50–07:20 (interactive from Claude HQ; owner waived the FULL idle rule for this run and
  left the desk free): catch-up push `cdf0c2d8..71b8e1b9` (pre-push gate passed); `npm run tauri build`;
  `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit 71b8e1b9…` → runtime proof
  `71b8e1b9 · release · shell 0.9.26`, attempt 1, installer SHA-256 A7E858DA…80EBE, one installer on the
  Desktop; self-review on the installed app (CDP capture 1620×867, midnight/#a78bfa): VERDICT PASS — headline
  "1 result on Aniimo needs another run before it counts: couldn't be judged last time.", retest row agrees,
  context line "Last recorded context (10/25/2026): …"; no raw keys, no mojibake, nothing clipped; debug
  port put back (no-debug-port CLEAN). Not seen live: the dark-bench Home sentence (this PC's bench is
  armed; unit-tested only). Noted, not changed: display mode shows "@250" without a Hz unit (pre-existing).
  RELEASE_STATE row + anchors updated (verify-release-state: 0 state-drift). Walkthrough-ready; pushed.

- 2026-10-27 ~07:20–08:20 (interactive from Claude HQ, CODE-ONLY, owner playing): P7-depth `7530677e` (feat
  `4306036b`); P4-smooth-offer scoped and split (-a Rust / -b TS), not started; tsc 0; FULL vitest on the
  desk 522 files / 10699 tests, exit 0; one review round, 3 MUST-FIX + 5 SHOULD-FIX taken; visual
  self-review owed (FULL). Not pushed.

- 2026-10-27 ~08:40–09:10 (scheduled, CODE-ONLY): P7-notify `890e71bb` (feat `687551d1`), resumed from the
  parked worktree onto `379ac51b`; cargo test --lib 1644/0, clippy -D warnings clean; Rust review 2 rounds,
  1 MUST-FIX + 3 SHOULD-FIX taken in-item, round 2 PASS. Stale non-worktree folders train-p6nextf2,
  train-p7route, train-p7severity left untouched (items already landed). Not pushed.
- 2026-10-27 ~11:35–12:45 (interactive from Claude HQ, CODE-ONLY, owner on PC): P7-depth-verdicts `a0c008bd`
  (feat `e43ffe78`); tsc 0; FULL vitest on the desk 522 files / 10032 tests, exit 0; one review round
  (APPROVE + 4 SHOULD-FIX taken); visual self-review owed (FULL). Not pushed.
- 2026-10-27 ~12:45–13:20 (interactive from Claude HQ, CODE-ONLY, owner on PC): P7-jargon `a49b2128` (copy
  `94000540`); tsc 0; FULL vitest on the desk 522 files / 10032 tests, exit 0; copy only, no review round.
  Not pushed.
- 2026-10-27 ~13:20–14:20 (interactive from Claude HQ, CODE-ONLY, owner on PC): P7-confidence `f0fd750d` (feat
  `7b55540b`), FULL vitest 523 files / 10708, exit 0, one review round (APPROVE + SHOULD-FIX taken);
  P7-score `d2f5b002` (fix `81ccb193`), FULL vitest 523 files / 10709, exit 0. Visual self-review owed (FULL).
  Not pushed.
- 2026-10-27 ~12:00–13:00 (interactive from Claude HQ, CODE-ONLY, owner on PC): P7-teach `d501a659` (feat
  `3fb653a3`, fix `7d0eae04`), landing gate r18 caught an a11y-census gap and a Care next-step flake → `3801b499`,
  merged `ab2cdda8`; r19 FULL vitest 523 files / 10724, exit 0, tsc 0. Lesson: run the a11y census guard in the
  touched set whenever src/design gains a file. Not pushed.

## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] **P2-exit** Phase 2 owner-rig exit (#453): four screens agree live on desk build `2afd7471` (2026-10-24)
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
