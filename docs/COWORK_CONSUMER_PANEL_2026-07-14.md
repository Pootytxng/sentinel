# Compy — Consumer Panel — Fresh Read — 2026-07-14

> Five personas, each a genuinely fresh `Agent` dispatch with zero prior context — no history, no
> knowledge of the 2026-07-11/07-12 panels, no knowledge of each other. Each worked only from
> `docs/COWORK_EVIDENCE_PACK_2026-07-14.md` (build `3ba79dc`, verified live-matching HEAD at
> capture time). Real dispatches, real transcripts — none fabricated.

## Grinder (Competitive FPS player, runs RTSS/CapFrameX/Afterburner)

Flags a real internal-consistency problem: Home shows "READINESS 100" / "ATTENTION 0" in the same
breath as "1 worth fixing" and a "medium confidence" limiter — contradictory framing. Bigger catch:
Monitor's headline comparison ("AVG FPS ▲37 · 1% LOW ▲62 · 11 COMPY CHANGES ON") bundles eleven
changes into one number — exactly the kind of unattributable claim the site's own "proof loop"
(one tweak, isolated, measured) argues against. Also flags two sessions tagged "different game"
that still carry a delta arrow, a session with only "first 2h 0m recorded" of a 10h28m play time,
and only 2 of 8 guides fact-checked. No CPU temp is a real gap for him specifically (Afterburner
already gives it free). Target guess: newer PC gamer, not him. Would install to skim the Blackbook,
would not keep it running, can't evaluate paying (no Pro details anywhere in the pack).

## Casual Owner (non-technical, prebuilt PC, scared of breaking things)

Reacted worse than the marketing is aiming for. "no temp — Compy won't ship a kernel driver" reads
as alarming, not reassuring, to her specifically. A raw line — `HKCU\Software\Microsoft\GameBar →
AutoGameModeEnabled...` — sitting next to a toggle is exactly the kind of thing that burned her
before. "NEEDS YOUR CALL" telling her to go personally weaken her own Windows Security is the
opposite of what she wants from a safety tool. "52 changes to this PC" reads scary in big print.
Room names ("Autopsy," "Black Box," "Proving Ground") feel like a lab experiment, not a home
checkup. **Important caveat on this reaction: this capture had "Expert view" switched ON — see the
note below the checklist doc; a real first-run install defaults it OFF, so this specific persona's
worst reactions are to content a first-time non-technical user would not actually see by default.**
Target guess: not her — someone who already knows FPS/1% lows/registry keys, which she says
contradicts the site's own "no fear UX" claim. Would likely close the app and not reinstall.

## Tinkerer (built own PC, watches Gamers Nexus, wants control not management)

No CPU temp is a real hole for him too — HWiNFO64 already does this for free. Most of Optimize is
stuff he already handles himself (Game Mode, startup apps); "Needs your call" items are just menu
paths ("dressed up as a feature"). Refused-drawer reasoning re-explains things he already knows.
RAM stat (20.6/31.4 GB) is missing speed/timings/XMP — the number he'd actually want. Calls the
hologram/JARVIS visual layer "demo-video energy." Notes only AMD gets a vendor-specific callout
(data-collection opt-out) and wonders if Nvidia gets equal depth. Target guess: beginner-to-
intermediate, not him. Would install once out of curiosity, likely wouldn't keep it running — the
automatic before/after Logbook is the one thing he'd miss. No basis to judge paying.

## Budget Teen (found via TikTok, price-sensitive, short attention span)

Likes the hologram enough to screenshot it. Confused by "no temp" and by file-name-style session
labels ("PALWORLD-WIN64-SHIPPING" instead of "Palworld"); one session just says "SAND" with no
explanation. "52 changes... 13 still on" reads alarming rather than reassuring to him too. **Sharp,
legitimate methodology catch, independent of the product itself: he notices the Safe Stack is
already 8/9 done and session history goes back to May 27 — and correctly infers this capture is a
broken-in power-user PC, not a true first-run.** He's right — this round did not attempt a genuine
first-launch capture (see limitations note below). Site is invite-only, so he can't actually get it
from a TikTok link today — real funnel friction for his profile. Target guess: more patient,
hardcore PC-gamer type, not him. Would install only if he could skip the waitlist; no price shown
anywhere makes "free forever" read slightly suspicious to him ("what changes once they've got me
hooked").

## Burned Skeptic (scammed before by IObit/CCleaner-style tools)

The hologram + repeated "MEASURED" stamps read as branding, the same move she's seen from IObit and
Driver Booster. Calls the hero "proof loop" card "an ad wearing a receipt costume" — one cherry-
picked example chosen by the people writing the sales copy. Flags that "You're on the free version
— all of Compy's core, including everything safety-critical, is free" implies a non-safety paid
tier exists with unknown scope — the exact shape of tools that turned predatory after hooking her.
Also names the "invite only" waitlist chip as scarcity marketing, even against the footer's own
"no dark patterns" claim. Credits real things: "ATTENTION 0 / 1 worth fixing" instead of inflated
issue counts, the Deliberately-refused list actually saying no to things, a registry path she could
independently verify, and the honest "no kernel driver" admission rather than a faked number. Wants
to see it refuse something genuinely tempting, not just three things she'd never click anyway.
Target guess: a gamer burned before, same as her. Would install cautiously; would only keep it
running after personally watching a real rollback; won't pay until she sees what's paywalled.

## Cross-cutting reads for this round

Every persona independently flagged the missing CPU temperature — this is LOCKED rule 1
(no kernel driver, proven impossible on this machine) doing exactly what it's supposed to; not a
gap to close, a permanent tradeoff to keep naming plainly.

Two personas (Grinder, Tinkerer) still read the hologram/JARVIS visual layer as theater rather
than substance, now stronger than before (branded "JARVIS motion," a fourth view mode). This is a
direction the owner has personally invested in — see the checklist doc's tagging rather than
treating it as a defect.

Two personas (Budget Teen, Skeptic) reacted to the same new hero "proof loop" receipt from opposite
angles: Skeptic finds the null result *more* credible as evidence (a scam wouldn't lead with "did
nothing"); Budget Teen finds it a weaker hook *because* it's a null result ("nobody clips 'we
changed a setting and nothing happened'"). Both readings are internally consistent — this is a real,
named tension between honesty-as-brand and persuasion, not a contradiction to resolve away.

**Limitation of this round, named plainly:** this capture was taken on a broken-in dev machine (52
logged changes, sessions back to May 27, Safe Stack already 8/9 complete, Expert View left ON from
recent feature testing) — not a genuine first-launch state. Two personas caught this independently
(Budget Teen explicitly, Casual Owner's harshest reactions were to Expert-View-only content). If a
true first-run read matters, it needs a clean profile/reset state, which this round did not capture.
