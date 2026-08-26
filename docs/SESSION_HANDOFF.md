# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines, and this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are
> all AT cap — trim or archive before adding a line anywhere. Replace this file, never append.

## Where the train is standing

**NOTHING IS MID-FLIGHT. `main` is clean, pushed, and the whole suite is green.** The last train
shipped **the first-win journey** — P2's remaining UI item and the last open half of the owner's
DIR-1 directive.

| | |
|---|---|
| `main` | deliberately not pinned — run `git log --oneline -3` |
| Shipped | `src/surfaces/FirstWin.tsx` + `first-win-data.ts` on Home, beside `TrustMoment` |
| Gate | `npx vitest run --maxWorkers=4` — 394 files, 5598 passed, 2 skipped · `tsc --noEmit` clean |
| Self-review | PASS 12/12, six fixture states × their click sequences, installed build at 1500×980 |
| Before it | Care Tier 1 tasks 1–9 of 11 ([#221](https://github.com/Pootytxng/sentinel/pull/221), [#223](https://github.com/Pootytxng/sentinel/pull/223)); #222, #128, #220 closed with receipts |

**What FirstWin is.** `TrustMoment` rehearses apply → receipt → rollback on a demo setting while the
Trust Ledger is EMPTY. FirstWin is the other half: it appears once, on the newest still-active ledger
entry, and walks the user from press to proof to undo. *Check my PC again* re-reads
`get_recommendations` and compares the ledger's `is_still_active` against the machine's
`currently_applied` · *Put it back* is the audited `rollback_change` · *Got it* dismisses for good.

The two gate on exact complements and can never co-render. **It claims no speed result, and that is
load-bearing:** no play session has happened, so the note under every verdict — the good one included
— says only playing can answer that and names the room that measures it. A `reverted` verdict offers
no undo button on purpose, and a failed READ is a different state from a setting not FOUND.

**A race was found and fixed mid-build, guarded both ways.** The first draft called the PARENT's
refresh and read `recs` back through a ref — but that refresh resolves when its invokes settle, while
React has only SCHEDULED the re-render, so the ref still held the pre-change list and a reverted
change would have been confirmed as HELD. The read is now made inside the component and awaited;
pinned by `FirstWin.test.tsx` → *"reads the machine at press time"*.

**STILL DARK, three independent locks, none touched:** `case_intelligence_gate()` is hard-false ·
`CASE_SIGNING_PUBKEY` is all zeros · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` are both
empty; `refresh_case_catalog` is not registered and nothing calls it. Arming is tasks 10–11, **owner
territory**.

- **Nine worktrees besides `main`. Five are spent; four carry commits that are not on main — do
  NOT delete or hard-reset those four before checking them**: `feat/user-feedback-lab-recovery`
  (49) · `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). A tenth, detached with no branch name at all, hid for
  fifteen days because every audit here reads `origin` refs and a branchless checkout has none; it
  was retired 2026-08-26 under tag `preserve/checklist-disk-item-c5660e` (5 commits, recoverable,
  none on `main`). Rule C of `scripts/handoff-worktree-truth.test.mjs` now fails the build if a
  checkout carries commits and this bullet does not name it. Re-derive with `git worktree list` and
  `git rev-list --count origin/main..<branch>`; never carry these numbers forward unchecked.

## Reviewing a UI state you cannot reach on the rig

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`. Six FirstWin states were added (`?state=firstwin-held` · `-reverted` ·
`-unreadable` · `-check-failed` · `-undo-failed` · `-latest`) because every verdict needs a real
applied change and review may not apply one. Serve with
`npx vite --config docs/ui-sweep/fixture/vite.config.mts` on 5199; a bare `/` drops your `?state=`.
`src/fixture-parity-guard.test.ts` fails the build if the stub stops answering a command the card
sends, **or if `rollback_change` is answered outside the FirstWin branch** — a mutation answer stays
scoped to the states that need it.

## Two gate traps this repo keeps paying for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE that pairs the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts as "merge"** — fixing the first
  offender creates the second. Reword, never loosen (precedent PR #166). Run
  `node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs` **alone** before pushing: seconds versus
  four minutes in `.githooks/pre-push`. Its corpus now includes `git status`, so uncommitted docs
  are scanned too — the hand-run stopped lying on 2026-08-26.
- **`scripts/process-mutex-guard.test.mjs` flakes under full parallelism** — it failed once at a head
  that then passed unchanged, and passes 6/6 standalone. Re-run alone, and RECORD the re-run.
- **A doc-budget FAIL is paid from the ARCHIVE, never from the cap** — oldest CLOSED row to
  `BACKLOG_ARCHIVE.md` byte-for-byte, one collapsed pointer, then ratchet the cap DOWN (done again
  2026-08-26: P1's Q4/Q5/Q6/Q7 legs archived, 28160 → 26624).

## THE NEXT STEP, exactly

P2's last item is the **Consumer / Technical / Support evidence exports** — the only thing left under
both `BACKLOG.md` P2 and `UI_VISION_BACKLOG.md` DIR-1. Pick one:

1. **The evidence exports** — three projections of what Compy already holds locally, for a user, a
   technician, and a support thread. The backend half exists (`src-tauri/src/support_evidence.rs`
   writes bounded, twice-redacted records; `src/surfaces/SupportEvidence.tsx` previews and exports
   them); missing are the Consumer and Technical projections as SURFACES.
2. **A wayfinding pass under DIR-1** (`docs/UI_VISION_BACKLOG.md`) — walk every room as a
   first-time non-technical gamer, fix each place someone cannot tell what to do next, before/after
   each. His standing directive, restated "many times", and the lens over every 🔴 row in that file.
3. **Q9b — Tier 3 in-app feedback + crash reports** (`docs/BACKLOG.md`, own module
   `src-tauri/src/case_evidence_upload.rs`, never inside `support_evidence.rs`). Tier 3's gate in
   full: per-case consent, preview/redaction, named recipient, retention, deletion receipt.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Lab is the Ops Console
(`LabConsole`), and the proving bench it was meant to deliver already ships armed as
`ExperimentBench`. `src/superseded-plan-citation-guard.test.ts` fails the build if any live doc
points at a superseded plan or spec without saying so.

**Do NOT touch** plan tasks 10–11 (independent security review + arming). Owner territory, filed in
`docs/OWNER_ACTION_CHECKLIST.md` §C so that arming can never happen quietly.

**Before any UI work:** read `docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — today **DIR-1** (the
intuitive-UI directive) and **§G** (the site). Read them THERE; never re-queue from a paraphrase.

## Waiting on the owner — two arming gates and two rulings, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately not listed here as
blockers** — `compy.gg` registration, the Ko-fi URL and Compy Pro pricing all live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
- **Two yes/no rulings, each already carrying a recommendation** and neither blocking anything: the
  wordmark reading `©ompy` at rail size ([#213](https://github.com/Pootytxng/sentinel/issues/213) A1
  — his because it is the LOGO, and it is the mark he approved, not a regression) and the verdict
  headline's "· and 3 more" tail ([#219](https://github.com/Pootytxng/sentinel/issues/219) — his only
  because the fix edits the sentence he picked in #180 §C).
