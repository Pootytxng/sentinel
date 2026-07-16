# Content draft — the non-competitive consumer story

**Provenance:** recommendation 4.6, `docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`,
sourced from persona 7 ("Casual story-game player") in
`docs/reviews/2026-07-15-consumer-panel-review.md`. Panel finding: Compy's current site/app copy
leans on FPS and competitive-latency language throughout, which under-targets players who care
about smoothness and stutter in single-player/story games but don't obsess over input latency.

**Status:** content-only draft, not yet placed. Layer 2 (content/SEO), $0, per
`docs/MONETIZATION_PLAN.md`. **Placement decision needed from CC/owner** — this reads naturally as
either (a) a section on the marketing site (`site-app/src/pages/index.astro`, near the existing
FPS-flavored proof section) or (b) a Blackbook/Learn-surface narrative in the app. It doesn't fit
the existing `debunks.config.json` schema (that's graded tweak verdicts; this is a use-case
narrative), so it needs its own placement rather than becoming a library entry. Whoever places it
should run the copy past `scripts/site-seo.test.mjs` / `site-landing.test.mjs` if it lands on the
site.

---

## Draft copy

**Heading:** Not every problem is about frames per second.

**Body:**

Maybe you're not chasing 240fps. You're forty minutes into a story you care about, and the game
starts to stutter — not every frame, just enough to notice, just enough to pull you out of it.

Compy doesn't assume you're optimizing for esports. When a stutter happens, Compy's Monitor records
*when* it started, what your GPU and memory were doing at that exact moment, and whether the change
you tried afterward actually fixed it — or just felt like it did. The same honest measurement that
tells a competitive player "no measurable change" tells you whether that driver update actually
solved the stutter, or whether it's still there and something else is the real cause.

You don't need to know what a 1% low is. You need to know: is my game going to stutter tonight, and
if I do something about it, did it work?

**Alt/shorter variant (for a card or teaser slot):**

"Your game stutters after forty minutes. Compy records when the spikes start, what the GPU and
memory were doing, and whether the next change actually fixed it."

---

## Grounding check (so this doesn't overclaim)

Before shipping, verify this copy against current Monitor/Black Box capabilities — specifically:
does Monitor's session recording actually timestamp GPU/memory state at the moment a stutter is
detected (not just FPS), and does the comparison/noise-floor logic (`comparison.rs`, per
`docs/METHODOLOGY.md`) apply the same honestly to a "did the stutter go away" question as it does
to an FPS-improvement question? If Monitor doesn't yet correlate stutter timestamps with GPU/memory
state, soften "what your GPU and memory were doing at that exact moment" to whatever it actually
does today — this doc doesn't have space to re-verify that against the live surfaces, and the
honesty law applies to marketing copy same as everywhere else.
