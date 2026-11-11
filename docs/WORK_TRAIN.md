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
- **P8-first-advanced** waits on P4's walkthrough (the gate is Trial + Risk proof), then your sign-off on the
  candidate Claude recommends.

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
      2026-11-11 s16: core parking PARKED UNVERIFIED on `claude/train-core-parking-plan` (`c9e7d511`, leftovers.rs only):
      flag 100% only on stock Balanced (class or, for old probes, words); custom/unread plans not flagged; test added.
      Outstanding: cargo test (`leftovers::`), clippy, one sonnet review, merge.
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
- [ ] **CR-rp-same-setting-row** (r1 SHOULD-FIX of owner call a, opus + sonnet; pre-existing on the two-session confound
      path) When another Compy row applies the Trial's own setting while it runs, the confounded restore writes the
      Trial's pre-test snapshot and that newer row still reads "applied" while the setting reads off. Refuse a second
      apply of a change a running Trial holds, or settle the newer row with the restore (history.rs
      `rollback_change_inner`). Rollback boundary: two reviews.
      2026-11-11 s16 PARKED on branch `claude/train-rp-same-setting-row` (`3a64091a`, `c4033f99`): UI apply/batch
      commands moved to experiment.rs wrappers that refuse a setting an open Trial holds (store gate, checked read).
      cargo 1836/0 + clippy clean; opus and sonnet r1 APPROVE-WITH-NITS, no MUST-FIX. Merged as `638926e6` then
      reverted (`c66b4d25`): a later full vitest showed `src/experiment-record-first-guard.test.ts` 2 failed (likely its
      source-shape reads of experiment.rs vs the new `apply_recommendation` wrapper; not yet read). Next, with no game
      running: `npx vitest run src/experiment-record-first-guard.test.ts` in the branch worktree, fix, then the full
      vitest, cargo test, clippy, merge. Follow-ups found: benchmark tweak trial holding a setting; Gaming Mode spanning a
      Trial restore (opus r1).
      2026-11-11 s17 (read-only, ROB RUN in front): the new wrappers sit above `start_experiment`, so the guard's
      `fnBody(start_experiment)` slices look unaffected; the 2 failing assertions are still unidentified. Running the
      single file needs a no-game window.
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
- [ ] **CR-ultimate-identity** (owner call + mutation-gate: `actions.rs`) `apply_power_ultimate` finds the Ultimate
      plan by its English name and otherwise duplicates it under a NEW GUID with a localized name, which then classes
      as Other: on a localized Windows the rec reads off after a successful apply and the verify can fail. Record the
      applied scheme GUID on the receipt (an AppliedAction/Snapshot change) or compare against the duplicate's source.
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
      2026-11-11 s16: (b) PARKED UNVERIFIED on `claude/train-outside-followups-b` (`6b566221`, `59d40019`, rebased on the
      then-main incl. the since-reverted rp merge: rebase onto main again first). Readiness counts a recorded row whose
      plan still holds as kept, not drift (only `applied_changes_summary_checked` reads the plan; `summarize_history`
      unchanged, test-pinned); view field `changed_outside_holds`; History says "changed outside Compy" + note; not a
      "turn it back on" drift. r1 opus + sonnet REQUEST-CHANGES (MUST-FIX: TS kept without holds/off check; dead
      `checked_summary` under clippy) both fixed; r2 sonnet APPROVE-WITH-NITS (plan read on the UI thread: gated to
      recorded-off rows in `59d40019`); r2 opus killed before it answered. Proven: cargo 1837/0 + clippy clean on the
      pre-r2 commit; TS tests fail on old code. Outstanding: cargo test + clippy on `59d40019`, full vitest, opus r2,
      merge. (a), (d) not started (no time to show the one-change check gets no weaker).
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

### Before deadlines
- [x] **fflate** 0.6.11 `53a1c9de`; dev-only body-parser/zod advisories cleared (shadcn 4.22.1) `89fc1add`.
- [x] **tokio** `fcc64291` (1.54.1; only tokio's lock entry changed). Desk install at the next ship.
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime` (FULL mode only), update
  `RELEASE_STATE.md` in the same commit, report what is visible, and summarise the week from the Session log.

## Session log
- 2026-11-10 ~11:10-11:40 (scheduled, CODE-ONLY, owner on Discord): CR-dual-channel `ad5074ac` (4 new readiness tests
  proven failing on the old logic; review r1 APPROVE-WITH-NITS, 3 SHOULD-FIX taken in `0c2912ce`, r2 APPROVE-WITH-NITS)
  and CR-vbs-running `b2ed0cca` (review r1 APPROVE-WITH-NITS, nothing queued). cargo test 1795/0, clippy clean (idle
  priority, shared target dir). Reviews ran as `claude -p --model sonnet` on the diff (no Agent tool in this session).
  Not pushed (CODE-ONLY); the next FULL session pushes local `main` through the gate.
- 2026-11-10 ~11:38-12:15 (scheduled, CODE-ONLY, owner in Firefox): CR-care-silent `e77fba1e`..`263e0768` (doc
  `55c04296`; App-wiring vitest proven failing on the old App.tsx; review r1 3 SHOULD-FIX taken, r2 2 queued as
  CR-care-line-truth) and CR-slow-async `9cab29d0`, `27c10a75` (9 commands off the main thread; capture start parked
  as CR-capture-async; review r1 APPROVE-WITH-NITS, SHOULD-FIX taken). cargo test 1804/0, clippy clean, tsc 0, full
  vitest 532/535 files (the 3 site-app suites need site-app/node_modules, absent in a worktree; pass on main).
  Reviews ran as `claude -p --model sonnet`. Not pushed (CODE-ONLY).
- 2026-11-10 ~12:10-12:45 (scheduled, FULL, owner idle in Firefox): pushed local `main` first through the pre-push
  gate (`776345f7..4c58fbed`, exit 0). Then P9-hint-shown `4a4265d4` (session hint shown under Check's limiter rows),
  CR-care-line-truth `49213302` (per-choice save tracking; stopped line after the last retry) and CR-pagefile-multi
  `a4c2690d` (multi-row pagefile note says not one-click; review r1 APPROVE-WITH-NITS, SHOULD-FIX queued as
  CR-pagefile-note-refusals). New tests proven failing on the old code (1 + 3 + 1). tsc 0; full vitest 532/535 files,
  9687 tests (the 3 site-app suites need site-app/node_modules); cargo test 1805/0, clippy clean (idle priority).
  Review ran as `claude -p --model sonnet` on the diff. No screen check or install this session. Pushed with this
  line through the gate.
- 2026-11-10 ~12:45-13:20 (scheduled desk install, FULL at start, owner idle in Firefox): built `68f2272b`
  (no-updater config) and installed it with ship-reinstall -VerifyRuntime (runtime `68f2272b · release`); RELEASE_STATE
  re-stamped `2962ad35` (verify-release-state 0 state-drift). Screen check: Check's session hint, VBS running now,
  dual-channel (`_train\view-1110\`). Exit proofs: P6 partly driven (crash + stutter next steps from Home, no
  WARDOGS crash on record), P4/P5 blocked by the owner's open PBZ Trial exp:6, P7 needs the friend. A first push
  was stopped mid-gate when the preflight showed input at 12:58 (idle 107 s); pushed with this line once idle again.
- 2026-11-10 ~13:10-13:45 (coordinator-assigned desk session, FULL): queued + landed CR-stutter-rollback-improved
  `895d253e` (an improved comparison no longer offers to roll back the change it measured; owner data read-only) and
  CR-pagefile-note-refusals `da22a28b` (every refused pagefile layout says not one-click, with why); queued
  CR-stutter-rollback-trial from review. CR-zh-dial PARKED: by-size fit conflicts with the 13px floor (note under the
  item). cargo test 1807/0, clippy clean; both new tests proven failing on the old code; reviews (sonnet, r1)
  APPROVE-WITH-NITS x2. No install, no screen check. Pushed with this line through the gate.
- 2026-11-10 ~13:40-14:10 (coordinator-assigned desk session, FULL): landed CR-zh-dial `1bc687e6` (ArcGauge counts a
  CJK character as two cells, so the zh safe-stack unit sits beside the label; 13px floor kept; visual check due at the
  next FULL install session), CR-stutter-rollback-trial `d7004a9a` (a regression on a change a Trial kept names both
  results and still offers the rollback) and CR-capture-async `25af5dc5` (capture start/stop off the main thread under
  one lock). Each new test proven failing on the old code; cargo test 1810/0, clippy clean, tsc 0; reviews (sonnet, r1)
  APPROVE-WITH-NITS x2, every MUST/SHOULD taken. One timing-race test (comparison_race_tests) failed once under load
  beside a vitest run, passed alone and on the rerun. The first push's gate caught test-room-parity-guard 5/5b pinning
  ArcGauge's old unit text; re-pinned to the width rule `6d189c19` (same property). No install, no screen check.
  Pushed with this line through the gate.
- 2026-11-10 ~14:10-14:40 (coordinator-assigned desk session, FULL): #669, #668 and #677 were already fixed and pushed
  (`2b1cd3f1`/`06e81e25` merged `e83017a5`; `4d5316d0` merged `3c3e7553`); re-proved on `1f4ed7a1` (their 10 cargo tests +
  3 vitest files / 87 tests green) and closed on GitHub naming those commits. Built `1f4ed7a1` (no-updater config) and
  installed it with ship-reinstall -VerifyRuntime (runtime `1f4ed7a1 · release`); RELEASE_STATE re-stamped (verify 31/31 ok,
  0 state-drift; the installed-stamp scan SKIPs because a GUID literal abuts the stamp in rodata). Screen check
  (`_train\view-1110b\`): zh safe-stack dial, stutter "Undoing it isn't suggested" with no rollback button, #677 rows;
  sonnet self-review FAIL on the Live term tip showing text through it -> queued CR-tip-see-through. Language restored.
- 2026-11-10 ~14:30-15:20 (coordinator-assigned desk session, FULL): CR-tip-see-through `0ab041dd` (tip ground
  `--v2-panel-pop` 0.96 + blur; term-style-guard fails on the old 0.74; src/design + monitor + glass vitest 97 files /
  1150 passed, tsc 0); #663 `5993d0ec` (ROADMAP done-when table, derived Exit lines for Phases 9-11, "What v1.0
  means"; BACKLOG's #583 lanes ticked; 10 docs-guard files green, doc-budget ALL PASS, verify-release-state 31/31);
  CR-1102-left triaged: 15 already fixed and struck, 0 fixed now, 4 owner calls under Needs owner, 11 engineering
  lines left open. Three WORK_TRAIN SHAs were mistyped (`c552354c`/`7e69760c`/`0f0cb0bb` are `c5523543`/`7e697609`/
  `0f0cb0ba` on main). `5fb37609..5993d0ec` pushed through the gate (cargo 1810/0); #663 closed naming `5993d0ec`.
  No Rust, no install; tip visual re-check due at the next FULL install. Pushed with this line.
- 2026-11-10 ~17:44-19:16 (coordinator-assigned, owner in ROB RUN; his 17:44 decision: ROB RUN for WARDOGS, drive Compy
  while he plays): Compy restarted once with a CDP port (no focus taken), restored to a normal launch at 19:15. PBZ exp:6
  concluded by Compy (confounded, restored, read-back verified). P4/P5 on ROB RUN: three real-play as-is sessions, both
  journey baselines uneven at the cap, Trial start refused (CR-unconfirmed-remedy, CR-refuse-early queued). P6 owner half
  re-checked for ROB RUN. Nothing ticked. Docs only; evidence `_train\view-1110d\`. Not pushed (preflight CODE-ONLY).
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
## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] **P2-exit** Phase 2 owner-rig exit (#453): four screens agree live on desk build `2afd7471` (2026-10-24)
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
