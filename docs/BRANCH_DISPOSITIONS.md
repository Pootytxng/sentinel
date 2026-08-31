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

**The 2026-08-21 sweep** against `origin/main` @ `f8969e5f` (tree `37d1907`) re-proved all fifteen
refs for [#126](https://github.com/Pootytxng/sentinel/issues/126) and retired three on evidence —
two `MERGED`, one `SUPERSEDED` — pruned the same day. Its narrative moved to
[`archive/BRANCH_DISPOSITION_SWEEPS.md`](archive/BRANCH_DISPOSITION_SWEEPS.md) on 2026-08-31 to pay
for the row this file gained; **two live facts stay here** rather than travelling with it: the
retired detached checkout's work is preserved under tag `preserve/checklist-disk-item-c5660e`, and
**rule C of `scripts/handoff-worktree-truth.test.mjs` now fails on a branchless checkout** — the one
shape an audit that reads `origin` refs is structurally blind to.

**Fifteen non-`PRESERVE` refs remain, and not one of them is retirable by proof** — each needs either
an owner product-scope call or the lane that owns it, so #126 is part-discharged, not done: what is
left is a decision queue, not a cleanup queue. Re-derived 2026-08-31 from `git ls-remote --heads
origin` after a `--prune` fetch: eighteen refs besides `main`, three `PRESERVE`. **This is a count,
so it goes stale every time the table grows and re-deriving it is part of adding a row** — it reached
`main` one short, and its history of doing that is in the archive. Older closed narratives (#160's
landing and prune, the #193 "free desktop app" fix) are in the archive too; the live warning out of
the second is in the `claude/review-consolidation-structure-9d13f2` row below, where a lander looks.

| ref | disposition | evidence |
| --- | --- | --- |
| `origin/beta/private-beta-001` | PRESERVE | The frozen beta ref `16069fa`, LOCKED by CLAUDE.md ("never move the frozen beta refs"). Merge-tree is a no-op, so it is an ancestor of `main` — that makes it safe, not prunable. |
| `origin/recovery/failed-v0.9.9-prepare-1fa06a8` | PRESERVE | A preserved failed release candidate. `docs/RELEASE_AUTONOMY.md`: "Preserve every failed candidate before reset, replacement, or abandonment." Never a merge target. |
| `origin/recovery/failed-v0.9.9-runtime-proof-2bd649d` | PRESERVE | Same rule — the runtime-proof half of the same failed v0.9.9 attempt. |
| `origin/feat/console-project-doctor` | CLAIMED | Codex lane, worktree `C:\Users\Kuya\code\sentinel-project-doctor`, issue [#55](https://github.com/Pootytxng/sentinel/issues/55). The claim carries a 12-hour alarm with **no automatic takeover**, so an expired clock is not a licence to touch it. `tools/console/doctor.html` is absent from `main`. |
| `origin/codex/tool-shed-hygiene` | UNLANDED | **Partially landed.** `scripts/markdown-link-guard.mjs` is byte-identical on `main`, but the `.agents/skills/*` mirror layer (10 files), `scripts/agents-layout-guard.mjs` + its test, two archive splits and the plan doc are all absent. Codex-lane tooling — the unlanded half is the `.agents/` mirror, not a product change. |
| `origin/feat/bklit-anime-design-system` | UNLANDED | One commit `6fac5c1`, 76 files / 10739 insertions — vendors the Bklit UI chart engine + anime.js v4, no Tailwind adopted. Merges clean. **Owner product-scope call** (adopting a vendored design system), not a taste one. |
| `origin/feat/user-feedback-lab-recovery` | UNLANDED | 49 commits, 120 files, 14703 insertions; 42 files absent from `main` (LabDeck, RecDetailCard, the decision-journey IA and its guards). The compaction-window work from this branch *did* land. The Lab candidate sits behind a temporary owner flag and is a large product/design train — **owner review**, and a visual self-review, before any of it moves. |
| `origin/claude/review-consolidation-structure-9d13f2` | UNLANDED | A sibling Claude Code worktree branch, 7 commits ahead / 27 behind `main`. Carries four things `main` does not have: `docs/decisions/2026-08-04-startup-term-analysis-review.md` (absent from `main`), the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 150k→300k bump, Rust test-only coverage in `stutter.rs` / `capture.rs` / `benchmark_trial.rs`, and a one-line `site/llms.txt` fix that is now **moot** — `main` was corrected by #193 (`d5571766`) with different, decree-compliant wording; this branch's "free forever" line must never be landed. Predates `support_evidence.rs`, so merging it whole would delete 1,074 lines; the landing path is per-file, not a merge. Not this lane's branch — dispositioned, untouched. |
| `origin/design/quiet-pit-wall` | UNLANDED | **Partially landed.** 22 files / 5147 insertions vs merge-base `36bdf6b`, issue [#49](https://github.com/Pootytxng/sentinel/issues/49). **Half A landed** — the inert `[data-qpw="on"]` token + component-contract layer, its two guard suites, the four prototypes + inventory docs, the `vitest.config.ts` `NODE_ENV` pin, and the `ExperimentBench.css` motion-gate fix. Applied in this commit by `git checkout <branch> -- <paths>`. Not a merge — the branch is ~100 files behind `main`, and merging would drag stale copies. **Half B held — owner territory:** the branch flips `use-motion.ts`'s default from `"full"` to `"system"`, reversing the owner's explicit 2026-06-19 decision; on his own WebView2 (`prefers-reduced-motion: reduce`) that makes the whole app static. Welfare check filed in `OWNER_ACTION_CHECKLIST.md` §D. Held with it: `use-motion.test.ts`, the two `settings.json` locales, `Settings.test.tsx`, the `Walkthrough.tsx` comment. The branch's own guard asserted the flipped default; that assertion was re-pinned to the owner's decision rather than landed. |
| `origin/feat/lab-49-parity-port` | UNLANDED | PR [#89](https://github.com/Pootytxng/sentinel/pull/89) closed unmerged 2026-08-08; `93c931a3` sits one commit past the local worktree tip `7e6cd4d7`, no force-push (ancestry intact). The rig half was re-cut into #90, but **three files here exist on neither `main` nor #90** — `scripts/verify-like-ci.mjs`, `scripts/lib/ci-steps.mjs`, `scripts/verify-like-ci.test.mjs`, the local CI runner built when hosted Actions hit exhausted free minutes. **That runner is DECIDED: it dies with its PR** (2026-08-11). `main` reached the same goal by a different road and is now a superset — `scripts/verify-local.ps1` runs the same checks, is actually wired to `.githooks/pre-push` and `npm run verify:local`, probes whether `node_modules` satisfies the manifest (`scripts/deps-satisfied.ps1`), and `scripts/local-gate-guard.test.mjs` already carries the drift catcher that was the runner's real value: every `run:` step in `ci.yml` that is not declared setup must be covered locally, and the one deliberate difference (`stage:site`) is written down with its reason rather than silently missing. Landing a second runner in Node beside the PowerShell one would mean keeping two things in step with `ci.yml` instead of one. Also the parent of the uncommitted `ConfirmDialog` z-index + focus-ring fixes in `C:\Users\Kuya\code\sentinel-quietpitwall` (see `docs/SESSION_HANDOFF.md` §2). |
| `origin/lane/cleanup-train-2026-08-20` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session's docs/receipts train, PR [#163](https://github.com/Pootytxng/sentinel/pull/163) — the `#160` re-proof + receipt, the `A_merge` permission ask, and the record of the worktree collision that renamed it off `lane/self-checkup`. **That PR carries its own, fuller row for this branch; when #163 lands, its text supersedes this one and this line goes.** The row exists only because merging #164 left `main`'s audit red for every push in the repo, and an undispositioned ref blocks other lanes, not just its own. |
| `origin/lane/vision-pointer-guard-2026-08-24` | CLAIMED | **Not this lane's branch — dispositioned, untouched.** A concurrently-running session's lane, worktree `C:\Users\Kuya\code\sentinel-vision-pointer`, three commits past `main` (`aa6e773a`, `be9902df`, `b698746a`) — the #215/#216 follow-through, the `docs/agents/` skill-config scaffold, and a BACKLOG re-derivation. **That branch already carries its own, fuller row for itself (in `aa6e773a`); when it lands, its text supersedes this one and this line goes.** Recorded here for exactly the reason the `cleanup-train` row above exists — an undispositioned ref turns the audit red for **every** push in the repo, so this one blocked the Q9a lane ([#217](https://github.com/Pootytxng/sentinel/issues/217)) rather than its own. Checked the way this doc says to check: `git fetch origin --prune` first, then `git ls-remote`, because a ref another lane already deleted lingers in a stale cache and looks identical to an undispositioned one. This one is live. |
| `origin/claude/exciting-robinson-0ce4d5` | CLAIMED | This lane, worktree `C:\Users\Kuya\code\sentinel\.claude\worktrees\exciting-robinson-0ce4d5`, issue [#266](https://github.com/Pootytxng/sentinel/issues/266). PR [#267](https://github.com/Pootytxng/sentinel/pull/267) holds what needs review: `6760387a` deletes `stripRustComments` from `src/case-evidence-tier-separation-guard.test.ts` — six proven bypasses, each hiding executing Rust from the detectors — plus the four comment rewrites that buys. The shebang repair rode straight to `main` in this commit instead, because it was what had `main` red. Row goes when the PR lands. |
| `origin/lane/native-routing-271` | CLAIMED | Sidebar remediation Task 1, issue [#271](https://github.com/Pootytxng/sentinel/issues/271), worktree `C:\Users\Kuya\code\sentinel-native-routing-271`. Documentation only — the Q9b stage correction in `BACKLOG.md` (contract §11: Stage 3 is the local receiver, Stage 4 is the send command), the `RELEASE_STATE.md` `source_main_commit` re-stamp that was failing `verify-release-state` for every push in the repo, and the carrier bullet. **LANDED** as PR [#273](https://github.com/Pootytxng/sentinel/pull/273) → `e26108f7`; merge-tree against `origin/main` is a no-op, so nothing here is unlanded. **It reads `CLAIMED` and not `MERGED` only because the prune is BLOCKED** — deleting the ref was denied to this session on 2026-08-31, and a denial is a stop, not a licence to reach the same effect another way; `MERGED` would fail the audit while the ref is still on origin. Owner action, filed as `OWNER_ACTION_CHECKLIST.md` §A_prune: `git push origin --delete lane/native-routing-271`, then drop this row and the carrier bullet together. |
| `origin/lane/css-margin-separators-274` | CLAIMED | This lane, worktree `C:\Users\Kuya\code\sentinel-css-separators`, issue [#274](https://github.com/Pootytxng/sentinel/issues/274) — sidebar remediation Task 2. Test-infrastructure only: `src/test/css-margin.ts` gains a quote- and paren-aware declaration tokenizer, because `stripComments()` and both guards' `rulesFromCss` walkers already skipped quoted spans while the `.split(";")` between them did not. That gap made the guard **blind to a real `margin-left: auto`** hidden behind a quoted `;` **and made it invent one** out of quoted text — both directions, reproduced against the unchanged file before the repair was written (12 failed / 90 passed reverted; 102/102 repaired). Its tests, plus four routed through each consumer's own `rulesFromCss`, ride with it. **No production stylesheet, no selector redesign, no general CSS-parser replacement** — the handoff's stated scope, and its stop condition was never approached. **LANDED** as PR [#275](https://github.com/Pootytxng/sentinel/pull/275) → `29fb8009`. Reads `CLAIMED` rather than `MERGED` for the same reason as the row above: the ref is still on origin, `MERGED` would fail this file's own audit while it is, and the prune is filed as owner action `OWNER_ACTION_CHECKLIST.md` §A_prune — which now covers both refs in one command. |
| `origin/lane/fleet-guard-failclosed-276` | CLAIMED | This lane, worktree `C:\Users\Kuya\code\sentinel-fleet-guard-276`, issue [#276](https://github.com/Pootytxng/sentinel/issues/276) — sidebar remediation Task 3, opened as a bounded follow-up to PR [#269](https://github.com/Pootytxng/sentinel/pull/269) rather than reopening a correctly-completed lane. `scripts/hookspath-fleet-guard.test.mjs` collapsed every git failure into `""` and skipped an unset `core.hooksPath`, so "unreadable config", "git would not run" and "genuinely unwired" were one **green** outcome; it then accepted anything `existsSync()` liked, including a directory, an empty file and a script that exits 0. Replayed against ten seeded fixtures, the old procedure **waved through eight**. A second fail-OPEN reading sat in `scripts/lib/prepush-hook-contract.mjs`: `blankQuoted()` reset its quote state at every newline, so a multi-line quoted diagnostic parsed as executable shell and a hook that merely PRINTS the words `exit 1` certified as one that refuses. The decision moved to `scripts/lib/hookspath-inspect.mjs` + that contract so it can be driven against throwaway repos — the reason those cases were never written is that the old shape could only be tested by **disarming a real worktree**. The contract is now shared with `scripts/local-gate-guard.test.mjs`, two of whose checks matched the RAW hook text and so were satisfiable by a comment. **`.githooks/pre-push` unchanged** — proof showed it already fails closed. Requiring its fail-closed branch of *every* checkout failed 22 of 27 safe worktrees, so it is demanded only where a checkout has no `verify-local.ps1`; re-measured **0 failures of 27**, preserving `sentinel-feedback` and `sentinel-quietpitwall` on main's `.githooks`. `scripts/setup-local-ci.ps1` additionally reported **NOT ARMED / exit 1 on a correctly armed checkout** whenever run from another directory, because `--git-path hooks` answers relatively — fixed with `--path-format=absolute`. Every claim measured against the pre-fix code, not assumed. Guarantee scoped to the **27 worktrees registered in this clone at inspection time**; not all clones, and a red result is not evidence about past pushes. **Open and unmerged on purpose** — held for an independent review that a provider usage limit blocked, because certifying a guard that never refuses is the one error this file's own doctrine forbids. |
| `origin/lane/shell-ownership-278` | CLAIMED | Not this lane's branch — dispositioned, untouched. Sidebar remediation Task 4, issue [#278](https://github.com/Pootytxng/sentinel/issues/278), worktree `C:\Users\Kuya\code\sentinel-shell-ownership-278`, PR [#279](https://github.com/Pootytxng/sentinel/pull/279). Makes the one-writer rule follow the TARGET rather than the tool, across five ownership zones, where `unknown` is never treated as `unprotected`. **Open and unmerged on purpose**: merging ARMS a guard that runs before every shell command in the repo, which is the owner's call, not this session's. No tip SHA is pinned here, because a row that names one is stale the next time the lane pushes. **That lane carries its own, fuller row; when it lands, its text supersedes this one and this line goes.** |
| `origin/lane/segmented-a11y-237` | CLAIMED | This lane, worktree `C:\Users\Kuya\code\sentinel-segmented-237`, issue [#237](https://github.com/Pootytxng/sentinel/issues/237) — sidebar remediation Task 11. `SegmentedControl` declared `role="tablist"`/`role="tab"`/`aria-selected` and implemented none of the ARIA tabs pattern it thereby promised: no roving arrow/Home/End focus, no single tab stop, no `tabpanel`. It is now a labelled `role="group"` of native `button type="button"` with `aria-pressed`, which is the contract it actually keeps. **No visual change** — the pill still measures and glides off the selected element, the zero-width measurement suppression is untouched, and the focus ring survives on `button:focus-visible` and `.seg-btn:focus-visible`. Consumers updated by invariant, never by broad replacement: the retired Basic/Advanced negative now checks BOTH roles (a `tab`-only check would have gone vacuous), the margin guard locates the switch by `.seg-control` because it is a LAYOUT guard, and Learn's own `lx-modes` tablist is untouched. Guard measured, not assumed: reverting the component turns 7 tests red. **LANDED** as PR [#280](https://github.com/Pootytxng/sentinel/pull/280) → `09872c80`. Reads `CLAIMED` rather than `MERGED` for the same reason as the two rows above — the ref is still on origin, `MERGED` would fail this file's own audit while it is, and the prune is owner action `OWNER_ACTION_CHECKLIST.md` §A_prune. Unlike those two it was merge-committed rather than squashed, so `origin/main` reaches its commits and it carries zero: its name left the `SESSION_HANDOFF.md` carrier bullet in this same train, which is what rule D requires. |

## Standing rule

A new remote ref is undispositioned until it has a row here. The audit is the enforcement; adding
the row is part of the work that created the branch, not a later cleanup.
