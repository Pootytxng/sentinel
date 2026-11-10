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
- ~~**Old scheduled task** "#678 check-in 1/3…"~~ deleted 2026-11-04 03:14 by Claude on the owner's "yes please"
  (a one-shot reminder bound to a closed session, hidden from his task list; the delete needed his go-ahead).
- **The four exit walkthroughs** (P4–P7 below, all code landed; each closes only on your rig, next FULL session
  installs the build first): P4 — Test room, run Trials on WARDOGS (one tap each, ~10 min a session) until the panel
  says "Compy finished the supported tests"; P5 — Optimize, "Optimize my game", play, read the summary, no manual
  Trial clicks (~25 min); P6 — Home → "Something's wrong", follow a WARDOGS crash and a stutter to one next step
  (~5 min); P7 — your friend asks Home for more FPS, a stutter and a crash without asking what a word means (his
  ~15 min). Each is recorded in BACKLOG as that phase's exit.
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
      What it found and left, each a decision or a UI study rather than a quick fix: drift notices stay up while a
      check reads unknown; a Trial delta on a 0 or NaN baseline (older records only); `has_pending_contract` refuses
      on any leftover temp file; one ledger row a downgraded build can't parse fails the whole ledger; a partial
      batch apply carries no flag over IPC; nothing stops a double apply of one change; real play keeps a change
      after an OtherChange or Conditions stop (owner call); ~~the experiments, sessions and noise stores still
      overwrite an earlier `.corrupt`~~ (fixed `c127ce9`, `14d39b5`: a second damaged file keeps the first set-aside,
      the intelligence store too; one that can't be set aside refuses the read); ~~a session under 600 samples leaves
      an armed comparison waiting with no line saying why~~ (CR-cmp-wait `e01561f7`); ~~the Lab's "measured together" count still counts rows
      from another PC~~ (fixed `8ef5772`). Slice 6: Care's first-ever
      scan seeds an empty world when its readers fail; a crash's vitals come from the whole capture window, not the
      game's own; Black Box, export and capture start run on the UI thread; a wedged old FPS helper can clear the new
      one's running flag; a Care state that can't be read or written stays silent with no support event. Slice 7
      (advice): a service that is only stopped still reads as Compy's change (its start type is unread); the
      power-plan, core-parking and bcdedit checks match English words, so a localized Windows misreads them; ~~one peak
      GPU sample over 95% still reads as "the GPU was the bottleneck", with purchase links~~ (P9-bottleneck-sustained);
      the slow probes
      (leftovers, readiness, priorities, diagnostics, Trial candidates) run as sync commands. Slice 8 (screens): the
      GPU view's Global/Per-game picker changes nothing anything reads (remove it, or wire it); after the one-time
      consent, newly ticked UAC tiers and service suspends start with no fresh confirm; the GPU profile labels and
      the setup lessons are English in zh-CN; the tour waits on "Running checks" forever if the scan rejects (a panic
      only); App's banner wiring (the pane-close re-read, the Resume failure) and its refresh guard are tested
      through their helpers only (App has no render harness); a session's peak stays ungraded only when DXGI shows an
      NVIDIA adapter (a TCC compute card only NVML reports is missed); App's and Home's walkthrough and tuning vendor
      is still the first DXGI adapter, not the primary GPU. Desk reviews: with unread checks, Home's ring note still
      carries "N couldn't be read" and wraps past two lines at 1280x720 (the advisory aside left the ring for that
      reason); Live's session strip floors durations (3h 28m) where History and Games round (3h 29m). Unsure:
      `elevate_and_wait` waits with no timeout while the ledger is locked; core parking flags any non-performance
      plan with minimum cores at 100; a system-managed pagefile may print "Fixed at 0-0 MB"; VBS is read as
      configured, not running; two modules are called dual-channel whatever their slots; drive health and memory
      speed or channels never rank as limiters.

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
- [ ] **CR-zh-dial** (desk review 2026-11-04, pre-existing) In zh-CN the Test room's safe-stack dial label "已启用" collides
      with the ring stroke and ticks (en "ON" fits): fit the zh label inside the ring (a shorter string or a smaller size)
      and add a zh-width guard. TS/CSS; screen check at a FULL session.

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
- [ ] **CR-pagefile-note-refusals** (from CR-pagefile-multi review r1) The "Pagefile disabled" finding (no rows) still
      notes "Safe to restore to automatic", but the restore refuses zero entries too (`parse_manual_pagefile_entry`);
      check the `?:`-form single row the same way. Same non-mutating fix: say it is not one-click and the Windows
      steps. Rust (leftovers.rs); one review.
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
- [ ] **CR-capture-async** (parked from CR-slow-async) `start_fps_capture` off the main thread. It waits up to 5 s for
      an old helper and launches the elevated one; off the main thread it could interleave with
      `stop_fps_capture` (a stop landing mid-wait would be overtaken by the start). Serialize start and stop
      under one lock first, then make both async; test a stop during a start's wait leaves capture off.
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
- 2026-11-02 ~22:45 to 11-03 ~00:45 (interactive from Claude HQ; owner: "well continue witha peristent full
  codebase review and fix and any other details you find need resolving"): the codebase review, slices 1-6, landed
  from `claude/train-review-1103` (`8f4037c1` stores never saved over after a failed read, the ledger set aside only
  on a parse failure and synced, Gaming Mode's start proves its root, the comparison gates, the Nagle refusal;
  `445c1baa` its round-1 follow-ups; `508b200f` the frontend fixes with GL-faint-ink, P8-label-ink,
  GL-shell-overflow, P8-off-progress and P8-launch-flash) and `-1103b` (`4465e74b` Care toasts, the support export
  and captures; `16479f4b`). Merges `1d9c7abb` and `93c3ff0a`. Rust: each branch reviewed twice, no MUST; frontend:
  a logic review (9 MUST, all fixed) and a round 2 with no MUST. Desk review on his data PASS on `1d9c7abb` (339
  Problems quiet lines and Test's quiet labels at 5.08:1 or more; no shift on a deep-link scroll; the risk picker
  held through the 2.7 s flash); `-1103b` changes nothing on screen. Desk build `93c3ff0a` installed
  (`ship-reinstall.ps1 -VerifyRuntime`, proof `93c3ff0a · release`); pushed with this line through the pre-push
  gate. What the review left is CR-1102-left. The lane line (`87656201`) was never pushed: kept on
  `keep/lane-87656201`; scheduled sessions may write again. Owner played; every launch was --no-activate on his
  second monitor.
- 2026-11-03 ~01:00 to ~08:07 (interactive from Claude HQ, the same ask): the codebase review's slices 7 and 8 landed
  from `claude/train-review-1103c` (`22d23584` advice that reads the machine honestly; `e50cc1e9` screens that say
  what Compy read: GPU temperature from the named GPU's own sensor, never coloured from NVML, check counts that name
  unread and advisory checks, Gaming Mode's leftover contract, Learn, the investigator, the GPU before/after; the
  review rounds' follow-ups through `cd9e11c0`, with the GPU driver fields re-read in-session and three CR-1102-left
  items). Merges `e2de00db`, `feb2e699`, `c152a383`, `49126983`, `fe2f6f82` (a script-only revert), `60a86db2` and
  `50ceb38c`. Rust and frontend each reviewed twice, no MUST left. Desk self-review PASS 12 of 12 on `50ceb38c` with
  his data, after five desk reviews (`e2de00db` to `60a86db2`) failed and were fixed. A Compy started from the Claude
  app's Desktop Commander reads an overlay copy of its WebView2 profile (his picks); his own launches and
  ship-reinstall's read the real one: nothing lost. On his call his settings became the only copy at 08:47 (the side
  copy and the old store are kept in `C:\Users\Kuya\code\_train\merge-backup-1103`) and Claude's launches go through
  the ship launcher (self-reviewer rubric). Desk build `50ceb38c` installed (`ship-reinstall.ps1 -VerifyRuntime`,
  proof `50ceb38c · release`); pushed with this line through the pre-push gate. What the review left is CR-1102-left.
  Every launch was --no-activate on his second monitor.
- 2026-11-03 08:43-08:55 (scheduled, FULL, owner idle on Discord): queue refill (six slices from CR-1102-left and
  Phase 9); CR-live-round (tsc 0; vitest src/surfaces+design+data 283 files / 4074, exit 0; 3 tests fail on old
  code). TS display only, no review. Not landed by that session: at 08:51 an interactive session committed `2471184f`
  to main and the owner came back (preflight BUSY, idle 0 s), so its three commits waited on `claude/train-live-round`;
  the 09:18 HQ session cherry-picked the code as `8be87e12` and folded the queue refill and this line into its own
  docs commit (the branch's docs commits restated the CR-1102-left overlay note that `2471184f` had already closed).
- 2026-11-03 ~09:18 to ~12:35 (interactive from Claude HQ; owner: "ensure everything here that's actually deemed
  necessary is completed by you alone", in WARDOGS throughout): from `claude/train-hq-1103`: the 08:43 refill's slices
  (CR-tour-reject `a60b8068`, CR-ring-note `5e8cf37a`, CR-zh-gpu `eddf6c7e`), P9-bottleneck-sustained `88f15e9a` /
  `3ed24a87` / `14d39b55`, P9-software-first `023da7d7`, P8-ack-enforce `81a9f14d`, P8-dims-grades `b46f2c6a` /
  `14d39b55`, two CR-1102-left lines (`c127ce9b` stores, `8ef5772c` Lab count); review r2 `14d39b55`, the lock-order
  guard's new back edge `df636307`, clippy `388f2d73`. Proof: tsc + vite build 0 errors; full vitest on `8ef5772c`
  509/534 files, every failure environment-only (site deps, shallow clone, pwsh, Windows paths) except the lock-order
  guard, fixed and 41/41 at head; desk cargo test 1769/0 and clippy clean on `388f2d73`, run at idle priority with a
  shared target dir while the owner played (no FPS cost he reported). Rust review: one rust-tauri-reviewer round over
  the four items (approve / approve / request-changes → fixed / approve-with-nits, every SHOULD taken). At 12:51 the owner said he was only
  in the lobby and to complete everything, so FULL from there: desk build `ba332a25` installed 12:56 (proof `ba332a25 · release`);
  desk self-review round 1 on his data FAIL on five findings (trace axis floored minutes above an hour; recap tabs, a placeholder
  part name and the GPU profile summary English in zh-CN; the seatbelt step naming the retired "Lab" tab), fixed in `71f1df93`
  (rebased over the 13:43 session's `e01561f7` / `e99a7a5c`), built and installed 14:03 (`ship-reinstall.ps1 -VerifyRuntime
  -ExpectedCommit`, proof `71f1df93 · release`, installer `9E9C4A43…`). Round 2 of the desk review on `71f1df93` PASS 12 of 12 (a usage
  limit paused the lane 14:10-19:43; CR-cmp-wait's positive case is unreachable on his data). The gate then caught two things and both
  are fixed: the debrief's pinned mount lookups lacked CR-cmp-wait's `get_armed_comparison` (`d3b126c9`), and `useScan` let the mount's
  rejected scan land its failure after a re-run's success (flaky 1 in 8; the newest scan owns the state now, test fails on old code).
  Pushed through the gate with this line. Lane line removed. The #678 scheduled task could not be turned off
  from here (the task tools refuse Claude); walkthroughs P4–P7 and P8-first-advanced stay the owner's, named under
  Needs owner with clicks and minutes.
- 2026-11-03 PM (scheduled, CODE-ONLY, owner in a game): queue refill (5 ready slices from CR-1102-left); CR-cmp-wait
  `e01561f7` (tsc 0; vitest 10 files / 116 passed; new test fails 2/5 on old code); stale `train-live-round` worktree
  removed (its work is on main as `8be87e12`). NOT pushed (main ahead of GitHub), NOT installed: the next FULL
  session pushes through the gate, builds, installs and does the screen check.
- 2026-11-04 (scheduled, CODE-ONLY, owner in PBZ): CR-trial-zero-base `4d5595fd` (rebased over `1e9ce481`); tsc 0;
  ExperimentBench 161/161; the 3 new cases fail on main's code. TS display only, no review. One item only; no cargo
  mid-game. Log trimmed to the newest 14. Not pushed (CODE-ONLY; main ahead of GitHub); next FULL session pushes.
- 2026-11-03 ~19:43 to 11-04 ~02:20 (interactive from Claude HQ, resumed after the usage limit; owner: "continue from where u
  left off", then 01:47 "can you complete the last task"): the day's `main` pushed through the gate at 20:32 (`8be87e12..6958e512`)
  after two red runs it was right to refuse: the debrief layout guard lacked CR-cmp-wait's `get_armed_comparison` (`d3b126c9`) and
  `useScan` let a late older scan overwrite a newer one (flaky 1 in 8; fixed, test fails on old code, `6958e512`); a third red was a
  race with the 19:43 session committing mid-gate. Desk self-review round 2 on `71f1df93` PASS 12 of 12. Then, on the owner's ask,
  desk build `6958e512` built and installed 01:50 (`ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`, proof `6958e512 · release`,
  installer `3490A339…`), desk self-review PASS 12 of 12 (CR-trial-zero-base's branch unreachable on his records; no row regressed).
  RELEASE_STATE row re-stamped; pushed with this line through the gate. Lane branch deleted locally and on origin. Open for the train:
  CR-gpu-picker, CR-primary-gpu, CR-stopped-service, CR-localized-reads. Disclosed: the 13:26 force-close of Compy by the round-1
  reviewer ended that live PBZ measurement; `fps.alive` stayed absent while the same PBZ process kept running, so the running Trial
  exp:6 collected nothing since — it resumes on the game's next launch.
- 2026-11-04 ~03:12 to ~04:40 (interactive from Claude HQ; owner 03:12: "yes please complete all of those required task you
  mentioned before"): the #678 reminder deleted (03:14, on his go-ahead); the four CR slices of the PM refill landed from
  `claude/train-hq-1104` — CR-gpu-picker `7e69760c`, CR-primary-gpu `0f0cb0bb`, CR-stopped-service `c552354c`,
  CR-localized-reads `5e2a110d` with its review fixes `aded8095`..`e3d3b7fd`; tsc 0, touched TS suites and the census,
  locale, orphan-key and copy guards green; one rust-tauri-reviewer round (A approve-with-nits, B request-changes → all
  taken); desk cargo test 1775/0 and clippy clean on `e3d3b7fd`. Desk build `e3d3b7fd` built and installed 04:06
  (`ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`, proof `e3d3b7fd · release`, installer `0AC22D2F…`); desk
  self-review PASS 12 of 12 (his Ultimate plan is a /duplicatescheme copy, so it classes Other and the English words still name it — the exact gap CR-ultimate-identity queues); one pre-existing zh-CN defect found and queued (CR-zh-dial). Three follow-ups queued (CR-service-batch, CR-ultimate-identity, P9-hint-shown). RELEASE_STATE
  row re-stamped; meant to be pushed with this line through the gate, but it never reached GitHub (corrected
  2026-11-04 08:58: GitHub `main` still `0b0f6afe`, local `main` ten commits ahead, `c631989a..261c6af4`). Lane line removed.
- 2026-11-04 ~08:30-09:05 (scheduled, CODE-ONLY, owner using the PC): CR-service-batch `3cdfc782` (fast-forward onto
  `main` with this line's commit); cargo test 1781/0, clippy clean (idle priority, shared target dir); one rust-tauri-reviewer round, no
  blockers, both SHOULD-FIX taken inline. Queue refill: five slices (CR-pagefile-0, CR-dual-channel, CR-vbs-running,
  CR-slow-async, CR-care-silent). One item only. Not pushed (CODE-ONLY): local `main` was already ten commits ahead of
  GitHub (the 03:12 line above said pushed; it wasn't); the next FULL session pushes it all through the gate.
- 2026-11-04 ~10:50 (Claude HQ lane, owner in PBZ; gate at idle priority, no install): the 08:43 session's
  CR-service-batch (`3cdfc782`) had not been through the gate and broke two record-first guards (the probe's
  rec list and the reconcile's call read `probe_rec_target`, now a one-line call into `probe_rec_target_with`);
  the read-only check passed on that one line while `LiveReads::service_disabled` still called
  `actions::service_info`. Guards follow the probe to `probe_rec_target_with` and `service_disabled` (the new
  check fails on `330235ad`); a non-catalog service name reads through `hardware::service_state_and_start_mode`.
  The lane branch `claude/train-hq-1104` (`9a7902a`, the same fix on the pre-batch code) is superseded and
  deleted. Installed build stays `e3d3b7fd`; the Friday desk install picks up main.
- 2026-11-10 ~11:00 (scheduled, CODE-ONLY, owner in ROB RUN): CR-pagefile-0 `258b438f`; cargo test 1784/0, clippy
  clean (idle priority, shared target dir); the first three new tests proven failing on the old code; one rust-tauri-reviewer round
  APPROVE-WITH-NITS, SHOULD-FIX 1 (half-zero row) taken, SHOULD-FIX 2 pre-existing and queued (CR-pagefile-multi). One
  item only. Not pushed (CODE-ONLY); the next FULL session pushes local `main` through the gate.
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

## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] **P2-exit** Phase 2 owner-rig exit (#453): four screens agree live on desk build `2afd7471` (2026-10-24)
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
