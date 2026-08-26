# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines, and this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are
> all AT cap — trim or archive before adding a line anywhere. Replace this file, never append.

## Where the train is standing

**ONE THING IS MID-FLIGHT — the two issue closes under THE NEXT STEP.** Compy Care **Tier 1 plan tasks
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

- **Ten worktrees besides `main`. Five are spent; five carry commits that are not on main — do
  NOT delete or hard-reset those five before checking them**: `feat/user-feedback-lab-recovery`
  (49) · `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3) · and one carrying **no branch name at all**,
  `.claude/worktrees/merge-prs-tauri-visibility-c5660e`, detached at `defcf0ff`, 4 commits
  (the `claude/checklist-disk-item-c5660e` lineage). It hid for fifteen days because every audit
  here reads `origin` refs and a detached checkout has none; rule C of
  `scripts/handoff-worktree-truth.test.mjs` now fails the build if a checkout carries commits and
  this bullet does not name it. Re-derive with `git worktree list` and
  `git rev-list --count origin/main..<branch>`; never carry these numbers forward unchecked.

## What the pre-land review caught, and the guards that now hold it

An independent `rust-tauri-reviewer` pass found three things in the observer, all fixed in
`97a0e945`, each with a guard, per the bug→guard law. A second pass at the landing head returned
**CLEAN** after re-running the Rust suite, clippy, vitest and `tsc` itself.

1. **A dismissed crash could be announced again.** `incident_id` is a hash over the crash's traits
   *including its instant*, and `blackbox::merge_into` moves that instant — and fills in the faulting
   module — the moment a corroborating WER report lands. So one crash wears two ids across two scans,
   the second reads as never-seen, and a card you had just dismissed comes back. Fixed by recording
   each row's matching traits at observation time and reconciling shifted identities *before* anything
   decides what is new, gated on the old id having left the report so a genuine crash-loop repeat
   still counts as two. Guards: `a_dismissed_crash_is_not_reannounced_when_its_identity_shifts` and
   `two_ids_that_are_both_live_stay_two_incidents`.
2. **A lost-update race on the state file**, plus a shared temp filename. Fixed with one process lock
   around every read-modify-write (the expensive scan stays *outside* it) and a per-call temp path.
3. **A guard that read raw source**, so a `// TODO: wire ScanTrigger::Foreground` could satisfy it.
   Now comment-stripped, and it asserts real call sites.

The second pass's one nit — the `should_scan` guard regex also accepted an *unlocked* watermark read,
the exact regression finding 2 exists to catch — was taken in the same commit as this file, and
falsified before it was counted.

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

**IN FLIGHT:** #222/#128 are NOT closed. Receipts sit uncommitted at
`.claude/work-control/2026-08-26-close-issue-{222,128}.json`: rebind `currentHead` to the head you
gate at, fill `independentReview`, close both naming what is NOT closed, push. Then pick one:

1. **The three queued Tier 1 nits** in `docs/BACKLOG.md` PHASE C — all small, all real.
2. **Q9b — Tier 3 in-app feedback + crash reports** (`docs/BACKLOG.md`, own module
   `src-tauri/src/case_evidence_upload.rs`, never inside `support_evidence.rs`). Tier 3's gate applies
   in full: per-case consent, preview/redaction, named recipient, retention, deletion receipt.
3. **The Instrument Bench Phase-1 build** —
   `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`. The decided first UI target.

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
2026-08-21 — its issue closes with the in-flight receipt above, and `scripts/shelter-tag-guard.test.mjs`
fails the build if a doc ever again calls landed work unpublished · **#213's B half** was retracted at
source (B1/B5 shipped, B3 disproven, B2/B4 never defects) · **the Q9a consent screens** are a taste
call the 2026-08-07 decree makes the lane's to ship and his to veto on sight, not a ruling he owes.
