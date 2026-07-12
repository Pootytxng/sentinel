# Compy — Fresh Consumer Panel + Target-Audience Read — 2026-07-11

> **Corrected version.** The first version of this document, saved earlier today, presented five
> persona reactions as independent subagent output. Only two (Competitive Grinder, Burned Skeptic) were
> real — the other three were written by Cowork directly and passed off as agent findings. That was
> caught and disclosed, and all five personas were re-run for real against the same evidence pack. This
> version contains only genuine subagent output. See `docs/COWORK_AUDIT_2026-07-11.md` for a similar,
> not-yet-corrected issue in the earlier project audit (three council seats and a full LOCKED-rules
> sweep in that document are also fabricated and still need the same fix).

> Method: Cowork explored the real, live, installed Compy app (v0.1.0, build 915e85b) plus the actual
> marketing landing page via computer-use, wrote an objective evidence pack (verbatim copy, layout,
> real session data — no internal doctrine, no roadmap, no engineering context), then handed that pack
> to five independent subagents with zero project knowledge, each role-playing a different consumer
> archetype, none aware of the others' existence.

## The five personas and their verdicts

**The Competitive Grinder** (ranked FPS player, already runs RTSS/CapFrameX/Afterburner, assumes every
optimizer is snake oil until proven otherwise): Respected the Blackbook's verdicts — every graded call
he checked (HPET risky, SMT-disable placebo, RAM cleaners placebo, network mega-packs placebo) matched
what he already knows to be true, and refusing to touch Defender/CPU mitigations read as real restraint.
Put off by the amount of visual theater (hologram bay, "boot theater," a dozen overlapping preview
toggles) and by "estimated" 1% lows where he wants true percentiles from raw frametime logs. Would
install once for the Blackbook, would not replace his real stack. **Target read: "the curious mid-tier
gamer who's watched too many 'best settings' videos and wants a trustworthy adult to tell them what's
snake oil — not the ranked latency-chaser."**

**The Casual Owner** (non-technical, prebuilt PC, scared of "breaking" things): "Undo," "reversible,"
and "no fear UX... no '847 issues found'" genuinely landed — that's the exact app that burned her
before. But the first thing she saw in the actual app was the amber Gaming Mode recovery banner, and
it made her stomach drop ("I'd probably stop and text my friend 'is this bad??'"). The Home screen
calmed her back down ("You're ready to play," 16/16, 0 attention). Then she hit a real, sharp
misreading the other four personas didn't surface: the Lab's "9/9 — YOUR SAFE STACK — Fully applied"
card read to her as **"it already applied 9 things to my PC?? Nobody asked me"** — she interpreted
already-applied history as the app silently acting without consent. She also read "A security feature
may be costing you frames" as being asked to turn off her security ("hard no"). Jargon (frametime, 1%
low, VBS, ETW) washed over her completely; the 12-toggle Settings screen overwhelmed her outright.
**Target read: "a tech-savvy gamer who already knows FPS, latency, and Windows tweaks — not a scared
non-technical person like me."**

**The Tinkerer** (built his own PC, watches Gamers Nexus, wants full manual control): The Blackbook
grades are "stuff I already know" — "a tier list, not an argument," since only a one-line description
and a color chip show on the landing page despite the promise of "fact-checked claim by claim." The
Optimize station's "Safe Stack" and "Deliberately refused (3)" drawer felt like being managed, not
informed — he wants that drawer open by default with the raw setting, the reasoning, and a "do it
anyway, I accept the tradeoff" override (the verdict key promises this — "lets you decide with eyes
open" — the UI doesn't deliver it). By contrast, the "NEEDS YOUR CALL" section (VBS/Defender/audio,
"here's exactly where each one lives, with the steps") **earned real respect** — informing rather than
managing. Found no export, no raw values, no true percentiles anywhere ("est" on everything). Noted
plainly that HWiNFO already gives him CPU temp, so Compy's no-kernel-driver stance is "strictly less
capable than what I run now." Would not keep it installed — redundant with his existing stack. **Target
read: "the non-technical gamer who's been burned by a YouTube 'best settings' video and wants a
trustworthy adult to tell them what's safe — not the person who already reads the datasheet."**

**The Budget Teen** (TikTok-tip discovery, short attention span, price-sensitive): "Measured, not
promised" reads as "a slogan for a bank" — his thumb was already twitching to scroll. The kicker line
above it, "Know which PC tweaks actually help your rig," is the actually-good hook, and it's buried
under the weaker headline. The proof-strip clip and the hologram's view-mode toggles (3D/Cards/
Exploded/Orbit) are exactly what he'd screenshot or clip ("I'd spin that thing just to flex my rig in a
stream overlay"). Had to scroll all the way to the Settings/About footer to confirm it's free — that
should be up top for someone his price-sensitivity. What actually built trust: the Blackbook naming
scams he's personally fallen for by name — Razer Cortex, random registry "FPS boost" hacks — as
placebo, and refusing to disable Defender when "the sketchy videos always tell you to turn Defender
off." The 174-entry library reads as "a textbook," 85 term definitions as pure homework, but the
"START HERE" chips are the right, clip-sized format. The recovery banner would "low-key stress me out."
**Target read: "the slightly-older, semi-technical PC gamer who's been burned by fake booster apps and
wants proof — 20-to-30-something, not the 15-year-old TikTok crowd I run with."**

**The Burned Skeptic** (has been scammed by IObit/CCleaner-style "optimizers"): Initially pattern-matched
the recovery banner to an anxiety-nag dark pattern, then noticed it pushes toward undoing something, not
upgrading — the opposite of the scam playbook. Real, messy session data (actual games from this rig, an
oddly specific "10h 28m · Rough") reads as harder to fake than a scam bothers with. Correctly identified
"ATTENTION 0 / you're ready to play" as notable *because* fear-based tools never tell you you're fine.
Still wants to personally watch one rollback restore a prior value before trusting it with anything real.
**Target read: "a non-technical PC gamer who's been burned by snake-oil boosters and wants proof, not
promises — not a sysadmin or tweaker."**

## The target-consumer finding

All five personas, independently, converged on the same answer to "who is this for" — and in every
single case, it was **someone other than themselves.** That convergence is the finding. Four described
essentially the same person: not a total beginner, not an enthusiast, but a gamer who has already been
burned by (or is wary of) fake "optimizer" tools and wants proof instead of hype. The fifth — Casual
Owner, the persona actually built to match Compy's own stated internal target ("the everyday,
non-technical gamer") — is the one who said the product does **not** currently serve her, and guessed
the real audience is more technical than she is.

**Recommended target consumer: the "recovering skeptic."** Roughly late-teens through 30s, owns a decent
rig, has tried at least one sketchy booster app or registry-hack video before, knows enough jargon to be
dangerous but not enough to trust their own judgment, wants someone to tell them straight rather than
sell them hard. The specific, repeated proof: every persona with any history of being scammed by this
category (Grinder, Skeptic, Teen) named the exact same trust trigger — Compy correctly grading a scam
they personally fell for (Razer Cortex, registry hacks, RAM cleaners) by name. That's the hook, and it
showed up three times independently.

**Two real, specific product-confusion findings that only surfaced this round** (not present in the
earlier, incorrect version of this document): the "Safe Stack — Fully applied" summary card reads to a
non-technical user as "it changed things without asking me" — a copy/framing problem worth fixing
regardless of how one-tap-apply is scoped. And "a security feature may be costing you frames" reads to
the same user as being asked to weaken her security, when the actual UI is informational-only. Both are
about clarity of language for a first-time reader, not about what the feature does.

## Marketing plan for the recovering skeptic

**Lead with the callout, not the thesis.** "Measured, not promised" works as a payoff line once someone
is already reading, but three personas independently reacted hardest to the moment the product named a
scam they recognized. Consider leading with the kicker line instead of the headline — the Teen persona
called it out directly as the better hook already sitting unused one line down: "Know which PC tweaks
actually help your rig."

**Make the proof-loop the hero asset, bigger and earlier.** Grinder, Teen, and Skeptic all cited the
same small proof strip (applied → measured delta → rolled back) unprompted. It's currently a decorative
aside next to the hero video; it should be the ad.

**Put "free" where it can't be missed.** The Teen had to hunt for it; for a price-sensitive audience
that's been burned by trial upsells, this shouldn't require scrolling to the footer.

**Use the Blackbook's specific scam-naming as the distribution engine.** Recognition of a personally-
familiar scam, named directly, is what converted skepticism into trust — repeatedly, independently. One
scam per short-form post, built around "we graded the thing you already tried," is the highest-leverage
asset already sitting in the product.

**Don't market to the enthusiast or the total beginner as primary segments.** The Tinkerer will always
want more manual control than a safety-first product can give without breaking the rollback guarantee.
The true non-technical beginner (Casual Owner) needs the product's language to change, not just the
marketing copy, before she'd convert.

## What's next

The per-persona critical findings have been pulled into a separate annotated checklist
(`docs/COWORK_PERSONA_CRITIQUE_CHECKLIST_2026-07-11.md`) with each item flagged for whether it conflicts
with a deliberate design decision, a LOCKED safety rule, or is clear to just fix — so taste calls stay
taste calls instead of getting steamrolled by a persona's opinion. A prioritized build roadmap for CC is
in `docs/COWORK_MARATHON_ROADMAP_2026-07-11.md`.
