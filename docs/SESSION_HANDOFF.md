# Session Handoff

> Current lane only. Replace rather than append. Keep under 120 lines.

## Lane

PR #90 governance/proof repair under issue #49.

- Writer: Codex desktop by Kuya's explicit handoff; sole active writer for this scope
- Checkout: `C:\Users\Kuya\code\sentinel-pr90-governance`
- Local branch: `codex/pr90-governance`
- Remote/PR branch: `origin/agent/rig-evidence-map-clean`, draft PR #90
- Inherited head: `a4cbbc4390f15c9b5aa43f36314066ce5578991c`
- Base: `origin/main` at `a53d77953b1ab28361d248fbd7a82d31a47ea57f`
- Work Control: issue #49, Status Active, Lane Codex, Gate None

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
- Candidate-tree exact gates ran without filters: site staging passed; Vitest passed 308 files /
  3,956 tests with 2 skipped; the production build transformed 7,500 modules; Cargo passed 922 with
  0 failed and 24 ignored; clippy passed with warnings denied.
- The first full Vitest attempt correctly blocked on this lane's non-canonical main-module check and
  three release-harness timeouts while Cargo compiled in parallel. The existing idiom guard caught
  and fixed the owned defect; the release harness passed 27/27 alone, proving CPU contention, and the
  same exact unfiltered `npm test` then passed alone. No timeout was waived or filtered.
- Final inspection also found `STATE:source_main_commit` 12 commits stale. It was re-stamped from
  `ce3f4bd` to current `origin/main` `a53d7795`; the release-state verifier now reports 30/30
  citations and 0 state drift.
- Current focused governance/main-module/residency/state set: 4 files, 485 tests passed.

## Left to do

- Commit, then rerun the exact repository-defined gates on the final committed head.
- Push the verified head to PR #90's remote branch.
- Obtain final read-only review from the non-writing model when practical.
- Update PR #90, PR #89, issue #49, and Project fields from named proof only; do not merge.

## Do NOT

- Do not merge, release, deploy, publish, build an installer, or mutate system/security state.
- Do not revive or transplant PR #89's CI-policy changes.
- Do not touch `feat/user-feedback-lab-recovery`, `design/quiet-pit-wall`, Task #12 files, or any
  other worktree.

## Resume with

Recheck remote PR #90 head, this worktree's HEAD/status, issue #49's latest claim, and relevant
processes. Continue only if this remains the sole writer; otherwise stop read-only and reconcile.
