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

| ref | disposition | evidence |
| --- | --- | --- |
| `origin/beta/private-beta-001` | PRESERVE | The frozen beta ref `16069fa`, LOCKED by CLAUDE.md ("never move the frozen beta refs"). Merge-tree is a no-op, so it is an ancestor of `main` — that makes it safe, not prunable. |
| `origin/recovery/failed-v0.9.9-prepare-1fa06a8` | PRESERVE | A preserved failed release candidate. `docs/RELEASE_AUTONOMY.md`: "Preserve every failed candidate before reset, replacement, or abandonment." Never a merge target. |
| `origin/recovery/failed-v0.9.9-runtime-proof-2bd649d` | PRESERVE | Same rule — the runtime-proof half of the same failed v0.9.9 attempt. |
| `origin/feat/console-project-doctor` | CLAIMED | Codex lane, worktree `C:\Users\Kuya\code\sentinel-project-doctor`, issue [#55](https://github.com/Pootytxng/sentinel/issues/55). The claim carries a 12-hour alarm with **no automatic takeover**, so an expired clock is not a licence to touch it. `tools/console/doctor.html` is absent from `main`. |
| `origin/claude/harness-context-cleanup-700535` | MERGED | Landed as [#66](https://github.com/Pootytxng/sentinel/pull/66) (squash `6712c14`), so `origin` still carries the pre-squash tip `3808b00`; merge-tree against `main` is a no-op. |
| `origin/fix/fps-pid-identity` | MERGED | Zero commits ahead of `main`; merge-tree no-op. |
| `origin/recovery/codex-019fb092` | MERGED | Zero commits ahead of `main`; merge-tree no-op. |
| `origin/integration/v0.9.8-hardened` | MERGED | Merge-tree no-op. Same commit `d000295` as the v0.9.9 candidate below. |
| `origin/release/v0.9.9-candidate` | MERGED | Merge-tree no-op at `d000295`. |
| `origin/recovery/local-v0.9.8-d9ced24` | MERGED | Merge-tree no-op. |
| `origin/release/0.9.1` | MERGED | Merge-tree no-op. |
| `origin/codex/fix-main-ci-site-stage` | SUPERSEDED | `.github/workflows/ci.yml` on `main` already runs `npm run stage:site` before the site guards. |
| `origin/codex/work-control` | SUPERSEDED | `main`'s `docs/WORK_CONTROL.md` is a strict superset — it carries an 11-line *What "gate" means* section the branch lacks. |
| `origin/chore/ci-encoding-and-state-truth` | SUPERSEDED | `main`'s `scripts/encoding-guard.mjs` is a superset (+54/−3) and `scripts/verify-release-state.mjs` carries 19 anchor matches, so both halves landed and evolved. |
| `origin/i18n/zh-CN` | SUPERSEDED | `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` is byte-identical to `main`'s copy. |
| `origin/latency-capture` | SUPERSEDED | `main`'s `src-tauri/src/latency.rs` is +631/−154 *ahead* of the branch and contains every symbol the branch defines. |
| `origin/docs/claude-md-split` | SUPERSEDED | Re-authored on 2026-08-04, not merged. `353967f` predates `scripts/verify-module-map.mjs` (created 2026-08-02) and would have made all 19 moved modules report `MISSING`; the re-author extends the verifier to read both halves as one map (`SUBMAP-MISSING`, `DUPLICATE`) and moves the Intelligence block the branch never saw. |
| `origin/codex/tool-shed-hygiene` | UNLANDED | **Partially landed.** `scripts/markdown-link-guard.mjs` is byte-identical on `main`, but the `.agents/skills/*` mirror layer (10 files), `scripts/agents-layout-guard.mjs` + its test, two archive splits and the plan doc are all absent. Codex-lane tooling — the unlanded half is the `.agents/` mirror, not a product change. |
| `origin/feat/bklit-anime-design-system` | UNLANDED | One commit `6fac5c1`, 76 files / 10739 insertions — vendors the Bklit UI chart engine + anime.js v4, no Tailwind adopted. Merges clean. **Owner product-scope call** (adopting a vendored design system), not a taste one. |
| `origin/feat/user-feedback-lab-recovery` | UNLANDED | 49 commits, 120 files, 14703 insertions; 42 files absent from `main` (LabDeck, RecDetailCard, the decision-journey IA and its guards). The compaction-window work from this branch *did* land. The Lab candidate sits behind a temporary owner flag and is a large product/design train — **owner review**, and a visual self-review, before any of it moves. |
| `origin/claude/review-consolidation-structure-9d13f2` | UNLANDED | A sibling Claude Code worktree branch, 7 commits ahead / 27 behind `main`. Carries four things `main` does not have: `docs/decisions/2026-08-04-startup-term-analysis-review.md` (absent from `main`), the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 150k→300k bump, Rust test-only coverage in `stutter.rs` / `capture.rs` / `benchmark_trial.rs`, and **a one-line `site/llms.txt` fix — `main` still says "free desktop app", which contradicts the owner's 2026-07-21 monetization decree and is currently live on `compy.gg`.** Predates `support_evidence.rs`, so merging it whole would delete 1,074 lines; the landing path is per-file, not a merge. Not this lane's branch — dispositioned, untouched. |
| `origin/design/quiet-pit-wall` | UNLANDED | **Partially landed.** 22 files / 5147 insertions vs merge-base `36bdf6b`, issue [#49](https://github.com/Pootytxng/sentinel/issues/49). **Half A landed** — the inert `[data-qpw="on"]` token + component-contract layer, its two guard suites, the four prototypes + inventory docs, the `vitest.config.ts` `NODE_ENV` pin, and the `ExperimentBench.css` motion-gate fix. Applied in this commit by `git checkout <branch> -- <paths>`. Not a merge — the branch is ~100 files behind `main`, and merging would drag stale copies. **Half B held — owner territory:** the branch flips `use-motion.ts`'s default from `"full"` to `"system"`, reversing the owner's explicit 2026-06-19 decision; on his own WebView2 (`prefers-reduced-motion: reduce`) that makes the whole app static. Welfare check filed in `OWNER_ACTION_CHECKLIST.md` §D. Held with it: `use-motion.test.ts`, the two `settings.json` locales, `Settings.test.tsx`, the `Walkthrough.tsx` comment. The branch's own guard asserted the flipped default; that assertion was re-pinned to the owner's decision rather than landed. |
| `origin/codex/compy-care-capability-gate` | MERGED | PR [#92](https://github.com/Pootytxng/sentinel/pull/92) merged 2026-08-11 as `5a982647`. Needed a `main` merge first (`e61f3da4` — a line-wrap conflict in `CLAUDE.md`) and then `38135e90`, because #96 + #90 + #92 composed put `CLAUDE.md` at 25,293 bytes against its 25,000 ceiling; the file was trimmed, not the ceiling raised. Re-proven no-op. **Perishable — prune the ref.** |
| `origin/feat/lab-49-parity-port` | UNLANDED | PR [#89](https://github.com/Pootytxng/sentinel/pull/89) closed unmerged 2026-08-08; `93c931a3` sits one commit past the local worktree tip `7e6cd4d7`, no force-push (ancestry intact). The rig half was re-cut into #90, but **three files here exist on neither `main` nor #90** — `scripts/verify-like-ci.mjs`, `scripts/lib/ci-steps.mjs`, `scripts/verify-like-ci.test.mjs`, the local CI runner built when hosted Actions hit exhausted free minutes. **That runner is DECIDED: it dies with its PR** (2026-08-11). `main` reached the same goal by a different road and is now a superset — `scripts/verify-local.ps1` runs the same checks, is actually wired to `.githooks/pre-push` and `npm run verify:local`, probes whether `node_modules` satisfies the manifest (`scripts/deps-satisfied.ps1`), and `scripts/local-gate-guard.test.mjs` already carries the drift catcher that was the runner's real value: every `run:` step in `ci.yml` that is not declared setup must be covered locally, and the one deliberate difference (`stage:site`) is written down with its reason rather than silently missing. Landing a second runner in Node beside the PowerShell one would mean keeping two things in step with `ci.yml` instead of one. Also the parent of the uncommitted `ConfirmDialog` z-index + focus-ring fixes in `C:\Users\Kuya\code\sentinel-quietpitwall` (see `docs/SESSION_HANDOFF.md` §2). |
| `origin/claude/admiring-lumiere-648403` | MERGED | PR [#96](https://github.com/Pootytxng/sentinel/pull/96) merged 2026-08-11 as `eb9fb6ce`. Deleted 21 orphaned `lab.readings.*` / `lab.welcome.*` keys from `en` and `zh-CN` that no component read, and added `src/i18n/orphan-key-guard.test.ts` so a key nothing renders cannot accumulate again. Re-proven no-op. **Perishable — prune the ref.** |
| `origin/claude/merge-prs-tauri-visibility-c5660e` | CLAIMED | Claude lane, own folder under `.claude/`, named for the ref. Landed #96/#90/#92 on the owner's 2026-08-11 ask and carries what fell out of that: the `CLAUDE.md` boot-tax trim and this re-trued record. Also adds `.claude/hooks/handoff-block-guard.mjs` + `scripts/lib/handoff-block.mjs` + `scripts/handoff-block.test.mjs` — the HANDOFF BLOCK law mechanized after the owner had to ask for it by hand again. **The hook is inert until its `.claude/settings.json` Stop entry lands, which is owner-gated.** |
| `origin/docs/close-recovery-lane` | SUPERSEDED | PR [#103](https://github.com/Pootytxng/sentinel/pull/103) squash-landed as `9a479392`, so the content is on `main` under a different hash and merge-tree still differs. The ref is now strictly BEHIND `main` — merging it would revert `docs/UI_VISION_BACKLOG.md`, `src/design/tokens-v2*` and delete `docs/superpowers/specs/2026-08-11-design-navigation-audit.md`. Never a merge target; safe to prune. Its own lane parked this row as CLAIMED on 2026-08-11 reasoning that merge-tree was a no-op *that day* and only a pruned ref may safely say MERGED; `main` has since moved and the no-op is gone, which is exactly the perishability the rule warns about. SUPERSEDED is the word that stays true without a prune — and the prune is still owed: ref deletion was declined to that lane across three paths, and to this one. |
| `origin/claude/nodejs-background-execution-fd4def` | SUPERSEDED | Claude lane, PR [#100](https://github.com/Pootytxng/sentinel/pull/100) — **CLOSED unmerged 2026-08-11.** Its mechanism was measured inert three times out of three: `focus = false` written through `context.config_mut()` does not survive to window creation, so the branch could not do the one thing it existed to do. Replaced, not patched, by `claude/compy-foreground-courtesy-rebuild-60b17e` (PR [#102](https://github.com/Pootytxng/sentinel/pull/102), merged `3d5b8d73`, ref pruned 2026-08-11), which kept this branch's `should_suppress_activation` predicate and its five unit tests — the predicate was never the bug. |
| `origin/claude/foreground-courtesy-handoff-82687b` | CLAIMED | Claude lane, worktree `.claude/worktrees/foreground-courtesy-handoff-82687b`. Ran the on-screen proof PR [#100](https://github.com/Pootytxng/sentinel/pull/100) was waiting on and it **failed three times out of three** — `focus = false` set through `context.config_mut()` does not survive to window creation, so that PR's mechanism is inert (findings on the PR; do not merge it as-is). Chasing it surfaced the owner's ACTUAL complaint — a blank Windows Terminal flashing and self-closing — which measurement traced to `npm test`: seven suites spawn `powershell.exe` without `windowsHide`, and Win11's default terminal turns each one into a real console window. This branch fixes those seven and adds `scripts/console-window-guard.test.mjs` to keep an eighth from appearing. |
| `origin/claude/compy-recovery-closeout-391516` | MERGED | Claude lane, issue [#104](https://github.com/Pootytxng/sentinel/issues/104). Closes the recovery-lane leftovers (two refs pruned, rows removed) and lands the design/navigation audit's two measured defects: `--v2-faint` raised past AA (32 failing text nodes → 0 on the live build, retiring the 29-site ratchet in `tokens-v2-guard.test.ts`) and the rail tab accessible names that read "Home1"/"Blackbook3". Decided-but-unbuilt design work is logged as TYPE-1 / COLOR-1 / UX-1 in `docs/UI_VISION_BACKLOG.md`, evidence in `docs/decisions/2026-08-11-design-navigation-audit.md`. PR [#105](https://github.com/Pootytxng/sentinel/pull/105) merged 2026-08-11 as `63f93b0c`; re-proven no-op. **Perishable — prune the ref.** |

## Standing rule

A new remote ref is undispositioned until it has a row here. The audit is the enforcement; adding
the row is part of the work that created the branch, not a later cleanup.
