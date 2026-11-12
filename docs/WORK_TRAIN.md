# WORK_TRAIN.md — Compy's standing work queue

**Authority:** `OWNER_DIRECTIVE_2026-10-23.md` (owner decision). This file is the one queue the scheduled
work sessions pull from. It is execution order only; product direction stays in `PRODUCT_CONSTITUTION.md`
and `product/ROADMAP.md`, build/install truth in `RELEASE_STATE.md`.

**Testers (owner, 2026-10-23):** the owner and one trusted friend. No wider beta. Optimize for the owner's
rig first; anything shipped to the friend goes through the normal updater.
**No second tester now (owner, 2026-11-11 07:41, verbatim):** "I DO NOT HAVE ANY AVAILABLE FRIEND FOR TESTING SO
LEAVE ANYTHING LIKE THAT ONLINE". Friend-dependent halves of P5/P6/P7-exit-proof are deferred (notes under each).

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
- ~~**Old scheduled task** "#678 check-in 1/3…"~~ deleted 2026-11-04 03:14 by Claude on the owner's "yes please"
  (a one-shot reminder bound to a closed session, hidden from his task list; the delete needed his go-ahead).
- **The four exit walkthroughs** (P4–P7 below, all code landed; each closes only on your rig, next FULL session
  installs the build first): P4 — Test room, run Trials on WARDOGS (one tap each, ~10 min a session) until the panel
  says "Compy finished the supported tests"; P5 — Optimize, "Optimize my game", play, read the summary, no manual
  Trial clicks (~25 min); P6 — Home → "Something's wrong", follow a WARDOGS crash and a stutter to one next step
  (~5 min); P7 — your friend asks Home for more FPS, a stutter and a crash without asking what a word means (his
  ~15 min). Each is recorded in BACKLOG as that phase's exit.
- ~~**CR-1102-left owner calls**~~ all four taken 2026-11-11 (owner delegated 2026-11-10; coordinator took the
  recommendation); recorded under CR-1102-left in the Queue.
- **CR-unconfirmed-remedy** (2026-11-10 19:14): every Trial start is refused because Compy's two Ultimate-plan rows read
  off (your active plan is "Synez Power Plan"); Compy's suggested undo would set Balanced. Keep Synez (Compy then needs a
  code fix to stop tracking those rows), or let Compy put Balanced back (~1 min) so P4/P5 can run? *Keep Synez; fix the
  code.* Decided by the coordinator (delegated): keep Synez. Code landed `12a791d0` (2026-11-10, not yet installed): the
  refusal now offers a Keep "Synez Power Plan" button beside the undo; tapping it changes nothing on the PC. Then one new
  as-is session before the next Trial.
- **Upgrade block retail links** (P9-upgrade-block-reachable, 2026-11-12 s23): the Optimize room now shows the measured
  upgrade lines (GPU limiter / HDD) labeled early, with NO retail search links; the old card had copy-only Amazon-style
  search links (no affiliate tag). Bring the copy-only search links back to the room, or keep it link-free? *Keep it
  link-free* (Phase 9: retail economics never shape the answer; the measured lines stand alone).
- **P8-first-advanced** waits on P4's walkthrough (the gate is Trial + Risk proof), then your sign-off on the
  candidate Claude recommends.
- **Phase 9 Exit** (s24 finding under the Phase 9 heading): once P9-part-line-context and P9-no-session-plain-line
  land, count the Phase 9 Exit met on code + fixtures, with the live case inside P4-exit-proof? *Yes* (recommended).
- **Empty ledger while its health is unknown** (CR-footer-ledger-unknown, s24): Compy reads an unreadable change
  ledger as an empty list, so with the health check still running or failed the rail footer can say "Nothing in
  effect to undo · ledger 0". A standing guard (`ledger-health-home-guard.test.tsx`) requires unknown health to look
  exactly like a healthy ledger, so the footer can't say "not confirmed" there without changing that rule. Keep the
  rule as is, or allow "No changes listed · ledger not confirmed complete" for an EMPTY list only while health is
  unknown? *Keep the rule* (the health check is a fast local file read; an unreadable ledger is already named
  wherever it is known).

### Left for v1.0 (derived 2026-11-11)
Pointers only, from `product/ROADMAP.md` "What v1.0 means" (Phases 0-7 exited on the installed build + the A4
release checklist); no new rules.
- Phase exits not yet recorded: **P4-exit-proof** (owner call recorded as is under the item: ROB RUN substitutes for
  WARDOGS; last blocked on CR-unconfirmed-remedy, Keep "Synez" recorded 2026-11-11); **P5-exit-proof** and
  **P6-exit-proof** (owner half; the friend half deferred per the owner's 2026-11-11 07:41 statement, top of file);
  **P7-exit-proof** (friend-dependent half deferred the same way).
- `RELEASE_STATE.md` gates still OPEN, owner territory: code signing (`STATE:code_signing=open`), legal
  (`STATE:legal=open`).
- Unticked queue items: CR-1102-left (engineering lines), CR-gm-stop-busy, CR-fix-needs-trial-store,
  CR-range3-nits, CR-gm-restore-partial, CR-gm-repeat-live (FULL, UI), CR-ultimate-followups, CR-outside-followups (a)(d), and the four
  exit proofs above; P8-first-advanced waits on P4 (Phase 8, not needed for v1.0).
- CR-ultimate-identity: landed `ec326810` (2026-11-11 s19), not installed yet; follow-ups in CR-ultimate-followups.
- [x] **CR-trial-gm-between** (third range review, 2026-11-12) Establish first whether a Trial notices a Gaming Mode
  session started and stopped between its two sessions (it would confound the result).
  FINDING (s22, from the code): it did not notice Gaming Mode on for one session and off for the other. A Trial's
  confound paths are the Trust Ledger watermark and `other_compy_change` (Gaming Mode writes its own contract, never
  ledger rows) and `comparability::derive`, which compared GPU, RAM, display mode, driver, resolution, refresh,
  graphics API, game build, frame generation, Windows build, display and capture method, never Gaming Mode; each FPS
  session already recorded `gaming_mode_active` (any tick). A session that started AND stopped cleanly between the two
  put its settings back (same measured state); one whose restore failed or is pending keeps its file, so later
  sessions record Gaming Mode on and the difference is caught (an unparseable file reads off: residual).
  FIX (s22, SHAs in the merge): `derive` checks `gaming_mode_active` like the other conditions (both recorded and
  different = a changed condition, Partial; one side only = missing context), so the existing `with_comparability`
  fold makes such a Trial `confounded` and restores; no new mutation path; real-play's own Gaming Mode check now runs
  before the pairing so it keeps its specific reason; the pair receipt names it (en + zh-CN). Reviews r1 opus
  REQUEST-CHANGES (MUST-FIX: realplay reason order, taken) + sonnet APPROVE-WITH-NITS; r2 in the session log. Queued:
  CR-trial-gm-baseline-overlap.
- [ ] **CR-trial-gm-baseline-overlap** (r1 opus + sonnet SHOULD-FIX of CR-trial-gm-between) Gaming Mode on for BOTH
  sessions reads comparable, but a Gaming Mode session that set the Trial's setting during the baseline (e.g.
  game-bar-disable, sysmain-disable; trial_candidates.rs ~656/668) makes both sessions run the same state, so the
  Trial reads "no change" and puts the setting back as useless. Trial-side rule (not in `derive`): a baseline with
  Gaming Mode on, for a setting Gaming Mode can change, is confounded or missing context. Two reviews.

## Queue

### Now — finish what's open
- [x] **CR-zh-drift-count** (second whole-range review) zh-CN `home.json` driftCount strings still said "已漂移" after the English was reworded to "changed since they were last good" (`8d855c05`).
      Done `e49b53ed` (2026-11-11 s18, TS only, not installed): both read "{{count}} 项设置自上次正常以来已改变". Test fails on
      the old file. Full vitest 535/538 (the 3 site-app suites).
- [x] **CR-update-refusal-path** (second whole-range review) `update_refusal_words` (lib.rs) shows a folder path with the Windows user name: confirm it cannot reach an exported report, support bundle or support event.
      Checked 2026-11-11 s18, no change needed: `begin_update_restart` records its support event with a fixed sentence
      ("a Gaming Mode session still has changes to restore..."), never the words; the words return only as the command's
      Err to `use-update.ts`, which keeps them in React state for the Update pill and `console.warn`s them; nothing in
      Compy captures the webview console (no log plugin, no console hook) and `export_report` reads only backend stores.
- [x] **CR-undo-kept-plan** (second whole-range review) Undo after "Keep <plan>": the Undo confirm for a row recorded as changed outside must say that undoing switches the plan to the one Compy saved (name it), en + zh-CN.
      Done `d29d56ae` (2026-11-11 s18, TS only, not installed): App's rollback confirm for such a row says "You chose to
      keep <plan> ... Rolling back switches your power plan to <saved>, the plan Compy saved before it changed anything":
      named from the row's snapshot GUID (a Windows stock plan by name; the kept plan when it is the same GUID, "so your
      plan stays the same"; otherwise "Compy didn't save its name"). Rollback unchanged. New test (module did not exist
      before); tsc 0, full vitest 534/537 (the 3 site-app suites).
- [x] **CR-next-moved-outside** (second whole-range review) `trialMovedSince` (GuidedJourney.tsx) did not count `changed_outside.recorded_at` as a move, which the start's §3 check does, so the next-test offer could under-promise.
      Done `93f679f3` (2026-11-11 s18, TS only, not installed): `trialMovedSince` takes the ledger rows (the bench's reload
      reads `get_applied_changes`; unread counts as moved) and counts a record written after the as-is session began, or
      undated. Test fails on the old helper. tsc 0, full vitest 533/536 (the 3 site-app suites).
- [x] **CR-capture-superseded** (second whole-range review) A capture start skipped because a later stop won still answered Ok (monitoring.rs `start_fps_capture_ticketed`).
      Done `ce9d2c9e`, `e5df46fe` (2026-11-11 s18, not installed): the superseded answer is read under the capture lock:
      Ok when a newer start left capture on, Err `capture-superseded` when a newer stop left it off. The journey's
      measured session says "Compy couldn't start measuring" and, for any refused start, owns no capture to stop;
      Benchmark, Monitor and Play already show the next poll. Start/stop behaviour unchanged. Tests fail on the old code
      (Rust superseded answer; TS journey line). cargo 1839/0, clippy clean, tsc 0, full vitest 532/536 (3 site-app
      suites + the overlay Chromium launch flake, passed on rerun). Sonnet APPROVE-WITH-NITS, no MUST-FIX; SHOULD-FIX and
      the shared-words NIT taken.
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
- [x] **GL-empty** (glass redesign, landed 2026-10-31) Self-review the new pages in the states the owner's data
      never shows, before the redesign reaches testers: Health with no measured game, no readiness read and no Care
      record; Games empty; Problems on a clean scan; the Look panel under Frosted and Solid. Round 1 and round 2 judged
      only his live data (8 games, a pending "tail" record).
      Done 2026-11-02 in the stubbed cloud harness: round 1 found 7 (copy claiming a read nobody made, a second
      empty block, notes and a tag on the wrong tokens, no mask under Solid, a Benchmark link meant for Live), fixed
      in `6d99f36c`; then one first-run demo at a time across remounts `59df7cb7`, and a recorded but unmeasured
      game never called measured `3b542b0a`; round 2 PASS. Installed in `1d53dfc8`.
- [ ] **CR-1102-left** (codebase review 2026-11-02 to 11-03, slices 1-8; fixed in `8f4037c1`..`508b200f`, `4465e74b`, `16479f4b`, `22d23584`..`cd9e11c0`)
      Triaged 2026-11-10 (coordinator desk session). Already fixed on `main`, struck: the Trial delta on a 0/NaN
      baseline (`4d5595fd`), Black Box/export/capture start and the slow probes off the UI thread (`9cab29d0`,
      `25af5dc5`), a silent Care state (`e77fba1e`), a stopped service read as Compy's (`c5523543`), English-word
      power/parking/bcdedit reads (`5e2a110d`; the Ultimate apply stays CR-ultimate-identity), the GPU picker
      (`7e697609`), zh-CN GPU labels and lessons (`eddf6c7e`), the tour on a rejected scan (`a60b8068`), the first-DXGI
      vendor (`0f0cb0ba`), the ring note (`5e8cf37a`), Live's floored durations (`8be87e12`), "Fixed at 0-0 MB"
      (`258b438f`), VBS configured-not-running (`b2ed0cca`), dual-channel (`ad5074ac`); earlier: the `.corrupt`
      overwrite (`c127ce9`, `14d39b5`), the waiting comparison (`e01561f7`), "measured together" (`8ef5772`), one peak
      GPU sample (P9-bottleneck-sustained). Four owner calls moved to **Needs owner**. Still open, engineering, none
      a one-session fix: one ledger row a downgraded build can't parse fails the whole ledger; a partial batch apply
      carries no flag over IPC; nothing stops a double apply of one change; Care's first-ever scan seeds an empty
      world when its readers fail; a crash's vitals come from the whole capture window, not the game's own; a wedged
      old FPS helper can clear the new one's running flag (`monitoring.rs` stores `helper_running` false on any exit;
      gating it on the generation would leave it stuck true after a failed relaunch, so it needs a live-helper
      count); App's banner wiring and refresh guard are tested through helpers only (no App render harness); a TCC
      NVIDIA card only NVML reports leaves a session's peak graded (the ungrade rule reads DXGI only); `elevate_and_wait` waits with no timeout while
      the ledger is locked (`actions.rs`); core parking flags any non-performance plan with minimum cores at 100;
      drive health and memory speed or channels never rank as limiters.
      Core parking done `750b6034`, `0f6b6c4e` (2026-11-11 s16-s18, leftovers.rs only, read-only, not installed): 100%
      is flagged only on the stock Balanced plan (class, or the words for an older probe without a class); custom,
      vendor and unread plans are not flagged. cargo `leftovers::` 27/0, clippy clean; sonnet APPROVE-WITH-NITS, no
      MUST-FIX; SHOULD-FIX (stale comments, test name) and the legacy custom-plan case taken.
      Owner calls taken (owner delegated 2026-11-10; coordinator took the recommendation): a drift notice whose check
      now reads unknown stays, worded "last seen changed; Compy can't read it now" — done `8d855c05` (2026-11-11,
      CODE-ONLY, not installed; drift.rs re-emits it with `unreadable_now`, state unchanged; Home's count reads
      "changed since they were last good"; cargo 1830/0, clippy clean; sonnet APPROVE-WITH-NITS). A leftover
      `gaming-session` temp file keeps refusing update and restart, but the refusal names the file and its folder and
      offers Recover — done `98e9f129` (2026-11-11, CODE-ONLY, not installed; `pending_contract_files`, same fail-closed
      check; Recover shows App's existing recovery banner, or says Compy can't read a session from that file; no new
      command; sonnet APPROVE-WITH-NITS, SHOULD-FIX taken). Real play whose look decided but which stopped on another
      Compy change or a changed condition is put back, as a confounded Trial is — done `7b69b33a` (2026-11-11,
      CODE-ONLY, not installed; `real_play_outcome` folds it to `confounded`, keep false, through `with_compy_state`
      / `confounded_by_conditions`, so `finish_conclude`'s existing restore of the Trial's own change runs; "Close
      this test" says it keeps nothing; reviews opus r1 APPROVE-WITH-NITS, r2 APPROVE-WITH-NITS; sonnet r1
      APPROVE-WITH-NITS, r2 APPROVE; no MUST-FIX; SHOULD-FIX keep-forced-off and the note nits taken; same-setting
      later row queued as CR-rp-same-setting-row). After the one-time consent, newly ticked UAC tiers and service
      suspends ask once, naming only the new ones — done `ff19db9a` (2026-11-11, CODE-ONLY, TS only, not installed;
      agreed extras in `compy_gaming_consent_extras_v1`, the same modal tree, tier boxes shut while it is open; only
      adds a confirm; reviews opus r1 APPROVE-WITH-NITS (SHOULD-FIX taken), r2 APPROVE-WITH-NITS; sonnet r1
      APPROVE-WITH-NITS, r2 APPROVE; no MUST-FIX; held-Enter nit queued as CR-gm-confirm-repeat).
- [x] **CR-vbs-row-truth** (whole-range review 2026-11-10, SHOULD-FIX) Diagnostics "Memory Integrity / VBS turned on" reads a definite "No" when the registry values are absent (VBS on by default/policy), beside "VBS running now: Running"; say "Not set in registry" instead. Read-only.
      Done `13f46833`, `d8ab513d` (2026-11-11, CODE-ONLY, not installed): the row reads a separate tri-state
      `memory_integrity_or_vbs_configured` (lib.rs; local DeviceGuard keys plus the Group Policy keys, a written policy
      wins): nothing written → "Not set in registry"; written off beside Device Guard Running / turned on → "Off in
      registry (Windows reports it on)". The rec engine's bool is unchanged. Test fails on the old yes/no. Reviews
      (sonnet) r1 APPROVE-WITH-NITS (policy precedence, turned-on-not-running: taken), r2 APPROVE-WITH-NITS (queued
      below). Owner's rig writes both local keys = 1, so it still reads "Yes".
- [x] **CR-vbs-local-eq1** (r2 SHOULD-FIX of CR-vbs-row-truth) `combine_vbs_switches` counts any non-zero local value as
      on where the rec engine's bool needs `== 1`; use `== 1` for the two local keys (non-zero stays right for policy HVCI 2).
      Done `c22641a7` (2026-11-11, CODE-ONLY, read-only, not installed): `vbs_configured_from` maps the local keys to on
      only at 1 before combining; policy unchanged. New asserts in diagnostics.rs fail on the old code.
- [x] **CR-rp-same-setting-row** (r1 SHOULD-FIX of owner call a, opus + sonnet; pre-existing on the two-session confound
      path) When another Compy row applies the Trial's own setting while it runs, the confounded restore writes the
      Trial's pre-test snapshot and that newer row still reads "applied" while the setting reads off. Refuse a second
      apply of a change a running Trial holds, or settle the newer row with the restore (history.rs
      `rollback_change_inner`). Rollback boundary: two reviews.
      Done `186339f0`, `ae03363c` (cherry-picks of `3a64091a`, `c4033f99`; 2026-11-11 s18, not installed): the refusal
      option. The UI's `apply_recommendation` / `apply_recommendations_batch` commands go through experiment.rs wrappers
      that take the Trial store gate, read the store checked (unreadable refuses), and refuse before anything runs when
      an open Trial holds a named setting (a batch naming it is refused whole); otherwise the unchanged history apply.
      The benchmark trials use the same wrappers. Rollback code untouched. Reviews (s16) r1 opus APPROVE-WITH-NITS,
      sonnet APPROVE-WITH-NITS, no MUST-FIX. The s16 revert (`c66b4d25`) was a misattribution: the 2
      experiment-record-first guard failures came from the full vitest run on the CR-outside-followups (b) branch,
      which held this change plus (b)'s own history.rs refactor (`summarize_checked` and the `checked_summary` call
      moved); on this branch alone the guard is 49/49. s18: guard 49/49, full vitest 532/536 (3 site-app suites + the
      doc-truth wording of this note, fixed here), cargo 1836/0, clippy clean. Known cost: an unreadable
      `experiments.json` refuses plain applies too, saying try again. Queued: CR-bench-holds-setting, CR-gm-spans-trial.
- [x] **CR-bench-holds-setting** (opus SHOULD-FIX of CR-rp-same-setting-row; pre-existing) The benchmark tweak trial holds a
      setting for minutes and rolls it back from its snapshot; a UI apply of that setting meanwhile makes the same
      stale-"applied" row. The new refusal only knows experiment Trials (`benchmark_trial.rs` start_tweak_trial).
      Done `53c52905`, `9171bd8b` (2026-11-11 s19, CODE-ONLY, not installed): the tweak trial applies through
      `experiment::apply_for_bench_trial`, which under the Trial store gate marks the setting held (token per run) before
      the apply; a guard declared before the RollbackGuard releases it after the rollback ran, on every exit. The UI
      apply, batch, Trial keep and Trial start refuse a held setting before anything runs ("... is being measured by the
      benchmark right now ... Nothing was changed.", English like the Trial refusal). No new mutation path; rollback
      untouched. Reviews r1 opus APPROVE-WITH-NITS, sonnet REQUEST-CHANGES (MUST-FIX: Trial start unchecked, taken);
      r2 opus + sonnet APPROVE-WITH-NITS (prefix nit taken). cargo 1841/0, clippy clean, full vitest 535/538 (3 site-app
      suites). Queued: CR-bench-preapply-read, CR-bench-stack-hold.
- [x] **CR-bench-preapply-read** (r1 opus SHOULD-FIX + r2 follow-up of CR-bench-holds-setting; pre-existing) The benchmark
      applies without reading the setting first (only the Benchmark tab's mount-time list skips applied ones): over an
      already-applied setting it snapshots "on", so a Ledger undo of the older row during the measurement is put back on by
      the trial's rollback, and the "change off" baseline is wrong. Refuse in `apply_for_bench_trial` with
      `pre_apply_refusal(probe_rec_target(..))` under the gate, as `start_experiment` does; also consider releasing the
      hold only on a successful rollback. Rollback boundary: two reviews.
      Done `a2d49422` + r1 nits (2026-11-11 s20, not installed): `apply_for_bench_trial` reads the setting after the
      Trial and benchmark refusals (under the store gate when Trials are on) and before Gaming Mode's gate, the hold and
      the apply; only a setting that reads not yet changed is applied, otherwise "Couldn't apply the change: <why>" with
      nothing changed. Hold release left as is (both reviews agree: after a failed rollback the re-run now reads On and
      refuses; a hold that outlives the trial would make its own message false). Reviews r1 opus + sonnet
      APPROVE-WITH-NITS (taken: the test pins the `return Err`, a comment on the read's place; not taken: bench-specific
      status wording, a read-only check before the ~12 s baseline, a probe-coverage test for `APPLIABLE_REC_IDS`).
      Test fails on the old code. cargo 1866/0, clippy clean, tsc 0, full vitest 535/538 (3 site-app suites).
- [x] **CR-tip-see-through-2** (self-review FAIL, installed `a15986b8`, 2026-11-11 s20;
      `_train\view-1111c\03-live-combined-tip-hover.png`) The Live room's "14 Compy changes were on · combined effect" tip
      still shows the readings under it through its text although `.kl-tip` computes `rgba(14, 20, 27, 0.96)`. Likely
      cause: its ancestor `.mc-delta-tag` has `opacity: .85` (monitor-console.css:80), which fades the whole subtree,
      tip included, and makes a stacking context the later sensor strip can paint over. Fix the tag's dimming without
      opacity (text colour only), pin it in term-style-guard.test.ts, and re-capture with the tip open. TS/CSS; one review.
      Done `8c2566af` + r1 nits (2026-11-11 s20, CSS only, not installed): `.mc-delta-tag` dims its text with
      `color-mix(... 85%, transparent)` and sets no opacity; term-style-guard pins that the tag (the Term's only
      wrapper) sets no opacity, filter, transform, isolation or will-change, and fails on the old sheet. Review (sonnet)
      APPROVE-WITH-NITS (anchoring and wider property list taken). Full vitest 535/538 (3 site-app suites), tsc 0.
      NOT visually proven: the self-review PASS on the installed build (tip open, readings hidden) is still owed at the
      next install, with the rest of view-1111c (Optimize → Check session-hint shot, Test in zh-CN, panel heights at
      1280×720 and 1920×1080).
      Installed `0afbfb2c` 2026-11-11 22:54; self-review of `_train\view-1111d\` (real CDP pointer hover): the tip is
      opaque and readable (items 2, 4, 12 PASS); overall verdict FAIL on items 3 and 6, queued below.
- [x] **CR-live-changes-twice** (self-review FAIL item 3, installed `0afbfb2c`, `_train\view-1111d\02-live.png`) The
      Live room's Last-session card says "14 Compy changes were on" twice (`.mc-ev-changes`, MonitorConsole.tsx ~508,
      and the `.mc-delta-tag` Term ~599): render the count once, keeping the tagged one (it carries the tooltip). TS.
      Done (2026-11-11 s20, TS only, not installed; SHA in the merge): when the comparison's tag names the changes-on
      count of the same newest session, the readings strip leaves it out; with no comparison (or a background-only
      newest session) the strip still says it. Two tests; the duplicate one fails without the change. Visual PASS owed
      at the next install.
- [x] **CR-view-1111d-wording** (self-review FAIL item 6, installed `0afbfb2c`) (a) zh-CN Test room leaves the eyebrow
      date and the footer "Outbound: signed update check only" in English (`_train\view-1111d\11-test-zh-CN.png`);
      (b) "Applied & history — every change, undoable" (`06-test-applied.png`) while a changed-outside row has no undo
      (`07-test-history-changed-outside-row.png`); (c) the Live comparison tiles show unitless "▲2 ▲3 ▲4"
      (`02-live.png`) where History says "+2 fps vs last". Check whether each predates s20; en + zh-CN; TS.
      Done `d46b2603` + r1 nit (2026-11-12 s21, TS only, not installed; all three predate s20): the footer's outbound
      line goes through t() (zh-CN "对外连接：仅签名更新检查"; en unchanged), the Test, Health and HUD eyebrow dates
      use the app's language; the healthy-ledger summary reads "Applied & history — what Compy changed, and what you
      can undo"; the comparison cells read "▲2 fps", "▲3 fps", "▲4 spikes" (zh-CN "▲4次"). Review (sonnet)
      APPROVE-WITH-NITS (zh no-space spikes value taken). Tests fail on the old code (5 files). Left, same surfaces:
      LogbookTape/monitor-stack-profile times follow the OS locale; Session Stack "VS PREVIOUS ▲N AVG" has no unit;
      GamingMode `leftAloneLine` shows the backend's English step labels inside the zh-CN sentence (coordinator nit
      (d): its neighbouring change rows are English too, so not localized here). Visual PASS owed at the next install.
Third whole-range review (e29da54b..119d07f8, 2026-11-12, SHIP-WITH-FOLLOW-UPS, no MUST-FIX); do before more Phase 9:
- [x] **CR-gm-stop-busy** (SHOULD-FIX; `8bf4a2a9`, `4da520ea`) With Gaming Mode on, a Fix batch, Trial start or bench
      apply holds `SESSION_OP` through its UAC wait; Stop Gaming Mode or Recover then says "another Gaming Mode
      operation is still finishing", which is false and lasts until the prompt is answered. The user must always be
      able to stop or recover honestly, without reopening the start race `SESSION_OP` closes. Rollback/consent
      boundary: two reviews (opus + sonnet).
      Done `3664f460`, `f80082c2`, `2a83ea3f` + r2 nits (2026-11-12 s21, not installed; SHA in the merge): stop and
      recover take a new try_lock-only `RESTORE_OP` instead of `SESSION_OP`; start takes both (the start race stays
      closed); census entry + try_lock assertion. While a session holds the power plan, USB selective suspend and
      PCIe link power are held with it. While a stop or recovery puts changes back (a generation count sampled
      around each check's read), a change of a setting Gaming Mode can touch says "Gaming Mode is putting its
      changes back right now …". Busy words name the permission prompt. Reviews r1 opus REQUEST-CHANGES (MUST-FIX:
      a stop beside a waiting USB/PCIe change left the user's own plan changed with no record, taken), sonnet
      APPROVE-WITH-NITS (SHOULD-FIX taken); r2 opus + sonnet APPROVE-WITH-NITS (generation count, nits taken). Tests
      fail on the old code; they never call start() and read only a temp session dir. cargo 1871/0, clippy clean,
      full vitest 535/538 (3 site-app suites). What a user sees: Stop Gaming Mode and Recover work while another
      change waits on its Windows prompt.
- [x] **CR-fix-needs-trial-store** (SHOULD-FIX; `1a740e66`) An unreadable Trial store blocks every Fix apply and batch
      ("Compy couldn't read its Trial records right now… try again in a moment") with no way out. Establish
      reachability first; refuse only where an open Trial could hold the setting when that can be known; any refusal
      names the file and the recovery path; never let a Fix stack on a setting a Trial is measuring. Two reviews.
      Done `28292d57` + r1 (2026-11-12 s21, Rust words only, not installed; SHA in the merge). Reachability: a read
      error other than "not found" (another program holding the file, a permissions change, a non-file at the path)
      or a damaged file whose set-aside rename is blocked (it, or an earlier `.corrupt` copy, held open). Narrowing
      can't be known: a Trial start's ledger row carries no Trial link and a Pending start with no receipt is named
      only in the store, so the refusal stays (fail closed). Both refusals now name experiments.json in Compy's data
      folder (normally %APPDATA%\Compy, never the expanded path) and the way out: try again shortly, restart Compy,
      check the account can open it, then close Compy and move it aside (never delete it); any change a Trial
      recorded stays in Test → Applied & history, with its undo there when it has one. Gaming Mode's start says
      one reason, then those words whole. Reviews r1 opus REQUEST-CHANGES (no MUST-FIX; SHOULD-FIX: nested words
      at Gaming Mode's start, no way out for a lasting cause, both taken), sonnet APPROVE-WITH-NITS (same two);
      r2 opus + sonnet APPROVE-WITH-NITS (no absolute undo promise, "if the problem continues", taken). Left (opus
      r2 nit): a one-click Fix hands the store's words over without saying why a Fix reads the Trial store (the
      `load_store_checked()?` call shape is pinned by a guard). Tests fail on the old words. cargo 1872/0, clippy
      clean, full vitest 535/538.
- [ ] **CR-range3-nits** (a) `src/data/kept-outside-undo.ts` STOCK lacks Power saver (`a1841308-…`), so a Power saver
      prior plan reads "Compy didn't save its name": add it, en + zh-CN; (b) `history::rec_id_of_change` loads the
      ledger without `HISTORY_LOCK`: if that load can set a damaged file aside (a rename) unlocked, take the lock (and
      check `get_applied_changes`); (c) the dark stack trial applies through `apply_recommendations_batch` with no
      bench hold (benchmark_trial.rs ~534): add the hold before `stack_trial_gate` is ever enabled (supersedes
      CR-bench-stack-hold).
      (a)(b) done (2026-11-12 s21, not installed; SHA in the merge): (a) a saved Power saver plan is named ("Power
      saver" / "节能"); (b) yes, it could: a locked writer setting the damaged file aside and saving a new ledger
      between the unlocked read and its rename would have moved the NEW ledger aside. The lookup now only reads
      (`read_history_unlocked`: never renames; damaged or unreadable = an error, the undo stops before anything
      runs, the next locked load sets it aside). Not the lock: an apply holds it through its UAC prompt and this
      answers the UI's undo on the main thread. Tests fail on the old code. Review (sonnet) APPROVE-WITH-NITS. Left
      (park, needs its own design): the same unlocked load-with-set-aside is a class, not one function:
      `get_applied_changes` (History/Health views), `rec_is_active`, comparison.rs ~219, experiment.rs ~2189 and
      ~3751, intelligence.rs ~2398, machine_model.rs ~1470, trial_candidates.rs ~542; locking them would freeze the
      UI during an apply's prompt, and read-only views change how the quarantine is first noticed. The lookup's
      failure now records no `ledger_load` support event (the next locked load or view poll does), and its words
      for a damaged ledger say only "could not be read (parse …). Nothing was changed." (c) parked: `Held` is one (token, rec, title); the stack needs a set held under the store gate
      before its batch (an `apply_for_bench_stack` beside `apply_for_bench_trial`), and `held_now()` callers
      (Gaming Mode's start, `bench_refusal`) read one. Dark (`stack_trial_gate()` false), nothing reaches it today;
      two reviews when done.
From self-review view-1112a (installed `b27552f8`, 2026-11-12 s21; r1 and r2 FAIL, teardown CLEAN):
- [x] **CR-footer-reversible** (FAIL item 6, `_train\view-1112a\05-test-history-changed-outside-row.png`, `03-test.png`)
      The footer says "Every change reversible · ledger 84" (zh "每一项更改均可撤销") on every screen while a
      changed-outside row has no undo: the same over-promise CR-view-1111d-wording took off the Applied & history
      summary. Make the line true (no absolute), en + zh-CN; the incomplete-ledger branch stays as it is. TS.
      Done `52cd64de`, `02393901`, `57602f97` (2026-11-12 s22, not installed). Rows with no undo, from the ledger model:
      (1) applied rows that read off and were never undone (changed outside Compy, incl. a Keep-plan record): no Applied
      card, so no Undo; (2) live rows whose stored history resolves to no undo (no typed contract and no legacy
      synthesizer, or a snapshot that no longer parses), now `undo_contract` on the view (history.rs, read-only,
      `resolve_rollback`, the first step of every undo); (3) applied rows with no live check (older payload only).
      None are one-way cleanups (every apply writes a rollback contract); a kept-outside row whose live read is on again
      is an ordinary Applied card whose confirm names the plan it switches to. The footer now counts from
      `liveChangeGroups` (the Applied cards' groups): "2 changes can be undone · 1 changed outside Compy, no undo ·
      ledger 84" (zh "2 项更改可撤销 · 1 项已在 Compy 之外更改，无法撤销 · 台账 84"), "N have no saved undo", "N not
      checked", "Nothing in effect to undo" only when none of those; rows not read yet: "Ledger not read yet". A card
      with no saved undo says so and its Roll back can't run; App's rollback refuses such a row before the confirm.
      Affordance census re-recorded to retire `footerPre`. Reviews sonnet r1 REQUEST-CHANGES (MUST-FIX was a misread:
      the health hook takes any refresh key; SHOULD-FIX unchecked rows taken), r2 APPROVE-WITH-NITS (SHOULD-FIX taken).
      12 new tests fail on the old code. cargo 1874/0, clippy clean, tsc 0, full vitest 535/538 (3 site-app suites).
      Queued: CR-undo-entry-disable, CR-home-reversible-note.
- [ ] **CR-undo-entry-disable** (r2 NIT of CR-footer-reversible) Only the Applied card disables Roll back for a row with
      no saved undo (`hasUndo`); a rec's Roll back and the debrief's stay enabled and end in App's refusal. Share the
      disable and the reason line. TS.
- [ ] **CR-home-reversible-note** (same class as CR-footer-reversible) Home's Active changes card says "every one
      reversible from the ledger" (ledger-health-home-guard.test.tsx `REVERSIBLE_NOTE`); make it count from
      `undoTally` like the footer, en + zh-CN. TS.
- [x] **CR-hist-today** (`_train\view-1112a\04-test-applied.png`) History rows from Nov 11 6:14 AM and 4:19 AM read
      "today" at 00:35 on Nov 12: `Fix.tsx` `humanizeWhen` buckets by elapsed 24 h, not calendar day, and formats
      with the OS locale. Calendar days in the app's language; test fails on the old code. TS.
      Done `00f63468`, `7294db89` + r1 nits (2026-11-12 s22, not installed): `data/humanize-when.ts` counts local
      calendar dates (Date.UTC on the local y/m/d, so a 23 h / 25 h DST day is one day) and formats date and time in
      the app's language; those rows now read "yesterday · 6:14 AM" (zh "昨天 · 6:14"). Tests: just after midnight,
      month/year ends, DST-length days, zh-CN; the Fix History test fails on the old code. Review sonnet
      APPROVE-WITH-NITS (SHOULD-FIX taken: clock literals built from the same ICU; the language read stays the
      i18n singleton at render, which re-renders through useTranslation). tsc 0, full vitest 536/539 (3 site-app).
- [x] **CR-zh-backend-home** (`_train\view-1112a\14-home-zh-CN.png`) zh-CN Health shows backend English: the
      crash banner ("ROB RUN stopped working and closed — …"), the limiter title and body ("Power plan isn't
      performance-oriented …"), the last change's title ("Help Windows focus on your game") and "设为On".
      Establish which strings have a stable id to translate on the TS side; no invented translations of names.
      Done (2026-11-12 s22, TS only, not installed; SHAs in the merge). Established: stable ids exist for the
      incident kind tag (blackbox.rs `IncidentKind::tag`, 6 values), the ledger row's `applied_label` (history.rs, 11
      values) and the friendly headline (rec id, friendly-labels.ts); `data/backend-words.ts` translates those and,
      in zh-CN, composes the crash headline from kind + `app_label` + the stamp at its own offset, keeping Black Box's
      ", while <game> was running" clause; names are never translated; English keeps Black Box's sentence byte for
      byte. zh Home now reads "ROB RUN 已停止工作并关闭 — 11月11日 14:36" and "Compy 修改了 让 Windows 专注于你的游戏，
      设为开启". The limiter card is NOT done: its title and body are formatted in Rust (readiness.rs / priorities.rs)
      with the plan name inside; the readiness row carries a stable id + status + `value` (the plan name), so it can be
      keyed on the TS side: queued as CR-zh-readiness-words. Review sonnet r1 REQUEST-CHANGES (MUST-FIX taken: dated in
      the machine's zone, and the meta lines still used the English display date; SHOULD-FIX taken: the game clause);
      r2 in the session log. The zh band test fails on main's HomeGlass.
- [ ] **CR-zh-readiness-words** (CR-zh-backend-home finding) zh-CN Health's limiter card prints readiness.rs /
      priorities.rs English ("Power plan isn't performance-oriented", "Active plan "Synez Power Plan". A performance
      plan …"). Key each readiness check by (id, status) on the TS side with `value` (the plan or other name, never
      translated) as a placeholder, en mirroring Rust; unknown (id, status) keeps the Rust text. TS.
- [ ] **CR-plan-read-prompt-write** (CR-gm-stop-busy r1 opus SHOULD-FIX 3, pre-existing) Applies that read
      `SCHEME_CURRENT` before a UAC prompt and write it after (e.g. the CPMINCORES script, actions.rs ~4570) never
      took Gaming Mode's gate, so a session start or stop during the prompt changes which plan they write.
      Establish whether a live apply route reaches one first.
- [ ] **CR-bench-stack-hold** (r1 sonnet SHOULD-FIX of CR-bench-holds-setting) The DARK aggregate-stack trial
      (`stack_trial_gate()` false) holds nothing; before arming it, hold every setting it applies the way the tweak trial does.
      Superseded by CR-range3-nits (c).
- [x] **CR-gm-spans-trial** (opus SHOULD-FIX of CR-rp-same-setting-row; pre-existing) Gaming Mode snapshots Game Mode, Game
      Bar, the power plan, USB/PCIe and service suspends into its own contract; a session spanning a Trial's restore
      re-applies the Trial's change on stop, after the Trial reads Restored (`gaming_orchestrator.rs` ~409-455; experiment.rs
      never checks Gaming Mode state). Rollback boundary: two reviews.
      Done `d3aebc9e`, `0f0b6914`, `f45cd333` (2026-11-11 s19, CODE-ONLY, not installed): Gaming Mode's start reads the
      settings every open Trial and the benchmark's tweak trial hold (an unreadable Trial store refuses the start) before
      it writes its contract and skips those steps (never snapshotted, so never put back; each Trial rec moves the setting
      in Gaming Mode's own direction). A Trial start, the benchmark's apply and the outcome switch (keep and put back)
      refuse a setting a session contract on disk holds (an unreadable contract refuses), and hold Gaming Mode's
      try_lock-only operation gate from that check through their record and ledger write, so neither side can slip in
      between. Reviews r1 sonnet REQUEST-CHANGES (MUST-FIX: the start race, taken), opus APPROVE-WITH-NITS (3 SHOULD-FIX
      taken); r2 opus + sonnet APPROVE-WITH-NITS (guard-pairing test and census wording taken). cargo 1847/0, clippy
      clean, full vitest 535/538 (3 site-app suites). What a user sees: a Gaming Mode session during a Trial leaves the
      Trial's setting alone (one fewer line in its change list); a Trial start, keep or put-back while Gaming Mode holds
      the setting says "Stop Gaming Mode first. Nothing was changed." (English, like the other Trial refusals). Queued:
      CR-gm-spans-followups.
- [x] **CR-gm-spans-followups** (r1/r2 reviews of CR-gm-spans-trial; pre-existing or UI) (a) a quarantined
      `gaming-session.orphaned*` file alone blocks every Trial start with "Recover or end Gaming Mode first", which the
      user can't do: name the file (`pending_contract_files`) and say how; (b) a visible line in Gaming Mode for a step it
      left alone because a Trial is testing it (en + zh-CN); (c) an Aborted Trial whose restore failed still has its
      change live and isn't treated as held; (d) a plain UI apply/undo of a setting a session holds (pre-existing class);
      (e) `rec_of_label` lists the four services by hand: iterate a `KnownService::ALL`.
      (a) done (2026-11-12 s20, CODE-ONLY, Rust words only, not installed): an unreadable Gaming Mode record
      (orphaned, temp or other-version file) now refuses naming the file(s) and the folder, says this Compy can't put
      it back, and gives the way out (end it in the newer Compy, or check the setting and move the file aside, not
      delete it). Same fail-closed arms (`pending_contract_files`). Test fails on the old words. cargo 1861/0, clippy
      clean. Review (sonnet) APPROVE-WITH-NITS, SHOULD-FIX taken (move-don't-delete; dropped the recovery hedge, which
      can't fire for an unreadable file). Left: (b), (c), (d); (e) needs `KnownService::ALL` in actions.rs (mutation-gate
      file).
      (c)(d)(e) done `4da520ea`, `ba4be8f0` (2026-11-11 s20, not installed): the UI's apply, batch apply and undo (the
      undo command moved to `experiment::rollback_change`, same name; `history::rollback_change` unchanged and still
      what the Trial and benchmark restores call) refuse a setting a readable Gaming Mode session holds, through
      `plain_change_gate`, which takes Gaming Mode's try_lock-only gate only for settings a session step touches and
      holds it through the write. A session running in this Compy says "Stop Gaming Mode first"; one left from an
      earlier run or that didn't finish putting its changes back says to finish it in Gaming Mode ("Finish the last
      Gaming Mode session"), also for a Trial start. A record this Compy can't read doesn't refuse a plain change.
      (c) needs no code: an Aborted Trial has no automatic restore left, so a session puts back the same applied state;
      the later undo is (d). (e) `KnownService::ALL`. Reviews r1 opus + sonnet APPROVE-WITH-NITS (SHOULD-FIX taken:
      gate only touchable settings, disk tests, wording by session state); r2 opus + sonnet APPROVE-WITH-NITS (citation
      re-anchor taken). Tests fail on the old code (shape test proven failing). cargo 1865/0, clippy clean, tsc 0, full
      vitest 535/538 (3 site-app suites). What a user sees: during Gaming Mode, a Fix, Optimize apply or Roll back of a
      setting the session changed says "Stop Gaming Mode first. Nothing was changed." (English, like the Trial
      refusals). (b) moved to CR-gm-skipped-line.
- [x] **CR-gm-skipped-line** ((b) of CR-gm-spans-followups; UI) A visible line in Gaming Mode for a step it left alone
      because a Trial or the benchmark is testing it (en + zh-CN). Needs the skipped steps recorded on the session
      (additive `SessionFile` field, `gaming_session.rs`) and shown in GamingMode.tsx; one review.
      Done (2026-11-11 s20, not installed; SHA in the merge): the start records `left_alone` (the labels of the steps a
      Trial or the benchmark held, in step order; core always, USB/PCIe when opted in, a service when selected) on
      the contract before anything changes; additive, display only, never restored or read by stop/recovery; older
      files load with none and none isn't written. Both faces say, right after the honesty line, "Left alone because a
      Trial or the benchmark was testing it when this session started: <labels>." (en + zh-CN; muted label size).
      Reviews r1 opus + sonnet APPROVE-WITH-NITS (taken: past-tense wording, styling, one order in both faces, test
      cut at the end of `start`, the suspend gate read once). Tests fail without it. NOT visually checked: the line
      shows only during a session started while a Trial or the benchmark holds a setting; a self-review of it is
      owed when one is captured.
- [x] **CR-gm-restore-partial** (r2 opus SHOULD-FIX of CR-gm-spans-followups; pre-existing) A failed restore keeps the
      whole contract, including changes it did restore, so one step that always fails (a removed service or plan)
      leaves every setting of that session refused for Trials and plain apply/undo with no way out. Drop
      confirmed-restored entries from the kept contract, or give the RestoreFailed refusal a way out. Rollback
      boundary: two reviews.
      Done (2026-11-12 s22, Rust only, not installed; SHAs in the merge): a failed restore now keeps only the changes
      that did not confirm restored (Ok from `restore_one_change`, or an `ok` receipt under a successful elevation:
      the same rule that clears the whole contract), in apply order, tracked by reference (never by label); the batch's
      outcomes are zipped onto its staged changes; anything that can't be placed keeps the whole contract. No new
      mutation path; the reported error is unchanged. What a user sees: after a restore where one step keeps failing,
      only that step's setting is refused ("Finish the last Gaming Mode session"); the others can be tested and
      changed again. Reviews r1 opus (plan mode) APPROVE-WITH-NITS and sonnet APPROVE-WITH-NITS, no MUST-FIX; nits taken
      (dispatch-count assert, names, debug_assert); opus SHOULD-FIX (pre-existing: the power-setting restore's
      `powercfg` exit code is unchecked, so a failed restore can report ok) queued as CR-powercfg-restore-exit; sonnet's
      reader check done (only the hold checks, trial_candidates and orphan detection read `changes`; all want the
      remainder). Tests on a temp session dir with a forced decline (nothing reaches Windows); the integration test
      asserts the confirmed change is gone, which the old code keeps (not run against the old code: the pure test does
      not compile there). Gates in the session log.
- [ ] **CR-powercfg-restore-exit** (r1 opus SHOULD-FIX of CR-gm-restore-partial; pre-existing; rollback boundary) The
      power-setting restore (USB selective suspend / PCIe ASPM, actions.rs ~3651, and its batch line ~1034) runs bare
      `powercfg` with no `$LASTEXITCODE` check, so inside the batch's `try` a failed write still records `:ok` and the
      change counts as restored. Check the exit code in the restore path as #617 did for apply. Two reviews.
- [x] **CR-gm-service-suspend-rows** (r1 opus SHOULD-FIX of CR-gm-spans-followups; latent, no UI caller today)
      `suspend_known_service` records `service-suspend:<Name>` rows with the suspend Gaming Mode uses; the touch check
      doesn't know that id. Map it into `session_can_touch` and gate the command, or unregister it. Two reviews.
      Done `bdd77f41`, `4d7c157d` (2026-11-11 s20, not installed): `session_rec_of` maps `service-suspend:<Name>`
      (allowlisted names only) to the session's service setting, so the row's undo is refused while a session holds
      that service; the command the webview reaches is now `experiment::suspend_known_service` (same name), which takes
      `plain_change_gate` on history's own row id before history's audited suspend (unchanged). The first version
      gated inside history.rs and failed the store-lock-order guard (a static history → gaming_orchestrator →
      experiment path); moved, guard unchanged. Reviews r1 sonnet APPROVE, opus APPROVE-WITH-NITS (one row id taken);
      r2 opus + sonnet APPROVE-WITH-NITS (comment wording taken). Test fails on the old code. cargo 1868/0, clippy clean,
      full vitest 535/538 (3 site-app suites).
- [x] **CR-gm-confirm-repeat** (r2 NIT of owner call b, opus; pre-existing) Holding Enter on Gaming Mode's Start opens
      the consent modal, focus jumps to Enable (`autoFocus`) and key repeat presses it: either confirm can pass on one
      held key. Ignore repeated key presses on Enable, or focus Cancel first. TS only.
      Done `b3aa742a` (merge `97d0b032`, 2026-11-11 s16, CODE-ONLY, not installed): Enable cancels a repeated Enter/Space
      keydown; a fresh press or a click still confirms (both faces share the modal). The modal's title/intro now call
      t() with a literal key per side, which fixes the affordance census that failed on `e29da54b` (lost the two consent keys). Test
      fails on the old component. Reviews opus APPROVE-WITH-NITS, sonnet APPROVE-WITH-NITS, no MUST-FIX; nits taken;
      opus SHOULD-FIX (a live held-key check in WebView2) queued as CR-gm-repeat-live.
- [ ] **CR-gm-repeat-live** (opus SHOULD-FIX of CR-gm-confirm-repeat; FULL, UI) On the installed build, send a held Enter
      (CDP `Input.dispatchKeyEvent`, `autoRepeat: true`) to Gaming Mode's Enable: the repeats must start nothing, a fresh
      press must. jsdom never turns a key into a click, so only a live check proves WebView2 honours the cancel.
- [x] **CR-care-read-promise** (same review) Care's store-read failure says "it'll try again" but nothing re-reads; add a bounded backoff re-read and true final words (en + zh-CN); a save failing after unmount schedules nothing; an `opened:X` save-stopped clears when `dismissed:X` later succeeds.
      Done `6982832a` (2026-11-11, CODE-ONLY, not installed): `readFailed(again)` re-runs App's own read after 5 s /
      30 s / 2 min (`CARE_READ_RETRY_MS`; reset by a good read, cleared on unmount), then "…it'll check again when you
      open another page" (`app.careStore.readStopped`, en + zh-CN). Unmount clears every chain and drops late answers;
      a saved `dismissed:X` settles a spent `opened:X`. 5 tests fail on the old code. TS only, no review required.
- [x] **CR-capture-last-wins** (same review) `capture_serialized` is not FIFO, so start(pending) → stop → start can end off; stamp each request with a sequence at invoke time and skip one older than the newest applied.
      Done `a7aeee23`, `f37f550a` (2026-11-11, CODE-ONLY, not installed): lib.rs `off_main` takes a ticket
      (`capture_ticket`) before the blocking pool; monitoring.rs `capture_in_order` keeps the newest applied ticket in
      the lock (`CTL: Mutex<u64>`, LOCK_CENSUS updated, still "out") and skips an older request (a skipped start
      answers Ok). Replayed in all six lock orders: start→stop→start ends on, start→stop ends off; fails without the
      check. UI reach: narrow; toggles await start and gate stop on `fps.active`, but the journey's abort fires a stop
      while its own start may still be pending, and another room could then start. cargo 1829/0 (24 ignored), clippy
      clean. Review (sonnet) APPROVE-WITH-NITS, SHOULD-FIX taken as a code note: the ticket is taken when the command
      body first runs, so two invokes in the same instant on different runtime workers can still swap.

### Next — small visible slices (refill 2026-11-03: CR-1102-left's fixable lines + Roadmap Phase 9)
- [x] **CR-live-round** Live's session strip and the debrief floor a session's length (3h 28m) where History and
      Games round it (3h 29m): round to the minute above an hour everywhere, same rule as History.
      `8be87e12` (2026-11-03; written as `c8c2628e` by the 08:43 scheduled session, parked on `claude/train-live-round`
      when main moved under it, cherry-picked onto main by the HQ session): Live's list, Live console and debrief round
      above an hour; 3 tests fail on old code. Screen check owed at the next desk install.
- [x] **CR-tour-reject** The first-run tour sits on "Running checks" forever if the scan rejects: show the
      couldn't-read line and let the tour go on.
      `a60b8068` (2026-11-03): `useScan` lands the verdict phase on a rejected read and reports `failed`; the tour's
      check step, FirstCheck and Check say nothing was read (never "measured clean"), offer Try again, and FirstCheck
      writes no last-check record. en + zh-CN. Tests fail on old code: use-scan 2, setup-stepper 1, FirstCheck 1.
- [x] **CR-ring-note** Home's ring note with unread checks wraps past two lines at 1280x720: keep the unread count
      out of the ring note (it already has its own line below). Self-review at 1280x720 (FULL).
      `5e8cf37a` (2026-11-03): the note is the ratio alone; the Re-run band already names the unread and advisory
      checks in every state; with nothing graded both reasons stay under the not-yet ring. Screen check at
      1280x720 owed at the next FULL desk session (the owner was in WARDOGS).
- [x] **CR-zh-gpu** The GPU profile labels and the setup lessons are English in zh-CN: move them to the locale
      files, en + zh-CN.
      `eddf6c7e` (2026-11-03): `setup-steps.ts` takes a resolver (English stays the fallback, pure tests byte-identical);
      lessons, memory title, recap and tab blurbs under `home.setupTour.lessons|recap|tabBlurb.*`; GpuProfile's
      delta table reads `lab.gpuProfile.field.*` and On/Off. The CPU note drops "kernel driver" (plain-language
      guard). Tests fail on old code: setup-tour-locale 1, GpuProfile 1.
- [x] **P9-bottleneck-sustained** "The GPU was the bottleneck" (and its purchase links) from one peak sample over
      95%: require a sustained share of the session's samples, else say the GPU was busy at times. Measurement
      change: one review.
      `88f15e9` + r1 `3ed24a8` + r2 `14d39b5` (2026-11-03): each session records `gpu_load` (measured ticks that read
      a GPU usage, and how many sat at or above 95%; additive, older rows read as before); the limiter row and its
      retail links need at least half of at least 30 measured readings saturated, decided on the counts; otherwise
      "busy at times" with the share, "didn't record" for an older session, or "measured for only about N s, too
      little to say". Rust review r2 APPROVE-WITH-NITS, all taken. Known limit named in code: the usage is the busiest
      adapter's, as the peak always was.
- [x] **P9-software-first** Before any part is named as a limiter in a game summary, list the untested Trial
      candidates for that game first ("try these settings before any upgrade"); none left = today's line.
      `023da7d` (2026-11-03): `settings-done.ts` names the untested changes still worth trying ahead of any part,
      en + zh-CN; none left falls through to P9-settings-done's line. TS display only; tests fail on old code.

### Next — small visible slices (refill 2026-11-03 PM: CR-1102-left's fixable lines)
- [x] **CR-cmp-wait** A session under 600 readings (or with no frame reading) leaves an armed comparison waiting
      with no line saying why: the debrief names it, with both counts. `e01561f7` (2026-11-03, CODE-ONLY): quiet for
      the baseline session, another game, all-background or nothing armed; en + zh-CN; 2 tests fail on old code.
      Screen check owed at the next desk install.
- [x] **CR-gpu-picker** The GPU view's Global/Per-game picker changes nothing anything reads: remove it (wiring it
      is a feature, not a fix). Test: the picker is gone. Screen check at a FULL session.
      `7e69760c` (2026-11-04): picker, hook, store section, en + zh-CN keys and census entries gone; the section
      opens on the vendor notes and the delta card. Test fails on old code. Desk review: PASS (no radiogroup, two sections 12 px apart, nothing clipped at 1280/1500/1920, en + zh).
- [x] **CR-trial-zero-base** A Trial delta on a 0 or NaN baseline (older records) prints a number: show "—" and
      no verdict wording. Test with a 0 and a NaN baseline record. — `4d5595fd`
- [x] **CR-primary-gpu** App's and Home's walkthrough and tuning vendor come from the first DXGI adapter: take the
      primary GPU's vendor (the one the session peak already uses). Test with an iGPU listed first.
      `0f0cb0bb` (2026-11-04): both sites read `primaryGpu` (largest VRAM, what Home, Readiness and the hardware grid
      already name); test [Intel iGPU, Radeon] → amd plus a source pin on both call sites. Same answer on the owner's
      single-GPU rig. Desk review: PASS-same-data (one GPU on his rig; Tuning station and the AMD walkthrough variant render as before).
- [x] **CR-stopped-service** A service that is only stopped reads as Compy's change: read its start type and claim
      it only when the start type is the one Compy set. Rust, read-only; one review.
      `c552354c` (2026-11-04): one seam `history::disabled_service_check` over WMI `Win32_Service.StartMode` (Disabled →
      on; any other start type → off; no row → unreadable, never on — a missing service used to read as Compy's
      change); the catalog's currently_applied for the same four recs goes through it; suspend rows unchanged. Rust
      review APPROVE-WITH-NITS; cost stated (one WMI connection per read, see CR-service-batch). Desk review: PASS (SysMain ×2 and Windows Search rows read on, Windows reads them Disabled; DiagTrack, Disabled by his hand, reads applied with no Compy row; every screen agrees with `Get-Service`; `get_recommendations` 1.17 s with the WMI reads).
- [x] **CR-localized-reads** Power-plan, core-parking and bcdedit checks match English words: read GUIDs and
      numbers instead, so a localized Windows reads right. Rust, read-only; one review; test with zh-CN output.
      `5e2a110d` + review `aded8095`, `45a4b2d7`, `e3d3b7fd` (2026-11-04): `PowerPlanClass` from the scheme GUID (the three
      stock GUIDs are locale-fixed; a non-stock GUID still reads by the English words, as before) feeds readiness,
      the Ultimate probe and rec, and the leftovers excuse; the core-parking AC index reads by shape (one setting,
      five 0x lines, AC inside [min, max], the number from the token's last 0x) when the English label is absent;
      bcdedit flags read by their key, and a value word this build can't read is unknown → "couldn't be read", never
      clean or rotted. Fixtures keep the tools' SHAPE with labels in another language and say so: the repo holds no
      captured zh-CN output, so the claim is "no English word decides", not "zh-CN verified". Rust review r1
      REQUEST-CHANGES → all taken, cargo 1775/0, clippy clean. Not touched (actions.rs): see CR-ultimate-identity.
- [x] **CR-service-batch** (from the CR-stopped-service review) The four service-disable reads each open a WMI
      connection (~100-500 ms); a catalog build pays it up to four times in series, a Trial pass once per row. One
      batched `Win32_Service` read per pass (through `LiveReads`), and `SELECT State,StartMode` only. Rust, read-only.
      `3cdfc782` (2026-11-04, CODE-ONLY): one `SELECT Name,State,StartMode` for the four, made once per pass in the catalog
      build, the session-end notice and the pending reconcile; pre-apply and post-keep/restore probes still read fresh.
      Same answers; other service names keep their single read. cargo 1781/0, clippy clean; review r1 no blockers, both
      SHOULD-FIX taken (exact-query test, drift guard). Latency on his rig not measured yet (next FULL desk session).
- [x] **CR-ultimate-identity** (owner call + mutation-gate: `actions.rs`) `apply_power_ultimate` finds the Ultimate
      plan by its English name and otherwise duplicates it under a NEW GUID with a localized name, which then classes
      as Other: on a localized Windows the rec reads off after a successful apply and the verify can fail. Record the
      applied scheme GUID on the receipt (an AppliedAction/Snapshot change) or compare against the duplicate's source.
      2026-11-11 s18 PARKED after two review rounds on `claude/train-ultimate-identity` (`6b047ef7`, `e029ffeb`,
      `d7ee1557`, `a8559fe2` re-anchor; cargo 1845/0, clippy clean, full vitest 535/538; NOT landed).
      Design: `AppliedChange.applied_plan {schema 1, guid}` (additive, lenient, skipped when None, outside the rollback
      contract); the receipt records the scheme active after the Ultimate apply (read-only `/getactivescheme`) when it is
      not the saved prior; `changed_outside_refusal` refuses that GUID; a row without one is recordable only when
      `powercfg /query` settings say the live plan is not an Ultimate-template copy (unknown refuses). Reviews: r1 sonnet
      APPROVE-WITH-NITS, opus REQUEST-CHANGES (edited copy; query under the lock; read-back would abort a localized Trial at
      conclude: read-back change withdrawn in r2); r2 sonnet APPROVE-WITH-NITS (receipt reads have no timeout), opus
      REQUEST-CHANGES. Blocker (opus r2 MUST-FIX, measured on the dev PC): `powercfg /query e9a42b02-...` exits 0 but prints
      `UNKNOWN` for every AC/DC index when the template isn't in `/list`, so the settings comparison answers "not a copy"
      (Some(false)) for every plan: a pre-fix row's localized copy is recordable as external again and new rows never
      stamp a localized copy. Next design (opus r2): an unreadable template (any UNKNOWN / length mismatch) is None; record
      the GUID by provenance (read `/list` GUIDs before the apply; stamp the plan active after it if Ultimate-class or not
      in that list); a row without a GUID is recordable only on a Windows stock non-Ultimate scheme by GUID; take the
      receipt reads off `lock_history` or bound them; test on real-shaped output (UNKNOWN template). Then both reviews.
      Done (2026-11-11 s19, CODE-ONLY, not installed) `f491ae6b`, `725be922`, `a5804b7f` + this tick, on top of the parked
      commits: the settings comparison is gone. Stamping by provenance: the Ultimate apply reads `powercfg /list` before
      it runs; the receipt stamps the plan active after it when that plan is Ultimate by class or was not in the list (one
      label-free read). Rows from before the fix (no stamp): a NEW "changed outside Compy" record only on Balanced, High
      performance or Power saver, which no copy can be; otherwise "Compy made this change before it kept a record of which
      plan it switched to ... Undo the change instead, or switch to a standard Windows plan ... first". A copy stamped for
      any row is never recordable. Every powercfg receipt read is bounded (5 s). Owner's ledger: his two Ultimate rows
      recorded with Synez stay recorded and still let a Trial start while Synez is active (test); a new record for them on
      another non-stock plan is refused (the code can't know Synez isn't Compy's copy: no pre-apply plan list was stored).
      Nothing in apply/rollback writes changed; `applied_plan` additive and lenient. Reviews: r3 opus + sonnet
      APPROVE-WITH-NITS (SHOULD-FIX taken: any row's copy, one localized read, wiring tests, re-anchors); r4 opus + sonnet
      APPROVE-WITH-NITS (test bound + gap comment taken). cargo 1857/0, clippy clean, full vitest 535/538 (3 site-app).
      Queued: CR-ultimate-followups.
- [ ] **CR-ultimate-followups** (r3/r4 reviews of CR-ultimate-identity; pre-existing) (a) the row's live check
      (`recommendations.rs` / `probe_rec_target` "power-ultimate", class only) still reads a stamped localized copy as off:
      use `compys_plan_guid`; (b) `actions::current_power_plan_guid` keys on the English "GUID:" at the apply's snapshot
      step (actions.rs, mutation gate); (c) a copy no row stamped (old row or a timed-out read) that the user re-activates
      can be recorded on a stamped row; (d) out-of-order undo can restore Compy's own copy as a prior; (e) the 5 s timeout
      test sleeps 7 s: inject the timeout.
      (a)(e) done `fef0a937` + r1 nits (2026-11-11 s20, not installed): a power-ultimate row that recorded the plan Compy
      activated reads On on that plan (`check_row_state` through `is_compys_ultimate`), so History, Health, readiness and
      the Trial's unverified-others check stop reading Compy's own localized copy as off; rows without the record read
      by class as before. The hang test injects a 100 ms bound (`bounded_read_within`); production keeps 5 s. Read-only;
      apply/rollback writes unchanged. Reviews r1 opus + sonnet APPROVE-WITH-NITS (taken: doc, looser timing bound).
      Test fails on the old code. cargo 1867/0, clippy clean. Left parked: (b), (c), (d) (they change what apply,
      record or rollback write), and (f) from r1: the setting-level Ultimate reads (`recommendations.rs:456`,
      `probe_rec_target`, and the undo read-backs through `check_change_state`) still read the copy by class, so the
      Optimize card and a Trial's reads of its own setting still say "off" on a localized Windows (fails safe:
      unjudged); route them through the newest applied row with (b)-(d), two reviews.
- [x] **P9-hint-shown** (desk review 2026-11-03) `get_priorities.session_hint` (the "GPU busy at times / sustained"
      sentence) reaches the frontend typed but no screen prints it. Decide: show it on Home or Optimize under the
      limiter rows, or drop the field. Code + one test either way. Done `4a4265d4` (2026-11-10): shown (coordinator
      call) as one quiet line in Optimize → Check directly under the "Biggest limiters" rows (where the full rows
      render; Home shows only the top one), still shown when no limiter stands out, absent when there is no hint.
      No new copy (the Rust sentence opens "Recent session hint:"). Check.test.tsx test proven failing on the old file.
- [x] **CR-stutter-rollback-improved** (installed build 68f2272b, 2026-11-10, Home → "Something went wrong" →
      Problems; `_train\view-1110\p6-04`) The stutter comparison (PBZ latest vs last steady) measured 1% lows
      RISING 14.6%, named "Trim Windows visual effects applied" as the likely cause, then said "Roll back the change
      in the Trust Ledger". A change with a measured improvement must not be proposed for rollback as the stutter
      suspect unless later evidence contradicts that measurement, and then the copy says so. Rust (intelligence.rs);
      measurement-adjacent, one review. Done `895d253e` (2026-11-10): root cause was `what_changed_inner` choosing
      the Compy-change (and power-plan) next test without the verdict's direction, so an "improved" pair got the
      regression's rollback sentence and rec id. Owner data (read-only): visual-effects applied 2026-11-02T00:37Z
      (still applied, Trial exp:6 still running), between the steady Nov 1 21:07Z baseline and the latest session.
      Now an improved pair says "Keep things as they are ... Undoing it isn't suggested: these two sessions measured
      an improvement", carries no rec id (no rollback button); the power plan likewise. Regressed path unchanged.
      Test proven failing on the old code. Review r1 APPROVE-WITH-NITS (2 nits taken; SHOULD-FIX queued below).
- [x] **CR-stutter-rollback-trial** (from CR-stutter-rollback-improved review r1) A REGRESSED comparison whose suspect
      change was kept on a Trial's measured improvement (`AppliedChange.justified_by_experiment`) still proposes the
      plain rollback. The copy should say the Trial measured an improvement on <date> and this later session
      contradicts it (the ledger event needs the Trial link). Rust (intelligence.rs); one review.
      Done `d7004a9a` (2026-11-10): the timeline apply event carries the row's Trial link (`serde(skip)`, wire shape
      unchanged); that case now reads "A Trial measured this change as an improvement on <date>, and this later
      comparison got worse. Roll it back in the Trust Ledger, play one more session, and compare — that is the next
      test of which result holds." Rec id kept (rollback still offered); no date when the record has none. Test
      proven failing on the old code. cargo 1809/0, clippy clean. Review r1 APPROVE-WITH-NITS (SHOULD-FIX + 2 nits
      taken). English only, like the sentence it replaces.
- [x] **CR-zh-dial** (desk review 2026-11-04, pre-existing) In zh-CN the Test room's safe-stack dial label "已启用" collides
      with the ring stroke and ticks (en "ON" fits): fit the zh label inside the ring (a shorter string or a smaller size)
      and add a zh-width guard. TS/CSS; screen check at a FULL session.
      PARKED 2026-11-10 (desk session, no code landed): the coordinator call was "fit it inside the ring by size,
      keep the string", but by size alone it cannot fit at the 13px floor. Measured from the CSS: the Test ring is
      64px (track inner edge r~21px); the unit row sits ~7-19px below centre, where the inner chord is ~18-40px wide;
      "已启用" at 13px mono with .1em tracking is ~43px wide (39px untracked), "ON" ~18px. Fitting needs ~9-10px,
      below the TYPE-1 floor that type-scale-guard.test.ts pins ("no token below 13px", no literal font sizes) and
      that ArcGauge.tsx states ("nothing shrinks below the floor"); a transform-scale would dodge the same law.
      Recommendation for a one-line re-call: count CJK as double width in ArcGauge's in-ring rule (unit visual
      width <= 3), so "已启用"/"就绪" render beside the label like "ready" already does, string kept, 13px kept;
      guard: a zh unit test in arc-gauge.test.tsx. Visual check of the Test room in zh-CN still due at a FULL session.
      Done `1bc687e6` (2026-11-10, coordinator took the recommendation): ArcGauge counts a CJK/fullwidth character
      as two Latin cells (`unitVisualWidth`, ring holds <= 3), so "已启用"/"就绪" render beside the label like "ready";
      13px floor, string and type-scale guard unchanged. Test proven failing on the old rule. **Visual check of the
      Test room in zh-CN is due at the next FULL install session.**

### Next — small visible slices (refill 2026-11-04: honest machine reads, Roadmap Phase 9 and the Care journey)
- [x] **CR-pagefile-0** A system-managed pagefile reads "Fixed at 0-0 MB": say "Managed by Windows" when Windows
      manages it (0/0 sizes or the automatic flag), the sizes only when they are set. Rust read + TS line; test with
      both shapes. Done `258b438f` (2026-11-10): all-0/0 rows read clean, unread or half-zero rows unavailable, a fixed
      row beside a managed one is the one named; no TS change needed (Check prints the Rust line).
- [x] **CR-pagefile-multi** A pagefile finding over several rows (managed C: plus fixed D:) offers a restore that
      refuses any multi-row layout: say it is not one-click, or support the layout. Rust; mutation boundary, one review.
      Done `a4c2690d` (2026-11-10, non-mutating option, coordinator call): a finding over 2+ rows now notes "Not a
      one-click restore here" and the Windows Virtual memory steps; a single fixed row keeps the one-click note.
      leftovers.rs only (actions.rs untouched). Test proven failing on the old note. cargo 1805/0, clippy clean.
      Review r1 APPROVE-WITH-NITS; SHOULD-FIX queued as CR-pagefile-note-refusals.
- [x] **CR-pagefile-note-refusals** (from CR-pagefile-multi review r1) The "Pagefile disabled" finding (no rows) still
      notes "Safe to restore to automatic", but the restore refuses zero entries too (`parse_manual_pagefile_entry`);
      check the `?:`-form single row the same way. Same non-mutating fix: say it is not one-click and the Windows
      steps. Rust (leftovers.rs); one review. Done `da22a28b` (2026-11-10): one note builder for every refused
      layout, each with its reason (several drives, none configured, an entry not in the plain `X:\pagefile.sys` form
      such as `?:` or a sub-folder, a row whose name wasn't read); a single row is one-click only when the restore's
      own pure parser accepts it. actions.rs untouched; RELEASE_STATE restore_gate re-anchored. Test proven failing on
      the old code. Review r1 APPROVE-WITH-NITS (WMI-vs-registry note comment and per-reason wording taken).
- [x] **CR-dual-channel** Claim a memory-channel count only from slot or bank data that names it, otherwise
      "unknown" (never invent hardware specs); check first what the line reads today. Rust, read-only; one review.
      Done `ad5074ac` (2026-11-10): before, any 2+ sticks read "Running in dual-channel (or wider)". Now the
      SMBIOS/WMI bank or slot label must name each module's channel ("P0 CHANNEL A", "Controller0-ChannelB-DIMM0");
      2+ channels Ready, all on one Attention (move a stick; Ready for soldered LPDDR), else Unknown. The owner's
      rig reads "P0 CHANNEL A"/"P0 CHANNEL B" (WMI BankLabel), so it stays dual-channel.
- [x] **CR-vbs-running** Say whether VBS is actually running from `Win32_DeviceGuard.VirtualizationBasedSecurityStatus`
      (running / enabled-not-running / off; unreadable stays unknown). Read-only: Compy never changes it (security
      settings are the owner's). One review. Done `b2ed0cca` (2026-11-10): Diagnostics → Security gains "VBS running
      now" (Running / Turned on, not running / Off / Unknown) from the virtualization probe; the registry row is
      relabelled "Memory Integrity / VBS turned on". Owner's rig reads 2 (Running) without admin.
- [x] **CR-slow-async** Black Box, support export, capture start and the slow probes become async commands so the window
      keeps painting while they work. Rust; one review; test the commands still answer the same shapes. Done
      `9cab29d0`, `27c10a75` (2026-11-10) except capture start: `get_crash_blackbox`, `export_report`,
      `preview_support_evidence`, `export_support_evidence`, `get_leftovers`, `get_game_readiness`,
      `get_priorities`, `get_diagnostics` and `get_trial_candidates` are async wrappers in lib.rs `off_main`
      running the unchanged sync fn on the blocking pool; names, arguments and answer types identical (pinned at
      compile time). Review r1 APPROVE-WITH-NITS (SHOULD-FIX: doc of the panic path, taken). **Parked:** capture
      start, now CR-capture-async below.
- [x] **CR-capture-async** (parked from CR-slow-async) `start_fps_capture` off the main thread. It waits up to 5 s for
      an old helper and launches the elevated one; off the main thread it could interleave with
      `stop_fps_capture` (a stop landing mid-wait would be overtaken by the start). Serialize start and stop
      under one lock first, then make both async; test a stop during a start's wait leaves capture off.
      Done `25af5dc5` (2026-11-10): one lock (monitoring.rs `capture_serialized`, LOCK_CENSUS "out") over both
      bodies; both are async in lib.rs `off_main` on the blocking pool; names, arguments, answers unchanged. Test
      (start→stop, stop during a start's wait runs after it and leaves capture off, panicked start doesn't lock stop
      out) proven failing without the lock. cargo 1810/0, clippy clean. Review r1 APPROVE-WITH-NITS (MUST-FIX
      census entry taken). The lock-order gap is closed by CR-capture-last-wins. Test exes have no app manifest, so the type-parity check names
      the capture pair by item type (a fn pointer links the helper launch in and the exe won't load).
- [x] **CR-care-silent** A Care state read or write failure gets a support event and one visible line ("Compy couldn't
      save this; it'll try again"), never silence. Rust + TS; test a failed write shows the line. Done `e77fba1e`,
      `3f200258`, `263e0768` (2026-11-10): "Not now" / "Find out why" on the crash card and the Home card read now
      answer an error on a failed read or save, with one support event (`care.*`, one per failure streak for the
      reads and the scan); the window shows "Compy couldn't save this; it'll try again" (or "couldn't check for
      crash notices") in the bottom-right stack and retries a failed save at 5 s / 30 s / 2 min. en + zh-CN.
      Review r1 APPROVE-WITH-NITS (3 SHOULD-FIX taken), r2 APPROVE-WITH-NITS (2 SHOULD-FIX queued below).
- [x] **CR-care-line-truth** (from CR-care-silent review r2) The save line outlives its promise and its cause: after
      the last retry (~2.6 min) it still says "it'll try again", and any later successful save clears it even when
      a different choice is still unsaved. Track failures per incident and command, clear only when none remain,
      and keep retrying (or reword) after the backoff ends. TS only; test both. Done `49213302` (2026-11-10):
      `persist(key, save)` keyed `dismissed:<id>` / `opened:<id>`; the line clears only when no choice is unsaved;
      after the last retry it reads "Compy couldn't save this; the crash notice may show again" (en + zh-CN). Reworded,
      not retried forever: each failed save writes a support event. 3 tests fail on the old logic. TS only.
- [x] **CR-tip-see-through** (desk self-review FAIL 2026-11-10, installed `1f4ed7a1`, Live room) The in-app term tip
      `.kl-tip` (`src/design/Term.tsx`, shared by every `<Term>`) is painted on `rgba(14,20,27,0.74)` with no
      backdrop blur, so the readings under it ("47°c", "14", the MEASURED pills) show through and collide with its
      text on the "13 Compy changes were on · combined effect" tip. Screenshot
      `C:\Users\Kuya\code\_train\view-1110b\c2-live-combined-effect-tooltip.png`. Make the tip ground opaque (or blur
      what is under it); test the computed ground; recapture.
      Done `0ab041dd`: the tip paints `--v2-panel-pop` (0.96, the Look panel's popover ground) plus its blur, opaque
      `--panel-2` outside V2; `term-style-guard` resolves the ground through every theme, surface and room re-point
      and fails on the old CSS (0.74). Visual re-check of the Live tip is due at the next FULL install session.

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
- [x] **P4-noise-stretch** (from P4-noise-proof) WARDOGS was judged against ±21.6% from older Oct-25 play
      (1% lows 148/136/122) although today's three idle sessions agreed within ~1.4%: the band takes the widest
      unchanged stretch in history, so old noisy play sets the band for every later Trial. Decide with
      P5-realplay (like-with-like scenes): which unchanged sessions describe the Trial's own conditions.
      Measurement: Rust review.
      Done 2026-11-02: `e79314a7` (a measurement belongs to its current unchanged run) and R4 `4faff373` (a bench
      Trial's band is its own run's spread, never the widest stretch in history). Rust review r2 approve-with-nits.
      Installed in `1d53dfc8`.
- [x] **P4-noise-copy-2** (done 2026-10-30 `a2437af7`, merge `fcb18d43`) "differed by up to X% between any two of those sessions" overstates it: only
      sessions within one unchanged stretch are compared. Reword (en + zh-CN) with a test.
- [x] **P4-cap-note** (done 2026-10-30 `42f8e04a`, merge `9234ff98`; the 2026-10-31 desk review found a third line restating both capped ones: one line since `f3bd1e49`) Both WARDOGS firing-range sessions sat at ~320 fps and were flagged "may be a menu or a
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
- [x] **P5-realplay** (owner decision 2026-10-29, Constitution §36; ROADMAP Phase 5 "Real-play mode"; next after
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
      Done 2026-11-02 (interactive, Claude HQ): Rust `0dd20271` (the judge), `835d16a9` (start, read, conclude),
      `59fc753c` (commands); review fixes `3ec4dce5` (Welch's band, not a pooled SD), `8682b11d` (only sessions that
      show the change on count, and the page says why one didn't), `7271fb4e` (a crash or put-back never keeps or
      pins what it can't), `d5f964a2` (progress read off the main thread); TS `12368826` ("Test it while I play
      normally"). Rust review r2 APPROVE-WITH-NITS; native cargo 1713 passed on `59fc753c`.
      UI: cloud-harness review round 1 FAIL, fixed in `71f98969`..`091ee7ff`; round 2 PASS, follow-ups in `136c85d6`.
      Installed in `1d53dfc8`.
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
      2026-11-10 desk session (not ticked): blocked before any Trial. The owner's PBZ Trial `exp:6-1793579868420`
      (visual-effects, started 2026-11-02 00:37Z) is still Running with its change applied, and the backend refuses
      a new Trial while one is Pending/Running (`experiment.rs:817-823`). Human step: the owner finishes it (one PBZ
      session, then Conclude) or puts it back from the bench (~2 min, or ~15 min with the session), then plays the
      WARDOGS Trials the panel asks for (~10 min of normal play per session). Read-back: `trial-wardogs\nav.js` output
      in this session's report.
      2026-11-10 ~17:44-19:16 desk session (not ticked). Owner 17:44: "i need you to complete these task on your own you
      can use the game i have active now rather than wardogs" (ROB RUN substituted for WARDOGS). Driven over CDP, no focus
      taken. PBZ Trial exp:6 cleared by Compy's own Conclude on its post-apply PBZ session (Nov 2, 4,860 readings):
      verdict confounded ("13 active Compy changes, not 15"), visual-effects restored, `final_state_verified` true, ledger
      row rolled back 01:48:06Z, no Trial open. ROB RUN, all real play: a Live capture (665 counted readings, 18 min in the
      background left out) then Optimize my game: as-is 1 (1,211 readings) and as-is 2 (1,209) both hit the settle cap
      uneven (335/284 and 239/316 fps); "Test anyway" was refused before any change: "another setting Compy changed earlier
      can't be confirmed as still in place" (the two power-ultimate rows read off; active plan is "Synez Power Plan", set
      outside Compy). No ROB RUN verdict; nothing applied. Blocked on CR-unconfirmed-remedy (owner call). Evidence
      `C:\Users\Kuya\code\_train\view-1110d\` (s1-*, p4-*, p5-*, journey.log, fgwatch.log).
      2026-11-10 ~20:13-21:21 session (killed with no report; recovered read-only 2026-11-11, not ticked). On installed
      `6a2e6334` over CDP: [Keep "Synez Power Plan"] recorded `changed_outside` on both power-ultimate rows (04:15:43Z),
      active scheme `22222222-…` (Synez) identical before/after/later. ROB RUN real play: as-is 1 (04:17-04:38Z) and
      as-is 2 (04:39-04:59Z) both uneven at the cap, "Test anyway", then the Trial `exp:7-1794373260660` (visual-effects,
      05:01-05:20Z, 1,112 readings): verdict too-noisy (avg 298.8→289.2, 1% low 205.7→197.5, floor ±3%), status
      restored, ledger row rolled back 05:20:31Z; no Trial open. Not met: the panel still names "Switch to the Ultimate
      Performance power plan" as worth testing, so it never said "Compy finished the supported tests". Remains: that
      Trial (needs the risk confirm) until nothing is worth another run. Evidence `_train\view-1110e\` (s4-*.txt,
      s4-powercfg.txt, journey.log, j-05-enough.png, j-06-end.png).
      2026-11-11 ~04:02-06:38 session (not ticked; ROB RUN per the owner's 17:44 sentence, "i need you to complete these
      task on your own you can use the game i have active now rather than wardogs"). Driven over CDP on installed
      `6a2e6334` while he played; fgwatch 466 reads, Compy never in front. Ultimate decision: declining it inside Compy
      only exists as lowering his own risk choice, which gives "finished-within-chosen-risk", not this wording; put-back
      is `rollback_change(own row)` -> `powercfg /setactive <snapshot prior_guid>`, the snapshot read by
      `/getactivescheme` at apply (`actions.rs` apply/rollback_power_ultimate), so it was run. Real play, all in focus:
      exp:8 power-ultimate (12:19-12:40Z, Stop now at the cap) too-noisy, put back; exp:9 visual-effects retest (new
      before-session forced; as-is uneven twice, Test anyway, 13:27-13:55Z) too-noisy (+2.4% 1% low), put back,
      VisualFXSetting 0 read back; exp:10 power-ultimate retest (13:55-14:31Z, "Compy has enough" both sessions) no-change,
      medium (1% low +1.7%, avg +0.7%, band ±3%), put back. Scheme `22222222-…` (Synez) before, Ultimate `db9dd473-…`
      only inside exp:8/exp:10 session 2, Synez after each and at teardown. Not met: the panel ends at "Nothing on ROB RUN
      is left for Compy to test right now. 1 change was measured. 1 couldn't be judged." Visual effects is now two
      too-noisy runs (RETEST_CAP 2) and `test-summary.ts` says "finished the supported tests" only with no inconclusive
      change, so on ROB RUN this wording can no longer be reached (coordinator/owner call: a steadier game, or accept
      "nothing left" as the exit). Evidence `_train\view-1111a\` (journey.log, powercfg.txt, ledger-*.txt,
      experiments-final.txt, o-*.json/txt, fgwatch.log, teardown.txt).
- [x] **CR-unconfirmed-remedy** (owner call) A Trial start is refused while a Compy change "can't be confirmed as still in
      place", and the refusal says to undo it; here that undo restores Balanced (`381b4222…`) over the owner's later
      outside choice ("Synez Power Plan"), so following it changes his power plan. Needs a path that stops tracking a
      change replaced outside Compy without touching Windows, or his OK to put Balanced back. Blocks every Trial on this
      PC. Evidence `_train\view-1110d\p4-unconfirmed-rows.json`, `p5-05-trial-start.json`.
      Done `12a791d0` (`ed0d9678`, `724e13ee`, `ae3792c2`; 2026-11-10, CODE-ONLY, not installed): coordinator call, keep
      his plan. Ledger-only "changed outside Compy" record (`AppliedChange.changed_outside`, optional, schema 1; old
      ledgers load unchanged): power-plan rows only, when the active scheme reads, is not Ultimate and is not the saved
      prior plan; unreadable stays refused; not while a Gaming Mode contract is on disk. Recorded rows stop blocking a
      Trial only while the recorded GUID is still live (start and conclude); the record time counts as a ledger move, so
      as-is sessions from before it don't pair. Undo stays offered. Reviews: opus r1 one MUST-FIX (record once only) taken,
      r2 APPROVE; sonnet r1 APPROVE. cargo 1823/0, clippy clean. Does not record the applied Ultimate GUID, so
      CR-ultimate-identity stays open (on a localized Windows Compy's own duplicate could be offered). Follow-ups:
      CR-outside-followups.
- [x] **CR-refuse-early** Optimize my game asked for two ~20 min as-is sessions and only refused at "Test anyway"
      for a reason known before the first session (the unconfirmed change above). Check the start precondition when the
      button is pressed and say so then. Evidence `_train\view-1110d\journey.log`, `p5-05-trial-start.json`.
      Done `5844c368` (`5a12ac1e`, `996bc3e1`; 2026-11-10, CODE-ONLY, not installed): the journey and the real-play tap
      ask `trial_start_precheck` (read-only, blocking pool, the start's own count and words) before any as-is session
      and say the refusal with the same remedies; an unreadable ledger stops there too. The start keeps its check as the
      second gate. Review (sonnet) APPROVE; cargo 1826/0, clippy clean; the TS tests fail on the old GuidedJourney.tsx.
- [ ] **CR-outside-followups** (review SHOULD-FIX of CR-unconfirmed-remedy, Rust + TS) (a) stamp the active plan GUID on
      each session or the Trial record, so a plan switched away and back between start and conclude is caught; (b) Test →
      Applied & history shows a recorded row as "changed outside Compy" (`types.ts` field + a note) instead of an active
      change with only the undo, and Game Readiness stops flagging it as drifted; (c) the remedy panel re-fetches its offer
      on the ledger-changed event (a plan switched again while it is open); (d) a replaced record keeps the first record's
      time as a move too (today the newest replaces it).
      (c) done `af23273d` (2026-11-11, CODE-ONLY, TS only, not installed): ChangedOutsideRemedy re-reads its offer on
      `LEDGER_CHANGED_EVENT` and on window focus, so its words and button follow a plan switched again; a recorded
      line keeps its own copy and stays after a re-read stops offering it. 2 tests fail on the old component.
      Left: (a) and (d) touch the Trial/ledger record (Rust), (b) Applied & history + Game Readiness (TS + readiness).
      2026-11-11 s15: (a) and (d) parked, not started: both change what the Trial start/conclude one-change checks
      read (the session ran under "no apply/rollback behaviour" for item 4); (b) parked for time (Rust readiness +
      TS history, one review); next step for (b): `types.ts` `changed_outside` on `AppliedChange`, a note on the row.
      (b) done `4ee91290`, `44d91648`, `db633af9`, `9d4553bb` (2026-11-11 s16-s18, not installed): Game Readiness counts
      a recorded row whose plan still holds as kept, not drift (only the readiness roll-up `checked_summary` reads the
      plan, through `summarize_for_readiness`; `summarize_history` unchanged, test-pinned); view field
      `changed_outside_holds` (None when no read was taken); History says "changed outside Compy" + a "Recorded <when>"
      note (en, zh-CN). `db633af9` restores the two shapes the experiment-record-first guard pins (`summarize_checked`
      holds the roll-up; `checked_summary(load_history(), ledger_was_quarantined())`): those were the 2 guard failures
      s16 put on CR-rp-same-setting-row. Reviews: r1 opus + sonnet REQUEST-CHANGES (fixed), r2 sonnet
      APPROVE-WITH-NITS, r2 opus (s18) APPROVE-WITH-NITS, no MUST-FIX; SHOULD-FIX unknown-as-None and the date wording
      taken, the shared plan read queued (CR-kept-plan-read-once). cargo 1839/0, clippy clean, guard 49/49, full vitest
      532/536 (3 site-app suites + one Chromium launch flake, passed on rerun). (a), (d) not started.
      2026-11-11 s19: (a) and (d) still not started (session bound): both change what the Trial one-change checks read,
      and need a test showing the check gets no weaker plus two reviews. Next step for (d): keep `recorded_at` of the
      first record in a `first_recorded_at` field (additive) and count it as a move in `trial_moved_since`-style checks.
- [x] **CR-kept-plan-read-once** (r2 opus SHOULD-FIX of CR-outside-followups b) Once a row is kept outside Compy, every
      `get_applied_changes` poll (sync, UI thread) spawns a second `powercfg` beside the power-ultimate probe's: share one
      plan read for the pass through `LiveReads` (history.rs `applied_change_views`, `kept_outside_observed`).
      Done `0813fe8e` (2026-11-11 s19, CODE-ONLY, read-only, not installed): `LiveReads` carries the pass's one active
      scheme read; the power-ultimate probe (same class rule) and the kept-outside check share it. Test counts one read
      for the pass (two on the old code). sonnet APPROVE-WITH-NITS, no MUST-FIX/SHOULD-FIX.
- [x] **CR-kept-outside-nits** (r2 opus NITs of CR-outside-followups b) Re-check Gaming Mode after the plan read, as
      `record_changed_outside` does (history.rs `kept_outside_observed_with`); readiness row wording when every change is
      kept outside ("0 settings active ..." first, readiness.rs ~978); a still-applied row that reads off shows
      "rolled back" in History (Fix.tsx, pre-existing); the power-profile row still flags a kept custom plan (readiness.rs ~864).
      (a) Gaming Mode re-asked after the read: done `0813fe8e` (test fails on the old code: kept on a read taken as a
      session started). (b) done `2542fdcd` + test follow-up (2026-11-11 s19, not installed): with no change active and
      every one left kept outside, the row reads "No Compy change is in effect right now; any of them can still be undone
      from the Trust Ledger." then the kept line (English, like the rest of that row); sonnet APPROVE, SHOULD-FIX (plural
      case test) taken. (c) done `95eac0f8` (2026-11-11 s19, TS only, not installed): History says "off now, not
      undone" (zh-CN "当前已关闭，未撤销") for an applied row that reads off; only an undo says "rolled back" (no longer
      dimmed: it is a live ledger entry). Test fails on the old component. sonnet APPROVE. (d) done `f8e7aa3e` + review
      follow-up (2026-11-11 s19, read-only, not installed): when the kept change is the power plan (its record holds),
      the Power profile row is an advisory "Active plan "<name>", which you chose to keep as set outside Compy. Compy
      won't flag or switch it." (English, like that row) instead of "isn't performance-oriented". sonnet Accept;
      SHOULD-FIX (two separate plan reads) documented as accepted, nit test taken.
- [x] **CR-summary-running-trial** (TS) While a retest Trial runs, the game summary's row for that change reads "Applied
      now" and "Stays applied from these tests: <change>", though the tested Trial put it back; "on" is the running
      Trial's own apply (`stillAppliedFrom` reads the picker's already-set-by-compy). Say it is applied by the Trial in
      progress, or leave it out of "stays applied" while a Trial on it runs. Reproduces the PBZ note from 11-10.
      Evidence `_train\view-1111a\o-08-resume-midtrial.json` (exp:9 running; exp:7 restored).
      Done `3bacacdd` (2026-11-11, CODE-ONLY, TS only, not installed): `stillAppliedNow` reads a change a `running`
      Trial has on as "trial": the row says "On for the test in progress; not kept yet." (en + zh-CN), it is left out
      of "stays applied", it is not the keep side of an outcome choice, and the journey's `stillOnFor` doesn't claim
      it. Test fails on the old summary. Review (sonnet) APPROVE-WITH-NITS; SHOULD-FIX (`stillOnFor`) and nits taken.
- [x] **CR-next-reuse-moved** (TS) After exp:8 put Ultimate back, the next offer said "Next: Trim Windows visual effects,
      about 10 min" (reuse), then the start refused the reuse ("a Compy change was applied or undone after the baseline
      session") and asked for a new before-session (~20 min). `nextReuses` (`reusableAsIs`) should count the finished
      Trial's own rollback as a ledger move, as the start does. Evidence `_train\view-1111a\o-06-exp8-verdict.txt`,
      `o-07-next-start.txt`.
      Done `3731f531` (2026-11-11, CODE-ONLY, TS only, not installed): `trialMovedSince` (GuidedJourney.tsx) counts a
      Trial's apply after the as-is session and a put-back after it as moves (kept/running ends move nothing; an
      unreadable date counts as moved). The result offer and the continue plan reuse only when nothing moved, so a
      put-back Trial's next offer reads "about 20 min (a new before-session first)" and never tries the old session;
      a kept Trial's next still reuses its with-change session (about 10 min). 5 tests fail on the old code. Changes
      made outside a Trial (another room's apply) are still caught only by the start's own check and its fallback.

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
      2026-11-10 desk session (not ticked): needs a person. The exit is measured on normal play (Constitution 36,
      P5-realplay), so an unattended idle scene is not a valid run, and the same open PBZ Trial blocks the button.
      Human step: after P4's step, the owner presses Optimize my game on WARDOGS and plays (~25 min); the friend once.
      2026-11-10 ~18:30-19:14 (not ticked; ROB RUN per the owner's 17:44 substitution, see P4-exit-proof): the button
      ran two as-is sessions on his real play with no capture or Trial clicks (each stopped at Compy's own "Stop now"
      after the settle cap), offered "Test anyway", then refused to start (CR-unconfirmed-remedy). No summary reached;
      the friend's run not attempted. Evidence `_train\view-1110d\p5-0*.png/json`, `journey.log`.
      2026-11-10 ~20:13-21:21 (killed session, recovered 2026-11-11; not ticked; ROB RUN per the 17:44 substitution):
      from the button, two as-is sessions and one Trial session on real play, every step through journey buttons only
      (Stop now ×2, Play one more as-is session, Test anyway, Done playing), no Start/Stop capture or Conclude click;
      Compy concluded it itself (too-noisy, put back). The end screen is the verdict with a next offer ("I understand,
      test it" / "Stop here"), not the end-of-journey summary. Remains: run to the summary, and the friend's repeat.
      Evidence `_train\view-1110e\journey.log`, `j-01..j-06*.png`.
      2026-11-11 ~04:02-06:38 (not ticked: owner half met / friend half open; ROB RUN per the owner's 17:44 sentence,
      "i need you to complete these task on your own you can use the game i have active now rather than wardogs"): the
      journey resumed from its own offer and ran to its end on his real play through journey buttons only (I understand,
      test it ×2, Next, Stop now ×4, Play one more as-is session, Test anyway, Done playing ×3, OK); no Start experiment,
      Start/Stop capture or Conclude click, no setting picked. Three Trials (exp:8, exp:9, exp:10; see P4-exit-proof).
      End: "1 of 2 tested. Nothing else here is worth testing on this PC. 1 try couldn't be judged.", and the summary
      "Nothing on ROB RUN is left for Compy to test right now. 1 change was measured. 1 couldn't be judged." with both
      put back and why, lesson "ROB RUN swings a lot between sessions…", "Nothing from these tests stays applied." Across
      11-10 + 11-11 that is the button (11-10 ~20:15) to the summary. Friend's repeat cannot be done by Claude.
      Evidence `_train\view-1111a\journey.log`, `o-12-journey-end.json`, `o-13-after-ok-summary.json`.
      2026-11-11: the friend-dependent part is deferred, no second tester available (owner, 2026-11-11 07:41: "I DO
      NOT HAVE ANY AVAILABLE FRIEND FOR TESTING SO LEAVE ANYTHING LIKE THAT ONLINE"). Do not ask the owner for it again;
      do not simulate it. Stays unticked until the owner either supplies a tester or decides in writing that the owner
      half alone exits the phase.

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
      2026-11-10 desk session, driven on the installed `68f2272b` from Home with no room picked: Home > Something went
      wrong lands on Problems with one next step for the newest crash (ROB RUN App crash, Nov 10 11:17: "Verify the
      game's files, then update it", with receipt), and its "Stutters or runs slow?" button compares the latest
      session (PBZ, Nov 2) with the last steady one and names one next test (roll back, play once, compare). No
      WARDOGS crash is on this PC's record (the incident list names none) and the stutter path compares the latest
      game, PBZ. Evidence `C:\Users\Kuya\code\_train\view-1110\p6-0*.png`. Not ticked: the friend's repeat
      (~5 min) and a WARDOGS case are still needed.
      2026-11-10 ~19:14 re-check (not ticked; ROB RUN per the owner's 17:44 substitution, see P4-exit-proof): from Home,
      Something went wrong → the ROB RUN crash (Nov 10 11:17) still reaches one next step (verify files, then update),
      and "Compare my latest session with my last steady one" now gives an honest unknown for ROB RUN ("no steady
      ROB RUN session to compare … record a session in Live when the game runs well"). The owner's half holds for ROB RUN;
      the friend's repeat (~5 min) remains. Evidence `_train\view-1110d\p6-05-*`, `p6-06-stutter-now.png`.
      2026-11-11: the friend-dependent part is deferred, no second tester available (owner, 2026-11-11 07:41: "I DO
      NOT HAVE ANY AVAILABLE FRIEND FOR TESTING SO LEAVE ANYTHING LIKE THAT ONLINE"). Do not ask the owner for it again;
      do not simulate it. Stays unticked until the owner either supplies a tester or decides in writing that the owner
      half alone exits the phase.

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
      2026-11-10 desk session (not ticked): needs the friend at the keyboard (~10 min) and the owner opening the
      technical layer on each answer (~5 min); not drivable unattended.
      2026-11-10 ~19:16: not attempted or simulated (needs the friend); still open.
      2026-11-11: the friend-dependent part is deferred, no second tester available (owner, 2026-11-11 07:41: "I DO
      NOT HAVE ANY AVAILABLE FRIEND FOR TESTING SO LEAVE ANYTHING LIKE THAT ONLINE"). Do not ask the owner for it again;
      do not simulate it. Stays unticked until the owner either supplies a tester or decides in writing that the owner
      half alone exits the phase.

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
      Desk review 2026-10-31 (`d9b87bf4`): the question sat flush under the journey line; 12px since `f3bd1e49`.
- [x] **P8-posture-note** — `73d9c5d9` (TS) "Nothing left to test" now adds "N more changes are held back
      by the risk you chose" (en + zh-CN); test proven failing on the old code.
      Not reachable on the owner's data; proven on stubbed data in the cloud-harness review, 2026-11-02.
- [x] **P8-posture-count** — `9e2083f5` (TS) `outsideRisk` lists only never-tested held changes; a held
      stale result no longer counts in `stop.stale` or the retest headline (`staleAsked`). Two tests, both
      proven failing on the old code.
- [x] **P8-posture-stale-copy** `53514506` (fix `35e39a0a`) A held-back change whose only result is stale reaches "nothing-testable-now",
      whose copy says nothing was measured; that is untrue when a (stale) result exists. Give that case its
      own honest line (en + zh-CN) and a test. Found 2026-10-29 while doing P8-posture-count.
      Not reachable on the owner's data; proven on stubbed data in the cloud-harness review, 2026-11-02.
- [x] **P8-posture-show** The Trial receipt and the game summary name the risk choice in force when each
      Trial started (stored on the experiment record; older records read "not recorded", never a guess).
      Needs P8-posture-b. Landed as `b1f4ae76` (interactive lane, 2026-10-31): `risk_choice` on the record,
      bench Trial row + journey result receipt, en + zh-CN. A scheduled session had landed the same item on the
      PC's main at 13:54 (`e4d22675`), minutes before the lane claimed it; its code was reverted in `d6b0b1d3`
      for the lane's version (lenient reads) and kept on `keep/train-p8-posture-show-e4d22675`.
      Cloud-harness review: round 1 FAIL, fixed; round 2 one MUST (12px above the summary), fixed in `136c85d6`. Installed in `1d53dfc8`.
- [x] **P8-posture-lenient** (review SHOULD-FIX on P8-posture-show) A `risk_choice` value this build does not
      know (a downgrade after a later build adds one) must read "not recorded", not fail the whole
      experiments.json load: lenient deserialize to `None`, plus a test. First check what the store loader
      does on a parse failure (an empty-store fallback would lose Trial history for any enum field).
      Covered by the landed version: `risk_choice`, `stated_risk` and `cost_acknowledged` read through
      `trial_candidates::lenient` (a value this build can't read is `None`; the store still loads), tested by
      `a_start_keeps_the_risk_choice_in_force_and_an_older_record_reads_not_recorded` and
      `a_stored_risk_reads_leniently`. The loader still moves an unreadable store aside (`experiments.json.corrupt`),
      so an enum field added later needs the same reader.
- [x] **P8-ack** Before a moderate change's Trial starts, one plain line names its cost from the catalog's
      own words and needs one tap ("I understand, test it"); safe changes start as today. Recorded on the
      receipt. RISK_MODEL §1 Advanced ("explicit user acknowledgement when the cost is not obvious").
      Landed as `ec493063`: the cost line quotes the catalog's own `downside` words and the start records
      `cost_acknowledged`.
      Reviewed with P8-posture-show. The tap is a UI gate only: see P8-ack-enforce.
- [x] **P8-dims** The Trial receipt's technical layer lists the risk dimensions the catalog states for the
      change (reversibility, stability, compatibility, security) instead of one word; an unstated dimension
      reads "not stated", never filled in. RISK_MODEL §3 ("do not collapse these into one arbitrary score").
      Landed as `72212b40`, `2a19d405` (one "not stated" row when the catalog states none) and `d9f1b097` (a
      start reuses the words the picker read). No catalog row states `risk_dimensions` yet, so every receipt
      shows that one row today: see P8-dims-grades.
- [x] **P8-dims-grades** (owner may overrule by editing a row) Grade each Trial candidate's reversibility, stability,
      compatibility and security in the catalog (`risk_dimensions`), from evidence, never filled in to look complete.
      One review round; the grades are catalog claims, so the owner signs them off. RISK_MODEL §3.
      `b46f2c6` + review `14d39b5` (2026-11-03; the owner asked for this done without his review, so the grades ship
      as Claude's call, each with its rule in `recommendations.rs::stated_risk_dimensions`): all 16 one-click changes
      graded Low/Moderate on four dimensions; reversibility Moderate where the rollback restores a state, not the
      exact prior (four services, the power plan, reserved storage); stability Moderate where the catalog's own
      downside names a behaviour change or possible regression (services, power plan, HAGS, Nagle, reserved storage),
      Low where the only cost is idle power (USB suspend, PCIe ASPM, EEE) or boot time; compatibility Moderate where
      hardware, a driver or a plan gates it; security Low for all (none touches a security control). Severities
      unchanged: a safe row may carry a recoverable Moderate caveat (RISK_MODEL §3); the test pins that every
      moderate row states a Moderate dimension and nothing grades High. Review r1 REQUEST-CHANGES (a compile
      break, three grades) → fixed.
- [x] **P8-ack-enforce** (owner call, taken by Claude 2026-11-03 under "completed by you alone"; overrule by
      reverting `81a9f14`) `start_experiment` records `cost_acknowledged` as the start was told it and does not
      refuse a moderate change's start without it. Should the backend refuse it too (defence in depth), or is the
      one tap enough? RISK_MODEL §1.
      Decision: refuse. `81a9f14`: a moderate or unknown-risk change's start without the cost OK is refused in plain
      words before anything is recorded or applied; safe changes start as before; the arg is additive, every
      frontend start sends it. Rust review APPROVE.
- [x] **P8-launch-flash** (desk review 2026-11-02) On entering Test, the bench shows the launcher, with a live
      risk picker, for about 3 s (2.7-3.3 s measured on the owner's rig) until the first read returns and a
      running Trial replaces it. A pick in that window saves a new risk choice while a Trial runs. Hold the
      launcher and the idle journey until the first read returns.
      Done in `508b200f`: the risk picker is held until the first read (the change picker has no options before
      it, and the idle journey has no change to start). The flash itself stays. Desk review on his data PASS on `1d9c7abb`. Installed in `93c3ff0a`.
- [x] **P8-label-ink** (review 2026-11-02) `.exp-field-label` (the risk question's label) wears --ix-text-3,
      4.47:1 in the Test room: just under AA. Give it the muted ink, as GL-empty did for the glass notes.
      Done with GL-faint-ink: on glass and frosted the faint tier is the muted ink. Installed in `93c3ff0a`.
- [x] **GL-shell-overflow** (desk review 2026-11-02) `main.app` (`overflow: hidden`) keeps 19px of scrollable
      overflow from `.v2-backdrop` (956 vs 937 at 1500x980), so a `scrollIntoView` (BlackBox's deep link) can
      shift the whole shell up 19px. `overflow: clip` would stop it.
      Done in `508b200f` (`overflow: clip`). Desk review on his data PASS on `1d9c7abb`. Installed in `93c3ff0a`.
- [x] **GL-faint-ink** (desk review 2026-11-02, round 2) The faint ink (--ix-text-3, --v2-faint) on glass sits
      under AA on his data: the Problems station's 13px lines (`.bb-helpful-q`, `.bb-nextstep-tag`, `.bb-vitals-text`,
      `.bb-changed-unknown .bb-changed-line`, `.bb-changed-norestore`, `.bb-restore-maybe`, `.bb-since-when`,
      `.bb-skipped`) at 3.03-4.47:1 in 166 instances, and Test's quiet labels (the "Past experiments" eyebrow,
      "Technical receipt", the gauge notes) at 4.23-4.48:1, there since the glass redesign. The station's tags
      clear it with 85% --v2-muted and 15% --v2-text (`d93dfe7e`); the teal assess and next-step blocks need about
      70/30, or --ix-text-2. Re-measure every instance on his data.
      Done in `508b200f`: on glass and frosted --v2-faint takes --v2-muted, and the station re-points --ix-text-3
      to 70% --v2-muted and 30% --v2-text (the tags' own rule went with it). Desk review on his data PASS on `1d9c7abb`. Installed in `93c3ff0a`.
- [x] **P8-off-progress** (desk review 2026-11-02, round 2) Above a running Trial whose change reads off, the
      progress line still says "Testing now: X". Pass the off read to `JourneyProgressLine`, as `136c85d6` did for
      a stopped real-play test.
      Done in `508b200f`: "N of M tested · Compy reads X as off (see below)". Desk review on his data PASS on `1d9c7abb`. Installed in `93c3ff0a`.
- [ ] **P8-first-advanced** (owner) Pick the first Advanced candidate (deeper power/scheduling behaviour)
      and admit it through `.claude/rules/tweak-catalog.md` + ARCHITECTURE_LOCKS "candidate only after
      Trial + Risk proof". Needs the owner's sign-off and P4-exit-proof.

### Then — Roadmap Phase 9: Hardware decision intelligence (`product/ROADMAP.md` Phase 9)
**PHASE 9 EXIT FINDING (s24, 2026-11-12; read from main after the s24 merges; not ticked: owner's call, see Needs
owner).** Exit, `product/ROADMAP.md:287`, clause by clause:
(1) "for a measured workload": met in code. Per game, its newest measured session's GPU readings, sessions from
another card left out (priorities.rs `build_gpu_games`, `sessions_on_this_gpu`; tests
`each_game_is_gpu_limited_only_by_its_own_newest_measured_session`, `a_session_on_another_card_never_names_this_cards_gpu_as_the_limiter`).
(2) "say whether software settings have reached what it can test": met in code. The Phase 9 line exists only on a
"finished-supported-tests" summary (settings-done.ts `settingsDoneLine`; `p9-exit-fixture.test.ts` cases done vs not
done). Never seen live: the Test panel has not yet said "finished" on this rig (P4-exit-proof).
(3) "name the measured limiter in system context": met for the GPU (summary: "...the GPU is the measured limiter for
this game. Compy can't check your power supply, case or the rest of the system for a new card."; Optimize room:
what it was measured from + "Before any card: ..." fit line, `optimize-station-upgrade.test.tsx`) and for the screen
(P9-screen-is-limit, P9-summary-screen-limit). GAP: a part the check names reads "The last check's top limiter is a
part of this PC: <title>." with no system context on the summary (fixture case 5; queued P9-part-line-context).
(4) "or say 'no upgrade recommended'": met. Summary: measured-clear line with its counts, "not measured ... no upgrade
is recommended", the screen cap; Optimize room: "No upgrade recommended" with what it was read from, or "Not measured
yet" (P9-no-upgrade-named, s24). GAP: with no measured session the summary's plain line ("found nothing holding this PC
back") reads as measured (fixture case 3; queued P9-no-session-plain-line).
(5) "never naming a part in isolation": NOT met, the gap in (3).
(6) "never letting retail economics shape the answer": met. P9-retail-firewall (settings-done payloads with/without
links; `upgrade_row_wording_names_no_retailer`), the room shows no links (`optimize-station-upgrade.test.tsx`), the
fixture's leak check.
Verdict: not yet met. Two small TS gaps (P9-part-line-context, P9-no-session-plain-line), and the live case waits on
P4-exit-proof. Recommendation: land the two gaps, then count the Exit met on code + fixtures, with the live walk inside
P4/P5's exit proof.
Planned 2026-10-28 (scheduled refill, second). Smallest read-only slices on what Compy already measures;
no shopping, no product names, no prices (affiliate firewall), never an invented spec.
- [x] **P9-hz** `f1bfbb26` The display-mode line shows the refresh rate with its unit ("1920×1080 @ 250 Hz", was
      "1920x1080@250") on the debrief rig line, Trial summary context, Care next-step rig and hardware-change
      timeline, en + zh-CN; rate 0 reads "refresh rate unknown". Desk review 2026-10-31 (`d9b87bf4`): PASS.
- [x] **P9-target** FPS answers compare against the screen's measured refresh rate ("about 60% of your
      250 Hz screen"); no line when the rate or the FPS is unmeasured. ROADMAP P9 "display target".
      `97ebbf7f` (merge `6e4224c9`): session debrief line from the session's own recorded mode, en + zh-CN.
      Desk review 2026-10-31 (`d9b87bf4`): PASS.
- [x] **P9-settings-done** When the Phase 4 panel says Compy finished the supported candidates for a game,
      the game summary adds one line: settings have reached what Compy can test here, then the measured
      limiter (P7-rig-limiter) or "not measured". "No upgrade recommended" is a valid answer and the default
      when nothing is measured. Needs P4-exit-proof for a live case; code + tests can land first.
      `25feba43` (merge `a84ba5a7`): code + tests landed; reads the cached scan's top attention limiter (a
      setting named as a setting, a part named only), no scan/unread = "not measured". Live case still needs
      P4-exit-proof; the 2026-10-31 desk review found the line naming "1 safe tweak not applied" as the limiter:
      aggregate rows are skipped since `f3bd1e49`.
Refill 2026-11-11 s20 (fewer than 5 ready items): smallest slices toward the Exit's "in system context, never a part in
isolation"; read-only, no product names, prices or wattages guessed (unknown stays unknown).
- [x] **P9-gpu-fit-unknowns** Under "GPU was the measured limiter" (Optimize → Check upgrade block), one line naming
      what Compy can't check before any card: the power supply's capacity and connectors, and the case's room and
      airflow; a power supply the user added in Test → Add a part is named as what they told Compy, never read as
      a capacity. en + zh-CN; Check.test.tsx: no PSU / user-added PSU / no GPU item (no line).
      Done `15a67af1` + r1 nit (2026-11-11 s20, TS only, not installed): "Before any card: Compy can't read your power
      supply's capacity or connectors, or how much room and airflow your case has. Check those first." (or "you told
      Compy your power supply is “<name>”" when the user added one); the user-added list is read, never written; a
      malformed stored entry is skipped. Review (sonnet) APPROVE-WITH-NITS (malformed-entry guard taken). Three tests
      fail without the line. Full vitest 535/538 (3 site-app suites), tsc 0. Not visually checked yet (the block shows
      only after a GPU-limited session).
- [x] **P9-ssd-fit-unknowns** Under "Games are on an HDD", one line: Compy can't read which free M.2 slots, SATA
      ports or drive bays the board and case have; check before choosing a drive. en + zh-CN; same test file.
      Done (2026-11-11 s20, TS only, not installed; SHA in the merge): "Before any drive: Compy can't read which free
      M.2 slots, SATA ports or drive bays your motherboard and case have. Check those first." Test fails without the
      line; review and gates in the session log.
- [x] **P9-summary-gpu-limit** The finished game summary's Phase 9 line reads that game's newest measured session:
      when it was GPU-limited (the sustained rule of P9-bottleneck-sustained), it names the GPU as the measured
      limiter with its share instead of "nothing holding this PC back"; another game's session never counts. Rust read
      + TS line, en + zh-CN; one review (measurement).
      PARKED 2026-11-12 s21 (ROB RUN started 01:42; nothing heavy run since): code + tests committed UNTESTED on
      `claude/train-P9-summary-gpu-limit` (worktree `.claude\worktrees\train-P9-summary-gpu-limit`): priorities.rs
      `gpu_limited_games` (per game, its newest measured session, the sustained rule; `build_gpu_limited_games`),
      types.ts, settings-done.ts `gpu-limiter` kind (outranks nothing-limiting / not-measured, never a scan's own
      attention limiter), ExperimentBench line, en + zh-CN `settingsDone.gpuLimiter`. Still to run, no game: `npx tsc
      --noEmit`; `npx vitest run src/surfaces/settings-done.test.ts src/surfaces/ExperimentBench.test.tsx`; full
      vitest; `cargo test` + `cargo clippy --all-targets -- -D warnings` (CARGO_TARGET_DIR = main's target); prove the
      tests fail on the old code; one sonnet review; merge.
      Done `3088b200`, `78a908d1` (2026-11-12 s22, not installed): when Compy finished the supported Trials for a game
      and that game's newest measured session was GPU-limited, the summary says "In your newest measured <game>
      session, N% of Compy's GPU readings were at 95% load or more, so the GPU is the measured limiter for this game.
      Compy can't check your power supply, case or the rest of the system for a new card; see Optimize → Check."
      (zh-CN too); the threshold rides on the payload. Reviews sonnet r1 APPROVE-WITH-NITS (SHOULD-FIX taken: share
      of readings not of time; case-folded game match both sides), r2 APPROVE-WITH-NITS (no SHOULD-FIX). The TS test
      fails on main's settings-done.ts. cargo 1875/0, clippy clean, tsc 0, full vitest 536/539 (3 site-app).
      Not visually checked (needs a finished game summary on a GPU-limited game; none on this rig yet).
Refill 2026-11-12 s21 (Phase 9 Exit: "name the measured limiter in system context or say 'no upgrade recommended',
never a part in isolation"; read-only, measured only, unknown stays unknown, no product names or prices):
- [x] **P9-limit-source** Under "GPU was the measured limiter" (Optimize → Check), the line names what it was measured
      from: the game, the session's date and how many samples were GPU-busy, from the recorded session; none recorded
      = no line. en + zh-CN; Check.test.tsx: recorded / not recorded.
      Done (2026-11-12 s22, not installed; SHAs in the merge): the row carries `measured_from` (the same
      `newest_measured_row` the share came from: game, start, GpuLoad busy/readings, the 95% threshold) and Check says
      "Measured from your ROB RUN session on Nov 11: 720 of 900 GPU readings were at 95% load or more." (zh-CN too;
      the year when it isn't this one); no game or start recorded = no line. This also answers s21's "the GPU-limit
      line follows the newest session overall": the line now says which game's session it is. Review sonnet
      APPROVE-WITH-NITS (year nit taken; threshold is the same constant). The TS test fails on main's Check.tsx.
      cargo 1879/0, clippy clean; full vitest in the session log. Not visually checked (no GPU-limited session here).
- [x] **P9-screen-is-limit** In the same block, when that session's measured average FPS is at or above the screen's
      measured refresh rate, say the screen is the limit ("your 250 Hz screen already shows every frame: no upgrade
      recommended for this game") instead of pointing at the GPU; refresh or FPS unmeasured = no line. en + zh-CN;
      tests: above / below / unmeasured.
      Done (2026-11-12 s22, not installed; SHAs in the merge): both numbers from that session (MeasuredFrom gains
      `avg_fps` and the session's own `game_state.display_refresh_hz`; 0 or missing = unmeasured). At or above: "Your
      screen is the limit here: Your 250 Hz screen can't show more than 250 frames a second, and your ROB RUN session
      averaged 252 fps, so on average a faster GPU wouldn't show you more frames; the slowest moments can still depend
      on it. For frame rate, no upgrade is recommended for this game." (zh-CN too), no GPU fit line, no retail links;
      below or unmeasured = the GPU row as before. Review sonnet APPROVE-WITH-NITS (SHOULD-FIX taken: average-only
      wording softened; what the refresh field is, as a comment; boundary tests at = and 249.6). The disclosure line
      still renders under the block when no links show (pre-existing block shape). Tests fail on main's Check.tsx.
      cargo test priorities + clippy clean. Not visually checked.
- [x] **P9-cpu-gpu-balance** (Phase 9 "CPU/GPU balance") When a game's newest measured session was NOT GPU-limited
      (enough readings, under half busy) and averaged below the screen's refresh rate, Check says the GPU was not the
      limit in that session (N of M readings busy) and that Compy can't measure the CPU's share yet; unknown stays
      unknown, no part named. en + zh-CN; tests.
      Done with P9-no-upgrade-named (s24; see its note): under "No upgrade recommended", "That session averaged 142
      fps, under the 250 Hz the screen ran at. Compy can't measure the CPU's share yet, so it can't say what held the
      frame rate there." Average or refresh unmeasured, or at/above the refresh = no line.
- [x] **P9-no-upgrade-source** The finished game summary's "nothing holding this PC back" (settings-done) names what it
      was read from (the cached check's date and that the game's newest session was not GPU-limited, or "not
      measured"). en + zh-CN; tests.
      Done (2026-11-12 s22, not installed; SHAs in the merge): priorities gains `gpu_clear_games` (per game, its newest
      measured session with 30+ sane readings and busy under half; built in one pass with the limited list), and the
      settings-done line, for this game only, reads "...in your newest measured ROB RUN session 120 of 900 GPU readings
      were at 95% load or more, under the half Compy counts as GPU-limited. No upgrade is recommended." (zh-CN too);
      unmeasured, another game's session or impossible counts = the plain line. The cached check's date is not named.
      Reviews sonnet r1 REQUEST-CHANGES (MUST-FIX taken: "so the GPU wasn't the limit" became the rule; guard and
      tests taken), r2 found a peak-under-threshold row with most readings busy fell into "clear" (fixed both sides),
      r3 no MUST-FIX (no verdict line given). The TS test fails on main's settings-done.ts. cargo priorities 26/0 +
      clippy clean; full cargo 1879/0 before the r2 fix.
- [x] **CR-gpu-share-one-source** (done with P9-no-upgrade-cpu-unknown, s23) The "under half" rule lives twice: Rust
      `GPU_SUSTAINED_SHARE_PCT` and settings-done.ts's `busy * 2 < readings` (and "the half" in en/zh). Carry the share
      on `GameGpuClear` and use it in TS and the string. Rust + TS; one review.
- [ ] **P9-cpu-fit-unknowns** If Check shows a CPU-limited block, one line naming what Compy can't read before any
      CPU: the board's socket and BIOS support, and the cooler's fit; establish first whether such a block exists
      (if not, park with the finding). en + zh-CN; same test file.
      PARKED 2026-11-12 s22 (finding): no such block exists. `priorities.rs build_upgrade_path` emits only "gpu" (a
      sustained GPU-limited session) and "ssd" (install drive on an HDD); Compy has no CPU-limited measurement, so
      there is nothing to put the line under. Revisit if a measured CPU limiter lands (P9-cpu-gpu-balance first).
- [x] **P9-upgrade-block-reachable** (s22 finding, blocks the Check half of the Phase 9 Exit) The upgrade advisory block
      in Check.tsx renders only when `!v2Ia`, and the only shipped caller (OptimizeStation's "More cleanup" Check) passes
      `v2Ia`; the comment's "OptimizeV2 renders its labeled-early card below" has no code. So the GPU/SSD rows and the
      P9-gpu-fit-unknowns, P9-ssd-fit-unknowns, P9-limit-source and P9-screen-is-limit lines never reach a user. Give the
      measured Phase 9 lines (limiter, what it was measured from, the screen limit, what Compy can't check) a home in
      the shipped room; whether the retail links come with them is an owner call (Needs owner) and the default is no
      links. TS; one review.
      FINDING (s23): not hidden on purpose (no owner decision or RELEASE_STATE gate hides it). V2-4b demoted the block:
      Check suppressed it under v2Ia and OptimizeV2 drew it as a labeled-early card below its action groups. OptimizeV2
      was deleted with the dead room generations (`1ab831fb`, 2026-08-06) and no room took the card over, so it has
      reached no user since. Done (s23, not installed; SHAs in the merge): Check's block is one exported
      `UpgradePathBlock` (classic Check unchanged); Check hands its scan's upgrade path up (`onUpgradePath`) and
      OptimizeStation renders it below "More cleanup", labeled "Upgrade path (advisory) early - being developed", with
      no retail links or money disclosure; only when the scan named a hardware limiter, and a re-run without one takes
      it away. lab/optimize-station-upgrade.test.tsx (GPU row with source and fit line, screen limit, HDD row, re-run,
      empty, none); the positive tests fail on main. Review sonnet APPROVE-WITH-NITS: SHOULD-FIX "the row title/why are
      English-only Rust strings now shown in zh-CN" queued (CR-upgrade-rows-zh; pre-existing in classic Check);
      SHOULD-FIX test gaps taken (HDD, re-run, empty); NIT "optimize-v2-ia.test.tsx:258 still names OptimizeV2" left
      (a guard; its assertion still holds: Check under v2Ia renders no block, the room does).
- [ ] **CR-upgrade-rows-zh** (P9-upgrade-block-reachable review) The upgrade rows' title and why come whole from
      priorities.rs in English and now show in the zh-CN room. Carry the numbers (share, peak) on the row and word both
      rows in the UI by kind, en + zh-CN; also drop "a GPU upgrade is the hardware lever" (a part named before the fit
      lines). Rust + TS; one review.
- [x] **P9-no-upgrade-named** When Check measured no limiter, the upgrade area says "No upgrade recommended" and the
      sessions it was read from (count and newest game), never an empty block; no sessions = "not measured yet".
      en + zh-CN; tests: measured clean / no sessions.
      Done with P9-cpu-gpu-balance (s24, not installed; SHAs in the merge): priorities.rs `upgrade_evidence` (sessions
      from another card left out): sessions that measured play with 30+ sane GPU readings, how many were GPU-limited,
      and the newest one's counts, sustained verdict, average FPS, recorded refresh and card tie. The Optimize room
      (Check hands its scan's priorities up) shows, when the scan named no hardware limiter, no part, and no counted
      session was GPU-limited: "No upgrade recommended. Read from the last check, which names no part holding this PC
      back, and 3 measured game sessions, none of them GPU-limited (sessions recorded on another graphics card are left
      out). In the newest, your ROB RUN session on Nov 11, 120 of 900 GPU readings were at 95% load or more, under the
      50% Compy counts as GPU-limited, so Compy doesn't count the GPU as the limit there." (zh-CN too); none counted =
      "Not measured yet: ...". Labeled early, no links. Tests: Rust evidence (other card, samples 0, too few readings,
      untied, nameless first, limited count); room 12 cases, 7 fail on main. Reviews sonnet r1 REQUEST-CHANGES
      (MUST-FIX taken: the count no longer says "on this graphics card"; SHOULD-FIX taken: a GPU-limited counted
      session hides the block, the CPU line guesses no cause; tests), r2 APPROVE-WITH-NITS (comment nits left).
      Not visually checked.
- [x] **P9-retail-firewall** (Phase 9 "affiliate economics firewalled") A test that the upgrade verdict (gpu/ssd row,
      settings-done line, screen-is-limit) is computed with no retail data in scope: the same priorities payload with
      and without retail links yields the same rows and wording; establish first where links are joined. Tests only
      unless a leak is found (then park with the finding).
      Done (2026-11-12 s22; SHAs in the merge). Finding: no leak. `priorities.rs build_upgrade_path` decides each row
      from the sessions and readiness alone and attaches the const GPU_LINKS/SSD_LINKS after; settings-done.ts never
      reads `upgrade_path`. New settings-done test: five payloads (GPU-limited, measured clear, part, unread, none)
      each pin their own verdict and give it with links present, stripped or absent; a Rust test pins that
      neither the gpu nor the ssd row's title/why names a retailer or its host. Pins, so they also pass on main.
      The with/without-links comparison is TS-only and only for the settings-done line; the Rust rows can't vary
      their links (consts), so "no leak" there rests on reading `build_upgrade_path`, not on a test. Check.tsx's
      screen-is-limit is not covered here (unreachable; P9-upgrade-block-reachable). Review sonnet r1 (no verdict
      line; coverage gap and self-comparing asserts, both taken), r2 APPROVE-WITH-NITS (host "www." and this
      note's scope, both taken).
- [x] **P9-exit-fixture** (Phase 9 Exit proof) One fixture per Exit branch, driven through priorities + the game
      summary: settings done + GPU-limited (limiter named with what Compy can't check), settings done + measured clear
      ("no upgrade recommended" with its source), settings not done (no part named). Pure tests; no UI claim (the Check
      half waits on P9-upgrade-block-reachable).
      Done (s24, tests only; SHAs in the merge): `src/test/fixtures/p9-exit.json` holds six cases on one game and this
      PC's card (settings done + GPU-limited; done + measured clear; done + no check rows and no measured session; not
      done with a GPU-limited session on record; done + the check names a part (HDD); not done + a part). priorities.rs
      `p9_exit_fixture_payloads_match_the_shared_fixture` builds each payload from its readiness and sessions and pins
      it (the check's limiters, upgrade rows, gpu_limited_games, gpu_clear_games; a retail-word leak check on the
      rows); `src/surfaces/p9-exit-fixture.test.ts` drives settingsDoneLine / softwareFirstLine and the en words from
      the same payload (limiter + "Compy can't check your power supply, case or the rest of the system"; measured clear
      with its counts and "No GPU upgrade is recommended"; no check in hand = "not measured ... no upgrade is
      recommended"; not done = no Phase 9 line, a part only via "try these settings before any upgrade"). Pins: they
      pass on main too. Review sonnet r1 APPROVE-WITH-NITS (SHOULD-FIX taken: limiters on the contract, the part
      branches, a non-vacuous not-done case; the words() mirror of ExperimentBench is commented). FINDINGS: (1) no
      check rows and NO measured session gives the plain "The last check found nothing holding this PC back, so no
      upgrade is recommended" (queued P9-no-session-plain-line); (2) a part the check names is said with no system
      context on the summary: "The last check's top limiter is a part of this PC: Game install drive." (queued
      P9-part-line-context).
- [x] **P9-no-session-plain-line** (P9-exit-fixture finding) The finished summary's plain `nothingLimiting` ("The last
      check found nothing holding this PC back") fires when no session was measured for the game; it reads as a
      measured verdict. Say what it was read from (the check's rows, no session measured for this game) and keep "no
      upgrade recommended". en + zh-CN; settings-done + fixture tests. TS.
      Done with P9-part-line-context (s24, not installed; SHAs in the merge): "Settings have reached what Compy can test
      here. The last check found nothing in its rows holding this PC back; Compy has no session of this game with enough
      GPU readings, so its GPU load isn't measured. No upgrade is recommended." (zh-CN too). Known limit (review r1
      SHOULD-FIX, recorded): a measured-clear row the line refuses as malformed (an old payload or impossible counts)
      also falls to this wording.
- [x] **P9-part-line-context** (P9-exit-fixture finding; Exit "never naming a part in isolation") The finished
      summary's `partLimiter` says "The last check's top limiter is a part of this PC: <title>." with nothing about the
      system; Check's room adds the fit line ("Before any drive: Compy can't read ..."). Add the same kind's fit line
      (upgrade-fit.ts) to the summary line; unknown kinds say Compy can't check how a new part fits. en + zh-CN; TS.
      Done (s24, not installed; SHAs in the merge): the part line is followed by "Before any drive: Compy can't read
      which free M.2 slots, SATA ports or drive bays your motherboard and case have. Check those first." for the install
      drive (the only part limiter the backend emits) and "Before any part: Compy can't check how a new one would fit
      the rest of this PC (its power supply, motherboard and case). Check those first." for any other (zh-CN too, no
      space after the full stop). Tests: settings-done `fit`, the ExperimentBench render, the P9 fixture's part case;
      they fail on main. Review sonnet r1 APPROVE-WITH-NITS (zh spacing and wording taken; SHOULD-FIX recorded above).
      With these two, the Phase 9 Exit finding's two gaps are closed in code (live case still P4-exit-proof).
- [x] **P9-summary-screen-limit** The game summary's gpuLimiter line (reachable, unlike Check's block) says when that
      same session averaged at or above the screen's measured refresh that the screen, not the GPU, capped what you
      saw (mirror P9-screen-is-limit's wording and boundaries); unmeasured = today's line. en + zh-CN; tests.
      Done (2026-11-12 s22, not installed; SHAs in the merge): `GameGpuLimit` carries that session's `avg_fps` and
      recorded `refresh_hz` (0/missing = absent; one helper shared with MeasuredFrom); settings-done adds `screenCap`
      at average >= refresh, and the summary reads "...80% of Compy's GPU readings were at 95% load or more, but your
      250 Hz screen can't show more than 250 frames a second and that session averaged 252 fps, so on average a faster
      GPU wouldn't show you more frames; the slowest moments can still depend on it. For frame rate, no upgrade is
      recommended for this game." (zh-CN too). Tests: above, equal, 249.6, unmeasured either side, 0/NaN/Infinity/
      negative, another game's session; a render test; they fail on main. cargo priorities 27/0 + clippy clean.
      Review sonnet APPROVE-WITH-NITS, no MUST-FIX: parity with Check checked (both compare the raw average and round
      only for display); wording kept as Check's reviewed text (VRR/tearing nuance not added); the refresh is
      recorded once per session (commented); edge cases taken. Not visually checked.
- [x] **P9-summary-cpu-unknown** (superseded s23 by P9-no-upgrade-cpu-unknown: the measured-clear line now always
      says Compy measures neither the CPU nor a frame cap, whatever the refresh) (summary twin of P9-cpu-gpu-balance) When the finished summary's measured-clear line
      fires and that session averaged below its recorded refresh, add that Compy can't measure the CPU's share yet, so
      "nothing holding this PC back" covers the GPU and the checked rows only; refresh/FPS unmeasured = today's line.
      Rust (`GameGpuClear` gains avg_fps/refresh_hz via the shared helpers) + TS; en + zh-CN; tests.
- [x] **P9-summary-no-dead-pointer** The gpuLimiter summary line ends "see Optimize → Check", whose upgrade block never
      renders (P9-upgrade-block-reachable). Until that lands, drop the pointer or point at what the summary itself
      shows; en + zh-CN; test that the line names no unreachable room.
      Done (2026-11-12 s22, not installed; SHAs in the merge): the pointer is dropped in en and zh-CN; the line now
      ends "Compy can't check your power supply, case or the rest of the system for a new card." New ExperimentBench
      test renders the GPU-limiter line from a scan (it had no render test) and asserts no Optimize/→ pointer; it
      fails on main's lab.json. When P9-upgrade-block-reachable lands, a pointer to the room that shows it may return.

Refill 2026-11-12 s23 (coordinator; fourth whole-range review 119d07f8..b4d2ec7f, SHIP-WITH-FOLLOW-UPS):
- [x] **CR-bench-flake** ExperimentBench "each tested row's receipt names the risk allowed" failed in the loaded full
      run / pre-push gate (2026-11-11, 2026-11-12 07:56: "expected 1 to be greater than 1", receipt door never opened)
      and passed alone. Cause, product code: `Depth` re-applied the Expert-view default to both doors from a
      `useEffect` on `[expert]` that also ran on mount; when a render outside act yielded before its passive effects,
      a tap on the already-visible door was undone by the late mount effect (a real user tap in that gap too). Fix:
      the doors follow only a CHANGE of the preference, adjusted during render; no mount effect. Depth.test.tsx taps
      each door from a layout effect; fails on the old Depth. Proof: 10/10 consecutive ExperimentBench file runs, 2
      full vitest 537/540 (3 site-app suites). Review sonnet APPROVE-WITH-NITS (no MUST-FIX; SHOULD-FIX "a summary
      remount would read the same": the summary sits at one tree position and this test's data is all set before
      render, so no remount path; if the flake returns, check for a remount first). Done with this line's merge.
- [ ] **CR-check-expert-mount** (same class as CR-bench-flake) Check.tsx ~189 resets the measured-fine and
      not-worth-touching piles from a `useEffect([expert])` that also runs on mount, so a tap in the same gap is
      undone. Same render-phase fix; a layout-effect tap test. TS; one review.
- [x] **CR-footer-undo-path** (s23 confirmation of the range review) After CR-footer-reversible a changed-outside row
      gets no Roll back. Finding from the code: no undo path was removed. The Applied cards (every Undo) come from
      `liveChangeGroups` (active + can't-confirm), which 7dfe87ef did not change; a kept row whose live check reads on
      still has its card, and its Undo confirm names the saved plan (`keptOutsideUndoBody`, 6613a053). A kept row that
      reads off had no card before either. The only new refusal (`hasUndo`) is for rows whose stored history resolves
      to no undo (`resolve_rollback` fails), whose undo failed before anything ran anyway. No change.
- [x] **CR-core-parking-held-with-plan** (SHOULD-FIX, same class as CR-gm-stop-busy's opus MUST-FIX; done with the
      next item, see its note)
      gaming_orchestrator.rs ~258 holds only USB and PCIe with the power plan. The core-parking leftover restore
      (history.rs ~1499 `restore_leftover`, no gate) writes SCHEME_CURRENT (actions.rs ~4570-4617): during a Gaming
      Mode session it lands on the session's plan; after Stop the row reads off ("changed outside Compy") and its undo
      writes session-plan priors onto the user's plan unrecorded. Route `core-parking-forced` through
      `plain_change_gate`, held with the plan; grep SCHEME_CURRENT / setacvalueindex / setdcvalueindex across
      src-tauri and cover each other writer. Rust; two reviews (opus + sonnet).
- [x] **CR-gm-start-respects-plan-holds** (SHOULD-FIX) gaming_orchestrator.rs ~787 `free(REC_POWER)`: Gaming Mode
      start switches the plan while an open Trial holds USB or PCIe, so that Trial measures a plan without its change.
      REC_POWER is not free while a plan-scoped setting is held. Rust; two reviews.
      Done with CR-core-parking-held-with-plan (one branch, s23; SHAs in the merge): `PLAN_SCOPED` = USB, PCIe,
      core-parking-forced. A session holding the plan holds all three (`session_hold_refusal`); `session_rec_of` maps
      core parking so `plain_change_gate` reads the session for it; the webview's `restore_leftover` is now
      experiment's, which takes that gate before history's audited restore (ledger lock) and holds it through the
      write, as `suspend_known_service` does (history must not call the orchestrator: store-lock-order guard, which
      failed on the first shape); the row's undo, `experiment::rollback_change`, was already gated. The other SCHEME_CURRENT writers are the USB/PCIe apply (their undo targets the stored plan GUID) and the
      core-parking restore/undo; counted in a test. Start: `step_free(REC_POWER)` is false while a plan-scoped setting
      is held, and the pane names it "Power plan → max performance (one of its settings was being tested)". New
      tests fail on the old code (3 of 17 in spans_trial_tests). Reviews r1: sonnet APPROVE-WITH-NITS (no
      MUST-FIX/SHOULD-FIX); opus REQUEST-CHANGES, no MUST-FIX: SHOULD-FIX 1 (history.rs wave2 test now meets
      SESSION_OP contention: retries taken, then moot once the gate moved to experiment's command), SHOULD-FIX 2 (the left-alone line would say the
      Trial tested the plan: own label, taken), SHOULD-FIX 3 pre-existing (queued CR-core-parking-plan-guid); NITs:
      the session_op_guard doc names the new taker (taken; the store-lock-order guard's prose is a guard, left),
      writer count is a literal tripwire (kept, stated), unreadable record lets a plan-scoped change through (in
      CR-core-parking-plan-guid), core parking can't be Trial-held (harmless). Reviews r2: sonnet APPROVE-WITH-NITS
      (no MUST-FIX); opus REQUEST-CHANGES, no MUST-FIX: SHOULD-FIX 2 (label: the holder may be the benchmark and the
      line stays up all session: now "(one of its settings was being tested)", taken), SHOULD-FIX 3 (the
      CR-gm-stop-busy test grabbed SESSION_OP with no retry: retries now, taken), SHOULD-FIX 1 (a Trial whose baseline
      ran with Gaming Mode switching the plan and whose later sessions leave it alone compares two plans, and
      comparability sees only "Gaming Mode on"; queued CR-trial-plan-switch-confound), SHOULD-FIX 4 (pre-existing,
      plain apply of power-ultimate vs a held USB/PCIe Trial and the reverse: folded into CR-core-parking-plan-guid);
      NITs: PLAN_SCOPED doc "every apply" (taken), the store-lock-order guard's SESSION_OP census does not list
      restore_leftover (a guard, left; the gate never waits), writer count a literal tripwire (stated), the plan named
      left alone even where the switch would have been a no-op (pre-existing class). Two rounds done; after r2 the
      full vitest's store-lock-order guard failed (history -> gaming_orchestrator -> experiment -> comparison/drift),
      so the gate moved from history's restore_leftover to the experiment.rs command, unreviewed as a third round
      (same shape as suspend_known_service; pinned by the end-to-end test and the handler-list check).
- [ ] **CR-core-parking-plan-guid** (CR-core-parking-held-with-plan opus r1 SHOULD-FIX 3 + r2 SHOULD-FIX 4,
      pre-existing) The core-parking restore and its undo write SCHEME_CURRENT and its snapshot stores no plan GUID, so
      a plan switch between apply and undo (a Trial on power-ultimate not kept; or a Gaming Mode record this Compy
      can't read) lands the undo on another plan unrecorded. Record the active plan GUID in the core-parking snapshot
      (additive, serde default) and undo against it as the USB/PCIe restore does. Same class: a plain UI/batch apply
      or undo of power-ultimate while a Trial or the bench holds USB/PCIe (experiment.rs ~3078/~3110), and a plain
      USB/PCIe/core-parking change while one holds power-ultimate, are not refused. Rust; two reviews.
- [ ] **CR-trial-plan-switch-confound** (CR-core-parking-held-with-plan opus r2 SHOULD-FIX 1) Since a Gaming Mode start
      leaves the plan alone while a USB/PCIe Trial is open, a Trial whose baseline ran with Gaming Mode switching the
      plan and whose later sessions ran with it left alone compares two plans; comparability.rs ~360 and realplay.rs
      ~622 compare only `gaming_mode_active`. Record per session whether Gaming Mode switched the plan (or its
      left-alone list) and treat a difference as a changed condition. Rust; two reviews.
- [x] **CR-restore-window-direct** (read-only finding first) Is every bench and Trial restore path that calls
      `history::rollback_change` directly (no gate) safe against the Gaming Mode restore window? Write the finding
      here; queue a fix only if one is not.
      FINDING (s23, from the code; no change): safe, by disjointness. The direct callers are experiment.rs
      `abort_start`, `finish_conclude`, `restore_experiment` (+ `undo_outcome_choice`, which takes SESSION_OP and
      `session_holds_refusal` first) and benchmark_trial.rs ~210/~385. Each undoes the one setting its Trial or bench
      holds. A session never holds that setting: a Trial start refuses a setting a session holds
      (`session_holds_refusal`, experiment.rs ~3004/~3186/~3506, which also refuses while a stop is in flight via
      RestoreWindow), and a session start leaves alone every setting an open Trial or the bench holds
      (`held_by_trials` → `step_free`). The one cross-setting coupling was the power plan (a held USB/PCIe change is a
      setting OF the plan a session switches): closed by CR-gm-start-respects-plan-holds (same merge as this line).
      So a direct restore and a session's restore never write the same setting, in or out of the restore window.
- [x] **P9-no-upgrade-cpu-unknown** (SHOULD-FIX, honesty) lab.json `nothingLimitingMeasured` (00d5bd01, 2e67e38b,
      a91c068c): "No upgrade is recommended" leans on a low GPU share, the usual sign of a CPU limit or a frame cap,
      neither of which Compy measures. Say so, or stop citing the share as support. en + zh-CN. Folds in
      CR-gpu-share-one-source (settings-done.ts `busy*2 < readings` vs Rust GPU_SUSTAINED_SHARE_PCT).
      Done (s23, not installed; SHAs in the merge): the finished summary now reads "...the last check found nothing it
      measures holding this PC back, and in your newest measured ROB RUN session 120 of 900 GPU readings were at 95%
      load or more, under the 50% Compy counts as GPU-limited, so Compy doesn't count the GPU as the limit there. A
      GPU that often isn't near full load usually means the CPU or a frame cap set the pace, and Compy measures
      neither, so it can't say the CPU didn't hold this game back. No GPU upgrade is recommended." (zh-CN too).
      `GameGpuClear` carries `limit_share_pct` (GPU_SUSTAINED_SHARE_PCT); settings-done.ts reads it (a row without a
      sane share claims nothing); the upgrade row's why and the session hint format the share instead of "half".
      Tests fail on main (settings-done share test; ExperimentBench render). Review sonnet r1 APPROVE-WITH-NITS
      (SHOULD-FIX "wasn't the limit" over-claims at 90-94% load: taken; SHOULD-FIX "at least half" hand-written in
      two Rust lines: taken).
- [x] **P9-session-on-this-hardware** (SHOULD-FIX, honesty) priorities.rs `build_gpu_games` (0e3091a4, c49f37af):
      the GPU-limiter and screen-limit lines never check the session ran on today's hardware; skip sessions recorded
      on another rig (the session's own stored identity; none stored = say it is a past session that can't be tied
      to the current card). The "{hz} Hz screen" is the mode recorded at session start, not what the monitor can do:
      word it as the mode the session ran at, and never "no upgrade" where a higher refresh could be the answer.
      PARKED s23 (finding, no commit): sessions do store `hw_fingerprint.gpu`, so filtering other-card sessions out
      before `build_priorities` is a small pure step, but the current card has no cheap source there:
      `hardware::current_fingerprint()` runs `collect_hardware()` (WMI, uncached) and `priorities_from` is a sync
      Tauri command (main thread, every scan). Next step: pass the GPU name the frontend already read (App's
      HardwareInfo) into `priorities_from`, or cache the snapshot, then filter; the refresh-wording half and the
      no-fingerprint sentence are unchanged. Rust + TS; one review.
      Done (s24, not installed; SHAs in the merge): this PC's card is read from the startup hardware snapshot already
      in memory (`hardware::cached_primary_gpu_name`, the most-VRAM GPU as fingerprints pick it; it never starts the
      WMI read, so the sync `priorities_from` stays cheap); the report reads it from its own hardware source
      (`priorities::primary_gpu_of`). Every session-read GPU line (session hint, upgrade row, gpu_limited_games,
      gpu_clear_games, the report's upgrade block) reads only sessions not recorded on another card, so an older
      session on this card (or none) decides. Rows carry `gpu_tie` (this-card / not-recorded / card-unread); Check's
      "measured from" line and the summary's GPU lines add "That session didn't record which graphics card it ran on,
      so Compy can't tie ..." or "Compy hasn't read which graphics card this PC has now, ..." (zh-CN too). Screen
      limit: "In your ROB RUN session your screen ran at 250 Hz, so it could show at most 250 frames a second ... For
      frame rate at 250 Hz, no GPU upgrade is recommended for this game." (title "Your screen's refresh rate was the
      limit in that session"; the summary twin the same). Tests: Rust 3 new (other card skipped everywhere, older
      same-card session decides, case-folded; not-recorded / card-unread / blank; the report's pick); TS settings-done,
      Check, ExperimentBench render; 9 TS tests fail on main. Review sonnet r1 APPROVE-WITH-NITS (nits taken as
      comments); its two SHOULD-FIX are outside the diff: queued CR-tuning-gpu-other-card, CR-receipt-gpu-other-card.
- [ ] **CR-tuning-gpu-other-card** (P9-session-on-this-hardware review SHOULD-FIX) `src/data/tuning-measure.ts`
      `gpuSustainedNearLimit` reads the last sessions for "GPU held near the limit" with no card check; it gates
      tuning/OC offers in Check, TuningInstrument, TuningVerdict, TuningDebrief and lab-evidence-map. After a card
      swap, old-card sessions can fire it for the new card. Read each session's `hw_fingerprint.gpu` (add it to the TS
      SessionSummary type) against the card App already read (HardwareInfo, most-VRAM); another card's session
      doesn't count, none recorded = says so. TS; one review.
- [ ] **CR-receipt-gpu-other-card** (same review, SHOULD-FIX) `receipts.rs` ~80-90 pairs the newest measured session
      with `hardware.gpus.first()` (not the most-VRAM pick) and never checks that session ran on that card. Use
      `priorities::primary_gpu_of` and the session's own `hw_fingerprint.gpu`; another card's session is not named
      as this card's. Rust; one review.
- [x] **CR-glass-scroll-flake** (s24 push 2 gate) `src/surfaces/glass/glass-rooms.test.tsx:477` "arriving while a
      record waits lands on THAT record" failed in the loaded pre-push run ("the selected row was never scrolled to:
      expected -1 to be greater than -1") and passes alone. Same class as CR-bench-flake: find whether the scroll
      runs from an effect a loaded render can outrun; fix in product code, never by loosening the test. TS.
      Done (s25, TS only; `99ddefbf`, `9c4c795c`, `e21014d7`): product code. BlackBox's record row scrolled the
      deep-linked record into view from a passive `useEffect`; the scan result commits outside act, so React ran that
      effect in a later task than the commit that drew the row, and a loaded run's `findByText` resolved in the gap
      (a user saw one frame of the list's top, then the jump). Now a `useLayoutEffect`: the scroll lands in the
      drawing commit, before paint. New glass-rooms test (a DOM observer right after that commit checks the note's
      own row was scrolled to) fails on main ("expected false to be true"). Proof: 10/10 + 10/10 consecutive file runs,
      tsc clean, 2 full vitest 540/543 (3 site-app suites). Review sonnet r1 APPROVE-WITH-NITS (SHOULD-FIX taken: the
      observer checks the note's own row, not any scroll; NIT taken: null sentinel).
- [ ] **CR-firstcheck-flake** (s24 full vitest in train-P9-exit-fixture, tests-only branch) `FirstCheck.test.tsx`
      "unread and advisory together: the unread line counts graded checks only and names the advisory" got null in
      a loaded full run and passes alone (8/8). Same class; find the timing gap. TS.
- [ ] **CR-upgrade-area-truth** (fifth whole-range review b4d2ec7f..d7e67ee5, SHIP-WITH-FOLLOW-UPS; one slice, one
      sonnet review) The newly visible upgrade area: (1) SHOULD-FIX Check.tsx ~1256 `partNamed` counts the aggregate
      rows `pending-safe-recs` / `applied-changes`, so with safe tweaks pending "No upgrade recommended" disappears;
      filter them from one shared source with settings-done.ts. (2) SHOULD-FIX no guard for an UNKNOWN limiter: the
      room says "No upgrade recommended" where the game summary says not measured; return the not-measured line. (3)
      SHOULD-FIX Check.tsx ~1165 GPU/HDD upgrade rows render the Rust `title`/`why` as-is (English in zh-CN): i18n keys
      by `kind` with share and peak, Rust strings the fallback for an unknown kind. (4) SHOULD-FIX `measured_sessions
      == 0` keeps the title "No upgrade recommended": its own title "Nothing measured yet". NITs: (a) priorities.rs
      `gpu_tie` / `sessions_on_this_gpu`: carry an excluded-session count in `UpgradeEvidence` and show it; a current
      adapter that is the Basic Display Adapter or unreadable says the card can't be identified now instead of
      excluding everything; (b) NoUpgradeBlock's `clear` lacks settings-done's `0 < limit_share_pct <= 100` guard: use
      the shared one; (c) the footer ledger retry runs every 60 s forever and logs each time: back off (60 s, 5 min,
      15 min) and log once per state change. Known limitation (record, not for action): HW_SNAPSHOT is read once at
      startup, so an eGPU unplugged while the app runs stamps later sessions with the wrong card.
Screen check view-1112c (s24, installed `9d2f2b57`; verdict FAIL, quoted in the session log); each FAIL is an item:
- [x] **CR-view-1112c-zh-gap** (`_train\view-1112c\04-optimize-zh-CN.png`) The zh-CN "No upgrade recommended" block
      joined its sentences with an ASCII space after "。" ("。 在最近一次"), and so did the GPU row's untied line.
      Done (s24, TS only, not installed; SHAs in the merge): Check.tsx `sentenceGap` (none after a Chinese full stop,
      one space in English) for the no-upgrade block's newest line, both untied lines. Tests (zh-CN both blocks, en
      keeps its space); the zh two fail on main. Not re-captured (installed build is `9d2f2b57`). Review sonnet
      APPROVE-WITH-NITS (SHOULD-FIX taken: the GPU-row test asserts the untied line is there; NITs left: one
      language source with `sessionDate`, hoist the per-row call).
- [ ] **CR-view-focus-1112c** (FULL; `_train\view-1112c\fgwatch.txt`: "fgwatch reads=107 compy_in_front=3
      seen=compy:3,Discord:95,firefox:4,Idle:5"; s23's run read 0 of 187) Compy was in front 3 of 107 reads during the
      background screen check (close the running copy, CDP launch with --no-activate and COMPY_NO_ACTIVATE=1,
      SetWindowPos with SWP_NOACTIVATE, close, Start-NativeProcess -Detached -NoActivate relaunch). Re-run with a
      timestamped watcher and a mark at each step to find the step; fix that step (or the app's show path) so the
      check never takes the foreground. Script/app; no settings change.
- [ ] **CR-view-overflow-1112c** (`_train\view-1112c\02-optimize-no-upgrade.png`) The verdict needs the Optimize
      station's scroll containers measured (scrollHeight vs clientHeight at 1280x720, 1500x980 and 1920x1080) now that
      the no-upgrade block sits below its groups. Measure on the next FULL screen check; fix any surplus.
- [ ] **CR-view-upgrade-render** (`_train\view-1112c\03-optimize-upgrade-fixture.png`, identical to 02) The GPU upgrade
      block has never been seen rendered in the real app: this rig's sessions aren't GPU-limited, and an in-memory
      wrap of `window.__TAURI_INTERNALS__.invoke` does not take (not writable). Find a route that renders it in the
      installed build without touching its data (a read-only dev/fixture route gated off in release, or the
      Storybook-like lab route if one exists), or keep it unit-test-only and say so each check. Investigation first.
- [x] **CR-footer-ledger-unknown** (NITs, ShellV2.tsx ~471, 52cd64de) `get_applied_changes` turns an unreadable
      ledger into [] so the footer can say "Nothing in effect to undo · ledger 0" while the health probe failed or is
      in flight; a rejected call can leave "Ledger not read yet" forever. Unknown reads unknown; a rejected call
      surfaces and retries. USB/PCIe undo refused during a session though rollback targets the saved plan GUID:
      leave unless trivially safe (two reviews if changed).
      Done in part (s24, TS only, not installed; SHAs in the merge). The rejected-call half: App's banner already
      surfaced it; now the footer reads "Couldn't read the ledger · trying again" (zh "无法读取台账 · 正在重试") whenever
      the newest read was rejected, also over rows read before it (review r1), and App re-reads the ledger on a
      backoff (2/5/15/30 s, then once a minute) until one lands (`data/applied-changes-retry.ts`, App's own read
      passed in). Tests: ShellV2 (fail on main), settleLedgerRead (current/superseded x landed/rejected), the retry
      hook with fake timers. NOT done, guard conflict: the empty-list half ("No changes listed · ledger not confirmed
      complete" while health is unknown) failed `ledger-health-home-guard.test.tsx`, which pins that UNKNOWN health
      leaves Home and the shell byte-identical to a healthy ledger; guards are not edited, so it is dropped and listed
      under Needs owner (the residual case: rows read fine, an EMPTY list, health unknown, still reads "Nothing in
      effect to undo · ledger 0"). USB/PCIe undo part left (not trivially safe). Reviews sonnet r1 APPROVE-WITH-NITS
      (both SHOULD-FIX and the NIT taken), r2 APPROVE-WITH-NITS (SHOULD-FIX taken: a retry read a refresh overtook is
      dropped, not shown over newer rows; NIT taken: a rejected read outranks the incomplete floor line).

### Before deadlines
- [x] **fflate** 0.6.11 `53a1c9de`; dev-only body-parser/zod advisories cleared (shadcn 4.22.1) `89fc1add`.
- [x] **tokio** `fcc64291` (1.54.1; only tokio's lock entry changed). Desk install at the next ship.
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime` (FULL mode only), update
  `RELEASE_STATE.md` in the same commit, report what is visible, and summarise the week from the Session log.

## Session log
- 2026-11-10 ~19:16-20:10 (coordinator-assigned, CODE-ONLY throughout, owner in ROB RUN): CR-unconfirmed-remedy landed
  `12a791d0` (coordinator call delegated by the owner: keep his own plan; ledger-only "changed outside Compy" record,
  schema 1, nothing on Windows changes; opus r1 MUST-FIX taken, r2 APPROVE; sonnet APPROVE) and CR-refuse-early `5844c368`
  (journey and real play refuse before any as-is session; sonnet APPROVE). cargo 1826/0, clippy clean, tsc clean. Queued
  CR-outside-followups; CR-ultimate-identity stays open. Not installed, not pushed (main 10 ahead of GitHub with this line).
- 2026-11-11 ~03:20-04:00 (coordinator-assigned, CODE-ONLY throughout; owner on Discord, then in ROB RUN from ~03:52):
  recovered the session killed on 11-10 ~20:13 (no report): it had recorded Keep "Synez Power Plan" (both power-ultimate
  rows `changed_outside`, plan GUID unchanged) and run P4/P5 on ROB RUN to a Compy-concluded Trial exp:7 (visual-effects,
  too-noisy, restored, no Trial open); P4/P5 not ticked (notes under each). Its Compy was still on CDP port 9339; torn
  down to a plain launch (no-debug-port CLEAN) and its idle s12 build shells closed. Landed CR-vbs-row-truth `27a217e9`
  (sonnet r1/r2 APPROVE-WITH-NITS, CR-vbs-local-eq1 queued), CR-care-read-promise `54fecd47`, CR-capture-last-wins
  `6b0db90d` (sonnet APPROVE-WITH-NITS) and CR-outside-followups (c) `e2629af6`; every new test proven failing on the old
  code; cargo 1829/0 (24 ignored), clippy clean, tsc 0, vitest 533/536 files (3 site-app suites need site-app/node_modules
  in a worktree). Not installed, not pushed (preflight never FULL; main 28 ahead of GitHub with this line).
- 2026-11-11 ~04:02-06:38 (coordinator-assigned, owner in ROB RUN; his 17:44 substitution): Compy restarted once with a
  CDP port (`--no-activate`, port 9341), driven in the background, fgwatch 466 reads with Compy never in front, restored
  to a plain launch (teardown CLEAN). Three Trials on real play: exp:8 Ultimate too-noisy, exp:9 visual effects
  too-noisy (second, capped), exp:10 Ultimate no-change; all put back, Synez read back after each. Journey reached its
  end summary (P5 owner half met, friend half open); P4 wording unreachable on ROB RUN (capped inconclusive). Queued
  CR-summary-running-trial, CR-next-reuse-moved. Docs only; evidence `_train\view-1111a\`. Not pushed (owner gaming).
- 2026-11-11 ~06:38-08:10 (coordinator-assigned s15, CODE-ONLY throughout: ROB RUN in front, idle 0 s): landed
  CR-summary-running-trial `0af65ec9` (sonnet APPROVE-WITH-NITS), CR-next-reuse-moved `323cbe31`, and the four
  CR-1102-left owner calls (delegated 2026-11-10): (c) drift-unknown `e3e144e7` (sonnet APPROVE-WITH-NITS), (d)
  update-refusal `8082bf7a` (sonnet APPROVE-WITH-NITS), (a) real-play put-back `aa6f99c2` and (b) gaming extras
  consent `ef59ad5d` (each opus + sonnet, two rounds, no MUST-FIX); CR-vbs-local-eq1 with this line. New tests fail
  on the old code; cargo 1834/0 (24 ignored), clippy clean, tsc 0, full vitest 532/536 (3 site-app suites + one
  census fixed before landing). Queued CR-rp-same-setting-row, CR-gm-confirm-repeat; CR-outside-followups (a), (b),
  (d) parked. Not installed, not pushed (never FULL).
- 2026-11-11 ~08:00-08:50 (coordinator-assigned s16, CODE-ONLY throughout: ROB RUN in front): bundle
  `main-unpushed-2026-11-11.bundle` verified; owner's no-tester statement recorded (`a067f006`); CR-gm-confirm-repeat
  landed `b3aa742a` (full vitest 533/536, the 3 site-app suites; also fixes the affordance census). CR-rp-same-setting-row
  merged then reverted (`c66b4d25`, experiment-record-first guard 2 failed), parked on its branch; CR-outside-followups
  (b) and the core-parking line parked unverified on their branches. Stopped on the coordinator's order after the owner
  reported ROB RUN stutter (my vitest + cargo ran while he played): no heavy commands while a game runs. Not pushed.
- 2026-11-11 s17 (scheduled, CODE-ONLY, ROB RUN in front): no heavy commands per the s16 order; read-only diagnosis
  of the CR-rp guard failure (note under that item); 0 items landed; not pushed (main 61 ahead).
- 2026-11-11 ~14:39-16:15 (coordinator-assigned s18, CODE-ONLY, no game; owner on Discord, idle >= 10 min once at
  15:27): CR-rp-same-setting-row re-landed `1a740e66` (the s16 revert was a misattribution: the 2 record-first guard
  failures were CR-outside-followups (b)'s history.rs refactor, fixed in `db633af9`); (b) landed `3b5480ca` (opus r2
  APPROVE-WITH-NITS); core parking `06b69362` (sonnet APPROVE-WITH-NITS); CR-capture-superseded `4512c1ad` (sonnet
  APPROVE-WITH-NITS); CR-next-moved-outside `2aaac7e3`; CR-undo-kept-plan `6613a053`; CR-zh-drift-count `5d2e9942`;
  CR-update-refusal-path checked, no change; CR-ultimate-identity parked on its branch after two rounds (opus
  REQUEST-CHANGES both). New tests fail on the old code; cargo 1839/0, clippy clean, tsc 0, full vitest 535/538 (the 3
  site-app suites). Push started in the 15:27 window and stopped mid-gate (vitest stage) when the owner returned; not
  pushed, not installed, no screen capture (no later 10-minute idle window).
- 2026-11-11 ~16:10-19:45 (coordinator-assigned s19, CODE-ONLY with FULL windows, no game; server restart ~18:25-19:02):
  CR-bench-holds-setting `cecd30c5`, CR-gm-spans-trial `8bf4a2a9`, CR-ultimate-identity `ec326810` (redesign: stamp by
  provenance, old rows record only on stock schemes), CR-kept-plan-read-once + CR-kept-outside-nits (a)-(d) `0b14d2f3`,
  `94a02d85`, `e954f78b`; "Left for v1.0" pointers `a15986b8`. Two reviews each for A/B (MUST-FIX taken: Trial start vs
  bench hold; GM start race), one for C. cargo 1859/0, clippy clean, tsc 0, full vitest 535/538 (3 site-app suites).
  Pushed 3 times (cecd30c5, 94a02d85, a15986b8; gate PASS each). Installed `a15986b8` (runtime proof attempt 1).
  No screen capture or self-review (no window left). CR-outside-followups (a)(d) not started.
- 2026-11-12 s20 (scheduled, CODE-ONLY: owner active in Explorer): CR-gm-spans-followups (a), an unreadable Gaming Mode
  record's refusal names the file and folder and the way out (commit on this line). cargo 1861/0, clippy clean; review
  (sonnet) APPROVE-WITH-NITS, SHOULD-FIX taken. One item (a mid-run device timeout cost the second). Not pushed: main is
  2 ahead of GitHub (`e5d87456` + this); the next FULL session pushes.
- 2026-11-11 ~20:52-23:45 (coordinator-assigned s20, CODE-ONLY with five FULL windows, no game; server restart
  ~22:31-22:54): CR-gm-spans-followups (c)(d)(e) `4da520ea`, `ba4be8f0` (a plain apply/undo of a setting Gaming Mode
  holds is refused); CR-bench-preapply-read `a2d49422`; CR-tip-see-through-2 `8c2566af`; CR-ultimate-followups (a)(e)
  `fef0a937` ((b)(c)(d)(f) parked); CR-gm-service-suspend-rows `bdd77f41`, `4d7c157d`; P9-gpu-fit-unknowns `15a67af1`;
  P9-ssd-fit-unknowns `6a61e7ce`; CR-gm-skipped-line `e502b93b`, `53b8f843`; CR-live-changes-twice `359da4f7`, `971058dd`. Two
  reviews (opus + sonnet) for each rollback-boundary item, one sonnet for the UI ones; no MUST-FIX. cargo 1869/0,
  clippy clean, tsc 0, full vitest 535/538 (3 site-app suites) per item. Pushed `0afbfb2c` (gate PASS) after
  `ddada688`; installed `0afbfb2c` (runtime proof attempt 1, Synez before/after). Self-review view-1111c (a15986b8):
  FAIL (tip see-through: ancestor opacity) → fixed; view-1111d (0afbfb2c): tip PASS, verdict FAIL on a duplicated
  count (fixed) and wording (CR-view-1111d-wording); teardown CLEAN both times. The 23:00 docs push was stopped when
  the owner returned; pushed `25805ba2` at 23:47 (gate PASS) and installed it at 23:50 (runtime proof attempt 1,
  Synez before/after; not screen-checked); this line's commit pushes next.
- 2026-11-12 ~23:57-01:51 (coordinator-assigned s21, CODE-ONLY with one FULL window 00:03-00:47, no game until ROB RUN at
  01:42; server restart ~00:58): CR-view-1111d-wording `d46b2603`, `75b7e600` (merge `b27552f8`); CR-gm-stop-busy `3664f460`,
  `f80082c2`, `2a83ea3f`, `91a043fb` (merge `ff478b88`); CR-fix-needs-trial-store `28292d57`, `a0aea6a3`, `121872c2` (merge
  `ee0b22b3`); CR-range3-nits (a)(b) `f045f438`, `43f692e0` (merge `8eaa5e1b`; (c) parked). Reviews: A sonnet APPROVE-WITH-NITS;
  stop-busy r1 opus REQUEST-CHANGES (MUST-FIX USB/PCIe with the plan, taken) + sonnet APPROVE-WITH-NITS, r2 both
  APPROVE-WITH-NITS; trial-store r1 opus REQUEST-CHANGES (no MUST-FIX) + sonnet APPROVE-WITH-NITS, r2 both APPROVE-WITH-NITS;
  nits sonnet APPROVE-WITH-NITS. cargo 1873/0, clippy clean, tsc 0, full vitest 535/538 (3 site-app suites) per item. Pushed
  `119d07f8` and `b27552f8` (gate PASS both); installed `b27552f8` (runtime proof attempt 1, Synez before/after). Self-review
  view-1112a: r1 FAIL (contrast/tip evidence, footer), r2 FAIL (footer "Every change reversible" only; P9 lines unverified, no
  limiter on this rig); teardown CLEAN twice; queued CR-footer-reversible, CR-hist-today, CR-zh-backend-home,
  CR-plan-read-prompt-write and four Phase 9 slices. P9-summary-gpu-limit parked UNTESTED on its branch (`64802f38`) when the
  game started. Not pushed: `7bba7d3e` and everything after it.
- 2026-11-12 ~06:50-10:10 (s22, coordinator-assigned, CODE-ONLY nearly throughout; no game seen): landed on main, each
  in its own worktree with a full vitest 537/540 (3 site-app suites) or better: CR-footer-reversible `7dfe87ef`,
  CR-hist-today `f1c4ef7b`, P9-summary-gpu-limit `0e3091a4`, CR-zh-backend-home `28f396e5`, CR-gm-restore-partial
  `90261811`, CR-trial-gm-between `18cf0e58` (finding: a Trial missed Gaming Mode on for one session only; now Partial),
  P9-limit-source `412ca74c`, P9-screen-is-limit `652a0469`, P9-no-upgrade-source `60b5abf2`, P9-retail-firewall
  `02480f59`, P9-summary-no-dead-pointer `b136c126`, P9-summary-screen-limit `c49f37af`; P9-cpu-fit-unknowns parked
  (no CPU block). Finding: Check's upgrade block never renders in the shipped room (P9-upgrade-block-reachable).
  Reviews per item in its row. Two idle windows:
  07:56 (push 1 failed in the gate on the ExperimentBench flake, which passes alone; push 2 killed by PID tree when
  the owner returned) and 09:41 (push 3 killed the same way). Not pushed; no build, install or screen check
  (installed stays `b27552f8`).
- 2026-11-12 ~10:10-12:10 (s23, coordinator-assigned; no game seen; owner's 10:43 rule: push/install need only no game;
  server restart ~11:08-11:30): bundle `main-unpushed-2026-11-12.bundle` verified. Landed, each in its own worktree:
  CR-bench-flake `4d51ba9b` (merge `f2062190`; Depth's mount effect re-closed a door tapped before it ran; 10/10 file
  runs, 2 full vitest 537/540; sonnet APPROVE-WITH-NITS), P9-upgrade-block-reachable `fce48019`, `11a2a2dc` (merge
  `17b23abf`; OptimizeV2, which drew the block under v2Ia, was deleted in `1ab831fb`; sonnet APPROVE-WITH-NITS),
  CR-core-parking-held-with-plan + CR-gm-start-respects-plan-holds `17034899`..`45d27ca3` (merge `46354cbb`; opus r1/r2
  REQUEST-CHANGES without MUST-FIX, sonnet APPROVE-WITH-NITS x2, r3 both APPROVE-WITH-NITS), P9-no-upgrade-cpu-unknown +
  CR-gpu-share-one-source `9009dee1`, `9173e337` (merge `a69eaa1f`; sonnet APPROVE-WITH-NITS); findings CR-footer-undo-path
  (no undo path removed) and CR-restore-window-direct (safe by disjointness); P9-session-on-this-hardware parked.
  cargo 1882/0, clippy clean, full vitest 538/541 (3 site-app suites). Pushes: 1 stopped mid-gate (owner returned,
  before the 10:43 rule), 2-5 PASS (`17b23abf`, `25ddeafa`, `418e5d91`, `a69eaa1f`). Installed `17b23abf` then
  `a69eaa1f` (runtime proof attempt 1 each, Synez before/after). Screen check view-1112b on `a69eaa1f` (background,
  Compy in front 0 of 187 reads): VERDICT PASS (upgrade block not visible on this rig; unit tests only); teardown CLEAN.
- 2026-11-12 ~12:32-14:15 (s24, coordinator-assigned; no game seen; push/install per the 10:43 rule): landed, each in its
  own worktree: P9-session-on-this-hardware (merge `da0aeb46`; sonnet APPROVE-WITH-NITS), CR-footer-ledger-unknown
  in part (merge `1ea41596`; empty-list half dropped: ledger-health-home-guard; sonnet r1, r2 APPROVE-WITH-NITS),
  P9-exit-fixture (merge `6ba0d038`; tests only; APPROVE-WITH-NITS), P9-no-upgrade-named + P9-cpu-gpu-balance (merge
  `2d527abc`; sonnet r1 REQUEST-CHANGES, MUST-FIX taken, r2 APPROVE-WITH-NITS), P9-part-line-context +
  P9-no-session-plain-line (merge `9d2f2b57`; APPROVE-WITH-NITS), CR-view-1112c-zh-gap (this merge). Phase 9 Exit
  finding under its heading (not ticked; Needs owner). cargo 1887/0, clippy clean, full vitest 540/543 (3 site-app).
  Pushes 1, 3-6 PASS (`da0aeb46`, `1ea41596`, `6ba0d038`, `2d527abc`, `9d2f2b57`); push 2 failed in the gate on a
  load flake (glass-rooms.test.tsx:477, queued CR-glass-scroll-flake), retried once as push 3. Installed `9d2f2b57`
  (runtime proof attempt 1, Synez before/after). Screen check view-1112c (background): VERDICT FAIL (Compy in front 3
  of 107 reads; Optimize overflow not measured at 3 sizes; zh space after "。"; upgrade block still unseen: the invoke
  wrap does not take); teardown CLEAN; FAILs queued, the zh one fixed here.
## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] **P2-exit** Phase 2 owner-rig exit (#453): four screens agree live on desk build `2afd7471` (2026-10-24)
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
