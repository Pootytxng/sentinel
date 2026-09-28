# Compy — Living Execution Ledger

**Purpose:** current execution status only.<br>
**Product priority source:** [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) → [`product/ROADMAP.md`](product/ROADMAP.md)<br>
**Current build/gate truth:** [`RELEASE_STATE.md`](RELEASE_STATE.md)<br>
**Ownership truth:** [`WORK_CONTROL.md`](WORK_CONTROL.md)

This file no longer defines product philosophy or inherits priority from pre-rebirth roadmaps.

The complete pre-rebirth backlog remains preserved in Git history and `BACKLOG_ARCHIVE.md` where
historical material was already archived.

Open GitHub issues remain obligations/evidence until explicitly resolved, superseded, or rejected.
They do **not** retain priority merely because they predate the Product Constitution. Every open item
must be re-triaged against current safety/release truth and the reborn roadmap.

---

## P0 — Constitutional migration — **COMPLETE 2026-09-05**

Landed on `main`. Do not reopen this phase, and do not restart migration work.

- [x] `PRODUCT_CONSTITUTION.md` established as supreme product authority.
- [x] Domain authority separated: Product Constitution / Architecture Locks / Release State / Work Control.
- [x] Reborn `docs/product/` roadmap and engine contracts created.
- [x] Legacy Receipts Doctrine, Product Direction, PRD, monetization docs, and overview neutralized as current authority.
- [x] Root README, docs index, Codex bootstrap (`AGENTS.md`), and Claude bootstrap (`CLAUDE.md`) point to the Constitution.
- [x] `ARCHITECTURE_LOCKS.md` stripped of obsolete product hierarchy while preserving safety/immutability contracts.
- [x] Backlog rebuilt as an execution ledger instead of product doctrine.
- [x] Mechanical drift guard: `src/product-constitution-guard.test.ts` (+ `src/capability-exception-policy-guard.test.ts`), hardened by #379/#382.
- [x] `CLAUDE.md` law guard re-verified after the bootstrap rewrite: `src/claude-md-laws-guard.test.ts`.
- [x] Every remaining legacy doctrine reference classified as historical, bounded evidence, or defect in `product/SUPERSESSION_MANIFEST.md`; the guard parses the real manifest (#382).
- [x] Independent review at each landed head; verdicts bound to exact heads in the work-control receipts.
- [x] Migration merged: PR #371 (issue #369), guard repairs PR #380 (issue #379) and PR #383 (issue #382).

**Evidence:** `product/CONSTITUTIONAL_MIGRATION.md` is the closed runbook, retained as history.

---

## P1 — Roadmap Phase 1 blockers — re-derived 2026-09-05 at `901f090c`

Re-triaged against [Phase 1](product/ROADMAP.md#phase-1--safe-current-build-stabilization), not
inherited. **Nothing open blocks Phase 2.**

- **Repaired here:** the stranded PR #383 merge receipt, whose loss reddened the gate fleet-wide.
- **Also repaired:** this worktree's `core.hooksPath`, which had silently disarmed its pre-push gate.
- **Not this lane's:** `RELEASE_STATE.md`'s stale commit/stamp anchors. The desk runs unmerged
  `c82440a1`; both are fixed at `3ab9b010`, on `main` with the #224/#225 parity work (#520).
- **Not blockers:** #156 — the post-install stamp gate catches it; never loosen it. #283, #292, #64.
- **Owner-gated:** #321 CI billing, #205 signing, #201 `compy.gg` — `OWNER_ACTION_CHECKLIST.md`.
- **Not inherited:** the #295-#351 governance cluster is Phase-1-irrelevant by the roadmap's own
  deprioritization rule; it must not gate product learning.

Phase 1 exit holds. Proceed to P2.

---

## P2 — Roadmap Phase 2: Shared Machine Model v1

Once P1 is clear enough for safe product development, pull from
[`product/ROADMAP.md`](product/ROADMAP.md#phase-2--shared-machine-model-v1).

Goal: one local model shared by Performance and Care for hardware, Windows/driver state, Compy
changes, sessions/baselines, incidents, chronology, and evidence provenance.

No duplicate Care-vs-Performance machine truth.

**Status 2026-09-26:** screens read machine truth only through `src/data/machine-model.ts`;
`src/machine-model-reader-guard.test.ts` fails the build on a new direct reader, and the unused
`get_intelligence_timeline` command is retired (#453). Phase 2 exit still needs the live four-screen
agreement proof on the owner's machine (#453).

---

## P3 — Roadmap Phase 3: Trial Protocol v1

Implement the first end-to-end constitutional Trial on a small, high-confidence reversible candidate:

baseline → prior-state snapshot → apply → verify → measure → noise-aware classify → keep/restore → receipt.

This is the first implementation milestone that proves the reborn optimizer architecture rather than
adding another isolated tweak.

- [~] #583 lane 1 — record-first start, backend single-active guard, restore on a failed §4.5 target
  check or unreadable watermark, read-only launch reconcile of interrupted starts, typed §8
  `TrialResult` + §9 keep rule (`experiment.rs`; guard `src/experiment-record-first-guard.test.ts`).
- [~] #583 lane 2a — read-only `history::probe_rec_target`: §4.1 refuses a start unless the setting
  reads unchanged; §4.5 aborts on an unread target too; §7 at conclude turns a reverted/unreadable
  target into no-keep; §4.10 reads back after every keep/restore and turns a still-changed restore
  into a loud `Aborted`; the simulator trusts the live read over the ledger.
- [~] #583 lane 2b — start/conclude take session ids and read the readings from `sessions.json`,
  never UI-supplied fps; conclude refuses a missing, unmeasured, earlier, ambiguous or
  not-comparable pair (`comparability::derive`) and caps a Partial pair's confidence; a changed
  driver/Windows/resolution aborts and restores (§7), and a reported crash always restores; the §11
  receipt records the floor the verdict was judged against, with the game's own noise left unknown.
  All three lanes built on `claude/determined-galileo-mb5z29`, unlanded. **Remaining:** owner-rig
  live proof on `game-bar-disable`, including a kill mid-start then relaunch · independent review of
  the final head · merge.

---

## P4 — Roadmap Phase 4/5: Optimization Engine + guided journey

Initial supported outcomes:

- Recommended / Best Overall Experience
- Maximum FPS
- Smoothest frame pacing

Add latency/visual-quality constrained objectives only when measurement fidelity supports honest
tradeoff claims.

---

## P5 — Roadmap Phase 6: Care convergence

Make “What changed since it worked?” and one-safe-next-action diagnosis consume the same Machine Model,
Trial, history, evidence, and rollback primitives as Performance.

---

## Owner-gated / external decisions

Owner-only actions remain indexed in [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).

A product roadmap item is not blocked merely because an unrelated owner decision exists. Surface owner
items when their dependency becomes real.

---

## Pull rule

Before promoting any issue into this ledger's active queue, answer:

1. Which flagship journey does it improve: **MAKE THIS PC BETTER** or **FIGURE OUT WHAT WENT WRONG**?
2. What user decision improves?
3. What evidence will prove the work helped?
4. Which Machine Model / Trial / Risk / UX contract applies?
5. Is it a real safety/release blocker or merely old queue inertia?
6. Can a smaller implementation provide most of the value?

If those cannot be answered, the issue stays open in GitHub if still valid, but it does not become
current priority.

## False-done rule

Never declare a phase “done” because one PR merged. Re-derive current native state and enumerate
remaining + gated work before closing the phase.
