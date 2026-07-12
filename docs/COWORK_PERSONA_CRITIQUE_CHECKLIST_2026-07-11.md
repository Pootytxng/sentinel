# Compy — Persona Critique Checklist, Annotated — 2026-07-11

> Every critical/unfavorable statement from the five real persona reviews (`COWORK_CONSUMER_PANEL_2026-07-11.md`),
> one section per persona, nothing else — no positive reactions, just what they didn't like. Each item
> is tagged so a persona's opinion doesn't get mistaken for a verdict:
>
> - 🟢 **CLEAR TO FIX** — no conflict with anything deliberate found. Just needs building.
> - 🎨 **YOUR TASTE CALL** — touches a direction you've deliberately invested in, or a real scope/identity
>   decision. The persona's opinion is one input, not the answer. Decide before CC touches it.
> - 🔒 **LOCKED / NON-NEGOTIABLE** — conflicts with a safety, anti-cheat, or stability rule from CLAUDE.md.
>   Noted for completeness; not something a consumer opinion overrides.
> - ❓ **VERIFY FIRST** — might be a real product gap, might be an artifact of this specific test rig
>   (your dev machine, ledger: 51 real entries — not a fresh install). Check before prioritizing.

---

## The Competitive Grinder (ranked player, runs RTSS/CapFrameX/Afterburner already)

- [ ] 🎨 Visual polish reads as "theater" over substance — named the hologram bay, "boot theater," and
      the stack of preview toggles specifically. **Conflict:** the hologram/Instrument-HUD console
      direction is something you've personally steered through multiple owner-approved rounds
      (`UI_VISION_BACKLOG.md`) — this isn't a bug, it's your own creative direction being judged by
      someone outside its intended audience. See the Budget Teen's opposite reaction below before
      deciding anything here.
- [ ] 🟢 "1% LOW ... est" — wants true percentiles from raw frametime logs, not an estimate. If the
      underlying capture already has the real per-frame data, this may just be a labeling/computation
      gap, not a design choice.
- [ ] 🎨 Wouldn't replace his existing stack (RTSS/CapFrameX/Afterburner) with this. **Not necessarily a
      problem** — the panel's own target-consumer finding says he isn't the primary audience. Chasing
      this critique risks pulling the product away from the "recovering skeptic" identity toward power-
      user territory it may not want to occupy.

## The Casual Owner (non-technical, prebuilt PC, scared of breaking things)

- [ ] 🎨 First thing she saw was the amber Gaming Mode recovery banner, on every screen, and it scared
      her ("I'd probably text my friend 'is this bad??'"). **Split issue:** the banner existing and
      persisting until resolved is a deliberate rollback-first/never-hide-an-unresolved-state choice —
      don't touch that mechanism. Its color, copy, and *whether it's the literal first thing shown*
      before a user has had one calm look at Home is a separate, open presentation question.
- [ ] 🟢 Jargon (frametime, 1% low, VRR, VBS, ETW, "anti-cheat safe") "washed over" her completely —
      no conflict found; this is the product falling short of CLAUDE.md's own stated promise of
      plain-English, no-jargon framing for non-technical users.
- [ ] 🟢 The Settings screen (12 toggles) "totally overwhelmed" her, wouldn't touch any of it — same
      root cause as the Tinkerer/Teen's "homework" complaints below; see the settings-flag item in the
      roadmap.
- [ ] ❓ Read "9/9 — YOUR SAFE STACK — Fully applied" as "it already applied 9 things to my PC?? Nobody
      asked me." **Verify first:** this is your personal dev/test rig with real history (ledger: 51) —
      confirm whether a fresh consumer install can reach a "fully applied" state without an explicit
      user action, or whether this card just needs clearer "you approved these, here's when" framing
      regardless.
- [ ] 🔒 Read "a security feature may be costing you frames" (the VBS/Memory Integrity advisory) as
      being asked to turn off her security — "hard no." **Not a real conflict, a copy problem:** this
      item is informational-only by design (LOCKED rule — Compy never touches security/system settings
      itself); the copy just needs to make that clearer, not change the underlying behavior.

## The Tinkerer (built his own PC, wants full manual control)

- [ ] 🟢 Blackbook grades feel thin — one-line description + color chip is "a tier list, not an
      argument," despite the site promising "fact-checked claim by claim." No conflict found; the
      "Autopsy a guide" reasoning apparently already exists somewhere, it's just not surfaced near the
      grade.
- [ ] 🔒 The "Deliberately refused (3)" drawer and the lack of an override switch, despite the verdict
      key's own promise ("lets you decide with eyes open"). **Real conflict, but on the LOCKED side:**
      CLAUDE.md rule 6 keeps items like Defender-disable and CPU-mitigation-disable barred *regardless
      of measured benefit* — that's not owner-discretionary per install, it's a hard safety/anti-cheat
      rail. An override switch for THESE specific items should not be built. Whether the drawer shows
      its reasoning openly instead of collapsed is a separate, non-locked question.
- [ ] 🎨 Wants raw values, a true percentile breakdown, and a data-export option — none exist today.
      **Scope/identity call:** adding a genuine expert/power-user layer is a real decision about whether
      Compy competes with CapFrameX/HWiNFO on depth, which could cut against the simplicity-first
      identity the recovering-skeptic target actually responded to. Not a simple bug fix either way.
- [ ] 🟢 "READINESS 100 · SCORED" reads to him as "a made-up number." If there's real methodology behind
      the score, surfacing it (even just a tooltip) costs little and doesn't conflict with anything.
- [ ] 🔒 No CPU temp / no kernel driver — noted that HWiNFO already gives him this, calls Compy "strictly
      less capable." **LOCKED, not fixable:** CLAUDE.md rule 1 — no kernel driver, proven impossible in
      user-mode on the dev rig, not up for reconsideration.
- [ ] 🎨 Wouldn't keep it installed — redundant with his existing tools. Same as the Grinder's parallel
      point: likely fine if you're not chasing this tier as a primary audience.

## The Budget Teen (TikTok-tip discovery, price-sensitive, short attention span)

- [ ] 🟢 Headline "Measured, not promised" reads as "a slogan for a bank" — weak hook, would have
      scrolled past. He specifically points at the kicker line one row above it ("Know which PC tweaks
      actually help your rig") as the better hook already sitting there, unused. No conflict — the
      landing site is explicitly not live yet ("DARK until the publish ladder" per its own source
      comment), this is cheap to reorder before anyone sees it.
- [ ] 🟢 Couldn't easily tell it was free — had to scroll to the Settings/About footer. No conflict
      found; straightforward layout fix on an unshipped page.
- [ ] 🟢 "174 tweaks... that's a textbook," "85 terms... straight-up homework." No conflict — this is a
      presentation/emphasis issue (lead with the bite-sized "START HERE" format he DID like), not a
      reason to cut content.
- [ ] 🎨 Recovery banner "would low-key stress me out" — same item as the Casual Owner's, see above.

## The Burned Skeptic (scammed before by IObit/CCleaner-style tools)

- [ ] 🎨 Recovery banner initially pattern-matched to a scam nag-bar before he read it closely enough to
      tell the difference. Same underlying item as above — presentation/timing question, not the
      mechanism itself.
- [ ] 🟢 Hasn't personally watched a rollback complete — wants to see apply → measure → undo happen once
      before trusting anything real. No conflict found; this is a legitimate first-run trust-building
      gap, not a request to change any existing behavior.
- [ ] 🎨 "A lot of glossy for something claiming to be all substance" — same visual-theater point as the
      Grinder's, same conflict noted: this is your own championed creative direction, not a defect.
