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

**A branch that landed without a fast-forward stops being a no-op the moment `main` moves**, and
rebase is not the safe half of that sentence: neither `--squash` nor `--rebase` leaves an ancestry
link, so a later three-way merge reintroduces the branch's own stale copies. It hit this very file
twice on 2026-08-05, and on 2026-08-06 it destroyed a proof that could never be produced again. Both
narratives: [`archive/BRANCH_DISPOSITION_SWEEPS.md`](archive/BRANCH_DISPOSITION_SWEEPS.md).

**A MERGED row is therefore perishable: prune the ref in the same breath as recording the merge**,
rather than leaving a row that will fail its own audit on the next unrelated edit — including the
edit that records the merge. **The audit enforces it** — a `MERGED` or `SUPERSEDED` row whose ref is
still on origin fails — and its failure text names the prune: `git push origin --delete <branch>`,
the form that is neither blocked on this machine nor stopped by the gate (`.githooks/pre-push` skips
a deletion-only push). Pinned in `scripts/branch-disposition-audit.test.mjs`.

**The base is `origin/main`, not the local `main`** (the local branch is only the fallback where no
`origin/main` exists). A local `main` is a checkout owned by whichever worktree holds it, and a merge
that lands on the trunk does not update it — that worktree stays on the commit it had until someone
pulls. On 2026-08-05 a `main` sitting 4 commits behind made the audit call a genuinely-merged branch
unmerged. Pinned in `scripts/branch-disposition-audit.test.mjs`.

| disposition | meaning | action |
| --- | --- | --- |
| `MERGED` | merge-tree is a no-op; `main` already contains it | **prune now** |
| `SUPERSEDED` | not a no-op, but its content reached `main` by another path | **prune now** |
| `PRESERVE` | must never be deleted, moved, or merged | leave alone |
| `CLAIMED` | another lane holds it under `docs/WORK_CONTROL.md` | hands off |
| `UNLANDED` | carries real work that is not on `main` | needs a decision |

The audit reads **local remote-tracking refs** — it reflects the last `git fetch`, not the server.
It measures against **`origin/main`**, not a local `main`: a disposition is a claim about the shared
trunk, and a worktree's `main` pointer can sit weeks behind without anyone noticing.

## The refs

Earlier sweeps (2026-08-04 · 2026-08-05 · 2026-08-12) moved to
[`archive/BRANCH_DISPOSITION_SWEEPS.md`](archive/BRANCH_DISPOSITION_SWEEPS.md) on 2026-08-21 under
TOKEN LAW §1 — every ref they dispositioned is long gone; this file keeps the CURRENT sweep only.

**Swept again 2026-08-21 against `origin/main` @ `f8969e5f` (tree `37d1907`)** — issue
[#126](https://github.com/Pootytxng/sentinel/issues/126)'s re-proof, run on all fifteen refs, not
remembered from the rows. `git merge-tree --write-tree origin/main origin/<ref>` at that tree: three
are no-ops (one of them the `PRESERVE` beta ref, which stays), twelve carry work. **Three retired —
two `MERGED`, one `SUPERSEDED` on file-level evidence** — deleted from `origin` with their rows
dropped in this commit:

- `claude/foreground-courtesy-handoff-82687b` — **MERGED**, no-op at this tree; landed as PR
  [#101](https://github.com/Pootytxng/sentinel/pull/101) (2026-08-11). Its row still read CLAIMED.
- `docs/design-foundation` — **MERGED**, no-op at this tree; landed as PR
  [#107](https://github.com/Pootytxng/sentinel/pull/107) (2026-08-12). Its row still read CLAIMED.
- `claude/checklist-disk-item-c5660e` — **SUPERSEDED** (not a no-op; content reached `main` by
  another path, which is exactly what that disposition means). Both of its contributions are on the
  trunk: **A_disk** is in `docs/OWNER_ACTION_CHECKLIST.md` and has since been *closed* (2026-08-11/12)
  and archived (2026-08-18), and the duplicate `origin/docs/design-foundation` row it existed to drop
  is dropped by this same commit. Nothing of it is left to land, and no worktree held it.

Neither open PR was touched: [#160](https://github.com/Pootytxng/sentinel/pull/160)
(`lane/usage-audit-disk-bloat`) and [#163](https://github.com/Pootytxng/sentinel/pull/163)
(`lane/cleanup-train-2026-08-20`) belong to other lanes — hands off, not adjudicate. **Nine
non-`PRESERVE` refs remain, and not one of them is retirable by proof**: each needs either an owner
product-scope call or the lane that owns it. #126 is therefore part-discharged, not done — the
proof-retirable refs are gone, and what is left is a decision queue, not a cleanup queue.

**One live finding surfaced by the re-proof, now fixed but NOT yet landed** — `main`'s
`site/llms.txt:5` prices the product wrongly and is still live on `compy.gg`. Corrected in PR
[#193](https://github.com/Pootytxng/sentinel/pull/193), which is deliberately a **draft**: price
wording is owner-gated twice (brand + money, and `site/**` auto-deploys). The unlanded line on
`claude/review-consolidation-structure-9d13f2` was **not** used — it says "free forever", the exact
phrasing the same decree supersedes. Owner-gated:
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) §B6.

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
| `origin/lane/usage-audit-disk-bloat` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session pushed it at 2026-08-20 04:47 local (commit `12886b0f`, one commit on top of `8a1450cd`) with PR [#160](https://github.com/Pootytxng/sentinel/pull/160) open: a report-only disk-bloat flag for an oversized `src-tauri/target`. The same window is when this worktree's `node_modules` was gutted and reinstalled by an `npm install --no-audit --no-fund` no script in this repo issues — the first push gate here died at a missing `tsc` because of it. The row exists so the audit reflects reality; **its disposition to MERGED or a prune belongs to the lane that owns it**, per `docs/WORK_CONTROL.md` (an overlapping live claim means hands off, not adjudicate). |
| `origin/lane/cleanup-train-2026-08-20` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session's docs/receipts train, PR [#163](https://github.com/Pootytxng/sentinel/pull/163) — the `#160` re-proof + receipt, the `A_merge` permission ask, and the record of the worktree collision that renamed it off `lane/self-checkup`. **That PR carries its own, fuller row for this branch; when #163 lands, its text supersedes this one and this line goes.** The row exists only because merging #164 left `main`'s audit red for every push in the repo, and an undispositioned ref blocks other lanes, not just its own. |
| `origin/lane/train-2026-08-22` | UNLANDED | The active Claude Code lane, worktree `C:\Users\Kuya\code\sentinel-home-room`. Pushed 2026-08-22 carrying `55ecb642` — `docs/PRICING_RESEARCH.md`, the evidence pass the owner asked for after being told the `$25/yr` in `docs/RECEIPTS_DOCTRINE.md` had no source behind it, plus unevidenced-placeholder labels on both money docs. Docs only; nothing reaches the binary. Lands by PR once the lane's remaining owner-authorized work (C-14 `GpuProfile` wire-in, the accepted price band) is on it. |
| `origin/fix/site-pricing-language` | UNLANDED | **This lane's own branch.** Draft PR [#193](https://github.com/Pootytxng/sentinel/pull/193) — `5748b646` corrects `site/llms.txt:5` **and its real source `site/generate.mjs:441`, because the file is GENERATED and an output-only fix is reverted by the next run**, to "a Windows desktop app with a free tier" — the vocabulary the 2026-07-21 decree at `docs/RECEIPTS_DOCTRINE.md:23` requires. The line drafted on `claude/review-consolidation-structure-9d13f2` was **rejected, not landed**: it says "free forever", which that decree supersedes. Merged up to `main` 2026-08-22, so it is a clean merge again. **Deliberately a DRAFT until the owner answers** — price wording is brand + money and `site/**` auto-deploys to other people's machines, so `docs/WORK_CONTROL.md` allows only a blocked draft, which claims no readiness. Nothing in it reaches the binary. **This row and the ref leave together the moment it lands.** |

## Standing rule

A new remote ref is undispositioned until it has a row here. The audit is the enforcement; adding
the row is part of the work that created the branch, not a later cleanup.
