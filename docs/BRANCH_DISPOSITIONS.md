# Branch dispositions — every remote ref, and why it still exists

> **Current state only.** One row per live ref on `origin`. `scripts/branch-disposition-audit.mjs`
> fails the build when a ref has no row, when a row names a ref that is gone, or when a `MERGED`
> row is not actually a no-op against `main`. Run `node scripts/branch-disposition-audit.mjs`.

This file exists because `docs/BACKLOG.md` claimed *"every branch has a verified disposition"* while
nothing had ever checked one. Q6 retired that claim as false (issue
[#65](https://github.com/Pootytxng/sentinel/issues/65)); this is the artifact that makes it true.

## How a disposition is proven

The authoritative test is **merge-tree**, not ahead/behind: lanes land through PRs, so the commits on
`main` carry different hashes and `git cherry` / `A...B` both mislead (a three-dot diff reported +195
lines for `latency-capture`, every symbol of which is already on `main`).

```bash
git merge-tree --write-tree main origin/<branch>
```

Equal to `git rev-parse main^{tree}` → merging changes nothing → the branch is **MERGED**. Otherwise
the branch is compared file-by-file against `main` and dispositioned on that evidence.

| disposition | meaning | action |
| --- | --- | --- |
| `MERGED` | merge-tree is a no-op; `main` already contains it | prunable |
| `SUPERSEDED` | not a no-op, but its content reached `main` by another path | prunable |
| `PRESERVE` | must never be deleted, moved, or merged | leave alone |
| `CLAIMED` | another lane holds it under `docs/WORK_CONTROL.md` | hands off |
| `UNLANDED` | carries real work that is not on `main` | needs a decision |

The audit reads **local remote-tracking refs** — it reflects the last `git fetch`, not the server.

## The refs

Swept 2026-08-04 against `main` @ `1a513cb`.

| ref | disposition | evidence |
| --- | --- | --- |
| `origin/beta/private-beta-001` | PRESERVE | The frozen beta ref `16069fa`, LOCKED by CLAUDE.md ("never move the frozen beta refs"). Merge-tree is a no-op, so it is an ancestor of `main` — that makes it safe, not prunable. |
| `origin/recovery/failed-v0.9.9-prepare-1fa06a8` | PRESERVE | A preserved failed release candidate. `docs/RELEASE_AUTONOMY.md`: "Preserve every failed candidate before reset, replacement, or abandonment." Never a merge target. |
| `origin/recovery/failed-v0.9.9-runtime-proof-2bd649d` | PRESERVE | Same rule — the runtime-proof half of the same failed v0.9.9 attempt. |
| `origin/feat/console-project-doctor` | CLAIMED | Codex lane, worktree `C:\Users\Kuya\code\sentinel-project-doctor`, issue [#55](https://github.com/Pootytxng/sentinel/issues/55). The claim carries a 12-hour alarm with **no automatic takeover**, so an expired clock is not a licence to touch it. `tools/console/doctor.html` is absent from `main`. |
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
| `origin/feat/bklit-anime-design-system` | UNLANDED | One commit `6fac5c1`, 76 files / 10739 insertions — vendors the Bklit UI chart engine + anime.js v4, no Tailwind adopted. Merges clean. **Owner taste call**, not an engineering one. |
| `origin/feat/user-feedback-lab-recovery` | UNLANDED | 49 commits, 120 files, 14703 insertions; 42 files absent from `main` (LabDeck, RecDetailCard, the decision-journey IA and its guards). The compaction-window work from this branch *did* land. The Lab candidate sits behind a temporary owner flag and is a large product/design train — **owner review**, and a visual self-review, before any of it moves. |
| `origin/claude/review-consolidation-structure-9d13f2` | UNLANDED | A sibling Claude Code worktree branch, 7 commits ahead / 27 behind `main`. Carries four things `main` does not have: `docs/decisions/2026-08-04-startup-term-analysis-review.md` (absent from `main`), the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 150k→300k bump, Rust test-only coverage in `stutter.rs` / `capture.rs` / `benchmark_trial.rs`, and **a one-line `site/llms.txt` fix — `main` still says "free desktop app", which contradicts the owner's 2026-07-21 monetization decree and is currently live on `compy.gg`.** Predates `support_evidence.rs`, so merging it whole would delete 1,074 lines; the landing path is per-file, not a merge. Not this lane's branch — dispositioned, untouched. |
| `origin/design/quiet-pit-wall` | UNLANDED | **Partially landed.** 22 files / 5147 insertions vs merge-base `36bdf6b`, issue [#49](https://github.com/Pootytxng/sentinel/issues/49). **Half A landed** (this commit, by `git checkout <branch> -- <paths>`, not a merge — the branch is ~100 files behind `main` and merging would drag stale copies): the inert `[data-qpw="on"]` token + component-contract layer, its two guard suites, the four prototypes + inventory docs, the `vitest.config.ts` `NODE_ENV` pin, and the `ExperimentBench.css` motion-gate fix. **Half B held — owner territory:** the branch flips `use-motion.ts`'s default from `"full"` to `"system"`, reversing the owner's explicit 2026-06-19 decision; on his own WebView2 (`prefers-reduced-motion: reduce`) that makes the whole app static. Welfare check filed in `OWNER_ACTION_CHECKLIST.md` §D. Held with it: `use-motion.test.ts`, the two `settings.json` locales, `Settings.test.tsx`, the `Walkthrough.tsx` comment. The branch's own guard asserted the flipped default; that assertion was re-pinned to the owner's decision rather than landed. |

## Standing rule

A new remote ref is undispositioned until it has a row here. The audit is the enforcement; adding
the row is part of the work that created the branch, not a later cleanup.
