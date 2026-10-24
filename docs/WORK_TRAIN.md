# WORK_TRAIN.md — Compy's standing work queue

**Authority:** `OWNER_DIRECTIVE_2026-10-23.md` (owner decision). This file is the one queue the scheduled
work sessions pull from. It is execution order only; product direction stays in `PRODUCT_CONSTITUTION.md`
and `product/ROADMAP.md`, build/install truth in `RELEASE_STATE.md`.

**Testers (owner, 2026-10-23):** the owner and one trusted friend. No wider beta. Optimize for the owner's
rig first; anything shipped to the friend goes through the normal updater.

## How a session runs (every scheduled run follows this)

1. **Sync and check.** In `C:\Users\Kuya\code\sentinel`: `git fetch`, fast-forward `main`, `git status`
   clean. If a `claude/train-*` worktree exists with unpushed commits, finish that item first.
2. **Pick.** Take the first unchecked item in **Queue** whose "Needs" is met. Skip items marked
   `owner` unless the owner is present in the conversation.
3. **Branch.** New worktree `.claude/worktrees/train-<item>` on `claude/train-<item>` from `origin/main`.
4. **Do it, smallest slice that proves something.** Product code and tests only (directive rule 1).
5. **Prove it.** `npx tsc --noEmit`, `npm test`, `cargo check` (and `cargo test` when Rust changed) in the
   worktree. UI change: screenshot it. Machine-touching change: verify on the real PC (read back the
   setting).
6. **Review.** Rust, privilege, rollback, or measurement changes get one independent review pass
   (fresh agent, diff only). Two rounds maximum (rule 3). Copy-only or test-only changes skip review.
7. **Land.** Merge to `main` locally and push (the pre-push gate is the check). Delete the branch and
   worktree. Tick the item here in the same commit, with the commit SHA.
8. **Report.** End the session with three lines (rule 7): what you can see now / what changed under
   the hood / what I need from you. Keep everything else out of the report.

**Stop rules.** A full-screen game is in front, or the owner is using the PC → no UI driving, no installs;
code-only work is fine. A gate fails twice on the same cause → stop, write the blocker under the item,
move to the next item. Never change Windows settings outside Compy's own apply/rollback. Never publish a
release, sign, or touch credentials (owner territory).

## Queue

### Now — finish what's open
- [ ] **P2-exit** Four-screen agreement check on the owner rig (#453): Health, Test, History, Live
      agree on machine truth. Needs: PC idle (computer use). Record in `BACKLOG.md` P2.
- [ ] **PR-sweep** Product PRs: review once and land or close #673 (honest unknown FPS), #666
      (data-root tests), #661 (debrief unmeasured), #627 (ledger write announce), #604 (TS coverage).
      Process PRs (#685, #679, #654, #644, #642, #606, #605, #492, #471, #470, #464): close with a
      one-line "parked under OWNER_DIRECTIVE_2026-10-23" comment.
      Progress 2026-10-23: process PRs closed; #673 landed (fix 88bec9ad, sparklines too);
      #666 landed (merge of 68e3c215, data_root 23/23 on main).
      2026-10-24: #661 landed (merge of e1cf6f96; Debrief shows "—" + Not graded for unmeasured FPS,
      jsdom 58/58 + Chromium layout 6/6). Next: #627, #604.
- [ ] **WT-prune** Remove the 17 remaining worktrees whose commits already exist on main or on GitHub;
      bundle any unique commits first (pattern: `_archive/compy-sessions/worktree-salvage-2026-10-23`).

### Next — bugs a real user would hit (from the Sep 29 Trial batch)
- [ ] **#631** Rollback that ran but couldn't save reads as a failure.
- [ ] **#616** Roll back an apply whose receipt can't be built or saved (orphan change).
- [ ] **#617** Multi-write applies leave partial state on a mid-apply failure.
- [ ] **#619 / #621** Ledger writes outside App don't refresh the other screens.
- [ ] **#629** Test → Benchmark claims no baseline while one exists.
- [ ] **#628** Trial start note says another change is active after a same-setting rollback.
- [ ] **#669 / #668** Active-change and attribution counts collapse to 0 on a failed ledger read.
- [ ] **#645 / #608 / #671** Unmeasured FPS still shown as a number anywhere (close any already fixed).
- [ ] **#622** Health layout below ~600 px.
- [ ] **#677** Clipped session metadata and combined-effect tooltips.
- [ ] **#638** Phase 2 follow-ons from PR #634.
- [ ] **GB-picker** `game-bar-disable` not offered in the Trial picker on the owner rig with both
      values = 1 (seen 2026-10-23 07:46 on a fresh Compy). Reproduce, then fix or close.
- [ ] **#686-followup** One `LiveReads` per Trial start instead of one PowerShell spawn per row.

### Then — Roadmap Phase 4: Optimization Engine v1 (`product/OPTIMIZATION_ENGINE.md`)
- [ ] **P4-plan** Read the engine contract and Trial Protocol; write the first three slices as queue
      items here (each one user-visible and testable on the owner rig). Outcomes in scope: Recommended /
      Maximum FPS / Smoothest frame pacing.
- [ ] **P4-noise** Measure this game's run-to-run noise floor on the owner rig, so Trial verdicts stop
      using the fixed 3% default ("this game's own run-to-run noise hasn't been measured yet").
- [ ] **P4-sessions** Trial sessions shorter than ~10 min of comparable gameplay get a "too noisy" verdict
      instead of a Slower/Faster call.

### Before deadlines
- [ ] **fflate** Update to 0.6.11 (production dependency) before its acknowledgement expires 2026-12-31.
- [ ] **tokio** `cargo update -p tokio` 1.52.3 → 1.54.1 with `cargo test` and a desk install.

### Every Friday (scheduled separately)
- Build `main`, desk-install via `scripts/ship-reinstall.ps1 -VerifyRuntime`, update `RELEASE_STATE.md`
  in the same commit, and report what is visible.

## Done
- [x] Owner directive, release-ledger reconcile — `52865562` (2026-10-23)
- [x] #620 Trial read-back (PR #686) — `9470b437`; desk install recorded — `ba587842`
- [x] Phase 3 owner-rig exit: first live Trial + kill-mid-start check — `d1a5204d`, `39b591d6`
- [x] #672 supply-chain gate (tokio RUSTSEC-2026-0386 acknowledged) — `b06c257d`
