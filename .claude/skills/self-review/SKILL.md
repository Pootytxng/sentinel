---
name: self-review
description: >-
  Use when about to claim any visual or UI change in Compy is done, fixed, ready, or "looks good" —
  before reporting it, reinstalling, or shipping. Triggers: edited a .tsx/.css/surface/component and
  about to say it works; captured a screenshot and about to move on; finishing a UI fix the owner
  asked for. Catches illegible text, duplicated UI, broken hover/empty states, and stale wording —
  the things green tests and a quick glance miss.
---

# Self-Review — look critically before claiming UI done

## The failure this prevents
Looking ≠ looking *critically*. Real misses the owner caught AFTER I reported "done":
- A **"Turn it back on" button rendered muted-gray text on an accent fill** (illegible). I had
  screenshotted it — and never checked the contrast.
- A **yellow drift banner that duplicated** a card I'd just added (and used a renamed-away word,
  "Optimize"). I never looked for the sibling representation.

`tsc` + `vitest` were green both times. **Green tests + a glance are not a review.**

## The Iron Rule
Do not claim a visual change is done/fixed/ready until you have (1) captured it at the owner's REAL
resolution and (2) answered EVERY rubric item below **with evidence** in a short `SELF-REVIEW` block.
A rubric item with no evidence = not reviewed. Any item fails → fix → re-review from the top.

**Violating the letter is violating the spirit:** "I basically looked" / "it's one CSS line" / "the
owner will catch it" all mean STOP and run the rubric.

## Capture it RIGHT first (this is where the artifact lies)
The dev build runs two same-origin webviews + a small default window, so captures mislead unless:
- Resize the REAL OS window (~1500×980 via MoveWindow) and capture NATIVELY with
  `docs/ui-sweep/cdp-shot.mjs`. Do NOT trust `setDeviceMetricsOverride` — it distorts when the real
  window is small (it made a correctly-centered panel look like it floated: a false defect that also
  hides real ones).
- Confirm the shot is the MAIN window (6 `.cc-rail-item`s visible), not the overlay.
- For the EXACT element you changed, scroll to it / zoom — look AT it, not just the page.

## The rubric — one line of EVIDENCE each
1. **Capture** — native, real-res, main window (state the size; confirm not the overlay).
2. **Legibility / contrast** — every text-on-fill you touched: readable? On accent/colored fills the
   text MUST be `--ix-accent-ink` (dark), never `--muted`. STATE the computed color
   (`getComputedStyle(el).color` via `docs/ui-sweep/cdp-eval.mjs`) — direct proof, not a guess.
3. **Duplication** — does this show data/an action already shown elsewhere? Grep/look for the sibling
   representation and say what you checked.
4. **Interactive states** — hover / active / disabled don't break or mislead (no false danger-red on a
   primary action). Say which you checked.
5. **Layout** — alignment, spacing, no clipping/overflow; empty + loading states hold.
6. **Wording** — plain, accurate, no stale references (renamed features — e.g. "Optimize", "Startup
   tab" no longer exist).
7. **The owner's exact ask** — re-read it; does the result satisfy EACH part (decompose multi-part
   asks)? Quote the part, confirm it's met.

## Red flags — you're about to ship a miss
- "tsc/vitest pass, so it's good" — they see neither contrast, duplication, nor layout.
- "I captured a screenshot" — capturing ≠ scrutinizing each item.
- "It's one CSS line / too small to review."
- "It probably looks fine."

All mean: run the rubric **with evidence** before claiming anything.

## Rationalization table
| Excuse | Reality |
|--------|---------|
| "I looked at it" | You glanced. The button was on screen and still muted. State the computed color. |
| "Same pattern as elsewhere" | The cascade/theme can differ. Prove it on THIS element. |
| "Tests are green" | Tests caught neither the muted button nor the duplicate banner. |
| "The owner can eyeball it" | The law exists so he never has to. That's the whole point. |

Operationalizes the memory [[always-self-review-visual-work]] — turns the law into a forced, evidenced rubric.
