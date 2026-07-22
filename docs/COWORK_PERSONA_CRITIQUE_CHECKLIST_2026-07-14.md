# Compy — Persona Critique Checklist — 2026-07-14

> Annotated action list from the 2026-07-14 fresh + follow-up consumer-panel rounds (10 real
> `Agent` dispatches total). Tags: 🟢 CLEAR TO FIX · 🎨 YOUR TASTE CALL · 🔒 LOCKED/NON-NEGOTIABLE ·
> ❓ VERIFY FIRST. Each critical point below was checked against `CLAUDE.md` LOCKED rules and
> `docs/UI_VISION_BACKLOG.md` before tagging, not guessed.

## 🟢 CLEAR TO FIX

1. **"Deliberately refused" tweaks show no raw registry key/value even under Expert View**, despite
   Settings' own Expert View description promising "every tweak's technical name and the exact
   registry key, service, or setting it touches." Verified against source: `src/data/expert-targets.ts`
   has zero entries for the refused tier — Ready/Needs-your-call items get raw targets, refused
   items only get reasoning text. Either extend `expert-targets.ts` to cover the refused three, or
   soften the Settings copy to not claim "every tweak." (Tinkerer's catch, source-confirmed by
   Cowork.)
2. **Monitor's headline "vs last session" comparison bundles 11 changes into one delta** ("AVG FPS
   ▲37 · 1% LOW ▲62 · 11 COMPY CHANGES ON") with no way to attribute the gain to any one change —
   in direct tension with the site's own single-variable "proof loop" pitch one click away. Consider
   a caveat on that line, or de-emphasizing it relative to the isolated per-tweak receipts Blackbook
   already produces. (Grinder's catch.)
3. **RAM stat on Home/Lab shows capacity only** (`20.6 / 31.4 GB`), no speed/timings/XMP status —
   a real, low-effort addition for the enthusiast reader. (Tinkerer's catch.)

## ❓ VERIFY FIRST

4. **Whether the "NEEDS YOUR CALL" raw-path display (Memory Integrity/VBS, Defender exclusions,
   etc.) is itself gated by Expert View, or shows regardless.** This capture had Expert View ON, so
   Cowork can't confirm what a default-OFF user sees in that section. Worth a quick check before
   deciding anything needs to change here — if it already hides raw paths under the default face,
   the Casual Owner's fresh-panel reaction (which was to an Expert-View-on capture) may not
   generalize to what a real first-time non-technical user sees. If it does show regardless of
   Expert View, that's the more concerning version of this finding and would move to 🟢.
5. **Whether game-history labels can show a friendly name instead of the raw process string**
   (`PALWORLD-WIN64-SHIPPING` vs "Palworld"; one session logged only as `SAND` with no context).
   Check whether a friendly-name mapping already exists elsewhere (similar to
   `src/data/friendly-labels.ts`) and just isn't applied here, or whether this is the raw exe name
   with no mapping available yet. (Budget Teen's catch.)
6. **No round in this panel's history has captured an actual "Attention > 0" / recovery-banner
   state** — every capture so far has happened to land on a clean rig. The Casual Owner's 07-11
   fear reaction to that banner has never been re-tested against the current copy; it's been marked
   "didn't recur" for two rounds running, which is not the same as "confirmed fixed." Worth a
   capture that deliberately hits that state before calling it resolved.

## 🎨 YOUR TASTE CALL

7. **The hologram/instrument-visual layer reads as theater to the Grinder and Tinkerer, and grew
   more prominent this round** (a 4th view mode, a newly-named "JARVIS motion" feature with its own
   marketing-style Settings description). This is squarely the direction from
   `docs/UI_VISION_BACKLOG.md` you've personally driven — not a defect, a real and sharpening
   tension with these two personas specifically. Flagging so it's a known tradeoff, not a silent
   one.
8. **The new hero "proof loop" receipt is a null result** (game-mode, "no gain beyond ±0.7% noise").
   Two personas split cleanly on it: the Skeptic finds a null result *more* credible as real
   evidence (a scam wouldn't lead with "did nothing"); the Budget Teen finds it a *weaker hook*
   for exactly the same reason ("nobody clips 'we changed a setting and nothing happened'" — his
   own Monitor tab has a real "▲37 avg" that would pull harder). This is the honesty-vs-persuasion
   tradeoff you chose explicitly and recently (this session) made visible by two real readers, not
   a bug — worth knowing the specific shape of the cost you're paying for the choice you already
   made.

## 🔒 LOCKED / NON-NEGOTIABLE

9. **No CPU temperature** — flagged independently by both the Grinder and the Tinkerer in the fresh
   panel. This is LOCKED rule 1 (no kernel driver, proven impossible on this machine) working
   exactly as designed. Not actionable; worth continuing to name plainly rather than treating as a
   gap to close.
10. **Only AMD gets a named vendor-specific callout** (data-collection opt-out); Tinkerer wondered
    about Nvidia parity. This maps to already-tracked, already-honest state per LOCKED rule 5 (AMD
    verified; Nvidia detection + recs are hardware-verified, NVML *sensor* coverage still awaiting a
    monitored session). Not a new gap — already the documented current truth.

## Not actionable — panel methodology note, not a product finding

This round's evidence pack was captured on a broken-in dev machine (52 logged changes, session
history back to May 27, Safe Stack already 8/9 complete, Expert View left on from recent feature
testing) rather than a genuine first-launch state. The Budget Teen caught this independently and
correctly. If a true first-run read is wanted, a future round needs a clean profile/reset capture —
this is a note for how Cowork runs the next panel, not something for CC to build.

## What's explicitly NOT on this list

No paid-tier feature list exists anywhere in the current build — expected and correct, Phase D
(money/distribution) is deliberately deferred per `docs/BACKLOG.md`. The Skeptic's "free version...
implies a paid tier is coming" observation is accurate foresight, not a current problem — worth
keeping in mind for whenever Pro messaging ships, not an action item today.
