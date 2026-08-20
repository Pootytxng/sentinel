# Session handoff — 2026-08-19 (#145 merged + pruned · C-18 mid-train)

**Lane OPEN.** Branch `agent/monitor-shell-retire` in `C:\Users\Kuya\code\sentinel-home-room`, one
commit `e930894f` on top of `main@65dd6110`. **Its first push is IN FLIGHT** through the pre-push
gate (~4-5 min); nothing else is uncommitted.

## Landed on `main` this session

**1 — PR [#145](https://github.com/Pootytxng/sentinel/pull/145) merged as `12d9c96a`** (C-17b mono
ceiling 12 → 0, C-12's `shipped-feature-doc-truth` guard, the re-disposition). Work-control receipt
for the `merge-pr` transition: **PASS** at `d7c96656`, gates `npm test` + `cargo test` (963) re-run
at that exact head, independent review recorded **not practical** (no non-writing model attached).

**2 — `origin/agent/home-room-question` pruned, row dropped, `65dd6110` pushed (gate PASS).**
The "same commit" the last handoff asked for is **mechanically impossible** and that is now written
into the commit message: the audit fails a ref with no row AND a row with no ref, so the ref
deletion sits BETWEEN the local commit and the push. One operation, two states; the pre-push gate
re-proves both halves at once. The local branch `agent/home-room-question` still exists (this
worktree was on it); it is safe to delete once a worktree is not holding it.

## In flight — C-18 (issue [#146](https://github.com/Pootytxng/sentinel/issues/146))

Commit `e930894f`. Claim posted on #146 with worktree/branch/scope/expiry.

- **Archived first, because the byte wall demanded it:** the fully-shipped LIVE UPDATER + first
  field-QA section (12 rows, zero open) moved **verbatim** to `docs/BACKLOG_ARCHIVE.md` behind a
  pointer. `docs/BACKLOG.md` **111.4KB → 106.5KB** of 114KB.
- **The row was wrong a third time.** `src/surfaces/Monitor.tsx` was NOT unreferenced —
  `MonitorV2.tsx:6` imported `TuningPresets` out of it, so deleting the file would have broken the
  build. Dead was the ROOM inside the live file: `export default Monitor` had no production
  importer. Fix: `TuningPresets` moved verbatim to `src/surfaces/TuningPresets.tsx`, then the shell
  + `Monitor.css` + `Monitor.test.tsx` deleted (353 lines). The surviving assertion (un-`bare`
  presets keep their own `<h2>`) now runs against the component directly.
- **bug→guard:** `src/reachability-guard.test.ts` grew a second tier — a module whose DEFAULT-exported
  symbol has no production importer under either form (`import X from` / lazy edge, or
  `import { X }` when also named-exported) fails. The both-forms rule is load-bearing: without it,
  26 live dual-export surfaces read as dead. **Falsified against the pre-fix tree** — names exactly
  `surfaces/Monitor.tsx`.
- **Two more found, named not swept → new row C-18b:** `src/Onboarding.tsx` (superseded by
  `SetupTour`; kept alive by `ONBOARDED_KEY` + `type RigLine`, and read as SOURCE TEXT by four other
  guards) and vendored `design/vendor/Stepper/Stepper.tsx` (only `StepIndicator`/`StepConnector`
  used). Both carry a reasoned `DEFAULT_ALLOWED` entry.
- Verification at `e930894f`: `tsc --noEmit` clean · reachability-guard 6/6 · monitor-v2 19/19 ·
  doc-budget ALL PASS · branch-disposition-audit OK.

## The exact next steps, in order

1. **When the push lands:** add the disposition row for `origin/agent/monitor-shell-retire` — the
   text is parked at `/tmp/disp-row.md` (a full copy of `docs/BRANCH_DISPOSITIONS.md` WITH the row).
   It cannot ride the first push: the audit fails a row whose ref does not exist yet. Commit it as
   its own change and push again — precedent `e8a7f507`.
2. **Open the PR** — body is drafted and ready at
   `%TEMP%\claude\c--Users-Kuya-code-sentinel-home-room\826f180b-470f-4cb1-b295-dd91ed0608d2\scratchpad\pr-c18.md`
   (`gh pr create --title "refactor(monitor): the file was live, the room inside it was not — C-18 (#146)" --body-file <that>`).
   Then merge it, prune the ref, drop its row — same ordering as step 2 above.
3. **Then the next non-gated `[ ]`:** C-13 (axe-core in vitest — the one with a guard shape) or the
   new C-18b. Still open and untouched: the dead `.arc-v2` skin finding (**do NOT delete on current
   evidence**), C-14 (`GpuProfile.tsx` — owner fork), #121, #140, the Codex weekly-automation scope.

## The debt that still carries

**The C-17b RESIDUAL visual review — 6 of 12 selectors measured.** The desk build `40682344`
predates `be4c81ec`, so none of the mono work is on it. Next build → `scripts/ship-reinstall.ps1` →
run the `self-review` skill against those selectors. This lane adds nothing to that debt: it deleted
an unmounted shell and moved a component verbatim, and the render is pinned by tests.
