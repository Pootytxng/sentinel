# ASTRA INTERRUPTION RECOVERY — lane appendix, 2026-09-07 (Cowork HQ)

**Status: CURRENT.** Opened by the owner's "HQ HANDOFF — ASTRA INTERRUPTION RECOVERY" paste.
Brought current **2026-09-07 ~23:55Z**, after Astra's formal exact-head review.

---

## 1. The operating model the owner set (standing until he changes it)

Codex is **removed from the critical path**. **Claude Code = sole implementation writer ·
chatgpt-hq ("Astra") = independent exact-head reviewer · Cowork = only where local computer-use is
required · no parallel implementation writers.** This narrows the 09-04 "resolve every single task
yourself" directive for implementation work — it removed the gating on the owner's hand, it did not
make Cowork an implementation writer.

**Owner directive, 2026-09-07: every HQ report ENDS with a paste-ready handoff block plus the exact
lane it goes to.** *(Promote into `HQ_DECISION_LEDGER.md`'s standing-directives section on its next
edit.)*

## 2. Where PR #387 stands

**Head `9fd5698acf37a4abf58c6216af4be5b6113d93ed`**, 8 ahead / 0 behind `origin/main` `8d4e90a1`;
`ls-remote` confirms local == remote. Three reviews now exist:

| Review | Bound head | Verdict |
|---|---|---|
| `5125759253` (09-06 15:11Z) | `a8f92477` | CHANGES REQUIRED — 4 findings, **all repaired** |
| `5129939237` (09-07 08:52Z) | `6b7be6e7` | CHANGES REQUIRED — 2 findings, **both repaired** |
| **`5135765472` (09-07 23:23Z)** | **`9fd5698a`** | **CHANGES REQUIRED — 3 blocking findings** |

**Round 2 closed clean.** F1/F2 and HQ's two additions (H3 the doc-comment carrying the same false
absolute; H4 no test asserted either string) are all repaired and confirmed by HQ's own read: old
strings count 0/0, new strings 1/1/1, three rendering guards present through `rendered_entries()`.

## 3. The three blocking findings — verified at source by HQ, not taken from the review

| # | Defect | Site (verified) |
|---|---|---|
| **1** | **Zero identity comparisons render as `Identity producers disagree: No`.** `identity_disagreements()` returns an empty `Vec` both when comparisons ran and agreed AND when there was no snapshot and no baseline. Empty is the only signal — the model carries no comparison-attempted count. | `machine_model.rs:685` (both passes conditional); stored `:679` into `MachineIdentity.disagreements` (`:376`); rendered `diagnostics.rs:553-572` with a note asserting *"Every identity field Compy actually compares … agrees."* |
| **2** | **`build()` reads the Trust Ledger TWICE** and can compose one model from two ledger states. An apply/rollback between the two calls yields a model whose chronology and applied-change projections disagree. | `machine_model.rs:1160` `crate::history::load_history()` **and** `:1161` `crate::history::get_applied_changes()` — whose body re-reads at **`history.rs:1045`** (`load_history().unwrap_or_default().into_iter().map(into_view).collect()`), fn at `history.rs:1037`. |
| **3** | **Answer-B evidence span computed from the CAPPED display list.** Past 25 retained events the span reports a newer "oldest" than `chronology.recorded_from`. | cap `const MAX_CHRONOLOGY: usize = 25;` **`machine_model.rs:35`**; capping `.take(MAX_CHRONOLOGY)` **`:840`** in `compose_chronology` (`:819`); span walked in `compose_evidence` (`:1070`, assignments `:1092-1096`). Precedent: `compose_compy_changes` (`:868`) already returns an uncapped projection for exactly this reason. |

## 4. ⚠️ THE REPAIR EXCEEDS THE LANE'S DECLARED WRITE SCOPE

The active claim (#385 comment `5572593976`, 15:09:40Z) declares, verbatim:

> `- Write scope:` `src-tauri/src/diagnostics.rs`, `src-tauri/src/machine_model.rs`

**Two paths. Finding 2 cannot be fixed inside them.** The second ledger read happens *inside*
`history.rs`, and `into_view` — the projection that would have to accept an already-loaded snapshot
— is **private** at `history.rs:271`, depending on four more private helpers in that file.
Reproducing it in `machine_model.rs` is not viable. **`src-tauri/src/history.rs` must enter the
scope.** Existing precedent for the shape: `summarize_history(&[AppliedChange])` at `history.rs:1237`
already takes a slice.

`lib.rs` is **not** needed (`lib.rs:1222` registers `get_machine_model` by name only). No frontend
consumer exists — zero references to `MachineModel` / `get_machine_model` under `src/`.

**Consequence: a NEW `### Ownership claim` widening scope to three paths must be posted BEFORE any
write**, or `scripts/scope-drift-gate.mjs` measures drift. The superseded 06:37Z claim did include
`history.rs`, but it expired at 12:00Z and the current claim states it is *not inherited*.

## 5. ⚠️ TWO ADJACENT ISSUES SIT INSIDE THE WIDENED SCOPE — do not drift into them

The owner named #392 and #393 out of bounds. Both are *inside the code this repair touches*:

- **#393** — *"`machine_model::build()` assembles the chronology from two of eight producers, so
  `total_events` and 'Most recent' can be false rather than merely partial."* **That is the same
  `build()` Finding 2 edits.** Fix the double read; do not widen producer coverage.
- **#392** — *"`check_change_active` collapses probe failure and unrecognised rec_id into a plain
  false/true…"* **`check_change_active` lives in `history.rs`** and is called by `into_view` — the
  exact function Finding 2 must re-shape. Change the signature/visibility; do not change its
  semantics.

This is the collision the handoff must pre-empt: widening scope to `history.rs` puts the writer's
hands next to #392, and editing `build()` puts them next to #393.

## 6. Reconciliation required before ANY transition (review's own words)

1. **Gate binding** — *"the described log format does not itself bind the run to a SHA and does not
   emit a final PASS/FAIL verdict line."* The final gate must **mechanically bind** to the exact
   40-char head.
2. **Claim/worktree record** — the claim names `.claude/worktrees/weekly-usage-marathon-aa44aa`,
   which was repurposed to `lane/mangled-path-repair`; it *"cannot simply be inherited as proof of
   current workspace ownership."*
3. **Scope drift** — every recent gate run reports `scope drift (#356): not measured -- no session
   record for this folder`. *"Scope proof is absent rather than PASS."*

## 7. Sequence status

| Sequence | Status |
|---|---|
| **1 — #385 / PR #387** | **Round 3 open.** Three blocking findings; repair requires a widened claim. Not merged, not closed, not self-reviewed. Claim expires **2026-09-08T03:05Z**. |
| **2 — release truth reconciliation** | NOT STARTED — gated on #387 landing. #225 owns the release-state files. |
| **3 — preserved-work disposition** | NOT STARTED. **#388 and #389 are DUPLICATE inboxes** — dedup first. |
| **4 — product-audit reproduction** | NOT STARTED. Reproduce before filing. |

## 8. What Cowork HQ did across this lane

- **10:55Z — PR comment `5569560116`** at head `6b7be6e7`: confirmed both of Astra's findings in
  source and added **H3** and **H4**, neither of which was in the review. **Both shipped in the
  repair.** Posted as a plain comment, not a `gh pr review`, so it was never a gate input.
- **Three full live re-derivations** (10:44Z, 23:02Z, 23:52Z). Corrected HQ_RESUME twice — it had
  been wrong on `origin/main`, the HQ worktree's existence, and #385's status.
- **Scoped the round-3 repair before the writer started** — established that it exceeds the declared
  write scope, that `into_view` is private, and that #392/#393 sit inside the blast radius.
- **Never took the pen.** Mutated nothing in the repo, claimed no lease, merged nothing, closed
  nothing.

## 9. The lesson this lane earned

**An expired-looking claim on a cold worktree was a live lane between sessions.** At 10:53Z the #385
worktree had been cold 3h20m, the lane had not answered an 08:52Z review, and its claim alarmed at
12:00Z. Every visible signal read "abandoned". It was not — at 15:05Z the same executor re-claimed
under a new folder and shipped the complete repair, including both of HQ's additions. **Fourth time
on this desk that a cross-agent read of "the other one is idle" was wrong. Cold is not dead; the
alarm is an alarm.**
