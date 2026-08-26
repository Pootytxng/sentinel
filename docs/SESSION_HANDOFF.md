# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines, and this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are
> all AT cap — trim or archive before adding a line anywhere. Replace this file, never append.

## Where the train is standing

**NOTHING IS MID-FLIGHT. `main` is clean and every issue this train touched is closed.** Compy Care **Tier 1 plan tasks
8–9** — crash-rescue discoverability and the persisted local incident observer — landed 2026-08-26 as
PR [#223](https://github.com/Pootytxng/sentinel/pull/223) (`0e8f7835`). Tasks 1–7 landed before it as
PR [#221](https://github.com/Pootytxng/sentinel/pull/221).

| | |
|---|---|
| `main` | deliberately not pinned — run `git log --oneline -3` |
| Plan | `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md` (11 tasks) |
| Landed | **plan tasks 1–9 of 11**: schema · trust root · cache · matcher · pull path · wire contract · UI · discoverability · observer |
| Gate | `pwsh scripts/verify-local.ps1` **PASS at every pushed head this train** — 391 files, Rust 1155 passed, clippy clean |
| Receipts | `.claude/work-control/2026-08-25-merge-pr-223.json` (+ `…-merge-pr-221.json`, `…-close-issue-220.json`) |

**STILL DARK, three independent locks, none of them touched:** `case_intelligence_gate()` is
hard-false · `CASE_SIGNING_PUBKEY` is all zeros · `CASE_CATALOG_ENDPOINTS` **and**
`CASE_CATALOG_ORIGINS` are both empty. `refresh_case_catalog` is not registered as a command and
nothing calls it. Arming is plan tasks 10–11 and is **owner territory**.

**What #223 added, and why it is safe:** `src-tauri/src/incident_observer.rs` (new, ~1268 lines)
watches Windows' own crash records through the existing local Black Box path, remembers what it has
already told you about, and offers the way back. It opens no network path of its own, runs no
background machinery — exactly three triggers, all user-caused — makes no causal claim in its DTO,
and `git diff … -- src-tauri/src/actions.rs` is **empty**, so the one Windows-mutation boundary is
untouched.

- **Nine worktrees besides `main`. Five are spent; four carry commits that are not on main — do
  NOT delete or hard-reset those four before checking them**: `feat/user-feedback-lab-recovery`
  (49) · `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). A tenth, detached with no branch name at all, hid for
  fifteen days because every audit here reads `origin` refs and a branchless checkout has none; it
  was retired 2026-08-26 under tag `preserve/checklist-disk-item-c5660e` (5 commits, recoverable,
  none on `main`). Rule C of `scripts/handoff-worktree-truth.test.mjs` now fails the build if a
  checkout carries commits and this bullet does not name it. Re-derive with `git worktree list` and
  `git rev-list --count origin/main..<branch>`; never carry these numbers forward unchecked.

## What the pre-land review caught

Three findings in the observer, all fixed in `97a0e945` with a guard each, and a second pass at the
landing head returned CLEAN. Now a closed record — moved verbatim to
[`archive/PR_223_PRELAND_REVIEW.md`](archive/PR_223_PRELAND_REVIEW.md) on 2026-08-26 to pay this
file's line budget. Read it there before re-deriving any of it.

## Two gate traps this lane paid for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE that pairs the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts as "merge"** — fixing the first
  offender creates the second. Reword, never loosen (precedent PR #166). Run
  `node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs` **alone** before pushing: seconds,
  versus four minutes inside `.githooks/pre-push`. Its corpus now includes `git status`, so
  uncommitted docs are scanned too — the hand-run stopped lying on 2026-08-26.
- **`scripts/process-mutex-guard.test.mjs` flakes under full parallelism.** It failed once at a head
  that then passed unchanged; the same test passes 6/6 standalone. Re-run it alone before believing
  it — and record the re-run, do not waive the failure.

## THE NEXT STEP, exactly

**#222 and #128 are both closed, with receipts** — `.claude/work-control/2026-08-26-close-issue-{222,128}.json`,
work-control gate PASS at `7764df4a`, three independent verification passes behind them (two returned
FIX-BEFORE-CLOSE; the third CLEAN). **All three Tier 1 nits are closed too** (`b9a71258`, `f5f9e3ac`):
`catalog_version` is bounded to what JavaScript represents exactly, the orphan scan's crate corpus
walks subdirectories, and a failed `openUrl` now shows the URL instead of looking like a dead click
(self-review PASS 12/12). PHASE C's nit queue is empty. Nothing is half-done. Pick one:

1. **Q9b — Tier 3 in-app feedback + crash reports** (`docs/BACKLOG.md`, own module
   `src-tauri/src/case_evidence_upload.rs`, never inside `support_evidence.rs`). Tier 3's gate applies
   in full: per-case consent, preview/redaction, named recipient, retention, deletion receipt.
2. **A wayfinding pass under DIR-1** (`docs/UI_VISION_BACKLOG.md`) — walk every room as a
   first-time non-technical gamer, fix each place someone cannot tell what to do next, before/after
   each. His standing directive, restated "many times", and the lens over every 🔴 row in that file.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Lab is the Ops Console
(`LabConsole`), and the proving bench it was meant to deliver already ships armed as
`ExperimentBench`. `src/superseded-plan-citation-guard.test.ts` now fails the build if any live doc
points at a superseded plan or spec without saying so.

**Do NOT touch** plan tasks 10–11 (independent security review + arming). Owner territory, filed in
`docs/OWNER_ACTION_CHECKLIST.md` §C so that arming can never happen quietly.

**Before any UI work:** the owner's design vision lives in `docs/UI_VISION_BACKLOG.md`, whose
still-🔴 OPEN rows today are **DIR-1** (the standing intuitive-UI directive) and **§G** (the site).
Read those two rows there; do not re-queue a row from a paraphrase of them.

## Waiting on the owner — two arming gates, and nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately not listed here as
blockers** — `compy.gg` registration, the Ko-fi URL and Compy Pro pricing all live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes.

- **Receipts telemetry arming** (§C) — the consent UI is built, self-reviewed PASS 12/12, and ships
  as built under the taste decree; only the arming itself is his.
- **Tier 1 arming** (§C) — signing-key custody, the catalog domain, and the arming itself, after an
  independent security review.

**Three asks that used to sit here were never really his:** #128 (`B_shelter`) landed on `main` on
2026-08-21 — its issue is closed with a gated receipt, and `scripts/shelter-tag-guard.test.mjs`
fails the build if a doc ever again calls landed work unpublished · **#213's B half** was retracted at
source (B1/B5 shipped, B3 disproven, B2/B4 never defects) · **the Q9a consent screens** are a taste
call the 2026-08-07 decree makes the lane's to ship and his to veto on sight, not a ruling he owes.
