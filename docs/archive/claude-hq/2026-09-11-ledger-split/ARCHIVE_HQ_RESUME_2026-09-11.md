# ARCHIVE — HQ Resume as of 2026-09-11 (pre-reduction, verbatim)

**HISTORY class. Evidence, not authority.** Frozen verbatim copy of `claude/HQ_RESUME.md` taken
2026-09-11 immediately BEFORE the STEP 5 reduction to volatile pointers.

- Source: `claude/HQ_RESUME.md`, Project-stored, `created_at 2026-09-07T23:59:18Z`, self-dated
  "Brought current: 2026-09-07 ~23:55Z".
- Size at capture: 10,305 bytes / 146 lines (UTF-8, measured).
- **Every state claim below is STALE.** It describes `origin/main = 8d4e90a1` and PR #387 as open in
  round 3. Live `main` on 2026-09-11 is `245367e0` and PR #387 merged 2026-09-08T05:34:08Z.
- Do not act on it. Do not quote it as current state.

---

# HQ RESUME — the volatile first-read

`claude/HQ_DECISION_LEDGER.md` — stable tail (laws, traps, lessons).
`claude/ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md` — **CURRENT lane appendix.** Operating model, the
three blocking findings with verified sites, the scope problem, and the four sequences.
`claude/DESK_CONFLICT_AUDIT_2026-09-04.md` — the 09-04 defect map, fix set F1–F6 (landed 09-05).
`claude/MIGRATION_TO_VSCODE_2026-08-24.md` — historical.
`claude/MONEY_REPLAN_2026-08-23.md` · `claude/PRICING_DECISION_2026-08-23.md` (**#204: $29 one-time**) ·
`claude/LEGAL_REVIEW_2026-08-23.md` · `claude/MSIX_STORE_SCOPE_2026-08-23.md` (#205 NO-GO) ·
`claude/DISTRIBUTION_SCOPE_2026-08-23.md` (#206).
**Read this first. If any two disagree about current state, this file wins.**

**Brought current: 2026-09-07 ~23:55Z** (Cowork HQ; state moved three times in one day — 10:55Z,
23:02Z, 23:52Z).

---

## 🚦 OPERATING MODEL — set by the owner 2026-09-07, binds every lane

**Codex is removed from the critical path.**

- **Claude Code = sole implementation writer.**
- **chatgpt-hq ("Astra") = independent exact-head reviewer.**
- **Cowork = only where local computer-use is specifically required.**
- **No parallel implementation writers.** One lane at a time.

Narrows the 09-04 "resolve every single task yourself" directive for implementation work: it removed
the gating on the owner's hand, it did not make Cowork an implementation writer.

**Owner directive, 2026-09-07: every HQ report ENDS with a clearly stated handoff — a paste-ready
instruction block plus the exact lane it goes to.** A report naming a next action without a
paste-ready block and its target lane is unfinished. *(Promote into the ledger's standing-directives
section on its next edit.)*

## ⚡ RESUME POINT

- **`origin/main` = `8d4e90a1d9c30015a40b8a2a9e7bf97d86019cb2`.**
- **PR #387, head `9fd5698acf37a4abf58c6216af4be5b6113d93ed`**, 8 ahead / 0 behind main; local ==
  remote. Title still `[DO NOT MERGE - awaiting HQ exact-head review]`.
- **ROUND 3 IS OPEN.** Astra's formal review **`5135765472`** (09-07 23:23Z, bound to `9fd5698a`) —
  **CHANGES REQUIRED, three blocking findings**:
  1. **Zero identity comparisons render as `Identity producers disagree: No`** — `identity_disagreements()`
     (`machine_model.rs:685`) returns an empty `Vec` both when comparisons ran and agreed and when
     nothing was compared; rendered `diagnostics.rs:553-572`. Needs a "not compared" state + a
     zero-snapshot/zero-baseline rendered regression.
  2. **`build()` reads the Trust Ledger twice** — `machine_model.rs:1160` `load_history()` and `:1161`
     `get_applied_changes()`, which re-reads at **`history.rs:1045`**. One model can be composed from
     two ledger states. Needs a single snapshot + a regression proving split-state composition is
     impossible.
  3. **Answer-B evidence span computed from the CAPPED list** — cap `MAX_CHRONOLOGY = 25`
     (`machine_model.rs:35`), applied `:840`; span walked in `compose_evidence` (`:1070`). Needs the
     uncapped source + a `>MAX_CHRONOLOGY` regression.
- **ROUNDS 1 AND 2 CLOSED CLEAN.** Both of Astra's round-2 findings and **both of HQ's additions**
  (comment `5569560116` — the doc comment carrying the same false absolute, and *no test asserted
  either string*) are repaired and confirmed by HQ's own read.
- ⚠️ **THE ROUND-3 REPAIR EXCEEDS THE LANE'S DECLARED WRITE SCOPE.** The active claim (#385 comment
  `5572593976`, 15:09:40Z) declares exactly `src-tauri/src/diagnostics.rs`,
  `src-tauri/src/machine_model.rs`. Finding 2's second read is inside `history.rs`, and `into_view`
  (`history.rs:271`) is **private**. **`src-tauri/src/history.rs` must enter the scope via a NEW
  ownership claim before any write.** `lib.rs` is not needed; no frontend consumer exists.
- ⚠️ **#392 and #393 sit inside the blast radius and are out of bounds.** #393 is about the same
  `machine_model::build()` Finding 2 edits (chronology from two of eight producers); #392 is about
  `check_change_active`, which lives in `history.rs` and is called by `into_view`.
- **Active claim:** `claude-code`, lane `385-diagnostics-truth-repair`, branch
  `claude/385-diagnostics-truth-repair` fast-forwarding into `claude/385-machine-model-v1`,
  **expires `2026-09-08T03:05Z`**. ⚠️ Its declared worktree
  `.claude/worktrees/weekly-usage-marathon-aa44aa` was **repurposed** to `lane/mangled-path-repair` —
  per the review it *"cannot simply be inherited as proof of current workspace ownership."*
- **Three reconciliations required before ANY transition:** gate evidence **mechanically bound to the
  exact 40-char SHA** (the current log format binds to a folder, emits no PASS/FAIL line); the
  claim/worktree record; and scope drift, which every recent run reports as
  `not measured -- no session record for this folder` — **absent, not PASS**.
- **The HQ worktree `C:\Users\Kuya\code\sentinel-hq-desk-fix` is GONE.** Any HQ lane needs a fresh
  worktree and pays a full cargo build. HQ scratch: `C:\Users\Kuya\code\hq-consolidation-388\`.
- **Open PRs:** #387, #391, #317 (draft), #306, #297, #294.
- ⚠️ **Main checkout `C:\Users\Kuya\code\sentinel` has git identity `t <t@t>`** — a named defect. Set
  identity before any commit from it.
- **Leases are `### Ownership claim` comments on the linked ISSUE**; `claim-scope.mjs` parses the
  literal `- Write scope:` bullet, `scope-drift-gate.mjs` enforces it, newest claim supersedes,
  **expiry is an alarm not a licence**.
- **Fleet: v0.9.26 / `5e64074c`** · **Desk stamp UNVERIFIED** — **#225 owns the release-state files.**

## 🚦 WHAT NEEDS THE OWNER

| | |
|---|---|
| **#387 round 3** | Paste the repair handoff into the **Claude Code lane `385-diagnostics-truth-repair`**. It must widen its claim to three paths first. |
| **#388 / #389 duplicate inboxes** | Same title; #389 holds five lane comments. Dedup before SEQUENCE 3. |
| **Codex sandbox posture** | `never` / `danger-full-access`, network on, `c:\users\kuya` trusted. One word flips it. |
| **Native "approve" state** | GitHub won't let the owner's account approve its own PRs. A bot account is the only route — purchase-free, but yours. |
| — | Publish GO · deploy GO · purchases · `[STATE]` blank · DRAFT labels · confirm $29 · screenshots · EULA cap — unchanged. |

## 📋 OWED / OPEN

- **SEQUENCE 2 (release truth reconciliation)** — gated on #387 landing. Re-derive current main and
  actual installed/build state; run the release-state verifier; repair only measured drift. **#225
  owns the files.**
- **SEQUENCE 3 (preserved-work disposition)** — native #225 Health issue, seven preserved Health
  commits, Codex banner-sweep residue, the guard patch in `hq-desk-fix-2026-09-04\`. Classify each
  STILL NEEDED / ALREADY LANDED / SUPERSEDED / CONFLICTING. **No wholesale replay.**
- **SEQUENCE 4 (product-audit reproduction)** — TextInputHost/Windows-component crash getting Steam
  repair advice; Test tools before the guided outcome flow; dependency audit with exact
  package/advisory/runtime reachability. **Reproduce first.**
- **New issues filed off #387:** #392 (`check_change_active` collapses probe failure and unrecognised
  rec_id), #393 (`build()` chronology from two of eight producers). **Both out of bounds for round 3.**
- **The scope-drift gate is not measuring** — worth its own issue.
- **`verify-local` logs carry no SHA** — flagged on PR #383 as non-blocking; it has now bitten #387's
  gate evidence twice. Promote it.
- Unchanged from 08-24: zh-CN locale drift · `doc-truth-guard` RETIRED_CLAIMS · `license.rs:181-184`
  · #201 · #199 · #156 · #128 · #133 / #54 / #55 / #64 / #125 / #126 · #202 · #203 · #204/#205/#206
  pending the owner · EULA items.
- **CLOSED 09-05/06:** #369 · #376 · #379 · #382 · #384. **Commented, accurate as closed:** #196 · #368 · #373.

## 🧠 LESSON FROM THIS LANE — cold is not dead

At 10:53Z the #385 worktree had been cold 3h20m, the lane had not answered an 08:52Z review, and its
claim alarmed at 12:00Z. Every signal read "abandoned". **It was not** — at 15:05Z the same executor
re-claimed under a new folder and shipped the complete repair, including both of HQ's additions.
**Fourth time on this desk that a cross-agent read of "the other one is idle" was wrong.** Holding at
the lease boundary was correct.

## ▶ NEXT-LANE PASTE BLOCK (generic preamble — append the [TASK])

> Compy — one lane, and you hold the pen under a mutation lease. Read `claude/HQ_RESUME.md` first,
> then `claude/ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md`, then `claude/HQ_DECISION_LEDGER.md`.
>
> **`origin/main` is `8d4e90a1`. Claude Code is the sole implementation writer; chatgpt-hq is the
> independent exact-head reviewer; Cowork only where local computer-use is required; no parallel
> implementation writers. Product law is `docs/PRODUCT_CONSTITUTION.md`; execution law is
> `docs/WORK_CONTROL.md`. A WRITER NEEDS ITS OWN WORKTREE AND A LEASE, and the lease is an
> `### Ownership claim` comment on the issue with a literal `- Write scope:` bullet — check for an
> existing claim before you write, re-state your worktree folder if it has moved, and widen the scope
> BEFORE touching a path it does not name. Review is posted natively by a non-author; the exact-head
> receipts (merge-pr, close-issue, mark-done) pass `work-control-gate` BEFORE any transition; land
> with `scripts/land-pr.mjs` (dry-run first); carry the receipts onto `main` in the next commit.
> Never `git add -A`; `.codex/config.toml` stays byte-identical to the sync's output (guarded). Set
> your git identity before your first commit — the main checkout is `t <t@t>`, a known defect.
> Release-state files are #225's. Desk stamp UNVERIFIED. `compy.gg` parked — cite
> `compy-bd6.pages.dev`. PawnIO NO-GO (#140). MSIX NO-GO (#205). Receipts opt-in DEFAULT OFF (#207).
> Price $29 one-time (#204). P0 constitutional migration is COMPLETE — do not reopen it.** The
> publish GO, the deploy GO, any purchase, and the Codex sandbox posture are mine.
>
> **[TASK]**
>
> Ship it to the desk and **LOOK at it yourself** before calling it done. **Never hand me a build
> with "please review" and no list of what changed.**
