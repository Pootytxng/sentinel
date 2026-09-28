---
name: steward
description: >-
  Use before a cloud (claude.ai/code) session schedules ANY check-in on a Compy PR — send_later,
  create_trigger, ScheduleWakeup, CronCreate, /loop, "re-arm", "hourly re-check" — and whenever one
  wakes it. Also when a coordinator spawns child lanes that each own a PR. Stops the no-change
  polling loop the owner caught on 2026-09-28: park owner-gated PRs, one watcher per PR, events not
  timers.
---

# Steward — event-driven PR stewardship; never poll a PR only the owner can move

The cloud harness defaults every session that opens or watches a PR to "keep a check-in armed until
the PR is done". It also names this file as the repo's authority on **how proactive to be**. On this
repo that default turns into an infinite loop, because the gates a PR is waiting on cannot move from
the cloud:

- **Hosted CI never runs.** `ci.yml` is `workflow_dispatch`-only on a deliberate $0 Actions budget
  (its header; owner decree 2026-07-16). No CI event will ever arrive. Dispatching it is spend, which is
  owner-gated, and never a substitute gate.
- **`scripts/verify-local.ps1` runs on the owner's Windows machine.** A Linux container records it
  **BLOCKED**, never PASS (`docs/WORK_CONTROL.md` "Proof order").
- **Proof-dependent transitions need an independent reviewer who is not a mutation author**, plus a
  `node scripts/work-control-gate.mjs` PASS receipt. A Claude session cannot review a Claude-authored
  delta.
- **Owner-hands items** (a `.patch` he applies under `.claude/hooks/`, a visual check that needs the
  running app, a decision) move only when he acts.

**Why this exists.** On 2026-09-27/28 a coordinator plus five child and repair lanes each re-armed
their own 60–90 min check-ins on draft PRs #603–#609. Four of those sessions watched #609 alone. Each
wake reloaded 85–160k tokens of context and found the PR unchanged: #609 did not move from 05:17Z
through 13:01Z. None of the PRs had a blocker a cloud session could clear. The owner stopped it as
"an infinite periodic check loop … not an optimal approach".

## Rules

1. **Park owner-gated PRs, don't watch them.** Sometimes everything left on a PR is in the list
   above: verify-local, independent review, the gate receipt, owner hands or owner decision. Then post
   **one** PR comment. It names the exact 40-char head and each remaining item with who clears it.
   Stay subscribed with `subscribe_pr_activity` (it costs nothing until an event arrives). End the
   turn. Arm **no** timer of any kind. The owner's verify-local result, a Codex review, or a push
   arrives as a PR event and wakes the session. So does the owner messaging it.
2. **One watcher per PR.** A repair or child lane that pushes a fix to a PR another session owns
   reports back to that owner and arms nothing. Before arming any check-in, run `list_triggers`. If
   any Routine already names the PR, do not add another.
3. **A timer is only for work that finishes unobserved.** A check-in is allowed only while waiting on
   something this session started that sends no event: a remote job, or a base-branch fix about to
   land. Cap it at **3 no-change wakes**, then park per rule 1. "Re-arm silently" with no bound is
   banned.
4. **Coordinators don't prospect on a timer.** Scan `main` and new issues for cloud-feasible slices
   once, at the start of a work block the owner started. Never scan from a recurring check-in.
5. **Supplemental cloud checks are not landing gates.** A cloud lane may re-run `npm test` or
   re-verify a fix at a head. Do that once, record it on the PR, and park. It does not justify a
   loop.

## Report line

End a parked PR's turn with `Successor: none — parked on owner gates (<items>)`, per the handoff law
in `CLAUDE.md`. List the PR in that session's final report so the owner item cannot drop.
