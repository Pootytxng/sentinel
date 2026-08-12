# Design foundation — the front door is a verdict, not a dashboard (2026-08-11)

Owner escalation, verbatim: *"not even my close friends enjoy using the app because none of them are
tech savvy and the app is overwhelming and hard to navigate and completely unfamiliar to them ... do
a deep research on some of the most inuitive app or web design templates and layouts and UI and show
me what you come up with so we can rebuild a foundation that compy can atleast stand on."*

Rendered proposal (mockups, type/colour specimens, wording glossary):
`claude.ai/code/artifact/4eeeac30-4b1a-4de8-bd8c-59260bd46155` — source kept at
`docs/ui-sweep/foundation.html`.

Companion: `docs/decisions/2026-08-11-design-navigation-audit.md` (the measurements this rests on).

## The diagnosis

The complaint is **structural, not cosmetic**. A repaint of the current information architecture
produces a better-looking app that testers still cannot operate. Four measured facts from the live
build `3155c7a0`:

- 57% of text nodes on one screen are ≤11px; exactly one element exceeds 19px, and it is the word
  "Home".
- 12 distinct font sizes on one screen.
- The verdict — the only sentence a first-time user wants — renders a third smaller than the room
  name above it.
- First run lands on a 10-step hardware tour before any answer is reachable.

Compy currently ships **instruments first, answer last**. Every consumer app this audience already
operates without help ships the reverse.

## Research — the five references, and what each contributes

| Reference | Pattern | What Compy takes |
| --- | --- | --- |
| Windows Security | Green shield + "No action needed"; detail one click down | The front door is a **verdict**, not a dashboard. Closest analogue, and already familiar to the exact user. |
| TurboTax | One plain question per screen, conditional, progress shown | Guide with **questions**, not controls. |
| Apple Battery Health | One number, one sentence of meaning, one recommendation; states its limits | Compy's honesty rules are a **design asset** — say the unknown in plain words. |
| Google Security Checkup | Ranked findings, each a sentence + one button | Findings are **sentences with a button**, never table rows. |
| Duolingo | Never two decisions on screen at once | More than one primary button = none. |

Unifying principle: **progressive disclosure** — answer first, reasoning on request, instruments on
demand. Sources: NN/g usability heuristics (match to the real world, plain language, visibility of
system status); LogRocket / UXPin on progressive disclosure; Appcues on the TurboTax interview and
the "one primary action" onboarding pattern.

## Decisions

1. **Front door = verdict + one action.** Verdict at 40px is the H1. The four counters demote to one
   quiet footer line — ranked, not deleted. "What are you here to do?" — already the strongest idea
   in the product — is promoted from a 9px band to the single primary button.
2. **The interview.** Behind that button: one question per screen, four spoken-English answers,
   "I'm not sure" a first-class option that must not dead-end. Ends in a finding card = level chip +
   plain sentence + measured evidence + one button + a visible undo promise.
3. **Type: 12 sizes → 6**, floor **13px**. Supersedes the audit's 11px floor — 11 was a conservative
   step off a 12-size scale and is still too small for a 1080p screen at couch distance. Steps:
   verdict 40/650 · section 26/650 · card 17/600 · body 15/400 · label 13/500 · data 13 mono.
   Kill the Arial fallthrough (cause of the tour's mis-rendered tick).
4. **Colour: rooms give up their hue.** One accent (`#a78bfa`), reserved for buttons and selection.
   Green/amber/red/blue each mean exactly one thing app-wide. This is a **deletion** of the
   `room-identity.css` accent overrides, not a repaint. Every status carries **shape + word + hue**,
   never hue alone (~1 in 12 men cannot separate the Lab green from the status green).
5. **Wording.** Rollback → Undo · Trust Ledger → What Compy changed · Drift → Something changed since
   · Frametime → How smooth it felt · Apply recommendation → Fix this for me · Guided setup →
   deleted. Room renames (Blackbook → History, Lab → Test, Monitor → Live) are brand-adjacent and are
   the **only** item held for owner sign-off.
6. **Instruments stay, behind a door.** Monitor/Lab/the record are not deleted; they stop being the
   first thing anyone sees.

## Build order

① type + colour app-wide (TYPE-1 + COLOR-1) · ② front door (UX-1) · ③ interview · ④ wording pass with
a banned-term build guard · ⑤ instruments behind a door.

## Tooling — answer to "what should I give you"

No tool blocked this analysis; tools change the speed and safety of *building and proving* it.

| Rank | Owner? | Item | Why it matters |
| --- | --- | --- | --- |
| 1 | **Owner** | Re-enable subagents/Workflow for this lane | Parallel layout directions + consumer-panel personas judging each. Serial this is days; parallel it is an afternoon. Biggest single limiter. |
| 2 | **Owner** | Figma account + its MCP server (`claude mcp add`, Dev Mode) | Read real design files/variables and build from them; lets the owner point at a layout he likes. Free tier suffices. |
| 3 | Mine | `axe-core` in the vitest suite, joined to the existing contrast/type measurement | Makes "is this readable" a failing test, per the bug→guard law. |
| 4 | Mine | shadcn component MCP | Accessible dialog/menu/form plumbing, so effort goes into Compy's voice, not rebuilding a dropdown. |
| 5 | Wired | v0 (owner-gated credits) | Fast throwaway exploration only; ship hand-built. |
| 6 | **Owner** | 30 min watching two non-technical testers, unaided | The only evidence source no tool replaces. Where they stop is the real backlog. |
