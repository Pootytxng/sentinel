# Session Handoff

> Current lane only. Replace rather than append. Keep under 120 lines.

## Lane

PR #90 governance/proof repair under issue #49.

- Writer: none; Codex implementation claim released after the verified push
- Checkout: `C:\Users\Kuya\code\sentinel-pr90-governance`
- Local branch: `codex/pr90-governance`
- Remote/PR branch: `origin/agent/rig-evidence-map-clean`, PR #90 ready for review
- Inherited head: `a4cbbc4390f15c9b5aa43f36314066ce5578991c`
- Base: `origin/main` at `a53d77953b1ab28361d248fbd7a82d31a47ea57f`
- Work Control: issue #49, Status Review, Lane Claude Code, Gate None

## What this lane is doing

Make the role and proof-order failure behind PR #89/#90 mechanically harder to repeat. Claude Code
remains the default implementation owner and Codex the default independent reviewer; either may
write only after an explicit, exclusive handoff. Exact required gates, current-head receipts, and
independent review now control proof-dependent GitHub transitions.

The 14 Rig Evidence Map product/i18n/test files inherited from PR #90 are unchanged. PR #89's CI
policy, runner-budget, local-verifier, package-script, and lockfile changes remain excluded.

## Current evidence

- Re-read the source conversation, current main, both PRs, issue #49 comments/Project fields, every
  linked worktree, dirty state, remote refs, hosted check summaries, and relevant live processes.
- PR #89 is closed unmerged at `93c931a3`; PR #90 is draft at `a4cbbc43`. The old PR #90 checkout is
  preserved but owned by the prior sandbox SID, so this clean linked worktree was created from the
  exact remote head instead of trusting or modifying it.
- Issue #49 records the verified takeover. Project state is Active / Codex / Gate None with this
  worktree, branch, expiry, and next action.
- The work-control guard failed five core behavior cases before the evaluator existed, three
  law-loading cases before the docs changed, and three typo/identity hardening cases before those
  checks were added. It now passes all 16 evaluator, CLI, and law-loading cases.
- Exact committed-head gates ran without filters at `c2868bc0`: site staging passed; Vitest passed
  308 files / 3,963 tests with 2 skipped; the production build transformed 7,500 modules; Cargo passed 922 with
  0 failed and 24 ignored; clippy passed with warnings denied.
- The first full Vitest attempt correctly blocked on this lane's non-canonical main-module check and
  three release-harness timeouts while Cargo compiled in parallel. The existing idiom guard caught
  and fixed the owned defect; the release harness passed 27/27 alone, proving CPU contention, and the
  same exact unfiltered `npm test` then passed alone. No timeout was waived or filtered.
- Final inspection also found `STATE:source_main_commit` 12 commits stale. It was re-stamped from
  `ce3f4bd` to current `origin/main` `a53d7795`; the release-state verifier now reports 30/30
  citations and 0 state drift.
- Current focused governance/main-module/residency/state set: 4 files, 485 tests passed.
- The work-control receipt returned `PASS` with one explicit warning: Claude Code 2.1.220 could not
  perform the non-writing review because its OAuth session is expired and no API key is present.
  Authentication was not changed. The review remains labeled unverified rather than self-approved.
- PR #90 is ready for independent review, not merge-authorized. PR #89 remains closed unmerged. The
  Project is Review / Claude Code / Gate None; the claim expiry is cleared.

## Remaining external review

- Claude Code performs the read-only independent review when its authentication is available.
- Do not merge, release, deploy, or publish under this task. Any later merge decision starts by
  verifying the live PR head and rerunning required gates if that head changed.

## Do NOT

- Do not merge, release, deploy, publish, build an installer, or mutate system/security state.
- Do not revive or transplant PR #89's CI-policy changes.
- Do not touch `feat/user-feedback-lab-recovery`, `design/quiet-pit-wall`, Task #12 files, or any
  other worktree.

## Resume with

Recheck remote PR #90 head, this worktree's HEAD/status, issue #49 Project fields, and relevant
processes. The next lane is read-only Claude review; a new writer needs a new explicit claim.
