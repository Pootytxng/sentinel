---
name: self-review
description: >-
  Use when about to claim any visual or UI change in Compy is done, fixed, ready, or "looks good" —
  before reporting it, reinstalling, or shipping. Triggers: edited a .tsx/.css/surface/component and
  about to say it works; captured a screenshot and about to move on; finishing a UI fix the owner
  asked for. Catches illegible text, duplicated UI, broken hover/empty states, and stale wording —
  the things green tests and a quick glance miss.
---

# Self-Review — dispatch the reviewer, never review inline

## The Iron Rule (unchanged since 2026-06-20)

Do not claim a visual change is done/fixed/ready without a **PASS verdict** from the
`self-reviewer` agent, quoted in your report. A claim without the verdict block = the law was
violated. "I basically looked" / "it's one CSS line" / "tests are green" / "the owner will catch
it" all mean STOP and dispatch.

## The Token Law (added 2026-07-05 — why this skill is now a dispatcher)

**Never run the rubric inline.** Inline review put every native-res screenshot and cdp-eval dump
into the orchestrator's transcript, where it was re-sent on every later turn — self-review became
64% of weekly token usage and a driver of >150k contexts. Evidence must live and die in the
worker's context; only the verdict returns.

## How to run it

1. **Dispatch** the `self-reviewer` subagent (Task tool, `subagent_type: self-reviewer` — it pins
   `model: sonnet` itself; do not override upward). The brief MUST contain:
   - the owner's exact ask, quoted;
   - files touched + the specific elements/selectors changed;
   - states to exercise (hover / empty / loading / error) if relevant.
2. **Receive** the single `SELF-REVIEW` block (12 rubric items, one evidence line each, VERDICT).
3. **On FAIL:** apply the fix list, then re-dispatch for a full fresh review (from the top — a fix
   can break a neighboring item). Repeat until PASS.
4. **On PASS:** quote the block in your done-report. That is the claim's license.
5. **If the change is a TASTE CALL or TASTE SUBSTITUTION, the report also ships a before/after
   the owner can look at** (owner directive 2026-08-05: *"post me a snapshot ... for me to see the
   before and after of what it is youre referring too exactly"*). Prose describing a look is not a
   taste call he can rule on — he does not carry the old version in his head. Build a self-contained
   file that shows **both states side by side**, copying the real CSS **verbatim** with resolved
   token values (an approximation of a taste call is a fabricated claim), and hand it over with
   **`SendUserFile`** — never `Read` it back into the orchestrator (that is the Token Law above).
   Motion changes need something that moves: inline-rendered HTML (`display: "render"`), not a PNG.
6. **A rendering defect is NOT a taste call and never takes route 5** (Cowork lane amendment
   2026-08-24, adopted by the owner): *"a clipped element, an overlapping glyph, or an unstyled
   native control is a correctness failure, not a matter of taste."* Fix it, guard it, report it
   — do not hand him a before/after asking which he prefers, and do not file it as a product order in
   historical `docs/UI_VISION_BACKLOG.md`; product direction comes from
   `docs/PRODUCT_CONSTITUTION.md`. Rubric item 12 is where the reviewer catches it. The narrow
   exception is the one thing the taste decree already reserves to him regardless of cause: the
   **product name, logo, and price presentation**. So the wordmark reading `©ompy` (#213 A1) is a
   real defect AND still his call to approve — fix candidates go to him with a recommendation
   attached, never as a menu.

## Red flags — you're about to violate the law

- Capturing or `cdp-eval`-ing UI evidence yourself in the main session → that's inline review;
  dispatch instead.
- Reporting "done" with green tsc/vitest but no verdict block → they see neither contrast,
  duplication, nor layout (they missed the muted button AND the duplicate banner).
- Editing the fix and moving on without re-dispatch → the second review is where the regression
  hides.

Operationalizes [[always-self-review-visual-work]] + [[bug-becomes-guard]]. Rubric text and
capture procedure live in `.claude/agents/self-reviewer.md` — rigor unchanged, residency moved.
