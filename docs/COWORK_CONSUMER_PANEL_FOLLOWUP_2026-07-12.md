# Compy — Consumer Panel Follow-Up — 2026-07-12

> Same five personas as the 2026-07-11 panel (`COWORK_CONSUMER_PANEL_2026-07-11.md`), each
> re-dispatched as a genuinely fresh agent, given only its own prior verdict (not the others') plus
> a new evidence pack of the current app (`COWORK_EVIDENCE_PACK_2026-07-12.md`, build
> `50b5c03+dirty`). This is the first real run of the `compy-consumer-panel` skill's follow-up
> mode — five real `Agent` dispatches, no fabrication, transcripts available on request.

## Scorecard — did the changes land?

| Persona | Prior complaint | Now | Verdict |
|---|---|---|---|
| Grinder | Visual theater / toggle clutter | Toggles cut to 1 (real win); hologram/orbit-cam view still there | **Partially** |
| Grinder | "Estimated" 1% lows, no true percentiles | Home/Lab show 1% low as MEASURED; Monitor's *live* reading still says "est"; cross-game comparison undercuts it | **No** |
| Casual Owner | Recovery banner as scary first impression | Not shown this capture; Home leads with readiness + one small ATTENTION flag | **Yes** |
| Casual Owner | "Fully applied" read as unconsented action | Copy now explicit: "Compy never changes anything without your explicit approval... rolls back from Applied" | **Yes** |
| Casual Owner | "Security feature costing frames" read as demand | Same underlying item, but now under a "NEEDS YOUR CALL" section, explicitly framed as her choice | **Partially** |
| Casual Owner | 12-toggle Settings overwhelm | Down to 1 toggle, opens with "None of this touches what Compy measures" | **Yes** |
| Tinkerer | Blackbook grades feel thin | Better scaffolding (grading method links, search, filters) at landing level; entry-level detail not re-checked this capture | **Partially / unverified** |
| Tinkerer | Refused drawer managed, not informed, collapsed | Contents now carry real per-item reasoning + autopsy link; still collapsed by default, no raw value shown inline | **Partially** |
| Tinkerer | No raw values / true percentiles / export | Still humanized numbers only; 1% low is now a real tracked stat but no full distribution; no export found anywhere in Settings | **No** |
| Budget Teen | Weak headline buries the better kicker | Unchanged — site not touched yet | **No** |
| Budget Teen | Hard to find "it's free" | Clear inside the app (Settings → License/About); still absent from the site hero | **Partially** |
| Budget Teen | 174 tweaks / 85 terms reads as homework | "START HERE" bite-sized chips now lead the Blackbook; raw counts still large and now bigger (191 total) | **Partially** |
| Budget Teen | Recovery banner "would stress me out" | Softer language where it does appear ("your call... never re-applies on its own") | **Partially** |
| Skeptic | Wants to personally watch one rollback | Not resolved — this capture didn't include a live rollback demo | **No** |

## The headline finding

**The Casual Owner flipped from "not for me" to a cautious "yes, I'd use it now."** She's the
persona actually built to match Compy's own stated internal target, and last time she was the one
saying the product didn't serve her. This time, unprompted, she said: *"I don't feel fully that
way anymore... the front door and the safety layer are genuinely for me now, even if the deep
instrument panels aren't."* That's the single most important data point from this run — the
language and first-run changes appear to be doing exactly what they were meant to do, for exactly
the person they were meant to do it for.

**The Skeptic moved from guessing "not me" to confidently "this is built for people like me,"**
specifically citing the new "Deliberately refused" autopsies and the "Scam patterns" Blackbook
category as speaking directly to her history of being burned. Her trust level only moved
marginally, though — she was explicit that copy and state-tracking hints aren't a substitute for
watching an actual rollback, and flagged something worth taking seriously: **the marketing site's
hero "proof strip" (applied → measured → rolled back) is a decorative mock, and showing a skeptic
a fake receipt of the exact proof she's waiting for is a small trust risk, not a trust win** — new
finding, not present in the original panel.

**The Tinkerer and Grinder's core complaints are largely unmoved**, and the panel confirms this is
expected, not a miss: both are explicitly not the primary target per the original panel's own
synthesis. Their remaining asks (raw values, true percentiles, export, open-by-default reasoning)
map almost exactly onto the Q3 expert-layer spec already in progress
(`docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`) — this run is independent
evidence that spec is aimed at the right gap.

**The Budget Teen's complaints are unmoved because the site hasn't been touched yet** — expected,
Phase 3 hasn't started. One new wrinkle worth noting: she said she personally wouldn't notice the
174-vs-191 count mismatch, but called it "a landmine for exactly this brand" if anyone did — a
sharper articulation of why that fix matters than the original panel had.

## New issue surfaced this round (not in the original panel) — REVIEWED, CLOSED 2026-07-13

The marketing site's hero "proof strip" — `fast-startup-off applied → +8 fps measured ✓ →
rolled back exact prior value ✓` — is explicitly a decorative mock (confirmed against the site's
own source comments). The Skeptic flagged this directly: it's showing the exact proof format she's
asking to see for real, as a fake.

**Owner decision (2026-07-13): leave as illustrative, not fixing.** A casual visitor genuinely
can't tell — this matches the Budget Teen's own "wouldn't notice on first scroll" read of the
174/191 mismatch. The one real exposure path is a technically-literate visitor viewing page
source and noticing the `aria-hidden="true"` markup — a nonzero but low-probability risk, and
disproportionately likely to be checked by exactly the skeptical audience this app targets. Owner
judged that low-probability/low-stakes combination not worth acting on while the site is still
dark. Not reopened unless something changes (e.g. the site going live, or a real incident).

## Full per-persona transcripts

Not reproduced here in full (each ran ~500-700 words) — available in this session's tool-call
history. Summarized findings above are drawn directly from the real transcripts, not condensed
from memory.
