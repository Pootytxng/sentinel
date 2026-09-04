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

## P0 — Constitutional migration

- [ ] Land the product rebirth migration only after all acceptance proofs below pass.

Required before merge:

- [x] `PRODUCT_CONSTITUTION.md` established as supreme product authority.
- [x] Domain authority separated: Product Constitution / Architecture Locks / Release State / Work Control.
- [x] Reborn `docs/product/` roadmap and engine contracts created.
- [x] Legacy Receipts Doctrine, Product Direction, PRD, monetization docs, and overview neutralized as current authority.
- [x] Root README, docs index, Codex bootstrap (`AGENTS.md`), and Claude bootstrap (`CLAUDE.md`) point to the Constitution.
- [x] `ARCHITECTURE_LOCKS.md` stripped of obsolete product hierarchy while preserving safety/immutability contracts.
- [x] Backlog rebuilt as an execution ledger instead of product doctrine.
- [ ] Add and review a mechanical product-constitution drift guard.
- [ ] Verify existing `CLAUDE.md` law guard still passes after the bootstrap rewrite.
- [ ] Repo-wide audit: classify every remaining legacy doctrine reference as historical, bounded evidence, or active defect.
- [ ] Independent review: compare installed Constitution/derived docs to owner-ratified discussion; no material omission or reinterpretation.
- [ ] Verify migration branch is based on current `main` or safely rebase/retarget without importing superseded doctrine.
- [ ] Open/merge the constitutional migration through current Work Control / proof rules.

**Stop rule:** no ordinary product feature work should use this branch. It is a docs/control migration.

---

## P1 — Re-derive current blockers after constitutional merge

Do **not** copy the pre-rebirth queue forward mechanically.

After the Constitution lands:

1. fetch current `main`;
2. run/inspect current Release State verification;
3. inspect open work-control/release/safety issues and PRs;
4. identify any blocker that prevents trustworthy product development or external testing;
5. close/supersede stale completed control issues;
6. produce a short current blocker list ranked by actual user/proof risk.

Only blockers that materially threaten safe mutation, rollback, measurement truth, release integrity,
or reliable external testing outrank the reborn product roadmap.

---

## P2 — Roadmap Phase 2: Shared Machine Model v1

Once P1 is clear enough for safe product development, pull from
[`product/ROADMAP.md`](product/ROADMAP.md#phase-2--shared-machine-model-v1).

Goal: one local model shared by Performance and Care for hardware, Windows/driver state, Compy
changes, sessions/baselines, incidents, chronology, and evidence provenance.

No duplicate Care-vs-Performance machine truth.

---

## P3 — Roadmap Phase 3: Trial Protocol v1

Implement the first end-to-end constitutional Trial on a small, high-confidence reversible candidate:

baseline → prior-state snapshot → apply → verify → measure → noise-aware classify → keep/restore → receipt.

This is the first implementation milestone that proves the reborn optimizer architecture rather than
adding another isolated tweak.

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
