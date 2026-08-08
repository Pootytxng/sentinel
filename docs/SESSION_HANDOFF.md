# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template below in the same commit.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash, and by any
> session that sees its own context filling fast. Read this FIRST on a fresh session that mentions
> "continue" or "resume" with no other lead. Budget: 120 lines (`scripts/doc-budget.ps1`).

## Lane

Codex · worktree `C:\Users\Kuya\code\sentinel-pr89-identity` · local branch
`codex/pr89-selected-identity` at PR #89 head `7e6cd4d7` · target branch
`feat/lab-49-parity-port` · issue [#49](https://github.com/Pootytxng/sentinel/issues/49) ·
PR [#89](https://github.com/Pootytxng/sentinel/pull/89) open. No merge or publication is authorized.
Any merge or push updates no existing worktree automatically; each worktree stays on its own commit.

## What this lane is doing

Repairing the Rig Evidence Map selected-component identity defect found in PR review. The exact
selected `gpu-N`, `disk-N`, or `vol-N` identity must reach the evidence resolver so a label can never
name one component while its measurements come from another. Separately auditing the CI changes
already bundled in PR #89 without rewriting CI policy.

## Done so far

- Formally transferred issue #49 from the stale Claude claim to Codex in Work Control, then created
  this clean worktree from the live PR head. The original dirty worktree was not changed.
- Added adversarial multi-GPU and multi-drive UI tests. Before the fix they failed with the selected
  second device's label beside GPU 1 / C: measurements; after the fix both pass.
- `LabConsole` now passes the exact selected rig part to `rigPartReadings`. GPU and volume IDs resolve
  their matching array entries; physical drives report only their own measured capacity because the
  snapshot has no honest physical-drive-to-logical-volume mapping. Missing identities fail closed.
- Focused evidence test: 12/12 passed. Rig/reachability/idle set: 12 files, 103/103 passed.
- First full `npm run verify` reached 3,948 passing tests and stopped on this handoff's previous stale
  lane sentence, which combined the old lane location with ambiguous integration language.
- After correcting that stale source of truth, the complete gate passed: 307 Vitest files
  (3,949 passed, 2 skipped), production type-check/build, Cargo tests, and clippy with warnings denied.

## Current disposition

The identity repair is complete and locally verified. It remains **NO-SHIP / DO NOT MERGE** because
PR #89 also bundles a separate 419-insertion/80-deletion CI-policy rewrite. That rewrite conflicts
with `docs/RELEASE_STATE.md`, which says hosted CI is settled off by owner decision and must not be
reopened as an obligation. Both live hosted checks still end with zero steps and prove no code.
Resolve or deliberately accept that policy/scope collision separately before any merge decision.

## Preserved prior-lane state

The uncommitted Task #12 accessibility/layout slice remains only in
`C:\Users\Kuya\code\sentinel-quietpitwall`: `src/design/ConfirmDialog.css`,
`src/surfaces/home-console.css`, `src/focus-ring-guard.test.ts`, and
`src/modal-stacking-guard.test.ts`. It belongs to that worktree and was not copied or edited here.
Its prior requirement for a quoted visual self-review PASS remains intact.

The previous selective-port decisions also remain intact: do not wholesale port
`feat/user-feedback-lab-recovery`; do not revive `design/quiet-pit-wall`; do not re-attempt the
declined one-name, receipts-copy, LabDeck comparison/copy, or measured-gauge ports without new
evidence that their stated prerequisites changed.

## Do NOT

- Merge or publish PR #89.
- Edit `main` directly.
- Treat `origin/design/quiet-pit-wall` as the base. Its motion-policy half remains owner territory.
- Treat the live hosted red Xs as test failures: both jobs have zero steps under the Actions wall.
- Rewrite the bundled CI policy while performing this identity repair; report its conflicts.
- Touch or absorb the dirty Task #12 files from `sentinel-quietpitwall`.

## Resume with

```powershell
cd C:\Users\Kuya\code\sentinel-pr89-identity
git status --short
git log -1 --oneline
gh pr view 89 --repo Pootytxng/sentinel
```

Then inspect the final receipt and CI-policy conflict. Do not merge or publish.
