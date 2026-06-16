# Product

## Register

product

## Users

Everyday, **non-technical gamers** — not sysadmins, not tweakers. They sit at their own
gaming PC and want it to run better and stay safe, without learning registry keys or
trusting a random YouTube "best settings" video that might break something. Their context
is task-driven and a little anxious: "is my PC okay / fast enough / did I just mess
something up?" They want a trustworthy second opinion that speaks plain English and never
leaves them stranded.

## Product Purpose

Compy is an all-in-one **PC optimization & safety dashboard** — positioned as *"a
rollback-first Windows configuration safety layer that happens to optimize."* Its core
differentiator is **hardware-aware, per-rig** guidance: it reads the actual machine and
tailors safe, reversible settings to it, instead of generic internet tweaks that break
things. Under the Receipts Doctrine its broader identity is **the measurement brand that
proves everything** — the free app is the trust engine: it measures honestly, amplifies
real gains, and never fabricates a claim. Success = the user trusts what Compy tells them,
acts with confidence, and can always undo.

## Brand Personality

Honest · hardware-aware · reversible. Voice is **calm, plain-spoken, and confident without
hype** — a knowledgeable friend, not a salesman or a sysadmin. No jargon, no regkey dumps,
no fear-marketing. It frames everything as *"for YOUR hardware"* and in terms of user
impact, not internals. It is proud of measured wins (shows the before/after) and equally
proud of saying "this won't help your rig" when that's the truth. Emotional goal: **trust
and calm** — the instrument should feel precise and dependable, never noisy or alarmist.

## Anti-references

- **Snake-oil "game booster" apps** (the Razer Cortex / "PC optimizer" / one-click-RAM-boost
  lane) — flashy, fear-driven, unmeasured promises. Compy is the opposite brand.
- **Generic YouTube/Reddit "best tweaks" lists & regkey dumps** — one-size-fits-all advice
  with no rollback and no regard for the actual machine.
- **The SaaS-cream landing template** — hero-metric blocks, gradient-text, tiny tracked
  eyebrows over every section, identical icon-card grids. Compy is a dark instrument, not a
  marketing page cosplaying as a product.
- **Sysadmin/enterprise tooling density** — dumping every toggle and raw value on the user.
  Compy hides complexity behind plain-English, advisory framing.

## Design Principles

1. **Honest measurement above all.** Never fabricate, never claim what wasn't measured;
   amplify real, measured wins loudly. Confidence is earned by proof, not adjectives.
2. **Rollback-first / reversible by default.** Never offer a change Compy can't cleanly
   undo; the undo path is a first-class part of every action, not an afterthought.
3. **Per-rig truth, never generic.** Read the real hardware and speak to *this* machine —
   including saying "not for your rig." Never invent or assume specs.
4. **Plain-English, user-impact framing.** Explain in outcomes the user feels, not in
   internals/jargon. Recommend a sensible default instead of dumping options.
5. **Never teleports; doorknob honesty.** Navigation is predictable (the rail is the only
   place that changes location; detail expands in place), and every affordance honestly
   signals what it does — no fake buttons, no surprise.
6. **The instrument disappears into the task.** Calm cockpit, not a dashboard demo. Motion
   and color are punctuation that convey state, never decoration.

## Accessibility & Inclusion

- **WCAG AA contrast** is a hard floor, enforced in code (`theme-contrast.test.ts`,
  including ink-on-accent — labels on bright accent fills use dark `--ix-accent-ink`, never
  white). Body text stays toward the ink end of the ramp; muted grays are never used for
  primary reading text.
- **Reduced motion is non-negotiable.** Every animation has a `prefers-reduced-motion`
  alternative (global reset in `tokens.css` + per-effect guards); the "living instrument"
  glow/depth survives with zero movement. The "step aside when I play" freeze is a separate
  user preference layered on top.
- **Offline-safe native type** (Segoe UI Variable / system stack; Cascadia/JetBrains mono)
  — no remote fonts, no FOUT, works with system font scaling.
- **Keyboard & focus:** Back/Forward wayfinding (Alt+Left/Right), visible focus indicators,
  focus-trapped themed dialogs (no native `confirm`/`alert`).
- **Color is never the only signal** — status carries an icon/label + the status color
  together (ready/attention/danger), not hue alone.
