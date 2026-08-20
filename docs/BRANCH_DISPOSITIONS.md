# Branch dispositions — every remote ref, and why it still exists

> **Current state only.** One row per live ref on `origin`. `scripts/branch-disposition-audit.mjs`
> fails the build when a ref has no row, when a row names a ref that is gone, or when a `MERGED`
> row is not actually a no-op against `main`. Run `node scripts/branch-disposition-audit.mjs`.
>
> It reports **PARTIAL**, not OK, on a checkout that cannot see all of `origin` — a shallow or
> single-branch clone (which is what `actions/checkout@v4` makes by default) may not say a ref is
> gone, because it never looked. See `refSetCoverage` in that script.

This file exists because `docs/BACKLOG.md` claimed *"every branch has a verified disposition"* while
nothing had ever checked one. Q6 retired that claim as false (issue
[#65](https://github.com/Pootytxng/sentinel/issues/65)); this is the artifact that makes it true.

## How a disposition is proven

The authoritative test is **merge-tree**, not ahead/behind: lanes land through PRs, so the commits on
`main` carry different hashes and `git cherry` / `A...B` both mislead (a three-dot diff reported +195
lines for `latency-capture`, every symbol of which is already on `main`).

```bash
git merge-tree --write-tree origin/main origin/<branch>
```

Equal to `git rev-parse origin/main^{tree}` → merging changes nothing → the branch is **MERGED**.
Otherwise the branch is compared file-by-file against the trunk and dispositioned on that evidence.

**A branch that landed without a fast-forward stops being a no-op the moment `main` moves.** Neither
`--squash` nor `--rebase` leaves an ancestry link back to the branch — squash writes one new commit,
rebase copies each commit under a new hash — so a later three-way merge reintroduces the branch's own
stale copies of any file `main` has since changed. On 2026-08-05 that was this very file, twice.

**Rebase is not the safe half of that sentence.** On 2026-08-06 a lane rebase-merged cleanly, was
proven a no-op at that instant, and its row was flipped CLAIMED → MERGED in the next commit — a row
the *branch itself* had added. Both sides had then touched the same new line differently, so the
merge became a conflict and the proof could never be produced again. The audit caught it on `main`
within the minute; the fix was to prune, because there was nothing left to re-prove.

**A MERGED row is therefore perishable: prune the ref in the same breath as recording the merge**,
rather than leaving a row that will fail its own audit on the next unrelated edit — including the
edit that records the merge. The audit now says this in its own failure text
(`scripts/branch-disposition-audit.mjs`, pinned in its test).

**The base is `origin/main`, not the local `main`** (the local branch is only the fallback where no
`origin/main` exists). A local `main` is a checkout owned by whichever worktree holds it, and a merge
that lands on the trunk does not update it — that worktree stays on the commit it had until someone
pulls. On 2026-08-05 a `main` sitting 4 commits behind made the audit call a genuinely-merged branch
unmerged. Pinned in `scripts/branch-disposition-audit.test.mjs`.

| disposition | meaning | action |
| --- | --- | --- |
| `MERGED` | merge-tree is a no-op; `main` already contains it | prunable |
| `SUPERSEDED` | not a no-op, but its content reached `main` by another path | prunable |
| `PRESERVE` | must never be deleted, moved, or merged | leave alone |
| `CLAIMED` | another lane holds it under `docs/WORK_CONTROL.md` | hands off |
| `UNLANDED` | carries real work that is not on `main` | needs a decision |

The audit reads **local remote-tracking refs** — it reflects the last `git fetch`, not the server.
It measures against **`origin/main`**, not a local `main`: a disposition is a claim about the shared
trunk, and a worktree's `main` pointer can sit weeks behind without anyone noticing.

## The refs

Swept 2026-08-04 against `main` @ `1a513cb`; the `origin/claude/*` rows added 2026-08-05 against
`origin/main` @ `6712c14`, and re-proven the same day against `origin/main` @ `2e5365d` once the
three-PR stack (#69 → #71 → #72) had landed. Twelve lane refs are **gone rather than listed MERGED**,
pruned on landing per the rule above — `ci-entry-mainmodule-posix`, `ledger-honesty-optimize-station`,
`ci-health-reporter`, and the `claude/*` lanes behind PRs
[#74](https://github.com/Pootytxng/sentinel/pull/74) · [#78](https://github.com/Pootytxng/sentinel/pull/78) ·
[#79](https://github.com/Pootytxng/sentinel/pull/79) · [#80](https://github.com/Pootytxng/sentinel/pull/80) ·
[#81](https://github.com/Pootytxng/sentinel/pull/81) · [#82](https://github.com/Pootytxng/sentinel/pull/82) ·
[#83](https://github.com/Pootytxng/sentinel/pull/83) · [#84](https://github.com/Pootytxng/sentinel/pull/84) ·
[#85](https://github.com/Pootytxng/sentinel/pull/85).
A landed ref's row is its own tombstone: prune the ref and the row in the same commit that records
the merge, so this table only ever lists refs that still exist.

**Swept again 2026-08-12 against `origin/main` @ `4de1cba4` (tree `9e5a790`)** — the sweep the rule
above had been asking for, since a `MERGED` row is perishable and fourteen of them had been sitting
here through several trunk moves. Each of the seven `MERGED` refs was re-proven a no-op with
`git merge-tree --write-tree origin/main origin/<ref>` at that tree before deletion; the seven
`SUPERSEDED` refs kept the file-level evidence recorded when they were dispositioned, which is what
`SUPERSEDED` means and what re-proving cannot add. All fourteen were deleted from `origin` and their
rows dropped in this commit: `claude/harness-context-cleanup-700535`, `fix/fps-pid-identity`,
`recovery/codex-019fb092`, `integration/v0.9.8-hardened`, `release/v0.9.9-candidate`,
`recovery/local-v0.9.8-d9ced24`, `release/0.9.1`, `codex/fix-main-ci-site-stage`,
`codex/work-control`, `chore/ci-encoding-and-state-truth`, `i18n/zh-CN`, `latency-capture`,
`docs/claude-md-split`, `claude/nodejs-background-execution-fd4def`. Fourteen refs remained at that
sweep and none of them is `MERGED` or `SUPERSEDED`. A fifteenth, `origin/claude/bento-conversion`,
appeared later the same day, landed as PRs [#117](https://github.com/Pootytxng/sentinel/pull/117) /
[#120](https://github.com/Pootytxng/sentinel/pull/120) (merged 2026-08-13), and was deleted from
`origin` with its row dropped in this commit — a merged-and-deleted ref carries its evidence in the
PRs and needs no row.

| ref | disposition | evidence |
| --- | --- | --- |
| `origin/beta/private-beta-001` | PRESERVE | The frozen beta ref `16069fa`, LOCKED by CLAUDE.md ("never move the frozen beta refs"). Merge-tree is a no-op, so it is an ancestor of `main` — that makes it safe, not prunable. |
| `origin/recovery/failed-v0.9.9-prepare-1fa06a8` | PRESERVE | A preserved failed release candidate. `docs/RELEASE_AUTONOMY.md`: "Preserve every failed candidate before reset, replacement, or abandonment." Never a merge target. |
| `origin/recovery/failed-v0.9.9-runtime-proof-2bd649d` | PRESERVE | Same rule — the runtime-proof half of the same failed v0.9.9 attempt. |
| `origin/feat/console-project-doctor` | CLAIMED | Codex lane, worktree `C:\Users\Kuya\code\sentinel-project-doctor`, issue [#55](https://github.com/Pootytxng/sentinel/issues/55). The claim carries a 12-hour alarm with **no automatic takeover**, so an expired clock is not a licence to touch it. `tools/console/doctor.html` is absent from `main`. |
| `origin/codex/tool-shed-hygiene` | UNLANDED | **Partially landed.** `scripts/markdown-link-guard.mjs` is byte-identical on `main`, but the `.agents/skills/*` mirror layer (10 files), `scripts/agents-layout-guard.mjs` + its test, two archive splits and the plan doc are all absent. Codex-lane tooling — the unlanded half is the `.agents/` mirror, not a product change. |
| `origin/feat/bklit-anime-design-system` | UNLANDED | One commit `6fac5c1`, 76 files / 10739 insertions — vendors the Bklit UI chart engine + anime.js v4, no Tailwind adopted. Merges clean. **Owner product-scope call** (adopting a vendored design system), not a taste one. |
| `origin/feat/user-feedback-lab-recovery` | UNLANDED | 49 commits, 120 files, 14703 insertions; 42 files absent from `main` (LabDeck, RecDetailCard, the decision-journey IA and its guards). The compaction-window work from this branch *did* land. The Lab candidate sits behind a temporary owner flag and is a large product/design train — **owner review**, and a visual self-review, before any of it moves. |
| `origin/claude/review-consolidation-structure-9d13f2` | UNLANDED | A sibling Claude Code worktree branch, 7 commits ahead / 27 behind `main`. Carries four things `main` does not have: `docs/decisions/2026-08-04-startup-term-analysis-review.md` (absent from `main`), the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 150k→300k bump, Rust test-only coverage in `stutter.rs` / `capture.rs` / `benchmark_trial.rs`, and **a one-line `site/llms.txt` fix — `main` still says "free desktop app", which contradicts the owner's 2026-07-21 monetization decree and is currently live on `compy.gg`.** Predates `support_evidence.rs`, so merging it whole would delete 1,074 lines; the landing path is per-file, not a merge. Not this lane's branch — dispositioned, untouched. |
| `origin/design/quiet-pit-wall` | UNLANDED | **Partially landed.** 22 files / 5147 insertions vs merge-base `36bdf6b`, issue [#49](https://github.com/Pootytxng/sentinel/issues/49). **Half A landed** — the inert `[data-qpw="on"]` token + component-contract layer, its two guard suites, the four prototypes + inventory docs, the `vitest.config.ts` `NODE_ENV` pin, and the `ExperimentBench.css` motion-gate fix. Applied in this commit by `git checkout <branch> -- <paths>`. Not a merge — the branch is ~100 files behind `main`, and merging would drag stale copies. **Half B held — owner territory:** the branch flips `use-motion.ts`'s default from `"full"` to `"system"`, reversing the owner's explicit 2026-06-19 decision; on his own WebView2 (`prefers-reduced-motion: reduce`) that makes the whole app static. Welfare check filed in `OWNER_ACTION_CHECKLIST.md` §D. Held with it: `use-motion.test.ts`, the two `settings.json` locales, `Settings.test.tsx`, the `Walkthrough.tsx` comment. The branch's own guard asserted the flipped default; that assertion was re-pinned to the owner's decision rather than landed. |
| `origin/feat/lab-49-parity-port` | UNLANDED | PR [#89](https://github.com/Pootytxng/sentinel/pull/89) closed unmerged 2026-08-08; `93c931a3` sits one commit past the local worktree tip `7e6cd4d7`, no force-push (ancestry intact). The rig half was re-cut into #90, but **three files here exist on neither `main` nor #90** — `scripts/verify-like-ci.mjs`, `scripts/lib/ci-steps.mjs`, `scripts/verify-like-ci.test.mjs`, the local CI runner built when hosted Actions hit exhausted free minutes. **That runner is DECIDED: it dies with its PR** (2026-08-11). `main` reached the same goal by a different road and is now a superset — `scripts/verify-local.ps1` runs the same checks, is actually wired to `.githooks/pre-push` and `npm run verify:local`, probes whether `node_modules` satisfies the manifest (`scripts/deps-satisfied.ps1`), and `scripts/local-gate-guard.test.mjs` already carries the drift catcher that was the runner's real value: every `run:` step in `ci.yml` that is not declared setup must be covered locally, and the one deliberate difference (`stage:site`) is written down with its reason rather than silently missing. Landing a second runner in Node beside the PowerShell one would mean keeping two things in step with `ci.yml` instead of one. Also the parent of the uncommitted `ConfirmDialog` z-index + focus-ring fixes in `C:\Users\Kuya\code\sentinel-quietpitwall` (see `docs/SESSION_HANDOFF.md` §2). |
| `origin/claude/checklist-disk-item-c5660e` | CLAIMED | Claude lane, same session as the two rows below. Docs only: adds **A_disk** to `docs/OWNER_ACTION_CHECKLIST.md` (a 9 GB folder `git worktree remove` deregistered but Windows would not delete) and drops this lane's own superseded duplicate row for `origin/docs/design-foundation`, which said in its own text that it goes once the owning lane writes its. |
| `origin/claude/foreground-courtesy-handoff-82687b` | CLAIMED | Claude lane, worktree `.claude/worktrees/foreground-courtesy-handoff-82687b`. Ran the on-screen proof PR [#100](https://github.com/Pootytxng/sentinel/pull/100) was waiting on and it **failed three times out of three** — `focus = false` set through `context.config_mut()` does not survive to window creation, so that PR's mechanism is inert (findings on the PR; do not merge it as-is). Chasing it surfaced the owner's ACTUAL complaint — a blank Windows Terminal flashing and self-closing — which measurement traced to `npm test`: seven suites spawn `powershell.exe` without `windowsHide`, and Win11's default terminal turns each one into a real console window. This branch fixes those seven and adds `scripts/console-window-guard.test.mjs` to keep an eighth from appearing. |
| `origin/docs/design-foundation` | CLAIMED | Claude lane, docs only. The consumer-app design foundation the owner asked for on 2026-08-11 after tester feedback that Compy is "overwhelming and hard to navigate and completely unfamiliar": `docs/decisions/2026-08-11-design-foundation.md` (five references, the verdict-first front door, the interview, the 6-step type scale at a 13px floor, rooms giving up their hue, the wording glossary, and the ranked tooling answer), the rendered proposal at `docs/ui-sweep/foundation.html`, and `FOUNDATION-1` filed in `docs/UI_VISION_BACKLOG.md` as the parent of TYPE-1 / COLOR-1 / UX-1. No product code touched. |
| `origin/perf/idle-127-ambient-raster` | MERGED | Landed as a real merge commit `85ed8065` (PR [#141](https://github.com/Pootytxng/sentinel/pull/141), issue [#127](https://github.com/Pootytxng/sentinel/issues/127)), so the ref is an ancestor of `main` and stays a no-op — the perishability warning above applies to squash/rebase landings, not this one. Idle-CPU attribution: #127's own rig diagnosis does not reproduce (rAF band 0.201, zero frames); the cost was `aurora`'s `scale()` on `body::before` (13.257 points) and two forever-running `.stl-ring` pulses on every Home (4.156). 19.632 → 10.483 percent of one core against the installed binary. **Ref NOT pruned:** the `gh api -X DELETE` prune was denied by this session's permission layer, so the row stays instead of a dangling reference. |
| `origin/lane/usage-audit-disk-bloat` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session pushed it at 2026-08-20 04:47 local (commit `12886b0f`, one commit on top of `8a1450cd`) with PR [#160](https://github.com/Pootytxng/sentinel/pull/160) open: a report-only disk-bloat flag for an oversized `src-tauri/target`. The same window is when this worktree's `node_modules` was gutted and reinstalled by an `npm install --no-audit --no-fund` no script in this repo issues — the first push gate here died at a missing `tsc` because of it. The row exists so the audit reflects reality; **its disposition to MERGED or a prune belongs to the lane that owns it**, per `docs/WORK_CONTROL.md` (an overlapping live claim means hands off, not adjudicate). |
| `origin/lane/cleanup-train-2026-08-20` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session's docs/receipts train, PR [#163](https://github.com/Pootytxng/sentinel/pull/163) — the `#160` re-proof + receipt, the `A_merge` permission ask, and the record of the worktree collision that renamed it off `lane/self-checkup`. **That PR carries its own, fuller row for this branch; when #163 lands, its text supersedes this one and this line goes.** The row exists only because merging #164 left `main`'s audit red for every push in the repo, and an undispositioned ref blocks other lanes, not just its own. |



## Standing rule

A new remote ref is undispositioned until it has a row here. The audit is the enforcement; adding
the row is part of the work that created the branch, not a later cleanup.
