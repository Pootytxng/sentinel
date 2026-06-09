# "How we grade" — a glossary for Compy's own verdict vocabulary

*2026-06-08, Cowork, from live demo feedback (owner's mother — a real target user). She asked
why something is "placebo" vs "risky" vs "real" and how Compy defines them. Compy invented this
vocabulary and never explained it to the reader. Defining our own terms transparently IS the
anti-snake-oil ethos turned inward. Make the meaning VISIBLE (foam-pit law: not hover-only),
with hover reinforcement.*

---

## The vocabulary (verified from the code — do not invent beyond this)

Compy assigns every tweak/claim exactly one of THREE verdicts (`tweaks.json` `verdict`,
`Learn.tsx` VERDICT_LABEL): **Real** (21) · **Placebo** (8) · **Risky — refused** (13).
(Readiness statuses — Ready / Needs attention / Advisory — are a SEPARATE vocabulary on the
Check surface; out of scope here unless trivially included as a second mini-key.)

### Definitions (owner-voice draft — owner may reword; this is copy)
- **Real** — "It actually does something. A measurable or well-proven effect on your games —
  worth doing."
- **Placebo** — "All hype, no effect. Popular online, but it changes nothing you can measure.
  We skip these so you don't waste time chasing them."
- **Risky** — "Not worth the downside. It might do something, but it brings real tradeoffs —
  instability, a security hole, or things breaking — so Compy refuses it, or lets you decide
  with eyes open." (Note: "Risky" isn't always "refused" — some are a documented trade-off the
  user decides; the definition reflects both, the chip label may stay "Risky — refused" or
  soften to "Risky" — owner's call.)

## Implementation (visible key + hover + findable entry)

1. **Visible "How we grade" key** — a compact legend (3 rows: chip + one-line definition)
   shown:
   - At the top of **Learn** (near the existing verdict filter chips — they already exist;
     this gives them meaning), collapsible after first view if desired but visible by default.
   - On the **Autopsy** results (so a graded guide is legible in context) — a one-line key
     above the graded claims.
2. **Hover tooltips on every grade chip** app-wide (Learn rows, autopsy claims, anywhere a
   verdict chip renders) via the existing quick-look/WhatsThis pattern — the same definition,
   as reinforcement, never the ONLY source.
3. **A findable Learn entry** "How Compy grades things" (a real glossary entry, searchable via
   "grade", "placebo", "real", "risky", "verdict") — so the meaning is reachable from search too.
4. Single source: the 3 definitions live in ONE place (a small `verdictGlossary` const / data
   entry) consumed by the key, the tooltips, and the Learn entry — they can't drift.

## Constraints + acceptance
Frontend-only; read-only/advisory; tokens-only; THE VOICE (plain, familiar, honest); the chips
must stay doorknob-honest (the key is visible, hover is bonus); zero IPC; copy locks elsewhere
untouched.

- [ ] A visible "How we grade" key renders on Learn and on the Autopsy (not hover-gated).
- [ ] Every verdict chip has a hover tooltip with the same definition (one shared source).
- [ ] A searchable "How Compy grades things" Learn entry exists.
- [ ] Definitions come from one constant/entry (no duplication); plain-English; owner-approved
      wording.
- [ ] Tests/guards green; reduced-motion clean.
