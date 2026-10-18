---
name: guard-forge
description: >-
  Use the moment a defect is caught — by the owner, a reviewer, an audit, or live use — and BEFORE
  its fix is claimed done. Triggers: owner reports something broken/wrong/ugly; a bug escaped green
  tests; about to commit a fix for a caught defect; the phrase "bug" + "fix" in a done-report with no
  new guard named. Law: every caught defect becomes a permanent guard before the fix counts
  (bug→guard, standing 2026-06-20).
---

# Guard-Forge — every caught bug becomes a permanent guard

Vigilance lives in the toolchain, not in memory. A fix without a guard is a bug scheduled to return.
Enforcement tiers: **automated test > forced rubric item > memory** — always take the highest tier
the defect allows.

## Procedure

1. **State the invariant the bug violated** in one sentence ("buttons on accent fills must compute
   legible text color", "a stale exe must never install"). If you can't state it, you haven't
   understood the bug — stop and find it.
2. **Pick the tier:**
   - **Mechanizable → automated guard.** Frontend: `src/<invariant>-guard.test.ts(x)` (patterns:
     `button-legibility-guard`, `theme-contrast`, `gpu-temp-gate-guard` — name states the invariant).
     Backend: `#[test]` beside the boundary it protects (`safety_tests` / module tests, e.g.
     `save_is_an_atomic_swap_leaving_no_tmp`). Script/process: a gate inside the script itself
     (pattern: the stale-build gate in `scripts/ship-reinstall.ps1`).
   - **Visual/judgment-only → rubric item.** Append to the rubric in `.claude/agents/self-reviewer.md`
     (numbered; this changes the PASS contract — say so in the report). A non-visual judgment item
     goes in the exact-head review items of `docs/WORK_CONTROL.md` "Proof order and independent review".
   - **Neither possible → memory** with `[[bug-becomes-guard]]` linked. Last resort; justify why no
     higher tier works.
3. **Red before green.** Write the guard first and confirm it FAILS against the pre-fix code (or a
   reproduction of it). A guard that never failed proves nothing. Then fix; guard goes green.
   **Weakening an existing guard** (cap, short-circuit, early return, skip, narrowed match, relaxed
   threshold) gets no credit for green: post at least one `### Weakening injection` the old guard
   caught and the new one still catches, run at base and head (format and reviewer item:
   `docs/WORK_CONTROL.md` "A change that weakens a guard carries an injection"). Without it the
   exact-head reviewer blocks.
4. **Commit fix + guard together**, message carrying a `bug→guard: <invariant>` trailer so BACKLOG
   archaeology can find it.
5. **Report line names the guard:** `guard: <test name> (red→green proven)`. A fix-report without a
   named guard is incomplete — the reader should assume the law was skipped.

## Scope note

This applies to *caught defects*, not every refactor. But err toward forging: the 2026-06-20
precedent (muted button + duplicate banner passing green tests) is exactly the class where "the
existing suite covers it" was false.
