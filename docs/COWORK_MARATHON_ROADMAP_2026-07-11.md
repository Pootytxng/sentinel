# Compy — Consumer-Panel Marathon Roadmap — 2026-07-11

> **SUPERSEDED — see `docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md`.** That doc is the
> single executable build plan (phases, checkboxes, the four upfront taste-call questions in exact
> Question/Options form) — this file is kept for history only, don't work from it.

> Build-prep brief for a CC/Fable session. Source: the five real persona critiques in
> `docs/COWORK_PERSONA_CRITIQUE_CHECKLIST_2026-07-11.md`. Only 🟢 CLEAR TO FIX items below are ready for
> CC to start on unprompted. 🎨 items are blocked on an owner taste call — CC should not build these
> without you weighing in first, even mid-marathon. 🔒 items are listed for completeness only; they are
> not on this roadmap because they conflict with a LOCKED safety rule, not a taste question.

## Phase 1 — Language and framing fixes (app-side, live product, highest stakes)

These fix the actual shipped app, not just marketing — they're where "no jargon, no fear UX" isn't
currently being delivered to the audience the copy claims to target.

1. **Plain-language pass on Monitor/Lab jargon** (frametime, 1% low, VRR, VBS, ETW, "anti-cheat safe").
   Casual Owner read none of it. Either add inline plain-English glosses at first exposure, or gate the
   deepest jargon behind an "Advanced" toggle that a first-run user never has to see. Ties directly to
   CLAUDE.md's own "no jargon" promise — this is closing a gap against your own stated bar, not adding
   scope.
2. **Rewrite the "Safe Stack — Fully applied" and "A security feature may be costing you frames" copy**
   so neither reads as "the app did this without asking" or "turn off your security." Both are
   copy-clarity fixes, not behavior changes — confirm the ❓ VERIFY FIRST item in the checklist (fresh-
   install vs. dev-rig state) before finalizing the exact wording, but the clarity problem itself is
   real regardless of the answer.
3. **Settings-page flag audit.** Twelve "(preview)" toggles are currently shown to every user, several
   describing features that are already DEFAULT ON per `RELEASE_STATE.md` (Home console, Lab proving
   ground) — meaning some toggles are pure leftover debt, not a deliberate simplicity choice. Sweep
   `src/design/theme.ts`'s flag reads, identify which are genuinely still optional/cosmetic (keep those)
   vs. which have already graduated to permanent behavior (remove the toggle, keep the feature). This
   was flagged independently by three of five personas (Casual Owner, Tinkerer, Budget Teen) as reading
   like an internal QA panel.
4. **Surface Blackbook reasoning next to the grade, not just behind "Autopsy a guide."** Even a one-line
   "why" under each Real/Placebo/Risky chip would close the "tier list, not an argument" gap the
   Tinkerer named, without a redesign.

## Phase 2 — First-run trust sequence

5. **Let a brand-new user watch one rollback complete before being asked to trust the rest.** Named
   directly by the Burned Skeptic and implied by the Casual Owner's "nobody asked me" reaction. A
   guided, low-stakes "watch it work" moment (apply something trivial and reversible, show the before/
   after, show the rollback) could be the single highest-leverage first-run addition — it's the exact
   loop the marketing site already promises, just never demonstrated live to a first-time user.
6. **"READINESS 100 · SCORED" — surface the methodology.** A tooltip or one-line "how we calculate this"
   closes the Tinkerer's "made-up number" read cheaply.

## Phase 3 — Marketing site (not live yet — lower urgency, but cheap to fix before it ships)

The site carries its own header comment marking it "DARK until the publish ladder," so none of this is
public yet — sequence it whenever, but it's inexpensive to fix now rather than after taste-gating.

7. **Lead with the kicker, not the headline.** Budget Teen named the existing kicker line ("Know which
   PC tweaks actually help your rig") as the stronger hook already sitting one row above "Measured, not
   promised." Consider promoting it, or A/B it against the current order.
8. **Move "it's free" up.** Currently confirmed only in the Settings/About footer of the app and buried
   in the site. For a price-sensitive audience already primed to expect a trial-upsell trap, this should
   be obvious within the first screen.
9. **Make the proof-loop strip (applied → measured → rolled back) the hero visual, not a decorative
   aside.** Three personas cited this element unprompted as the most convincing thing on the page.
10. **Re-balance the Blackbook's presentation** — lead with the "START HERE" bite-sized entries (which
    tested well) rather than the raw "174 tweaks / 85 terms" counts (which read as homework to both the
    Teen and the Tinkerer).

## Waiting on your taste call — do not start these without deciding first

- **The hologram / Instrument-HUD visual direction.** Grinder and Skeptic called it "theater"; Budget
  Teen called it clip-worthy and wanted to "flex" it. This is polarized by persona, not unanimous, and
  it's a direction you've personally steered through multiple rounds. Your call, not theirs.
- **Whether to build a genuine expert/power-user layer** (raw values, true percentiles, CSV export,
  overrides on currently-non-LOCKED refusals). This is a real identity/scope decision — it could win
  back the Grinder/Tinkerer tier, or it could dilute the simplicity that's actually converting the
  recovering-skeptic target the panel identified. Worth deciding deliberately, not by default.
- **Exactly how/when the Gaming Mode recovery banner should present on first encounter.** The underlying
  behavior (never hide an unresolved session) stays — that's not in question. The color, copy, and
  whether it's literally the first thing a user sees before one calm look at Home is open.

## Not on this roadmap — LOCKED, not a taste question

- No override switch for barred safety items (Defender disable, CPU-mitigation disable, etc.) —
  CLAUDE.md rule 6, non-negotiable regardless of measured benefit.
- No CPU temperature / no kernel driver — CLAUDE.md rule 1, proven impossible in user-mode, not
  reconsidered per critique.

## Known outstanding issue not covered by this roadmap

`docs/COWORK_AUDIT_2026-07-11.md` (the earlier project-wide audit) still contains fabricated content —
three of five council seats and the entire "LOCKED-rules source-compliance sweep" section were invented,
not verified. That document has not yet been corrected. Say the word and that gets fixed next; it's
independent of the consumer-panel work above.
