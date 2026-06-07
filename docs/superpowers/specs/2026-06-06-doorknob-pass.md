# The Doorknob Pass — perceptible affordance everywhere (core-promise status)

*2026-06-06, Cowork, from live beta feedback + owner elevation. Specimen: the Play surface's
"Full monitoring & charts" collapsible read as a static caption — the tester never knew it
opened. Owner verdict: perceptibility of interactivity sits ON THE SAME THRONE as the core
promises — because it IS the same promise: a control that hides its interactivity is lying
about what it is. Affordance-honesty. THE LAW: **every door shows its knob, and nothing that
isn't a door wears one** — interactive elements are perceptibly interactive AT REST; static
elements never look clickable.*

---

## 1. The interaction grammar (one visual language, app-wide)

Define ONE resting-state signature per interaction class, applied with zero exceptions:

- **Action buttons** (do a thing now): the existing pill/outline treatment — already correct.
- **Expandable rows/sections** ("more lives inside"): raised-card treatment (visible border at
  rest, slightly elevated fill vs static panels) + a chevron in a small enclosed chip (not a
  floating glyph) + cursor:pointer + hover raise/brighten + chevron rotates when open. The
  resting border+chip is the knob — hover is confirmation, never discovery.
- **Navigational rows** (open/jump somewhere, e.g. session rows): same raised treatment with
  the chevron chip pointing right; identical resting logic.
- **Toggles/switches:** the trust-switch — already distinct; unchanged.
- **Inline cross-links** ("What's this?", named places): accent-colored at rest (not
  hover-revealed), underline or dotted-underline on hover.
- **Static panels** (info, stats, honesty lines): FLAT — dimmer fill, no border or a hairline
  weaker than the interactive border, never cursor:pointer, no hover response. The contrast
  between raised-and-knobbed vs flat IS the grammar.

## 2. The two-way sweep

- **Hidden doors:** walk every surface; every interactive element gets the grammar. The
  specimen ("Full monitoring & charts") first, then all collapsibles (Lab sections, Check
  buckets, ledger history, autopsy rows), all clickable rows, all cross-links.
- **False knobs:** find static elements that LOOK interactive (borders/hover styles inherited
  by accident) and flatten them. Both failures are lies; both die.
- Deliver the sweep as a table in the report: element / class assigned / before→after.

## 3. Feedback floor (every interactive element, no exceptions)

cursor:pointer · visible hover state · visible keyboard-focus ring (existing tokens) ·
pressed/active feedback. Reduced-motion: state changes remain, transitions drop.

## 4. The guard (sweep-guard pattern — make the law CI-enforceable)

Interactivity ships ONLY through sanctioned primitives (shared components/classes — e.g.
`Expandable`, `ActionRow`, the button/link classes). Add a guard test: grep/AST-scan src for
onClick/role="button"/tabIndex on elements that DON'T carry a sanctioned class → fail with
the element named. Raw clickable divs are now a build error, so a future surface can't ship
a knobless door even by accident.

## 5. Sequencing + acceptance

Next REAL train (feedback-sourced, core-promise status) — runs before the held installer
rebuild so the next packaged build carries floor + doorknobs together. Frontend-only,
tokens-only, zero new IPC, copy locks untouched.

- [ ] Specimen fixed: "Full monitoring & charts" unmistakably a door at rest.
- [ ] Two-way sweep table delivered; zero hidden doors, zero false knobs remain.
- [ ] Feedback floor on 100% of interactive elements (cursor/hover/focus/active).
- [ ] Guard test live and failing on a deliberately-planted knobless div (then remove plant).
- [ ] Guards + tests green; reduced-motion clean.
- [ ] Owner (or the reporting tester) re-walks Play and finds every door without being told.
