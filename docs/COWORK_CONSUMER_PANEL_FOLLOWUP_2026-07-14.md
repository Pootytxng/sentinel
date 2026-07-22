# Compy — Consumer Panel Follow-Up — 2026-07-14

> Same five personas as 2026-07-11/07-12, each re-dispatched fresh, given only its own prior
> (2026-07-12) verdict plus today's evidence pack (`docs/COWORK_EVIDENCE_PACK_2026-07-14.md`, build
> `3ba79dc`). Real `Agent` dispatches, real transcripts. This is the second follow-up round.

## Scorecard — did the 07-12 → 07-14 changes land?

| Persona | Complaint (as of 07-12) | Now | Verdict |
|---|---|---|---|
| Grinder | Toggle clutter / visual theater | Settings grew to ~8 controls; hologram gained a 4th view mode + a named "JARVIS motion" layer | **No — moved backward** |
| Grinder | "Estimated" 1% low | Monitor capture was at-rest so the live reading couldn't be re-checked; no "est" tag found anywhere; cross-game sessions now explicitly flagged | **Partially** |
| Grinder | Raw percentile ask | Expert view claims raw values, but no methodology or distribution shown | **Partially** |
| Grinder | 174-vs-191 site mismatch | Both sides now say 191 | **Yes** |
| Casual Owner | Recovery banner as first impression | Still didn't recur — but that means still unverified, not proven fixed | **Partially** |
| Casual Owner | "Fully applied" read as unconsented | Copy now explicit throughout; status words are "still on / no longer active / rolled back" | **Yes** |
| Casual Owner | "Down to one toggle" | Self-corrected: actually ~8 controls now, more than 07-12. Doesn't feel scary — each is labeled/explained — but the count claim was wrong | **Partially (self-corrected)** |
| Casual Owner | "Security feature costing frames" reads as demand | Identical copy, identical framing — no change either direction | **Partially, unchanged** |
| Tinkerer | Refused-drawer reasoning improved | Still holds | **Yes (still)** |
| Tinkerer | Refused drawer collapsed by default | Ambiguous — likely open only because Expert View was ON in this capture, not a verified true default | **Partially, leaning No** |
| Tinkerer | No raw values/regkeys inline | Ready + Needs-your-call items now show real paths; the 3 refused items still show none, even under Expert View | **Partially** |
| Tinkerer | No true percentile distribution | Still single derived numbers only | **No** |
| Tinkerer | No export | Confirmed absent from a fully-itemized Settings | **No** |
| Tinkerer | "Won't ship a kernel driver" reads as spin | Unchanged word-for-word on Home; Monitor states the same fact neutrally elsewhere, proving they can say it straight and didn't here | **No, unchanged** |
| Budget Teen | Weak headline buries better kicker | Kicker/H1 swapped — H1 is now specific ("actually help your rig") | **Yes** |
| Budget Teen | "It's free" absent from hero | Now stated directly under the CTAs | **Yes** |
| Budget Teen | Counts read as homework | Better on-ramp (START HERE) on both site and app, but total is still 191 | **Partially, unchanged** |
| Budget Teen | 174-vs-191 mismatch | Fixed, both sides say 191 | **Yes** |
| Skeptic | Wants to personally watch a rollback | Structurally can't be resolved by a document — correctly graded as still unresolved, not dodged | **No** |
| Skeptic | Decorative hero proof strip | Now explicit "a real receipt," a null result (harder to fake than a win) — but no visible provenance/link in the pack itself | **Partially** |

## Headline findings

**The Grinder and Tinkerer's core visual/theater complaint moved the wrong direction.** Both
independently flagged that the hologram/JARVIS layer is more prominent now (a 4th view mode, a
named "JARVIS motion" feature with its own Settings toggle and marketing-style description) than at
the 07-12 check-in. This is not a bug — it's a direction the owner has personally invested in — but
it is a real, sharpening tension with these two personas specifically, worth having eyes open about
rather than reading the checklist as "all improving."

**The Tinkerer's sharpest catch this round: the "Deliberately refused" drawer's open state in this
capture is very likely an artifact of Expert View being left ON on this dev machine, not a verified
true default.** Cowork checked this against source after the panel returned it —
`src/design/use-expert-view.ts` confirms `readExpertView()` defaults to `false` or a fresh
`localStorage`, matching the Q3 spec's explicit design ("Default OFF: the default face stays the
recovering-skeptic's"). So the code is not broken. What's real: Expert View was left ON on this
machine (almost certainly leftover from testing the feature itself), and the fresh-panel Casual
Owner's harshest reactions this round were to content that only shows under Expert View — useful
evidence that **when** a non-technical user does encounter Expert View (curiosity, a friend's tip),
it currently backfires for them (raw registry lines, "your call" security framing) — a real input
for refining that feature, distinct from "the default is wrong."

**Tinkerer also caught a real, verified copy-vs-behavior gap:** Settings' Expert View description
promises "every tweak's technical name and the exact registry key, service, or setting it touches."
Cowork checked `src/data/expert-targets.ts` — it contains zero entries for refused tweaks. The
promise doesn't match the behavior for that one tier. Small, mechanizable, worth a fix or a copy
softening.

**Casual Owner is the only persona who self-corrected against her own prior verdict** — she'd said
"down to one toggle" on 07-12; this round's evidence pack shows roughly eight controls, and she
said so plainly rather than defending her earlier read. Notably, the higher count didn't re-trigger
her overwhelm from 07-11 — she attributes that to labeling/explanation quality, not count. Real
signal that count alone isn't the driver of her comfort, clarity per-item is.

**Budget Teen surfaced a genuine, unresolved tension around the new hero proof strip that the
Skeptic's read doesn't cover:** the null ("no gain beyond noise") result reads as more *honest* to
the Skeptic but as a weaker *hook* to the Budget Teen ("nobody clips 'we changed a setting and
nothing happened'... their own Monitor tab has a real ▲37 avg that would've been a more compelling
lead"). Both are internally consistent reactions to the same design choice — this is the honesty-
vs-persuasion tradeoff made explicit by two different real readers, not a bug in either persona.

**Skeptic named a real, but not urgent, future risk:** "You're on the free version... including
everything safety-critical" reads to her as advance notice of a paid tier with unknown scope — the
exact seam where her previous tools turned predatory. She's explicit she isn't accusing yet. Worth
keeping in mind for whatever Pro-tier messaging eventually ships (Pro is real and built dark per
`docs/RECEIPTS_DOCTRINE.md`/`license.rs`), not an action item today.
